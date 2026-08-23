import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ServerLogger } from "../../types.js";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

/**
 * Idle/warm-repeat cache for built timeline responses.
 *
 * `buildThreadTimeline` is a pure, deterministic projection of a thread's
 * events. The build (event JSON-decode + projection) is the dominant cost of a
 * timeline request (~130-260ms on large threads) and is recomputed from scratch
 * on every request — there is no other caching. The same window is rebuilt
 * verbatim whenever a thread is refetched without new events: double-mounts
 * (detail view + side-chat tabs), debounced realtime invalidations that fire
 * after the tail already settled, and re-opening a thread.
 *
 * Keying on the thread high-water `maxSeq` makes invalidation implicit: any
 * appended event bumps `maxSeq`, producing a new key and a cold rebuild. The
 * key MUST also include every other input the projection depends on:
 * `thread.status` (interrupt flips earlier rows), `environmentId` (workspace
 * root relativizes file paths), provider display name (labels dynamic-provider
 * diagnostic rows), and the row-shape request flags. Event pruning
 * (`pruneResolvedItemDeltas`, background-task progress) is output-preserving
 * and never lowers `maxSeq`, so it cannot stale a cached entry.
 *
 * Entries with many rows are not cached: an expanded active turn (the streaming
 * case) produces hundreds of rows AND a `maxSeq` that changes on every event,
 * so caching it only thrashes the LRU and pins large objects for no reuse. Idle
 * windows collapse completed turns to a handful of rows regardless of thread
 * size, so the cap excludes exactly the entries that would never be reused.
 */

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 200;

export interface ThreadTimelineCacheOptions {
  logger?: Pick<ServerLogger, "debug">;
  maxEntries?: number;
  /** Responses with more rows than this are returned but not stored. */
  maxCacheableRows?: number;
}

export interface ThreadTimelineCache {
  getOrBuild(
    key: string,
    signal: AbortSignal,
    build: (signal: AbortSignal) => Promise<ThreadTimelineResponse>,
  ): Promise<ThreadTimelineResponse>;
  /** Number of currently cached entries (for tests/metrics). */
  readonly size: number;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const entries = new Map<string, ThreadTimelineResponse>();
  interface InFlightBuild {
    controller: AbortController;
    consumerCount: number;
    promise: Promise<ThreadTimelineResponse>;
    settled: boolean;
  }
  const inFlight = new Map<string, InFlightBuild>();

  function subscribe(
    key: string,
    build: InFlightBuild,
    signal: AbortSignal,
  ): Promise<ThreadTimelineResponse> {
    if (signal.aborted) {
      return Promise.reject(
        new DOMException("Timeline request was canceled", "AbortError"),
      );
    }
    build.consumerCount += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        build.consumerCount -= 1;
      };
      const onAbort = (): void => {
        release();
        options.logger?.debug(
          { cacheKey: key },
          "Timeline render in-flight consumer canceled",
        );
        reject(new DOMException("Timeline request was canceled", "AbortError"));
        if (!build.settled && build.consumerCount === 0) {
          build.controller.abort();
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      build.promise.then(
        (value) => {
          if (!settled) {
            release();
            resolve(value);
          }
        },
        (error: Error) => {
          if (!settled) {
            release();
            reject(error);
          }
        },
      );
    });
  }

  return {
    getOrBuild(key, signal, build) {
      if (signal.aborted) {
        return Promise.reject(
          new DOMException("Timeline request was canceled", "AbortError"),
        );
      }
      const cached = entries.get(key);
      if (cached !== undefined) {
        // Re-insert to mark most-recently-used.
        entries.delete(key);
        entries.set(key, cached);
        options.logger?.debug({ cacheKey: key }, "Timeline render cache hit");
        return Promise.resolve(cached);
      }

      const existingBuild = inFlight.get(key);
      if (existingBuild !== undefined) {
        options.logger?.debug(
          { cacheKey: key },
          "Timeline render in-flight hit",
        );
        return subscribe(key, existingBuild, signal);
      }

      const controller = new AbortController();
      const activeBuild: InFlightBuild = {
        controller,
        consumerCount: 0,
        promise: Promise.resolve().then(() => build(controller.signal)),
        settled: false,
      };
      activeBuild.promise = activeBuild.promise.then((value) => {
        if (
          !controller.signal.aborted &&
          value.rows.length <= maxCacheableRows
        ) {
          entries.set(key, value);
          while (entries.size > maxEntries) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) {
              break;
            }
            entries.delete(oldest);
          }
        }
        return value;
      });
      inFlight.set(key, activeBuild);
      void activeBuild.promise
        .finally(() => {
          activeBuild.settled = true;
          if (inFlight.get(key) === activeBuild) {
            inFlight.delete(key);
          }
        })
        .catch(() => undefined);
      return subscribe(key, activeBuild, signal);
    },
    get size() {
      return entries.size;
    },
  };
}

export interface ThreadTimelineCacheKeyArgs {
  threadId: string;
  /** Thread high-water event sequence; bumps on every appended event. */
  maxSeq: number;
  status: ThreadStatus;
  environmentId: string | null;
  providerDisplayName?: string;
  page: ThreadTimelinePageRequest;
  includeNestedRows: boolean;
  summaryOnly: boolean;
  includeProviderUnhandledOperations: boolean;
}

function pageKeyPart(page: ThreadTimelinePageRequest): string {
  return page.kind === "older"
    ? `older:${page.segmentLimit}:${page.beforeCursor.anchorSeq}:${page.beforeCursor.anchorId}`
    : `latest:${page.segmentLimit}`;
}

/**
 * The cache identity *excluding* `maxSeq` — i.e. everything that selects which
 * window is being requested, but not which revision of it. Used to track the
 * latest-sent rows per request shape for delta computation.
 */
export function buildThreadTimelineParamsKey(
  args: Omit<ThreadTimelineCacheKeyArgs, "maxSeq">,
): string {
  return [
    args.threadId,
    args.status,
    args.environmentId ?? "-",
    args.providerDisplayName ?? "-",
    pageKeyPart(args.page),
    args.includeNestedRows ? "1" : "0",
    args.summaryOnly ? "1" : "0",
    args.includeProviderUnhandledOperations ? "1" : "0",
  ].join("|");
}

export function buildThreadTimelineCacheKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return `${args.maxSeq}|${buildThreadTimelineParamsKey(args)}`;
}
