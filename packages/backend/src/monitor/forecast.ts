// whenreset-style next-reset estimate: anchor on the latest reset / credit-drop activity, then
// read historical interval quantiles that are still longer than the current wait. A pure function
// so the mirrored radar snapshot and the local pipeline feed it exactly the same way.
import type { CodexResetEvent, CodexResetForecast } from "@aihot/contracts/monitor";

const DAY = 86_400_000;
const KINDS = new Set(["direct_reset", "reset_credit"]);

function published(e: CodexResetEvent): string {
  return e.confirmedAt ?? e.createdAt ?? "";
}

function anchorLabel(e: CodexResetEvent): string {
  const status = e.presentation?.status ?? "announced";
  const kind = e.type === "reset_credit" ? "发卡" : "额度重置";
  if (status === "in_progress") return "发卡进行中";
  if (status === "confirmed") return `已确认${kind}`;
  if (status === "likely_completed") return `应已${kind}`;
  return `已宣布${kind}`;
}

function bjIso(ms: number): string {
  // Wall-clock in Beijing, expressed as a +08:00 ISO string the page formatters understand.
  return new Date(ms + 8 * 3_600_000).toISOString().replace("Z", "+08:00");
}

export function codexForecast(events: CodexResetEvent[], now = Date.now()): CodexResetForecast | null {
  const relevant = events.filter((e) => KINDS.has(e.type) && (e.confirmedAt ?? e.createdAt));
  if (!relevant.length) return null;

  // An explicit announced window in the future always wins over the historical model.
  const scheduled = relevant
    .filter((e) => e.schedule?.from && Date.parse(e.schedule.from) > now)
    .sort((a, b) => Date.parse(a.schedule!.from!) - Date.parse(b.schedule!.from!))[0];

  // Confirmed occurrences, deduped per type and Beijing day (several posts may cover one reset).
  const unique = new Map<string, CodexResetEvent>();
  for (const e of relevant
    .filter((e) => e.presentation?.status === "confirmed" && Date.parse(published(e)) <= now)
    .sort((a, b) => Date.parse(published(a)) - Date.parse(published(b)))) {
    unique.set(`${e.type}:${e.occurredOn ?? published(e).slice(0, 10)}`, e);
  }
  const records = [...unique.values()];
  const times = records.map((e) => Date.parse(published(e)));
  const gaps = times.slice(1).map((t, i) => (t - times[i]!) / DAY).filter((g) => g > 0);

  // The anchor is the latest reset / credit activity regardless of confirmation state — a
  // freshly announced (not yet landed) reset still restarts the wait, as on the radar site.
  const anchor = [...relevant].sort((a, b) => Date.parse(published(a)) - Date.parse(published(b))).at(-1)!;
  const anchoredAt = published(anchor);
  const basis = { basisCount: records.length, sampleCount: gaps.length, anchoredAt, anchoredLabel: anchorLabel(anchor) };

  if (scheduled) {
    return { mode: "announced", label: "原文预告", targetAt: bjIso(Date.parse(scheduled.schedule!.from!)), ...basis };
  }
  // Same floor as the radar site: no date invented without enough historical intervals.
  if (gaps.length < 5) return null;
  const elapsed = (now - Date.parse(anchoredAt)) / DAY;
  const remaining = gaps.filter((g) => g > elapsed).sort((a, b) => a - b);
  if (!remaining.length) return null;
  // Lead with the 25% quantile (the earliest plausible moment).
  const gap = remaining[Math.floor((remaining.length - 1) * 0.25)]!;
  return { mode: "history", label: "历史推测", targetAt: bjIso(Date.parse(anchoredAt) + gap * DAY), ...basis };
}
