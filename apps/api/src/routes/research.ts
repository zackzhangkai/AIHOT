import type { FastifyInstance } from "fastify";
import type { ResearchMarket } from "@aihot/contracts/research";
import { listResearchSummaries, loadResearchReport } from "@aihot/backend/research/read";
import { sendJsonWithEtag, sendProblem } from "../http/respond.ts";
import { siteHandler } from "./site.ts";

const markets = new Set<ResearchMarket>(["us-drawdown", "cn-ashare-close"]);
function marketOf(value: unknown): ResearchMarket | null { return typeof value === "string" && markets.has(value as ResearchMarket) ? value as ResearchMarket : null; }

export function registerResearchPublic(app: FastifyInstance) {
  app.get("/api/site/research", siteHandler(async (req, reply) => {
    const query = req.query as Record<string, string>;
    const market = marketOf(query.market) ?? "us-drawdown";
    const limit = Number(query.limit ?? "90");
    return sendJsonWithEtag(req, reply, { market, reports: await listResearchSummaries(market, Number.isFinite(limit) ? limit : 90) }, { etagPrefix: `site-research-${market}`, cacheControl: "public, max-age=60, s-maxage=120" });
  }));
  app.get("/api/site/research/:market/:date", siteHandler(async (req, reply) => {
    const { market: rawMarket, date } = req.params as { market: string; date: string };
    const market = marketOf(rawMarket);
    if (!market) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "No such research market." });
    const report = await loadResearchReport(market, date);
    if (!report) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "No research report for this date." });
    return sendJsonWithEtag(req, reply, report, { etagPrefix: `site-research-${market}-${date}`, cacheControl: "public, max-age=60, s-maxage=120" });
  }));
}
