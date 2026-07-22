-- CreateEnum
CREATE TYPE "UserOpStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'STUCK');

-- CreateTable
CREATE TABLE "sponsorship_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "targetContract" TEXT,
    "allowedSelectors" TEXT[],
    "dailyQuota" INTEGER NOT NULL,
    "maxGasPerOp" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_operations" (
    "id" TEXT NOT NULL,
    "userOpHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "callData" TEXT NOT NULL,
    "paymasterAndData" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "UserOpStatus" NOT NULL DEFAULT 'PENDING',
    "policyId" TEXT,
    "submittedTxHash" TEXT,
    "maxFeePerGas" TEXT,
    "maxPriorityFeePerGas" TEXT,
    "bumpCount" INTEGER NOT NULL DEFAULT 0,
    "blockNumber" BIGINT,
    "gasUsed" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_quota_usage" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "opsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "wallet_quota_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_policies_chainId_targetContract_key" ON "sponsorship_policies"("chainId", "targetContract");

-- CreateIndex
CREATE UNIQUE INDEX "user_operations_userOpHash_key" ON "user_operations"("userOpHash");

-- CreateIndex
CREATE INDEX "user_operations_sender_createdAt_idx" ON "user_operations"("sender", "createdAt");

-- CreateIndex
CREATE INDEX "user_operations_status_idx" ON "user_operations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_quota_usage_walletAddress_policyId_day_key" ON "wallet_quota_usage"("walletAddress", "policyId", "day");

-- AddForeignKey
ALTER TABLE "user_operations" ADD CONSTRAINT "user_operations_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "sponsorship_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_quota_usage" ADD CONSTRAINT "wallet_quota_usage_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "sponsorship_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
