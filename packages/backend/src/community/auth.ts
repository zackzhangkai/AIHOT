// Community identity: sign-up and sign-in by one-time email link, opaque sessions stored hashed.
// Separate cookie, separate tables and separate guards from the admin: a community account can never
// reach /api/admin, and an admin session is never accepted here.
import { randomBytes } from "node:crypto";
import { SITE } from "@aihot/industry/site";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { newShortId, sha256 } from "../lib/ids.ts";
import { cookie, parseCookies } from "../admin/auth.ts";
import { accountMailConfigured, MailUnavailable, sendAccountMail } from "./mail.ts";

export const COMMUNITY_COOKIE = "aihot_community";
export const COMMUNITY_SESSION_DAYS = 30;
/** A sign-in link stays valid for half an hour, and works once. */
const TOKEN_MINUTES = 30;

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;

export class AccountRejected extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function validHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** Only same-site paths; anything else (other hosts, protocol-relative) falls back to /token. */
export function safeReturn(target: string | null | undefined): string {
  const path = String(target ?? "");
  if (!path.startsWith("/") || path.startsWith("//")) return "/token";
  return path;
}

const windows = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (windows.size > 5000) windows.clear();
  const list = (windows.get(key) ?? []).filter((at) => now - at < windowMs);
  if (list.length >= max) return true;
  list.push(now);
  windows.set(key, list);
  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export interface StartSignInInput {
  email: string;
  handle?: string;
  returnTo?: string;
  /** Client fingerprint (address plus user agent), used only for rate limiting. */
  source: string;
}

/**
 * Sends the one-time link. An unknown address registers, a known one signs in; both go through the
 * same form so the response never reveals whether an address is already a member.
 */
export async function startSignIn(input: StartSignInInput): Promise<{ purpose: "register" | "login"; devLink?: string }> {
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AccountRejected(400, "invalid_email", "请输入有效邮箱。");
  if (limited(`mail:${email}`, 5, 3600_000) || limited(`src:${input.source}`, 20, 3600_000)) {
    throw new AccountRejected(429, "rate_limited", "请求过于频繁，请一小时后再试。", 3600);
  }

  const [existing] = await sql<{ id: string; status: string }[]>`SELECT id, status FROM community_users WHERE email = ${email}`;
  if (existing?.status === "suspended") throw new AccountRejected(403, "suspended", "这个账号已被停用。");
  const purpose = existing ? "login" : "register";

  let handle: string | null = null;
  if (purpose === "register") {
    handle = (input.handle ?? "").trim().toLowerCase();
    if (!validHandle(handle)) throw new AccountRejected(400, "invalid_handle", "昵称用小写字母、数字、- 或 _，2–31 个字符，字母或数字开头。");
    const [taken] = await sql<{ id: string }[]>`SELECT id FROM community_users WHERE handle = ${handle}`;
    if (taken) throw new AccountRejected(409, "handle_taken", "这个昵称已经被占用了，换一个试试。");
  }

  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO community_email_tokens (token_hash, email, user_id, purpose, handle, return_to, expires_at)
            VALUES (${sha256(token)}, ${email}, ${existing?.id ?? null}, ${purpose}, ${handle}, ${safeReturn(input.returnTo)},
                    ${new Date(Date.now() + TOKEN_MINUTES * 60_000)})`;

  const link = `${config.siteUrl}/api/community/auth/verify?token=${token}`;
  const minutes = String(TOKEN_MINUTES);
  const subject = purpose === "register" ? `确认邮箱，加入 ${SITE.name} 社区` : `登录 ${SITE.name} 的链接`;
  const intro = purpose === "register" ? "点下面的链接完成注册，注册后就能上报你的 token 消耗、看到完整榜单。" : "点下面的链接登录，链接只能用一次。";
  const text = `${intro}\n\n${link}\n\n链接 ${minutes} 分钟内有效。如果不是你本人操作，忽略这封邮件即可。\n\n${config.siteUrl}`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.7;color:#202a30"><h1 style="font-size:21px">${escapeHtml(subject)}</h1><p>${intro}</p><p><a href="${link}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#176b75;color:#fff;text-decoration:none">${purpose === "register" ? "完成注册" : "登录"}</a></p><p style="font-size:12px;color:#69757b">链接 ${minutes} 分钟内有效。打不开就复制这个地址：${link}</p><p style="font-size:12px;color:#69757b">如果不是你本人操作，忽略这封邮件即可。</p></div>`;

  if (!accountMailConfigured()) {
    // Without a mail transport, development hands the link back so the flow can still be exercised.
    if (config.environmentName === "production") throw new AccountRejected(503, "mail_unavailable", "邮件服务还没有配置好，请稍后再试。", 60);
    return { purpose, devLink: link };
  }
  try {
    await sendAccountMail({ to: email, subject, text, html });
  } catch (error) {
    if (error instanceof MailUnavailable) throw new AccountRejected(503, "mail_unavailable", "邮件服务还没有配置好，请稍后再试。", 60);
    throw error;
  }
  return { purpose };
}

/** Consumes a link: creates the account on registration, then opens a session either way. */
export async function completeSignIn(token: string, userAgent: string | undefined): Promise<{ session: string; handle: string; returnTo: string }> {
  const [row] = await sql<{ email: string; purpose: string; handle: string | null; return_to: string | null; user_id: string | null; expires_at: Date; consumed_at: Date | null }[]>`
    SELECT email, purpose, handle, return_to, user_id, expires_at, consumed_at FROM community_email_tokens WHERE token_hash = ${sha256(token)}`;
  if (!row) throw new AccountRejected(400, "invalid_link", "这个链接无效。");
  if (row.consumed_at) throw new AccountRejected(400, "used_link", "这个链接已经用过了，重新申请一个。");
  if (row.expires_at.getTime() <= Date.now()) throw new AccountRejected(400, "expired_link", "链接已过期，重新申请一个。");

  const claimed = await sql<{ email: string }[]>`
    UPDATE community_email_tokens SET consumed_at = now() WHERE token_hash = ${sha256(token)} AND consumed_at IS NULL RETURNING email`;
  if (claimed.length === 0) throw new AccountRejected(400, "used_link", "这个链接已经用过了，重新申请一个。");

  let userId = row.user_id;
  let handle = row.handle;
  if (row.purpose === "register" || !userId) {
    const [created] = await sql<{ id: string; handle: string }[]>`
      INSERT INTO community_users (id, handle, email, email_verified, display_name)
      VALUES (${newShortId(9)}, ${row.handle ?? `user${newShortId(3).toLowerCase()}`}, ${row.email}, true, null)
      ON CONFLICT (email) DO UPDATE SET email_verified = true RETURNING id, handle`;
    userId = created!.id;
    handle = created!.handle;
  }
  const session = await createSession(userId!, userAgent);
  await sql`UPDATE community_users SET last_seen_at = now() WHERE id = ${userId!}`;
  return { session, handle: handle ?? "", returnTo: safeReturn(row.return_to) };
}

async function createSession(userId: string, userAgent: string | undefined): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO community_sessions (id_hash, user_id, csrf_token, expires_at, user_agent)
            VALUES (${sha256(token)}, ${userId}, ${randomBytes(18).toString("base64url")},
                    ${new Date(Date.now() + COMMUNITY_SESSION_DAYS * 86400_000)}, ${userAgent?.slice(0, 300) ?? null})`;
  return token;
}

/** The signed-in member, or null. The user id comes from the session row, never from the cookie. */
export async function sessionUser(cookieHeader: string | undefined): Promise<{ id: string; handle: string; displayName: string | null; email: string; csrf: string } | null> {
  const token = parseCookies(cookieHeader)[COMMUNITY_COOKIE];
  if (!token) return null;
  const [row] = await sql<{ id: string; handle: string; display_name: string | null; email: string; csrf_token: string; status: string }[]>`
    SELECT u.id, u.handle, u.display_name, u.email, s.csrf_token, u.status
    FROM community_sessions s JOIN community_users u ON u.id = s.user_id
    WHERE s.id_hash = ${sha256(token)} AND s.expires_at > now()`;
  if (!row || row.status !== "active") return null;
  return { id: row.id, handle: row.handle, displayName: row.display_name, email: row.email, csrf: row.csrf_token };
}

export async function endSession(cookieHeader: string | undefined): Promise<void> {
  const token = parseCookies(cookieHeader)[COMMUNITY_COOKIE];
  if (token) await sql`DELETE FROM community_sessions WHERE id_hash = ${sha256(token)}`;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return cookie(COMMUNITY_COOKIE, value, maxAgeSeconds, config.siteUrl.startsWith("https://"));
}

export function clearSessionCookie(): string {
  return cookie(COMMUNITY_COOKIE, "", 0, config.siteUrl.startsWith("https://"));
}
