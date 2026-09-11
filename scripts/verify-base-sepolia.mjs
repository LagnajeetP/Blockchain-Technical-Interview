import { readFile } from 'node:fs/promises';

// This verifier reads only public Base Sepolia data. It needs no wallet or key.
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
  OrderRejected:
    '0x2e835f6a733eb49a8bdc1f6c6fe07290a86db9cd6df6179643e3a3eec045c9d0',
  OrderRefunded:
    '0x6d26c3e074f5005c32fdb16f62046440936ffdc2c4c9e01197a2c8440c00ced7',
  OrderAccepted:
    '0xa3a9d59445e437d97cac53692b666afef6c152b0642edd206bde8472f387e59a',
  OrderChallenged:
    '0x66ebadc2bf90131943799a839e54e346d9ebb70f244dea5f244a22fab7d89220',
  OrderResolved:
    '0xeeac5c6e2a4a78c0b8fc63ad06c0583038114ffac635a175fac85fc786d1461c',
  OrderReleased:
    '0xd91f42113b172b52ce79098fcccffbdce809144244eae0a9aba15aa700714ee0',
  Withdrawal:
    '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
};

const functionSelectors = {
  createListing: '0x004e6fcd',
  buy: '0xe9fca283',
  markDelivered: '0x70f0fff1',
  reject: '0x6be1320b',
  refundUndelivered: '0x558e1375',
  accept: '0x19b05f49',
  challenge: '0x6806fdbd',
  releaseAfterReview: '0x62672672',
  resolve: '0x9077d2fa',
  refundUnresolved: '0x938ce949',
  withdraw: '0x3ccfd60b',
};

const readSelectors = {
  evaluator: '0x9cb93dd1',
  deliveryWindowSeconds: '0xfd637a94',
  reviewWindowSeconds: '0x9ca4218f',
  resolutionWindowSeconds: '0x3a0ea704',
  getListing: '0x107a274a',
  getOrder: '0xd09ef241',
  totalLiabilities: '0xf73579a9',
  credits: '0xfe5ff468',
};

const orderStates = {
  None: 0,
  Funded: 1,
  Delivered: 2,
  Disputed: 3,
  Released: 4,
  Refunded: 5,
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
  return BigInt(hex);
}

function decodeAddress(hex) {
  return `0x${hex.slice(-40)}`.toLowerCase();
}

function words(hex) {
  return hex.slice(2).match(/.{64}/g) || [];
}

function encodeUint(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function encodeAddress(address) {
  return address.toLowerCase().slice(2).padStart(64, '0');
}

const chainId = Number(decodeUint(await rpc('eth_chainId')));
requireValue(
  chainId === manifest.chainId,
  `Expected chain ${manifest.chainId}, received ${chainId}`,
);

const contractAddress = manifest.contract.address.toLowerCase();
const bytecode = await rpc('eth_getCode', [contractAddress, 'latest']);
requireValue(bytecode && bytecode !== '0x', 'Escrow bytecode is missing');

// Read immutable deployment configuration directly from contract storage.
const evaluator = decodeAddress(
  await rpc('eth_call', [
    { to: contractAddress, data: readSelectors.evaluator },
    'latest',
  ]),
);
requireValue(
  evaluator === manifest.actors.evaluator.toLowerCase(),
  `Evaluator mismatch: ${evaluator}`,
);
for (const key of [
  'deliveryWindowSeconds',
  'reviewWindowSeconds',
  'resolutionWindowSeconds',
]) {
  const value = decodeUint(
    await rpc('eth_call', [
      { to: contractAddress, data: readSelectors[key] },
      'latest',
    ]),
  );
  requireValue(
    value === BigInt(manifest.contract[key]),
    `${key} mismatch: ${value}`,
  );
}

const deploymentReceipt = await rpc('eth_getTransactionReceipt', [
  manifest.contract.deploymentTransaction,
]);
const deploymentTransaction = await rpc('eth_getTransactionByHash', [
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
requireValue(
  deploymentTransaction.from?.toLowerCase() ===
    manifest.actors.operator.toLowerCase(),
  'Deployment was not sent by the declared operator',
);

const transactions = [
  ...manifest.listings.map((listing) => listing.transaction),
  ...manifest.flows.flatMap((flow) => flow.transactions),
];
const coveredFunctions = new Set(transactions.map((item) => item.function));
for (const functionName of manifest.requiredFunctions) {
  requireValue(
    coveredFunctions.has(functionName),
    `No confirmed transaction covers ${functionName}`,
  );
}

// Verify the sender, destination, calldata selector, ETH value, receipt, and logs
// for every declared state-changing transaction.
for (const transaction of transactions) {
  const [receipt, chainTransaction] = await Promise.all([
    rpc('eth_getTransactionReceipt', [transaction.hash]),
    rpc('eth_getTransactionByHash', [transaction.hash]),
  ]);
  requireValue(
    receipt?.status === '0x1',
    `${transaction.label} did not succeed`,
  );
  requireValue(
    receipt.to?.toLowerCase() === contractAddress,
    `${transaction.label} used another contract`,
  );
  requireValue(
    chainTransaction.from?.toLowerCase() ===
      manifest.actors[transaction.actor].toLowerCase(),
    `${transaction.label} used the wrong actor`,
  );
  requireValue(
    chainTransaction.input?.slice(0, 10).toLowerCase() ===
      functionSelectors[transaction.function],
    `${transaction.label} called the wrong function`,
  );
  requireValue(
    decodeUint(chainTransaction.value) === BigInt(transaction.valueWei || 0),
    `${transaction.label} sent the wrong ETH value`,
  );
  for (const eventName of transaction.expectedEvents) {
    requireValue(
      receipt.logs.some(
        (log) =>
          log.address.toLowerCase() === contractAddress &&
          log.topics[0]?.toLowerCase() === eventTopics[eventName],
      ),
      `${transaction.label} is missing ${eventName}`,
    );
  }
  console.log(`PASS  ${transaction.function}  ${transaction.hash}`);
}

// Verify the permanent listing fields stored by createListing.
for (const listing of manifest.listings) {
  const result = await rpc('eth_call', [
    {
      to: contractAddress,
      data: `${readSelectors.getListing}${encodeUint(listing.id)}`,
    },
    'latest',
  ]);
  const listingWords = words(result);
  requireValue(
    decodeAddress(listingWords[0]) === manifest.actors.operator.toLowerCase(),
    `Listing ${listing.id} seller mismatch`,
  );
  requireValue(
    decodeAddress(listingWords[1]) === manifest.actors.evaluator.toLowerCase(),
    `Listing ${listing.id} evaluator mismatch`,
  );
  requireValue(
    `0x${listingWords[2]}` === listing.artifactCommitment,
    `Listing ${listing.id} commitment mismatch`,
  );
  requireValue(
    `0x${listingWords[3]}` === listing.termsHash,
    `Listing ${listing.id} terms mismatch`,
  );
  requireValue(
    decodeUint(`0x${listingWords[4]}`) === BigInt(listing.priceWei),
    `Listing ${listing.id} price mismatch`,
  );
  requireValue(
    decodeUint(`0x${listingWords[5]}`) === BigInt(listing.expiresAt),
    `Listing ${listing.id} expiry mismatch`,
  );
}

// Verify that every demonstrated order reached its expected terminal state.
for (const flow of manifest.flows) {
  const result = await rpc('eth_call', [
    {
      to: contractAddress,
      data: `${readSelectors.getOrder}${encodeUint(flow.orderId)}`,
    },
    'latest',
  ]);
  const orderWords = words(result);
  const state = Number(decodeUint(`0x${orderWords[11]}`));
  requireValue(
    state === orderStates[flow.finalState],
    `Order ${flow.orderId} state mismatch: ${state}`,
  );
}

// After all pull payments, the contract must owe neither actor any money.
const liabilities = decodeUint(
  await rpc('eth_call', [
    { to: contractAddress, data: readSelectors.totalLiabilities },
    'latest',
  ]),
);
requireValue(liabilities === 0n, `Outstanding liabilities: ${liabilities}`);
for (const actorName of ['operator', 'buyer']) {
  const credit = decodeUint(
    await rpc('eth_call', [
      {
        to: contractAddress,
        data: `${readSelectors.credits}${encodeAddress(manifest.actors[actorName])}`,
      },
      'latest',
    ]),
  );
  requireValue(credit === 0n, `${actorName} has unwithdrawn credit: ${credit}`);
}

console.log(
  `PASS  ${manifest.requiredFunctions.length}/${manifest.requiredFunctions.length} write functions, ${transactions.length} transactions, ${manifest.listings.length} listings, and ${manifest.flows.length} terminal orders verified on Base Sepolia (${chainId}).`,
);
