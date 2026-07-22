import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient();

const DEFAULT_POLICY_NAME = 'Default permissive policy (local dev)';
const LOCAL_ANVIL_CHAIN_ID = 31337;

/**
 * Seeds a single permissive SponsorshipPolicy for local development — any contract,
 * any method, a small daily quota per wallet. Idempotent: safe to run repeatedly.
 * Real policies (scoped to specific dApp contracts/methods) get created via the
 * policy management surface built in modules/paymaster (Phase 9), not by editing
 * this seed.
 */
async function main() {
  const existing = await prisma.sponsorshipPolicy.findFirst({
    where: { chainId: LOCAL_ANVIL_CHAIN_ID, targetContract: null, name: DEFAULT_POLICY_NAME },
  });

  if (existing) {
    console.log(`Seed: "${DEFAULT_POLICY_NAME}" already exists (id=${existing.id}), skipping.`);
    return;
  }

  const policy = await prisma.sponsorshipPolicy.create({
    data: {
      name: DEFAULT_POLICY_NAME,
      chainId: LOCAL_ANVIL_CHAIN_ID,
      targetContract: null,
      allowedSelectors: [],
      dailyQuota: 5,
      isActive: true,
    },
  });

  console.log(`Seed: created "${policy.name}" (id=${policy.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
