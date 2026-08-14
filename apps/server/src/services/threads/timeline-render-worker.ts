import { performance } from "node:perf_hooks";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type { Thread } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type {
  BuildThreadTimelineOptions,
  ThreadTimelineBuildProfile,
} from "./timeline.js";
import {
  isTimelineRenderWorkerResponseMessage,
  type TimelineRenderTask,
  type TimelineRenderWorkerErrorBody,
  type TimelineRenderWorkerRequestMessage,
} from "./timeline-render-worker-protocol.js";

export type TimelineRenderPriority = "high" | "normal" | "low";

export interface TimelineRenderResult {
  profile: ThreadTimelineBuildProfile;
  response: ThreadTimelineResponse;
}

export interface TimelineRenderRequest {
  options: BuildThreadTimelineOptions;
  priority: TimelineRenderPriority;
  signal: AbortSignal;
  thread: Thread;
}

interface TimelineWorkerHandle {
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (exitCode: number) => void): this;
  on(event: "message", listener: (value: unknown) => void): this;
  once(event: "exit", listener: (exitCode: number) => void): this;
  postMessage(message: TimelineRenderWorkerRequestMessage): void;
  terminate(): Promise<number>;
  unref(): void;
}

interface QueuedTimelineRender {
  abortListener: () => void;
  attempts: number;
  dispatchedAt: number | null;
  enqueuedAt: number;
  priority: TimelineRenderPriority;
  reject: (error: Error) => void;
  request: TimelineRenderRequest;
  resolve: (result: TimelineRenderResult) => void;
  settled: boolean;
  task: TimelineRenderTask;
}

export interface CreateTimelineRenderWorkerOptions {
  databasePath: string;
  logger: TimelineRenderWorkerLogger;
  maxQueueSize?: number;
  /** Injectable for deterministic crash/restart tests. */
  restartDelayMs?: (consecutiveFailures: number) => number;
  /** Injectable for deterministic startup-timeout tests. */
  startupTimeoutMs?: number;
  workerFactory?: (url: URL, options: WorkerOptions) => TimelineWorkerHandle;
  workerUrl?: URL;
}

interface TimelineRenderWorkerLogger {
  debug(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
}

export interface TimelineRenderWorkerService {
  close(): Promise<void>;
  render(request: TimelineRenderRequest): Promise<TimelineRenderResult>;
  readonly queueSize: number;
}

const DEFAULT_MAX_QUEUE_SIZE = 64;
const MAX_TASK_ATTEMPTS = 2;
const MAX_CONSECUTIVE_FAILURES_WITHOUT_RESULT = 5;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 30_000;
const PRIORITY_SCHEDULE: readonly TimelineRenderPriority[] = [
  "high",
  "normal",
  "high",
  "low",
  "high",
  "normal",
];

function abortError(): Error {
  return new DOMException("Timeline request was canceled", "AbortError");
}

function unavailableError(message: string): ApiError {
  return new ApiError(503, "timeline_worker_unavailable", message, {
    retryable: true,
  });
}

function taskError(error: TimelineRenderWorkerErrorBody): Error {
  if (error.apiStatus === 400 && error.apiCode !== undefined) {
    return new ApiError(400, error.apiCode, error.message, {
      retryable: error.apiRetryable,
    });
  }
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack !== undefined) {
    result.stack = error.stack;
  }
  return result;
}

export function inferTimelineRenderPriority(args: {
  afterSequence: number | undefined;
  pageKind: "latest" | "older";
}): TimelineRenderPriority {
  if (args.pageKind === "older") {
    return "low";
  }
  return args.afterSequence === undefined ? "high" : "normal";
}

export function createTimelineRenderWorker(
  options: CreateTimelineRenderWorkerOptions,
): TimelineRenderWorkerService {
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const workerUrl =
    options.workerUrl ??
    new URL("./timeline-render-worker-entry.js", import.meta.url);
  const workerFactory =
    options.workerFactory ??
    ((url: URL, workerOptions: WorkerOptions) =>
      new Worker(url, workerOptions));
  const queues: Record<TimelineRenderPriority, QueuedTimelineRender[]> = {
    high: [],
    normal: [],
    low: [],
  };
  let worker: TimelineWorkerHandle | null = null;
  let workerReady = false;
  let running: QueuedTimelineRender | null = null;
  let nextTaskId = 1;
  let scheduleIndex = 0;
  let lastThreadId: string | null = null;
  let closing = false;
  let restartCount = 0;
  let consecutiveFailures = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let workerGeneration = 0;
  let lastFailedGeneration = 0;

  function queueSize(): number {
    return queues.high.length + queues.normal.length + queues.low.length;
  }

  function removeQueued(target: QueuedTimelineRender): boolean {
    const lane = queues[target.priority];
    const index = lane.indexOf(target);
    if (index === -1) {
      return false;
    }
    lane.splice(index, 1);
    return true;
  }

  function settleRejected(target: QueuedTimelineRender, error: Error): void {
    if (target.settled) {
      return;
    }
    target.settled = true;
    target.request.signal.removeEventListener("abort", target.abortListener);
    target.reject(error);
  }

  function settleResolved(
    target: QueuedTimelineRender,
    result: TimelineRenderResult,
  ): void {
    if (target.settled) {
      return;
    }
    target.settled = true;
    target.request.signal.removeEventListener("abort", target.abortListener);
    target.resolve(result);
  }

  function takeNext(): QueuedTimelineRender | null {
    for (let offset = 0; offset < PRIORITY_SCHEDULE.length; offset += 1) {
      const index = (scheduleIndex + offset) % PRIORITY_SCHEDULE.length;
      const priority = PRIORITY_SCHEDULE[index];
      const lane = queues[priority];
      if (lane.length === 0) {
        continue;
      }
      scheduleIndex = (index + 1) % PRIORITY_SCHEDULE.length;
      const fairIndex = lane.findIndex(
        (candidate) => candidate.task.thread.id !== lastThreadId,
      );
      const selectedIndex = fairIndex === -1 ? 0 : fairIndex;
      const selected = lane.splice(selectedIndex, 1)[0];
      return selected ?? null;
    }
    return null;
  }

  function dispatch(): void {
    if (closing || !workerReady || worker === null || running !== null) {
      return;
    }
    let next = takeNext();
    while (next?.request.signal.aborted) {
      settleRejected(next, abortError());
      next = takeNext();
    }
    if (!next) {
      return;
    }
    running = next;
    next.dispatchedAt = performance.now();
    lastThreadId = next.task.thread.id;
    next.attempts += 1;
    options.logger.debug(
      {
        attempts: next.attempts,
        priority: next.priority,
        queueSize: queueSize(),
        queueWaitMs: performance.now() - next.enqueuedAt,
        taskId: next.task.id,
        threadId: next.task.thread.id,
      },
      "Timeline render worker task started",
    );
    worker.postMessage({ task: next.task, type: "render" });
  }

  function rejectAll(error: Error): void {
    if (running !== null) {
      settleRejected(running, error);
      running = null;
    }
    for (const priority of ["high", "normal", "low"] as const) {
      for (const queued of queues[priority].splice(0)) {
        settleRejected(queued, error);
      }
    }
  }

  function clearStartupTimer(): void {
    if (startupTimer !== null) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
  }

  function handleWorkerFailure(error: Error, generation: number): void {
    if (
      lastFailedGeneration === generation ||
      generation !== workerGeneration ||
      closing
    ) {
      return;
    }
    lastFailedGeneration = generation;
    clearStartupTimer();
    workerReady = false;
    worker = null;
    restartCount += 1;
    consecutiveFailures += 1;
    const interrupted = running;
    running = null;
    if (interrupted !== null) {
      if (
        interrupted.attempts < MAX_TASK_ATTEMPTS &&
        !interrupted.request.signal.aborted
      ) {
        queues[interrupted.priority].unshift(interrupted);
      } else {
        settleRejected(
          interrupted,
          unavailableError("Timeline render worker crashed while building"),
        );
      }
    }
    options.logger.error(
      {
        err: error,
        queuedTaskCount: queueSize(),
        restartCount,
        consecutiveFailures,
        workerGeneration: generation,
      },
      "Timeline render worker crashed; restarting",
    );
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_WITHOUT_RESULT) {
      rejectAll(
        unavailableError(
          "Timeline render worker repeatedly failed before completing work",
        ),
      );
    }
    const restartDelayMs =
      options.restartDelayMs?.(consecutiveFailures) ??
      Math.min(100 * 2 ** (consecutiveFailures - 1), 5_000);
    if (restartDelayMs === 0) {
      startWorker();
    } else {
      restartTimer = setTimeout(() => {
        restartTimer = null;
        startWorker();
      }, restartDelayMs);
      restartTimer.unref();
    }
  }

  function startWorker(): void {
    if (closing) {
      return;
    }
    workerReady = false;
    const generation = ++workerGeneration;
    let nextWorker: TimelineWorkerHandle;
    try {
      nextWorker = workerFactory(workerUrl, {
        workerData: { databasePath: options.databasePath },
      });
    } catch (error) {
      handleWorkerFailure(
        error instanceof Error ? error : new Error(String(error)),
        generation,
      );
      return;
    }
    nextWorker.unref();
    worker = nextWorker;

    nextWorker.on("message", (value: unknown) => {
      if (generation !== workerGeneration || closing) {
        return;
      }
      if (!isTimelineRenderWorkerResponseMessage(value)) {
        options.logger.error(
          { workerGeneration: generation },
          "Timeline render worker sent an invalid message",
        );
        handleWorkerFailure(
          new Error("Timeline render worker sent an invalid message"),
          generation,
        );
        void nextWorker.terminate();
        return;
      }
      if (value.type === "ready") {
        clearStartupTimer();
        workerReady = true;
        options.logger.info(
          { restartCount, workerGeneration: generation },
          "Timeline render worker ready",
        );
        dispatch();
        return;
      }
      const current = running;
      if (current === null || current.task.id !== value.id) {
        options.logger.warn(
          { taskId: value.id, workerGeneration: generation },
          "Timeline render worker returned an orphaned task",
        );
        return;
      }
      running = null;
      consecutiveFailures = 0;
      if (value.type === "task-error") {
        const handlingStartedAt = performance.now();
        settleRejected(current, taskError(value.error));
        options.logger.debug(
          {
            responseHandlingMs: performance.now() - handlingStartedAt,
            taskId: current.task.id,
            threadId: current.task.thread.id,
            workerExecutionMs: value.executionDurationMs,
          },
          "Timeline render worker task failed",
        );
      } else {
        const handlingStartedAt = performance.now();
        settleResolved(current, {
          profile: value.profile,
          response: value.response,
        });
        options.logger.debug(
          {
            responseHandlingMs: performance.now() - handlingStartedAt,
            transferAndResponseMs:
              current.dispatchedAt === null
                ? null
                : Math.max(
                    0,
                    handlingStartedAt -
                      current.dispatchedAt -
                      value.executionDurationMs,
                  ),
            taskId: current.task.id,
            threadId: current.task.thread.id,
            workerExecutionMs: value.executionDurationMs,
          },
          "Timeline render worker task completed",
        );
      }
      dispatch();
    });
    nextWorker.on("error", (error) => handleWorkerFailure(error, generation));
    nextWorker.on("exit", (exitCode) => {
      handleWorkerFailure(
        new Error(`Timeline render worker exited with code ${exitCode}`),
        generation,
      );
    });
    startupTimer = setTimeout(() => {
      handleWorkerFailure(
        new Error("Timeline render worker did not become ready in time"),
        generation,
      );
      void nextWorker.terminate();
    }, options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
    startupTimer.unref();
  }

  startWorker();

  return {
    render(request) {
      if (closing) {
        return Promise.reject(
          unavailableError("Timeline render worker is shutting down"),
        );
      }
      if (request.signal.aborted) {
        return Promise.reject(abortError());
      }
      if (queueSize() >= maxQueueSize) {
        options.logger.warn(
          { maxQueueSize, priority: request.priority },
          "Timeline render worker queue is full",
        );
        return Promise.reject(
          unavailableError("Timeline render worker queue is full"),
        );
      }

      return new Promise<TimelineRenderResult>((resolve, reject) => {
        const task: TimelineRenderTask = {
          id: nextTaskId++,
          options: request.options,
          thread: request.thread,
        };
        const queued: QueuedTimelineRender = {
          abortListener: () => {
            const wasQueued = removeQueued(queued);
            settleRejected(queued, abortError());
            options.logger.debug(
              {
                stage: wasQueued ? "queued" : "running",
                taskId: task.id,
                threadId: task.thread.id,
              },
              "Timeline render worker task canceled",
            );
          },
          attempts: 0,
          dispatchedAt: null,
          enqueuedAt: performance.now(),
          priority: request.priority,
          reject,
          request,
          resolve,
          settled: false,
          task,
        };
        request.signal.addEventListener("abort", queued.abortListener, {
          once: true,
        });
        queues[request.priority].push(queued);
        options.logger.debug(
          {
            priority: request.priority,
            queueSize: queueSize(),
            taskId: task.id,
            threadId: task.thread.id,
          },
          "Timeline render worker task queued",
        );
        dispatch();
      });
    },
    async close() {
      if (closing) {
        return;
      }
      closing = true;
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      clearStartupTimer();
      rejectAll(unavailableError("Timeline render worker is shutting down"));
      const currentWorker = worker;
      worker = null;
      workerReady = false;
      if (currentWorker === null) {
        return;
      }
      const exited = new Promise<void>((resolve) => {
        currentWorker.once("exit", () => resolve());
      });
      currentWorker.postMessage({ type: "shutdown" });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), SHUTDOWN_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        exited.then(() => "exited" as const),
        timedOut,
      ]);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (outcome === "timeout") {
        options.logger.warn(
          { shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS },
          "Timeline render worker did not stop gracefully; terminating",
        );
        await currentWorker.terminate();
      }
    },
    get queueSize() {
      return queueSize();
    },
  };
}
