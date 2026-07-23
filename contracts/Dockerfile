# One-shot deployer image: builds the contracts and, on `docker compose up`, deploys
# VerifyingPaymaster (+ a fresh EntryPoint on Anvil) via script/docker-deploy.sh, then
# exits. Not used for local development — see README.md for the plain `forge`/`anvil`
# workflow; this Dockerfile only exists to make `docker compose up` reproducible from
# a clean clone.
FROM ghcr.io/foundry-rs/foundry:latest

WORKDIR /contracts

COPY --chown=foundry:foundry . .
RUN forge build

# Pre-create the mount point owned by the non-root `foundry` user (the image's
# default) — Docker initializes a fresh named volume from whatever already exists
# at its mount path in the image, ownership included, so this is what makes
# /deployment writable by this container without running as root. Needs a
# temporary switch to root: the image's default `foundry` user can't create
# top-level directories.
USER root
RUN mkdir -p /deployment && chown foundry:foundry /deployment
USER foundry

ENTRYPOINT ["script/docker-deploy.sh"]
