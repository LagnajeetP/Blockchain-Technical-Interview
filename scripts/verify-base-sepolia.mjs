import { readFile } from 'node:fs/promises';

// This verifier uses only public JSON-RPC data. It needs no wallet or private key.
const manifest = JSON.parse(
  await readFile(new URL('../deployments/base-sepolia.json', import.meta.url)),
);
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || manifest.rpcUrl;

const eventTopics = {
  ListingCreated:
    '0xb61923c7cc18fc06bbfdcfe413873929ac3b1b2f1c8e6f188c5f2cc4d989efd4',
  OrderFunded:
    '0xda4e0e1bc6c6beefa36b7e6dd7c41c600c0be8102cf2cb0443d6278714a08c90',
  OrderDelivered:
    '0x32da370ce9389c14cd49f60ca0a5afc2e75c9909d04b371e6666de92f515618c',
  OrderAccepted:
    '0xa3a9d59445e437d97cac53692b666afef6c152b0642edd206bde8472f387e59a',
  OrderRefunded:
    '0x6d26c3e074f5005c32fdb16f62046440936ffdc2c4c9e01197a2c8440c00ced7',
  Withdrawal:
    '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
};

let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  if (!response.ok)
    throw new Error(`${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeUint(hex) {
  return Number(BigInt(hex));
}

function decodeAddress(hex) {
  return `0x${hex.slice(-40)}`.toLowerCase();
}

const chainId = decodeUint(await rpc('eth_chainId'));
requireValue(
  chainId === manifest.chainId,
  `Expected chain ${manifest.chainId}, received ${chainId}`,
);

const contractAddress = manifest.contract.address.toLowerCase();
const bytecode = await rpc('eth_getCode', [contractAddress, 'latest']);
requireValue(bytecode && bytecode !== '0x', 'Escrow bytecode is missing');

// Read immutable deployment configuration directly from the deployed contract.
const calls = {
  evaluator: '0x9cb93dd1',
  deliveryWindowSeconds: '0xfd637a94',
  reviewWindowSeconds: '0x9ca4218f',
  resolutionWindowSeconds: '0x3a0ea704',
};
const evaluator = decodeAddress(
  await rpc('eth_call', [
    { to: contractAddress, data: calls.evaluator },
    'latest',
  ]),
);
requireValue(
  evaluator === manifest.contract.evaluator.toLowerCase(),
  `Evaluator mismatch: ${evaluator}`,
);
for (const key of [
  'deliveryWindowSeconds',
  'reviewWindowSeconds',
  'resolutionWindowSeconds',
]) {
  const value = decodeUint(
    await rpc('eth_call', [
      { to: contractAddress, data: calls[key] },
      'latest',
    ]),
  );
  requireValue(value === manifest.contract[key], `${key} mismatch: ${value}`);
}

const deploymentReceipt = await rpc('eth_getTransactionReceipt', [
  manifest.contract.deploymentTransaction,
]);
requireValue(
  deploymentReceipt?.status === '0x1',
  'Deployment transaction did not succeed',
);
requireValue(
  deploymentReceipt.contractAddress?.toLowerCase() === contractAddress,
  'Deployment receipt points to a different contract',
);

for (const transaction of manifest.transactions) {
  const receipt = await rpc('eth_getTransactionReceipt', [transaction.hash]);
  requireValue(
    receipt?.status === '0x1',
    `${transaction.label} did not succeed`,
  );
  requireValue(
    receipt.to?.toLowerCase() === contractAddress,
    `${transaction.label} used another contract`,
  );
  const expectedTopic = eventTopics[transaction.expectedEvent];
  requireValue(
    receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === contractAddress &&
        log.topics[0]?.toLowerCase() === expectedTopic,
    ),
    `${transaction.label} is missing ${transaction.expectedEvent}`,
  );
  console.log(`PASS  ${transaction.label}  ${transaction.hash}`);
}

console.log(
  `PASS  EvalVaultEscrow ${contractAddress} is deployed and all ${manifest.transactions.length} chain writes are confirmed on Base Sepolia (${chainId}).`,
);
