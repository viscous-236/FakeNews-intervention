-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 160),
  avatar_media_id uuid,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  sigma numeric(4,3) NOT NULL CHECK (sigma >= 0 AND sigma <= 1),
  q numeric(14,3) NOT NULL DEFAULT 0,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- sigma is immutable; q may change only inside a transaction that ran: SET LOCAL app.scoring = 'on'
CREATE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sigma IS DISTINCT FROM OLD.sigma THEN
    RAISE EXCEPTION 'sigma is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.q IS DISTINCT FROM OLD.q AND COALESCE(current_setting('app.scoring', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'q may only be changed by the scoring engine' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard_trg BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_guard();

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip inet
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed_permanent')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status = 'queued';

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('avatar','post_image')),
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  bytes int NOT NULL CHECK (bytes > 0),
  width int NOT NULL, height int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_media_id) REFERENCES media(id);

-- Down Migration
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_avatar_fk;
DROP TABLE IF EXISTS media CASCADE;
DROP TABLE IF EXISTS email_outbox CASCADE;
DROP TABLE IF EXISTS email_tokens CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TRIGGER IF EXISTS users_guard_trg ON users;
DROP FUNCTION IF EXISTS users_guard CASCADE;
DROP TABLE IF EXISTS users CASCADE;
