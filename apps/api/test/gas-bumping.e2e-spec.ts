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
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  hashMessage,
  Hex,
  http,
  parseEther,
  publicActions,
  PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Forces a genuinely stuck transaction (Anvil auto-mining disabled) and proves
 * ConfirmationCheckProcessor recovers automatically: SUBMITTED -> STUCK (no receipt
 * within the delay window) -> resubmitted with bumped fees at the *same relayer
 * nonce* -> SUBMITTED again -> CONFIRMED once a block is finally mined. This is
 * Phase 12's actual done-criteria — the happy path is already covered by
 * relayer.e2e-spec.ts.
 *
 * Requires `forge build` in contracts/ and the Foundry toolchain. AppModule is
 * imported dynamically after the env overrides — see paymaster-onchain.e2e-spec.ts's
 * header comment for why.
 */

const ANVIL_PORT = 8553;
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

async function pollUntil(
  check: () => Promise<boolean>,
  { attempts = 50, intervalMs = 200 }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Condition not met after ${attempts} attempts (${(attempts * intervalMs) / 1000}s)`,
  );
}

describe('Gas-bumping worker (e2e)', () => {
  let anvil: ChildProcess;
  let app: INestApplication;
  let prisma: PrismaService;
  let publicClient: PublicClient;
  let testClient: ReturnType<typeof createTestClient> & ReturnType<typeof publicActions>;
  let entryPointAddress: Address;
  let paymasterAddress: Address;
  let accountAddress: Address;

  beforeAll(async () => {
    anvil = spawn(resolveAnvilBinary(), ['--port', String(ANVIL_PORT), '--silent'], {
      stdio: 'ignore',
    });
    publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC_URL) });
    await waitForAnvil(publicClient);
    testClient = createTestClient({
      chain: foundry,
      mode: 'anvil',
      transport: http(ANVIL_RPC_URL),
    }).extend(publicActions);

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

    process.env.ENTRY_POINT_ADDRESS = entryPointAddress;
    process.env.PAYMASTER_CONTRACT_ADDRESS = paymasterAddress;
    process.env.CHAIN_RPC_URL = ANVIL_RPC_URL;
    // Isolates this file's BullMQ worker from every other AppModule-booting e2e
    // file's confirmation-check queue (see queue.module.ts's doc comment).
    process.env.BULLMQ_PREFIX = 'test-gas-bumping';
    // Short enough that the test doesn't take real minutes, long enough to
    // reliably outlast the setup calls above (which all rely on automine).
    process.env.STUCK_CHECK_DELAY_SECONDS = '2';
    process.env.GAS_BUMP_PERCENT = '20';
    process.env.MAX_GAS_BUMP_ATTEMPTS = '5';

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

  it('recovers a stuck transaction automatically: SUBMITTED -> STUCK -> SUBMITTED (bumped) -> CONFIRMED', async () => {
    const simpleAccountArtifact = loadArtifact(join('SimpleAccount.sol', 'SimpleAccount.json'));
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
    const ownerAccount = privateKeyToAccount(ACCOUNT_OWNER_PRIVATE_KEY);
    const signature = await ownerAccount.sign({ hash: hashMessage({ raw: userOpHash as Hex }) });

    // Disable automining *after* all setup transactions above already landed —
    // this submission's handleOps tx will sit in the mempool, genuinely unmined.
    await testClient.setAutomine(false);

    const submitResponse = await request(app.getHttpServer())
      .post('/relayer/submit')
      .send({ userOpHash, signature })
      .expect(200);
    expect(submitResponse.body.status).toBe('SUBMITTED');
    const firstTxHash = submitResponse.body.submittedTxHash;

    // Wait for ConfirmationCheckProcessor to detect it's not mined, mark STUCK, and
    // resubmit with bumped fees — observed as bumpCount incrementing and a new
    // submittedTxHash (same relayer nonce, higher fee) replacing the original.
    await pollUntil(
      async () => {
        const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash } });
        return row.bumpCount >= 1 && row.submittedTxHash !== firstTxHash;
      },
      { attempts: 60, intervalMs: 200 },
    );

    const stuckRow = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash } });
    expect(stuckRow.bumpCount).toBeGreaterThanOrEqual(1);
    expect(stuckRow.status).toBe('SUBMITTED');
    expect(BigInt(stuckRow.maxFeePerGas!)).toBeGreaterThan(2_000_000_000n);
    const bumpedTxHash = stuckRow.submittedTxHash;

    // Now let a block through — the bumped (replacement) transaction should mine.
    await testClient.mine({ blocks: 1 });

    await pollUntil(async () => {
      const statusResponse = await request(app.getHttpServer())
        .get(`/userops/${userOpHash}`)
        .expect(200);
      return statusResponse.body.status === 'CONFIRMED' || statusResponse.body.status === 'FAILED';
    });

    const finalRow = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash } });
    expect(finalRow.status).toBe('CONFIRMED');
    expect(finalRow.submittedTxHash).toBe(bumpedTxHash);
    expect(finalRow.blockNumber).not.toBeNull();

    // The original (stuck) transaction never confirmed — only the bumped replacement did.
    const originalReceipt = await publicClient
      .getTransactionReceipt({ hash: firstTxHash as Hex })
      .catch(() => null);
    expect(originalReceipt).toBeNull();
  }, 30_000);
});
