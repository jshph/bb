import { describe, expect, it } from "vitest";
import type { ProjectResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { buildProjectModeActiveGroups } from "./projectModeActiveGroups";

function makeProject(id: string, name: string): ProjectResponse {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
  };
}

describe("buildProjectModeActiveGroups", () => {
  it("separates attention projects and orders them alphabetically", () => {
    const projects = [
      makeProject("proj-z", "Zulu"),
      makeProject("proj-a", "Alpha"),
      makeProject("proj-d", "Dormant"),
    ];
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(),
      projects,
      threads: [
        makeThreadListEntry({ id: "z", projectId: "proj-z", status: "active" }),
        makeThreadListEntry({
          id: "a",
          projectId: "proj-a",
          hasPendingInteraction: true,
        }),
        makeThreadListEntry({ id: "d", projectId: "proj-d" }),
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
    const projects = [
      makeProject("parent-project", "Parent"),
      makeProject("child-project", "Child"),
    ];
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(),
      projects,
      threads: [
        makeThreadListEntry({ id: "parent", projectId: "parent-project" }),
        makeThreadListEntry({
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

  it("does not promote a project for pinned activity", () => {
    const project = makeProject("project", "Project");
    const result = buildProjectModeActiveGroups({
      effectivePinnedThreadIds: new Set(["pinned"]),
      projects: [project],
      threads: [
        makeThreadListEntry({
          id: "pinned",
          projectId: project.id,
          status: "active",
        }),
      ],
    });

    expect(result.activeProjects).toEqual([]);
    expect(result.dormantProjects).toEqual([project]);
  });
});
