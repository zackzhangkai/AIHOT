import { Link, useLoaderData } from "react-router";
import type { ResearchListPage, ResearchMarket } from "@aihot/contracts/research";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { EmptyState } from "../components/ui/Page";

const MARKET: Record<ResearchMarket, { title: string; description: string }> = {
  "us-drawdown": { title: "美股回撤风险检查", description: "每日监测油价、美债、关键均线与宏观事件的风险信号。" },
  "cn-ashare-close": { title: "A股收盘行情", description: "收盘后汇总指数、市场宽度、成交额与板块强弱；板块名称聚类仅作观察参考。" },
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
  return <div className="mx-auto w-full max-w-[880px] px-4 py-8 sm:px-6">
    <p className="text-[12px] text-ink-4">投研</p><h1 className="mt-1 text-[22px] font-bold text-ink">{label.title}</h1>
    <p className="mt-2 text-[13.5px] leading-[1.8] text-ink-3">{label.description}</p>
    <nav className="mt-5 flex gap-2 text-[13px]"><Link className={market === "us-drawdown" ? "font-bold text-accent" : "text-ink-3"} to="/research">美股风险</Link><span className="text-ink-4">·</span><Link className={market === "cn-ashare-close" ? "font-bold text-accent" : "text-ink-3"} to="/research?market=cn-ashare-close">A股收盘</Link></nav>
    {reports.length ? <ul className="mt-5 divide-y divide-line">{reports.map((r) => <li key={r.date}><Link className="block py-4" to={`/research/${r.market}/${r.date}`}><p className="text-[12px] text-ink-4">{r.date} · 信号 红 {r.redCount} / 黄 {r.amberCount} / 绿 {r.greenCount}</p><h2 className="mt-1 text-[15px] font-bold text-ink">{r.title}</h2><p className="mt-1 text-[13px] leading-[1.7] text-ink-3">{r.summary}</p></Link></li>)}</ul> : <div className="mt-10"><EmptyState title="还没有报告">服务器首次推送后，报告会在这里按日归档。</EmptyState></div>}
  </div>;
}
