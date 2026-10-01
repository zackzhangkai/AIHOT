-- Self-reported token usage. Events are the audit trail (one row per report, replaced in place when
-- the same idempotency key comes again); the daily table is what every page reads.

CREATE TABLE token_usage_events (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  key_id          text REFERENCES community_api_keys (id) ON DELETE SET NULL,
  day             date NOT NULL,
  tool            text NOT NULL DEFAULT 'other' CHECK (tool IN ('claude-code', 'codex', 'cursor', 'api', 'other')),
  model           text,
  tokens_in       bigint NOT NULL DEFAULT 0,
  tokens_out      bigint NOT NULL DEFAULT 0,
  tokens_total    bigint NOT NULL,
  cost_usd        numeric(14, 6),
  report_source   text NOT NULL DEFAULT 'self' CHECK (report_source IN ('self', 'cli', 'agent', 'imported')),
  client          text,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX token_usage_events_user_day_idx ON token_usage_events (user_id, day DESC);
CREATE INDEX token_usage_events_day_idx ON token_usage_events (day DESC);

-- One row per member, day and tool; rolled up on every report so reads stay small.
CREATE TABLE token_usage_daily (
  user_id      text NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  day          date NOT NULL,
  tool         text NOT NULL,
  tokens_total bigint NOT NULL DEFAULT 0,
  tokens_in    bigint NOT NULL DEFAULT 0,
  tokens_out   bigint NOT NULL DEFAULT 0,
  cost_usd     numeric(14, 6) NOT NULL DEFAULT 0,
  events       integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, tool)
);

CREATE INDEX token_usage_daily_day_idx ON token_usage_daily (day DESC, tokens_total DESC);
