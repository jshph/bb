CREATE TABLE `notification_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`event_type` text NOT NULL,
	`project_id` text NOT NULL,
	`source_thread_id` text NOT NULL,
	`target_thread_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`should_notify` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_id_idx` ON `notification_events` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_idempotency_idx` ON `notification_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notification_events_cursor_idx` ON `notification_events` (`sequence`);--> statement-breakpoint
CREATE TABLE `notification_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`disabled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_subscriptions_endpoint_idx` ON `notification_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `notification_subscriptions_active_idx` ON `notification_subscriptions` (`disabled_at`) WHERE "notification_subscriptions"."disabled_at" IS NULL;