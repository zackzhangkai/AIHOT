import { useEffect, useState, type FormEvent } from "react";
import { SITE, withSubject } from "@aihot/industry/site";

type State = { kind: "idle" | "sending" | "success" | "error"; message?: string };

export function SubscribePanel() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/site/newsletter/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { configured?: boolean }) => setConfigured(body.configured === true))
      .catch(() => setConfigured(false));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/site/newsletter/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, website: "" }),
      });
      const body = (await response.json()) as { detail?: string; status?: string };
      if (!response.ok) throw new Error(body.detail || "暂时无法订阅，请稍后再试。");
      setState({ kind: "success", message: body.status === "already_active" ? "这个邮箱已经订阅了。" : "订阅成功，请留意欢迎邮件。" });
      setEmail("");
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "暂时无法订阅，请稍后再试。" });
    }
  }

  return (
    <section aria-labelledby="subscribe-title" className="card mt-6 overflow-hidden bg-[radial-gradient(120%_100%_at_100%_0%,var(--accent-softer),transparent_58%)] p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] lg:items-end">
        <div>
          <p className="mono text-[11px] font-bold tracking-[0.16em] text-accent">DAILY BRIEFING</p>
          <h2 id="subscribe-title" className="mt-2 text-[20px] font-bold text-ink">每天一封读得完的{withSubject("日报")}</h2>
          <p className="mt-2 max-w-[46em] text-[13.5px] leading-relaxed text-ink-3">新一期发布后提醒你，正文只放当天精选与原文入口。免费订阅，随时一键退订。</p>
          <form onSubmit={submit} className="mt-4 flex max-w-[560px] flex-col gap-2 sm:flex-row">
            <label htmlFor="newsletter-email" className="sr-only">邮箱</label>
            <input id="newsletter-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-strong placeholder:text-ink-4 focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent" />
            <button type="submit" disabled={state.kind === "sending" || configured !== true} className="h-11 shrink-0 rounded-full bg-accent px-5 text-[14px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink disabled:opacity-50">{state.kind === "sending" ? "正在订阅…" : configured === false ? "邮件认证配置中" : "订阅每日精选"}</button>
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          </form>
          {state.message && <p role="status" className={`mt-2 text-[12.5px] ${state.kind === "error" ? "text-hot" : "text-accent"}`}>{state.message}</p>}
          {configured === false && !state.message && <p role="status" className="mt-2 text-[12.5px] text-ink-4">发信域名认证完成后开放订阅；飞书群可正常加入。</p>}
        </div>
        <div className="rounded-card border border-line bg-surface/80 p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-tile bg-accent-soft text-[18px] font-black text-accent">飞</span>
            <div>
              <h3 className="text-[15px] font-bold text-ink">加入飞书群</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{SITE.community.feishuName} · 每天同步最新一期日报，也方便交流 AI 工具与行业动态。</p>
            </div>
          </div>
          <a href={SITE.community.feishuInviteUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-line-strong px-4 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent">直接加入飞书群 ↗</a>
        </div>
      </div>
    </section>
  );
}
