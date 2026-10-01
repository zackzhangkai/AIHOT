// The token board: a report is validated before it is stored, the same idempotency key replaces the
// earlier report instead of adding to it, the board counts days (not day/tool rows) and hides banned
// members, and an API key is only ever stored as a hash.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingDate } from "@aihot/contracts/time";
import { closeDb, sql } from "@aihot/backend/db";
import { newShortId } from "@aihot/backend/lib/ids";
import { createKey, revokeKey, resolveKeyToken } from "@aihot/backend/community/keys";
import { ANONYMOUS_ROWS, UsageRejected, parseReport, recordUsage, tokenBoard, tokenHeatmap, tokenSummary } from "@aihot/backend/community/usage";

const T = tag();
const today = beijingDate(new Date());
const yesterday = beijingDate(Date.now() - 86400_000);

async function member(handle: string, opts: { role?: string; status?: string } = {}): Promise<string> {
  const id = newShortId(9);
  const email = `${handle}@${T}.test`;
  await sql`INSERT INTO community_users (id, handle, email, email_verified, role, status)
            VALUES (${id}, ${handle}, ${email}, true, ${opts.role ?? "member"}, ${opts.status ?? "active"})`;
  return id;
}

after(closeDb);

test("a report is checked before it is stored: day, window, amounts and idempotency key", () => {
  const ok = { day: today, tokensTotal: 100, idempotencyKey: "k1" };
  assert.deepEqual(parseReport(ok), {
    day: today, tool: "other", model: null, tokensIn: 0, tokensOut: 0, tokensTotal: 100, costUsd: null, client: null, idempotencyKey: "k1",
  });
  // tokensTotal defaults to in + out.
  assert.equal(parseReport({ ...ok, tokensTotal: undefined, tokensIn: 30, tokensOut: 12 }).tokensTotal, 42);

  const bad: Array<[Record<string, unknown>, string]> = [
    [{ ...ok, day: "2026-13-40" }, "invalid_day"],
    [{ ...ok, day: "2001-01-01" }, "day_out_of_range"],
    [{ ...ok, tokensTotal: 0 }, "invalid_tokens"],
    [{ ...ok, tokensTotal: -5 }, "invalid_tokens"],
    [{ ...ok, tokensTotal: 1.5 }, "invalid_tokens"],
    [{ ...ok, tokensTotal: 60_000_000_000 }, "tokens_too_large"],
    [{ ...ok, tool: "not-a-tool" }, "invalid_tool"],
    [{ ...ok, idempotencyKey: "" }, "invalid_idempotency_key"],
    [{ ...ok, idempotencyKey: "x".repeat(121) }, "invalid_idempotency_key"],
    [{ ...ok, costUsd: -1 }, "invalid_cost"],
  ];
  for (const [input, code] of bad) {
    assert.throws(() => parseReport(input as never), (e: unknown) => e instanceof UsageRejected && e.code === code, `expected ${code}`);
  }
});

test("repeating an idempotency key replaces the report, so a day never double-counts", async () => {
  const me = await member(`board${T}`.slice(0, 31));
  await recordUsage(me, null, { day: today, tool: "claude-code", tokensTotal: 1000, idempotencyKey: `${T}-a` });
  const again = await recordUsage(me, null, { day: today, tool: "claude-code", tokensTotal: 250, idempotencyKey: `${T}-a` });
  assert.equal(again.replaced, true);

  await recordUsage(me, null, { day: today, tool: "codex", tokensTotal: 500, idempotencyKey: `${T}-b` });
  await recordUsage(me, null, { day: yesterday, tool: "codex", tokensTotal: 700, idempotencyKey: `${T}-c` });

  const board = await tokenBoard("7d", null, 50);
  const mine = board.rows.find((r) => r.handle === `board${T}`.slice(0, 31));
  // 250 (replaced, not 1000 + 250) + 500 + 700, over two distinct days.
  assert.equal(mine?.tokens, 1450);
  assert.equal(mine?.activeDays, 2);
  assert.equal(mine?.lastDay, today);

  const filtered = await tokenBoard("7d", "codex", 50);
  assert.equal(filtered.rows.find((r) => r.handle === `board${T}`.slice(0, 31))?.tokens, 1200);

  const todayOnly = await tokenBoard("today", null, 50);
  assert.equal(todayOnly.rows.find((r) => r.handle === `board${T}`.slice(0, 31))?.tokens, 750);
});

test("banned members are off the board, and a visitor sees only the top of it", async () => {
  const gone = await member(`banned${T}`.slice(0, 31), { role: "banned" });
  await recordUsage(gone, null, { day: today, tokensTotal: 999_999, idempotencyKey: `${T}-banned` });

  const board = await tokenBoard("7d", null, 50);
  assert.equal(board.rows.some((r) => r.handle === `banned${T}`.slice(0, 31)), false);

  // The cap belongs to the caller (the route), but the response always tells the page where it is.
  assert.equal(board.anonymousLimit, ANONYMOUS_ROWS);
  const capped = await tokenBoard("7d", null, 1);
  assert.equal(capped.rows.length, 1);
  assert.equal(capped.truncated, true);
});

test("a heatmap is one cell per day over the member's own peak, and 404s for a stranger", async () => {
  const me = await member(`heat${T}`.slice(0, 31));
  await recordUsage(me, null, { day: today, tokensTotal: 4000, idempotencyKey: `${T}-h1` });
  await recordUsage(me, null, { day: yesterday, tokensTotal: 1000, idempotencyKey: `${T}-h2` });

  const handle = `heat${T}`.slice(0, 31);
  const map = await tokenHeatmap(handle, 30);
  assert.equal(map.cells.length, 30);
  assert.equal(map.total, 5000);
  assert.equal(map.activeDays, 2);
  assert.equal(map.cells.at(-1)?.day, today);
  assert.equal(map.cells.at(-1)?.tokens, 4000);
  assert.equal(map.cells.at(-1)?.level, 4, "the peak day is the darkest");
  assert.equal(map.cells.at(-2)?.level, 1, "a quarter of the peak is the lightest non-zero shade");
  assert.equal(map.cells.at(-3)?.level, 0);

  await assert.rejects(tokenHeatmap(`nobody-${T}`, 30), (e: unknown) => e instanceof UsageRejected && e.status === 404);
});

test("the summary counts members and today's reports", async () => {
  const before = await tokenSummary();
  const me = await member(`sum${T}`.slice(0, 31));
  await recordUsage(me, null, { day: today, tokensTotal: 1234, idempotencyKey: `${T}-s1` });
  const after = await tokenSummary();
  assert.equal(after.members, before.members + 1);
  assert.equal(after.today, today);
  assert.ok(after.tokensTotal >= before.tokensTotal + 1234);
});

test("an API key is shown once, stored as a hash, and stops working when revoked", async () => {
  const me = await member(`key${T}`.slice(0, 31));
  const created = await createKey(me, "laptop");
  assert.match(created.token, /^mh_live_/);
  assert.equal(created.prefix, created.token.slice(0, 14));

  const [row] = await sql<{ key_hash: string }[]>`SELECT key_hash FROM community_api_keys WHERE id = ${created.id}`;
  assert.notEqual(row!.key_hash, created.token, "the plain key is never stored");

  assert.deepEqual(await resolveKeyToken(created.token), { userId: me, keyId: created.id });
  assert.equal(await resolveKeyToken("mh_live_not-a-real-key"), null);
  assert.equal(await resolveKeyToken(""), null);

  assert.equal(await revokeKey(me, created.id), true);
  assert.equal(await resolveKeyToken(created.token), null, "a revoked key reports nothing");
});
