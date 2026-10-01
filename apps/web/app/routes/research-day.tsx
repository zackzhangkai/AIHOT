import { Link, useLoaderData } from "react-router";
import type { ResearchMarket, ResearchReportDetail } from "@aihot/contracts/research";
import { loadOr404 } from "../lib/api.server";
import { renderMarkdown } from "../lib/markdown";
import { pageMeta } from "../lib/seo";
import { ArticleLayout } from "../components/ui/Page";

const valid = new Set<ResearchMarket>(["us-drawdown", "cn-ashare-close"]);
export async function loader({ request, params }: { request: Request; params: { market: string; date: string } }) {
  if (!valid.has(params.market as ResearchMarket)) throw new Response("Not found", { status: 404 });
  const report = await loadOr404<ResearchReportDetail>(`/api/site/research/${params.market}/${encodeURIComponent(params.date)}`, { signal: request.signal });
  return { report, html: renderMarkdown(report.bodyMd).html };
}
export function meta({ params }: { params: { market: string; date: string } }) { return pageMeta({ title: `${params.date} · 投研`, description: "每日投研报告。", path: `/research/${params.market}/${params.date}` }); }
export default function ResearchDay() {
  const { report, html } = useLoaderData<typeof loader>();
  return <ArticleLayout><div className="pb-16"><p className="text-[12px] text-ink-4"><Link to={`/research?market=${report.market}`}>投研</Link> / {report.date}</p><h1 className="mt-1 text-[22px] font-bold text-ink">{report.title}</h1><p className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13.5px] leading-[1.8] text-ink-2">{report.summary}</p><section className="mt-7"><h2 className="border-l-4 border-accent pl-2.5 text-[15px] font-bold text-ink">观察信号</h2><ul className="mt-3 divide-y divide-line-soft">{report.signals.map((s, i) => <li className="py-3" key={i}><p className="font-bold text-ink">{s.name} <span className="text-[12px] text-ink-4">{s.level}</span></p><p className="mt-1 text-[13px] leading-[1.75] text-ink-3">{s.detail}</p>{s.source ? <p className="mt-1 text-[11.5px] text-ink-4">来源：{s.source}</p> : null}</li>)}</ul></section>{html ? <section className="research-body mt-7" dangerouslySetInnerHTML={{ __html: html }} /> : null}<p className="mt-8 border-t border-line-soft pt-4 text-[11.5px] leading-[1.7] text-ink-4">以上内容基于公开数据自动生成，仅供参考，不构成投资建议。</p></div></ArticleLayout>;
}
