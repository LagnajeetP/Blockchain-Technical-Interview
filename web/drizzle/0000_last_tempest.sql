CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`scenario` text NOT NULL,
	`goal` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`chain_mode` text NOT NULL,
	`selected_listing_id` text,
	`selected_candidate_id` text,
	`decision_reason` text,
	`contract_order_id` text,
	`trace_json` text NOT NULL,
	`tx_hashes_json` text NOT NULL,
	`result_json` text,
	`error` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` integer NOT NULL,
	`transaction_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`event_name` text NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_listing_id` text,
	`candidate_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`price_wei` text NOT NULL,
	`observed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`suite_version` text NOT NULL,
	`sample_count` integer NOT NULL,
	`provenance` text NOT NULL,
	`commitment` text NOT NULL,
	`terms_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`status` text NOT NULL,
	`fixture_kind` text DEFAULT 'valid' NOT NULL,
	`created_at` integer NOT NULL
);
