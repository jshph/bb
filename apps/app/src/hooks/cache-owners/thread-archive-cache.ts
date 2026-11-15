import type { QueryClient } from "@tanstack/react-query";
import { isRunningThreadRuntimeDisplayStatus } from "@bb/client-core";
import { getThreadEntity, type ThreadEntity } from "./thread-entity-store";

interface CachedWorkingThreadIdsArgs {
  queryClient: QueryClient;
  threadIds: Iterable<string>;
}

function isWorkingThreadEntity({
  thread,
  list,
  detail,
}: ThreadEntity): boolean {
  if (thread.archivedAt != null) return false;
  const activity = list?.activity;
  return (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping" ||
    (thread.runtime !== undefined &&
      isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus)) ||
    (activity !== undefined &&
      (activity.activeWorkflowCount > 0 ||
        activity.activeBackgroundAgentCount > 0 ||
        activity.activeBackgroundCommandCount > 0 ||
        activity.activePlanModeCount > 0)) ||
    (detail?.activeBackgroundAgentCount ?? 0) > 0
  );
}

export function listCachedWorkingThreadIds({
  queryClient,
  threadIds,
}: CachedWorkingThreadIdsArgs): string[] {
  const working = new Set<string>();
  for (const threadId of threadIds) {
    const entity = getThreadEntity(queryClient, threadId);
    if (entity !== undefined && isWorkingThreadEntity(entity))
      working.add(threadId);
  }
  return [...working];
}
