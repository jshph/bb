import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";
import { createReadOnlyConnection } from "@bb/db";
import { ApiError } from "../../errors.js";
import { buildThreadTimelineWithProfile } from "./timeline.js";
import { truncateTimelineResponseOutputs } from "./timeline-output-truncation.js";
import {
  isTimelineRenderWorkerData,
  isTimelineRenderWorkerRequestMessage,
  type TimelineRenderWorkerErrorBody,
  type TimelineRenderWorkerResponseMessage,
} from "./timeline-render-worker-protocol.js";

if (!parentPort) {
  throw new Error("Timeline render worker requires a parent port");
}
if (!isTimelineRenderWorkerData(workerData)) {
  throw new Error("Timeline render worker received invalid worker data");
}

const port = parentPort;
const db = createReadOnlyConnection(workerData.databasePath);
let closing = false;

function post(message: TimelineRenderWorkerResponseMessage): void {
  port.postMessage(message);
}

function serializeError(error: unknown): TimelineRenderWorkerErrorBody {
  if (error instanceof ApiError) {
    const body: TimelineRenderWorkerErrorBody = {
      apiCode: error.body.code,
      apiStatus: error.status,
      message: error.message,
      name: error.name,
    };
    if (error.body.retryable !== undefined) {
      body.apiRetryable = error.body.retryable;
    }
    if (error.stack !== undefined) {
      body.stack = error.stack;
    }
    return body;
  }
  if (error instanceof Error) {
    const body: TimelineRenderWorkerErrorBody = {
      message: error.message,
      name: error.name,
    };
    if (error.stack !== undefined) {
      body.stack = error.stack;
    }
    return body;
  }
  return { message: String(error), name: "Error" };
}

port.on("message", (value: unknown) => {
  if (!isTimelineRenderWorkerRequestMessage(value)) {
    throw new Error("Timeline render worker received an invalid message");
  }
  if (value.type === "shutdown") {
    closing = true;
    db.$client.close();
    port.close();
    return;
  }
  if (closing) {
    return;
  }

  const { task } = value;
  const startedAt = performance.now();
  try {
    // Drizzle's deferred transaction begins immediately before the first read.
    // The scheduler sends only the task that has left the queue, so no queued
    // request pins a WAL snapshot.
    const result = db.$client.transaction(() => {
      const built = buildThreadTimelineWithProfile(
        db,
        task.thread,
        task.options,
      );
      return {
        profile: built.profile,
        response:
          task.options.maxInlineOutputChars === null
            ? built.response
            : truncateTimelineResponseOutputs(
                built.response,
                task.options.maxInlineOutputChars,
              ),
      };
    })();
    post({
      executionDurationMs: performance.now() - startedAt,
      id: task.id,
      profile: result.profile,
      response: result.response,
      type: "result",
    });
  } catch (error) {
    post({
      error: serializeError(error),
      executionDurationMs: performance.now() - startedAt,
      id: task.id,
      type: "task-error",
    });
  }
});

post({ type: "ready" });
