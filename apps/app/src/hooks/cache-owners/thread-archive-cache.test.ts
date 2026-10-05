import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sidebarNavigationQueryKey } from "../queries/query-keys";
import { getCachedWorkingArchiveThreadCount } from "./thread-archive-cache";

function makeThread(thread: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thread-parent",
    projectId: "project-1",
    environmentId: "env-1",
    title: null,
    ...thread,
  });
}

function makeSidebarNavigation(
  threads: ThreadListEntry[],
): SidebarBootstrapResponse {
  const project = {
    id: "project-1",
    kind: "standard" as const,
    name: "Project",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
    threads,
    defaultExecutionOptions: null,
  };
  return {
    sections: [],
    projects: [project],
    personalProject: {
      ...project,
      id: "proj_personal",
      kind: "personal",
      threads: [],
    },
  };
}

describe("getCachedWorkingArchiveThreadCount", () => {
  it("does not guard an idle thread tree", () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([
        makeThread(),
        makeThread({ id: "thread-child", parentThreadId: "thread-parent" }),
      ]),
    );

    expect(
      getCachedWorkingArchiveThreadCount({
        queryClient,
        threadId: "thread-parent",
      }),
    ).toBe(0);
  });

  it("counts working activity on the thread and its children", () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([
        makeThread({
          runtime: {
            displayStatus: "active",
          },
        }),
        makeThread({
          id: "thread-child",
          parentThreadId: "thread-parent",
          activity: {
            activeWorkflowCount: 0,
            activeBackgroundAgentCount: 1,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeGoalCount: 0,
          },
        }),
        makeThread({
          id: "unrelated-thread",
          activity: {
            activeWorkflowCount: 1,
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeGoalCount: 0,
          },
        }),
      ]),
    );

    expect(
      getCachedWorkingArchiveThreadCount({
        queryClient,
        threadId: "thread-parent",
      }),
    ).toBe(2);
  });
});
