import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import {
  createSidebarProjectIdResolver,
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
} from "@bb/client-core";

interface BuildProjectModeActiveGroupsArgs {
  effectivePinnedThreadIds: ReadonlySet<string>;
  projects: readonly ProjectResponse[];
  selectedThreadId?: string;
  threads: readonly ThreadListEntry[];
}

export interface ProjectModeActiveGroups {
  activeProjectIds: ReadonlySet<string>;
  activeProjects: ProjectResponse[];
  dormantProjects: ProjectResponse[];
  isPersonalActive: boolean;
  threadsByProject: ReadonlyMap<string, ThreadListEntry[]>;
}

function hasDurableActiveStatus(thread: ThreadListEntry): boolean {
  return (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  );
}

export function isActiveProjectModeThread(thread: ThreadListEntry): boolean {
  return (
    hasDurableActiveStatus(thread) ||
    isRuntimeBusyThread(thread) ||
    hasActiveWorkflowActivity(thread) ||
    hasActiveBackgroundAgentActivity(thread) ||
    hasActiveBackgroundCommandActivity(thread) ||
    hasActivePlanModeActivity(thread) ||
    hasActiveGoalActivity(thread) ||
    thread.hasPendingInteraction ||
    isUnreadDoneThread(thread)
  );
}

export function buildProjectModeActiveGroups({
  effectivePinnedThreadIds,
  projects,
  selectedThreadId,
  threads,
}: BuildProjectModeActiveGroupsArgs): ProjectModeActiveGroups {
  const threadsByProject = new Map<string, ThreadListEntry[]>();
  const activeProjectIds = new Set<string>();
  const resolveSidebarProjectId = createSidebarProjectIdResolver(
    new Map(threads.map((thread) => [thread.id, thread])),
  );

  for (const thread of threads) {
    if (thread.visibility !== "visible" || thread.archivedAt !== null) continue;
    if (effectivePinnedThreadIds.has(thread.id)) continue;
    const sidebarProjectId = resolveSidebarProjectId(thread);
    const projectThreads = threadsByProject.get(sidebarProjectId);
    if (projectThreads) {
      projectThreads.push(thread);
    } else {
      threadsByProject.set(sidebarProjectId, [thread]);
    }
    if (isActiveProjectModeThread(thread) || thread.id === selectedThreadId) {
      activeProjectIds.add(sidebarProjectId);
    }
  }

  const projectInputIndex = new Map(
    projects.map((project, index) => [project.id, index]),
  );
  const activeProjects = projects
    .filter((project) => activeProjectIds.has(project.id))
    .sort((left, right) => {
      const nameDelta = left.name.localeCompare(right.name);
      if (nameDelta !== 0) return nameDelta;
      return (
        (projectInputIndex.get(left.id) ?? 0) -
        (projectInputIndex.get(right.id) ?? 0)
      );
    });

  return {
    activeProjectIds,
    activeProjects,
    dormantProjects: projects.filter(
      (project) => !activeProjectIds.has(project.id),
    ),
    isPersonalActive: activeProjectIds.has(PERSONAL_PROJECT_ID),
    threadsByProject,
  };
}
