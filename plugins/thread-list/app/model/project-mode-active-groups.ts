import { experimental_resolveThreadStatus } from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "./sidebar-thread.js";
import type { SidebarProject } from "./use-sidebar-data.js";
import { createSidebarProjectIdResolver } from "./project-thread-groups.js";

interface GroupProjectModeThreadsArgs {
  effectivePinnedThreadIds: ReadonlySet<string>;
  threads: readonly SidebarThread[];
}

export interface ProjectModeThreadGroups {
  attentionProjectIds: ReadonlySet<string>;
  sidebarProjectIdByThreadId: ReadonlyMap<string, string>;
  threadsByProject: ReadonlyMap<string, SidebarThread[]>;
}

interface ResolveProjectModeActiveGroupsArgs {
  groups: ProjectModeThreadGroups;
  personalProjectId: string | null;
  projects: readonly SidebarProject[];
  selectedThreadId?: string;
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

function isUnreadDoneThread(thread: SidebarThread): boolean {
  return (
    thread.parentThreadId === null &&
    thread.isUnread &&
    (thread.status === "idle" || thread.status === "error")
  );
}

export function isAttentionThread(thread: SidebarThread): boolean {
  return (
    thread.hasPendingInteraction ||
    isUnreadDoneThread(thread) ||
    experimental_resolveThreadStatus({
      thread,
      hiddenThreads: [],
      hasUnsubmittedDraft: false,
      rowStatus: null,
    }).isWorking
  );
}

export function isActiveProjectModeThread(thread: SidebarThread): boolean {
  if (thread.isHidden || thread.isArchived) return false;
  return hasDurableActiveStatus(thread) || isAttentionThread(thread);
}

export function groupProjectModeThreads({
  effectivePinnedThreadIds,
  threads,
}: GroupProjectModeThreadsArgs): ProjectModeThreadGroups {
  const threadsByProject = new Map<string, SidebarThread[]>();
  const sidebarProjectIdByThreadId = new Map<string, string>();
  const attentionProjectIds = new Set<string>();
  const resolveSidebarProjectId = createSidebarProjectIdResolver(
    new Map(threads.map((thread) => [thread.id, thread])),
  );

  for (const thread of threads) {
    if (effectivePinnedThreadIds.has(thread.id)) continue;
    const sidebarProjectId = resolveSidebarProjectId(thread);
    sidebarProjectIdByThreadId.set(thread.id, sidebarProjectId);
    const projectThreads = threadsByProject.get(sidebarProjectId);
    if (projectThreads) {
      projectThreads.push(thread);
    } else {
      threadsByProject.set(sidebarProjectId, [thread]);
    }
    if (isActiveProjectModeThread(thread)) {
      attentionProjectIds.add(sidebarProjectId);
    }
  }

  return { attentionProjectIds, sidebarProjectIdByThreadId, threadsByProject };
}

export function resolveProjectModeActiveGroups({
  groups,
  personalProjectId,
  projects,
  selectedThreadId,
}: ResolveProjectModeActiveGroupsArgs): ProjectModeActiveGroups {
  const selectedProjectId =
    selectedThreadId === undefined
      ? undefined
      : groups.sidebarProjectIdByThreadId.get(selectedThreadId);
  const activeProjectIds =
    selectedProjectId === undefined ||
    groups.attentionProjectIds.has(selectedProjectId)
      ? groups.attentionProjectIds
      : new Set([...groups.attentionProjectIds, selectedProjectId]);

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
    threadsByProject: groups.threadsByProject,
  };
}
