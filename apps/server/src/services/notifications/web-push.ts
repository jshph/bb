import {
  disableNotificationSubscriptionByEndpoint,
  listActiveNotificationSubscriptions,
  type DbConnection,
  type NotificationEventRow,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import webPush from "web-push";
import type { ServerLogger } from "../../types.js";

interface WebPushKeyPair {
  privateKey: string;
  publicKey: string;
}

let generatedKeyPair: WebPushKeyPair | null = null;

function readConfiguredKeyPair(): WebPushKeyPair | null {
  const publicKey = process.env.BB_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.BB_WEB_PUSH_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) {
    return { publicKey, privateKey };
  }
  return null;
}

function getWebPushKeyPair(): WebPushKeyPair {
  const configured = readConfiguredKeyPair();
  if (configured !== null) {
    return configured;
  }
  generatedKeyPair ??= webPush.generateVAPIDKeys();
  return generatedKeyPair;
}

function configureWebPush(): WebPushKeyPair {
  const keyPair = getWebPushKeyPair();
  webPush.setVapidDetails(
    process.env.BB_WEB_PUSH_SUBJECT?.trim() || "mailto:notifications@getbb.app",
    keyPair.publicKey,
    keyPair.privateKey,
  );
  return keyPair;
}

export function getNotificationWebPushPublicKey(): string {
  return configureWebPush().publicKey;
}

function routeForNotificationEvent(event: NotificationEventRow): string {
  if (event.projectId === PERSONAL_PROJECT_ID) {
    return `/threads/${encodeURIComponent(event.targetThreadId)}`;
  }
  return `/projects/${encodeURIComponent(event.projectId)}/threads/${encodeURIComponent(event.targetThreadId)}`;
}

export async function deliverNotificationEventBestEffort(
  db: DbConnection,
  logger: ServerLogger,
  event: NotificationEventRow,
): Promise<void> {
  if (!event.shouldNotify) {
    return;
  }
  configureWebPush();
  const payload = JSON.stringify({
    id: event.id,
    title: event.title,
    body: event.body,
    url: routeForNotificationEvent(event),
  });
  const subscriptions = listActiveNotificationSubscriptions(db);
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        const response = await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
        );
        logger.info(
          {
            notificationEventId: event.id,
            pushStatusCode: response.statusCode,
            subscriptionId: subscription.id,
          },
          "Delivered web push notification",
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : null;
        if (statusCode === 404 || statusCode === 410) {
          disableNotificationSubscriptionByEndpoint(db, subscription.endpoint);
          return;
        }
        logger.warn(
          { err: error, subscriptionId: subscription.id },
          "Failed to deliver web push notification",
        );
      }
    }),
  );
}
