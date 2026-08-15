import type {
  NotificationPushPublicKeyResponse,
  NotificationPushSubscriptionRequest,
} from "@bb/server-contract";

const NOTIFICATION_SW_PATH = "/notification-sw.js";

export type PwaNotificationStatus =
  | { kind: "unsupported" }
  | { kind: "default" }
  | { kind: "denied" }
  | { kind: "granted"; subscribed: boolean };

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/gu, "+").replace(/_/gu, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

function subscriptionToRequest(
  subscription: PushSubscription,
): NotificationPushSubscriptionRequest | null {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return null;
  }
  return {
    endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

async function fetchPushPublicKey(): Promise<string> {
  const response = await fetch("/api/v1/system/notifications/push-public-key");
  if (!response.ok) {
    throw new Error(
      `Push public key request failed with HTTP ${response.status}`,
    );
  }
  const payload = (await response.json()) as NotificationPushPublicKeyResponse;
  return payload.publicKey;
}

async function registerPushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const body = subscriptionToRequest(subscription);
  if (body === null) {
    return;
  }
  const response = await fetch(
    "/api/v1/system/notifications/push-subscription",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Push subscription request failed with HTTP ${response.status}`,
    );
  }
}

async function unregisterPushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const endpoint = subscription.endpoint;
  if (!endpoint) {
    return;
  }
  const response = await fetch(
    "/api/v1/system/notifications/push-subscription",
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Push subscription delete failed with HTTP ${response.status}`,
    );
  }
  await subscription.unsubscribe();
}

function supportsPwaNotifications(): boolean {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false;
  }
  return true;
}

async function getNotificationServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(NOTIFICATION_SW_PATH);
}

export async function getPwaNotificationStatus(): Promise<PwaNotificationStatus> {
  if (!supportsPwaNotifications()) {
    return { kind: "unsupported" };
  }
  if (Notification.permission !== "granted") {
    return { kind: Notification.permission };
  }
  const registration = await getNotificationServiceWorkerRegistration();
  return {
    kind: "granted",
    subscribed: (await registration.pushManager.getSubscription()) !== null,
  };
}

export async function reconcilePwaNotificationSubscription(): Promise<void> {
  if (!supportsPwaNotifications()) {
    return;
  }
  if (Notification.permission !== "granted") {
    if (Notification.permission === "denied") {
      const registration = await getNotificationServiceWorkerRegistration();
      const existing = await registration.pushManager.getSubscription();
      if (existing !== null) {
        await unregisterPushSubscription(existing);
      }
    }
    return;
  }
  const registration = await getNotificationServiceWorkerRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (existing !== null) {
    await registerPushSubscription(existing);
    return;
  }
  const publicKey = await fetchPushPublicKey();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await registerPushSubscription(subscription);
}

export async function enablePwaNotifications(): Promise<PwaNotificationStatus> {
  if (!supportsPwaNotifications()) {
    return { kind: "unsupported" };
  }
  if (
    Notification.permission === "default" &&
    typeof Notification.requestPermission === "function"
  ) {
    await Notification.requestPermission();
  }
  await reconcilePwaNotificationSubscription();
  return getPwaNotificationStatus();
}

export async function showPwaNotificationTest(): Promise<PwaNotificationStatus> {
  if (!supportsPwaNotifications()) {
    return { kind: "unsupported" };
  }
  const status = await getPwaNotificationStatus();
  if (status.kind !== "granted") {
    return status;
  }
  const registration = await getNotificationServiceWorkerRegistration();
  await registration.showNotification("bb test notification", {
    body: "If you can see this, Chrome/macOS can display bb notifications.",
    icon: "/icon-192.png",
    tag: "bb-local-test",
  });
  return getPwaNotificationStatus();
}

export function installPwaNotificationSubscriptionReconciliation(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.addEventListener(
    "load",
    () => {
      void reconcilePwaNotificationSubscription().catch((error) => {
        console.warn("Failed to reconcile PWA notifications", error);
      });
    },
    { once: true },
  );
}
