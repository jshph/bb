self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      if (!event.data) return;
      let payload;
      try {
        payload = event.data.json();
      } catch {
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        typeof payload.id !== "string" ||
        typeof payload.title !== "string" ||
        typeof payload.body !== "string" ||
        !(typeof payload.threadId === "string" || payload.threadId === null)
      ) {
        return;
      }
      const path =
        payload.threadId === null
          ? "/"
          : `/threads/${encodeURIComponent(payload.threadId)}`;
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icon-192.png",
        tag: `bb-${payload.threadId ?? payload.id}`,
        data: { path },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const path =
        typeof event.notification.data?.path === "string"
          ? event.notification.data.path
          : "/";
      const target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client = windows[0];
      if (client) {
        await client.navigate(target);
        await client.focus();
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
