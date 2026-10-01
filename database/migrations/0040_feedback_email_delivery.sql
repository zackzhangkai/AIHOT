ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS email_forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_forward_error text;
