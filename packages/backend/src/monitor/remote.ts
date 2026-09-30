// Fallback data source for the Codex reset monitor: while the local SocialData pipeline has no
// events yet, the site mirrors the public radar snapshot from whenreset.uk (the same Tibo
// timeline, collected and classified there). Failures stay silent: without it the local empty
// snapshot is served exactly as before.
import { beijingDate } from "@aihot/contracts/time";
import type { CodexResetEvent, CodexResetMonitor, CodexResetsSnapshot } from "@aihot/contracts/monitor";
import { sha256, stableJson } from "../lib/ids.ts";
import { bjIso, MONITOR_PAGE_URL } from "./read.ts";

const RADAR_URL = "https://whenreset.uk/api/radar.json";
const CACHE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

let cache: { at: number; snapshot: CodexResetsSnapshot | null } = { at: 0, snapshot: null };

type RadarEvent = {
  id?: unknown; type?: unknown; status?: unknown; title?: unknown; summary?: unknown;
  audience?: unknown; text?: unknown; translation?: unknown; sourceUrl?: unknown;
  publishedAt?: unknown; detectedAt?: unknown; classification?: { phase?: unknown } | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mapEvent(raw: RadarEvent): CodexResetEvent | null {
  const id = str(raw.id);
  const publishedAt = str(raw.publishedAt);
  if (!id || !/^\d+$/.test(id) || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;
  const kind = str(raw.type) ?? "reset";
  const type: CodexResetEvent["type"] = kind === "card" ? "reset_credit" : "direct_reset";
  const confirmed = raw.status === "completed";
  const inProgress = raw.classification?.phase === "in_progress";
  const label = kind === "card" ? "发重置卡" : kind === "positive" ? "相关动态" : "额度重置";
  const audience = str(raw.audience);
  const text = str(raw.text) ?? "";
  const translation = str(raw.translation);
  return {
    id,
    type,
    label,
    displayLabel: label,
    presentation: {
      reportedAt: bjIso(publishedAt),
      status: confirmed ? "confirmed" : inProgress ? "in_progress" : "announced",
      scopeKnown: !!audience && audience !== "未明确",
      scopeLabel: audience,
      kindExplicit: kind !== "positive",
      timeInferred: false,
      audienceZh: audience,
      productsZh: null,
    },
    estimate: null,
    status: confirmed ? "confirmed" : "announced",
    title: str(raw.title) ?? label,
    scope: audience ?? "以原文为准",
    createdAt: bjIso(publishedAt),
    updatedAt: bjIso(str(raw.detectedAt) ?? publishedAt),
    confirmedAt: confirmed ? bjIso(publishedAt) : null,
    occurredOn: bjIso(publishedAt)?.slice(0, 10) ?? null,
    confirmationBasis: "source_post",
    schedule: null,
    posts: [{
      id,
      publishedAt: bjIso(publishedAt),
      stage: "原帖",
      text: translation ?? str(raw.summary) ?? "",
      originalText: text,
      fullText: translation,
      fullOriginalText: text,
      context: [],
      url: str(raw.sourceUrl) ?? `https://x.com/thsottiaux/status/${id}`,
    }],
    url: MONITOR_PAGE_URL,
  };
}

async function fetchRadar(now: number): Promise<CodexResetsSnapshot | null> {
  const response = await fetch(RADAR_URL, { headers: { "User-Agent": "aihot-codex-monitor/1.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return null;
  const radar: any = await response.json();
  if (!radar || typeof radar !== "object" || !Array.isArray(radar.events) || !radar.sync || typeof radar.sync !== "object") return null;
  const events = radar.events.map(mapEvent).filter((e: CodexResetEvent | null): e is CodexResetEvent => !!e);
  if (!events.length) return null;
  const lastSuccessAt = str(radar.sync.lastSuccessAt);
  const monitor: CodexResetMonitor = {
    status: "healthy",
    lastAttemptAt: bjIso(str(radar.sync.lastAttemptAt)),
    lastCollectedAt: bjIso(lastSuccessAt),
    lastVerifiedAt: bjIso(lastSuccessAt),
    heldWindowCount: 0,
    pendingCount: 0,
    reviewCount: 0,
  };
  return {
    schemaVersion: 1 as const,
    timezone: "Asia/Shanghai" as const,
    today: beijingDate(now),
    checkedAt: bjIso(lastSuccessAt),
    historyFrom: bjIso(str(radar.sync.historyStartAt)),
    count: events.length,
    events,
    activities: [],
    monitor,
    outage: null,
  };
}

/** Cached mirror snapshot, or null when unreachable/invalid (negative results also cached briefly). */
export async function remoteSnapshot(now = Date.now()): Promise<CodexResetsSnapshot | null> {
  if (now - cache.at < CACHE_TTL_MS) return cache.snapshot;
  const snapshot = await fetchRadar(now).catch(() => null);
  cache = { at: now, snapshot };
  return snapshot;
}

/** Same shape as codexResetVersion, so the page poller keeps working over mirrored data. */
export async function remoteVersion(now = Date.now()) {
  const snap = await remoteSnapshot(now);
  if (!snap) return null;
  return {
    version: sha256(stableJson(snap.events.map((e) => [e.id, e.updatedAt, e.presentation?.status]))),
    checkedAt: snap.checkedAt,
    today: snap.today,
  };
}
