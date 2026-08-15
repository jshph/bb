import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcilePwaNotificationSubscription } from "./pwa-notifications";

function subscription(endpoint: string): PushSubscription {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({
      endpoint,
      keys: {
        p256dh: "push-key",
        auth: "auth-secret",
      },
    }),
  } as unknown as PushSubscription;
}

function installNotificationGlobals(args: {
  existingSubscription: PushSubscription | null;
  permission: NotificationPermission;
  subscribedSubscription?: PushSubscription;
}) {
  const subscribe = vi.fn(async () => args.subscribedSubscription);
  const getSubscription = vi.fn(async () => args.existingSubscription);
  const register = vi.fn(async () => ({
    pushManager: {
      getSubscription,
      subscribe,
    },
  }));
  vi.stubGlobal("Notification", { permission: args.permission });
  vi.stubGlobal("PushManager", class PushManager {});
  vi.stubGlobal("navigator", {
    serviceWorker: { register },
  });
  vi.stubGlobal("window", {
    atob,
    Notification,
    PushManager,
    addEventListener: vi.fn(),
  });
  return { getSubscription, register, subscribe };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PWA notification subscription reconciliation", () => {
  it("does not register or request keys unless permission is already granted", async () => {
    const { register } = installNotificationGlobals({
      existingSubscription: null,
      permission: "default",
    });

    await reconcilePwaNotificationSubscription();

    expect(register).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes an existing push subscription when permission has been denied", async () => {
    const existing = subscription("https://push.example.test/revoked");
    const { register } = installNotificationGlobals({
      existingSubscription: existing,
      permission: "denied",
    });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    await reconcilePwaNotificationSubscription();

    expect(register).toHaveBeenCalledWith("/notification-sw.js");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/api/v1/system/notifications/push-subscription",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example.test/revoked",
        }),
      },
    );
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
  });

  it("registers an existing push subscription with the server", async () => {
    const existing = subscription("https://push.example.test/existing");
    const { register, subscribe } = installNotificationGlobals({
      existingSubscription: existing,
      permission: "granted",
    });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    await reconcilePwaNotificationSubscription();

    expect(register).toHaveBeenCalledWith("/notification-sw.js");
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/api/v1/system/notifications/push-subscription",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example.test/existing",
          expirationTime: null,
          keys: {
            p256dh: "push-key",
            auth: "auth-secret",
          },
        }),
      },
    );
  });

  it("fetches the VAPID key and subscribes when no subscription exists", async () => {
    const created = subscription("https://push.example.test/new");
    const { subscribe } = installNotificationGlobals({
      existingSubscription: null,
      permission: "granted",
      subscribedSubscription: created,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ publicKey: "AQID" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await reconcilePwaNotificationSubscription();

    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/system/notifications/push-subscription",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining("https://push.example.test/new"),
      }),
    );
  });
});
