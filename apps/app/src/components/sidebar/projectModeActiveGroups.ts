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
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";

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

/**
 * Whether one eligible, non-pinned sidebar thread promotes its bucket into
 * Active. Composer drafts are intentionally absent: they affect row glyphs,
 * not project organization.
 */
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

/**
 * One client-side pass partitions visible, unarchived, non-pinned sidebar
 * threads by project and records active membership. The required alphabetical
 * presentation is applied only to the resulting active ordinary projects;
 * dormant projects retain their persisted sidebar order at render time.
 */
export function buildProjectModeActiveGroups({
  effectivePinnedThreadIds,
  projects,
  selectedThreadId,
  threads,
}: BuildProjectModeActiveGroupsArgs): ProjectModeActiveGroups {
  const threadsByProject = new Map<string, ThreadListEntry[]>();
  const activeProjectIds = new Set<string>();
  let selectedProjectId: string | undefined;
  const resolveSidebarProjectId = createSidebarProjectIdResolver(
    new Map(threads.map((thread) => [thread.id, thread])),
  );

  for (const thread of threads) {
    if (thread.visibility !== "visible" || thread.archivedAt !== null) continue;
    if (effectivePinnedThreadIds.has(thread.id)) continue;
    // Cross-project children render and contribute activity under their
    // parent's sidebar project rather than their own persisted project.
    const sidebarProjectId = resolveSidebarProjectId(thread);

    const projectThreads = threadsByProject.get(sidebarProjectId);
    if (projectThreads) {
      projectThreads.push(thread);
    } else {
      threadsByProject.set(sidebarProjectId, [thread]);
    }

    if (isActiveProjectModeThread(thread)) {
      activeProjectIds.add(sidebarProjectId);
    }
    if (thread.id === selectedThreadId) {
      selectedProjectId = sidebarProjectId;
    }
  }

  // Keep the selected ordinary bucket visible after opening its final unread
  // result. Navigation to a different row removes this derived membership.
  if (selectedProjectId !== undefined) {
    activeProjectIds.add(selectedProjectId);
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
  const dormantProjects = projects.filter(
    (project) => !activeProjectIds.has(project.id),
  );

  return {
    activeProjectIds,
    activeProjects,
    dormantProjects,
    isPersonalActive: activeProjectIds.has(PERSONAL_PROJECT_ID),
    threadsByProject,
  };
}

interface MergeDormantProjectOrderArgs {
  dormantSectionIds: ReadonlySet<SidebarSectionId>;
  fullOrder: readonly SidebarSectionId[];
  nextDormantOrder: readonly SidebarSectionId[];
}

/**
 * Reorders only the visible dormant slots while preserving every hidden Active
 * id (and built-in id) in the full persisted order. When an Active project
 * later demotes, its old slot is therefore still present.
 */
export function mergeDormantProjectOrder({
  dormantSectionIds,
  fullOrder,
  nextDormantOrder,
}: MergeDormantProjectOrderArgs): SidebarSectionId[] {
  const seen = new Set<SidebarSectionId>();
  const replacements: SidebarSectionId[] = [];
  const appendReplacement = (sectionId: SidebarSectionId): void => {
    if (!dormantSectionIds.has(sectionId) || seen.has(sectionId)) return;
    seen.add(sectionId);
    replacements.push(sectionId);
  };

  for (const sectionId of nextDormantOrder) appendReplacement(sectionId);
  for (const sectionId of fullOrder) appendReplacement(sectionId);

  let replacementIndex = 0;
  return fullOrder.map((sectionId) => {
    if (!dormantSectionIds.has(sectionId)) return sectionId;
    const replacement = replacements[replacementIndex];
    replacementIndex += 1;
    return replacement ?? sectionId;
  });
}
