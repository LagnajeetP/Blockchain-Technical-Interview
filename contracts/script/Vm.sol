// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Small subset of Foundry's Vm interface used by the scripts in this directory.
interface Vm {
    function envAddress(string calldata name) external returns (address value);
    function envBytes32(string calldata name) external returns (bytes32 value);
    function envUint(string calldata name) external returns (uint256 value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
