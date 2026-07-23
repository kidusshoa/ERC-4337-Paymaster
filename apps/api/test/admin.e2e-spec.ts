import 'dotenv/config';
import { ChildProcess, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Address, createPublicClient, createWalletClient, Hex, http, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

/**
 * Proves GET /admin/paymaster-status is both correctly gated (AdminApiKeyGuard's
 * branches themselves are unit-tested in admin-api-key.guard.spec.ts) and, more
 * importantly, actually reads real on-chain state — the deposit/stake this test
 * funds via real deposit()/addStake() calls on a freshly-deployed VerifyingPaymaster
 * must come back unchanged through the API's getDepositInfo() read.
 *
 * Requires `forge build` to have been run in contracts/ (reads its compiled
 * artifacts directly) and the Foundry toolchain installed (spawns a throwaway Anvil).
 */

const ANVIL_PORT = 8555;
const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CONTRACTS_OUT = join(__dirname, '..', '..', '..', 'contracts', 'out');
const ADMIN_API_KEY = 'test-admin-api-key-1234567890';

const DEPOSIT_WEI = 1_000_000_000_000_000_000n; // 1 ETH
const STAKE_WEI = 2_000_000_000_000_000_000n; // 2 ETH
const UNSTAKE_DELAY_SEC = 86_400;

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

describe('Admin paymaster-status (e2e)', () => {
  let anvil: ChildProcess;
  let app: INestApplication;

  const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  beforeAll(async () => {
    anvil = spawn(resolveAnvilBinary(), ['--port', String(ANVIL_PORT), '--silent'], {
      stdio: 'ignore',
    });

    const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC_URL) });
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
    const entryPointReceipt = await publicClient.waitForTransactionReceipt({
      hash: entryPointDeployTx,
    });
    const entryPointAddress = entryPointReceipt.contractAddress as Address;

    const verifyingSigner = privateKeyToAccount(process.env.SIGNER_PRIVATE_KEY as Hex).address;

    const paymasterArtifact = loadArtifact(
      join('VerifyingPaymaster.sol', 'VerifyingPaymaster.json'),
    );
    const paymasterDeployTx = await walletClient.deployContract({
      abi: paymasterArtifact.abi,
      bytecode: paymasterArtifact.bytecode,
      args: [entryPointAddress, verifyingSigner],
    });
    const paymasterReceipt = await publicClient.waitForTransactionReceipt({
      hash: paymasterDeployTx,
    });
    const paymasterAddress = paymasterReceipt.contractAddress as Address;

    const depositTx = await walletClient.writeContract({
      address: paymasterAddress,
      abi: paymasterArtifact.abi,
      functionName: 'deposit',
      args: [],
      value: DEPOSIT_WEI,
      chain: foundry,
    } as unknown as Parameters<typeof walletClient.writeContract>[0]);
    await publicClient.waitForTransactionReceipt({ hash: depositTx });

    const addStakeTx = await walletClient.writeContract({
      address: paymasterAddress,
      abi: paymasterArtifact.abi,
      functionName: 'addStake',
      args: [UNSTAKE_DELAY_SEC],
      value: STAKE_WEI,
      chain: foundry,
    } as unknown as Parameters<typeof walletClient.writeContract>[0]);
    await publicClient.waitForTransactionReceipt({ hash: addStakeTx });

    process.env.ENTRY_POINT_ADDRESS = entryPointAddress;
    process.env.PAYMASTER_CONTRACT_ADDRESS = paymasterAddress;
    process.env.ADMIN_API_KEY = ADMIN_API_KEY;
    // The app's own ViemClientService must read from *this* Anvil, not the default
    // CHAIN_RPC_URL from .env — the admin endpoint actually calls the chain (unlike
    // paymaster-onchain.e2e-spec.ts, where only the test's own standalone publicClient
    // does), so this one can't be skipped the way it is there.
    process.env.CHAIN_RPC_URL = ANVIL_RPC_URL;
    // Isolates this file's BullMQ worker from every other AppModule-booting e2e
    // file's confirmation-check queue (see queue.module.ts's doc comment).
    process.env.BULLMQ_PREFIX = 'test-admin';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (anvil && !anvil.killed) {
      const exited = new Promise<void>((resolve) => anvil.once('exit', () => resolve()));
      anvil.kill();
      await exited;
    }
  });

  it('rejects a request with no admin API key', async () => {
    await request(app.getHttpServer()).get('/admin/paymaster-status').expect(401);
  });

  it('rejects a request with the wrong admin API key', async () => {
    await request(app.getHttpServer())
      .get('/admin/paymaster-status')
      .set('x-admin-api-key', 'not-the-real-key')
      .expect(401);
  });

  it('returns the real on-chain deposit/stake for a correctly-authenticated request', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/paymaster-status')
      .set('x-admin-api-key', ADMIN_API_KEY)
      .expect(200);

    expect(response.body).toMatchObject({
      depositWei: DEPOSIT_WEI.toString(),
      lowBalance: false,
      staked: true,
      stakeWei: STAKE_WEI.toString(),
      unstakeDelaySec: UNSTAKE_DELAY_SEC,
    });
  });
});
