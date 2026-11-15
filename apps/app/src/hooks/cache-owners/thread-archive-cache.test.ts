import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sidebarNavigationQueryKey } from "../queries/query-keys";
import { listCachedWorkingThreadIds } from "./thread-archive-cache";

type ThreadOverrides = Parameters<typeof makeThreadListEntry>[0];

function makeThread(thread: ThreadOverrides = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thread-parent",
    projectId: "project-1",
    environmentId: "env-1",
    title: null,
    ...thread,
  });
}

function seedSidebar(threads: ThreadListEntry[]) {
  const { queryClient } = createQueryClientTestHarness();
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      projects: [makeProjectWithThreadsResponse({ id: "project-1", threads })],
    }),
  );
  return queryClient;
}

describe("listCachedWorkingThreadIds", () => {
  it("does not guard an idle thread tree", () => {
    const queryClient = seedSidebar([
      makeThread(),
      makeThread({ id: "thread-child", parentThreadId: "thread-parent" }),
    ]);

    expect(
      listCachedWorkingThreadIds({
        queryClient,
        threadIds: ["thread-parent", "thread-child"],
      }),
    ).toEqual([]);
  });

  it("reports runtime and background activity only for the requested threads", () => {
    const queryClient = seedSidebar([
      makeThread({ runtime: { displayStatus: "provisioning" } }),
      makeThread({
        id: "thread-child",
        parentThreadId: "thread-parent",
        activity: { activeBackgroundAgentCount: 1 },
      }),
      makeThread({
        id: "thread-grandchild",
        parentThreadId: "thread-child",
        activity: { activePlanModeCount: 1 },
      }),
      makeThread({
        id: "unrelated-thread",
        activity: { activeWorkflowCount: 1 },
      }),
    ]);

    expect(
      listCachedWorkingThreadIds({
        queryClient,
        threadIds: [
          "thread-parent",
          "thread-child",
          "thread-grandchild",
          "thread-uncached",
        ],
      }),
    ).toEqual(["thread-parent", "thread-child", "thread-grandchild"]);
  });

  it("ignores archived threads that still report activity", () => {
    const queryClient = seedSidebar([
      makeThread({
        archivedAt: 2,
        status: "active",
        activity: { activeBackgroundCommandCount: 1 },
      }),
    ]);

    expect(
      listCachedWorkingThreadIds({
        queryClient,
        threadIds: ["thread-parent"],
      }),
    ).toEqual([]);
  });
});
