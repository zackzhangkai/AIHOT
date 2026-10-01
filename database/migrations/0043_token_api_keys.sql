-- API keys for usage reporting. Only the hash is stored: the plain key is shown once, when it is
-- created, and never again.

CREATE TABLE community_api_keys (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  -- Display prefix, e.g. "mh_live_ab12": enough to tell keys apart, useless as a credential.
  key_prefix   text NOT NULL,
  label        text NOT NULL DEFAULT 'default',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_api_keys_user_idx ON community_api_keys (user_id, created_at DESC);
