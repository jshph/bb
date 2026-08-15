import { and, eq, isNull } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createNotificationSubscriptionId } from "../ids.js";
import { notificationSubscriptions } from "../schema.js";

type NotificationSubscriptionWriteConnection = DbConnection | DbTransaction;

export type NotificationSubscriptionRow =
  typeof notificationSubscriptions.$inferSelect;

export interface UpsertNotificationSubscriptionInput {
  auth: string;
  endpoint: string;
  p256dh: string;
  userAgent: string | null;
}

export function upsertNotificationSubscription(
  db: NotificationSubscriptionWriteConnection,
  input: UpsertNotificationSubscriptionInput,
): NotificationSubscriptionRow {
  const now = Date.now();
  return db
    .insert(notificationSubscriptions)
    .values({
      id: createNotificationSubscriptionId(),
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationSubscriptions.endpoint,
      set: {
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        disabledAt: null,
        updatedAt: now,
      },
    })
    .returning()
    .get();
}

export function disableNotificationSubscriptionByEndpoint(
  db: NotificationSubscriptionWriteConnection,
  endpoint: string,
): void {
  const now = Date.now();
  db.update(notificationSubscriptions)
    .set({
      disabledAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationSubscriptions.endpoint, endpoint),
        isNull(notificationSubscriptions.disabledAt),
      ),
    )
    .run();
}

export function listActiveNotificationSubscriptions(
  db: DbConnection,
): NotificationSubscriptionRow[] {
  return db
    .select()
    .from(notificationSubscriptions)
    .where(isNull(notificationSubscriptions.disabledAt))
    .all();
}
