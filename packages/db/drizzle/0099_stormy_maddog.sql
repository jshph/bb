CREATE TABLE IF NOT EXISTS `notification_events` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `notification_events_id_idx` ON `notification_events` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_events_idempotency_idx` ON `notification_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_events_cursor_idx` ON `notification_events` (`sequence`);
