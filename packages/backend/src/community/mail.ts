// Account mail (the one-time sign-in link). Same transport as the newsletter, but without
// unsubscribe headers: this is not a mailing list.
import { credential } from "../config.ts";

export class MailUnavailable extends Error {
  constructor(message = "邮件服务还没有配置好。") {
    super(message);
  }
}

export function accountMailConfigured(): boolean {
  const from = credential("integrations", "MAIL_FROM");
  const direct = credential("integrations", "RESEND_API_KEY");
  const relay = credential("integrations", "MAIL_RELAY_URL") && credential("integrations", "MAIL_RELAY_TOKEN");
  return Boolean(from && (direct || relay));
}

export interface AccountMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** One value per link, so asking for a new link sends a new message instead of being swallowed. */
  idempotencyKey: string;
}

export async function sendAccountMail(message: AccountMail): Promise<void> {
  if (!accountMailConfigured()) throw new MailUnavailable();
  const key = credential("integrations", "RESEND_API_KEY");
  const relayUrl = credential("integrations", "MAIL_RELAY_URL");
  const relayToken = credential("integrations", "MAIL_RELAY_TOKEN");
  const payload = {
    from: credential("integrations", "MAIL_FROM")!,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  // The relay (a Resend proxy on whenreset.uk) takes `to` as one address string and wants an
  // explicit idempotency key; Resend's own API wants `to` as an array and a header instead.
  const response = await fetch(key ? "https://api.resend.com/emails" : relayUrl!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key ?? relayToken}`,
      "content-type": "application/json",
      ...(key ? { "idempotency-key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify(key ? payload : { ...payload, to: message.to, idempotencyKey: message.idempotencyKey }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Mail transport rejected the message (${response.status})`);
}
