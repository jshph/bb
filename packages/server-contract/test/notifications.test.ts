import { describe, expect, it } from "vitest";
import {
  notificationEventsQuerySchema,
  notificationEventsResponseSchema,
  notificationPushSubscriptionRequestSchema,
} from "../src/index.js";

describe("notification contracts", () => {
  it("accepts cursor feed queries and rejects negative cursors", () => {
    expect(
      notificationEventsQuerySchema.parse({
        afterSequence: "12",
        limit: "100",
      }),
    ).toEqual({ afterSequence: "12", limit: "100" });

    expect(
      notificationEventsQuerySchema.safeParse({ afterSequence: "-1" }).success,
    ).toBe(false);
  });

  it("validates privacy-safe notification event feed payloads", () => {
    expect(
      notificationEventsResponseSchema.safeParse({
        events: [
          {
            sequence: 1,
            id: "ntf_test",
            eventType: "thread.needs_input",
            projectId: "proj_test",
            sourceThreadId: "thr_child",
            targetThreadId: "thr_parent",
            title: "bb needs input",
            body: "Fix notification wiring",
            shouldNotify: true,
            createdAt: 123,
          },
        ],
        nextSequence: 1,
      }).success,
    ).toBe(true);
  });

  it("requires the Web Push endpoint and browser keys", () => {
    expect(
      notificationPushSubscriptionRequestSchema.safeParse({
        endpoint: "https://push.example.test/subscriptions/1",
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      }).success,
    ).toBe(true);

    expect(
      notificationPushSubscriptionRequestSchema.safeParse({
        endpoint: "not-a-url",
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      }).success,
    ).toBe(false);
  });
});
