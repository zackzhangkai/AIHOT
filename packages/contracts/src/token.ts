// Token board: community members report how many tokens their tools consumed each day, and the site
// shows the result as a leaderboard and a per-member heatmap. Every number here is self-reported.

export const TOKEN_TOOLS = ["claude-code", "codex", "cursor", "api", "other"] as const;
export type TokenTool = (typeof TOKEN_TOOLS)[number];

export const TOKEN_TOOL_LABELS: Record<TokenTool, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  api: "API 直调",
  other: "其他",
};

export const TOKEN_RANGES = ["today", "7d", "30d", "all"] as const;
export type TokenRange = (typeof TOKEN_RANGES)[number];

export const TOKEN_RANGE_LABELS: Record<TokenRange, string> = {
  today: "今日",
  "7d": "近 7 天",
  "30d": "近 30 天",
  all: "累计",
};

export interface TokenBoardRow {
  rank: number;
  handle: string;
  displayName: string | null;
  tokens: number;
  activeDays: number;
  lastDay: string;
}

export interface TokenBoardResponse {
  range: TokenRange;
  tool: TokenTool | null;
  /** Inclusive first day of the window, null for "all". */
  from: string | null;
  /** The board's own calendar day (Asia/Shanghai). */
  today: string;
  rows: TokenBoardRow[];
  /** Visitors without an account see only this many rows. */
  anonymousLimit: number;
  truncated: boolean;
}

export type TokenHeatmapLevel = 0 | 1 | 2 | 3 | 4;

export interface TokenHeatmapCell {
  day: string;
  tokens: number;
  level: TokenHeatmapLevel;
}

export interface TokenHeatmapResponse {
  handle: string;
  displayName: string | null;
  days: number;
  total: number;
  activeDays: number;
  cells: TokenHeatmapCell[];
}

export interface TokenSummaryResponse {
  members: number;
  reportingToday: number;
  tokensToday: number;
  tokensTotal: number;
  today: string;
}

export interface TokenUsageInput {
  /** Local calendar day, YYYY-MM-DD. At most seven days back. */
  day: string;
  tool?: TokenTool;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Required unless both tokensIn and tokensOut are given. */
  tokensTotal?: number;
  costUsd?: number;
  client?: string;
  /** Repeating the same key replaces the earlier report instead of adding to it. */
  idempotencyKey: string;
}

export interface TokenUsageAccepted {
  day: string;
  tool: TokenTool;
  tokensTotal: number;
  /** True when this report replaced an earlier one with the same idempotency key. */
  replaced: boolean;
}

export interface TokenKeyView {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface TokenMeResponse {
  signedIn: boolean;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  keys: TokenKeyView[];
}
