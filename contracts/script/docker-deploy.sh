#!/bin/sh
# Runs inside the `contracts-deploy` one-shot container (see ../Dockerfile and the
# repo root docker-compose.yml). Waits for the `anvil` service to accept RPC calls,
# deploys VerifyingPaymaster via the existing DeployPaymaster.s.sol script (the same
# one used for manual local/Sepolia deploys — see README.md), then extracts the
# deployed addresses from its console output and writes them to a shared volume so
# the `api` service can pick them up at startup (see apps/api/docker-entrypoint.sh).
set -eu

RPC_URL="${RPC_URL:-http://anvil:8545}"
OUT_FILE="${DEPLOYMENT_OUT_FILE:-/deployment/.env.deployed}"

echo "docker-deploy: waiting for anvil at ${RPC_URL} ..."
attempts=0
until cast chain-id --rpc-url "${RPC_URL}" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "${attempts}" -ge 60 ]; then
    echo "docker-deploy: anvil never became reachable at ${RPC_URL}" >&2
    exit 1
  fi
  sleep 1
done
echo "docker-deploy: anvil is up after ${attempts}s"

echo "docker-deploy: running DeployPaymasterScript ..."
DEPLOY_LOG="$(forge script script/DeployPaymaster.s.sol:DeployPaymasterScript \
  --rpc-url "${RPC_URL}" --broadcast 2>&1)" || {
  echo "${DEPLOY_LOG}" >&2
  echo "docker-deploy: forge script failed" >&2
  exit 1
}
echo "${DEPLOY_LOG}"

entry_point_address="$(echo "${DEPLOY_LOG}" | grep -i 'EntryPoint at:' | grep -oE '0x[0-9a-fA-F]{40}' | head -n1)"
paymaster_address="$(echo "${DEPLOY_LOG}" | grep 'VerifyingPaymaster deployed at:' | grep -oE '0x[0-9a-fA-F]{40}' | head -n1)"

if [ -z "${paymaster_address}" ]; then
  echo "docker-deploy: could not find a deployed VerifyingPaymaster address in the script output" >&2
  exit 1
fi

if [ -z "${entry_point_address}" ]; then
  echo "docker-deploy: could not find an EntryPoint address in the script output" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUT_FILE}")"
cat > "${OUT_FILE}" <<EOF
ENTRY_POINT_ADDRESS=${entry_point_address}
PAYMASTER_CONTRACT_ADDRESS=${paymaster_address}
EOF

echo "docker-deploy: wrote ${OUT_FILE}:"
cat "${OUT_FILE}"
