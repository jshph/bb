import {
  createNotificationEvent,
  type DbConnection,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import type { Thread } from "@bb/domain";

type NotificationDb = DbConnection | DbTransaction;

type ThreadNotificationType =
  | "thread.needs_input"
  | "thread.completed"
  | "thread.failed";

interface CreateThreadNotificationArgs {
  db: NotificationDb;
  eventType: ThreadNotificationType;
  idempotencyKey: string;
  thread: Thread;
}

function notificationText(args: {
  eventType: ThreadNotificationType;
  threadTitle: string;
}): { body: string; shouldNotify: boolean; title: string } {
  switch (args.eventType) {
    case "thread.needs_input":
      return {
        title: "bb needs input",
        body: args.threadTitle,
        shouldNotify: true,
      };
    case "thread.failed":
      return {
        title: "bb thread failed",
        body: args.threadTitle,
        shouldNotify: true,
      };
    case "thread.completed":
      return {
        title: "bb thread completed",
        body: args.threadTitle,
        shouldNotify: false,
      };
  }
}

export function createThreadNotificationEvent(
  args: CreateThreadNotificationArgs,
) {
  const threadTitle =
    args.thread.title ?? args.thread.titleFallback ?? "Untitled thread";
  const text = notificationText({
    eventType: args.eventType,
    threadTitle,
  });
  return createNotificationEvent(args.db, {
    eventType: args.eventType,
    idempotencyKey: args.idempotencyKey,
    projectId: args.thread.projectId,
    sourceThreadId: args.thread.id,
    targetThreadId: args.thread.parentThreadId ?? args.thread.id,
    ...text,
  });
}

export function notifyThreadNotificationEventChanged(deps: {
  hub: DbNotifier;
}): void {
  deps.hub.notifySystem(["notification-events-changed"]);
}
