import { describe, expect, it, vi } from "vitest";
import {
  createNotificationEvent,
  listActiveNotificationSubscriptions,
  upsertNotificationSubscription,
} from "@bb/db";
import { deliverNotificationEventBestEffort } from "../../src/services/notifications/web-push.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

const webPushMock = vi.hoisted(() => ({
  generateVAPIDKeys: vi.fn(() => ({
    publicKey: "public-key",
    privateKey: "private-key",
  })),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: webPushMock,
}));

describe("web push notification delivery", () => {
  it("disables expired subscriptions after push provider 410 responses", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      upsertNotificationSubscription(harness.db, {
        endpoint: "https://push.example.test/expired",
        p256dh: "p256dh-key",
        auth: "auth-key",
        userAgent: "test-agent",
      });
      const event = createNotificationEvent(harness.db, {
        eventType: "thread.failed",
        idempotencyKey: "thread.failed:web-push-test",
        projectId: project.id,
        sourceThreadId: thread.id,
        targetThreadId: thread.id,
        title: "bb thread failed",
        body: "Run notification delivery",
        shouldNotify: true,
      });
      webPushMock.sendNotification.mockRejectedValueOnce({ statusCode: 410 });

      await deliverNotificationEventBestEffort(harness.db, testLogger, event);

      expect(webPushMock.sendNotification).toHaveBeenCalledWith(
        {
          endpoint: "https://push.example.test/expired",
          keys: {
            p256dh: "p256dh-key",
            auth: "auth-key",
          },
        },
        expect.stringContaining('"id":"'),
      );
      expect(listActiveNotificationSubscriptions(harness.db)).toEqual([]);
    });
  });
});
