import { describe, expect, it } from "vitest";
import { listNotificationEvents } from "@bb/db";
import type { PendingInteractionCreate } from "@bb/domain";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

function registerPendingInteraction(
  deps: AppDeps,
  interaction: PendingInteractionCreate,
) {
  seedTurnStarted(deps, {
    threadId: interaction.threadId,
    turnId: interaction.turnId,
    providerThreadId: interaction.providerThreadId,
  });
  return deps.pendingInteractions.registerPendingInteraction({
    interaction,
  });
}

describe("thread notification events", () => {
  it("creates one durable notification event for completed lifecycle transitions", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: {
          status: "active",
          title: "Finish notification plumbing",
        },
      });

      const first = applyLoggedThreadLifecycleEvent(
        {
          db: harness.db,
          hub: harness.hub,
          logger: testLogger,
          providerRegistry: harness.deps.providerRegistry,
        },
        {
          threadId: thread.id,
          event: { type: "run.succeeded" },
        },
      );
      const duplicate = applyLoggedThreadLifecycleEvent(
        {
          db: harness.db,
          hub: harness.hub,
          logger: testLogger,
          providerRegistry: harness.deps.providerRegistry,
        },
        {
          threadId: thread.id,
          event: { type: "run.succeeded" },
        },
      );

      expect(first.applied).toBe(true);
      expect(duplicate.applied).toBe(false);
      expect(
        listNotificationEvents(harness.db, {
          afterSequence: 0,
          limit: 10,
        }),
      ).toMatchObject([
        {
          eventType: "thread.completed",
          sourceThreadId: thread.id,
          targetThreadId: thread.id,
          title: "bb thread completed",
          body: "Finish notification plumbing",
          shouldNotify: false,
        },
      ]);
    });
  });

  it("creates a notifying failed lifecycle event", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: {
          status: "active",
          title: "Run notification delivery",
        },
      });

      const outcome = applyLoggedThreadLifecycleEvent(
        {
          db: harness.db,
          hub: harness.hub,
          logger: testLogger,
          providerRegistry: harness.deps.providerRegistry,
        },
        {
          threadId: thread.id,
          event: { type: "run.failed" },
        },
      );

      expect(outcome.applied).toBe(true);
      expect(
        listNotificationEvents(harness.db, {
          afterSequence: 0,
          limit: 10,
        }),
      ).toMatchObject([
        {
          eventType: "thread.failed",
          sourceThreadId: thread.id,
          targetThreadId: thread.id,
          title: "bb thread failed",
          body: "Run notification delivery",
          shouldNotify: true,
        },
      ]);
    });
  });

  it("creates a needs-input event for a child pending interaction targeting the parent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-notification-pending",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        title: "Parent surface",
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parentThread.id,
        providerId: "codex",
        status: "active",
        title: "Child work",
      });

      const created = registerPendingInteraction(harness.deps, {
        threadId: childThread.id,
        turnId: "turn-notification-pending",
        providerId: "codex",
        providerThreadId: "provider-thread-notification-pending",
        providerRequestId: "request-notification-pending",
        payload: createUserQuestionPayload(),
      });

      expect(created.outcome).toBe("created");
      expect(
        listNotificationEvents(harness.db, {
          afterSequence: 0,
          limit: 10,
        }),
      ).toMatchObject([
        {
          eventType: "thread.needs_input",
          sourceThreadId: childThread.id,
          targetThreadId: parentThread.id,
          title: "bb needs input",
          body: "Child work",
          shouldNotify: true,
        },
      ]);
    });
  });
});
