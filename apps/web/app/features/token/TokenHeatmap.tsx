// The contribution-style grid: one square per day, five shades of the site accent.
import type { TokenHeatmapCell, TokenHeatmapLevel } from "@aihot/contracts/token";

const LEVEL_CLASS: Record<TokenHeatmapLevel, string> = {
  0: "bg-line-soft",
  1: "bg-accent/20",
  2: "bg-accent/40",
  3: "bg-accent/65",
  4: "bg-accent",
};

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

/** 0 = Sunday. The grid is laid out in columns of weeks, so the first week needs a pad. */
function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function TokenHeatmap({ cells, size = 11 }: { cells: TokenHeatmapCell[]; size?: number }) {
  const first = cells[0];
  const pad = first ? weekday(first.day) : 0;
  const style = { width: size, height: size };
  return (
    <div className="flex gap-2">
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label="每日 token 消耗热力图">
        {Array.from({ length: pad }, (_, i) => (
          <span key={`pad-${i}`} style={style} />
        ))}
        {cells.map((cell) => (
          <span
            key={cell.day}
            title={`${cell.day} · ${cell.tokens === 0 ? "没有上报" : `${formatTokens(cell.tokens)} tokens`}`}
            className={`rounded-[2px] ${LEVEL_CLASS[cell.level]}`}
            style={style}
          />
        ))}
      </div>
    </div>
  );
}

export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-ink-4">
      <span>少</span>
      {(Object.keys(LEVEL_CLASS) as unknown as TokenHeatmapLevel[]).map((level) => (
        <span key={level} className={`h-[10px] w-[10px] rounded-[2px] ${LEVEL_CLASS[level]}`} />
      ))}
      <span>多</span>
    </div>
  );
}
