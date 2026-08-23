import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { threadScope } from "@bb/domain";
import { insertEvents } from "@bb/db";
import { initDb } from "../../../src/db.js";
import { createTimelineRenderWorker } from "../../../src/services/threads/timeline-render-worker.js";
import { NotificationHub } from "../../../src/ws/hub.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const temporaryDirectories: string[] = [];
const logger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("timeline render worker integration", () => {
  it("uses the source worker entry and never reads past captured maxSeq", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-timeline-worker-"));
    temporaryDirectories.push(dataDir);
    const databasePath = join(dataDir, "bb.db");
    const db = initDb(databasePath);
    const hub = new NotificationHub();
    const { environment, thread } = seedThreadFixture({ deps: { db, hub } });
    seedEvent(
      { db, hub },
      {
        data: { text: "captured revision" },
        environmentId: environment.id,
        scope: threadScope(),
        sequence: 1,
        threadId: thread.id,
        type: "system/manager/user_message",
      },
    );

    const worker = createTimelineRenderWorker({
      databasePath,
      logger,
      workerFactory: (url, options) =>
        new Worker(url, {
          ...options,
          execArgv: ["--import", "tsx"],
        }),
    });
    const render = worker.render({
      options: {
        eventBudget: 1_500,
        includeProviderUnhandledOperations: false,
        maxInlineOutputChars: 20_000,
        maxSeq: 1,
        page: { kind: "latest", segmentLimit: 20 },
      },
      priority: "high",
      signal: new AbortController().signal,
      thread,
    });

    // The worker has not reported ready yet, so this append is guaranteed to
    // precede its read transaction while following the request's captured
    // revision. Every related query must still behave as of sequence 1.
    seedEvent(
      { db, hub },
      {
        data: { text: "must not leak" },
        environmentId: environment.id,
        scope: threadScope(),
        sequence: 2,
        threadId: thread.id,
        type: "system/manager/user_message",
      },
    );

    try {
      const result = await render;
      expect(result.response.maxSeq).toBe(1);
      expect(JSON.stringify(result.response.rows)).toContain(
        "captured revision",
      );
      expect(JSON.stringify(result.response.rows)).not.toContain(
        "must not leak",
      );
    } finally {
      await worker.close();
      db.$client.close();
    }
  }, 45_000);

  it("keeps the main server health route responsive during a large projection", async () => {
    await withTestHarness(async (harness) => {
      const dataDir = await mkdtemp(join(tmpdir(), "bb-timeline-worker-"));
      temporaryDirectories.push(dataDir);
      const databasePath = join(dataDir, "bb.db");
      const db = initDb(databasePath);
      const hub = new NotificationHub();
      const { environment, thread } = seedThreadFixture({ deps: { db, hub } });
      const eventCount = 3_000;
      const events: Parameters<typeof insertEvents>[2] = [];
      for (let sequence = 1; sequence <= eventCount; sequence += 1) {
        events.push({
          data: JSON.stringify({ text: `message ${sequence}` }),
          environmentId: environment.id,
          itemId: null,
          itemKind: null,
          parentToolCallId: null,
          scope: threadScope(),
          sequence,
          threadId: thread.id,
          type: "system/manager/user_message",
        });
      }
      insertEvents(db, hub, events);
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const worker = createTimelineRenderWorker({
        databasePath,
        logger: {
          ...logger,
          debug(_bindings: object, message: string): void {
            if (message === "Timeline render worker task started") {
              markStarted?.();
            }
          },
        },
        workerFactory: (url, options) =>
          new Worker(url, {
            ...options,
            execArgv: ["--import", "tsx"],
          }),
      });
      let renderSettled = false;
      const render = worker
        .render({
          options: {
            eventBudget: 1_000_000,
            includeProviderUnhandledOperations: false,
            maxInlineOutputChars: 20_000,
            maxSeq: eventCount,
            page: { kind: "latest", segmentLimit: 3_001 },
          },
          priority: "high",
          signal: new AbortController().signal,
          thread,
        })
        .finally(() => {
          renderSettled = true;
        });

      try {
        await started;
        await new Promise<void>((resolve) => setImmediate(resolve));
        const health = await harness.app.request("/health");
        expect(health.status).toBe(200);
        await expect(health.json()).resolves.toEqual({ ok: true });
        expect(renderSettled).toBe(false);
        const result = await render;
        expect(result.profile.eventRowCount).toBe(eventCount);
        expect(result.response.rows.length).toBeGreaterThan(2_500);
      } finally {
        await worker.close();
        db.$client.close();
      }
    });
  }, 60_000);
});
