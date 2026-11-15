import {
  cancelProviderEnvironmentCreation,
  sweepProviderEnvironment,
} from "../environments/environment-engine.js";
import {
  removeCreatingMachine,
  sweepProviderMachine,
} from "../machines/provider-orchestration.js";
import {
  listLiveThreadsInEnvironment,
  listLifecycleThreadDependents,
  archiveThread,
  deleteThreadScopedPruningCursors,
  getEnvironment,
  listNonDeletedChildThreads,
  listNonDeletedHiddenSourceThreads,
} from "@bb/db";
import type { EnvironmentRow } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import { emitPluginThreadArchived } from "../plugins/plugin-thread-events.js";
import {
  dispatchSettledArchivedThreadProviderArchiveCommand,
  requestThreadStopForCurrentState,
} from "./thread-lifecycle.js";
import {
  archiveUndoGraceKeepsTerminals,
  archiveUndoGraceKeepsTurnRunning,
} from "./archive-undo-grace.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";
import { resolveThreadHostCommandEnvironment } from "./thread-command-environment.js";

interface ArchiveThreadEnvironment {
  hostId: string;
  id: string;
}

interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: ArchiveThreadEnvironment | null;
  releaseChildren: boolean;
  thread: Pick<Thread, "environmentId" | "id" | "status">;
}

interface ArchiveEnvironmentThreadsArgs {
  environment: EnvironmentRow;
}

interface ArchiveThreadAndChildrenArgs {
  parentThread: Thread;
}

type ArchiveCandidate = Pick<
  Thread,
  "id" | "environmentId" | "status" | "archivedAt" | "deletedAt" | "visibility"
>;

type ArchiveChildFilter = (
  parent: ArchiveCandidate,
  child: ArchiveCandidate,
) => boolean;

interface ArchiveThreadTreesOptions {
  followChild: ArchiveChildFilter;
  releaseChildren: boolean;
}

function archiveThreadWithLifecycleEffects(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): Thread | null {
  const archivedThread = args.releaseChildren
    ? archiveThreadAndReleaseChildren(deps, { threadId: args.thread.id })
    : archiveThread(deps.db, deps.hub, args.thread.id);
  if (!archivedThread) {
    return null;
  }

  const now = Date.now();
  if (!archiveUndoGraceKeepsTerminals(archivedThread, now)) {
    deps.terminalSessions.closeArchivedThreadTerminals({
      threadId: archivedThread.id,
    });
  }
  if (!archiveUndoGraceKeepsTurnRunning(archivedThread, now)) {
    requestThreadStopForCurrentState(deps, archivedThread, args.environment);
  }
  dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
    threadId: archivedThread.id,
  });
  resetActiveThreadEventPruningState(archivedThread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: archivedThread.id,
  });
  deleteThreadScopedPruningCursors(deps.db, archivedThread.id);
  void cancelProviderEnvironmentCreation(deps, archivedThread.id).catch(
    (error) =>
      deps.logger.warn({ error }, "Environment launch cancellation failed"),
  );
  void removeCreatingMachine(deps, archivedThread.id).catch((error) =>
    deps.logger.warn({ error }, "Machine launch cancellation failed"),
  );
  if (archivedThread.environmentId !== null)
    void sweepProviderEnvironment(deps, archivedThread.environmentId).catch(
      (error) => deps.logger.warn({ error }, "Environment retirement failed"),
    );
  if (args.environment !== null) {
    void sweepProviderMachine(deps, args.environment.hostId).catch((error) =>
      deps.logger.warn({ error }, "Machine retirement failed"),
    );
  }
  emitPluginThreadArchived(archivedThread);

  return archivedThread;
}

export function archiveEnvironmentThreads(
  deps: AppDeps,
  args: ArchiveEnvironmentThreadsArgs,
): string[] {
  const roots = listLiveThreadsInEnvironment(deps.db, {
    environmentId: args.environment.id,
  });
  return archiveThreadTrees(
    deps,
    roots,
    (thread) =>
      thread.environmentId === null
        ? null
        : getEnvironment(deps.db, thread.environmentId),
    {
      followChild: (parent, child) =>
        child.environmentId === parent.environmentId,
      releaseChildren: false,
    },
  );
}

export function archiveThreadAndChildren(
  deps: AppDeps,
  args: ArchiveThreadAndChildrenArgs,
): string[] {
  const environment = resolveThreadHostCommandEnvironment({
    db: deps.db,
    thread: args.parentThread,
  });
  return archiveThreadTrees(
    deps,
    [args.parentThread],
    (thread) =>
      thread.id === args.parentThread.id
        ? environment
        : thread.environmentId === null
          ? null
          : getEnvironment(deps.db, thread.environmentId),
    { followChild: followEveryChild, releaseChildren: true },
  );
}

function archiveThreadTrees(
  deps: AppDeps,
  roots: Thread[],
  resolveEnvironment: (
    thread: ArchiveThreadWithLifecycleEffectsArgs["thread"],
  ) => ArchiveThreadEnvironment | null,
  options: ArchiveThreadTreesOptions,
): string[] {
  const threads = listArchiveCandidates(deps.db, roots, options.followChild);
  for (const root of roots) archiveThread(deps.db, deps.hub, root.id);
  const archivedThreadIds: string[] = [];

  for (const thread of threads) {
    if (thread.deletedAt !== null) continue;
    if (thread.archivedAt !== null) {
      if (!archiveUndoGraceKeepsTurnRunning(thread, Date.now()))
        requestThreadStopForCurrentState(
          deps,
          thread,
          thread.environmentId === null ? null : resolveEnvironment(thread),
        );
      continue;
    }
    const environment = resolveEnvironment(thread);
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment,
      releaseChildren: options.releaseChildren,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
  }

  return archivedThreadIds;
}

export function listArchiveCascadeThreadIds(
  db: AppDeps["db"],
  thread: Thread,
): string[] {
  return listArchiveCandidates(db, [thread], followEveryChild)
    .filter(
      (candidate) =>
        candidate.id !== thread.id &&
        candidate.visibility === "visible" &&
        candidate.deletedAt === null &&
        candidate.archivedAt === null,
    )
    .map((candidate) => candidate.id);
}

export function countUnarchivedThreadDescendants(
  db: AppDeps["db"],
  thread: Thread,
): number {
  return listArchiveCascadeThreadIds(db, thread).length;
}

function followEveryChild(): boolean {
  return true;
}

function listArchiveCandidates(
  db: AppDeps["db"],
  roots: Thread[],
  followChild: ArchiveChildFilter,
) {
  const pending: { thread: ArchiveCandidate; expanded: boolean }[] = [...roots]
    .reverse()
    .map((thread) => ({ thread, expanded: false }));
  const visited = new Set<string>();
  const threads: ArchiveCandidate[] = [];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      break;
    }
    const { thread, expanded } = entry;
    if (expanded) {
      threads.push(thread);
      continue;
    }
    if (visited.has(thread.id)) {
      continue;
    }
    visited.add(thread.id);
    pending.push({ thread, expanded: true });
    const descendants = [
      ...listLifecycleThreadDependents(db, thread.id),
      ...listNonDeletedChildThreads(db, {
        parentThreadId: thread.id,
      }).filter((child) => followChild(thread, child)),
      ...listNonDeletedHiddenSourceThreads(db, {
        sourceThreadId: thread.id,
      }),
    ];
    for (const descendant of descendants.reverse()) {
      pending.push({ thread: descendant, expanded: false });
    }
  }
  return threads;
}
