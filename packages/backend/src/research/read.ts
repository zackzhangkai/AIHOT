import type { ResearchMarket, ResearchReportDetail, ResearchReportIngest, ResearchReportSummary, ResearchRiskLevel, ResearchSignal, ResearchSignalLevel } from "@aihot/contracts/research";
import { sql } from "../db.ts";

const MARKETS = new Set<ResearchMarket>(["us-drawdown", "cn-ashare-close"]);
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const SIGNAL_LEVELS = new Set(["red", "amber", "green"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ResearchIngestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
interface Row { market: ResearchMarket; report_date: Date; title: string; risk_level: string; summary: string; signals: ResearchSignal[]; triggers: ResearchReportDetail["triggers"]; watchlist: ResearchReportDetail["watchlist"]; body_md: string; pushed_at: Date; }
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function signalsOf(raw: unknown): ResearchSignal[] {
  if (!Array.isArray(raw) || raw.length > 32) throw new ResearchIngestError(400, "signals must contain at most 32 entries");
  return raw.map((s) => {
    const name = typeof s?.name === "string" ? s.name.trim().slice(0, 120) : "";
    const detail = typeof s?.detail === "string" ? s.detail.trim().slice(0, 4000) : "";
    if (!name || !detail || !SIGNAL_LEVELS.has(s?.level)) throw new ResearchIngestError(400, "each signal needs name, level and detail");
    return { name, detail, level: s.level as ResearchSignalLevel, source: typeof s?.source === "string" ? s.source.trim().slice(0, 300) || null : null };
  });
}

export async function storeResearchReport(input: ResearchReportIngest): Promise<{ market: ResearchMarket; date: string; replaced: boolean }> {
  if (!input || typeof input !== "object") throw new ResearchIngestError(400, "body must be a JSON object");
  if (!MARKETS.has(input.market)) throw new ResearchIngestError(400, "unknown market");
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const bodyMd = typeof input.bodyMd === "string" ? input.bodyMd : "";
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new ResearchIngestError(400, "date must be YYYY-MM-DD");
  if (!title || title.length > 300 || !summary || summary.length > 4000 || bodyMd.length > 200_000) throw new ResearchIngestError(400, "invalid report text");
  if (!RISK_LEVELS.has(input.riskLevel)) throw new ResearchIngestError(400, "riskLevel must be low, medium or high");
  const signals = signalsOf(input.signals);
  const triggers = input.triggers && typeof input.triggers === "object" ? { escalate: Array.isArray(input.triggers.escalate) ? input.triggers.escalate.filter((x): x is string => typeof x === "string").slice(0, 16) : [], deescalate: Array.isArray(input.triggers.deescalate) ? input.triggers.deescalate.filter((x): x is string => typeof x === "string").slice(0, 16) : [] } : null;
  const watchlist = Array.isArray(input.watchlist) ? input.watchlist.filter((x) => typeof x?.window === "string" && typeof x?.event === "string").map((x) => ({ window: x.window.slice(0, 120), event: x.event.slice(0, 300), focus: typeof x.focus === "string" ? x.focus.slice(0, 500) : "" })).slice(0, 32) : null;
  const rows = await sql<{ report_date: Date; inserted: boolean }[]>`
    INSERT INTO research_reports (market, report_date, title, risk_level, summary, signals, triggers, watchlist, body_md)
    VALUES (${input.market}, ${date}::date, ${title}, ${input.riskLevel}, ${summary}, ${sql.json(signals as never)}, ${triggers ? sql.json(triggers as never) : null}, ${watchlist?.length ? sql.json(watchlist as never) : null}, ${bodyMd})
    ON CONFLICT (market, report_date) DO UPDATE SET title = excluded.title, risk_level = excluded.risk_level, summary = excluded.summary, signals = excluded.signals, triggers = excluded.triggers, watchlist = excluded.watchlist, body_md = excluded.body_md, pushed_at = now()
    RETURNING report_date, (xmax = 0) AS inserted`;
  return { market: input.market, date: isoDate(rows[0].report_date), replaced: !rows[0].inserted };
}

function summaryOf(row: Row): ResearchReportSummary {
  const count = (level: ResearchSignalLevel) => (Array.isArray(row.signals) ? row.signals : []).filter((s) => s?.level === level).length;
  return { market: row.market, date: isoDate(row.report_date), title: row.title, riskLevel: row.risk_level as ResearchRiskLevel, summary: row.summary, redCount: count("red"), amberCount: count("amber"), greenCount: count("green") };
}
export async function listResearchSummaries(market: ResearchMarket, limit = 90): Promise<ResearchReportSummary[]> {
  const rows = await sql<Row[]>`SELECT market, report_date, title, risk_level, summary, signals, triggers, watchlist, body_md, pushed_at FROM research_reports WHERE market = ${market} ORDER BY report_date DESC LIMIT ${Math.max(1, Math.min(limit, 365))}`;
  return rows.map(summaryOf);
}
export async function loadResearchReport(market: ResearchMarket, date: string): Promise<ResearchReportDetail | null> {
  if (!MARKETS.has(market) || !DATE_RE.test(date)) return null;
  const row = (await sql<Row[]>`SELECT market, report_date, title, risk_level, summary, signals, triggers, watchlist, body_md, pushed_at FROM research_reports WHERE market = ${market} AND report_date = ${date}::date LIMIT 1`)[0];
  return row ? { ...summaryOf(row), signals: Array.isArray(row.signals) ? row.signals : [], triggers: row.triggers ?? null, watchlist: row.watchlist ?? null, bodyMd: row.body_md, pushedAt: row.pushed_at.toISOString() } : null;
}
