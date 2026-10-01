// Reports one day of your own token usage to a MyHOT community board.
//   node scripts/myhot-report.ts --key mh_live_… [--tool claude-code|codex] [--day 2026-10-01] [--dry-run]
//
// It reads the usage counters in your local tool logs and sends four numbers: the day, the tool, the
// tokens in and out. It never reads or sends a prompt, a reply, a file name or a path — only counts.
// Re-running it for the same day replaces that day's report instead of adding to it, so a cron or a
// hook can run it as often as it likes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SITE } from "@aihot/industry/site";
import { beijingDate, isValidDate } from "@aihot/contracts/time";
import { TOKEN_TOOLS, type TokenTool } from "@aihot/contracts/token";

const VERSION = "1";

function arg(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] ?? null : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

if (has("help") || has("h")) {
  console.log(`用法：node scripts/myhot-report.ts --key mh_live_… [选项]

  --key     API Key（也可以设 MYHOT_TOKEN_KEY 环境变量；在 /join 注册后到 /token 创建）
  --tool    claude-code | codex（不给就两个都扫，各自上报）
  --day     YYYY-MM-DD，默认今天（北京时间）
  --base    站点地址，默认 ${SITE.defaultUrl}
  --dry-run 只算不传，把要发的数字打出来
  --verbose 列出扫到的每个文件

只上传 token 数量与工具名，不上传对话内容、文件名或 prompt。`);
  process.exit(0);
}

const key = arg("key") ?? process.env.MYHOT_TOKEN_KEY ?? "";
if (!key.startsWith("mh_live_")) die("缺少 API Key：--key mh_live_…，或者设 MYHOT_TOKEN_KEY。在 /join 注册后到 /token 创建。");

const base = (arg("base") ?? process.env.MYHOT_BASE_URL ?? SITE.defaultUrl).replace(/\/+$/, "");
const day = arg("day") ?? beijingDate(new Date());
if (!isValidDate(day)) die(`${day} 不是有效日期，用 YYYY-MM-DD。`);
const dryRun = has("dry-run");
const verbose = has("verbose");
const wanted = arg("tool");
if (wanted && !(TOKEN_TOOLS as readonly string[]).includes(wanted)) die(`--tool 只能是：${TOKEN_TOOLS.join("、")}。`);

/** Lines of every file under `dir` whose name ends in .jsonl, newest-first by mtime. */
function jsonlFiles(dir: string, sinceMs: number): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return; // the tool was never installed here
    }
    for (const name of entries) {
      const p = path.join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".jsonl") && st.mtimeMs >= sinceMs) out.push(p);
    }
  };
  walk(dir);
  return out;
}

interface Totals { in: number; out: number; total: number; sessions: number }

/** Day boundaries in the site's own timezone (Beijing), as epoch millisecond bounds. */
function dayBounds(d: string): [number, number] {
  const start = Date.parse(`${d}T00:00:00+08:00`);
  return [start, start + 86400_000];
}

/**
 * Adds one turn's counters. Cached input is counted on top of plain input (both were read by the
 * model), and the tool's own `total_tokens` wins when it gives one: Codex's own total is the number
 * its /usage shows, and the parts do not always add up to it.
 */
function addUsage(t: Totals, day: string, at: string | undefined, usage: Record<string, unknown> | undefined): void {
  if (!at || !usage) return;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return;
  const [from, to] = dayBounds(day);
  if (ms < from || ms >= to) return;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const readIn = num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cached_input_tokens) + num(usage.cache_write_input_tokens);
  const out = num(usage.output_tokens) + num(usage.reasoning_output_tokens);
  t.in += readIn;
  t.out += out;
  t.total += num(usage.total_tokens) || readIn + out;
}

/**
 * Claude Code writes one JSONL per session under ~/.claude/projects; each assistant message carries
 * its own usage counters (cache reads and writes count as input).
 */
function claudeCode(day: string): Totals {
  const [from] = dayBounds(day);
  const t: Totals = { in: 0, out: 0, total: 0, sessions: 0 };
  const seen = new Set<string>();
  for (const file of jsonlFiles(path.join(os.homedir(), ".claude", "projects"), from)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let hit = false;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (d.type !== "assistant") continue;
      const message = d.message as { usage?: Record<string, unknown> } | undefined;
      addUsage(t, day, typeof d.timestamp === "string" ? d.timestamp : undefined, message?.usage);
      hit = true;
      if (typeof d.sessionId === "string") seen.add(d.sessionId);
    }
    if (hit) {
      t.sessions = Math.max(t.sessions, seen.size);
      if (verbose) console.log(`  claude-code  ${file}`);
    }
  }
  return t;
}

/** Codex CLI writes ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl with a token_count event per turn. */
function codex(day: string): Totals {
  const t: Totals = { in: 0, out: 0, total: 0, sessions: 0 };
  const root = path.join(os.homedir(), ".codex", "sessions");
  // The folders are named after UTC dates; the day is Beijing's, so yesterday's folder can hold it.
  const [from] = dayBounds(day);
  const folders = new Set<string>();
  for (const offset of [-1, 0, 1]) {
    const d = new Date(from + offset * 86400_000).toISOString().slice(0, 10);
    folders.add(path.join(root, d.slice(0, 4), d.slice(5, 7), d.slice(8, 10)));
  }
  const files = new Set<string>();
  for (const folder of folders) for (const f of jsonlFiles(folder, 0)) files.add(f);
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let hit = false;
    for (const line of text.split("\n")) {
      if (!line.trim() || !line.includes("token_count")) continue;
      let d: { timestamp?: string; payload?: { type?: string; info?: { last_token_usage?: Record<string, unknown> } } };
      try {
        d = JSON.parse(line) as typeof d;
      } catch {
        continue;
      }
      if (d.payload?.type !== "token_count") continue;
      addUsage(t, day, d.timestamp, d.payload.info?.last_token_usage);
      hit = true;
    }
    if (hit) {
      t.sessions += 1;
      if (verbose) console.log(`  codex        ${file}`);
    }
  }
  return t;
}

/** Cursor keeps no readable local counter, so the script cannot report it; use --tool api instead. */
const READERS: Partial<Record<TokenTool, (day: string) => Totals>> = { "claude-code": claudeCode, codex };

async function report(tool: TokenTool, t: Totals): Promise<number> {
  const tokensOut = Math.round(t.out);
  const tokensTotal = Math.round(t.total || t.in + t.out);
  const body = {
    day,
    tool,
    // Cached input can exceed the tool's own total, so the split is always total minus output.
    tokensIn: Math.max(0, tokensTotal - tokensOut),
    tokensOut,
    tokensTotal,
    client: `myhot-report/${VERSION}`,
    idempotencyKey: `${tool}:${day}`,
  };
  if (body.tokensTotal <= 0) {
    console.log(`– ${tool}  ${day}  没有用量，跳过`);
    return 0;
  }
  if (dryRun) {
    console.log(`– ${tool}  ${day}  ${body.tokensTotal} tokens（in ${body.tokensIn} / out ${body.tokensOut}）  [dry-run，未上报]`);
    return 0;
  }
  if (verbose) console.log(`  上报 ${JSON.stringify(body)}`);
  const res = await fetch(`${base}/api/v1/usage`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`✗ ${tool}  上报失败 HTTP ${res.status} ${detail.slice(0, 200)}`);
    return 1;
  }
  const accepted = (await res.json()) as { replaced: boolean };
  console.log(`✓ ${tool}  ${day}  ${body.tokensTotal} tokens${accepted.replaced ? "（覆盖了当天上一次上报）" : ""}`);
  return 0;
}

const tools = wanted ? [wanted as TokenTool] : (Object.keys(READERS) as TokenTool[]);
let failed = 0;
for (const tool of tools) {
  const read = READERS[tool];
  if (!read) {
    console.error(`✗ ${tool}  没有本地用量日志可读；这个工具请自己按 API 上报。`);
    failed += 1;
    continue;
  }
  failed += await report(tool, read(day));
}
if (dryRun) console.log("\ndry-run：没有发出任何请求。去掉 --dry-run 就真的上报。");
process.exit(failed ? 1 : 0);
