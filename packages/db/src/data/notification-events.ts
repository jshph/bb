import { asc, eq, gt } from "drizzle-orm";
import type { DbConnection, DbQueryConnection, DbTransaction } from "../connection.js";
import { createNotificationEventId } from "../ids.js";
import { notificationEvents } from "../schema.js";

export type NotificationEventType =
  | "thread.needs_input"
  | "thread.completed"
  | "thread.failed";

export type NotificationEventRow = typeof notificationEvents.$inferSelect;

export interface CreateNotificationEventInput {
  body: string;
  eventType: NotificationEventType;
  idempotencyKey: string;
  projectId: string;
  shouldNotify: boolean;
  sourceThreadId: string;
  targetThreadId: string;
  title: string;
}

export interface ListNotificationEventsArgs {
  afterSequence: number;
  limit: number;
}

type NotificationEventWriteConnection = DbConnection | DbTransaction;

export function createNotificationEvent(
  db: NotificationEventWriteConnection,
  input: CreateNotificationEventInput,
): NotificationEventRow {
  const inserted = db
    .insert(notificationEvents)
    .values({
      ...input,
      id: createNotificationEventId(),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: notificationEvents.idempotencyKey })
    .returning()
    .get();

  if (inserted) {
    return inserted;
  }

  const existing = db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.idempotencyKey, input.idempotencyKey))
    .get();
  if (!existing) {
    throw new Error(
      `Notification event conflict did not resolve: ${input.idempotencyKey}`,
    );
  }
  return existing;
}

export function listNotificationEvents(
  db: DbQueryConnection,
  args: ListNotificationEventsArgs,
): NotificationEventRow[] {
  return db
    .select()
    .from(notificationEvents)
    .where(gt(notificationEvents.sequence, args.afterSequence))
    .orderBy(asc(notificationEvents.sequence))
    .limit(args.limit)
    .all();
}
