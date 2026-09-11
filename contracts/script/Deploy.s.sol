// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EvalVaultEscrow } from "../src/EvalVaultEscrow.sol";
import { Vm } from "./Vm.sol";

contract Deploy {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error ValueTooLarge();

    event Deployment(
        address indexed contractAddress,
        address indexed evaluator,
        uint64 deliveryWindow,
        uint64 reviewWindow,
        uint64 resolutionWindow
    );

    function run() external returns (EvalVaultEscrow escrow) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address evaluator = vm.envAddress("EVALUATOR_ADDRESS");
        uint64 deliveryWindow = _asUint64(vm.envOr("DELIVERY_WINDOW", 1 days));
        uint64 reviewWindow = _asUint64(vm.envOr("REVIEW_WINDOW", 1 days));
        uint64 resolutionWindow = _asUint64(vm.envOr("RESOLUTION_WINDOW", 1 days));

        vm.startBroadcast(privateKey);
        escrow = new EvalVaultEscrow(evaluator, deliveryWindow, reviewWindow, resolutionWindow);
        vm.stopBroadcast();

        emit Deployment(address(escrow), evaluator, deliveryWindow, reviewWindow, resolutionWindow);
    }

    function _asUint64(uint256 value) private pure returns (uint64) {
        if (value > type(uint64).max) revert ValueTooLarge();
        return uint64(value);
    }
}
