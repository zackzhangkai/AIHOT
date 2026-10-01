import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { SITE } from "@aihot/industry/site";
import { pageMeta } from "../lib/seo";
import { IconCheck, IconUsers } from "../components/icons";

export function meta() {
  return pageMeta({
    title: "注册 · 加入社区",
    description: `注册 ${SITE.name} 社区：拿到 API Key 上报自己的 token 消耗，看完整榜单，后续还能发帖交流。`,
    path: "/join",
    noindex: true,
  });
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

type State = { kind: "idle" | "sending" | "sent" | "error"; message?: string; devLink?: string | null };

export default function JoinPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [me, setMe] = useState<{ signedIn: boolean; handle: string | null } | null>(null);
  const [state, setState] = useState<State>({ kind: "idle", message: params.get("error") ?? undefined, devLink: null });

  useEffect(() => {
    fetch("/api/community/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ signedIn: boolean; handle: string | null }>) : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/community/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, handle, returnTo: "/token" }),
      });
      const body = (await res.json()) as { ok?: boolean; detail?: string; devLink?: string | null };
      if (!res.ok) {
        setState({ kind: "error", message: body.detail ?? "发送失败，稍后再试。" });
        return;
      }
      setState({ kind: "sent", devLink: body.devLink ?? null });
    } catch {
      setState({ kind: "error", message: "网络请求失败，稍后再试。" });
    }
  };

  if (me?.signedIn) {
    return (
      <div className="pb-12">
        <h1 className="pt-3 text-[24px] font-semibold leading-[1.3] text-ink">已经登录了</h1>
        <p className="mt-2 text-[13px] text-ink-3">
          当前身份 <span className="mono text-ink">@{me.handle}</span>，可以去榜单上报数据。
        </p>
        <div className="mt-4 flex gap-3">
          <Link to="/token" className="inline-flex h-10 items-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink">
            去 Token 榜
          </Link>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/community/auth/logout", { method: "POST" });
              location.reload();
            }}
            className="inline-flex h-10 items-center rounded-full border border-line px-5 text-[13.5px] text-ink-3 transition-colors hover:border-line-strong"
          >
            退出
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <header className="pt-3">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">注册 · 加入社区</h1>
        <p className="mt-1.5 text-[13px] leading-[1.7] text-ink-3">
          填邮箱和昵称，收一封链接邮件，点开就完成注册。不设密码，注册即得社区全部权限。
        </p>
      </header>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <form onSubmit={submit} className="card p-5">
          <label htmlFor="join-handle" className="mb-1.5 block text-[12.5px] font-semibold text-ink">昵称（榜单上显示）</label>
          <input
            id="join-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            placeholder="zack"
            autoComplete="nickname"
            className="h-11 w-full rounded-card bg-bg-sunk px-4 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[box-shadow] placeholder:text-ink-4 focus:bg-surface focus:ring-accent mono dark:bg-bg-muted/60"
          />
          <p className="mt-1.5 text-[11.5px] text-ink-4">小写字母、数字、- 或 _，2–31 个字符。</p>

          <label htmlFor="join-email" className="mb-1.5 mt-4 block text-[12.5px] font-semibold text-ink">邮箱</label>
          <input
            id="join-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="h-11 w-full rounded-card bg-bg-sunk px-4 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[box-shadow] placeholder:text-ink-4 focus:bg-surface focus:ring-accent dark:bg-bg-muted/60"
          />

          {state.kind === "error" && (
            <p role="alert" className="mt-3 rounded-tile bg-hot-soft px-3.5 py-2.5 text-[13px] text-hot">{state.message}</p>
          )}

          <button
            type="submit"
            disabled={state.kind === "sending" || !email.includes("@") || handle.length < 2}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink disabled:bg-line-strong disabled:text-ink-4"
          >
            {state.kind === "sending" ? "发送中" : "发送注册链接"}
          </button>

          {state.kind === "sent" && (
            <p className="mt-4 rounded-tile bg-accent-softer px-3.5 py-3 text-[13px] leading-[1.7] text-accent">
              链接已发送到 {email}，30 分钟内有效，点开即完成注册。
              {state.devLink && (
                <span className="mt-2 block">
                  本机没有配置邮件服务，直接用这个链接：
                  <a href={state.devLink} className="mt-1 block break-all underline">{state.devLink}</a>
                </span>
              )}
            </p>
          )}
        </form>

        <aside className="card p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <IconUsers size={15} /> 注册后能做什么
          </h2>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-[1.75] text-ink-3">
            <li className="flex gap-2">
              <IconCheck size={15} className="mt-0.5 shrink-0 text-accent" />
              生成 API Key，让自己的工具上报每天消耗的 token
            </li>
            <li className="flex gap-2">
              <IconCheck size={15} className="mt-0.5 shrink-0 text-accent" />
              看完整榜单和任意成员的热力图（未注册只看前 10）
            </li>
            <li className="flex gap-2">
              <IconCheck size={15} className="mt-0.5 shrink-0 text-accent" />
              社区后续开放论坛后，可以直接发帖、回帖
            </li>
          </ul>
          <p className="mt-4 border-t border-line pt-4 text-[12px] leading-[1.7] text-ink-4">
            邮箱只用于发送登录链接，不做营销用途。详见 <Link to="/privacy" className="text-accent hover:underline">隐私说明</Link>。
          </p>
        </aside>
      </div>
    </div>
  );
}
