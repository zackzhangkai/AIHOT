import { randomUUID } from "node:crypto";
import { beijingDate } from "@aihot/contracts/time";
import { SITE, withSubject } from "@aihot/industry/site";
import { config, credential } from "../config.ts";
import { sql } from "../db.ts";
import { v1Daily } from "../publication/reports.ts";
import { dailyUrl } from "../publication/links.ts";
import { deliverContent } from "./deliver.ts";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export class NewsletterRejected extends Error {
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

export function newsletterConfigured(): boolean {
  return Boolean(credential("integrations", "RESEND_API_KEY") && credential("integrations", "MAIL_FROM"));
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function unsubscribeUrl(token: string): string {
  return `${config.siteUrl}/api/site/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeToken: string;
  idempotencyKey: string;
}

export function emailPayload(message: EmailMessage) {
  const unsubscribe = unsubscribeUrl(message.unsubscribeToken);
  const listHost = new URL(config.siteUrl).hostname;
  return {
    from: credential("integrations", "MAIL_FROM")!,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(credential("integrations", "MAIL_REPLY_TO") ? { reply_to: credential("integrations", "MAIL_REPLY_TO") } : {}),
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "List-ID": `${withSubject("日报")} <daily.${listHost}>`,
      "X-Entity-Ref-ID": message.idempotencyKey,
    },
  };
}

export async function sendEmail(message: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = credential("integrations", "RESEND_API_KEY");
  if (!key || !credential("integrations", "MAIL_FROM")) throw new NewsletterRejected(503, "not_configured", "邮件提醒正在配置中，请稍后再试。");
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": message.idempotencyKey },
    body: JSON.stringify(emailPayload(message)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend rejected email (${response.status})`);
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error("Resend returned no email id");
  return body.id;
}

export async function subscribe(emailInput: string): Promise<{ status: "active" | "already_active" }> {
  if (!newsletterConfigured()) throw new NewsletterRejected(503, "not_configured", "邮件提醒正在配置中，请稍后再试。");
  const email = emailInput.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new NewsletterRejected(400, "invalid_email", "请输入有效邮箱。");
  const [existing] = await sql<{ id: string; status: string; last_requested_at: Date; unsubscribe_token: string }[]>`
    SELECT id, status, last_requested_at, unsubscribe_token FROM newsletter_subscribers WHERE email = ${email}`;
  if (existing?.status === "active") return { status: "already_active" };
  if (existing && Date.now() - existing.last_requested_at.getTime() < 30_000) throw new NewsletterRejected(429, "rate_limited", "订阅正在处理，请稍后再试。", 30);

  const id = existing?.id ?? randomUUID();
  const token = randomUUID() + randomUUID();
  await sql`
    INSERT INTO newsletter_subscribers (id, email, status, unsubscribe_token)
    VALUES (${id}, ${email}, 'pending', ${token})
    ON CONFLICT (email) DO UPDATE SET status = 'pending', unsubscribe_token = EXCLUDED.unsubscribe_token,
      last_requested_at = now(), updated_at = now()`;
  const unsubscribe = unsubscribeUrl(token);
  try {
    await sendEmail({
      to: email,
      subject: `已订阅 ${SITE.name} 每日精选`,
      text: `订阅成功。每天新一期${withSubject("日报")}发布后，我们会发一封简短提醒。\n\n网站：${config.siteUrl}\n退订：${unsubscribe}`,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.7;color:#202a30"><h1 style="font-size:22px">订阅成功</h1><p>每天新一期${escapeHtml(withSubject("日报"))}发布后，我们会发一封简短提醒。</p><p><a href="${config.siteUrl}">打开 ${escapeHtml(SITE.name)}</a></p><p style="font-size:12px;color:#69757b">你收到这封邮件，是因为有人在 ${escapeHtml(new URL(config.siteUrl).hostname)} 提交了这个邮箱。<a href="${unsubscribe}">随时退订</a>。</p></div>`,
      unsubscribeToken: token,
      idempotencyKey: `newsletter-welcome-${id}-${token.slice(0, 8)}`,
    });
  } catch (error) {
    await sql`UPDATE newsletter_subscribers SET last_requested_at = to_timestamp(0) WHERE id = ${id} AND status = 'pending'`;
    if (error instanceof NewsletterRejected) throw error;
    throw new NewsletterRejected(502, "send_failed", "订阅邮件发送失败，请稍后再试。");
  }
  await sql`UPDATE newsletter_subscribers SET status = 'active', updated_at = now() WHERE id = ${id} AND status = 'pending'`;
  return { status: "active" };
}

export async function unsubscribe(token: string): Promise<boolean> {
  if (!/^[0-9a-f-]{72}$/.test(token)) return false;
  const rows = await sql`UPDATE newsletter_subscribers SET status = 'unsubscribed', updated_at = now() WHERE unsubscribe_token = ${token} RETURNING id`;
  return rows.length > 0;
}

interface DailyItem {
  title: string;
  summary: string;
}

interface Daily {
  date: string;
  generatedAt: string;
  lead: { title: string; leadParagraph: string } | null;
  sections: Array<{ label: string; items: DailyItem[] }>;
}

export function dailyCard(report: Daily) {
  const items = report.sections.flatMap((section) => section.items).slice(0, 6);
  const lines = items.map((item, index) => `${index + 1}. **${item.title}**${item.summary ? `\n${item.summary}` : ""}`);
  return {
    header: { title: { tag: "plain_text", content: `${withSubject("日报")} · ${report.date}` }, template: "turquoise" },
    elements: [
      ...(report.lead?.leadParagraph ? [{ tag: "div", text: { tag: "lark_md", content: report.lead.leadParagraph } }] : []),
      { tag: "div", text: { tag: "lark_md", content: lines.join("\n\n") || "今天暂无入选内容。" } },
      { tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: "阅读全文" }, url: dailyUrl(report.date), type: "primary" }] },
    ],
  };
}

function dailyEmail(report: Daily, email: string, token: string, subscriberId: string): EmailMessage {
  const items = report.sections.flatMap((section) => section.items).slice(0, 8);
  const link = dailyUrl(report.date);
  const unsubscribe = unsubscribeUrl(token);
  const textItems = items.map((item, i) => `${i + 1}. ${item.title}\n${item.summary}`).join("\n\n");
  const htmlItems = items.map((item) => `<li style="margin:0 0 16px"><strong>${escapeHtml(item.title)}</strong>${item.summary ? `<br><span style="color:#526168">${escapeHtml(item.summary)}</span>` : ""}</li>`).join("");
  return {
    to: email,
    subject: `${withSubject("日报")} · ${report.date}`,
    text: `${report.lead?.leadParagraph ?? "今天值得关注的 AI 动态。"}\n\n${textItems}\n\n阅读全文：${link}\n退订：${unsubscribe}`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.65;color:#202a30;max-width:640px;margin:auto"><p style="color:#176b75;font-weight:700">${escapeHtml(SITE.name)}</p><h1 style="font-size:24px">${escapeHtml(withSubject("日报"))} · ${report.date}</h1>${report.lead?.leadParagraph ? `<p>${escapeHtml(report.lead.leadParagraph)}</p>` : ""}<ol style="padding-left:22px">${htmlItems}</ol><p><a href="${link}" style="display:inline-block;background:#176b75;color:white;text-decoration:none;padding:10px 18px;border-radius:999px">阅读全文</a></p><p style="border-top:1px solid #d8ddda;padding-top:16px;font-size:12px;color:#69757b">你收到这封邮件，是因为你订阅了 ${escapeHtml(SITE.name)}。<a href="${unsubscribe}">退订</a></p></div>`,
    unsubscribeToken: token,
    idempotencyKey: `newsletter-daily-${report.date}-${subscriberId}`,
  };
}

/** Repeats during the morning window; database keys make both email and group delivery exactly-once. */
export async function deliverDaily(date = beijingDate(Date.now())) {
  const daily = await v1Daily(date);
  if (!daily) return { report: false, emailSent: 0, emailFailed: 0, feishu: [] as Array<{ target: string; status: string }> };
  const report = daily.report as Daily;
  const feishu = await deliverContent({ subjectKind: "daily", subjectId: report.date, dedupeKey: `daily:${report.date}`, contentAt: new Date(report.generatedAt), card: dailyCard(report) });
  if (!newsletterConfigured()) return { report: true, emailSent: 0, emailFailed: 0, feishu };

  const subscribers = await sql<{ id: string; email: string; unsubscribe_token: string }[]>`
    SELECT s.id, s.email, s.unsubscribe_token FROM newsletter_subscribers s
    WHERE s.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM newsletter_deliveries d WHERE d.subscriber_id = s.id AND d.report_key = ${report.date}
    ) ORDER BY s.created_at LIMIT 80`;
  let emailSent = 0;
  let emailFailed = 0;
  for (const subscriber of subscribers) {
    try {
      const resendId = await sendEmail(dailyEmail(report, subscriber.email, subscriber.unsubscribe_token, subscriber.id));
      await sql`INSERT INTO newsletter_deliveries (subscriber_id, report_key, resend_id) VALUES (${subscriber.id}, ${report.date}, ${resendId}) ON CONFLICT DO NOTHING`;
      emailSent += 1;
      await new Promise((resolve) => setTimeout(resolve, 450));
    } catch {
      emailFailed += 1;
    }
  }
  return { report: true, emailSent, emailFailed, feishu };
}
