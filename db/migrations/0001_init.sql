-- JobOps Agent v2 — operational state only.
-- NO personal facts live here. Those are in data/personal.md. Plan sections 4 and 20.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- employers / postings ----------
CREATE TABLE companies (
  id                    TEXT PRIMARY KEY,             -- canonical_employer_id, e.g. 'amazon'
  display_name          TEXT NOT NULL,
  careers_url           TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ats_tenants (
  id                    TEXT PRIMARY KEY,             -- e.g. 'greenhouse:acme'
  adapter_id            TEXT NOT NULL,
  company_id            TEXT NOT NULL REFERENCES companies(id),
  tenant_slug           TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (adapter_id, tenant_slug)
);

CREATE TABLE job_families (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            TEXT NOT NULL REFERENCES companies(id),
  normalized_title      TEXT NOT NULL,
  family_hash           TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_postings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            TEXT NOT NULL REFERENCES companies(id),
  ats_tenant_id         TEXT REFERENCES ats_tenants(id),
  job_family_id         UUID REFERENCES job_families(id),

  requisition_id        TEXT,
  identity_value        TEXT NOT NULL,                -- resolved identifier
  identity_source       TEXT NOT NULL,                -- requisition_id | employer_job_id | ...
  identity_reliable     BOOLEAN NOT NULL DEFAULT true,

  title                 TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'DISCOVERED',
  jobcard               JSONB NOT NULL,
  jd_hash               TEXT NOT NULL,
  source_url            TEXT NOT NULL,
  official_url          TEXT,

  discovered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at           TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_postings_identity_uniq
  ON job_postings (company_id, COALESCE(ats_tenant_id, ''), identity_value);
CREATE INDEX job_postings_state_idx ON job_postings (state);
CREATE INDEX job_postings_jd_hash_idx ON job_postings (jd_hash);

CREATE TABLE job_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_posting_id        UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  source               TEXT NOT NULL,                 -- 'greenhouse' | 'email_alert' | ...
  url                  TEXT NOT NULL,
  seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_posting_id, source, url)
);

-- ---------- evaluation ----------
CREATE TABLE job_evaluations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_posting_id        UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  tier                  TEXT NOT NULL CHECK (tier IN ('A','B','C','SKIP')),
  reason                TEXT NOT NULL,
  confidence            NUMERIC(3,2) NOT NULL,
  missing_info          JSONB NOT NULL DEFAULT '[]',
  resume_variant        TEXT,
  stage                 TEXT NOT NULL,                -- 'hard_gate' | 'llm'
  policy_version        TEXT NOT NULL,
  jd_hash               TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_evaluations_cache_idx ON job_evaluations (jd_hash, policy_version);

-- ---------- applications ----------
CREATE TABLE applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_posting_id        UUID NOT NULL REFERENCES job_postings(id),

  canonical_employer_id TEXT NOT NULL,
  ats_tenant_id         TEXT,
  requisition_id        TEXT,
  application_key       TEXT NOT NULL,

  status                TEXT NOT NULL DEFAULT 'QUEUED_TO_APPLY',
  tier                  TEXT CHECK (tier IN ('A','B','C')),
  mode                  TEXT NOT NULL DEFAULT 'assisted',

  resume_version_id     UUID,
  first_attempt_at      TIMESTAMPTZ,
  submitted_at          TIMESTAMPTZ,
  retry_count           INT NOT NULL DEFAULT 0,
  evidence_level        TEXT NOT NULL DEFAULT 'E0',
  last_inbox_update_at  TIMESTAMPTZ,

  locked_by             TEXT,
  lock_expires_at       TIMESTAMPTZ,
  heartbeat_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The duplicate rule: one confirmed submission per requisition, forever.
CREATE UNIQUE INDEX applications_submitted_key_uniq
  ON applications (application_key)
  WHERE status IN ('SUBMITTED_UNVERIFIED','SUBMITTED_VERIFIED','INTERVIEW','REJECTED','OFFER');
CREATE INDEX applications_status_idx ON applications (status);

CREATE TABLE application_events (
  id                    BIGSERIAL PRIMARY KEY,
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_state            TEXT,
  to_state              TEXT NOT NULL,
  reason                TEXT NOT NULL,
  actor                 TEXT NOT NULL,                -- 'orchestrator' | 'user' | 'inbox_worker'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE application_answers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  field_key             TEXT NOT NULL,
  question              TEXT NOT NULL,
  answer                TEXT NOT NULL,
  answer_origin         TEXT NOT NULL,                -- 'personal_md' | 'approval'
  approval_id           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, field_key)
);

-- ---------- approvals (asked in Google Chat, recorded here) ----------
CREATE TABLE approvals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID REFERENCES applications(id) ON DELETE CASCADE,
  job_posting_id        UUID REFERENCES job_postings(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL CHECK (type IN ('information','conflict','retry','action')),
  status                TEXT NOT NULL DEFAULT 'pending',  -- pending|answered|expired|cancelled
  question              TEXT NOT NULL,
  field_key             TEXT,
  context               JSONB NOT NULL DEFAULT '{}',
  proposed_answer       TEXT,
  approved_answer       TEXT,
  scope                 TEXT CHECK (scope IN ('this_job','this_run','permanent')),
  chat_message_id       TEXT,
  policy_file_updated   TEXT,
  run_id                UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at           TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ
);
CREATE INDEX approvals_pending_idx ON approvals (status) WHERE status = 'pending';

CREATE TABLE approval_events (
  id                    BIGSERIAL PRIMARY KEY,
  approval_id           UUID NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  event                 TEXT NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction             TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  space_id              TEXT NOT NULL,
  message_id            TEXT,
  thread_id             TEXT,
  approval_id           UUID REFERENCES approvals(id) ON DELETE SET NULL,
  body                  TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  TEXT NOT NULL,   -- captcha|assessment|id_check|auth_expired|adapter_broken|retries_exhausted|interview|offer
  severity              TEXT NOT NULL DEFAULT 'normal',
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  dashboard_path        TEXT,
  application_id        UUID REFERENCES applications(id) ON DELETE CASCADE,
  delivered_at          TIMESTAMPTZ,
  acknowledged_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- inbox worker ----------
CREATE TABLE inbox_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id      TEXT NOT NULL UNIQUE,
  thread_id             TEXT,
  from_address          TEXT NOT NULL,
  subject               TEXT NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL,
  classification        TEXT NOT NULL,  -- confirmation|rejection|interview|offer|recruiter|assessment|action_required|job_alert|unrelated
  matched_application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  match_confidence      NUMERIC(3,2),
  match_method          TEXT,
  extracted_fields      JSONB NOT NULL DEFAULT '{}',
  surfaced_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inbox_unmatched_idx ON inbox_messages (classification)
  WHERE matched_application_id IS NULL;

-- ---------- evidence ----------
CREATE TABLE evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  level                 TEXT NOT NULL CHECK (level IN ('E1','E2','E3','E4')),
  kind                  TEXT NOT NULL,  -- confirmation_page|email|dashboard|screenshot
  captured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  canonical_url         TEXT,
  confirmation_text     TEXT,
  inbox_message_id      UUID REFERENCES inbox_messages(id),
  detail                JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE screenshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  evidence_id           UUID REFERENCES evidence(id) ON DELETE SET NULL,
  trigger               TEXT NOT NULL,  -- submission|success_page|parked|error|retry
  file_path             TEXT NOT NULL,
  sha256                TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- adapters ----------
CREATE TABLE adapters (
  id                    TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  version               TEXT NOT NULL DEFAULT '0.1.0',
  enabled               BOOLEAN NOT NULL DEFAULT false,
  shadow_mode           BOOLEAN NOT NULL DEFAULT true,
  status                TEXT NOT NULL DEFAULT 'Disabled',
  last_check_at         TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  last_error_code       TEXT,
  last_error_summary    TEXT,
  success_rate_24h      NUMERIC(4,3),
  success_rate_7d       NUMERIC(4,3)
);

CREATE TABLE adapter_health_events (
  id                    BIGSERIAL PRIMARY KEY,
  adapter_id            TEXT NOT NULL REFERENCES adapters(id) ON DELETE CASCADE,
  status                TEXT NOT NULL,
  ok                    BOOLEAN NOT NULL,
  error_code            TEXT,
  summary               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- runs ----------
CREATE TABLE runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                  TEXT NOT NULL,
  trigger               TEXT NOT NULL,  -- manual|scheduled
  phase                 TEXT NOT NULL DEFAULT 'starting',
  status                TEXT NOT NULL DEFAULT 'running',  -- running|wind_down|finished|aborted
  policy_version        TEXT NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  wind_down_at          TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  max_duration_minutes  INT NOT NULL DEFAULT 60,
  stopped_reason        TEXT,
  stats                 JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE run_events (
  id                    BIGSERIAL PRIMARY KEY,
  run_id                UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  worker                TEXT NOT NULL,
  event                 TEXT NOT NULL,
  detail                JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE retry_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  attempt_number        INT NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  failure_class         TEXT NOT NULL,
  failure_detail        TEXT,
  proposed_change       TEXT NOT NULL,
  approval_id           UUID REFERENCES approvals(id),
  outcome               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, attempt_number)
);

-- ---------- resumes ----------
CREATE TABLE resume_variants (
  id                    TEXT PRIMARY KEY,             -- 'dotnet-backend'
  display_name          TEXT NOT NULL,
  description           TEXT
);

CREATE TABLE resume_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id            TEXT NOT NULL REFERENCES resume_variants(id),
  version               TEXT NOT NULL,
  file_path             TEXT NOT NULL,
  file_hash             TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (variant_id, version)
);

-- ---------- token accounting ----------
CREATE TABLE model_calls (
  id                    BIGSERIAL PRIMARY KEY,
  run_id                UUID REFERENCES runs(id) ON DELETE SET NULL,
  job_posting_id        UUID REFERENCES job_postings(id) ON DELETE SET NULL,
  worker                TEXT NOT NULL,
  purpose               TEXT NOT NULL,
  model                 TEXT NOT NULL,
  input_tokens          INT NOT NULL,
  output_tokens         INT NOT NULL,
  cache_hit             BOOLEAN NOT NULL DEFAULT false,
  cost_usd              NUMERIC(10,6),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- audit ----------
CREATE TABLE audit_events (
  id                    BIGSERIAL PRIMARY KEY,
  actor                 TEXT NOT NULL,
  action                TEXT NOT NULL,
  job_posting_id        UUID,
  application_id        UUID,
  approval_id           UUID,
  reason                TEXT NOT NULL,
  policy_version        TEXT,
  result                TEXT,
  detail                JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
