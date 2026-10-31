-- Up Migration
CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('original','reshare')),
  reshare_of_post_id uuid REFERENCES posts(id),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  source_url text CHECK (source_url IS NULL OR (char_length(source_url) <= 2048 AND source_url ~ '^https?://')),
  revision int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','held','deleted')),
  author_tier_at_post text NOT NULL CHECK (author_tier_at_post IN ('trusted','neutral','low')),
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CHECK (
    (kind = 'original' AND reshare_of_post_id IS NULL AND char_length(body) >= 20)
    OR (kind = 'reshare' AND reshare_of_post_id IS NOT NULL)
  )
);
CREATE INDEX posts_feed_idx ON posts (created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX posts_tsv_idx ON posts USING gin (body_tsv);
CREATE UNIQUE INDEX posts_one_reshare_uq ON posts (author_id, reshare_of_post_id)
  WHERE kind = 'reshare' AND status <> 'deleted';
CREATE INDEX posts_reshare_of_idx ON posts (reshare_of_post_id) WHERE kind = 'reshare';

CREATE FUNCTION posts_reshare_target_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'reshare' AND (SELECT kind FROM posts WHERE id = NEW.reshare_of_post_id) <> 'original' THEN
    RAISE EXCEPTION 'reshare target must be an original post' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posts_reshare_target_trg BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION posts_reshare_target_original();

CREATE TABLE post_revisions (
  post_id uuid NOT NULL REFERENCES posts(id),
  revision int NOT NULL,
  body text NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, revision)
);

CREATE TABLE post_media (
  post_id uuid NOT NULL REFERENCES posts(id),
  media_id uuid NOT NULL REFERENCES media(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
  PRIMARY KEY (post_id, media_id),
  UNIQUE (post_id, position)
);

CREATE TABLE detection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  post_revision int NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ok','failed','failed_permanent')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_name text,
  model_version text,
  p_fake numeric(6,5) CHECK (p_fake IS NULL OR (p_fake >= 0 AND p_fake <= 1)),
  band text CHECK (band IS NULL OR band IN ('likely_fake','uncertain','likely_real')),
  latency_ms int,
  error_code text,
  error_detail text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status <> 'ok' OR (p_fake IS NOT NULL AND band IS NOT NULL AND model_name IS NOT NULL AND model_version IS NOT NULL))
);
CREATE INDEX detection_due_idx ON detection_results (next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX detection_post_idx ON detection_results (post_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS detection_results CASCADE;
DROP TABLE IF EXISTS post_media CASCADE;
DROP TABLE IF EXISTS post_revisions CASCADE;
DROP TRIGGER IF EXISTS posts_reshare_target_trg ON posts;
DROP FUNCTION IF EXISTS posts_reshare_target_original CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
