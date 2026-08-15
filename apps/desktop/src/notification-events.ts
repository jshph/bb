import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  notificationEventsResponseSchema,
  type NotificationEvent,
} from "@bb/server-contract";

export const DESKTOP_NOTIFICATION_LIMIT = 100;

export function formatNotificationEventsUrl(args: {
  afterSequence: number;
  serverUrl: string;
}): string {
  const url = new URL(args.serverUrl);
  url.pathname = "/api/v1/system/notifications/events";
  url.search = new URLSearchParams({
    afterSequence: String(args.afterSequence),
    limit: String(DESKTOP_NOTIFICATION_LIMIT),
  }).toString();
  url.hash = "";
  return url.toString();
}

export async function fetchNotificationEvents(args: {
  afterSequence: number;
  fetchImpl: typeof fetch;
  serverUrl: string;
}) {
  const response = await args.fetchImpl(
    formatNotificationEventsUrl({
      afterSequence: args.afterSequence,
      serverUrl: args.serverUrl,
    }),
  );
  if (!response.ok) {
    throw new Error(
      `Notification events request failed with HTTP ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  return notificationEventsResponseSchema.parse(payload);
}

export function routeForNotificationEvent(event: NotificationEvent): string {
  if (event.projectId === PERSONAL_PROJECT_ID) {
    return `/threads/${encodeURIComponent(event.targetThreadId)}`;
  }
  return `/projects/${encodeURIComponent(event.projectId)}/threads/${encodeURIComponent(event.targetThreadId)}`;
}
