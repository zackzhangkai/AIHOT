-- Community accounts for the token board. Deliberately separate from admin_users: a community
-- account signs in through its own cookie and can never reach /api/admin.
-- Sign-in is a one-time email link; no passwords are stored.

CREATE TABLE community_users (
  id             text PRIMARY KEY,
  handle         text UNIQUE NOT NULL CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  email          text UNIQUE NOT NULL CHECK (email = lower(email)),
  email_verified boolean NOT NULL DEFAULT false,
  display_name   text,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'banned')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz
);

CREATE INDEX community_users_created_idx ON community_users (created_at DESC);

-- Opaque session ids are stored hashed; the cookie carries the random value only.
CREATE TABLE community_sessions (
  id_hash    text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);

CREATE INDEX community_sessions_user_idx ON community_sessions (user_id);
CREATE INDEX community_sessions_expiry_idx ON community_sessions (expires_at);

-- One-time email links for registration and sign-in. The token itself is never stored.
CREATE TABLE community_email_tokens (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  user_id     text REFERENCES community_users (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('register', 'login')),
  handle      text,
  return_to   text,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_email_tokens_email_idx ON community_email_tokens (email, created_at DESC);
