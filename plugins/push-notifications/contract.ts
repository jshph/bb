import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_TOKEN_MAX_LENGTH = 512;
export const DEVICE_LABEL_MAX_LENGTH = 120;
export const WEB_PUSH_ENDPOINT_MAX_LENGTH = 4_096;
export const WEB_PUSH_KEY_MAX_LENGTH = 512;

const webPushEndpointSchema = z
  .string()
  .url()
  .max(WEB_PUSH_ENDPOINT_MAX_LENGTH)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Web Push endpoint must use HTTPS",
  });

export const pushPlatformSchema = z.enum(["ios", "android"]);

export const pushSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    expoPushToken: z.string().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    deviceLabel: z.string().min(1).max(DEVICE_LABEL_MAX_LENGTH),
    createdAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();

export const pushSubscriptionSummarySchema = pushSubscriptionSchema
  .omit({ expoPushToken: true })
  .extend({ tokenSuffix: z.string().min(1).max(6) })
  .strict();

export const addPushSubscriptionInputSchema = z
  .object({
    expoPushToken: z.string().trim().min(1).max(EXPO_PUSH_TOKEN_MAX_LENGTH),
    platform: pushPlatformSchema,
    deviceLabel: z.string().trim().min(1).max(DEVICE_LABEL_MAX_LENGTH),
  })
  .strict();

export const removePushSubscriptionInputSchema = z
  .object({ id: z.string().min(1) })
  .strict();

export const clientChannelSchema = z.enum(["web", "desktop"]);
export const CLIENT_NOTIFICATION_CHANNEL = "notification";
export const clientNotificationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    body: z.string(),
    threadId: z.string().nullable(),
    channels: z.array(clientChannelSchema),
  })
  .strict();
export type ClientNotification = z.infer<typeof clientNotificationSchema>;

export const webPushSubscriptionInputSchema = z
  .object({
    endpoint: webPushEndpointSchema,
    expirationTime: z.number().int().nonnegative().nullable(),
    keys: z
      .object({
        auth: z.string().min(1).max(WEB_PUSH_KEY_MAX_LENGTH),
        p256dh: z.string().min(1).max(WEB_PUSH_KEY_MAX_LENGTH),
      })
      .strict(),
  })
  .strict();

export const webPushSubscriptionSchema = webPushSubscriptionInputSchema
  .extend({
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();

export const webPushNotificationSchema = clientNotificationSchema
  .pick({ id: true, title: true, body: true, threadId: true })
  .strict();

export type WebPushSubscriptionInput = z.infer<
  typeof webPushSubscriptionInputSchema
>;
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;
export type WebPushNotification = z.infer<typeof webPushNotificationSchema>;

const emptyInputSchema = z.object({}).strict();
export const listPushSubscriptionsOutputSchema = z
  .object({ subscriptions: z.array(pushSubscriptionSummarySchema) })
  .strict();

export const pushNotificationsRpcContract = defineRpcContract({
  "notifications.test": {
    input: z.object({ channel: clientChannelSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "pushSubscriptions.list": {
    input: emptyInputSchema,
    output: listPushSubscriptionsOutputSchema,
  },
  "pushSubscriptions.add": {
    input: addPushSubscriptionInputSchema,
    output: z.object({ id: z.string().min(1), created: z.boolean() }).strict(),
  },
  "pushSubscriptions.remove": {
    input: removePushSubscriptionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "webPush.configuration": {
    input: emptyInputSchema,
    output: z.object({ publicKey: z.string().min(1) }).strict(),
  },
  "webPush.subscribe": {
    input: webPushSubscriptionInputSchema,
    output: z.object({ id: z.string().min(1), created: z.boolean() }).strict(),
  },
  "webPush.unsubscribe": {
    input: z.object({ endpoint: webPushEndpointSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
export type PushSubscriptionSummary = z.infer<
  typeof pushSubscriptionSummarySchema
>;
export type AddPushSubscriptionInput = z.infer<
  typeof addPushSubscriptionInputSchema
>;
