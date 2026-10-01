import { useEffect, useState } from "react";
import { Link, useLoaderData } from "react-router";
import { TOKEN_RANGES, TOKEN_RANGE_LABELS, TOKEN_TOOL_LABELS, TOKEN_TOOLS, type TokenBoardRow, type TokenHeatmapResponse, type TokenRange, type TokenSummaryResponse, type TokenTool } from "@aihot/contracts/token";
import { SITE } from "@aihot/industry/site";
import { apiGet } from "../lib/api.server";
import { queryString } from "../lib/format";
import { pageMeta } from "../lib/seo";
import { ConnectPanel, type Me } from "../features/token/ConnectPanel";
import { HeatmapLegend, TokenHeatmap, formatTokens } from "../features/token/TokenHeatmap";
import { IconFlame, IconUsers } from "../components/icons";

export async function loader({ request }: { request: Request }) {
  const signal = request.signal;
  const [board, summary] = await Promise.all([
    apiGet<{ rows: TokenBoardRow[]; today: string }>("/api/v1/token/board" + queryString({ range: "7d", limit: 50 }), { signal }),
    apiGet<TokenSummaryResponse>("/api/v1/token/summary", { signal }),
  ]);
  return { rows: board.rows, today: board.today, summary };
}

export function meta() {
  return pageMeta({
    title: "Token 热力图",
    description: `${SITE.name} 社区成员每天上报自己的 token 消耗，汇成一张热力图和一份榜单。数据由本人上报，仅供参考。`,
    path: "/token",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" };
}

export default function TokenBoardPage() {
  const initial = useLoaderData<typeof loader>();
  const [range, setRange] = useState<TokenRange>("7d");
  const [tool, setTool] = useState<TokenTool | null>(null);
  const [rows, setRows] = useState<TokenBoardRow[]>(initial.rows);
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState<{ handle: string; map: TokenHeatmapResponse } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/community/me")
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  // The server rendered the visitor's view (top ten); once the session is known, a member's cookie
  // gets the whole board. Refetched whenever the window, the tool filter or the session changes.
  const signedIn = me?.signedIn ?? false;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/token/board" + queryString({ range, tool, limit: 50 }));
        const body = (await res.json()) as { rows: TokenBoardRow[] };
        if (res.ok && !cancelled) setRows(body.rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [range, tool, signedIn]);

  const toggle = async (handle: string) => {
    if (open?.handle === handle) {
      setOpen(null);
      return;
    }
    const res = await fetch(`/api/v1/token/heatmap?user=${encodeURIComponent(handle)}&days=180`);
    if (res.ok) setOpen({ handle, map: (await res.json()) as TokenHeatmapResponse });
  };

  const summary = initial.summary;

  return (
    <div className="pb-12">
      <header className="pb-2 pt-3">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">Token 热力图</h1>
        <p className="mt-1.5 text-[13px] leading-[1.7] text-ink-3">
          社区成员自己上报每天烧掉多少 token。注册就能上报、看完整榜单，后续还能发帖交流。
        </p>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="flex items-baseline gap-1.5">
            <span className="mono text-[22px] font-semibold text-ink">{formatTokens(summary.tokensTotal)}</span>
            <span className="text-[12px] text-ink-4">累计 token</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="mono text-[22px] font-semibold text-ink">{summary.members}</span>
            <span className="text-[12px] text-ink-4">位成员</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="mono text-[22px] font-semibold text-ink">{summary.reportingToday}</span>
            <span className="text-[12px] text-ink-4">今天上报</span>
          </span>
        </div>
      </header>

      <nav aria-label="统计区间" className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        {TOKEN_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12.5px] transition-colors ${
              r === range ? "border-accent bg-accent-softer text-accent" : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-accent"
            }`}
          >
            {TOKEN_RANGE_LABELS[r]}
          </button>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-line sm:block" />
        {TOKEN_TOOLS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTool(tool === t ? null : t)}
            className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12.5px] transition-colors ${
              tool === t ? "border-accent bg-accent-softer text-accent" : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-accent"
            }`}
          >
            {TOKEN_TOOL_LABELS[t]}
          </button>
        ))}
      </nav>

      <section className="mt-4">
        {rows.length === 0 ? (
          <p className="card p-6 text-[13px] text-ink-3">这个区间还没有人上报。成为第一个：</p>
        ) : (
          <ul className="divide-y divide-line-soft overflow-hidden rounded-card border border-line">
            {rows.map((row) => (
              <li key={row.handle}>
                <button type="button" onClick={() => toggle(row.handle)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface">
                  <span className="mono w-6 shrink-0 text-[12px] text-ink-4">{row.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{row.displayName ?? row.handle}</span>
                    <span className="block text-[11.5px] text-ink-4">
                      @{row.handle} · {row.activeDays} 天有数据 · 最近 {row.lastDay}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-[14px] font-semibold text-ink">{formatTokens(row.tokens)}</span>
                </button>
                {open?.handle === row.handle && (
                  <div className="border-t border-line-soft bg-bg-sunk px-4 py-4 dark:bg-bg-muted/40">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[12.5px] text-ink-3">
                        近 {open.map.days} 天 · 共 {formatTokens(open.map.total)} tokens · {open.map.activeDays} 天有数据
                      </span>
                      <HeatmapLegend />
                    </div>
                    <div className="mt-3 overflow-x-auto pb-1">
                      <TokenHeatmap cells={open.map.cells} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {loading && <p className="mt-2 text-[12px] text-ink-4">载入中…</p>}
        {!me?.signedIn && rows.length > 0 && (
          <p className="mt-3 text-[12px] text-ink-4">
            未注册只显示前 10 名。<Link to="/join" className="text-accent hover:underline">注册</Link>后看完整榜单。
          </p>
        )}
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <IconFlame size={15} /> 这上面的数字从哪来
          </h2>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-[1.75] text-ink-3">
            <li>由每个成员自己的工具上报，服务端只做范围检查，不做核实 —— 所以标注为自报数据，仅供参考。</li>
            <li>只上传 token 数量和工具名，不上传对话内容、文件名或 prompt。</li>
            <li>同一个 idempotencyKey 重复上报会覆盖当天的数据，不会叠加。</li>
            <li>只能上报今天和过去 6 天，补不了历史数据。</li>
          </ul>
          <p className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[12.5px] text-ink-4">
            <IconUsers size={14} /> 注册即得社区全部权限：上报、看完整榜单、后续发帖。
          </p>
        </section>
        <ConnectPanel me={me} onChanged={setMe} />
      </div>
    </div>
  );
}
