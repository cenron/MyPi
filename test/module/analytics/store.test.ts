import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Approval } from "#core/channels";
import { approvalTotals, ruleTotals, usageTotals } from "#module/analytics/queries";
import { AnalyticsStore } from "#module/analytics/store";

const folders: string[] = [];

/** A fresh store in its own temp folder. */
async function newStore(): Promise<AnalyticsStore> {
  const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-store-"));
  folders.push(folder);
  return new AnalyticsStore(join(folder, "analytics.sqlite"));
}

function approval(rules: readonly string[], choice: Approval["choice"], model = "gpt-6-luna"): Approval {
  return { rules, choice, provider: "openai", model, thinking: "high" };
}

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("AnalyticsStore", () => {
  it("rebuilds an older schema for reindexing from session files", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-store-"));
    folders.push(folder);
    const path = join(folder, "analytics.sqlite");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version(version) VALUES (0);
      CREATE TABLE files (old_layout TEXT);
      CREATE TABLE usage (old_layout TEXT);
      CREATE TABLE tool_calls (old_layout TEXT);
      CREATE TABLE shell_commands (old_layout TEXT);`);
    old.close();

    const store = new AnalyticsStore(path);
    const version = store.database.prepare("SELECT version FROM schema_version").get() as { version: number };
    const columns = store.database.prepare("PRAGMA table_info(usage)").all() as { name: string }[];

    expect(version.version).toBe(10);
    expect(columns.map(({ name }) => name)).toContain("entry_id");
    expect(usageTotals(store, undefined)).toEqual([]);
    expect(store.skippedCount()).toBe(0);
    store.close();
  });

  // Every other table comes back from the session files; a dialog is recorded only when it happens.
  it("keeps the recorded permission dialogs through a schema rebuild", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-store-"));
    folders.push(folder);
    const path = join(folder, "analytics.sqlite");
    const first = new AnalyticsStore(path);
    first.recordApproval(approval(["plan-build"], "yes"));
    first.database.exec("UPDATE schema_version SET version = 0");
    first.close();

    const rebuilt = new AnalyticsStore(path);
    expect(ruleTotals(rebuilt, undefined)).toEqual([expect.objectContaining({ rule: "plan-build" })]);
    rebuilt.close();
  });

  it("records a permission dialog as one row per rule that asked", async () => {
    const store = await newStore();
    store.recordApproval(approval(["plan-build", "folder-guard"], "yes"));
    store.recordApproval(approval(["plan-build"], "no"));
    store.recordApproval(approval(["plan-build"], "session", "gpt-5"));

    expect(approvalTotals(store, undefined)).toEqual([
      {
        provider: "openai",
        model: "gpt-5",
        thinking: "high",
        dialogs: 1,
        yes: 0,
        no: 0,
        session: 1,
        noUi: 0,
      },
      {
        provider: "openai",
        model: "gpt-6-luna",
        thinking: "high",
        dialogs: 2,
        yes: 1,
        no: 1,
        session: 0,
        noUi: 0,
      },
    ]);
    expect(ruleTotals(store, undefined)).toEqual([
      { rule: "plan-build", dialogs: 3, yes: 1, no: 1, session: 1, noUi: 0 },
      { rule: "folder-guard", dialogs: 1, yes: 1, no: 0, session: 0, noUi: 0 },
    ]);
    store.close();
  });

  it("counts a dialog with no UI as declined, and only dialogs since a timestamp", async () => {
    const store = await newStore();
    store.recordApproval(approval(["subagents"], "no-ui"));
    expect(ruleTotals(store, undefined)).toEqual([
      { rule: "subagents", dialogs: 1, yes: 0, no: 0, session: 0, noUi: 1 },
    ]);

    const later = Date.now() + 1000;
    expect(approvalTotals(store, later)).toEqual([]);
    expect(ruleTotals(store, later)).toEqual([]);
    expect(approvalTotals(store, Date.now() - 1000)).toHaveLength(1);
    store.close();
  });
});
