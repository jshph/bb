import { describe, expect, it } from "vitest";
import { buildProjectModeActiveGroups } from "./project-mode-active-groups.js";
import {
  makeSidebarProject,
  makeSidebarThread,
  type SidebarThreadOverrides,
} from "./fixtures.js";

function makeReadThread(overrides: SidebarThreadOverrides) {
  return makeSidebarThread({
    lastReadAt: 10,
    latestAttentionAt: 10,
    ...overrides,
  });
}

describe("buildProjectModeActiveGroups", () => {
  it("separates attention projects and orders them alphabetically", () => {
    const projects = [
      makeSidebarProject({ id: "proj-z", name: "Zulu" }),
      makeSidebarProject({ id: "proj-a", name: "Alpha" }),
      makeSidebarProject({ id: "proj-d", name: "Dormant" }),
    ];
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(),
      personalProjectId: null,
      projects,
      threads: [
        makeReadThread({ id: "z", projectId: "proj-z", status: "active" }),
        makeReadThread({
          id: "a",
          projectId: "proj-a",
          hasPendingInteraction: true,
        }),
        makeReadThread({ id: "d", projectId: "proj-d" }),
      ],
    });

    expect(result.activeProjects.map((project) => project.name)).toEqual([
      "Alpha",
      "Zulu",
    ]);
    expect(result.dormantProjects.map((project) => project.name)).toEqual([
      "Dormant",
    ]);
  });

  it("promotes the parent project when a cross-project child needs attention", () => {
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(),
      personalProjectId: null,
      projects: [
        makeSidebarProject({ id: "parent-project", name: "Parent" }),
        makeSidebarProject({ id: "child-project", name: "Child" }),
      ],
      threads: [
        makeReadThread({ id: "parent", projectId: "parent-project" }),
        makeReadThread({
          id: "child",
          projectId: "child-project",
          parentThreadId: "parent",
          status: "active",
        }),
      ],
    });

    expect(result.activeProjectIds).toEqual(new Set(["parent-project"]));
    expect(
      result.threadsByProject.get("parent-project")?.map((thread) => thread.id),
    ).toEqual(["parent", "child"]);
  });

  it("does not promote a project for pinned, archived, or hidden activity", () => {
    const project = makeSidebarProject({ id: "project", name: "Project" });
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(["pinned"]),
      personalProjectId: null,
      projects: [project],
      threads: [
        makeReadThread({
          id: "pinned",
          projectId: project.id,
          status: "active",
        }),
        makeReadThread({
          id: "archived",
          projectId: project.id,
          status: "active",
          archivedAt: 5,
          isArchived: true,
        }),
        makeReadThread({
          id: "hidden",
          projectId: project.id,
          hasPendingInteraction: true,
          isHidden: true,
        }),
      ],
    });

    expect(result.activeProjects).toEqual([]);
    expect(result.dormantProjects).toEqual([project]);
  });

  it("marks unread finished work, background activity, and the selected thread as active", () => {
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(),
      personalProjectId: "personal",
      projects: [
        makeSidebarProject({ id: "unread", name: "Unread" }),
        makeSidebarProject({ id: "workflow", name: "Workflow" }),
        makeSidebarProject({ id: "selected", name: "Selected" }),
      ],
      selectedThreadId: "selected-thread",
      threads: [
        makeSidebarThread({
          id: "unread-thread",
          projectId: "unread",
          lastReadAt: 1,
          latestAttentionAt: 5,
        }),
        makeReadThread({
          id: "workflow-thread",
          projectId: "workflow",
          activity: { workflows: 1 },
        }),
        makeReadThread({ id: "selected-thread", projectId: "selected" }),
        makeReadThread({
          id: "personal-thread",
          projectId: "personal",
          hasPendingInteraction: true,
        }),
      ],
    });

    expect(result.activeProjects.map((project) => project.id)).toEqual([
      "selected",
      "unread",
      "workflow",
    ]);
    expect(result.isPersonalActive).toBe(true);
  });
});
