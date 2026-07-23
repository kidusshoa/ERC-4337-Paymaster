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
import {
  packAccountGasLimits,
  packGasFees,
} from '../src/modules/paymaster/signing/packed-user-op.util';

/**
 * Proves the API's signed paymasterAndData is actually accepted by the real, deployed
 * VerifyingPaymaster contract on a live chain — closing the loop between Phase 9's
 * off-chain hash replica and the on-chain original. Deliberately scoped to a single
 * impersonated call to validatePaymasterUserOp (not a full handleOps execution,
 * which belongs to the relayer submission phase): "impersonated" here means calling
 * with an arbitrary `account` (the EntryPoint's address) — eth_call never requires
 * that account to sign anything, so no anvil_impersonateAccount is actually needed.
 *
 * Requires `forge build` to have been run in contracts/ (reads its compiled
 * artifacts directly) and the Foundry toolchain installed (spawns a throwaway Anvil).
 *
 * AppModule is imported dynamically (inside beforeAll, after the env overrides
 * below) rather than statically at the top of the file: `@Module()` decorators run
 * at import time, so ConfigModule.forRoot() would otherwise snapshot process.env
 * *before* ENTRY_POINT_ADDRESS/PAYMASTER_CONTRACT_ADDRESS are overridden to this
 * test's freshly-deployed addresses, and the app would silently keep signing
 * against the stale .env placeholder instead.
 */

const ANVIL_PORT = 8547;
const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CONTRACTS_OUT = join(__dirname, '..', '..', '..', 'contracts', 'out');

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

function randomAddress(): Address {
  const suffix = Math.random().toString(16).slice(2).padEnd(38, '0').slice(0, 38);
  return `0x${suffix}aa` as Address;
}

describe('Paymaster on-chain validation proof (e2e)', () => {
  let anvil: ChildProcess;
  let app: INestApplication;
  let publicClient: PublicClient;
  let entryPointAddress: Address;
  let paymasterAddress: Address;

  const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

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
    const entryPointReceipt = await publicClient.waitForTransactionReceipt({
      hash: entryPointDeployTx,
    });
    entryPointAddress = entryPointReceipt.contractAddress as Address;

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
    paymasterAddress = paymasterReceipt.contractAddress as Address;

    // The running app must sign against these exact freshly-deployed addresses —
    // set before AppModule (and its ConfigModule) is even imported, see file header.
    process.env.ENTRY_POINT_ADDRESS = entryPointAddress;
    process.env.PAYMASTER_CONTRACT_ADDRESS = paymasterAddress;

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

  function looseUserOp(overrides: Partial<{ sender: Address; nonce: bigint; callData: Hex }> = {}) {
    return {
      sender: randomAddress(),
      nonce: 0n,
      initCode: '0x' as Hex,
      callData: '0x1234abcd' as Hex,
      callGasLimit: 200_000n,
      verificationGasLimit: 100_000n,
      preVerificationGas: 50_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      ...overrides,
    };
  }

  function toSponsorRequestBody(userOp: ReturnType<typeof looseUserOp>) {
    return {
      sender: userOp.sender,
      nonce: userOp.nonce.toString(),
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: userOp.callGasLimit.toString(),
      verificationGasLimit: userOp.verificationGasLimit.toString(),
      preVerificationGas: userOp.preVerificationGas.toString(),
      maxFeePerGas: userOp.maxFeePerGas.toString(),
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas.toString(),
      targetContract: '0xdead0000dead0000dead0000dead0000dead0000',
      selector: '0xa9059cbb',
    };
  }

  /** Decodes BasePaymaster's packed validationData: low 160 bits are the
   *  "aggregator" field — address(0) means the signature was accepted, address(1)
   *  means SIG_VALIDATION_FAILED — mirroring Helpers.sol's _parseValidationData. */
  function sigFailed(validationData: bigint): boolean {
    return (validationData & ((1n << 160n) - 1n)) === 1n;
  }

  async function callValidatePaymasterUserOp(userOp: {
    sender: Address;
    nonce: bigint;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: bigint;
    gasFees: Hex;
    paymasterAndData: Hex;
    signature: Hex;
  }): Promise<{ context: Hex; validationData: bigint }> {
    const paymasterArtifact = loadArtifact(
      join('VerifyingPaymaster.sol', 'VerifyingPaymaster.json'),
    );
    const { result } = await publicClient.simulateContract({
      address: paymasterAddress,
      abi: paymasterArtifact.abi,
      functionName: 'validatePaymasterUserOp',
      args: [userOp, `0x${'00'.repeat(32)}`, 1_000_000_000_000_000_000n],
      account: entryPointAddress,
    });
    const [context, validationData] = result as [Hex, bigint];
    return { context, validationData };
  }

  it('accepts a valid, API-issued paymasterAndData', async () => {
    const userOp = looseUserOp();
    const response = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send(toSponsorRequestBody(userOp))
      .expect(200);

    const { validationData } = await callValidatePaymasterUserOp({
      ...userOp,
      accountGasLimits: packAccountGasLimits(userOp),
      gasFees: packGasFees(userOp),
      paymasterAndData: response.body.paymasterAndData,
      signature: '0x',
    });

    expect(sigFailed(validationData)).toBe(false);
  });

  it('rejects a tampered UserOp (callData changed after the API signed it)', async () => {
    const userOp = looseUserOp();
    const response = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send(toSponsorRequestBody(userOp))
      .expect(200);

    const { validationData } = await callValidatePaymasterUserOp({
      ...userOp,
      callData: '0xdeadbeef', // signed for 0x1234abcd — no longer matches
      accountGasLimits: packAccountGasLimits(userOp),
      gasFees: packGasFees(userOp),
      paymasterAndData: response.body.paymasterAndData,
      signature: '0x',
    });

    expect(sigFailed(validationData)).toBe(true);
  });
});
