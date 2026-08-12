import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import {
  buildRecentPromptRoots,
  RECENT_PROMPT_WINDOW_MS,
} from "./recentPromptRoots";

function makeThread(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    ...makeThreadListEntry({ id, projectId: "project-a" }),
    ...overrides,
  };
}

describe("buildRecentPromptRoots", () => {
  const now = 2 * RECENT_PROMPT_WINDOW_MS;
  const projectNamesById = new Map([
    ["project-a", "Alpha"],
    ["project-b", "Beta"],
  ]);

  it("deduplicates descendant prompts to roots and orders by newest prompt", () => {
    const roots = buildRecentPromptRoots({
      now,
      projectNamesById,
      threads: [
        makeThread("root-a"),
        makeThread("child-a", {
          parentThreadId: "root-a",
        }),
        makeThread("root-b", {
          projectId: "project-b",
        }),
      ],
      recentUserPrompts: [
        { threadId: "root-a", latestUserPromptAt: now - 5_000 },
        { threadId: "child-a", latestUserPromptAt: now - 1_000 },
        { threadId: "root-b", latestUserPromptAt: now - 2_000 },
      ],
    });

    expect(roots.map((entry) => entry.thread.id)).toEqual(["root-a", "root-b"]);
    expect(roots[0]).toMatchObject({
      latestUserPromptAt: now - 1_000,
      projectName: "Alpha",
    });
  });

  it("expires entries outside the rolling window", () => {
    const roots = buildRecentPromptRoots({
      now,
      projectNamesById,
      threads: [makeThread("inside"), makeThread("outside")],
      recentUserPrompts: [
        {
          threadId: "inside",
          latestUserPromptAt: now - RECENT_PROMPT_WINDOW_MS,
        },
        {
          threadId: "outside",
          latestUserPromptAt: now - RECENT_PROMPT_WINDOW_MS - 1,
        },
      ],
    });

    expect(roots.map((entry) => entry.thread.id)).toEqual(["inside"]);
  });

  it("excludes hidden, archived, and orphaned descendants", () => {
    const roots = buildRecentPromptRoots({
      now,
      projectNamesById,
      threads: [
        makeThread("hidden", {
          visibility: "hidden",
        }),
        makeThread("archived", {
          archivedAt: now,
        }),
        makeThread("orphan", {
          parentThreadId: "missing",
        }),
      ],
      recentUserPrompts: [
        { threadId: "hidden", latestUserPromptAt: now },
        { threadId: "archived", latestUserPromptAt: now },
        { threadId: "orphan", latestUserPromptAt: now },
      ],
    });

    expect(roots).toEqual([]);
  });
});
