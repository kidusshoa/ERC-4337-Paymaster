/**
 * End-to-end sponsor -> sign -> submit -> confirm demo against an ALREADY RUNNING
 * stack (`docker compose up -d --build` from the repo root) — this script makes no
 * assumptions about the API's internals; it only talks to the public HTTP API and
 * the chain directly, exactly like a real integrator would.
 *
 * It deploys its own SimpleAccountFactory + SimpleAccount (eth-infinitism's
 * reference account — the only "account" contract this project needs, since the
 * paymaster/relayer don't care which account implementation the sender uses) against
 * the compose stack's own Anvil, using Anvil's well-known account #3 as the account
 * owner. EntryPoint/VerifyingPaymaster are NOT deployed here — those are already
 * live, deployed once by the `contracts-deploy` one-shot service at `docker compose
 * up` time (see contracts/script/docker-deploy.sh).
 *
 * Requires `forge build` to have been run in contracts/ (reads its compiled
 * SimpleAccountFactory/SimpleAccount artifacts) and the stack already up.
 *
 * Run from apps/api/: `pnpm demo`
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  hashMessage,
  Hex,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

const API_BASE_URL = process.env.DEMO_API_BASE_URL ?? 'http://localhost:5010';
const CHAIN_RPC_URL = process.env.DEMO_CHAIN_RPC_URL ?? 'http://127.0.0.1:8545';
// Matches docker-compose.yml's demo-only ADMIN_API_KEY — used here only to read
// `entryPoint` off GET /admin/paymaster-status so this script doesn't need you to
// hand-copy an address out of `docker compose logs contracts-deploy`.
const ADMIN_API_KEY =
  process.env.DEMO_ADMIN_API_KEY ?? 'local-compose-admin-key-do-not-use-in-prod';
const CONTRACTS_OUT = join(__dirname, '..', '..', '..', 'contracts', 'out');

// Anvil's well-known account #0/#3 test keys — same ones docker-compose.yml and the
// e2e suites use. Never fund or reuse these on a real network.
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ACCOUNT_OWNER_PRIVATE_KEY =
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';

function loadArtifact(relPath: string): { abi: readonly unknown[]; bytecode: Hex } {
  const path = join(CONTRACTS_OUT, relPath);
  if (!existsSync(path)) {
    throw new Error(
      `Contract artifact not found at ${path} — run \`forge build\` in contracts/ first.`,
    );
  }
  const json = JSON.parse(readFileSync(path, 'utf-8'));
  return { abi: json.abi, bytecode: json.bytecode.object as Hex };
}

function log(step: string, detail?: unknown): void {
  console.log(`\n▸ ${step}`);
  if (detail !== undefined) console.log(detail);
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  return { status: response.status, body: await response.json() };
}

async function main(): Promise<void> {
  const publicClient = createPublicClient({ chain: foundry, transport: http(CHAIN_RPC_URL) });
  const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account: deployer,
    chain: foundry,
    transport: http(CHAIN_RPC_URL),
  });

  log(`Connecting to API at ${API_BASE_URL} and chain at ${CHAIN_RPC_URL}...`);
  const health = await getJson('/health');
  if (health.status !== 200) {
    throw new Error(
      `API health check failed (${health.status}) — is \`docker compose up -d --build\` running?`,
    );
  }
  log('API is healthy', health.body);

  log('Reading the deployed EntryPoint address (GET /admin/paymaster-status)...');
  const adminStatus = await getJson('/admin/paymaster-status', {
    'x-admin-api-key': ADMIN_API_KEY,
  });
  if (adminStatus.status !== 200) {
    throw new Error(
      `Could not read paymaster status (${adminStatus.status}): ${JSON.stringify(adminStatus.body)} — ` +
        'is ADMIN_API_KEY set on the running instance? See docker-compose.yml.',
    );
  }
  const entryPointAddress = adminStatus.body.entryPoint as Address;
  log('Paymaster status', adminStatus.body);

  log('Deploying a fresh SimpleAccountFactory + SimpleAccount...');
  const factoryArtifact = loadArtifact(
    join('SimpleAccountFactory.sol', 'SimpleAccountFactory.json'),
  );
  const factoryDeployTx = await walletClient.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode,
    args: [entryPointAddress],
  });
  const factoryAddress = (await publicClient.waitForTransactionReceipt({ hash: factoryDeployTx }))
    .contractAddress as Address;

  const ownerAddress = privateKeyToAccount(ACCOUNT_OWNER_PRIVATE_KEY).address;
  const salt = BigInt(Math.floor(Math.random() * 1_000_000_000));
  const createAccountTx = await walletClient.writeContract({
    address: factoryAddress,
    abi: factoryArtifact.abi,
    functionName: 'createAccount',
    args: [ownerAddress, salt],
  });
  await publicClient.waitForTransactionReceipt({ hash: createAccountTx });
  const accountAddress = (await publicClient.readContract({
    address: factoryAddress,
    abi: factoryArtifact.abi,
    functionName: 'getAddress',
    args: [ownerAddress, salt],
  })) as Address;
  log('SimpleAccount deployed', { accountAddress, ownerAddress });

  log('Requesting sponsorship (POST /paymaster/sponsor)...');
  const simpleAccountArtifact = loadArtifact(join('SimpleAccount.sol', 'SimpleAccount.json'));
  const callData = encodeFunctionData({
    abi: simpleAccountArtifact.abi,
    functionName: 'execute',
    args: ['0x0000000000000000000000000000000000000000', 0n, '0x'], // harmless no-op
  });

  const sponsorResponse = await postJson('/paymaster/sponsor', {
    sender: accountAddress,
    nonce: '0',
    initCode: '0x',
    callData,
    callGasLimit: '100000',
    verificationGasLimit: '150000',
    preVerificationGas: '50000',
    maxFeePerGas: '2000000000',
    maxPriorityFeePerGas: '1000000000',
    targetContract: '0xdead0000dead0000dead0000dead0000dead0000',
    selector: '0xa9059cbb',
  });
  if (sponsorResponse.status !== 200) {
    throw new Error(
      `Sponsorship rejected (${sponsorResponse.status}): ${JSON.stringify(sponsorResponse.body)}`,
    );
  }
  const { userOpHash } = sponsorResponse.body;
  log('Sponsorship approved', sponsorResponse.body);

  log('Signing userOpHash as the account owner...');
  const ownerAccount = privateKeyToAccount(ACCOUNT_OWNER_PRIVATE_KEY);
  const signature = await ownerAccount.sign({ hash: hashMessage({ raw: userOpHash as Hex }) });

  log('Submitting for relaying (POST /relayer/submit)...');
  const submitResponse = await postJson('/relayer/submit', { userOpHash, signature });
  if (submitResponse.status !== 200) {
    throw new Error(
      `Submission failed (${submitResponse.status}): ${JSON.stringify(submitResponse.body)}`,
    );
  }
  log('Broadcast', submitResponse.body);

  log('Polling GET /userops/:hash for confirmation...');
  let status = submitResponse.body.status;
  let last = submitResponse.body;
  for (let attempt = 0; attempt < 100 && status !== 'CONFIRMED' && status !== 'FAILED'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const statusResponse = await getJson(`/userops/${userOpHash}`);
    status = statusResponse.body.status;
    last = statusResponse.body;
  }

  log(`Final status: ${status}`, last);
  if (status !== 'CONFIRMED') {
    throw new Error(`UserOperation did not confirm (final status: ${status})`);
  }
}

main().catch((err) => {
  console.error('\nDemo failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
