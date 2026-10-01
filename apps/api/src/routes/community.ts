// Community accounts: sign-up and sign-in by email link, API keys, and a member's own usage.
// Only this site's pages call these routes; the reporting endpoint lives in routes/usage.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "@aihot/backend/config";
import { feedbackSourceHash } from "@aihot/backend/operations/feedback";
import {
  AccountRejected, COMMUNITY_SESSION_DAYS, clearSessionCookie, completeSignIn, endSession, sessionCookie, sessionUser, startSignIn,
} from "@aihot/backend/community/auth";
import { createKey, listKeys, revokeKey } from "@aihot/backend/community/keys";
import { sendProblem } from "../http/respond.ts";

const SECONDS = COMMUNITY_SESSION_DAYS * 86400;

/** Cookie and CSRF guard for everything a community session may change. */
async function guard(req: FastifyRequest, reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin && origin !== new URL(config.siteUrl).origin) {
    sendProblem(req, reply, { status: 403, code: "forbidden", detail: "请从本站提交。" });
    return null;
  }
  const user = await sessionUser(req.headers.cookie);
  if (!user) {
    sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "先注册或登录，再继续。" });
    return null;
  }
  if (req.headers["x-csrf-token"] !== user.csrf) {
    sendProblem(req, reply, { status: 403, code: "forbidden", detail: "页面已过期，刷新后重试。" });
    return null;
  }
  return user;
}

function sourceOf(req: FastifyRequest): string {
  return feedbackSourceHash(String(req.headers["x-real-ip"] ?? req.ip ?? ""), String(req.headers["user-agent"] ?? ""));
}

export function registerCommunity(app: FastifyInstance) {
  app.get("/api/community/me", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = await sessionUser(req.headers.cookie);
    if (!user) return reply.send({ signedIn: false, handle: null, displayName: null, email: null, keys: [], csrf: null });
    return reply.send({ signedIn: true, handle: user.handle, displayName: user.displayName, email: user.email, csrf: user.csrf, keys: await listKeys(user.id) });
  });

  app.post("/api/community/auth/start", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.siteUrl).origin) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "请从本站提交。" });
    const body = (req.body ?? {}) as { email?: unknown; handle?: unknown; returnTo?: unknown };
    try {
      const result = await startSignIn({
        email: String(body.email ?? ""),
        handle: body.handle === undefined ? undefined : String(body.handle),
        returnTo: body.returnTo === undefined ? undefined : String(body.returnTo),
        source: sourceOf(req),
      });
      // The same answer either way: never reveal whether an address is already a member.
      return reply.send({ ok: true, devLink: result.devLink ?? null });
    } catch (error) {
      if (error instanceof AccountRejected) {
        return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
      }
      req.log.error({ err: error }, "community sign-in start failed");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法发送邮件，请稍后再试。", retryAfter: 30 });
    }
  });

  app.get("/api/community/auth/verify", async (req, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex");
    const token = String((req.query as { token?: string }).token ?? "");
    try {
      const result = await completeSignIn(token, String(req.headers["user-agent"] ?? ""));
      reply.header("Set-Cookie", sessionCookie(result.session, SECONDS));
      return reply.redirect(result.returnTo, 302);
    } catch (error) {
      const detail = error instanceof AccountRejected ? error.message : "链接无法使用。";
      return reply.redirect(`/join?error=${encodeURIComponent(detail)}`, 302);
    }
  });

  app.post("/api/community/auth/logout", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    await endSession(req.headers.cookie);
    reply.header("Set-Cookie", clearSessionCookie());
    return reply.send({ ok: true });
  });

  app.post("/api/community/keys", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const body = (req.body ?? {}) as { label?: unknown };
    const label = String(body.label ?? "").trim() || "default";
    const created = await createKey(user.id, label);
    return reply.send({ id: created.id, token: created.token, prefix: created.prefix, label: created.label, createdAt: created.createdAt });
  });

  app.delete("/api/community/keys/:id", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const id = String((req.params as { id: string }).id ?? "");
    const revoked = await revokeKey(user.id, id);
    if (!revoked) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "没有这个密钥。" });
    return reply.send({ ok: true });
  });

}
