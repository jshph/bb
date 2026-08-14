import { threadSchema, type Thread } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type {
  BuildThreadTimelineOptions,
  ThreadTimelineBuildProfile,
} from "./timeline.js";

export interface TimelineRenderTask {
  id: number;
  options: BuildThreadTimelineOptions;
  thread: Thread;
}

export interface TimelineRenderWorkerReadyMessage {
  type: "ready";
}

export interface TimelineRenderWorkerResultMessage {
  executionDurationMs: number;
  id: number;
  profile: ThreadTimelineBuildProfile;
  response: ThreadTimelineResponse;
  type: "result";
}

export interface TimelineRenderWorkerErrorBody {
  apiCode?: string;
  apiDetails?: object;
  apiRetryable?: boolean;
  apiStatus?: number;
  message: string;
  name: string;
  stack?: string;
}

export interface TimelineRenderWorkerErrorMessage {
  error: TimelineRenderWorkerErrorBody;
  executionDurationMs: number;
  id: number;
  type: "task-error";
}

export type TimelineRenderWorkerResponseMessage =
  | TimelineRenderWorkerReadyMessage
  | TimelineRenderWorkerResultMessage
  | TimelineRenderWorkerErrorMessage;

export interface TimelineRenderWorkerData {
  databasePath: string;
}

export interface TimelineRenderWorkerShutdownMessage {
  type: "shutdown";
}

export type TimelineRenderWorkerRequestMessage =
  | { task: TimelineRenderTask; type: "render" }
  | TimelineRenderWorkerShutdownMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimelineRenderPage(value: unknown): boolean {
  if (
    !isRecord(value) ||
    (value.kind !== "latest" && value.kind !== "older") ||
    typeof value.segmentLimit !== "number"
  ) {
    return false;
  }
  if (value.kind === "latest") {
    return true;
  }
  return (
    isRecord(value.beforeCursor) &&
    typeof value.beforeCursor.anchorId === "string" &&
    typeof value.beforeCursor.anchorSeq === "number"
  );
}

function isTimelineRenderOptions(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.eventBudget === "number" &&
    typeof value.includeProviderUnhandledOperations === "boolean" &&
    (typeof value.maxInlineOutputChars === "number" ||
      value.maxInlineOutputChars === null) &&
    typeof value.maxSeq === "number" &&
    isTimelineRenderPage(value.page) &&
    (value.includeNestedRows === undefined ||
      typeof value.includeNestedRows === "boolean") &&
    (value.providerDisplayName === undefined ||
      typeof value.providerDisplayName === "string") &&
    (value.summaryOnly === undefined || typeof value.summaryOnly === "boolean")
  );
}

export function isTimelineRenderWorkerData(
  value: unknown,
): value is TimelineRenderWorkerData {
  return isRecord(value) && typeof value.databasePath === "string";
}

export function isTimelineRenderWorkerRequestMessage(
  value: unknown,
): value is TimelineRenderWorkerRequestMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "shutdown") {
    return true;
  }
  return (
    value.type === "render" &&
    isRecord(value.task) &&
    typeof value.task.id === "number" &&
    isTimelineRenderOptions(value.task.options) &&
    threadSchema.safeParse(value.task.thread).success
  );
}

export function isTimelineRenderWorkerResponseMessage(
  value: unknown,
): value is TimelineRenderWorkerResponseMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "ready") {
    return true;
  }
  if (typeof value.id !== "number") {
    return false;
  }
  if (value.type === "task-error") {
    return (
      typeof value.executionDurationMs === "number" &&
      isRecord(value.error) &&
      typeof value.error.message === "string" &&
      typeof value.error.name === "string" &&
      (!("apiCode" in value.error) ||
        typeof value.error.apiCode === "string") &&
      (!("apiRetryable" in value.error) ||
        typeof value.error.apiRetryable === "boolean") &&
      (!("apiStatus" in value.error) ||
        typeof value.error.apiStatus === "number") &&
      (!("stack" in value.error) || typeof value.error.stack === "string")
    );
  }
  return (
    value.type === "result" &&
    typeof value.executionDurationMs === "number" &&
    isRecord(value.profile) &&
    typeof value.profile.totalDurationMs === "number" &&
    isRecord(value.response) &&
    typeof value.response.maxSeq === "number" &&
    Array.isArray(value.response.rows) &&
    isRecord(value.response.timelinePage)
  );
}
