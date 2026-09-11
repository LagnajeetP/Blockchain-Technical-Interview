const baseUrl = process.env.EVALVAULT_BASE_URL || 'http://localhost:3000';

async function json(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

const catalogResponse = await fetch(`${baseUrl}/api/catalog`);
const catalogText = await catalogResponse.text();
if (!catalogResponse.ok) throw new Error(`${catalogResponse.status} ${catalogText}`);
for (const forbidden of ['objectKey', 'fixtureKind', 'evaluationSeed', 'accuracy', 'latencyMs', 'cases']) {
  if (catalogText.includes(forbidden)) throw new Error(`catalog leaked private field: ${forbidden}`);
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
  if (JSON.stringify(created.run).includes('evaluationSeed')) throw new Error('report revealed before delivery');

  const unauthorized = await fetch(`${baseUrl}/api/runs/${created.run.id}`);
  if (unauthorized.status !== 404) throw new Error(`unauthorized read returned ${unauthorized.status}`);

  let state = created;
  for (let attempt = 0; attempt < 30 && !['complete', 'failed'].includes(state.run.stage); attempt += 1) {
    const response = await fetch(`${baseUrl}/api/runs/${created.run.id}/advance`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}` },
    });
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
  if (resumed.run.stage !== 'complete') throw new Error(`${scenario} run did not finish`);
  if (scenario === 'success') {
    if (resumed.run.selectedCandidateId !== 'contextual-rules') throw new Error('evidence did not change the route');
    if (!resumed.run.result?.validation?.valid || !resumed.run.result?.report) throw new Error('valid paid report missing');
  } else {
    if (resumed.run.status !== 'refunded') throw new Error('invalid artifact was not refunded');
    if (resumed.run.result?.report) throw new Error('refund path exposed private evidence');
  }
  summaries.push({
    scenario,
    mode: resumed.run.chainMode,
    status: resumed.run.status,
    transactions: resumed.run.txHashes.length,
    elapsedMs: resumed.run.trace.at(-1)?.elapsedMs,
  });
}

console.log(JSON.stringify(summaries, null, 2));
