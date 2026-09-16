// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

function installWebPushBrowser() {
  const subscription = {
    endpoint: "https://push.example.test/subscription",
    expirationTime: null,
    toJSON: () => ({
      endpoint: "https://push.example.test/subscription",
      expirationTime: null,
      keys: { auth: "auth-key", p256dh: "p256dh-key" },
    }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: typeof subscription | null = null;
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => {
        current = subscription;
        return subscription;
      }),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
    },
  });
  vi.stubGlobal("PushManager", class {});
  return { registration, subscription };
}

describe("device notification settings", () => {
  it("requests permission only on a click and uses the server test route", async () => {
    const browser = installWebPushBrowser();
    const requestPermission = vi.fn(async () => "granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("isSecureContext", true);
    const view = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        settings: { webEnabled: true },
        rpc: {
          "notifications.test": () => ({ ok: true }),
          "webPush.configuration": () => ({ publicKey: "AQID" }),
          "webPush.subscribe": () => ({ id: "web-1", created: true }),
        },
      },
    );
    expect(requestPermission).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.inspection.rpcCalls).toEqual([
        { method: "webPush.configuration", input: {} },
      ]),
    );
    fireEvent.click(
      await view.findByRole("button", { name: "Allow notifications" }),
    );
    fireEvent.click(
      await view.findByRole("button", { name: "Send test notification" }),
    );
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
      "/bb-service-worker.js",
      { scope: "/" },
    );
    expect(browser.registration.pushManager.subscribe).toHaveBeenCalledWith({
      applicationServerKey: new Uint8Array([1, 2, 3]),
      userVisibleOnly: true,
    });
    await waitFor(() =>
      expect(view.inspection.rpcCalls).toEqual([
        { method: "webPush.configuration", input: {} },
        {
          method: "webPush.subscribe",
          input: {
            endpoint: "https://push.example.test/subscription",
            expirationTime: null,
            keys: { auth: "auth-key", p256dh: "p256dh-key" },
          },
        },
        { method: "notifications.test", input: { channel: "web" } },
      ]),
    );
  });

  it("explains denied permission without prompting repeatedly", async () => {
    installWebPushBrowser();
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    vi.stubGlobal("isSecureContext", true);
    const view = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        settings: { webEnabled: true },
        rpc: { "webPush.configuration": () => ({ publicKey: "AQID" }) },
      },
    );
    expect(await view.findByText(/Notifications are blocked/)).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
