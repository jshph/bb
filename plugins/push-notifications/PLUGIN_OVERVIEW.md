Get a notification when an agent asks a question, finishes a turn, or stops on an error. Choose mobile, web, and desktop delivery independently in Settings → Push notifications.

## Delivery

Mobile devices receive push messages through Expo, including when the app is closed. Supported web browsers receive Web Push through a service worker, including when bb is closed. The desktop app receives system notifications over bb’s live connection while it remains open. Web delivery requires HTTPS (or localhost), browser notification permission, service workers, and the Push API. Mobile WebViews use mobile push only.

Click a notification to open its thread. Events arriving together are combined, with pending questions taking priority. Read, archived, deleted, and hidden threads are suppressed. Multiple tabs or windows of the same origin and client type deduplicate delivery when browser storage and Web Locks are available.

## Settings

- `mobileEnabled` / **Mobile notifications**: send to registered phones and tablets. Default: true.
- `webEnabled` / **Web notifications**: send Web Push to subscribed browsers. Default: true.
- `desktopEnabled` / **Desktop notifications**: notify running desktop clients. Default: true.
- `expoPushUrl` / **Expo push relay URL**: mobile relay endpoint. Defaults to `https://exp.host/--/api/v2/push/send`.

Channel switches apply to this server and save immediately. Browser permission and a push subscription are granted separately on each browser with **Allow notifications**. **Disable on this browser** removes its local and server subscription. If permission is blocked, change the browser or operating system notification settings. **Send test notification** sends to all subscribed browsers or connected desktop clients. A successful push-service request still does not guarantee an OS banner; system settings and Focus modes can suppress display.

## CLI and SDK

- `bb push-notifications list [--json]`: registered mobile devices, with redacted tokens.
- `bb push-notifications add --token <expo-push-token> --platform <ios|android> --label <device-label>`: register or refresh a mobile device.
- `bb push-notifications remove <id>`: remove a mobile device.
- `bb push-notifications status [--json]`: channel switches, mobile relay, mobile and web subscription counts, and last mobile send result.
- `bb push-notifications test <web|desktop>`: send a test to subscribed web browsers or connected desktop clients. Fails if the channel is disabled.
- `bb plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>`: change a channel.

Agents can use the SDK’s plugin settings API for the same switches and `sdk.plugins.callRpc({ pluginId: "push-notifications", method: "notifications.test", input: { channel: "web" }, outputSchema: z.object({ ok: z.literal(true) }) })` to send a test. RPC input is validated by `pushNotificationsRpcContract`. Permission requests still require a click in the target client.
