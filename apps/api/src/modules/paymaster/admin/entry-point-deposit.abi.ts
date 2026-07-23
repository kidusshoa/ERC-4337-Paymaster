/**
 * The single EntryPoint v0.7 view function the admin status endpoint needs —
 * hand-written for the same reason as relayer/entry-point.abi.ts: the running app
 * shouldn't depend on contracts/out/ existing on disk. Matches
 * IStakeManager.getDepositInfo / DepositInfo exactly; see
 * contracts/lib/account-abstraction/contracts/interfaces/IStakeManager.sol.
 */
export const ENTRY_POINT_DEPOSIT_INFO_ABI = [
  {
    type: 'function',
    name: 'getDepositInfo',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      {
        name: 'info',
        type: 'tuple',
        components: [
          { name: 'deposit', type: 'uint256' },
          { name: 'staked', type: 'bool' },
          { name: 'stake', type: 'uint112' },
          { name: 'unstakeDelaySec', type: 'uint32' },
          { name: 'withdrawTime', type: 'uint48' },
        ],
      },
    ],
  },
] as const;
