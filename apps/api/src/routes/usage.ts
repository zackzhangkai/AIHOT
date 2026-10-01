// Usage reporting (POST, by API key) and the public board (GET, anonymous).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { TOKEN_RANGES, TOKEN_TOOLS, type TokenRange, type TokenTool, type TokenUsageInput } from "@aihot/contracts/token";
import { V1_CACHE_CONTROL } from "@aihot/contracts/http-policy";
import { ANONYMOUS_ROWS, UsageRejected, recordUsage, tokenBoard, tokenHeatmap, tokenSummary } from "@aihot/backend/community/usage";
import { resolveKeyToken } from "@aihot/backend/community/keys";
import { sessionUser } from "@aihot/backend/community/auth";
import { enumParam, intParam } from "./v1.ts";
import { applyPublicHeaders, QueryError, sendProblem } from "../http/respond.ts";

const reports = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  if (reports.size > 5000) reports.clear();
  const recent = (reports.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 60) return true;
  recent.push(now);
  reports.set(key, recent);
  return false;
}

function bearer(req: FastifyRequest): string {
  const header = String(req.headers.authorization ?? "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export function registerUsage(app: FastifyInstance) {
  app.post("/api/v1/usage", async (req, reply) => {
    applyPublicHeaders(reply);
    reply.header("Cache-Control", "no-store");
    const token = bearer(req);
    if (!token) return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "缺少 API Key：Authorization: Bearer mh_live_…" });
    const key = await resolveKeyToken(token);
    if (!key) return sendProblem(req, reply, { status: 401, code: "invalid_key", detail: "API Key 无效或已吊销。" });
    if (rateLimited(key.keyId)) return sendProblem(req, reply, { status: 429, code: "rate_limited", detail: "上报过于频繁，每分钟最多 60 次。", retryAfter: 60 });
    const body = (req.body ?? {}) as TokenUsageInput;
    try {
      const accepted = await recordUsage(key.userId, key.keyId, body);
      return reply.code(202).send(accepted);
    } catch (error) {
      if (error instanceof UsageRejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message });
      req.log.error({ err: error }, "usage report failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法记录，请稍后重试。", retryAfter: 30 });
    }
  });

  app.get("/api/v1/token/board", async (req, reply) => {
    applyPublicHeaders(reply);
    try {
      const range = enumParam<TokenRange>((req.query as { range?: string }).range, "range", TOKEN_RANGES, "7d");
      const toolRaw = (req.query as { tool?: string }).tool;
      const tool = toolRaw === undefined ? null : enumParam<TokenTool>(toolRaw, "tool", TOKEN_TOOLS, "other");
      const viewer = await sessionUser(req.headers.cookie);
      const wanted = intParam((req.query as { limit?: string }).limit, "limit", 1, 100, 50);
      // A visitor sees the top of the board; members see as much as they ask for.
      const limit = viewer ? wanted : Math.min(wanted, ANONYMOUS_ROWS);
      const board = await tokenBoard(range, tool, limit);
      return reply.header("Cache-Control", V1_CACHE_CONTROL.tokenBoard).send(board);
    } catch (error) {
      if (error instanceof QueryError) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: error.message });
      throw error;
    }
  });

  app.get("/api/v1/token/heatmap", async (req, reply) => {
    applyPublicHeaders(reply);
    const user = String((req.query as { user?: string }).user ?? "").toLowerCase();
    if (!user) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "缺少 user 参数。" });
    const days = intParam((req.query as { days?: string }).days, "days", 7, 365, 180);
    try {
      return reply.header("Cache-Control", V1_CACHE_CONTROL.tokenHeatmap).send(await tokenHeatmap(user, days));
    } catch (error) {
      if (error instanceof UsageRejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message });
      throw error;
    }
  });

  app.get("/api/v1/token/summary", async (req, reply) => {
    applyPublicHeaders(reply);
    return reply.header("Cache-Control", V1_CACHE_CONTROL.tokenBoard).send(await tokenSummary());
  });
}
