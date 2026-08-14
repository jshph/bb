import { describe, expect, it, vi } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadTimelinePageRequest } from "../../../src/services/threads/timeline-pagination.js";
import {
  buildThreadTimelineCacheKey,
  createThreadTimelineCache,
  type ThreadTimelineCacheKeyArgs,
} from "../../../src/services/threads/timeline-cache.js";

function makeResponse(rowCount: number): ThreadTimelineResponse {
  return {
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      kind: "system",
      threadId: "thr_x",
      turnId: null,
      sourceSeqStart: index,
      sourceSeqEnd: index,
      startedAt: 0,
      createdAt: 0,
      systemKind: "debug",
      title: "t",
      detail: null,
      status: null,
    })),
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

const latestPage: ThreadTimelinePageRequest = {
  kind: "latest",
  segmentLimit: 20,
};

const baseKeyArgs: ThreadTimelineCacheKeyArgs = {
  threadId: "thr_x",
  maxSeq: 10,
  status: "idle",
  environmentId: null,
  page: latestPage,
  includeNestedRows: false,
  summaryOnly: false,
  includeProviderUnhandledOperations: false,
};

describe("createThreadTimelineCache", () => {
  it("builds once for the same key and serves cached on repeat", async () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(async () => makeResponse(3));
    const signal = new AbortController().signal;

    const first = await cache.getOrBuild("k", signal, build);
    const second = await cache.getOrBuild("k", signal, build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("rebuilds when the key changes (e.g. new maxSeq)", async () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(async () => makeResponse(3));
    const signal = new AbortController().signal;

    await cache.getOrBuild("k1", signal, build);
    await cache.getOrBuild("k2", signal, build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("does not cache responses above the row cap (streaming expanded turns)", async () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 5 });
    const build = vi.fn(async () => makeResponse(50));
    const signal = new AbortController().signal;

    await cache.getOrBuild("k", signal, build);
    await cache.getOrBuild("k", signal, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("evicts least-recently-used entries beyond maxEntries", async () => {
    const cache = createThreadTimelineCache({ maxEntries: 2 });
    const build = vi.fn(async () => makeResponse(1));
    const signal = new AbortController().signal;

    await cache.getOrBuild("a", signal, build); // [a]
    await cache.getOrBuild("b", signal, build); // [a,b]
    await cache.getOrBuild("a", signal, build); // touch a -> [b,a]
    await cache.getOrBuild("c", signal, build); // evict b -> [a,c]

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(async () => makeResponse(1));
    await cache.getOrBuild("a", signal, buildAgain); // still cached
    await cache.getOrBuild("b", signal, buildAgain); // evicted -> rebuild
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });

  it("coalesces exact-key in-flight builds while keeping consumers independent", async () => {
    const cache = createThreadTimelineCache();
    let finishBuild: ((value: ThreadTimelineResponse) => void) | undefined;
    const build = vi.fn(
      () =>
        new Promise<ThreadTimelineResponse>((resolve) => {
          finishBuild = resolve;
        }),
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = cache.getOrBuild("same", firstController.signal, build);
    const second = cache.getOrBuild("same", secondController.signal, build);
    await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(1);

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finishBuild?.(makeResponse(2));
    await expect(second).resolves.toEqual(makeResponse(2));
  });

  it("cancels the shared build only after every consumer cancels", async () => {
    const cache = createThreadTimelineCache();
    const firstController = new AbortController();
    const secondController = new AbortController();
    let buildSignal: AbortSignal | undefined;
    const build = vi.fn(
      (signal: AbortSignal) =>
        new Promise<ThreadTimelineResponse>(() => {
          buildSignal = signal;
        }),
    );

    const first = cache.getOrBuild("same", firstController.signal, build);
    const second = cache.getOrBuild("same", secondController.signal, build);
    await Promise.resolve();
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(buildSignal?.aborted).toBe(false);
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(buildSignal?.aborted).toBe(true);
  });
});

describe("buildThreadTimelineCacheKey", () => {
  it("differs when any projection input differs", () => {
    const base = buildThreadTimelineCacheKey(baseKeyArgs);
    const variants: ThreadTimelineCacheKeyArgs[] = [
      { ...baseKeyArgs, maxSeq: 11 },
      { ...baseKeyArgs, status: "active" },
      { ...baseKeyArgs, environmentId: "env_1" },
      { ...baseKeyArgs, includeNestedRows: true },
      { ...baseKeyArgs, summaryOnly: true },
      { ...baseKeyArgs, includeProviderUnhandledOperations: true },
      {
        ...baseKeyArgs,
        page: {
          kind: "older",
          segmentLimit: 20,
          beforeCursor: { anchorSeq: 5, anchorId: "a5" },
        },
      },
    ];
    for (const variant of variants) {
      expect(buildThreadTimelineCacheKey(variant)).not.toBe(base);
    }
  });

  it("distinguishes older-page cursors", () => {
    const cursorA = buildThreadTimelineCacheKey({
      ...baseKeyArgs,
      page: {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: { anchorSeq: 5, anchorId: "a5" },
      },
    });
    const cursorB = buildThreadTimelineCacheKey({
      ...baseKeyArgs,
      page: {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: { anchorSeq: 6, anchorId: "a6" },
      },
    });
    expect(cursorA).not.toBe(cursorB);
  });
});
