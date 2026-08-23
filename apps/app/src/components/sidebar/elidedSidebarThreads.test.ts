import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { compareByCreatedAtDescending } from "@bb/client-core";
import { elideSidebarThreads } from "./elidedSidebarThreads";

function makeThread(
  id: string,
  projectId: string,
  createdAt: number,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThreadListEntry({
    id,
    projectId,
    createdAt,
    updatedAt: createdAt,
    latestAttentionAt: createdAt,
    ...overrides,
  });
}

describe("elideSidebarThreads", () => {
  it("bounds a 1,200-thread project to the first 20 render entries", () => {
    const threads = Array.from({ length: 1_200 }, (_, index) =>
      makeThread(`thread-${index}`, "a", index),
    );
    const result = elideSidebarThreads({
      threads,
      compareThreads: compareByCreatedAtDescending,
      limitPerProject: 20,
    });

    expect(result.threads).toHaveLength(20);
    expect(result.threads.map((thread) => thread.createdAt)).toEqual(
      Array.from({ length: 20 }, (_, index) => 1_180 + index),
    );
    expect(result.hiddenCount).toBe(1_180);
  });

  it("keeps the newest window independently for each project", () => {
    const result = elideSidebarThreads({
      threads: [
        makeThread("a1", "a", 1),
        makeThread("a2", "a", 2),
        makeThread("a3", "a", 3),
        makeThread("b1", "b", 1),
        makeThread("b2", "b", 2),
        makeThread("b3", "b", 3),
      ],
      compareThreads: compareByCreatedAtDescending,
      limitPerProject: 2,
    });

    expect(result.threads.map((thread) => thread.id)).toEqual([
      "a2",
      "a3",
      "b2",
      "b3",
    ]);
    expect(result.hiddenCount).toBe(2);
  });

  it("keeps an older selected thread and its ancestor chain visible", () => {
    const result = elideSidebarThreads({
      threads: [
        makeThread("parent", "a", 1),
        makeThread("child", "a", 2, { parentThreadId: "parent" }),
        makeThread("newest", "a", 3),
      ],
      compareThreads: compareByCreatedAtDescending,
      limitPerProject: 1,
      selectedThreadId: "child",
    });

    expect(result.threads.map((thread) => thread.id)).toEqual([
      "parent",
      "child",
      "newest",
    ]);
    expect(result.hiddenCount).toBe(0);
  });

  it("does not mount an old child just because its parent is in the window", () => {
    const result = elideSidebarThreads({
      threads: [
        makeThread("parent", "a", 3),
        makeThread("old-child", "a", 1, { parentThreadId: "parent" }),
        makeThread("other", "a", 2),
      ],
      compareThreads: compareByCreatedAtDescending,
      limitPerProject: 2,
    });

    expect(result.threads.map((thread) => thread.id)).toEqual([
      "parent",
      "other",
    ]);
    expect(result.hiddenCount).toBe(1);
  });

  it("excludes hidden threads from both the window and hidden count", () => {
    const result = elideSidebarThreads({
      threads: [
        makeThread("older", "a", 1),
        makeThread("newer", "a", 2),
        makeThread("worker", "a", 3, { visibility: "hidden" }),
      ],
      compareThreads: compareByCreatedAtDescending,
      limitPerProject: 1,
    });

    expect(result.threads.map((thread) => thread.id)).toEqual(["newer"]);
    expect(result.hiddenCount).toBe(1);
  });
});
