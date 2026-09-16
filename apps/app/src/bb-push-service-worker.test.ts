import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerListener = (event: unknown) => void;

function loadWorker() {
  const listeners = new Map<string, WorkerListener>();
  const showNotification = vi.fn(async () => undefined);
  const navigate = vi.fn(async () => undefined);
  const focus = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const matchAll = vi.fn(async () => [{ navigate, focus }]);
  const self = {
    addEventListener(name: string, listener: WorkerListener) {
      listeners.set(name, listener);
    },
    registration: { showNotification },
    clients: { matchAll, openWindow },
    location: { origin: "https://bb.example.test" },
  };
  const source = readFileSync(
    new URL("../public/bb-service-worker.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, { self, URL, encodeURIComponent });
  return {
    focus,
    listeners,
    matchAll,
    navigate,
    openWindow,
    showNotification,
  };
}

describe("Web Push service worker", () => {
  it("shows a thread notification with click-routing data", async () => {
    const worker = loadWorker();
    let work = Promise.resolve();
    worker.listeners.get("push")?.({
      data: {
        json: () => ({
          id: "notification-1",
          title: "Finished",
          body: "The task is ready",
          threadId: "thread/one",
        }),
      },
      waitUntil(promise: Promise<void>) {
        work = promise;
      },
    });
    await work;
    expect(worker.showNotification).toHaveBeenCalledWith("Finished", {
      body: "The task is ready",
      icon: "/icon-192.png",
      tag: "bb-thread/one",
      data: { path: "/threads/thread%2Fone" },
    });
  });

  it("focuses an existing window on notification click", async () => {
    const worker = loadWorker();
    let work = Promise.resolve();
    const close = vi.fn();
    worker.listeners.get("notificationclick")?.({
      notification: {
        close,
        data: { path: "/threads/thread-1" },
      },
      waitUntil(promise: Promise<void>) {
        work = promise;
      },
    });
    await work;
    expect(close).toHaveBeenCalled();
    expect(worker.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(worker.navigate).toHaveBeenCalledWith(
      "https://bb.example.test/threads/thread-1",
    );
    expect(worker.focus).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });
});
