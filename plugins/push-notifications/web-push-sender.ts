import type { BbPluginApi } from "@get-bb/plugin-sdk";
import webPush, { type RequestOptions, type VapidKeys } from "web-push";
import type { WebPushNotification, WebPushSubscription } from "./contract.js";
import type { WebPushSubscriptionStore } from "./web-push-subscriptions.js";

export type SendWebPush = (
  subscription: WebPushSubscription,
  payload: string,
  options: RequestOptions,
) => Promise<unknown>;

export interface WebPushSendResult {
  sentCount: number;
  failure: string | null;
}

interface CreateWebPushSenderArgs {
  bb: BbPluginApi;
  subscriptions: WebPushSubscriptionStore;
  vapid: VapidKeys;
  subject: string;
  sendNotification?: SendWebPush;
}

function errorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return null;
}

export function createWebPushSender(args: CreateWebPushSenderArgs) {
  const sendNotification = args.sendNotification ?? webPush.sendNotification;

  return {
    async send(notification: WebPushNotification): Promise<WebPushSendResult> {
      const subscriptions = await args.subscriptions.list();
      const results = await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await sendNotification(subscription, JSON.stringify(notification), {
              TTL: 60 * 60,
              timeout: 10_000,
              urgency: "high",
              vapidDetails: {
                subject: args.subject,
                publicKey: args.vapid.publicKey,
                privateKey: args.vapid.privateKey,
              },
            });
            return { sent: true, failed: false };
          } catch (error) {
            const status = errorStatus(error);
            if (status === 404 || status === 410) {
              await args.subscriptions.remove(subscription.id);
              args.bb.log.info(
                `Removed expired web push subscription row ${subscription.id}`,
              );
              return { sent: false, failed: false };
            }
            args.bb.log.warn(
              `Web push request failed for subscription row ${subscription.id}${status === null ? "" : ` with status ${status}`}`,
            );
            return { sent: false, failed: true };
          }
        }),
      );
      return {
        sentCount: results.filter((result) => result.sent).length,
        failure: results.some((result) => result.failed)
          ? "one or more web push requests failed"
          : null,
      };
    },
  };
}
