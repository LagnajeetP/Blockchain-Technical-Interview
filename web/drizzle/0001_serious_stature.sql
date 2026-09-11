CREATE TABLE `live_run_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`action` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`signed_transaction` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
