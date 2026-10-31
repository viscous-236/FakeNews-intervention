-- Up Migration
CREATE TABLE waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL UNIQUE CHECK (number >= 1),
  status text NOT NULL CHECK (status IN ('open','finalized')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id),
  finalized_by_system boolean NOT NULL DEFAULT false,
  formula_version text NOT NULL DEFAULT 'paper-eq2-v1',
  CHECK ((status = 'open' AND finalized_at IS NULL) OR (status = 'finalized' AND finalized_at IS NOT NULL))
);
CREATE UNIQUE INDEX waves_one_open_uq ON waves ((true)) WHERE status = 'open';
INSERT INTO waves (number, status) VALUES (1, 'open');

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  reporter_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('false_information','misleading','spam','harassment','other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, reporter_id)
);
CREATE INDEX reports_post_open_idx ON reports (post_id) WHERE status = 'open';

CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  post_revision int NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('real','fake','unverifiable')),
  source text NOT NULL CHECK (source IN ('admin','auto_real')),
  decided_by uuid REFERENCES users(id),
  rationale text NOT NULL CHECK (char_length(rationale) >= 10 AND char_length(rationale) <= 2000),
  detection_result_id uuid REFERENCES detection_results(id),
  supersedes_id uuid REFERENCES assessments(id),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source = 'admin' AND decided_by IS NOT NULL)
    OR (source = 'auto_real' AND decided_by IS NULL AND verdict = 'real')
  )
);
CREATE UNIQUE INDEX assessments_one_current_uq ON assessments (post_id) WHERE is_current;
CREATE UNIQUE INDEX assessments_one_successor_uq ON assessments (supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE FUNCTION assessments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'assessments are append-only'; END IF;
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR NOT (OLD.is_current = true AND NEW.is_current = false) THEN
    RAISE EXCEPTION 'assessments are append-only; only is_current true->false is allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessments_guard_trg BEFORE UPDATE OR DELETE ON assessments FOR EACH ROW EXECUTE FUNCTION assessments_guard();

CREATE TABLE user_wave_reputation (
  user_id uuid NOT NULL REFERENCES users(id),
  wave_id uuid NOT NULL REFERENCES waves(id),
  n_pos int NOT NULL CHECK (n_pos >= 0),
  n_neg int NOT NULL CHECK (n_neg >= 0),
  n_adj int NOT NULL,
  r int NOT NULL,
  sigma_used numeric(4,3) NOT NULL CHECK (sigma_used >= 0 AND sigma_used <= 1),
  q_before numeric(14,3) NOT NULL,
  delta numeric(14,3) NOT NULL,
  q_after numeric(14,3) NOT NULL,
  formula_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, wave_id),
  CHECK (r = n_pos - n_neg + n_adj),
  CHECK (delta = sigma_used * r),
  CHECK (q_after = q_before + delta)
);

CREATE TABLE reputation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  post_id uuid NOT NULL REFERENCES posts(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  report_id uuid REFERENCES reports(id),
  reshare_post_id uuid REFERENCES posts(id),
  kind text NOT NULL CHECK (kind IN (
    'RESPONSIBLE_POST',
    'RESPONSIBLE_RESHARE',
    'VALID_REPORT',
    'MISINFO_POST',
    'MISINFO_RESHARE',
    'MISINFO_LIKE',
    'REVERSAL'
  )),
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  status text NOT NULL CHECK (status IN ('eligible','held','voided','counted')),
  wave_id uuid REFERENCES waves(id),
  reverses_event_id uuid REFERENCES reputation_events(id),
  void_reason text CHECK (
    void_reason IS NULL OR void_reason IN ('cap_exceeded','assessment_superseded','interaction_retracted')
  ),
  ledger_user_id uuid,
  ledger_wave_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (ledger_user_id, ledger_wave_id) REFERENCES user_wave_reputation (user_id, wave_id),
  CHECK (
    (kind IN ('RESPONSIBLE_POST','RESPONSIBLE_RESHARE','VALID_REPORT') AND value = 1)
    OR (kind IN ('MISINFO_POST','MISINFO_RESHARE','MISINFO_LIKE') AND value = -1)
    OR (kind = 'REVERSAL' AND reverses_event_id IS NOT NULL)
  ),
  CHECK ((status IN ('eligible','counted') AND wave_id IS NOT NULL) OR (status IN ('held','voided') AND wave_id IS NULL)),
  CHECK (status <> 'voided' OR void_reason IS NOT NULL),
  CHECK (status = 'voided' OR void_reason IS NULL),
  CHECK (status <> 'counted' OR (ledger_user_id = user_id AND ledger_wave_id = wave_id))
);
CREATE UNIQUE INDEX events_one_per_assessment_uq ON reputation_events (assessment_id, user_id, kind) WHERE kind <> 'REVERSAL';
CREATE UNIQUE INDEX events_one_reversal_uq ON reputation_events (reverses_event_id) WHERE kind = 'REVERSAL' AND status <> 'voided';
CREATE INDEX events_wave_idx ON reputation_events (wave_id, user_id) WHERE status = 'eligible';
CREATE INDEX events_user_idx ON reputation_events (user_id, created_at DESC);
CREATE INDEX events_post_assessment_idx ON reputation_events (post_id, assessment_id);

CREATE FUNCTION events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reputation_events are never deleted'; END IF;
  IF OLD.status = 'counted' THEN RAISE EXCEPTION 'counted events are immutable'; END IF;
  IF NEW.status = 'counted' AND COALESCE(current_setting('app.scoring', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'events may only become counted inside wave finalization';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER events_guard_trg BEFORE UPDATE OR DELETE ON reputation_events FOR EACH ROW EXECUTE FUNCTION events_guard();

CREATE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'user_wave_reputation is immutable'; END IF;
  IF COALESCE(current_setting('app.scoring', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'ledger rows may only be inserted by the scoring engine';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON user_wave_reputation FOR EACH ROW EXECUTE FUNCTION ledger_guard();

CREATE TABLE appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES reputation_events(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  appellant_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  resolved_by uuid REFERENCES users(id),
  resolved_by_system boolean NOT NULL DEFAULT false,
  resolution_note text,
  new_assessment_id uuid REFERENCES assessments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL AND (resolved_by IS NOT NULL OR resolved_by_system = true) AND char_length(coalesce(resolution_note,'')) >= 10)
  )
);

CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin','system')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_kind = 'admin' AND actor_id IS NOT NULL) OR actor_kind = 'system')
);
CREATE INDEX audit_entity_idx ON admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE FUNCTION audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admin_audit_log is append-only'; END $$;
CREATE TRIGGER audit_guard_trg BEFORE UPDATE OR DELETE ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION audit_guard();

-- Down Migration
DROP TRIGGER IF EXISTS audit_guard_trg ON admin_audit_log;
DROP FUNCTION IF EXISTS audit_guard CASCADE;
DROP TABLE IF EXISTS admin_audit_log CASCADE;
DROP TABLE IF EXISTS appeals CASCADE;
DROP TRIGGER IF EXISTS ledger_guard_trg ON user_wave_reputation;
DROP FUNCTION IF EXISTS ledger_guard CASCADE;
DROP TRIGGER IF EXISTS events_guard_trg ON reputation_events;
DROP FUNCTION IF EXISTS events_guard CASCADE;
DROP TABLE IF EXISTS reputation_events CASCADE;
DROP TABLE IF EXISTS user_wave_reputation CASCADE;
DROP TRIGGER IF EXISTS assessments_guard_trg ON assessments;
DROP FUNCTION IF EXISTS assessments_guard CASCADE;
DROP TABLE IF EXISTS assessments CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS waves CASCADE;
