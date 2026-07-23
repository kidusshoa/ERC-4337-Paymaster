export const CONFIRMATION_CHECK_QUEUE = 'userop-confirmation-check';
export const CONFIRMATION_CHECK_JOB = 'check';

export interface ConfirmationCheckJobData {
  userOpHash: string;
  txHash: string;
}
