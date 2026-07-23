/*
  Warnings:

  - Added the required column `callGasLimit` to the `user_operations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `opMaxFeePerGas` to the `user_operations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `opMaxPriorityFeePerGas` to the `user_operations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `preVerificationGas` to the `user_operations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `verificationGasLimit` to the `user_operations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "user_operations" ADD COLUMN     "callGasLimit" TEXT NOT NULL,
ADD COLUMN     "initCode" TEXT NOT NULL DEFAULT '0x',
ADD COLUMN     "opMaxFeePerGas" TEXT NOT NULL,
ADD COLUMN     "opMaxPriorityFeePerGas" TEXT NOT NULL,
ADD COLUMN     "preVerificationGas" TEXT NOT NULL,
ADD COLUMN     "verificationGasLimit" TEXT NOT NULL;
