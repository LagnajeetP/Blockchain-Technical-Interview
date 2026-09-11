const baseUrl = process.env.EVALVAULT_BASE_URL || 'http://localhost:3000';

async function json(response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

const catalogResponse = await fetch(`${baseUrl}/api/catalog`);
const catalogText = await catalogResponse.text();
if (!catalogResponse.ok)
  throw new Error(`${catalogResponse.status} ${catalogText}`);
const catalog = JSON.parse(catalogText);
for (const forbidden of [
  'objectKey',
  'fixtureKind',
  'evaluationSeed',
  'accuracy',
  'latencyMs',
  'cases',
  'protocolDrillListingId',
]) {
  if (catalogText.includes(forbidden))
    throw new Error(`catalog leaked private field: ${forbidden}`);
}

const summaries = [];
for (const scenario of ['success', 'refund']) {
  const created = await json(
    await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'quality', scenario }),
    }),
  );
  if (!created.token) throw new Error('run capability token missing');
  if (JSON.stringify(created.run).includes('evaluationSeed'))
    throw new Error('report revealed before delivery');

  const unauthorized = await fetch(`${baseUrl}/api/runs/${created.run.id}`);
  if (unauthorized.status !== 404)
    throw new Error(`unauthorized read returned ${unauthorized.status}`);

  let state = created;
  for (
    let attempt = 0;
    attempt < 30 && !['complete', 'failed'].includes(state.run.stage);
    attempt += 1
  ) {
    const response = await fetch(
      `${baseUrl}/api/runs/${created.run.id}/advance`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${created.token}` },
      },
    );
    if (response.status === 202 || response.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    state = await json(response);
  }

  const resumed = await json(
    await fetch(`${baseUrl}/api/runs/${created.run.id}`, {
      headers: { Authorization: `Bearer ${created.token}` },
    }),
  );
  if (resumed.run.stage !== 'complete')
    throw new Error(`${scenario} run did not finish`);
  if (scenario === 'success') {
    if (resumed.run.selectedCandidateId !== 'contextual-rules')
      throw new Error('evidence did not change the route');
    if (!resumed.run.result?.validation?.valid || !resumed.run.result?.report)
      throw new Error('valid paid report missing');
  } else {
    if (resumed.run.status !== 'refunded')
      throw new Error('invalid artifact was not refunded');
    if (resumed.run.result?.report)
      throw new Error('refund path exposed private evidence');
  }
  summaries.push({
    scenario,
    mode: resumed.run.chainMode,
    status: resumed.run.status,
    transactions: resumed.run.txHashes.length,
    elapsedMs: resumed.run.trace.at(-1)?.elapsedMs,
  });
}

// Interactive market flow: the client chooses a listing, then advances it one
// protocol stage at a time. Keep this separate from the guided demo coverage
// above so both public entry points remain exercised.
const now = Date.now();
const owned = new Set(catalog.ownedListingIds || []);
const eligible = catalog.listings.find(
  (listing) =>
    listing.status === 'active' &&
    !owned.has(listing.id) &&
    listing.sampleCount >= 24 &&
    now - listing.observedAt <= 24 * 60 * 60 * 1000,
);
if (!eligible) throw new Error('no eligible listing available for manual flow');

const manualCreated = await json(
  await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: 'quality',
      scenario: 'market',
      listingId: eligible.id,
    }),
  }),
);
if (manualCreated.run.result?.selectionMode !== 'manual')
  throw new Error('manual flow did not record selectionMode manual');
if (manualCreated.run.stage !== 'selected')
  throw new Error(
    `manual flow started at ${manualCreated.run.stage}, expected selected`,
  );

const firstAdvance = await json(
  await fetch(`${baseUrl}/api/runs/${manualCreated.run.id}/advance`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${manualCreated.token}` },
  }),
);
if (firstAdvance.run.stage !== 'funded')
  throw new Error(
    `manual first advance reached ${firstAdvance.run.stage}, expected funded`,
  );

const manualResumed = await json(
  await fetch(`${baseUrl}/api/runs/${manualCreated.run.id}`, {
    headers: { Authorization: `Bearer ${manualCreated.token}` },
  }),
);
if (manualResumed.run.stage !== 'funded')
  throw new Error('manual flow did not resume at its persisted funded stage');

let manualState = manualResumed;
for (
  let attempt = 0;
  attempt < 30 && !['complete', 'failed'].includes(manualState.run.stage);
  attempt += 1
) {
  const response = await fetch(
    `${baseUrl}/api/runs/${manualCreated.run.id}/advance`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${manualCreated.token}` },
    },
  );
  if (response.status === 202 || response.status === 409) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  manualState = await json(response);
}
if (manualState.run.stage !== 'complete')
  throw new Error(
    `manual flow did not reach terminal stage: ${manualState.run.stage}`,
  );

const stale = catalog.listings.find(
  (listing) => now - listing.observedAt > 24 * 60 * 60 * 1000,
);
if (!stale) throw new Error('catalog has no stale listing for rejection check');
const staleResponse = await fetch(`${baseUrl}/api/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    goal: 'quality',
    scenario: 'market',
    listingId: stale.id,
  }),
});
if (staleResponse.ok) throw new Error('stale manual selection was accepted');
const staleBody = await staleResponse.json();
if (!/stale/i.test(staleBody.error || ''))
  throw new Error(
    `stale rejection omitted stale reason: ${JSON.stringify(staleBody)}`,
  );

summaries.push({
  scenario: 'market',
  mode: manualState.run.chainMode,
  status: manualState.run.status,
  selectionMode: manualState.run.result?.selectionMode,
  selectedListingId: manualState.run.selectedListingId,
  transactions: manualState.run.txHashes.length,
  elapsedMs: manualState.run.trace.at(-1)?.elapsedMs,
});

console.log(JSON.stringify(summaries, null, 2));
