import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  webPushSubscriptionSchema,
  type WebPushSubscription,
  type WebPushSubscriptionInput,
} from "./contract.js";

const WEB_SUBSCRIPTION_KEY_PREFIX = "web-subscription:";

export interface WebPushSubscriptionStore {
  add(
    input: WebPushSubscriptionInput,
  ): Promise<{ id: string; created: boolean }>;
  list(): Promise<WebPushSubscription[]>;
  remove(id: string): Promise<boolean>;
  removeByEndpoint(endpoint: string): Promise<boolean>;
}

export function createWebPushSubscriptionStore(
  bb: BbPluginApi,
  options: { now?: () => number; createId?: () => string } = {},
): WebPushSubscriptionStore {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  let mutationQueue: Promise<void> = Promise.resolve();

  async function readAll(): Promise<WebPushSubscription[]> {
    const keys = await bb.storage.kv.list(WEB_SUBSCRIPTION_KEY_PREFIX);
    const subscriptions: WebPushSubscription[] = [];
    for (const key of keys) {
      const parsed = webPushSubscriptionSchema.safeParse(
        await bb.storage.kv.get<unknown>(key),
      );
      if (!parsed.success) {
        bb.log.warn(
          `Ignored invalid web push subscription row ${key.slice(WEB_SUBSCRIPTION_KEY_PREFIX.length)}`,
        );
        continue;
      }
      subscriptions.push(parsed.data);
    }
    return subscriptions.sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  }

  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function removeMatching(
    predicate: (subscription: WebPushSubscription) => boolean,
  ): Promise<boolean> {
    const subscriptions = await readAll();
    const existing = subscriptions.find(predicate);
    if (!existing) return false;
    await bb.storage.kv.delete(`${WEB_SUBSCRIPTION_KEY_PREFIX}${existing.id}`);
    return true;
  }

  return {
    add(input) {
      return mutate(async () => {
        const subscriptions = await readAll();
        const existing = subscriptions.find(
          (subscription) => subscription.endpoint === input.endpoint,
        );
        const timestamp = now();
        if (existing) {
          await bb.storage.kv.set(
            `${WEB_SUBSCRIPTION_KEY_PREFIX}${existing.id}`,
            {
              ...existing,
              ...input,
              lastSeenAt: Math.max(timestamp, existing.lastSeenAt),
            } satisfies WebPushSubscription,
          );
          return { id: existing.id, created: false };
        }
        const id = createId();
        await bb.storage.kv.set(`${WEB_SUBSCRIPTION_KEY_PREFIX}${id}`, {
          ...input,
          id,
          createdAt: timestamp,
          lastSeenAt: timestamp,
        } satisfies WebPushSubscription);
        return { id, created: true };
      });
    },
    async list() {
      await mutationQueue;
      return readAll();
    },
    remove(id) {
      return mutate(() =>
        removeMatching((subscription) => subscription.id === id),
      );
    },
    removeByEndpoint(endpoint) {
      return mutate(() =>
        removeMatching((subscription) => subscription.endpoint === endpoint),
      );
    },
  };
}
