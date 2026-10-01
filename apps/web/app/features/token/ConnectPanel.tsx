// The connect panel: what a member needs to start reporting (an API key and one command), or why
// they should register first.
import { useState } from "react";
import { Link } from "react-router";
import type { TokenKeyView, TokenMeResponse } from "@aihot/contracts/token";
import { IconCheck, IconCopy, IconPlug } from "../../components/icons";

/** /api/community/me, plus the CSRF token every change has to send back. */
export type Me = TokenMeResponse & { csrf?: string | null };

interface Props {
  me: Me | null;
  onChanged: (me: Me) => void;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-tile bg-bg-sunk p-3.5 pr-12 text-[12px] leading-[1.7] text-ink-2 mono dark:bg-bg-muted/60">{text}</pre>
      <button
        type="button"
        aria-label="复制"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
          setTimeout(() => setCopied(false), 1600);
        }}
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-full text-ink-4 transition-colors hover:bg-surface hover:text-accent"
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

export function ConnectPanel({ me, onChanged }: Props) {
  const [label, setLabel] = useState("default");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createKey = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/community/keys", {
        method: "POST",
        headers: { "x-csrf-token": me?.csrf ?? "" },
        body: JSON.stringify({ label }),
      });
      const body = (await res.json()) as { token?: string; detail?: string };
      if (!res.ok) {
        setError(body.detail ?? "创建失败，刷新页面重试。");
        return;
      }
      setFresh(body.token ?? null);
      const refreshed = await (await api("/api/community/me")).json() as Me;
      onChanged(refreshed);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    const res = await api(`/api/community/keys/${id}`, { method: "DELETE", headers: { "x-csrf-token": me?.csrf ?? "" } });
    if (res.ok) onChanged((await (await api("/api/community/me")).json()) as Me);
  };

  if (!me?.signedIn) {
    return (
      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
          <IconPlug size={15} /> 接入自己的数据
        </h2>
        <p className="mt-2 text-[13px] leading-[1.75] text-ink-3">
          注册后拿到 API Key，任何脚本、CLI 或 Agent 都能把当天消耗的 token 数报上来。注册即得社区全部权限，不分级、不收费。
        </p>
        <Link
          to="/join"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink"
        >
          注册并开始上报
        </Link>
      </section>
    );
  }

  const curl = `curl -sS -X POST https://news.coderfather.com/api/v1/usage \\
  -H "Authorization: Bearer ${fresh ?? "mh_live_你的密钥"}" \\
  -H "content-type: application/json" \\
  -d '{"day":"2026-10-01","tool":"claude-code","tokensIn":1200000,"tokensOut":85000,"idempotencyKey":"2026-10-01-claude-code"}'`;

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
        <IconPlug size={15} /> 我的接入 · {me.handle}
      </h2>
      {fresh && (
        <p className="mt-3 rounded-tile bg-accent-softer px-3.5 py-2.5 text-[12.5px] leading-[1.7] text-accent">
          密钥已生成，只显示这一次，先复制保存：
          <span className="mono mt-1 block break-all font-semibold">{fresh}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="key-label" className="mb-1.5 block text-[12px] font-semibold text-ink-3">密钥用途</label>
          <input
            id="key-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如 macbook、ci"
            className="h-10 w-full rounded-card bg-bg-sunk px-3.5 text-[13.5px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[box-shadow] placeholder:text-ink-4 focus:bg-surface focus:ring-accent dark:bg-bg-muted/60"
          />
        </div>
        <button
          type="button"
          onClick={createKey}
          disabled={busy}
          className="h-10 shrink-0 rounded-full bg-accent px-5 text-[13.5px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink disabled:bg-line-strong disabled:text-ink-4"
        >
          {busy ? "生成中" : "生成密钥"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-hot">{error}</p>}

      {me.keys.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft">
          {me.keys.map((k: TokenKeyView) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="mono text-[12.5px] text-ink">{k.prefix}…</span>
                <span className="ml-2 text-[12px] text-ink-4">{k.label}</span>
              </span>
              <button type="button" onClick={() => revoke(k.id)} className="shrink-0 text-[12px] text-ink-4 transition-colors hover:text-hot">
                吊销
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[12.5px] font-semibold text-ink">上报一行命令</p>
      <div className="mt-2">
        <CodeBlock text={curl} />
      </div>
      <p className="mt-2 text-[12px] leading-[1.7] text-ink-4">
        同一个 idempotencyKey 重复上报会覆盖，不会叠加。只上传数字，不上传对话内容。完整说明见 <Link to="/agent" className="text-accent hover:underline">Agent 接入</Link>。
      </p>
    </section>
  );
}
