import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SITE_URL = "https://news.coderfather.com";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.MAIL_FROM = "MyHOT <news@mail.example.com>";

const { dailyCard, emailPayload } = await import("@aihot/backend/notify/newsletter");

test("newsletter mail carries aligned links and RFC 8058 unsubscribe headers", () => {
  const payload = emailPayload({
    to: "reader@example.com",
    subject: "AI 日报",
    text: "今日精选",
    html: "<p>今日精选</p>",
    unsubscribeToken: "a".repeat(72),
    idempotencyKey: "daily-test-reader",
  });
  assert.equal(payload.from, "MyHOT <news@mail.example.com>");
  assert.equal(payload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(payload.headers["List-Unsubscribe"], /^<https:\/\/news\.coderfather\.com\/api\/site\/newsletter\/unsubscribe\?token=/);
  assert.match(payload.headers["List-ID"], /daily\.news\.coderfather\.com/);
});

test("daily Feishu card links to the public issue and caps the preview", () => {
  const card = dailyCard({
    date: "2026-09-30",
    generatedAt: "2026-09-30T00:10:00.000Z",
    lead: { title: "今日", leadParagraph: "今天值得关注。" },
    sections: [{ label: "模型", items: Array.from({ length: 8 }, (_, i) => ({ title: `标题 ${i + 1}`, summary: `摘要 ${i + 1}` })) }],
  });
  const body = JSON.stringify(card);
  assert.match(body, /https:\/\/news\.coderfather\.com\/daily\/2026-09-30/);
  assert.match(body, /标题 6/);
  assert.doesNotMatch(body, /标题 7/);
});
