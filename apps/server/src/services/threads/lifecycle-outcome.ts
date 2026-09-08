import {
  applyThreadLifecycleEvent,
  applyThreadLifecycleEventInTransaction,
  type ApplyThreadLifecycleEventArgs,
  type ApplyThreadLifecycleEventOutcome,
  type DbConnection,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import {
  emitPluginThreadLifecycleOutcome,
  emitPluginTurnFailed,
} from "../plugins/plugin-thread-events.js";
import {
  createThreadNotificationEvent,
  notifyThreadNotificationEventChanged,
} from "../notifications/thread-notifications.js";
import { deliverNotificationEventBestEffort } from "../notifications/web-push.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { buildThreadStatusChangeMetadata } from "./thread-runtime-display.js";

/**
 * `run.failed` is the only event that lands a thread in `error`, so an applied
 * one is exactly "a turn on this thread just failed" — which is what the
 * `turn.failed` plugin event announces.
 *
 * Deliberately after the failure is fully applied: this is an announcement, not
 * a decision. A listener that wants another attempt asks for one afterwards
 * with `sdk.threads.retry`, so nothing here can change how the failure was
 * handled.
 */
function announceTurnFailed(
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (!outcome.applied || args.event.type !== "run.failed") return;
  emitPluginTurnFailed(args.threadId);
}

interface ApplyLoggedThreadLifecycleEventDeps {
  db: DbConnection;
  hub: Pick<NotificationHub, "getDaemonSessionIdForHost"> & DbNotifier;
  logger: ServerLogger;
  providerRegistry: ProviderRegistryService;
}

interface ApplyLoggedThreadLifecycleEventTransactionDeps {
  db: DbTransaction;
  hub?: DbNotifier;
  logger: ServerLogger;
}

function logUnappliedThreadLifecycleEvent(
  logger: ServerLogger,
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (outcome.applied) {
    return;
  }
  logger.info(
    {
      detail: outcome.detail,
      event: args.event.type,
      reason: outcome.reason,
      threadId: args.threadId,
    },
    "Thread lifecycle event not applied",
  );
}

function notificationTypeForLifecycleOutcome(
  outcome: ApplyThreadLifecycleEventOutcome,
): "thread.completed" | "thread.failed" | null {
  if (!outcome.applied) {
    return null;
  }
  if (outcome.thread.status === "idle") {
    return "thread.completed";
  }
  if (outcome.thread.status === "error") {
    return "thread.failed";
  }
  return null;
}

function createNotificationForLifecycleOutcome(
  deps: {
    db: DbConnection | DbTransaction;
    deliveryDb?: DbConnection;
    hub?: DbNotifier;
    logger: ServerLogger;
  },
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  const eventType = notificationTypeForLifecycleOutcome(outcome);
  if (eventType === null || !outcome.applied) {
    return;
  }
  const event = createThreadNotificationEvent({
    db: deps.db,
    eventType,
    idempotencyKey: `${eventType}:${outcome.thread.id}:${outcome.thread.updatedAt}`,
    thread: outcome.thread,
  });
  if (deps.hub) {
    notifyThreadNotificationEventChanged({ hub: deps.hub });
  }
  if (deps.deliveryDb) {
    void deliverNotificationEventBestEffort(
      deps.deliveryDb,
      deps.logger,
      event,
    );
  }
}

export function applyLoggedThreadLifecycleEvent(
  deps: ApplyLoggedThreadLifecycleEventDeps,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = applyThreadLifecycleEvent(deps.db, args);
  if (outcome.applied) {
    deps.hub.notifyThread(
      args.threadId,
      ["status-changed"],
      buildThreadStatusChangeMetadata(deps, outcome.thread),
    );
  }
  logUnappliedThreadLifecycleEvent(deps.logger, args, outcome);
  createNotificationForLifecycleOutcome(
    { ...deps, deliveryDb: deps.db },
    outcome,
  );
  emitPluginThreadLifecycleOutcome(outcome);
  announceTurnFailed(args, outcome);
  return outcome;
}

export function applyLoggedThreadLifecycleEventInTransaction(
  deps: ApplyLoggedThreadLifecycleEventTransactionDeps,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = applyThreadLifecycleEventInTransaction(deps.db, args);
  logUnappliedThreadLifecycleEvent(deps.logger, args, outcome);
  createNotificationForLifecycleOutcome(deps, outcome);
  emitPluginThreadLifecycleOutcome(outcome);
  announceTurnFailed(args, outcome);
  return outcome;
}
