-- Reader newsletter. A GET never changes subscription state; email-client one-click POSTs do.

CREATE TABLE newsletter_subscribers (
  id                 text PRIMARY KEY,
  email              text NOT NULL UNIQUE CHECK (email = lower(email)),
  status             text NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed', 'suppressed')),
  unsubscribe_token  text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_requested_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX newsletter_subscribers_active_idx ON newsletter_subscribers (status, created_at);

CREATE TABLE newsletter_deliveries (
  subscriber_id  text NOT NULL REFERENCES newsletter_subscribers (id) ON DELETE CASCADE,
  report_key     text NOT NULL,
  resend_id      text,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, report_key)
);
