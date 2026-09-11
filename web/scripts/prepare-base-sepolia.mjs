import { randomBytes } from 'node:crypto';
import { access, chmod, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(webDirectory, '..');
const contractEnvironment = resolve(repositoryDirectory, 'contracts/.env');
const webEnvironment = resolve(webDirectory, '.env.base-sepolia.local');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if ((await exists(contractEnvironment)) || (await exists(webEnvironment))) {
  throw new Error(
    'Refusing to overwrite an existing Base Sepolia secret file. Remove both local files only when intentionally rotating every actor.',
  );
}

const operatorKey = generatePrivateKey();
const evaluatorKey = generatePrivateKey();
const buyerKey = generatePrivateKey();

const operator = privateKeyToAccount(operatorKey);
const evaluator = privateKeyToAccount(evaluatorKey);
const buyer = privateKeyToAccount(buyerKey);
const operatorToken = randomBytes(32).toString('hex');
const evaluationSeed = randomBytes(32).toString('hex');

const contractFile = `# Generated locally by npm run prepare:base-sepolia. Never commit or share this file.
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY=
PRIVATE_KEY=${operatorKey}
EVALUATOR_ADDRESS=${evaluator.address}
DELIVERY_WINDOW=120
REVIEW_WINDOW=120
RESOLUTION_WINDOW=300
CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
ARTIFACT_COMMITMENT=0x0000000000000000000000000000000000000000000000000000000000000000
TERMS_HASH=0x0000000000000000000000000000000000000000000000000000000000000000
LISTING_PRICE_WEI=1000000000000
LISTING_EXPIRES_AT=0
`;

const webFile = `# Generated locally by npm run prepare:base-sepolia. Never commit or share this file.
DEMO_CHAIN_MODE=live
PUBLIC_LIVE_RUNS_ENABLED=false
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
EVALVAULT_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
OPERATOR_PRIVATE_KEY=${operatorKey}
EVALUATOR_PRIVATE_KEY=${evaluatorKey}
BUYER_PRIVATE_KEY=${buyerKey}
OPERATOR_TOKEN=${operatorToken}
EVALUATION_SEED=${evaluationSeed}
LIVE_RUN_BUDGET_WEI=2000000000000
EVALVAULT_DEPLOYMENT_BLOCK=0
`;

await writeFile(contractEnvironment, contractFile, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
await writeFile(webEnvironment, webFile, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
await Promise.all([
  chmod(contractEnvironment, 0o600),
  chmod(webEnvironment, 0o600),
]);

console.log(
  JSON.stringify(
    {
      operator: operator.address,
      evaluator: evaluator.address,
      buyer: buyer.address,
      secretFiles: ['contracts/.env', 'web/.env.base-sepolia.local'],
      liveRunsEnabled: false,
    },
    null,
    2,
  ),
);
