import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { threadSchema } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import {
  createTimelineRenderWorker,
  type TimelineRenderPriority,
  type TimelineRenderRequest,
} from "../../../src/services/threads/timeline-render-worker.js";
import type {
  TimelineRenderWorkerRequestMessage,
  TimelineRenderWorkerResponseMessage,
} from "../../../src/services/threads/timeline-render-worker-protocol.js";
import type { ThreadTimelineBuildProfile } from "../../../src/services/threads/timeline.js";

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function makeThread(id: string) {
  return threadSchema.parse({
    archivedAt: null,
    childOrigin: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: null,
    id,
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project",
    providerId: "codex",
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: id,
    titleFallback: id,
    updatedAt: 1,
    visibility: "visible",
  });
}

function makeResponse(maxSeq: number): ThreadTimelineResponse {
  return {
    activeBackgroundCommands: [],
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    goal: null,
    maxSeq,
    modelFallback: null,
    pendingTodos: null,
    rows: [],
    timelinePage: {
      hasOlderRows: false,
      kind: "latest",
      olderCursor: null,
      returnedSegmentCount: 0,
      segmentLimit: 20,
    },
  };
}

function makeProfile(): ThreadTimelineBuildProfile {
  return {
    compactedEventCount: 0,
    contextWindowEventDataBytes: 0,
    contextWindowEventRowCount: 0,
    decodedEventCount: 0,
    eventDataBytes: 0,
    eventRowCount: 0,
    pageKind: "latest",
    projectedRowCount: 0,
    responseJsonBytes: null,
    responseRowCount: 0,
    returnedSegmentCount: 0,
    segmentLimit: 20,
    selectionStrategy: "full",
    stageTimings: [],
    totalDurationMs: 0,
  };
}

class FakeWorker extends EventEmitter {
  readonly dispatched: Array<{ id: number; threadId: string }> = [];

  postMessage(message: TimelineRenderWorkerRequestMessage): void {
    if (message.type === "shutdown") {
      queueMicrotask(() => this.emit("exit", 0));
      return;
    }
    this.dispatched.push({
      id: message.task.id,
      threadId: message.task.thread.id,
    });
  }

  ready(): void {
    this.emitMessage({ type: "ready" });
  }

  completeCurrent(): void {
    const current = this.dispatched.at(-1);
    if (!current) {
      throw new Error("No dispatched task to complete");
    }
    this.emitMessage({
      executionDurationMs: 5,
      id: current.id,
      profile: makeProfile(),
      response: makeResponse(current.id),
      type: "result",
    });
  }

  crash(): void {
    this.emit("error", new Error("synthetic worker crash"));
  }

  async terminate(): Promise<number> {
    this.emit("exit", 1);
    return 1;
  }

  unref(): void {}

  private emitMessage(message: TimelineRenderWorkerResponseMessage): void {
    this.emit("message", message);
  }
}

function makeRequest(
  threadId: string,
  priority: TimelineRenderPriority,
  controller = new AbortController(),
): TimelineRenderRequest {
  return {
    options: {
      eventBudget: 100,
      includeProviderUnhandledOperations: false,
      maxInlineOutputChars: 10_000,
      maxSeq: 1,
      page: { kind: "latest", segmentLimit: 20 },
    },
    priority,
    signal: controller.signal,
    thread: makeThread(threadId),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("timeline render worker scheduler", () => {
  it("uses weighted priorities so normal and low work cannot starve", async () => {
    const fake = new FakeWorker();
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      workerFactory: () => fake,
    });
    const promises = [
      service.render(makeRequest("high-a", "high")),
      service.render(makeRequest("high-b", "high")),
      service.render(makeRequest("high-c", "high")),
      service.render(makeRequest("normal", "normal")),
      service.render(makeRequest("low", "low")),
    ];

    fake.ready();
    for (let index = 0; index < promises.length; index += 1) {
      fake.completeCurrent();
      await flush();
    }
    await Promise.all(promises);

    expect(fake.dispatched.map((task) => task.threadId)).toEqual([
      "high-a",
      "normal",
      "high-b",
      "low",
      "high-c",
    ]);
    await service.close();
  });

  it("round-robins threads within a busy priority lane", async () => {
    const fake = new FakeWorker();
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      workerFactory: () => fake,
    });
    const promises = [
      service.render(makeRequest("streaming", "high")),
      service.render(makeRequest("streaming", "high")),
      service.render(makeRequest("other", "high")),
    ];

    fake.ready();
    for (let index = 0; index < promises.length; index += 1) {
      fake.completeCurrent();
      await flush();
    }
    await Promise.all(promises);
    expect(fake.dispatched.map((task) => task.threadId)).toEqual([
      "streaming",
      "other",
      "streaming",
    ]);
    await service.close();
  });

  it("removes queued cancellation and suppresses running delivery", async () => {
    const fake = new FakeWorker();
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      workerFactory: () => fake,
    });
    const queuedController = new AbortController();
    const queued = service.render(
      makeRequest("queued", "high", queuedController),
    );
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    fake.ready();
    expect(fake.dispatched).toHaveLength(0);
    const runningController = new AbortController();
    const running = service.render(
      makeRequest("running", "high", runningController),
    );
    expect(fake.dispatched).toHaveLength(1);
    runningController.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    fake.completeCurrent();
    await flush();
    expect(service.queueSize).toBe(0);
    await service.close();
  });

  it("restarts after a crash and rejects a task after its bounded retry", async () => {
    const workers: FakeWorker[] = [];
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      restartDelayMs: () => 0,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const result = service.render(makeRequest("retry", "high"));

    workers[0]?.ready();
    workers[0]?.crash();
    workers[1]?.ready();
    workers[1]?.crash();
    await expect(result).rejects.toMatchObject({
      body: { code: "timeline_worker_unavailable", retryable: true },
    });
    expect(workers).toHaveLength(3);
    await service.close();
  });

  it("recovers from construction failure and a worker that never becomes ready", async () => {
    const workers: FakeWorker[] = [];
    let constructionAttempts = 0;
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      restartDelayMs: () => 0,
      startupTimeoutMs: 20,
      workerFactory: () => {
        constructionAttempts += 1;
        if (constructionAttempts === 1) {
          throw new Error("synthetic construction failure");
        }
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const result = service.render(makeRequest("startup-retry", "high"));

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(workers.length).toBeGreaterThanOrEqual(2);
    workers.at(-1)?.ready();
    workers.at(-1)?.completeCurrent();
    await expect(result).resolves.toMatchObject({ response: { rows: [] } });
    await service.close();
  });

  it("rejects work beyond the bounded queue", async () => {
    const fake = new FakeWorker();
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      maxQueueSize: 1,
      workerFactory: () => fake,
    });
    const queued = service.render(makeRequest("queued", "normal"));
    await expect(
      service.render(makeRequest("overflow", "high")),
    ).rejects.toMatchObject({
      body: { code: "timeline_worker_unavailable", retryable: true },
    });
    const closed = service.close();
    await expect(queued).rejects.toMatchObject({
      body: { code: "timeline_worker_unavailable" },
    });
    await closed;
  });

  it("rejects queued work and exits cleanly on shutdown", async () => {
    const fake = new FakeWorker();
    const service = createTimelineRenderWorker({
      databasePath: "/unused",
      logger,
      workerFactory: () => fake,
    });
    const queued = service.render(makeRequest("queued", "low"));
    const closed = service.close();
    await expect(queued).rejects.toMatchObject({
      body: { code: "timeline_worker_unavailable" },
    });
    await closed;
    await expect(
      service.render(makeRequest("after-close", "high")),
    ).rejects.toMatchObject({ body: { code: "timeline_worker_unavailable" } });
  });
});
