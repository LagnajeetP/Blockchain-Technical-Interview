'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { formatEther } from 'viem';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Goal } from '@/lib/evidence';
import type {
  PublicListingRecord,
  PublicRun,
  Scenario,
} from '@/lib/server/types';

type ChainInfo = {
  mode: 'simulation' | 'live';
  environment: 'simulation' | 'local' | 'testnet';
  chainId: number;
  chainName: string;
  contractAddress: string | null;
  explorerUrl: string | null;
  transactionExplorerUrl: string | null;
};

type CatalogPayload = {
  listings: PublicListingRecord[];
  ownedListingIds: string[];
  protocolDrillListingId: string;
  sellerAgent: {
    agentId: string;
    action: 'publish' | 'refresh' | 'hold';
    candidateId: string;
    priceWei: string;
    reason: string;
    nextReviewAt: number;
    policy: string;
  };
  marketTerms: {
    access: string;
    redistribution: string;
    delivery: string;
    buyerProtection: string;
    verification: string;
  };
  chain: ChainInfo;
  disclosure: string;
};

type RunPayload = { run: PublicRun; chain: ChainInfo; token?: string };

type WebMcpContext = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: object;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

const goalCopy: Record<Goal, { label: string; floor: string; order: string }> =
  {
    speed: { label: 'Speed', floor: '80%', order: 'lowest observed p50' },
    balanced: { label: 'Balanced', floor: '85%', order: 'cost, then recency' },
    quality: {
      label: 'Quality',
      floor: '90%',
      order: 'highest verified accuracy',
    },
  };

const stageNumber: Record<string, number> = {
  selected: 1,
  funded: 2,
  delivered: 3,
  revealed: 4,
  verified: 5,
  accepted: 6,
  refunded: 6,
  complete: 7,
  failed: 7,
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const BASELINE_ACCURACY = 0.75;

const checkLabels: Record<string, string> = {
  integrity: 'Exact bytes',
  provenance: 'Provenance',
  terms: 'Purchase terms',
  recomputed: 'Recomputed result',
};

function elapsedLabel(milliseconds: number) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(2)} s`;
}

function latencyLabel(milliseconds: number) {
  if (milliseconds < 0.001) return '<0.001 ms';
  return `${milliseconds.toFixed(3)} ms`;
}

function ageLabel(timestamp: number, referenceTime: number) {
  const minutes = Math.max(1, Math.round((referenceTime - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function shortHash(value?: string) {
  if (!value) return 'unbound';
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function validateToolInput(value: unknown): { goal: Goal; scenario: Scenario } {
  const input = value as { goal?: unknown; scenario?: unknown };
  if (
    !input ||
    !['speed', 'balanced', 'quality'].includes(String(input.goal))
  ) {
    throw new Error('goal must be speed, balanced, or quality');
  }
  if (!['success', 'refund'].includes(String(input.scenario))) {
    throw new Error('scenario must be success or refund');
  }
  return { goal: input.goal as Goal, scenario: input.scenario as Scenario };
}

export default function Home() {
  const [goal, setGoal] = useState<Goal>('quality');
  const [scenario, setScenario] = useState<Scenario>('success');
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [run, setRun] = useState<PublicRun | null>(null);
  const [runToken, setRunToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceTime] = useState(() => Date.now());
  const resultRef = useRef<HTMLElement | null>(null);

  const refreshCatalog = useCallback(async () => {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    const payload = (await response.json()) as CatalogPayload & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(payload.error || 'Evidence catalog is unavailable');
    setCatalog(payload);
    return payload;
  }, []);

  useEffect(() => {
    const catalogTimer = window.setTimeout(() => {
      void refreshCatalog().catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : 'Evidence catalog is unavailable',
        ),
      );
    }, 0);

    const saved = sessionStorage.getItem('evalvault-active-run');
    if (!saved) return () => window.clearTimeout(catalogTimer);
    try {
      const value = JSON.parse(saved) as { id: string; token: string };
      void fetch(`/api/runs/${value.id}`, {
        headers: { Authorization: `Bearer ${value.token}` },
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Saved run expired');
          return (await response.json()) as RunPayload;
        })
        .then((payload) => {
          setRun(payload.run);
          setRunToken(value.token);
          setGoal(payload.run.goal);
          setScenario(payload.run.scenario);
        })
        .catch(() => sessionStorage.removeItem('evalvault-active-run'));
    } catch {
      sessionStorage.removeItem('evalvault-active-run');
    }
    return () => window.clearTimeout(catalogTimer);
  }, [refreshCatalog]);

  const progressRun = useCallback(
    async (initial: RunPayload, token: string) => {
      let payload = initial;
      if (payload.chain.mode === 'simulation') await sleep(450);
      for (let attempts = 0; attempts < 24; attempts += 1) {
        if (['complete', 'failed'].includes(payload.run.stage)) break;
        const response = await fetch(`/api/runs/${payload.run.id}/advance`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const next = (await response.json()) as RunPayload & {
          error?: string;
          retryable?: boolean;
        };
        if (
          response.status === 202 ||
          (response.status === 409 && next.retryable)
        ) {
          await sleep(response.status === 202 ? 2_500 : 500);
          continue;
        }
        if (!response.ok)
          throw new Error(next.error || 'Buyer run could not advance');
        payload = next;
        setRun(payload.run);
        if (
          payload.chain.mode === 'simulation' &&
          !['complete', 'failed'].includes(payload.run.stage)
        ) {
          await sleep(520);
        }
      }
      if (!['complete', 'failed'].includes(payload.run.stage)) {
        throw new Error(
          'Run paused while waiting for chain confirmation. Use Resume to reconcile it.',
        );
      }
      return payload;
    },
    [],
  );

  const executeRun = useCallback(
    async (selectedGoal: Goal, selectedScenario: Scenario) => {
      setBusy(true);
      setError(null);
      setGoal(selectedGoal);
      setScenario(selectedScenario);
      try {
        const response = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: selectedGoal,
            scenario: selectedScenario,
          }),
        });
        const created = (await response.json()) as RunPayload & {
          token?: string;
          error?: string;
        };
        if (!response.ok || !created.token)
          throw new Error(created.error || 'Buyer run could not start');
        setRun(created.run);
        setRunToken(created.token);
        sessionStorage.setItem(
          'evalvault-active-run',
          JSON.stringify({ id: created.run.id, token: created.token }),
        );
        const finished = await progressRun(created, created.token);
        return {
          runId: finished.run.id,
          status: finished.run.status,
          chainMode: finished.run.chainMode,
          selectedCandidate: finished.run.selectedCandidateId,
          decision: finished.run.result?.afterDecision,
          transactionHashes: finished.run.txHashes,
        };
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : 'Buyer run failed';
        setError(message);
        throw reason;
      } finally {
        setBusy(false);
      }
    },
    [progressRun],
  );

  const resumeRun = useCallback(async () => {
    if (!run || !runToken) return;
    setBusy(true);
    setError(null);
    try {
      await progressRun(
        {
          run,
          chain: catalog?.chain ?? {
            mode: run.chainMode,
            environment: run.chainMode === 'live' ? 'local' : 'simulation',
            chainId: 84532,
            chainName:
              run.chainMode === 'live'
                ? 'Configured live chain'
                : 'Simulation ledger',
            contractAddress: null,
            explorerUrl: null,
            transactionExplorerUrl: null,
          },
        },
        runToken,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Run could not resume',
      );
    } finally {
      setBusy(false);
    }
  }, [catalog, progressRun, run, runToken]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'run_evidence_purchase_demo',
          title: 'Run evidence purchase demo',
          description:
            'Run the visible EvalVault buyer journey. It purchases test evidence when live mode is enabled, or records an explicit simulation otherwise.',
          inputSchema: {
            type: 'object',
            properties: {
              goal: { type: 'string', enum: ['speed', 'balanced', 'quality'] },
              scenario: { type: 'string', enum: ['success', 'refund'] },
            },
            required: ['goal', 'scenario'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const values = validateToolInput(input);
            return executeRun(values.goal, values.scenario);
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch((reason) =>
      setError(
        reason instanceof Error
          ? `WebMCP registration: ${reason.message}`
          : 'WebMCP registration failed',
      ),
    );
    return () => lifecycle.abort();
  }, [executeRun]);

  useEffect(() => {
    if (!run || !['complete', 'failed'].includes(run.stage)) return;
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [run]);

  const totalElapsed = run?.trace.at(-1)?.elapsedMs ?? 0;
  const currentStep = run ? (stageNumber[run.stage] ?? 0) : 0;
  const validation = run?.result?.validation;
  const report = run?.result?.report;
  const chain = catalog?.chain;
  const terminal = run?.stage === 'complete' || run?.stage === 'failed';
  const isSimulation = chain?.mode !== 'live';
  const accuracyLift = report
    ? report.metrics.accuracy - BASELINE_ACCURACY
    : null;
  const statusLine = (() => {
    if (!run) return 'Ready · choose a path and run the buyer';
    if (!terminal) return `Running · ${run.trace.at(-1)?.label ?? 'starting'}`;
    if (run.status === 'refunded')
      return 'Complete · evidence rejected · funds returned';
    if (run.status === 'failed') return 'Stopped · run needs attention';
    return `Complete · 1 dossier purchased · ${report?.sampleCount ?? 0}/${report?.sampleCount ?? 0} cases verified`;
  })();

  const listingStates = (() => {
    if (!catalog) return new Map<string, string>();
    return new Map(
      catalog.listings.map((listing) => {
        let decision = 'Eligible';
        if (catalog.ownedListingIds.includes(listing.id))
          decision = 'Not selected · already owned';
        else if (referenceTime - listing.observedAt > 24 * 60 * 60_000)
          decision = 'Not selected · stale';
        else if (listing.sampleCount < 24)
          decision = 'Not selected · insufficient coverage';
        else if (run?.selectedListingId === listing.id)
          decision = 'Selected by buyer';
        else if (listing.id === catalog.protocolDrillListingId)
          decision = 'Buyer-protection scenario';
        return [listing.id, decision];
      }),
    );
  })();
  const displayedListings = catalog
    ? [...catalog.listings].sort((left, right) => {
        const priority = (listing: PublicListingRecord) => {
          if (run?.selectedListingId === listing.id) return 0;
          if (
            scenario === 'refund' &&
            listing.id === catalog.protocolDrillListingId
          )
            return 0;
          if (listing.id === catalog.protocolDrillListingId) return 4;
          if (catalog.ownedListingIds.includes(listing.id)) return 3;
          if (referenceTime - listing.observedAt > 24 * 60 * 60_000) return 2;
          return 1;
        };
        return priority(left) - priority(right);
      })
    : null;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="EvalVault home">
          <span className="brand-mark">E</span>
          <span>EvalVault</span>
        </a>
        <div className="network">
          <span
            className={`network-dot ${chain?.mode === 'live' ? 'live' : ''}`}
          />
          {chain?.chainName ?? 'Base Sepolia'}
          <span className="muted"> / {chain?.mode ?? 'loading'}</span>
        </div>
        <Badge variant="outline" className="operator-badge">
          {isSimulation ? 'No wallet required' : 'Constrained signer'}
        </Badge>
      </header>

      <div id="top" className="workbench">
        <aside className="policy-panel">
          <div className="eyebrow">Buyer simulation</div>
          <h1>Buy evidence before choosing a model.</h1>
          <p className="lede">
            Choose a goal, fund sealed evidence, verify the result, and make a
            routing decision.
          </p>

          <fieldset className="control-field" disabled={busy}>
            <legend>Optimization goal</legend>
            <div className="goal-grid">
              {(Object.keys(goalCopy) as Goal[]).map((item) => (
                <label
                  key={item}
                  htmlFor={`goal-${item}`}
                  aria-label={`${goalCopy[item].label}, ${goalCopy[item].floor} floor`}
                  className={`goal-option ${goal === item ? 'selected' : ''}`}
                >
                  <input
                    id={`goal-${item}`}
                    type="radio"
                    name="optimization-goal"
                    value={item}
                    checked={goal === item}
                    onChange={() => setGoal(item)}
                  />
                  <span>
                    <strong>{goalCopy[item].label}</strong>
                    <small>{goalCopy[item].floor} floor</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="control-field scenario-field" disabled={busy}>
            <legend>Outcome to demonstrate</legend>
            <div className="scenario-toggle">
              <button
                type="button"
                aria-pressed={scenario === 'success'}
                onClick={() => setScenario('success')}
              >
                Successful delivery
              </button>
              <button
                type="button"
                aria-pressed={scenario === 'refund'}
                onClick={() => setScenario('refund')}
              >
                Invalid evidence → refund
              </button>
            </div>
            <p className="scenario-preview">
              {scenario === 'success'
                ? 'The buyer purchases a valid dossier, recomputes it, and changes its route.'
                : 'The evaluator rejects invalid evidence; the buyer is refunded before reveal.'}
            </p>
          </fieldset>

          {run && !terminal ? (
            <Button
              size="lg"
              className="run-button"
              onClick={resumeRun}
              disabled={busy}
            >
              {busy ? (
                <>
                  <RefreshCw className="spin" />
                  {isSimulation ? 'Simulating' : 'Reconciling'}
                </>
              ) : (
                <>
                  Resume run <ArrowRight />
                </>
              )}
            </Button>
          ) : (
            <Button
              size="lg"
              className="run-button"
              onClick={() =>
                void executeRun(goal, scenario).catch(() => undefined)
              }
              disabled={busy || !catalog}
            >
              {busy ? (
                <>
                  <RefreshCw className="spin" /> Simulating
                </>
              ) : (
                <>
                  {terminal ? 'Replay simulation' : 'Run simulation'}{' '}
                  <ArrowRight />
                </>
              )}
            </Button>
          )}

          <div className="mode-note">
            <strong>
              {isSimulation ? 'Simulation mode' : 'Live testnet mode'}
            </strong>
            <span>
              {isSimulation
                ? 'No wallet or funds needed. Uses the real buyer policy and escrow state machine.'
                : 'Transactions settle through the configured Base Sepolia contract.'}
            </span>
          </div>

          <dl className="mandate-grid">
            <div>
              <dt>Accuracy floor</dt>
              <dd>{goalCopy[goal].floor}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{goalCopy[goal].order}</dd>
            </div>
            <div>
              <dt>Max age</dt>
              <dd>24 hours</dd>
            </div>
            <div>
              <dt>Spend cap</dt>
              <dd>0.000002 ETH</dd>
            </div>
          </dl>

          <p className="baseline-note">
            Owned baseline <strong>fast-keyword · 75.0%</strong>
          </p>
          <details className="guardrail">
            <summary>
              <ShieldCheck /> Technical guardrails
            </summary>
            <p>
              The server enforces chain, contract, method, exact value,
              freshness, and spend limits.
            </p>
          </details>
          {error && (
            <div className="error-callout" role="alert">
              <CircleAlert /> {error}
            </div>
          )}
        </aside>

        <section className="market-panel" aria-label="Evidence catalogue">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Evidence catalogue</span>
              <h2>Comparable sealed dossiers</h2>
            </div>
            <span className="count">
              {catalog?.listings.length ?? '—'} listings
            </span>
          </div>
          <p className="market-note">
            Scope, freshness, provenance, price, and commitments are public.
            Scores and case data remain private until approved delivery.
          </p>

          <div className="commodity-terms" aria-label="Evidence purchase terms">
            <div>
              <span>Access</span>
              <strong>{catalog?.marketTerms.access ?? 'Loading terms'}</strong>
            </div>
            <div>
              <span>Settlement</span>
              <strong>Native ETH escrow</strong>
            </div>
            <div>
              <span>Delivery</span>
              <strong>
                {catalog?.marketTerms.delivery ?? 'Loading terms'}
              </strong>
            </div>
            <div>
              <span>Buyer protection</span>
              <strong>
                {catalog?.marketTerms.buyerProtection ?? 'Loading terms'}
              </strong>
            </div>
          </div>

          {catalog?.sellerAgent && (
            <details className="seller-note">
              <summary>
                Seller publication policy · {catalog.sellerAgent.action}
              </summary>
              <p>
                {catalog.sellerAgent.reason}. {catalog.sellerAgent.policy}.
              </p>
            </details>
          )}
          <div className="listings">
            {displayedListings?.map((listing) => {
              const selected = run?.selectedListingId === listing.id;
              const unavailable = listingStates
                .get(listing.id)
                ?.startsWith('Not selected');
              return (
                <Card
                  key={listing.id}
                  className={`listing ${selected ? 'recommended' : ''} ${unavailable ? 'rejected' : ''}`}
                >
                  <CardHeader>
                    <div className="listing-id">
                      {listing.suiteVersion} · {listing.provenance}
                      {selected && <Badge>selected</Badge>}
                    </div>
                    <CardTitle>{listing.title}</CardTitle>
                    <p>{listing.summary}</p>
                  </CardHeader>
                  <CardContent>
                    <dl className="facts">
                      <div>
                        <dt>Evidence</dt>
                        <dd>Routing accuracy</dd>
                      </div>
                      <div>
                        <dt>Coverage</dt>
                        <dd>{listing.sampleCount} tickets</dd>
                      </div>
                      <div>
                        <dt>Freshness</dt>
                        <dd>{ageLabel(listing.observedAt, referenceTime)}</dd>
                      </div>
                      <div>
                        <dt>Price</dt>
                        <dd>{formatEther(BigInt(listing.priceWei))} ETH</dd>
                      </div>
                    </dl>
                    <details className="commitment">
                      <summary>
                        <LockKeyhole /> Commitments recorded
                      </summary>
                      <code>
                        Artifact {shortHash(listing.commitment)} · terms{' '}
                        {shortHash(listing.termsHash)}
                      </code>
                    </details>
                    <div className="listing-foot">
                      <span
                        className={`decision ${unavailable ? 'stale' : ''}`}
                      >
                        {listingStates.get(listing.id)}
                      </span>
                      <span className="sealed">Private until delivery</span>
                    </div>
                  </CardContent>
                </Card>
              );
            }) ?? <div className="loading-card">Loading sealed catalog…</div>}
          </div>
        </section>

        <aside className="trace-panel">
          <div className="trace-head">
            <span className="eyebrow">Run trace</span>
            {run && <span>{elapsedLabel(totalElapsed)}</span>}
          </div>
          <h2>{run ? run.trace.at(-1)?.label : 'Ready to run'}</h2>
          <output className="run-status">{statusLine}</output>
          <progress
            className="progress-rail"
            aria-label="Buyer simulation progress"
            max={7}
            value={currentStep}
          />
          <div className="trace-list">
            {run ? (
              run.trace.map((entry, index) => (
                <div
                  className={`trace-line ${index === run.trace.length - 1 && !terminal ? 'active' : 'complete'}`}
                  key={`${entry.at}-${index}`}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="trace-label">
                      <strong>{entry.label}</strong>
                      <b>
                        {index === run.trace.length - 1 && !terminal
                          ? 'Current'
                          : 'Done'}
                      </b>
                    </div>
                    <small>{entry.detail}</small>
                    <em>{elapsedLabel(entry.elapsedMs)}</em>
                    {entry.txHash && chain?.transactionExplorerUrl ? (
                      <a
                        href={`${chain.transactionExplorerUrl}${entry.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortHash(entry.txHash)} <ExternalLink />
                      </a>
                    ) : entry.txHash ? (
                      <code>{shortHash(entry.txHash)}</code>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <>
                <div className="trace-line active">
                  <span>01</span>
                  <div>
                    <div className="trace-label">
                      <strong>Detect evidence gap</strong>
                      <b>Ready</b>
                    </div>
                    <small>
                      Owned baseline is below the selected quality floor.
                    </small>
                  </div>
                </div>
                <div className="trace-line">
                  <span>02</span>
                  <div>
                    <div className="trace-label">
                      <strong>Rank public claims</strong>
                      <b>Queued</b>
                    </div>
                    <small>Scope · freshness · price · provenance.</small>
                  </div>
                </div>
                <div className="trace-line">
                  <span>03</span>
                  <div>
                    <div className="trace-label">
                      <strong>Fund escrow</strong>
                      <b>Queued</b>
                    </div>
                    <small>
                      Reserve the exact listing price under purchase terms.
                    </small>
                  </div>
                </div>
                <div className="trace-line">
                  <span>04</span>
                  <div>
                    <div className="trace-label">
                      <strong>Verify and decide</strong>
                      <b>Queued</b>
                    </div>
                    <small>Recompute the report, then settle or refund.</small>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="truth-boundary">
            <span>What the receipt proves</span>
            <p>
              Commitments prove the delivered bytes and recomputation proves
              internal consistency. The evaluator is still trusted to construct
              the private test set fairly.
            </p>
          </div>
        </aside>
      </div>

      {run && (
        <section
          ref={resultRef}
          className="evidence-console"
          aria-label="Purchased evidence result"
        >
          <div className="result-header">
            <div>
              <span className="eyebrow">Decision receipt</span>
              <h2>
                {!terminal
                  ? 'Buyer simulation in progress'
                  : run.scenario === 'refund'
                    ? 'Evidence failed verification; funds returned'
                    : `The buyer switched to ${run.selectedCandidateId ?? 'the verified model'}`}
              </h2>
            </div>
            <div className="receipt-meta">
              <Badge
                variant={run.status === 'failed' ? 'destructive' : 'outline'}
              >
                {run.status}
              </Badge>
              <span>{run.chainMode}</span>
              <span>{run.txHashes.length} tx</span>
              <span>{elapsedLabel(totalElapsed)}</span>
            </div>
          </div>

          <div className="decision-shift">
            <div>
              <span>Before purchase</span>
              <p>{run.result?.beforeDecision}</p>
            </div>
            <ArrowRight />
            <div
              className={
                run.scenario === 'refund' ? 'refund-result' : 'after-result'
              }
            >
              <span>After verification</span>
              <p>{run.result?.afterDecision}</p>
            </div>
          </div>

          {terminal && (
            <div className="value-summary">
              <div>
                <span>Evidence gap</span>
                <p>
                  Owned evidence measured 75.0%, below the{' '}
                  {goalCopy[run.goal].floor}{' '}
                  {goalCopy[run.goal].label.toLowerCase()} floor.
                </p>
              </div>
              <div>
                <span>Known before payment</span>
                <p>Coverage, freshness, provenance, price, and commitments.</p>
              </div>
              <div>
                <span>Private commodity</span>
                <p>
                  {report
                    ? `${report.sampleCount} inputs, outputs, labels, and timings unlocked after approval.`
                    : 'The report remained sealed because private validation failed.'}
                </p>
              </div>
              <div>
                <span>Buyer value</span>
                <p>
                  {report
                    ? `The new evidence changed the route to ${run.selectedCandidateId}.`
                    : 'Buyer protection returned the payment without revealing the cases.'}
                </p>
              </div>
            </div>
          )}

          {validation && (
            <div className="check-grid">
              {Object.entries(validation.checks).map(([label, passed]) => (
                <div className={passed ? 'pass' : 'fail'} key={label}>
                  {passed ? <Check /> : <CircleAlert />}
                  <span>{checkLabels[label] ?? label}</span>
                  <strong>{passed ? 'pass' : 'fail'}</strong>
                </div>
              ))}
            </div>
          )}

          {report ? (
            <div className="report-grid">
              <div className="comparison-card">
                <div className="comparison-head">
                  <div>
                    <span>Decision comparison</span>
                    <strong>
                      +{((accuracyLift ?? 0) * 100).toFixed(1)} percentage
                      points
                    </strong>
                  </div>
                  <small>Same {report.sampleCount}-case routing suite</small>
                </div>
                <div className="comparison-row">
                  <span>Owned baseline</span>
                  <div>
                    <i style={{ width: `${BASELINE_ACCURACY * 100}%` }} />
                  </div>
                  <strong>{(BASELINE_ACCURACY * 100).toFixed(1)}%</strong>
                </div>
                <div className="comparison-row purchased">
                  <span>Purchased evidence</span>
                  <div>
                    <i style={{ width: `${report.metrics.accuracy * 100}%` }} />
                  </div>
                  <strong>{(report.metrics.accuracy * 100).toFixed(1)}%</strong>
                </div>
              </div>
              <div className="metric-card">
                <span>Verified accuracy</span>
                <strong>{(report.metrics.accuracy * 100).toFixed(1)}%</strong>
                <small>
                  {report.cases.filter((item) => item.correct).length}/
                  {report.sampleCount} exact route + urgency matches
                </small>
              </div>
              <div className="metric-card">
                <span>Measured p50</span>
                <strong>{latencyLabel(report.metrics.p50Ms)}</strong>
                <small>
                  Local synchronous CPU timing; exploratory, not hosted-model
                  latency
                </small>
              </div>
              <div className="metric-card">
                <span>Measured p95</span>
                <strong>{latencyLabel(report.metrics.p95Ms)}</strong>
                <small>
                  Recomputed from the delivered per-case observations
                </small>
              </div>
              <div className="case-table">
                <div className="case-title">
                  <span>Revealed sample</span>
                  <small>3 of {report.sampleCount} purchased cases</small>
                </div>
                {report.cases.slice(0, 3).map((item) => (
                  <div className="case-row" key={item.id}>
                    <span>{item.input.subject}</span>
                    <code>
                      {item.expected.queue}/{item.expected.urgency}
                    </code>
                    <strong>
                      <Check /> match
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : validation && !validation.valid ? (
            <div className="refund-proof">
              <Undo2 />
              <div>
                <strong>Refund rule fired</strong>
                <p>{validation.errors.slice(0, 3).join(' · ')}</p>
                <small>
                  The buyer received no private cases. Correctly reported poor
                  performance would still be payable.
                </small>
              </div>
            </div>
          ) : null}
        </section>
      )}

      <footer>
        <div>
          <LockKeyhole /> Private reports stay off-chain. Commitments and
          settlement state are public.
        </div>
        <nav>
          {chain?.explorerUrl && (
            <a href={chain.explorerUrl} target="_blank" rel="noreferrer">
              Contract <ExternalLink />
            </a>
          )}
          <a
            href="https://github.com/LagnajeetP/Blockchain-Technical-Interview"
            target="_blank"
            rel="noreferrer"
          >
            Source <ExternalLink />
          </a>
        </nav>
      </footer>
    </main>
  );
}
