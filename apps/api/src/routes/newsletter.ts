import type { FastifyInstance } from "fastify";
import { config } from "@aihot/backend/config";
import { NewsletterRejected, newsletterConfigured, subscribe, unsubscribe } from "@aihot/backend/notify/newsletter";
import { feedbackSourceHash } from "@aihot/backend/operations/feedback";
import { SITE } from "@aihot/industry/site";
import { sendProblem } from "../http/respond.ts";

const windows = new Map<string, number[]>();
function limited(key: string, max = 5): boolean {
  const now = Date.now();
  const list = (windows.get(key) ?? []).filter((at) => now - at < 3600_000);
  if (list.length >= max) return true;
  list.push(now);
  windows.set(key, list);
  return false;
}

const page = (title: string, detail: string, token?: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:64px auto;padding:0 20px;line-height:1.7;color:#202a30"><h1>${title}</h1><p>${detail}</p>${token ? `<form method="post" enctype="text/plain"><button style="border:0;border-radius:999px;background:#176b75;color:white;padding:11px 20px;font-size:15px">确认退订</button></form>` : ""}<p><a href="${config.siteUrl}">返回 ${SITE.name}</a></p></body></html>`;

export function registerNewsletter(app: FastifyInstance) {
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));
  }
  app.get("/api/site/newsletter/status", async (_req, reply) => reply.header("Cache-Control", "no-store").send({ configured: newsletterConfigured() }));

  app.post("/api/site/newsletter/subscribe", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (req.headers.origin !== new URL(config.siteUrl).origin) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "请从本站提交订阅。" });
    const body = (req.body ?? {}) as { email?: unknown; website?: unknown };
    if (body.website) return reply.send({ ok: true });
    const source = feedbackSourceHash(String(req.headers["x-real-ip"] ?? req.ip ?? ""), String(req.headers["user-agent"] ?? ""));
    if (limited(source)) return sendProblem(req, reply, { status: 429, code: "rate_limited", detail: "请求过于频繁，请一小时后再试。", retryAfter: 3600 });
    try {
      const result = await subscribe(String(body.email ?? ""));
      return reply.send({ ok: true, status: result.status });
    } catch (error) {
      if (error instanceof NewsletterRejected) return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
      req.log.error({ err: error }, "newsletter subscribe failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法订阅，请稍后再试。", retryAfter: 30 });
    }
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/site/newsletter/unsubscribe",
    handler: async (req, reply) => {
      reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex");
      const token = String((req.query as { token?: string }).token ?? "");
      if (!/^[0-9a-f-]{72}$/.test(token)) return reply.code(404).type("text/html; charset=utf-8").send(page("链接无效", "这个退订链接无效或已经过期。"));
      if (req.method === "GET") return reply.type("text/html; charset=utf-8").send(page("退订每日精选", "确认后，这个邮箱将不再收到每日提醒。", token));
      const oneClick = String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded") && String(req.body ?? "").includes("List-Unsubscribe=One-Click");
      if (!oneClick && req.headers.origin !== new URL(config.siteUrl).origin) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "请求无效。" });
      const changed = await unsubscribe(token);
      if (oneClick) return reply.code(changed ? 204 : 404).send();
      return reply.type("text/html; charset=utf-8").send(page(changed ? "已退订" : "链接无效", changed ? "你不会再收到每日提醒。" : "这个退订链接无效或已经过期。"));
    },
  });
}
