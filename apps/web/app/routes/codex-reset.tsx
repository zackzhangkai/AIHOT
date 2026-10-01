import { SITE, withSubject } from "@aihot/industry/site";
import { useEffect, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import type { CodexResetEvent, CodexResetSitePage, CodexResetDay } from "@aihot/contracts/monitor";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { ResetCalendar } from "../features/monitor/ResetCalendar";
import { bjTime, durationText, monthDay, stamp, typeName, windowText } from "../features/monitor/format";
import { IconChevronDown, IconChevronRight } from "../components/icons";
import { useEntrance } from "../lib/hydration";

export async function loader({ request, params }: { request: Request; params: { date?: string } }) {
  const [data, day] = await Promise.all([
    loadOr404<CodexResetSitePage>("/api/site/codex-reset", { signal: request.signal }),
    params.date ? loadOr404<CodexResetDay>(`/api/site/codex-reset/days/${encodeURIComponent(params.date)}`, { signal: request.signal }) : null,
  ]);
  return { ...data, ...(day ? { selectedDate: day.date, events: day.events } : {}), serverNow: Date.now() };
}

export function meta() {
  return pageMeta({
    title: "Tibo重置监控",
    description: "跟踪 Tibo 公布的 Codex 额度重置与重置卡发放：推算的北京时间生效窗口、适用范围、中文原帖与历史日历。",
    path: "/codex-reset",
    image: "/og/pages/codex-reset.png",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" };
}

const POLL_MS = 60_000;

/** Low-frequency version check while the page is in the foreground. */
function useVersionPolling(version: string) {
  const revalidator = useRevalidator();
  useEffect(() => {
    let stopped = false;
    let request: AbortController | null = null;
    const tick = async () => {
      if (document.visibilityState !== "visible" || request) return;
      request = new AbortController();
      try {
        const res = await fetch("/api/site/codex-reset/version", { cache: "no-store", signal: request.signal });
        if (!res.ok) return;
        const v = (await res.json()) as { version: string };
        if (!stopped && v.version !== version) revalidator.revalidate();
      } catch {
        // offline: try again next tick
      } finally {
        request = null;
      }
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      request?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [version, revalidator]);
}

function scopeText(e: CodexResetEvent) {
  const who = e.presentation?.audienceZh ?? e.presentation?.scopeLabel ?? "Tibo 未说明适用范围";
  return e.presentation?.productsZh ? `${who} · ${e.presentation.productsZh}` : who;
}

/** The dashboard starts with the two things readers came for: forecast and last reset.
 * Tibo's post remains a source, not the visual centre of the page. */
function Hero({ d, now }: { d: CodexResetSitePage; now: number }) {
  const e = d.current;
  const entrance = useEntrance();
  const shell = "reset-hero relative overflow-hidden rounded-sheet border border-line-strong p-5 sm:p-7 lg:p-9";
  const status = e?.presentation?.status ?? "announced";
  const window = e?.estimate ?? e?.schedule;
  const through = window?.through ? Date.parse(window.through) : null;
  const from = window?.from ? Date.parse(window.from) : null;
  const historicalEstimate = d.stats.nextResetEstimate;
  let timing: string | null = null;
  if (status === "expired_unconfirmed" && through) timing = `已比预计晚 ${durationText(now - through)}，仍在等待确认`;
  else if (status === "announced" && from && now < from) timing = `距预计时段还有 ${durationText(from - now)}`;
  else if (status === "announced" && through && now < through) timing = "正处在预计时间段内";
  else if (status === "in_progress" && e?.presentation?.reportedAt) timing = `Tibo ${stamp(e.presentation.reportedAt)} 表示正在进行`;
  const forecastWindow = window?.from
    ? { from: window.from, through: window.through, source: "announcement" as const }
    : historicalEstimate
      ? { from: historicalEstimate.from, through: historicalEstimate.through, source: "history" as const }
      : null;
  const post = e?.posts[0];
  return (
    <section
      className={`${shell} ${entrance ? "animate-fade-up" : ""}`}
      style={{ "--tone": status === "expired_unconfirmed" ? "var(--hot)" : "var(--accent)" } as React.CSSProperties}
    >
      <div className="relative z-[1] min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="reset-hero-kicker">CODEX RESET RADAR · 北京时间</p>
            <h2 className="mt-1 text-[25px] font-[650] leading-[1.2] text-ink sm:text-[32px]">下次额度重置预测</h2>
          </div>
          {e ? <span className={`inline-flex items-center gap-2 text-[12px] font-medium ${status === "expired_unconfirmed" ? "text-hot" : "text-amber-ink"}`}><span className="cr-dot cr-dot-live" aria-hidden="true" />{typeName(e.type)} · 公开信号已捕获</span> : <span className="inline-flex items-center gap-2 text-[12px] font-medium text-ok-ink"><span className="cr-dot" aria-hidden="true" />等待新的公开信号</span>}
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.85fr)]">
          <div className="rounded-panel border border-line bg-canvas p-5 sm:p-6">
            <p className="text-[12px] font-medium text-ink-4">{forecastWindow?.source === "announcement" ? "已公告的预计窗口" : "基于历史记录的预测窗口"}</p>
            {forecastWindow ? <p className="num mt-3 text-[30px] font-[700] leading-[1.12] tracking-[-0.03em] text-accent sm:text-[42px]">{windowText(forecastWindow.from, forecastWindow.through, d.today).replace("–", " – ")}</p> : <p className="mt-3 text-[22px] font-[650] leading-[1.35] text-ink">样本不足，暂不编造预测</p>}
            <p className="mt-3 text-[13px] leading-[1.75] text-ink-4">{forecastWindow?.source === "announcement" ? (timing ?? "按公开公告持续跟踪中") : historicalEstimate ? `最近 ${historicalEstimate.sampleSize} 次已确认重置的中位间隔为 ${historicalEstimate.intervalDays} 天；这是历史推测，不是 OpenAI 公告。` : "有明确的公开信息后会显示预计窗口。"}</p>
          </div>
          <div className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <p className="text-[12px] font-medium text-ink-4">最近一次实际重置</p>
            {d.stats.lastResetAt ? <><p className="num mt-3 text-[25px] font-[700] leading-[1.2] text-ink sm:text-[30px]">{monthDay(d.stats.lastResetAt.slice(0, 10))}</p><p className="mt-1 text-[14px] text-ink-3">{bjTime(d.stats.lastResetAt)} · 北京时间</p></> : <p className="mt-3 text-[18px] font-[600] text-ink">暂无已确认记录</p>}
            <p className="mt-4 text-[12px] leading-[1.7] text-ink-4">确认帖时间不一定等于你的实际到账时间，请以 Codex 内显示为准。</p>
          </div>
        </div>
      </div>
      <div className="reset-hero-signal relative z-[1] mt-4 flex flex-wrap items-center justify-between gap-3">
        <span>{e ? `当前动态：${scopeText(e)}` : "持续跟踪公开动态；没有公告不代表一定不会重置。"}</span>
        {post?.url && <a href={post.url} target="_blank" rel="noreferrer">查看 Tibo 原帖 ↗</a>}
      </div>
      <span className="reset-hero-orbit" aria-hidden="true">↻</span>
    </section>
  );
}

/** Tibo's usual hours: 16:30–21:30 Pacific, i.e. 07:30–12:30 Beijing the next morning. */
const USUAL_FROM = 7 * 60 + 30;
const USUAL_TO = 12 * 60 + 30;
const inUsual = (m: number) => m >= USUAL_FROM && m <= USUAL_TO;

const MONITOR_WORDS = { healthy: "监控正常", delayed: "检查有延迟", attention: "监控需要处理", unknown: "监控状态未知" } as const;
const MONITOR_DOT = { healthy: "bg-ok-ink", delayed: "bg-amber-ink", attention: "bg-amber-ink", unknown: "bg-ink-4" } as const;

export default function CodexResetPage() {
  const d = useLoaderData<typeof loader>();
  useVersionPolling(d.version);
  const m = d.monitor;
  return (
    <div className="pb-8">
      <header className="flex flex-col gap-1 pb-4 pt-5 lg:flex-row lg:items-end lg:justify-between lg:pt-1">
        <div>
          <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">Tibo重置监控</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">Codex 额度重置与重置卡发放：什么时候生效、给谁、Tibo 原话</p>
        </div>
        <p className="text-[12px] text-ink-4">全部为北京时间 · UTC+8</p>
      </header>

      <LiveMonitor d={d} />

      <details className="disclosure group mt-8 border-t border-line">
        <summary className="flex items-center justify-between gap-3 py-[18px] text-[13px] text-ink-3 transition-colors hover:text-ink">
          <span className="inline-flex items-center gap-1.5">
            <IconChevronRight size={13} className="text-ink-4 transition-transform duration-200 group-open:rotate-90" />
            时间是怎么推算的？
          </span>
          <span className="text-[12px] text-ink-4">来源与规则</span>
        </summary>
        <div className="grid gap-x-8 gap-y-[18px] pb-6 pt-1.5 text-[12px] leading-[1.9] text-ink-4 md:grid-cols-2">
          <p><strong className="font-semibold text-ink-3">有原话就按原话。</strong>Tibo 写了时间（如 “6pm PST”“next hour”“end of day”），按太平洋时间换算成北京时间，并多留一两个小时——他的确认帖通常比说的时间晚一点。只写了日期的，按他以往的习惯落在当天太平洋时间傍晚。</p>
          <p><strong className="font-semibold text-ink-3">没写时间就按习惯。</strong>Tibo 多在太平洋时间 16:30–21:30 按下重置按钮，也就是北京时间第二天早上 07:30–12:30。{d.confirmMinutes.length ? `近 ${d.confirmMinutes.length} 次确认中有 ${d.confirmMinutes.filter(inUsual).length} 次在这个时段。` : ""}推算只是参考，以 Tibo 的确认和你 Codex 里的用量为准。</p>
          <p><strong className="font-semibold text-ink-3">已生效、应已生效、等待中。</strong>Tibo 发帖确认才算“已生效”；预计时间过去几个小时仍没有确认帖，显示“应已生效”——他宣布过的重置以往都兑现了，只是常常不再发确认。重置卡与额度重置分开记录，发卡不代表额度已恢复。</p>
          <p><strong className="font-semibold text-ink-3">持续跟踪 Tibo 的公开帖子。</strong>平时每 5 分钟检查一次，Tibo 确认故障或宣布重置后改为每 3 分钟。只有明确的重置或发卡消息才会推送飞书群。个人额度和重置卡余额请在 Codex 内查看。</p>
        </div>
      </details>

      <footer className="flex flex-col gap-2 border-t border-line py-4 text-[12px] text-ink-4 sm:flex-row sm:items-start sm:justify-between">
        {m ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className={`size-1.5 rounded-full ${MONITOR_DOT[m.status]}`} />
              {MONITOR_WORDS[m.status]} · 最近检查 <span className="num">{stamp(m.lastVerifiedAt)}</span>
              <IconChevronDown size={13} className="text-ink-4 transition-transform group-open:rotate-180" />
            </summary>
            <dl className="num mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 pl-4 text-[12px] text-ink-4">
              <dt>最近尝试</dt><dd>{stamp(m.lastAttemptAt)}</dd>
              <dt>最近采集</dt><dd>{stamp(m.lastCollectedAt)}</dd>
              <dt>最近完整核验</dt><dd>{stamp(m.lastVerifiedAt)}</dd>
              {m.pendingCount > 0 && <><dt>待处理帖子</dt><dd>{m.pendingCount}</dd></>}
              {m.heldWindowCount > 0 && <><dt>待核实窗口</dt><dd>{m.heldWindowCount}</dd></>}
            </dl>
          </details>
        ) : (
          <span>监控状态暂不可用</span>
        )}
        <span><a className="text-accent hover:underline" href="https://whenreset.uk/" target="_blank" rel="noreferrer">参考 whenreset.uk ↗</a> · {SITE.name} 整理 · 非 OpenAI 官方页面</span>
      </footer>
    </div>
  );
}

/** Only the changing status/calendar need the foreground clock; archive statistics stay still. */
function LiveMonitor({ d }: { d: CodexResetSitePage & { serverNow: number } }) {
  const [now, setNow] = useState(d.serverNow);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    update();
    const t = setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", update);
    };
  }, [d.version]);
  return <>
    <Hero d={d} now={now} />
    <ResetCalendar key={d.selectedDate} selectedDate={d.selectedDate} version={d.version} marks={d.calendar} events={d.events} today={d.today} historyFrom={d.historyFrom} now={now} avatar={d.authorAvatar} />
  </>;
}
