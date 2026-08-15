import { describe, expect, it } from "vitest";
import {
  createConnection,
  createNotificationEvent,
  createProject,
  createThread,
  disableNotificationSubscriptionByEndpoint,
  listActiveNotificationSubscriptions,
  listNotificationEvents,
  migrate,
  noopNotifier,
  upsertNotificationSubscription,
  upsertHost,
} from "../src/index.js";

function createTestThread() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    id: "host_test",
    name: "Test host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Notifications",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/bb-notifications",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    title: "Investigate notifications",
    status: "active",
  });
  return { db, project, thread };
}

describe("notification events", () => {
  it("deduplicates events by idempotency key", () => {
    const { db, project, thread } = createTestThread();
    const first = db.transaction((tx) =>
      createNotificationEvent(tx, {
        eventType: "thread.failed",
        idempotencyKey: "thread.failed:thread-1:100",
        projectId: project.id,
        sourceThreadId: thread.id,
        targetThreadId: thread.id,
        title: "bb thread failed",
        body: "Investigate notifications",
        shouldNotify: true,
      }),
    );
    const second = db.transaction((tx) =>
      createNotificationEvent(tx, {
        eventType: "thread.failed",
        idempotencyKey: "thread.failed:thread-1:100",
        projectId: project.id,
        sourceThreadId: thread.id,
        targetThreadId: thread.id,
        title: "bb thread failed",
        body: "Investigate notifications",
        shouldNotify: true,
      }),
    );

    expect(second.id).toBe(first.id);
    expect(
      listNotificationEvents(db, { afterSequence: 0, limit: 10 }),
    ).toHaveLength(1);
  });

  it("lists events after a cursor in sequence order", () => {
    const { db, project, thread } = createTestThread();
    const first = db.transaction((tx) =>
      createNotificationEvent(tx, {
        eventType: "thread.needs_input",
        idempotencyKey: "thread.needs_input:pending-1",
        projectId: project.id,
        sourceThreadId: thread.id,
        targetThreadId: thread.id,
        title: "bb needs input",
        body: "Investigate notifications",
        shouldNotify: true,
      }),
    );
    const second = db.transaction((tx) =>
      createNotificationEvent(tx, {
        eventType: "thread.completed",
        idempotencyKey: "thread.completed:thread-1:200",
        projectId: project.id,
        sourceThreadId: thread.id,
        targetThreadId: thread.id,
        title: "bb thread completed",
        body: "Investigate notifications",
        shouldNotify: false,
      }),
    );

    const events = listNotificationEvents(db, {
      afterSequence: first.sequence,
      limit: 10,
    });

    expect(events.map((event) => event.id)).toEqual([second.id]);
  });

  it("upserts and disables push subscriptions by endpoint", () => {
    const { db } = createTestThread();
    const first = upsertNotificationSubscription(db, {
      endpoint: "https://push.example.test/subscription/1",
      p256dh: "first-key",
      auth: "first-auth",
      userAgent: "test-agent",
    });
    const second = upsertNotificationSubscription(db, {
      endpoint: "https://push.example.test/subscription/1",
      p256dh: "second-key",
      auth: "second-auth",
      userAgent: null,
    });

    expect(second.id).toBe(first.id);
    expect(second.p256dh).toBe("second-key");
    expect(listActiveNotificationSubscriptions(db)).toHaveLength(1);

    disableNotificationSubscriptionByEndpoint(
      db,
      "https://push.example.test/subscription/1",
    );

    expect(listActiveNotificationSubscriptions(db)).toHaveLength(0);
  });
});
