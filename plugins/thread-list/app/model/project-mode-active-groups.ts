import type { SidebarThread } from "./sidebar-thread.js";
import type { SidebarProject } from "./use-sidebar-data.js";
import { createSidebarProjectIdResolver } from "./project-thread-groups.js";
import { isBusyThread, isUnreadDoneThread } from "./thread-activity.js";

interface BuildProjectModeActiveGroupsArgs {
  effectivePinnedThreadIds: ReadonlySet<string>;
  personalProjectId: string | null;
  projects: readonly SidebarProject[];
  selectedThreadId?: string;
  threads: readonly SidebarThread[];
}

export interface ProjectModeActiveGroups {
  activeProjectIds: ReadonlySet<string>;
  activeProjects: SidebarProject[];
  dormantProjects: SidebarProject[];
  isPersonalActive: boolean;
  threadsByProject: ReadonlyMap<string, SidebarThread[]>;
}

function hasDurableActiveStatus(thread: SidebarThread): boolean {
  return (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  );
}

export function isActiveProjectModeThread(thread: SidebarThread): boolean {
  if (thread.isHidden || thread.isArchived) return false;
  return (
    hasDurableActiveStatus(thread) ||
    isBusyThread(thread) ||
    thread.hasPendingInteraction ||
    isUnreadDoneThread(thread)
  );
}

export function buildProjectModeActiveGroups({
  effectivePinnedThreadIds,
  personalProjectId,
  projects,
  selectedThreadId,
  threads,
}: BuildProjectModeActiveGroupsArgs): ProjectModeActiveGroups {
  const threadsByProject = new Map<string, SidebarThread[]>();
  const activeProjectIds = new Set<string>();
  const resolveSidebarProjectId = createSidebarProjectIdResolver(
    new Map(threads.map((thread) => [thread.id, thread])),
  );

  for (const thread of threads) {
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
    isPersonalActive:
      personalProjectId !== null && activeProjectIds.has(personalProjectId),
    threadsByProject,
  };
}
