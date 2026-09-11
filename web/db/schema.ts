import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey(),
  contractListingId: text('contract_listing_id'),
  candidateId: text('candidate_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  priceWei: text('price_wei').notNull(),
  observedAt: integer('observed_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  suiteVersion: text('suite_version').notNull(),
  sampleCount: integer('sample_count').notNull(),
  provenance: text('provenance').notNull(),
  commitment: text('commitment').notNull(),
  termsHash: text('terms_hash').notNull(),
  objectKey: text('object_key').notNull(),
  status: text('status').notNull(),
  fixtureKind: text('fixture_kind').notNull().default('valid'),
  createdAt: integer('created_at').notNull(),
});

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  scenario: text('scenario').notNull(),
  goal: text('goal').notNull(),
  status: text('status').notNull(),
  stage: text('stage').notNull(),
  chainMode: text('chain_mode').notNull(),
  selectedListingId: text('selected_listing_id'),
  selectedCandidateId: text('selected_candidate_id'),
  decisionReason: text('decision_reason'),
  contractOrderId: text('contract_order_id'),
  traceJson: text('trace_json').notNull(),
  txHashesJson: text('tx_hashes_json').notNull(),
  resultJson: text('result_json'),
  error: text('error'),
  lockUntil: integer('lock_until').notNull().default(0),
  lockOwner: text('lock_owner'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const eventReceipts = sqliteTable('event_receipts', {
  id: text('id').primaryKey(),
  chainId: integer('chain_id').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  eventName: text('event_name').notNull(),
  observedAt: integer('observed_at').notNull(),
});

export const transactionIntents = sqliteTable('transaction_intents', {
  id: text('id').primaryKey(),
  scopeId: text('scope_id').notNull(),
  action: text('action').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  signedTransaction: text('signed_transaction'),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const liveRunLeases = sqliteTable('live_run_leases', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  createdAt: integer('created_at').notNull(),
});
