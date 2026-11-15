// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import type {
  PluginThreadAction,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushNotificationsRpcContract } from "./contract.js";
import type { ThreadNotificationInputs } from "./preferences.js";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("notification delivery", () => {
  it.each([
    [["skipFocusedThreadNotifications"], 0],
    [[], 1],
  ])(
    "with experiments %j shows %i notifications for the focused thread",
    async (experiments, expected) => {
      const shown: string[] = [];
      vi.stubGlobal(
        "Notification",
        class {
          static permission = "granted";
          close = vi.fn();
          constructor(title: string) {
            shown.push(title);
          }
        },
      );
      vi.stubGlobal("isSecureContext", true);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const view = renderSlot(
        app.appOverlays[0]!,
        {},
        {
          settings: { webEnabled: true },
          context: { threadId: "thr_open" },
          experiments,
        },
      );
      await view.emitRealtime("notification", {
        id: "event-1",
        title: "Finished",
        body: "Ready",
        threadId: "thr_open",
        channels: ["web"],
      });
      await waitFor(() => expect(shown).toHaveLength(expected));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shown).toHaveLength(expected);
    },
  );

  it("closes a thread's notification when the server says it was read", async () => {
    const closed: string[] = [];
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "granted";
        readonly tag: string;
        constructor(_title: string, options: NotificationOptions) {
          this.tag = options.tag ?? "";
        }
        close() {
          closed.push(this.tag);
        }
      },
    );
    vi.stubGlobal("isSecureContext", true);
    const view = renderSlot(
      app.appOverlays[0]!,
      {},
      { settings: { webEnabled: true } },
    );
    for (const threadId of ["thr_read", "thr_other"]) {
      await view.emitRealtime("notification", {
        id: `event-${threadId}`,
        title: "Finished",
        body: "Ready",
        threadId,
        channels: ["web"],
      });
    }
    await view.emitRealtime("notification-dismiss", { threadId: "thr_read" });
    await waitFor(() => expect(closed).toEqual(["bb-thr_read"]));
  });
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

const { experimental_useAppPanel, useBbNavigate, useSdk } =
  await import("@get-bb/plugin-sdk/app");
const { notificationsThreadAction } = await import("./notificationsAction.js");

function makeTarget(
  overrides: Partial<PluginThreadActionTarget> = {},
): PluginThreadActionTarget {
  return {
    id: "thr_top",
    projectId: "proj_test",
    parentThreadId: null,
    parentNotifications: "auto",
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle",
    environment: null,
    ...overrides,
  };
}

type ItemFor = (thread: PluginThreadActionTarget) => PluginThreadAction | null;
type BulkItemFor = (
  threads: readonly PluginThreadActionTarget[],
) => PluginThreadAction | null;

function Probe({
  threadIds,
  onItem,
}: {
  threadIds: readonly string[];
  onItem(item: ItemFor, bulkItem: BulkItemFor): void;
}) {
  const data = notificationsThreadAction.useData!({ threadIds });
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const experimental_panel = experimental_useAppPanel();
  useLayoutEffect(() => {
    onItem(
      (thread) =>
        notificationsThreadAction.item({
          thread,
          data,
          sdk,
          navigate,
          experimental_panel,
        }),
      (threads) =>
        notificationsThreadAction.experimental_bulkItem?.({
          threads,
          data,
          sdk,
          navigate,
          experimental_panel,
        }) ?? null,
    );
  });
  return null;
}

function renderNotifications(
  stored: Record<string, ThreadNotificationInputs>,
  threadIds: readonly string[],
) {
  let itemFor: ItemFor | null = null;
  let bulkItemFor: BulkItemFor | null = null;
  const onItem = (next: ItemFor, nextBulk: BulkItemFor) => {
    itemFor = next;
    bulkItemFor = nextBulk;
  };
  let current = stored;
  const listInput =
    pushNotificationsRpcContract["threadNotifications.keyed"].input;
  const view = renderSlot(
    { component: Probe },
    { threadIds, onItem },
    {
      experimental_rpcContract: {
        "threadNotifications.keyed":
          pushNotificationsRpcContract["threadNotifications.keyed"],
        "threadNotifications.set":
          pushNotificationsRpcContract["threadNotifications.set"],
      },
      settings: { defaultLevel: "all", childLevel: "input-only" },
      rpc: {
        "threadNotifications.keyed": async (input) => {
          const threads = Object.fromEntries(
            listInput
              .parse(input)
              .keys.map((id) => [
                id,
                current[id] ?? { own: "inherit", ancestorCap: null },
              ]),
          );
          return threads;
        },
        "threadNotifications.set": (input) => {
          const { threadId, level } =
            pushNotificationsRpcContract["threadNotifications.set"].input.parse(
              input,
            );
          const saved = { own: level, ancestorCap: null };
          current = { ...current, [threadId]: saved };
          return saved;
        },
      },
    },
  );
  const item = (overrides: Partial<PluginThreadActionTarget> = {}) =>
    itemFor?.(makeTarget(overrides)) ?? null;
  const summary = (overrides: Partial<PluginThreadActionTarget> = {}) => {
    const action = item(overrides);
    return action === null
      ? null
      : {
          detail: action.detail ?? null,
          icon: action.icon,
          hint: action.choices?.hint ?? null,
          selected:
            action.choices?.items.find((choice) => choice.selected)?.id ?? null,
        };
  };
  const bulkItem = (targets: readonly Partial<PluginThreadActionTarget>[]) =>
    bulkItemFor?.(targets.map(makeTarget)) ?? null;
  return {
    view,
    item,
    bulkItem,
    summary,
    stored: () => current,
    show(ids: readonly string[]) {
      view.rerender(<Probe threadIds={ids} onItem={onItem} />);
    },
    restore(next: Record<string, ThreadNotificationInputs>) {
      current = next;
    },
  };
}

describe("thread notifications action", () => {
  it("summarizes a selection and sets the level on every active selected thread", async () => {
    const { bulkItem, stored } = renderNotifications(
      {
        thr_a: { own: "muted", ancestorCap: null },
        thr_b: { own: "muted", ancestorCap: null },
        thr_c: { own: "all", ancestorCap: null },
      },
      ["thr_a", "thr_b", "thr_c", "thr_d"],
    );
    const shared = [{ id: "thr_a" }, { id: "thr_b" }];
    await waitFor(() => expect(bulkItem(shared)?.detail).toBe("Muted"));
    expect(
      bulkItem(shared)?.choices?.items.find((choice) => choice.selected)?.id,
    ).toBe("muted");
    const mixed = bulkItem([{ id: "thr_a" }, { id: "thr_c" }]);
    expect(mixed?.detail).toBe("Mixed");
    expect(mixed?.icon).toBe("BellDot");
    expect(mixed?.choices?.items.some((choice) => choice.selected)).toBe(false);
    expect(
      bulkItem([
        { id: "thr_a", archivedAt: 1 },
        { id: "thr_b", archivedAt: 1 },
      ]),
    ).toBeNull();
    await act(() =>
      bulkItem([
        { id: "thr_a" },
        { id: "thr_c" },
        { id: "thr_d", archivedAt: 1 },
      ])!.run({ value: "input-only", requestRename: () => {} }),
    );
    expect(stored()).toMatchObject({
      thr_a: { own: "input-only" },
      thr_b: { own: "muted" },
      thr_c: { own: "input-only" },
    });
    expect(stored()).not.toHaveProperty("thr_d");
  });

  it("resolves each shown thread's level and hint", async () => {
    const { summary } = renderNotifications(
      {
        thr_top: { own: "muted", ancestorCap: null },
        thr_child: {
          own: "inherit",
          ancestorCap: { level: "muted", threadId: "thr_top" },
        },
        thr_grandchild: {
          own: "inherit",
          ancestorCap: { level: "muted", threadId: "thr_top" },
        },
      },
      ["thr_child", "thr_grandchild", "thr_new", "thr_other", "thr_top"],
    );
    await waitFor(() => expect(summary()?.selected).toBe("muted"));
    expect(summary()).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      hint: null,
      selected: "muted",
    });
    expect(summary({ id: "thr_child", parentThreadId: "thr_top" })).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      hint: "Limited by a parent thread",
      selected: "inherit",
    });
    expect(
      summary({ id: "thr_grandchild", parentThreadId: "thr_child" }),
    ).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      hint: "Limited by an ancestor thread",
      selected: "inherit",
    });
    expect(summary({ id: "thr_other", parentThreadId: "thr_top" })).toEqual({
      detail: "Needs input only",
      icon: "BellDot",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ id: "thr_new" })).toEqual({
      detail: "All activity",
      icon: "push-notifications/ringing",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ id: "thr_unshown" })).toEqual({
      detail: "All activity",
      icon: "push-notifications/ringing",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ archivedAt: 1 })).toBeNull();
  });

  it("shows an unarchived thread's stored level without a reload", async () => {
    const { show, summary } = renderNotifications(
      { thr_top: { own: "muted", ancestorCap: null } },
      [],
    );
    expect(summary({ archivedAt: 1 })).toBeNull();
    show(["thr_top"]);
    await waitFor(() => expect(summary()?.selected).toBe("muted"));
  });

  it("refreshes shown levels after its own write and a change from another client", async () => {
    const { view, item, summary, restore } = renderNotifications({}, [
      "thr_top",
    ]);
    await waitFor(() => expect(summary()?.selected).toBe("inherit"));
    await act(() => item()!.run({ value: "muted", requestRename: () => {} }));
    await waitFor(() => expect(summary()?.selected).toBe("muted"));
    restore({ thr_top: { own: "all", ancestorCap: null } });
    await view.behavior.experimental_invalidateRpc(["thread:thr_top"]);
    await waitFor(() => expect(summary()?.selected).toBe("all"));
  });
  it("reflects a parent cap changed by another client", async () => {
    const { view, summary, restore } = renderNotifications({}, [
      "thr_child",
      "thr_top",
    ]);
    await waitFor(() => expect(summary()?.selected).toBe("inherit"));
    const child = { id: "thr_child", parentThreadId: "thr_top" };
    expect(summary(child)?.detail).toBe("Needs input only");

    restore({
      thr_top: { own: "muted", ancestorCap: null },
      thr_child: {
        own: "inherit",
        ancestorCap: { level: "muted", threadId: "thr_top" },
      },
    });
    await view.behavior.experimental_invalidateRpc([
      "thread:thr_top",
      "thread:thr_child",
    ]);
    expect(summary(child)).toMatchObject({
      detail: "Muted",
      hint: "Limited by a parent thread",
    });
    expect(summary()?.selected).toBe("muted");
  });
});
