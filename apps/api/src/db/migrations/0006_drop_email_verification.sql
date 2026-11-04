-- Up Migration
-- DEC-017: email verification removed. Accounts may act as soon as they are
-- registered; the column and any pending verification tokens go away.
DELETE FROM email_tokens WHERE purpose = 'verify_email';
ALTER TABLE users DROP COLUMN email_verified_at;

-- Down Migration
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
