export const RESEARCH_MARKETS = ["us-drawdown", "cn-ashare-close"] as const;
export type ResearchMarket = (typeof RESEARCH_MARKETS)[number];
export type ResearchRiskLevel = "low" | "medium" | "high";
export type ResearchSignalLevel = "red" | "amber" | "green";

export interface ResearchSignal {
  name: string;
  level: ResearchSignalLevel;
  detail: string;
  source?: string | null;
}

export interface ResearchTriggers { escalate: string[]; deescalate: string[]; }
export interface ResearchWatchItem { window: string; event: string; focus: string; }

/** Body of POST /api/ingest/research. A market and day identify one report. */
export interface ResearchReportIngest {
  market: ResearchMarket;
  date: string;
  title: string;
  riskLevel: ResearchRiskLevel;
  summary: string;
  signals: ResearchSignal[];
  triggers?: ResearchTriggers | null;
  watchlist?: ResearchWatchItem[] | null;
  bodyMd: string;
}

export interface ResearchReportSummary {
  market: ResearchMarket;
  date: string;
  title: string;
  riskLevel: ResearchRiskLevel;
  summary: string;
  redCount: number;
  amberCount: number;
  greenCount: number;
}

export interface ResearchReportDetail extends ResearchReportSummary {
  signals: ResearchSignal[];
  triggers: ResearchTriggers | null;
  watchlist: ResearchWatchItem[] | null;
  bodyMd: string;
  pushedAt: string;
}

export interface ResearchListPage {
  market: ResearchMarket;
  reports: ResearchReportSummary[];
}
