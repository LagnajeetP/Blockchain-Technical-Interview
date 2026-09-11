# Deployment and listing seeding

These commands target Base Sepolia. They only broadcast when you explicitly run a
target with `--broadcast`; review the simulation output first. The scripts do not
generate, print, or persist private keys.

The completed public deployment and transaction set are recorded in
[`deployments/base-sepolia.json`](../deployments/base-sepolia.json). From the
repository root, run `node scripts/verify-base-sepolia.mjs` to verify the deployed
bytecode, immutable evaluator and timing values, transaction destinations, receipt
statuses, and expected contract events directly against Base Sepolia.

## Setup

Install Foundry, copy `.env.example` to `.env`, and fill in the RPC URL, deployer
private key, and evaluator address. Load the file into the shell that invokes Make:

```sh
set -a
. ./.env
set +a
```

`EVALUATOR_ADDRESS` is immutable after deployment. The deployer key becomes the
seller for a seeded listing, so use the intended seller account for `SeedListing`.
Every constructor window is in seconds and must be between one minute and 30 days;
the default is one day for each window.

## Build and deploy

Run the dependency-free build and tests first:

```sh
make build
make test
```

Simulate deployment and inspect the constructor values and resulting address:

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

When the simulation is correct, broadcast it:

```sh
make deploy
```

Record the emitted deployment address as `CONTRACT_ADDRESS` before seeding a listing.

## Seed a listing

Hash private artifact and terms material locally and provide the resulting non-zero
`bytes32` values as `ARTIFACT_COMMITMENT` and `TERMS_HASH`. `LISTING_PRICE_WEI` is
the exact native ETH price. `LISTING_EXPIRES_AT` is an absolute Unix timestamp in
the future; for example, `date -v+7d +%s` on macOS or `date -d '+7 days' +%s` on
GNU/Linux.

Simulate and review the call, then broadcast:

```sh
forge script script/SeedListing.s.sol:SeedListing --rpc-url "$BASE_SEPOLIA_RPC_URL"
make seed-listing
```

The escrow emits `ListingCreated` in the transaction receipt; that is the canonical
on-chain listing record. After the broadcast finishes, the script also prints its
own `ListingSeeded` helper event with the contract address and returned listing ID.
Confirm the commitment, terms hash, seller, evaluator, price, and expiry in the
escrow's `ListingCreated` event before using the listing.

The contract records only hashes. Do not put artifact plaintext, terms plaintext, or
private dispute evidence in calldata.

## Optional Basescan verification

Set `BASESCAN_API_KEY` and keep the exact evaluator and window values used at
deployment in the environment. Then run:

```sh
make verify
```

Verification is optional and requires network access plus a valid Basescan key. The
verify target uses the published `EvalVaultEscrow` source and ABI-encoded constructor
arguments; it does not deploy anything.

## Safe cast interaction flow

For a one-off listing without the Solidity script, first construct and inspect the
calldata. This does not contact the chain or broadcast a transaction:

```sh
cast calldata "createListing(bytes32,bytes32,uint256,uint64)" \
  "$ARTIFACT_COMMITMENT" "$TERMS_HASH" "$LISTING_PRICE_WEI" "$LISTING_EXPIRES_AT"
```

After checking the destination, calldata, and expiration, explicitly broadcast with:

```sh
cast send --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" \
  "$CONTRACT_ADDRESS" \
  "createListing(bytes32,bytes32,uint256,uint64)" \
  "$ARTIFACT_COMMITMENT" "$TERMS_HASH" "$LISTING_PRICE_WEI" "$LISTING_EXPIRES_AT"
```

Use a dedicated seller key. Never paste a private key into documentation, source,
shell history, or a chat transcript.
