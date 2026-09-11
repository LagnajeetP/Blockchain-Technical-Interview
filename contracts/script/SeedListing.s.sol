// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EvalVaultEscrow } from "../src/EvalVaultEscrow.sol";
import { Vm } from "./Vm.sol";

contract SeedListing {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error ValueTooLarge();

    event ListingSeeded(
        address indexed contractAddress,
        uint256 indexed listingId,
        bytes32 artifactCommitment,
        bytes32 termsHash,
        uint256 price,
        uint64 expiresAt
    );

    function run() external returns (uint256 listingId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        EvalVaultEscrow escrow = EvalVaultEscrow(vm.envAddress("CONTRACT_ADDRESS"));
        bytes32 artifactCommitment = vm.envBytes32("ARTIFACT_COMMITMENT");
        bytes32 termsHash = vm.envBytes32("TERMS_HASH");
        uint256 price = vm.envUint("LISTING_PRICE_WEI");
        uint64 expiresAt = _asUint64(vm.envUint("LISTING_EXPIRES_AT"));

        vm.startBroadcast(privateKey);
        listingId = escrow.createListing(artifactCommitment, termsHash, price, expiresAt);
        vm.stopBroadcast();

        emit ListingSeeded(
            address(escrow), listingId, artifactCommitment, termsHash, price, expiresAt
        );
    }

    function _asUint64(uint256 value) private pure returns (uint64) {
        if (value > type(uint64).max) revert ValueTooLarge();
        return uint64(value);
    }
}
