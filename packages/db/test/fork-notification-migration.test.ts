import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { expect, it } from "vitest";
import { createConnection, migrate } from "../src/index.js";

it("upgrades the deployed fork ledger while preserving notification subscriptions", () => {
  const db = createConnection(":memory:");
  const migrationsFolder = fileURLToPath(
    new URL("../drizzle", import.meta.url),
  );
  try {
    db.$client.pragma("foreign_keys = OFF");
    db.$client.exec(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    for (const migration of readMigrationFiles({ migrationsFolder })) {
      if (migration.folderMillis > 1787613751578) break;
      for (const statement of migration.sql) db.$client.exec(statement);
      db.$client
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(migration.hash, migration.folderMillis);
    }
    db.$client.exec(
      readFileSync(
        new URL("../drizzle/0113_fork_notifications.sql", import.meta.url),
        "utf8",
      ),
    );
    db.$client
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      )
      .run(
        "677283da4a3fde4f641f5b52eb616eba18c00a9b76e45a1cb2fe1bacb468112a",
        1787624951974,
      );
    db.$client.exec(
      "INSERT INTO notification_subscriptions (id, endpoint, p256dh, auth, created_at, updated_at) VALUES ('existing', 'https://example.com/push', 'test-key', 'test-auth', 1, 1)",
    );

    migrate(db);
    migrate(db);

    expect(
      db.$client.prepare("SELECT id FROM notification_subscriptions").all(),
    ).toEqual([{ id: "existing" }]);
    expect(
      db.$client.prepare("SELECT stats_json FROM plugin_marketplaces").all(),
    ).toEqual([]);
    expect(
      db.$client.prepare("SELECT * FROM thread_conversation_outlines").all(),
    ).toEqual([]);
    expect(
      db.$client
        .prepare("SELECT send_at, waiting_on FROM queued_thread_messages")
        .all(),
    ).toEqual([]);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  } finally {
    db.$client.close();
  }
});
