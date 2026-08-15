import { describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { NotificationEvent } from "@bb/server-contract";
import {
  fetchNotificationEvents,
  formatNotificationEventsUrl,
  routeForNotificationEvent,
} from "../src/notification-events.js";

function notificationEvent(
  overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
  return {
    sequence: 7,
    id: "ntf_test",
    eventType: "thread.needs_input",
    projectId: "proj_test",
    sourceThreadId: "thr_source",
    targetThreadId: "thr_target",
    title: "bb needs input",
    body: "Investigate notifications",
    shouldNotify: true,
    createdAt: 123,
    ...overrides,
  };
}

describe("desktop notification events", () => {
  it("formats the cursor feed URL without preserving unrelated path state", () => {
    expect(
      formatNotificationEventsUrl({
        afterSequence: 42,
        serverUrl: "https://bb.example.test/projects/proj_1?x=1#old",
      }),
    ).toBe(
      "https://bb.example.test/api/v1/system/notifications/events?afterSequence=42&limit=100",
    );
  });

  it("parses fetched notification events through the server contract", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          events: [notificationEvent()],
          nextSequence: 7,
        }),
        { status: 200 },
      );
    });

    const response = await fetchNotificationEvents({
      afterSequence: 6,
      fetchImpl,
      serverUrl: "http://127.0.0.1:38886",
    });

    expect(response.nextSequence).toBe(7);
    expect(response.events[0]?.id).toBe("ntf_test");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:38886/api/v1/system/notifications/events?afterSequence=6&limit=100",
    );
  });

  it("routes clicks to the target thread, including personal project threads", () => {
    expect(routeForNotificationEvent(notificationEvent())).toBe(
      "/projects/proj_test/threads/thr_target",
    );
    expect(
      routeForNotificationEvent(
        notificationEvent({
          projectId: PERSONAL_PROJECT_ID,
          targetThreadId: "thr target/with space",
        }),
      ),
    ).toBe("/threads/thr%20target%2Fwith%20space");
  });
});
