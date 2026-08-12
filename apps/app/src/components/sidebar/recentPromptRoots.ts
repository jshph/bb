import type { ThreadListEntry } from "@bb/domain";
import {
  SIDEBAR_RECENT_USER_PROMPT_WINDOW_MS,
  type SidebarRecentUserPrompt,
} from "@bb/server-contract";

export const RECENT_PROMPT_WINDOW_MS = SIDEBAR_RECENT_USER_PROMPT_WINDOW_MS;

export interface RecentPromptRoot {
  latestUserPromptAt: number;
  projectName: string;
  thread: ThreadListEntry;
}

interface BuildRecentPromptRootsArgs {
  now: number;
  projectNamesById: ReadonlyMap<string, string>;
  recentUserPrompts: readonly SidebarRecentUserPrompt[];
  threads: readonly ThreadListEntry[];
}

export function buildRecentPromptRoots({
  now,
  projectNamesById,
  recentUserPrompts,
  threads,
}: BuildRecentPromptRootsArgs): RecentPromptRoot[] {
  const cutoff = now - RECENT_PROMPT_WINDOW_MS;
  const eligibleThreads = threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      thread.visibility === "visible",
  );
  const threadById = new Map(
    eligibleThreads.map((thread) => [thread.id, thread]),
  );
  const rootByThreadId = new Map<string, ThreadListEntry | null>();

  const resolveRoot = (thread: ThreadListEntry): ThreadListEntry | null => {
    const cached = rootByThreadId.get(thread.id);
    if (cached !== undefined) return cached;

    const visitedIds = new Set<string>();
    let current = thread;
    while (current.parentThreadId !== null) {
      if (visitedIds.has(current.id)) {
        rootByThreadId.set(thread.id, null);
        return null;
      }
      visitedIds.add(current.id);
      const parent = threadById.get(current.parentThreadId);
      if (!parent || parent.projectId !== current.projectId) {
        rootByThreadId.set(thread.id, null);
        return null;
      }
      current = parent;
    }
    rootByThreadId.set(thread.id, current);
    return current;
  };

  const recentByRootId = new Map<string, RecentPromptRoot>();
  for (const { threadId, latestUserPromptAt } of recentUserPrompts) {
    if (latestUserPromptAt < cutoff) continue;
    const thread = threadById.get(threadId);
    if (!thread) continue;

    const root = resolveRoot(thread);
    if (!root) continue;
    const current = recentByRootId.get(root.id);
    if (current && current.latestUserPromptAt >= latestUserPromptAt) continue;
    recentByRootId.set(root.id, {
      latestUserPromptAt,
      projectName: projectNamesById.get(root.projectId) ?? "Personal",
      thread: root,
    });
  }

  return [...recentByRootId.values()].sort((left, right) => {
    const timestampDelta = right.latestUserPromptAt - left.latestUserPromptAt;
    return timestampDelta !== 0
      ? timestampDelta
      : left.thread.id.localeCompare(right.thread.id);
  });
}
