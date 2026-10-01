// Usage reports and the board built from them. Every number is self-reported: the API accepts what a
// member's own tool sends, and the pages say so.
import { TOKEN_TOOLS, type TokenBoardResponse, type TokenBoardRow, type TokenHeatmapCell, type TokenHeatmapLevel, type TokenHeatmapResponse, type TokenRange, type TokenSummaryResponse, type TokenTool, type TokenUsageAccepted, type TokenUsageInput } from "@aihot/contracts/token";
import { beijingDate, isValidDate } from "@aihot/contracts/time";
import { sql } from "../db.ts";

/** Reports may cover today and the six days before it; nothing older is accepted. */
export const USAGE_WINDOW_DAYS = 7;
/** A sanity ceiling per report; above it the report is refused rather than silently clipped. */
const REPORT_TOKEN_CEILING = 50_000_000_000;

export class UsageRejected extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function today(): string {
  return beijingDate(new Date());
}

function windowStart(): string {
  return beijingDate(Date.now() - (USAGE_WINDOW_DAYS - 1) * 86400_000);
}

function isTool(value: unknown): value is TokenTool {
  return typeof value === "string" && (TOKEN_TOOLS as readonly string[]).includes(value);
}

function wholeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Validates one report and returns the normalised form; throws UsageRejected with a readable reason. */
export function parseReport(input: TokenUsageInput): { day: string; tool: TokenTool; model: string | null; tokensIn: number; tokensOut: number; tokensTotal: number; costUsd: number | null; client: string | null; idempotencyKey: string } {
  const day = String(input.day ?? "");
  if (!isValidDate(day)) throw new UsageRejected(400, "invalid_day", "day 必须是 YYYY-MM-DD 格式的日期。");
  if (day < windowStart() || day > today()) throw new UsageRejected(400, "day_out_of_range", `day 只能是今天或之前 ${USAGE_WINDOW_DAYS - 1} 天内的日期。`);

  const tool: TokenTool = input.tool === undefined ? "other" : isTool(input.tool) ? input.tool : (() => {
    throw new UsageRejected(400, "invalid_tool", `tool 只能是：${TOKEN_TOOLS.join("、")}。`);
  })();

  const tokensIn = input.tokensIn === undefined ? 0 : wholeNumber(input.tokensIn);
  const tokensOut = input.tokensOut === undefined ? 0 : wholeNumber(input.tokensOut);
  if (tokensIn === null || tokensOut === null) throw new UsageRejected(400, "invalid_tokens", "tokensIn 与 tokensOut 必须是非负整数。");
  let tokensTotal: number | null = input.tokensTotal === undefined ? null : wholeNumber(input.tokensTotal);
  if (tokensTotal === null && input.tokensTotal !== undefined) throw new UsageRejected(400, "invalid_tokens", "tokensTotal 必须是非负整数。");
  tokensTotal = tokensTotal ?? tokensIn + tokensOut;
  if (tokensTotal <= 0) throw new UsageRejected(400, "invalid_tokens", "至少要上报 1 个 token。");
  if (tokensTotal > REPORT_TOKEN_CEILING) throw new UsageRejected(400, "tokens_too_large", "单次上报的 token 数太大，请分多次上报。");

  let costUsd: number | null = null;
  if (input.costUsd !== undefined && input.costUsd !== null) {
    const cost = Number(input.costUsd);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) throw new UsageRejected(400, "invalid_cost", "costUsd 必须是 0 到 1000000 之间的数字。");
    costUsd = Number(cost.toFixed(6));
  }

  const idempotencyKey = String(input.idempotencyKey ?? "").trim();
  if (idempotencyKey.length < 1 || idempotencyKey.length > 120) throw new UsageRejected(400, "invalid_idempotency_key", "idempotencyKey 必填，长度 1–120。");

  const model = input.model ? String(input.model).slice(0, 120) : null;
  const client = input.client ? String(input.client).slice(0, 120) : null;
  return { day, tool, model, tokensIn, tokensOut, tokensTotal, costUsd, client, idempotencyKey };
}

/** Writes one report and rolls up its day and tool; repeating a key replaces the earlier report. */
export async function recordUsage(userId: string, keyId: string | null, input: TokenUsageInput): Promise<TokenUsageAccepted> {
  const report = parseReport(input);
  let replaced = false;
  try {
    await sql`INSERT INTO token_usage_events (user_id, key_id, day, tool, model, tokens_in, tokens_out, tokens_total, cost_usd, client, idempotency_key)
              VALUES (${userId}, ${keyId}, ${report.day}, ${report.tool}, ${report.model}, ${report.tokensIn}, ${report.tokensOut},
                      ${report.tokensTotal}, ${report.costUsd}, ${report.client}, ${report.idempotencyKey})`;
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    await sql`UPDATE token_usage_events SET key_id = ${keyId}, day = ${report.day}, tool = ${report.tool}, model = ${report.model},
                tokens_in = ${report.tokensIn}, tokens_out = ${report.tokensOut}, tokens_total = ${report.tokensTotal},
                cost_usd = ${report.costUsd}, client = ${report.client}, created_at = now()
              WHERE user_id = ${userId} AND idempotency_key = ${report.idempotencyKey}`;
    replaced = true;
  }
  await rollupDay(userId, report.day, report.tool);
  return { day: report.day, tool: report.tool, tokensTotal: report.tokensTotal, replaced };
}

/** Recomputes one (member, day, tool) row from its events, so a replaced report cannot double-count. */
async function rollupDay(userId: string, day: string, tool: TokenTool): Promise<void> {
  await sql`INSERT INTO token_usage_daily (user_id, day, tool, tokens_total, tokens_in, tokens_out, cost_usd, events, updated_at)
            SELECT user_id, day, tool, sum(tokens_total)::bigint, sum(tokens_in)::bigint, sum(tokens_out)::bigint,
                   coalesce(sum(cost_usd), 0), count(*)::int, now()
            FROM token_usage_events WHERE user_id = ${userId} AND day = ${day} AND tool = ${tool}
            GROUP BY user_id, day, tool
            ON CONFLICT (user_id, day, tool) DO UPDATE SET tokens_total = EXCLUDED.tokens_total, tokens_in = EXCLUDED.tokens_in,
              tokens_out = EXCLUDED.tokens_out, cost_usd = EXCLUDED.cost_usd, events = EXCLUDED.events, updated_at = now()`;
}

function rangeStart(range: TokenRange): string | null {
  if (range === "today") return today();
  if (range === "7d") return beijingDate(Date.now() - 6 * 86400_000);
  if (range === "30d") return beijingDate(Date.now() - 29 * 86400_000);
  return null;
}

export async function tokenBoard(range: TokenRange, tool: TokenTool | null, limit: number): Promise<TokenBoardResponse> {
  const from = rangeStart(range);
  const rows = await sql<{ handle: string; display_name: string | null; tokens: number; active_days: number; last_day: string }[]>`
    SELECT u.handle, u.display_name, sum(d.tokens_total)::bigint AS tokens, count(DISTINCT d.day)::int AS active_days, max(d.day)::text AS last_day
    FROM token_usage_daily d JOIN community_users u ON u.id = d.user_id
    WHERE (${from}::date IS NULL OR d.day >= ${from}::date) AND (${tool}::text IS NULL OR d.tool = ${tool}::text)
      AND u.status = 'active' AND u.role <> 'banned'
    GROUP BY u.handle, u.display_name
    ORDER BY tokens DESC, u.handle
    LIMIT ${limit}`;
  return {
    range,
    tool,
    from,
    today: today(),
    rows: rows.map((r, i) => ({ rank: i + 1, handle: r.handle, displayName: r.display_name, tokens: Number(r.tokens), activeDays: r.active_days, lastDay: r.last_day }) as TokenBoardRow),
    anonymousLimit: ANONYMOUS_ROWS,
    truncated: rows.length >= limit,
  };
}

/** Visitors without an account still get a taste of the board, not the whole thing. */
export const ANONYMOUS_ROWS = 10;

export async function tokenHeatmap(handle: string, days: number): Promise<TokenHeatmapResponse> {
  const [user] = await sql<{ id: string; handle: string; display_name: string | null }[]>`
    SELECT id, handle, display_name FROM community_users WHERE handle = ${handle} AND status = 'active'`;
  if (!user) throw new UsageRejected(404, "no_such_member", "没有这位成员。");
  const from = beijingDate(Date.now() - (days - 1) * 86400_000);
  const rows = await sql<{ day: string; tokens: number }[]>`
    SELECT day::text AS day, sum(tokens_total)::bigint AS tokens FROM token_usage_daily
    WHERE user_id = ${user.id} AND day >= ${from}::date GROUP BY day ORDER BY day`;
  const byDay = new Map(rows.map((r) => [r.day, Number(r.tokens)]));
  const peak = rows.reduce((max, r) => Math.max(max, Number(r.tokens)), 0);
  const cells: TokenHeatmapCell[] = [];
  let total = 0;
  for (let i = days - 1; i >= 0; i--) {
    const day = beijingDate(Date.now() - i * 86400_000);
    const tokens = byDay.get(day) ?? 0;
    total += tokens;
    cells.push({ day, tokens, level: levelOf(tokens, peak) });
  }
  return { handle: user.handle, displayName: user.display_name, days, total, activeDays: rows.length, cells };
}

/** Five shades: nothing, then quarters of this member's own peak day. */
function levelOf(tokens: number, peak: number): TokenHeatmapLevel {
  if (tokens <= 0 || peak <= 0) return 0;
  const step = peak / 4;
  const level = Math.min(4, Math.max(1, Math.ceil(tokens / step)));
  return level as TokenHeatmapLevel;
}

export async function tokenSummary(): Promise<TokenSummaryResponse> {
  const [members] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM community_users WHERE status = 'active'`;
  const [todayRow] = await sql<{ people: number; tokens: number }[]>`
    SELECT count(DISTINCT user_id)::int AS people, coalesce(sum(tokens_total), 0)::bigint AS tokens FROM token_usage_daily WHERE day = ${today()}::date`;
  const [allTime] = await sql<{ tokens: number }[]>`SELECT coalesce(sum(tokens_total), 0)::bigint AS tokens FROM token_usage_daily`;
  return {
    members: members!.n,
    reportingToday: todayRow!.people,
    tokensToday: Number(todayRow!.tokens),
    tokensTotal: Number(allTime!.tokens),
    today: today(),
  };
}
