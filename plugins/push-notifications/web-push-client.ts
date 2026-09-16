import type { WebPushSubscriptionInput } from "./contract.js";

const WEB_PUSH_SERVICE_WORKER_PATH = "/bb-service-worker.js";

export function webPushSupported(): boolean {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(
    `${value.replace(/-/gu, "+").replace(/_/gu, "/")}${padding}`,
  );
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function serializeSubscription(
  subscription: PushSubscription,
): WebPushSubscriptionInput {
  const serialized = subscription.toJSON();
  const auth = serialized.keys?.auth;
  const p256dh = serialized.keys?.p256dh;
  if (!serialized.endpoint || !auth || !p256dh) {
    throw new Error("The browser returned an incomplete push subscription");
  }
  return {
    endpoint: serialized.endpoint,
    expirationTime: serialized.expirationTime ?? null,
    keys: { auth, p256dh },
  };
}

async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!webPushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

export async function currentWebPushSubscription(): Promise<PushSubscription | null> {
  const registration = await existingRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

export async function hasActiveWebPushSubscription(): Promise<boolean> {
  return (await currentWebPushSubscription()) !== null;
}

export async function enableWebPush(
  publicKey: string,
): Promise<WebPushSubscriptionInput> {
  if (!webPushSupported()) {
    throw new Error("Web Push is unavailable in this browser");
  }
  const registration = await navigator.serviceWorker.register(
    WEB_PUSH_SERVICE_WORKER_PATH,
    { scope: "/" },
  );
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      applicationServerKey: decodeApplicationServerKey(publicKey),
      userVisibleOnly: true,
    }));
  return serializeSubscription(subscription);
}

export async function refreshWebPushSubscription(): Promise<WebPushSubscriptionInput | null> {
  const subscription = await currentWebPushSubscription();
  return subscription === null ? null : serializeSubscription(subscription);
}

export async function disableWebPush(): Promise<string | null> {
  const subscription = await currentWebPushSubscription();
  if (subscription === null) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
