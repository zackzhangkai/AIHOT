-- Externally generated investment-research reports.  A market can publish one
-- report per Beijing calendar day; same-day re-pushes are idempotent updates.
CREATE TABLE IF NOT EXISTS research_reports (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market text NOT NULL,
  report_date date NOT NULL,
  title text NOT NULL,
  risk_level text NOT NULL,
  summary text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggers jsonb,
  watchlist jsonb,
  body_md text NOT NULL DEFAULT '',
  pushed_at timestamptz NOT NULL DEFAULT now()
);

-- A pre-release version of this module used report_date as its only key.  Keep
-- those reports and make the schema compatible before adding the market index.
ALTER TABLE research_reports ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'us-drawdown';
ALTER TABLE research_reports DROP CONSTRAINT IF EXISTS research_reports_report_date_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_reports_market_date_key'
  ) THEN
    ALTER TABLE research_reports ADD CONSTRAINT research_reports_market_date_key UNIQUE (market, report_date);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_reports_market_check'
  ) THEN
    ALTER TABLE research_reports ADD CONSTRAINT research_reports_market_check CHECK (market IN ('us-drawdown', 'cn-ashare-close'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS research_reports_market_date_idx ON research_reports (market, report_date DESC);
