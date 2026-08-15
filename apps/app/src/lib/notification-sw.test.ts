import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type ServiceWorkerListener = (event: {
  data?: { json(): unknown };
  notification?: {
    close(): void;
    data?: { url?: string };
  };
  waitUntil(promise: Promise<unknown>): void;
}) => void;

interface TestWindowClient {
  focus(): Promise<unknown>;
  navigate(url: string): void;
}

function loadNotificationServiceWorker() {
  const listeners = new Map<string, ServiceWorkerListener>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => null);
  const matchAll = vi.fn(async (): Promise<TestWindowClient[]> => []);
  const clients = {
    matchAll,
    openWindow,
  };
  const self = {
    addEventListener: vi.fn((type: string, listener: ServiceWorkerListener) => {
      listeners.set(type, listener);
    }),
    clients,
    location: { origin: "https://bb.example.test" },
    registration: { showNotification },
  };
  const script = readFileSync(
    join(process.cwd(), "public/notification-sw.js"),
    "utf8",
  );
  vm.runInNewContext(script, {
    Promise,
    URL,
    self,
  });
  return { clients, listeners, openWindow, showNotification };
}

describe("notification service worker", () => {
  it("shows push notifications with a stable event tag", async () => {
    const { listeners, showNotification } = loadNotificationServiceWorker();
    const waited: Promise<unknown>[] = [];

    listeners.get("push")?.({
      data: {
        json: () => ({
          id: "ntf_123",
          title: "bb needs input",
          body: "Child work",
          url: "/projects/proj_1/threads/thr_parent",
        }),
      },
      waitUntil: (promise) => waited.push(promise),
    });
    await Promise.all(waited);

    expect(showNotification).toHaveBeenCalledWith("bb needs input", {
      body: "Child work",
      data: { url: "/projects/proj_1/threads/thr_parent" },
      icon: "/icon-192.png",
      tag: "bb-ntf_123",
    });
  });

  it("focuses an existing client and navigates it on notification click", async () => {
    const { clients, listeners, openWindow } = loadNotificationServiceWorker();
    const navigate = vi.fn();
    const focus = vi.fn(async () => "focused");
    clients.matchAll.mockResolvedValueOnce([{ focus, navigate }]);
    const close = vi.fn();
    const waited: Promise<unknown>[] = [];

    listeners.get("notificationclick")?.({
      notification: {
        close,
        data: { url: "/threads/thr_parent" },
      },
      waitUntil: (promise) => waited.push(promise),
    });
    await Promise.all(waited);

    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      "https://bb.example.test/threads/thr_parent",
    );
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
});
