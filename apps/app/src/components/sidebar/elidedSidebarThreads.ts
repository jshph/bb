import type { ThreadListEntry } from "@bb/domain";
import type { ThreadComparator } from "@bb/client-core";

export const SIDEBAR_THREADS_PER_PROJECT_PAGE = 20;

interface ElideSidebarThreadsArgs {
  threads: readonly ThreadListEntry[];
  compareThreads: ThreadComparator;
  limitPerProject: number;
  selectedThreadId?: string;
}

export interface ElidedSidebarThreads {
  threads: ThreadListEntry[];
  hiddenCount: number;
}

/**
 * Bounds mounted sidebar rows without changing the complete navigation cache.
 * The selected thread and its visible ancestor chain remain reachable even
 * when they fall outside the current per-project window.
 */
export function elideSidebarThreads({
  threads,
  compareThreads,
  limitPerProject,
  selectedThreadId,
}: ElideSidebarThreadsArgs): ElidedSidebarThreads {
  const visibleThreads = threads.filter(
    (thread) => thread.visibility !== "hidden",
  );
  const threadsByProjectId = new Map<string, ThreadListEntry[]>();
  const threadById = new Map(
    visibleThreads.map((thread) => [thread.id, thread]),
  );

  for (const thread of visibleThreads) {
    const projectThreads = threadsByProjectId.get(thread.projectId);
    if (projectThreads) {
      projectThreads.push(thread);
    } else {
      threadsByProjectId.set(thread.projectId, [thread]);
    }
  }

  const includedThreadIds = new Set<string>();
  for (const projectThreads of threadsByProjectId.values()) {
    const orderedThreads = [...projectThreads].sort(compareThreads);
    for (const thread of orderedThreads.slice(0, limitPerProject)) {
      includedThreadIds.add(thread.id);
    }
  }

  const selectedThread = selectedThreadId
    ? threadById.get(selectedThreadId)
    : undefined;
  let currentThread = selectedThread;
  const visitedAncestorIds = new Set<string>();
  while (currentThread && !visitedAncestorIds.has(currentThread.id)) {
    includedThreadIds.add(currentThread.id);
    visitedAncestorIds.add(currentThread.id);
    const parentThread = currentThread.parentThreadId
      ? threadById.get(currentThread.parentThreadId)
      : undefined;
    currentThread =
      parentThread?.projectId === currentThread.projectId
        ? parentThread
        : undefined;
  }

  const includedThreads = visibleThreads.filter((thread) =>
    includedThreadIds.has(thread.id),
  );
  return {
    threads: includedThreads,
    hiddenCount: visibleThreads.length - includedThreads.length,
  };
}
