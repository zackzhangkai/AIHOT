import { Link, useLoaderData } from "react-router";
import type { ResearchListPage, ResearchMarket } from "@aihot/contracts/research";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { EmptyState } from "../components/ui/Page";

const MARKET: Record<ResearchMarket, { title: string; description: string }> = {
  "us-drawdown": { title: "美股回撤风险检查", description: "每日监测油价、美债、关键均线与宏观事件的风险信号。" },
  "cn-ashare-close": { title: "A股收盘行情", description: "收盘后汇总指数、市场宽度、成交额与板块强弱；板块名称聚类仅作观察参考。" },
};
const MARKET_LINK: Record<ResearchMarket, string> = {
  "us-drawdown": "/research",
  "cn-ashare-close": "/research?market=cn-ashare-close",
};
function selected(request: Request): ResearchMarket {
  return new URL(request.url).searchParams.get("market") === "cn-ashare-close" ? "cn-ashare-close" : "us-drawdown";
}
export async function loader({ request }: { request: Request }) {
  const market = selected(request);
  const data = await loadOr404<ResearchListPage>(`/api/site/research?market=${market}`, { signal: request.signal });
  return { market, reports: data.reports };
}
export function meta() { return pageMeta({ title: "投研", description: "每日市场风险与收盘行情报告。", path: "/research" }); }
export default function ResearchIndex() {
  const { market, reports } = useLoaderData<typeof loader>();
  const label = MARKET[market];
  return <div className="mx-auto w-full max-w-[920px] px-4 py-8 sm:px-6">
    <header className="rounded-2xl border border-line bg-surface px-5 py-6 shadow-[0_10px_32px_rgb(18_28_38/0.04)] sm:px-7">
      <p className="text-[11px] font-bold tracking-[0.16em] text-accent">MARKET RESEARCH</p>
      <h1 className="mt-2 text-[25px] font-bold tracking-tight text-ink sm:text-[28px]">投研日报</h1>
      <p className="mt-2 max-w-[48em] text-[13.5px] leading-[1.8] text-ink-3">用固定规则整理每日市场信号。数据与结论分开呈现，方便先扫读、再追溯。</p>
    </header>

    <nav className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="投研栏目">
      {(Object.keys(MARKET) as ResearchMarket[]).map((key) => {
        const item = MARKET[key];
        const active = key === market;
        return <Link key={key} to={MARKET_LINK[key]} className={`group rounded-2xl border p-4 transition-all ${active ? "border-accent bg-accent text-white shadow-[0_10px_22px_rgb(31_113_92/0.2)]" : "border-line bg-surface hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-sm"}`}>
          <span className={`text-[11px] font-bold tracking-[0.14em] ${active ? "text-white/70" : "text-ink-4"}`}>{key === "us-drawdown" ? "US MARKET" : "CHINA A-SHARE"}</span>
          <span className="mt-1.5 flex items-center justify-between gap-3"><span className="text-[16px] font-bold">{item.title}</span><span className={`text-[18px] transition-transform group-hover:translate-x-0.5 ${active ? "text-white" : "text-accent"}`}>→</span></span>
          <span className={`mt-1.5 block text-[12px] leading-[1.65] ${active ? "text-white/80" : "text-ink-3"}`}>{item.description}</span>
        </Link>;
      })}
    </nav>

    <section className="mt-8">
      <div className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-bold tracking-[0.14em] text-ink-4">LATEST ARCHIVE</p><h2 className="mt-1 text-[20px] font-bold text-ink">{label.title}</h2></div><span className="rounded-full bg-ink px-3 py-1 text-[11px] font-medium text-white">{reports.length} 份报告</span></div>
      {reports.length ? <ul className="mt-4 space-y-3">{reports.map((r) => <li key={r.date}><Link className="group flex gap-4 rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md sm:p-5" to={`/research/${r.market}/${r.date}`}>
        <span className="flex w-12 shrink-0 flex-col rounded-xl bg-accent-soft px-2 py-2 text-center"><span className="num text-[18px] font-bold leading-none text-accent">{r.date.slice(8)}</span><span className="mt-1 text-[10px] font-bold text-accent/70">{r.date.slice(5, 7)} 月</span></span>
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-hot-soft px-2 py-0.5 text-[10px] font-bold text-hot">红 {r.redCount}</span><span className="rounded-full bg-amber-soft px-2 py-0.5 text-[10px] font-bold text-amber-ink">黄 {r.amberCount}</span><span className="rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok-ink">绿 {r.greenCount}</span><span className="ml-auto text-[12px] text-ink-4">{r.date.slice(0, 4)}</span></span><h3 className="mt-2 text-[15px] font-bold text-ink transition-colors group-hover:text-accent">{r.title}</h3><p className="mt-1 line-clamp-2 text-[12.5px] leading-[1.7] text-ink-3">{r.summary}</p></span><span className="hidden self-center text-[20px] text-ink-4 transition-transform group-hover:translate-x-1 group-hover:text-accent sm:block">→</span>
      </Link></li>)}</ul> : <div className="mt-6"><EmptyState title="还没有报告">服务器首次推送后，报告会在这里按日归档。</EmptyState></div>}
    </section>
  </div>;
}
