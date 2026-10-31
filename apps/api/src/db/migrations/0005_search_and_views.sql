-- Up Migration
CREATE INDEX users_username_trgm_idx ON users USING gin (username gin_trgm_ops);
CREATE INDEX users_display_trgm_idx ON users USING gin (display_name gin_trgm_ops);

CREATE VIEW post_current_assessment_v AS
  SELECT a.* FROM assessments a WHERE a.is_current;

CREATE VIEW post_latest_detection_v AS
  SELECT DISTINCT ON (d.post_id) d.*
  FROM detection_results d
  JOIN posts p ON p.id = d.post_id AND d.post_revision = p.revision
  ORDER BY d.post_id, d.created_at DESC;

CREATE VIEW post_public_status_v AS
  SELECT p.id AS post_id,
    CASE
      WHEN a.verdict = 'fake' THEN 'fact_checked_false'
      WHEN a.verdict = 'real' AND a.source = 'admin' THEN 'fact_checked_true'
      WHEN a.verdict = 'real' AND a.source = 'auto_real' THEN 'none'
      WHEN a.verdict = 'unverifiable' THEN 'unverifiable'
      WHEN a.id IS NULL AND d.band = 'likely_fake' THEN 'auto_flagged'
      ELSE 'none'
    END AS label,
    EXISTS (
      SELECT 1 FROM appeals ap JOIN reputation_events e ON e.id = ap.event_id
      WHERE ap.status = 'open' AND e.assessment_id = a.id
    ) AS under_appeal
  FROM posts p
  LEFT JOIN post_current_assessment_v a ON a.post_id = p.id
  LEFT JOIN post_latest_detection_v d ON d.post_id = p.id AND d.status = 'ok';

CREATE VIEW review_queue_v AS
  SELECT p.id AS post_id,
    (3 * COALESCE(rp.open_reports, 0) + COALESCE(rs.reshares, 0)
      + CASE d.band WHEN 'likely_fake' THEN 5 WHEN 'uncertain' THEN 2 ELSE 0 END) AS priority,
    p.created_at
  FROM posts p
  LEFT JOIN post_current_assessment_v ca ON ca.post_id = p.id
  LEFT JOIN post_latest_detection_v d ON d.post_id = p.id
  LEFT JOIN LATERAL (SELECT count(*) AS open_reports FROM reports r WHERE r.post_id = p.id AND r.status = 'open') rp ON true
  LEFT JOIN LATERAL (SELECT count(*) AS reshares FROM posts s WHERE s.reshare_of_post_id = p.id AND s.kind = 'reshare' AND s.status <> 'deleted') rs ON true
  WHERE p.kind = 'original'
    AND (
      (ca.id IS NULL AND (
        (d.status = 'ok' AND d.band IN ('likely_fake','uncertain'))
        OR d.status = 'failed_permanent'
        OR COALESCE(rp.open_reports, 0) > 0
        OR p.status = 'held'
      ))
      OR (ca.source = 'auto_real' AND COALESCE(rp.open_reports, 0) > 0)
    )
    AND (p.status <> 'deleted' OR COALESCE(rp.open_reports, 0) > 0 OR COALESCE(rs.reshares, 0) > 0 OR d.band = 'likely_fake');

-- Down Migration
DROP VIEW IF EXISTS review_queue_v CASCADE;
DROP VIEW IF EXISTS post_public_status_v CASCADE;
DROP VIEW IF EXISTS post_latest_detection_v CASCADE;
DROP VIEW IF EXISTS post_current_assessment_v CASCADE;
DROP INDEX IF EXISTS users_display_trgm_idx;
DROP INDEX IF EXISTS users_username_trgm_idx;
