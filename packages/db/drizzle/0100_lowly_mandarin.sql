CREATE TABLE IF NOT EXISTS `notification_subscriptions` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `notification_subscriptions_endpoint_idx` ON `notification_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_subscriptions_active_idx` ON `notification_subscriptions` (`disabled_at`) WHERE "notification_subscriptions"."disabled_at" IS NULL;
