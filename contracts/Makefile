SHELL := /bin/sh

# Load local secrets/config when present; `.env` is ignored by git.
-include .env

.PHONY: build test deploy seed-listing verify

build:
	forge build

test:
	forge test -vv

deploy:
	@test -n "$(BASE_SEPOLIA_RPC_URL)" || (echo "BASE_SEPOLIA_RPC_URL is required" >&2; exit 1)
	forge script script/Deploy.s.sol:Deploy --rpc-url "$(BASE_SEPOLIA_RPC_URL)" --broadcast

seed-listing:
	@test -n "$(BASE_SEPOLIA_RPC_URL)" || (echo "BASE_SEPOLIA_RPC_URL is required" >&2; exit 1)
	forge script script/SeedListing.s.sol:SeedListing --rpc-url "$(BASE_SEPOLIA_RPC_URL)" --broadcast

verify:
	@test -n "$(BASE_SEPOLIA_RPC_URL)" || (echo "BASE_SEPOLIA_RPC_URL is required" >&2; exit 1)
	@test -n "$(CONTRACT_ADDRESS)" || (echo "CONTRACT_ADDRESS is required" >&2; exit 1)
	@test -n "$(BASESCAN_API_KEY)" || (echo "BASESCAN_API_KEY is required" >&2; exit 1)
	forge verify-contract --chain base-sepolia --watch --etherscan-api-key "$(BASESCAN_API_KEY)" \
		"$(CONTRACT_ADDRESS)" src/EvalVaultEscrow.sol:EvalVaultEscrow \
		--constructor-args "$$(cast abi-encode 'constructor(address,uint64,uint64,uint64)' "$(EVALUATOR_ADDRESS)" "$(DELIVERY_WINDOW)" "$(REVIEW_WINDOW)" "$(RESOLUTION_WINDOW)")"
