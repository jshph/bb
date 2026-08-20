import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { ShareHostResolver } from "./hosts.js";
import { ShareRegistry } from "./shares.js";

interface FakeTunnelSocket {
  emit(eventName: string, ...args: unknown[]): boolean;
}

const fakeWebSockets = vi.hoisted(() => ({
  instances: [] as FakeTunnelSocket[],
}));

vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  const { EventEmitter } = await import("node:events");

  class FakeWebSocket extends EventEmitter {
    readyState = 0;

    constructor() {
      super();
      fakeWebSockets.instances.push(this);
    }

    terminate(): void {
      this.readyState = 3;
    }

    send(): void {}
  }

  return { ...actual, WebSocket: FakeWebSocket };
});

import { ConnectTunnel } from "./tunnel.js";
import { DEFAULT_CONNECT_BASE_URL } from "./redeem.js";

function createTunnelFixture() {
  const fakeHost = createFakePluginHost({
    pluginId: "connect",
    sdk: {
      system: {
        config: async () => ({ primaryHostId: "host-server" }) as never,
      },
    },
  });
  const pluginBb = fakeHost.bb;
  const credential = {
    serverUrl: "https://sawyer.getbb.app",
    handle: "sawyer",
    credential: "bbcred_x",
  };
  const clearCredential = vi.fn(async () => {});
  const onStatusChange = vi.fn();
  const shares = new ShareRegistry({
    kv: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
    },
    hosts: pluginBb.hosts,
    hostResolver: new ShareHostResolver(() => pluginBb.sdk),
    getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
    getCredential: () => credential,
    log: pluginBb.log,
  });
  const tunnel = new ConnectTunnel({
    store: {
      read: async () => credential,
      write: async () => {},
      clear: clearCredential,
    },
    shares,
    defaultBaseUrl: DEFAULT_CONNECT_BASE_URL,
    getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
    log: pluginBb.log,
    onStatusChange,
  });
  return {
    clearCredential,
    credential,
    fakeHost,
    onStatusChange,
    tunnel,
  };
}

describe("ConnectTunnel socket lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fakeWebSockets.instances.length = 0;
  });

  it.each([429, 500])(
    "retries a transient HTTP %i rejection even when no close event follows",
    async (statusCode) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-20T18:23:28.000Z"));
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const { fakeHost, tunnel } = createTunnelFixture();

      try {
        await tunnel.start();
        expect(fakeWebSockets.instances).toHaveLength(1);
        const rejectedSocket = fakeWebSockets.instances[0]!;
        const resume = vi.fn();

        rejectedSocket.emit(
          "unexpected-response",
          {},
          {
            statusCode,
            headers: {
              "cf-ray": "incident-ray",
              "x-bb-request-id": `request-${statusCode}`,
            },
            resume,
          },
        );

        expect(resume).toHaveBeenCalledOnce();
        expect(tunnel.status().lastError).toBe(
          `tunnel rejected: HTTP ${statusCode} (request request-${statusCode})`,
        );
        expect(tunnel.status().nextRetryAt).toBe(Date.now() + 1_800);
        const rejectionLog = fakeHost.harness.logEntries.find((entry) =>
          entry.message.includes('"event":"tunnel_handshake_rejected"'),
        );
        expect(JSON.parse(rejectionLog?.message ?? "{}")).toMatchObject({
          event: "tunnel_handshake_rejected",
          attemptId: "connect-1",
          statusCode,
          cfRay: "incident-ray",
          requestId: `request-${statusCode}`,
          retryInMs: 1_800,
        });

        // A late close from terminate() must not schedule a duplicate retry.
        rejectedSocket.emit("close", 1006, Buffer.from("late close"));
        await vi.advanceTimersByTimeAsync(1_799);
        expect(fakeWebSockets.instances).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fakeWebSockets.instances).toHaveLength(2);
        expect(tunnel.status().nextRetryAt).toBeNull();

        const replacement = fakeWebSockets.instances[1]!;
        replacement.emit("open");
        expect(tunnel.status()).toMatchObject({
          state: "connected",
          lastError: null,
          nextRetryAt: null,
        });

        await vi.advanceTimersByTimeAsync(30_000);
        expect(fakeWebSockets.instances).toHaveLength(2);
      } finally {
        tunnel.stop();
        await fakeHost.harness.dispose();
      }
    },
  );

  it.each([401, 403])(
    "stops retrying after credential rejection HTTP %i",
    async (statusCode) => {
      vi.useFakeTimers();
      const { clearCredential, fakeHost, tunnel } = createTunnelFixture();

      try {
        await tunnel.start();
        const resume = vi.fn();
        fakeWebSockets.instances[0]!.emit(
          "unexpected-response",
          {},
          {
            statusCode,
            headers: {},
            resume,
          },
        );

        expect(resume).toHaveBeenCalledOnce();
        expect(tunnel.status()).toMatchObject({
          state: "disconnected",
          paired: false,
          nextRetryAt: null,
        });
        await vi.advanceTimersByTimeAsync(30_000);
        expect(fakeWebSockets.instances).toHaveLength(1);
        expect(clearCredential).toHaveBeenCalledOnce();
      } finally {
        tunnel.stop();
        await fakeHost.harness.dispose();
      }
    },
  );

  it("ignores events from a socket after the tunnel stops", async () => {
    const { clearCredential, credential, fakeHost, onStatusChange, tunnel } =
      createTunnelFixture();

    try {
      await tunnel.start();
      await vi.waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledTimes(2);
      });
      expect(fakeWebSockets.instances).toHaveLength(1);

      tunnel.stop();
      onStatusChange.mockClear();
      const socket = fakeWebSockets.instances[0]!;
      socket.emit("open");
      socket.emit("unexpected-response", {}, { statusCode: 401, resume() {} });
      socket.emit("error", new Error("late socket error"));
      socket.emit("close", 1006, Buffer.from("late close"));

      expect(clearCredential).not.toHaveBeenCalled();
      expect(onStatusChange).not.toHaveBeenCalled();
      expect(tunnel.getCredential()).toEqual(credential);
      expect(tunnel.status().lastError).toBeNull();
    } finally {
      tunnel.stop();
      await fakeHost.harness.dispose();
    }
  });

  it("does not let a replaced socket close the current session", async () => {
    const { fakeHost, tunnel } = createTunnelFixture();

    try {
      await tunnel.start();
      expect(fakeWebSockets.instances).toHaveLength(1);
      const replacedSocket = fakeWebSockets.instances[0]!;

      tunnel.stop();
      await tunnel.start();
      expect(fakeWebSockets.instances).toHaveLength(2);
      const currentSocket = fakeWebSockets.instances[1]!;
      currentSocket.emit("open");
      expect(tunnel.status().state).toBe("connected");

      replacedSocket.emit("close", 1006, Buffer.from("late close"));

      expect(tunnel.status().state).toBe("connected");
    } finally {
      tunnel.stop();
      await fakeHost.harness.dispose();
    }
  });
});
