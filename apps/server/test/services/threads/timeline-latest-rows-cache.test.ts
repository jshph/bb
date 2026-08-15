import { describe, expect, it } from "vitest";
import { createTimelineLatestRowsCache } from "../../../src/services/threads/timeline-latest-rows-cache.js";

describe("createTimelineLatestRowsCache", () => {
  it("does not let an older async completion replace a newer revision", async () => {
    const cache = createTimelineLatestRowsCache();
    let completeOlder: (() => void) | undefined;
    let completeNewer: (() => void) | undefined;
    const olderReady = new Promise<void>((resolve) => {
      completeOlder = resolve;
    });
    const newerReady = new Promise<void>((resolve) => {
      completeNewer = resolve;
    });
    const storeOlder = olderReady.then(() => {
      cache.set("shape", { maxSeq: 10, rows: [] });
    });
    const storeNewer = newerReady.then(() => {
      cache.set("shape", { maxSeq: 11, rows: [] });
    });

    completeNewer?.();
    await storeNewer;
    completeOlder?.();
    await storeOlder;

    expect(cache.get("shape")).toEqual({
      maxSeq: 11,
      rows: [],
    });
  });
});
