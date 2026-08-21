import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import {
  buildProjectModeActiveGroups,
  isActiveProjectModeThread,
  mergeDormantProjectOrder,
} from "./projectModeActiveGroups";

function makeProject(id: string, name = id): ProjectResponse {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_a",
    environmentId: null,
    providerId: "codex",
    title: "Test thread",
    titleFallback: "Test thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 2,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

describe("isActiveProjectModeThread", () => {
  it.each(["starting", "active", "stopping"] as const)(
    "includes durable %s status",
    (status) => {
      expect(isActiveProjectModeThread(makeThread({ status }))).toBe(true);
    },
  );

  it("includes a busy foreground runtime independent of durable status", () => {
    expect(
      isActiveProjectModeThread(
        makeThread({
          runtime: {
            displayStatus: "provisioning",
            hostReconnectGraceExpiresAt: null,
          },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    "activeWorkflowCount",
    "activeBackgroundAgentCount",
    "activeBackgroundCommandCount",
    "activePlanModeCount",
    "activeGoalCount",
  ] as const)("includes %s activity", (activityKey) => {
    expect(
      isActiveProjectModeThread(
        makeThread({
          activity: {
            activeWorkflowCount: 0,
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeGoalCount: 0,
            [activityKey]: 1,
          },
        }),
      ),
    ).toBe(true);
  });

  it("includes pending interaction", () => {
    expect(
      isActiveProjectModeThread(makeThread({ hasPendingInteraction: true })),
    ).toBe(true);
  });

  it("includes unread completed roots but not completed children or read roots", () => {
    const unreadRoot = makeThread({ lastReadAt: 1, latestAttentionAt: 2 });
    expect(isActiveProjectModeThread(unreadRoot)).toBe(true);
    expect(isActiveProjectModeThread({ ...unreadRoot, status: "error" })).toBe(
      true,
    );
    expect(
      isActiveProjectModeThread({
        ...unreadRoot,
        parentThreadId: "thr_parent",
      }),
    ).toBe(false);
    expect(
      isActiveProjectModeThread({
        ...unreadRoot,
        lastReadAt: 2,
        latestAttentionAt: 2,
      }),
    ).toBe(false);
  });

  it("does not promote a read idle thread; drafts are not a classification input", () => {
    expect(isActiveProjectModeThread(makeThread())).toBe(false);
  });
});

describe("buildProjectModeActiveGroups", () => {
  const projects = [
    makeProject("proj_z", "Zulu"),
    makeProject("proj_a", "Alpha"),
    makeProject("proj_a2", "Alpha"),
  ];

  it("excludes pinned represented trees, hidden threads, and archived threads", () => {
    const groups = buildProjectModeActiveGroups({
      projects,
      threads: [
        makeThread({ id: "thr_pinned", status: "active" }),
        makeThread({
          id: "thr_pinned_child",
          parentThreadId: "thr_pinned",
          status: "active",
        }),
        makeThread({
          id: "thr_hidden",
          status: "active",
          visibility: "hidden",
        }),
        makeThread({ id: "thr_archived", status: "active", archivedAt: 3 }),
      ],
      effectivePinnedThreadIds: new Set(["thr_pinned", "thr_pinned_child"]),
    });

    expect(groups.activeProjects).toEqual([]);
    expect(groups.threadsByProject.size).toBe(0);
  });

  it("keeps the selected non-pinned bucket active only while selected", () => {
    const selected = makeThread({ id: "thr_selected", projectId: "proj_z" });
    const selectedGroups = buildProjectModeActiveGroups({
      projects,
      threads: [selected],
      effectivePinnedThreadIds: new Set(),
      selectedThreadId: selected.id,
    });
    const afterNavigation = buildProjectModeActiveGroups({
      projects,
      threads: [selected],
      effectivePinnedThreadIds: new Set(),
    });

    expect(selectedGroups.activeProjects.map((project) => project.id)).toEqual([
      "proj_z",
    ]);
    expect(afterNavigation.activeProjects).toEqual([]);
  });

  it("does not apply selected stickiness to an effective pinned thread", () => {
    const pinned = makeThread({ id: "thr_pinned", projectId: "proj_z" });
    const groups = buildProjectModeActiveGroups({
      projects,
      threads: [pinned],
      effectivePinnedThreadIds: new Set([pinned.id]),
      selectedThreadId: pinned.id,
    });

    expect(groups.activeProjects).toEqual([]);
  });

  it("sorts active ordinary projects alphabetically and stably", () => {
    const groups = buildProjectModeActiveGroups({
      projects,
      threads: projects.map((project, index) =>
        makeThread({
          id: `thr_${index}`,
          projectId: project.id,
          status: "active",
        }),
      ),
      effectivePinnedThreadIds: new Set(),
    });

    expect(groups.activeProjects.map((project) => project.id)).toEqual([
      "proj_a",
      "proj_a2",
      "proj_z",
    ]);
  });

  it("groups cross-project children under their parent sidebar project", () => {
    const groups = buildProjectModeActiveGroups({
      projects,
      threads: [
        makeThread({
          id: "thr_parent",
          projectId: "proj_z",
        }),
        makeThread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          projectId: "proj_a",
          status: "active",
        }),
      ],
      effectivePinnedThreadIds: new Set(),
    });

    expect(groups.activeProjects.map((project) => project.id)).toEqual([
      "proj_z",
    ]);
    expect(groups.threadsByProject.get("proj_z")?.map((thread) => thread.id))
      .toEqual(["thr_parent", "thr_child"]);
    expect(groups.threadsByProject.has("proj_a")).toBe(false);
  });

  it("classifies Personal through the same thread buckets", () => {
    const groups = buildProjectModeActiveGroups({
      projects,
      threads: [
        makeThread({
          id: "thr_personal",
          projectId: PERSONAL_PROJECT_ID,
          hasPendingInteraction: true,
        }),
      ],
      effectivePinnedThreadIds: new Set(),
    });

    expect(groups.isPersonalActive).toBe(true);
    expect(groups.threadsByProject.get(PERSONAL_PROJECT_ID)).toHaveLength(1);
  });

  it("keeps a selected read Personal thread active only while selected", () => {
    const personalThread = makeThread({
      id: "thr_personal_selected",
      projectId: PERSONAL_PROJECT_ID,
    });
    const selectedGroups = buildProjectModeActiveGroups({
      projects,
      threads: [personalThread],
      effectivePinnedThreadIds: new Set(),
      selectedThreadId: personalThread.id,
    });
    const afterNavigation = buildProjectModeActiveGroups({
      projects,
      threads: [personalThread],
      effectivePinnedThreadIds: new Set(),
    });

    expect(selectedGroups.isPersonalActive).toBe(true);
    expect(afterNavigation.isPersonalActive).toBe(false);
  });
});

describe("mergeDormantProjectOrder", () => {
  it("reorders dormant slots without deleting or moving hidden active ids", () => {
    expect(
      mergeDormantProjectOrder({
        fullOrder: [
          "pinned",
          "project:active-a",
          "project:dormant-a",
          "project:active-b",
          "threads",
          "project:dormant-b",
        ],
        dormantSectionIds: new Set([
          "project:dormant-a",
          "threads",
          "project:dormant-b",
        ]),
        nextDormantOrder: ["project:dormant-b", "project:dormant-a", "threads"],
      }),
    ).toEqual([
      "pinned",
      "project:active-a",
      "project:dormant-b",
      "project:active-b",
      "project:dormant-a",
      "threads",
    ]);
  });

  it("retains missing dormant ids instead of corrupting persisted order", () => {
    expect(
      mergeDormantProjectOrder({
        fullOrder: ["project:a", "project:b", "project:c"],
        dormantSectionIds: new Set(["project:a", "project:b", "project:c"]),
        nextDormantOrder: ["project:c", "project:a"],
      }),
    ).toEqual(["project:c", "project:a", "project:b"]);
  });
});
