import 'dotenv/config';
import { ChildProcess, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  hashMessage,
  Hex,
  http,
  parseEther,
  PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Full-stack proof of Phase 11: sponsors a real UserOp for a real, deployed
 * SimpleAccount (eth-infinitism's reference account — the only "account" contract
 * this build needs, since our own scope is the paymaster/relayer, not a wallet
 * implementation), has the account "owner" sign it, submits it through
 * POST /relayer/submit, and confirms the resulting handleOps() transaction actually
 * lands on-chain — the state machine's PENDING -> SUBMITTED -> CONFIRMED path
 * observed against a real chain, not mocked.
 *
 * Requires `forge build` in contracts/ (reads its compiled artifacts) and Foundry
 * installed (spawns a throwaway Anvil). AppModule is imported dynamically after the
 * env overrides below — see paymaster-onchain.e2e-spec.ts's header comment for why.
 */

const ANVIL_PORT = 8551;
const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CONTRACTS_OUT = join(__dirname, '..', '..', '..', 'contracts', 'out');

const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil #0
const ACCOUNT_OWNER_PRIVATE_KEY =
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'; // anvil #3

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

function resolveAnvilBinary(): string {
  const candidate = join(homedir(), '.foundry', 'bin', 'anvil');
  return existsSync(candidate) ? candidate : 'anvil';
}

async function waitForAnvil(publicClient: PublicClient, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await publicClient.getChainId();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error('Anvil did not become ready in time');
}

describe('Relayer submission (e2e)', () => {
  let anvil: ChildProcess;
  let app: INestApplication;
  let prisma: PrismaService;
  let publicClient: PublicClient;
  let entryPointAddress: Address;
  let paymasterAddress: Address;
  let accountAddress: Address;

  beforeAll(async () => {
    anvil = spawn(resolveAnvilBinary(), ['--port', String(ANVIL_PORT), '--silent'], {
      stdio: 'ignore',
    });
    publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC_URL) });
    await waitForAnvil(publicClient);

    const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account: deployer,
      chain: foundry,
      transport: http(ANVIL_RPC_URL),
    });

    const entryPointArtifact = loadArtifact(join('EntryPoint.sol', 'EntryPoint.json'));
    const entryPointDeployTx = await walletClient.deployContract({
      abi: entryPointArtifact.abi,
      bytecode: entryPointArtifact.bytecode,
      args: [],
    });
    entryPointAddress = (await publicClient.waitForTransactionReceipt({ hash: entryPointDeployTx }))
      .contractAddress as Address;

    const verifyingSigner = privateKeyToAccount(process.env.SIGNER_PRIVATE_KEY as Hex).address;
    const paymasterArtifact = loadArtifact(
      join('VerifyingPaymaster.sol', 'VerifyingPaymaster.json'),
    );
    const paymasterDeployTx = await walletClient.deployContract({
      abi: paymasterArtifact.abi,
      bytecode: paymasterArtifact.bytecode,
      args: [entryPointAddress, verifyingSigner],
    });
    paymasterAddress = (await publicClient.waitForTransactionReceipt({ hash: paymasterDeployTx }))
      .contractAddress as Address;

    // handleOps charges the paymaster's EntryPoint deposit for the op's gas — needs
    // a real balance there, unlike Phase 10's single validatePaymasterUserOp call.
    const depositTx = await walletClient.writeContract({
      address: paymasterAddress,
      abi: paymasterArtifact.abi,
      functionName: 'deposit',
      value: parseEther('10'),
    } as unknown as Parameters<typeof walletClient.writeContract>[0]);
    await publicClient.waitForTransactionReceipt({ hash: depositTx });

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
    // Random salt so the resulting CREATE2 account address — and therefore its
    // wallet-tier rate-limit identity in the real, persistent Redis instance other
    // e2e suites also share — is fresh on every run, not a fixed address that
    // accumulates quota usage across repeated local test runs.
    const salt = BigInt(Math.floor(Math.random() * 1_000_000_000));
    const createAccountTx = await walletClient.writeContract({
      address: factoryAddress,
      abi: factoryArtifact.abi,
      functionName: 'createAccount',
      args: [ownerAddress, salt],
    });
    await publicClient.waitForTransactionReceipt({ hash: createAccountTx });
    accountAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: factoryArtifact.abi,
      functionName: 'getAddress',
      args: [ownerAddress, salt],
    })) as Address;

    // The running app must sign/submit against these exact freshly-deployed
    // addresses, and — unlike Phase 10, which never dials the chain — actually
    // broadcast to *this* Anvil, not the default CHAIN_RPC_URL from .env. All set
    // before AppModule (and its ConfigModule) is even imported.
    process.env.ENTRY_POINT_ADDRESS = entryPointAddress;
    process.env.PAYMASTER_CONTRACT_ADDRESS = paymasterAddress;
    process.env.CHAIN_RPC_URL = ANVIL_RPC_URL;

    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  }, 40_000);

  afterAll(async () => {
    await app?.close();
    if (anvil && !anvil.killed) {
      const exited = new Promise<void>((resolve) => anvil.once('exit', () => resolve()));
      anvil.kill();
      await exited;
    }
  });

  it('sponsors, signs, submits, and confirms a real UserOp end-to-end', async () => {
    const simpleAccountArtifact = loadArtifact(join('SimpleAccount.sol', 'SimpleAccount.json'));
    // A harmless no-op call: execute(address(0), 0, "0x").
    const callData = encodeFunctionData({
      abi: simpleAccountArtifact.abi,
      functionName: 'execute',
      args: ['0x0000000000000000000000000000000000000000', 0n, '0x'],
    });

    const sponsorResponse = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send({
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
      })
      .expect(200);

    const { userOpHash } = sponsorResponse.body;
    expect(userOpHash).toMatch(/^0x[0-9a-f]{64}$/i);

    // The account owner signs userOpHash — exactly what SimpleAccount._validateSignature checks.
    const ownerAccount = privateKeyToAccount(ACCOUNT_OWNER_PRIVATE_KEY);
    const signature = await ownerAccount.sign({ hash: hashMessage({ raw: userOpHash as Hex }) });

    const submitResponse = await request(app.getHttpServer())
      .post('/relayer/submit')
      .send({ userOpHash, signature })
      .expect(200);

    expect(submitResponse.body.status).toBe('SUBMITTED');
    expect(submitResponse.body.submittedTxHash).toMatch(/^0x[0-9a-f]{64}$/i);

    let status = submitResponse.body.status;
    for (
      let attempt = 0;
      attempt < 30 && status !== 'CONFIRMED' && status !== 'FAILED';
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const statusResponse = await request(app.getHttpServer())
        .get(`/userops/${userOpHash}`)
        .expect(200);
      status = statusResponse.body.status;
    }

    expect(status).toBe('CONFIRMED');

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash } });
    expect(row.blockNumber).not.toBeNull();
    expect(row.gasUsed).not.toBeNull();
  }, 20_000);

  it('rejects submitting the same UserOp twice (no longer PENDING)', async () => {
    const callData = encodeFunctionData({
      abi: loadArtifact(join('SimpleAccount.sol', 'SimpleAccount.json')).abi,
      functionName: 'execute',
      args: ['0x0000000000000000000000000000000000000000', 0n, '0x'],
    });

    const sponsorResponse = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send({
        sender: accountAddress,
        nonce: '1',
        initCode: '0x',
        callData,
        callGasLimit: '100000',
        verificationGasLimit: '150000',
        preVerificationGas: '50000',
        maxFeePerGas: '2000000000',
        maxPriorityFeePerGas: '1000000000',
        targetContract: '0xdead0000dead0000dead0000dead0000dead0000',
        selector: '0xa9059cbb',
      })
      .expect(200);

    const { userOpHash } = sponsorResponse.body;
    const ownerAccount = privateKeyToAccount(ACCOUNT_OWNER_PRIVATE_KEY);
    const signature = await ownerAccount.sign({ hash: hashMessage({ raw: userOpHash as Hex }) });

    await request(app.getHttpServer())
      .post('/relayer/submit')
      .send({ userOpHash, signature })
      .expect(200);

    await request(app.getHttpServer())
      .post('/relayer/submit')
      .send({ userOpHash, signature })
      .expect(409);
  });

  it('404s on an unknown userOpHash', async () => {
    const unknown = `0x${'ab'.repeat(32)}`;
    await request(app.getHttpServer()).get(`/userops/${unknown}`).expect(404);
    await request(app.getHttpServer())
      .post('/relayer/submit')
      .send({ userOpHash: unknown, signature: `0x${'11'.repeat(65)}` })
      .expect(404);
  });
});
