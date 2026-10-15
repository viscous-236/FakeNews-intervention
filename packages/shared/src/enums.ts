/**
 * Shared enums for the FakeNews-intervention platform.
 *
 * Every const array here must match EXACTLY the CHECK constraint values in the
 * SQL migrations.  TASK-018 parses the migration SQL and asserts equality.
 *
 * Naming convention:
 *   <noun><Variant>Values  – the const tuple  (e.g. userRoleValues)
 *   <Noun><Variant>        – the TypeScript type (e.g. UserRole)
 *   <noun><Variant>Schema  – the Zod enum       (e.g. userRoleSchema)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// users.role
// ---------------------------------------------------------------------------
export const userRoleValues = ['user', 'admin'] as const;
export type UserRole = (typeof userRoleValues)[number];
export const userRoleSchema = z.enum(userRoleValues);

// ---------------------------------------------------------------------------
// users.status
// ---------------------------------------------------------------------------
export const userStatusValues = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof userStatusValues)[number];
export const userStatusSchema = z.enum(userStatusValues);

// ---------------------------------------------------------------------------
// media.kind
// ---------------------------------------------------------------------------
export const mediaKindValues = ['avatar', 'post_image'] as const;
export type MediaKind = (typeof mediaKindValues)[number];
export const mediaKindSchema = z.enum(mediaKindValues);

// ---------------------------------------------------------------------------
// media.content_type
// ---------------------------------------------------------------------------
export const mediaContentTypeValues = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MediaContentType = (typeof mediaContentTypeValues)[number];
export const mediaContentTypeSchema = z.enum(mediaContentTypeValues);

// ---------------------------------------------------------------------------
// email_tokens.purpose
// ---------------------------------------------------------------------------
export const emailTokenPurposeValues = ['verify_email', 'reset_password'] as const;
export type EmailTokenPurpose = (typeof emailTokenPurposeValues)[number];
export const emailTokenPurposeSchema = z.enum(emailTokenPurposeValues);

// ---------------------------------------------------------------------------
// email_outbox.status
// ---------------------------------------------------------------------------
export const emailOutboxStatusValues = ['queued', 'sent', 'failed_permanent'] as const;
export type EmailOutboxStatus = (typeof emailOutboxStatusValues)[number];
export const emailOutboxStatusSchema = z.enum(emailOutboxStatusValues);

// ---------------------------------------------------------------------------
// posts.kind
// ---------------------------------------------------------------------------
export const postKindValues = ['original', 'reshare'] as const;
export type PostKind = (typeof postKindValues)[number];
export const postKindSchema = z.enum(postKindValues);

// ---------------------------------------------------------------------------
// posts.status
// ---------------------------------------------------------------------------
export const postStatusValues = ['published', 'held', 'deleted'] as const;
export type PostStatus = (typeof postStatusValues)[number];
export const postStatusSchema = z.enum(postStatusValues);

// ---------------------------------------------------------------------------
// posts.author_tier_at_post  /  derived tier
// ---------------------------------------------------------------------------
export const tierValues = ['trusted', 'neutral', 'low'] as const;
export type Tier = (typeof tierValues)[number];
export const tierSchema = z.enum(tierValues);

// ---------------------------------------------------------------------------
// detection_results.status
// ---------------------------------------------------------------------------
export const detectionStatusValues = [
  'queued',
  'running',
  'ok',
  'failed',
  'failed_permanent',
] as const;
export type DetectionStatus = (typeof detectionStatusValues)[number];
export const detectionStatusSchema = z.enum(detectionStatusValues);

// ---------------------------------------------------------------------------
// detection_results.band
// ---------------------------------------------------------------------------
export const detectionBandValues = ['likely_fake', 'uncertain', 'likely_real'] as const;
export type DetectionBand = (typeof detectionBandValues)[number];
export const detectionBandSchema = z.enum(detectionBandValues);

// ---------------------------------------------------------------------------
// waves.status
// ---------------------------------------------------------------------------
export const waveStatusValues = ['open', 'finalized'] as const;
export type WaveStatus = (typeof waveStatusValues)[number];
export const waveStatusSchema = z.enum(waveStatusValues);

// ---------------------------------------------------------------------------
// reports.reason
// ---------------------------------------------------------------------------
export const reportReasonValues = [
  'false_information',
  'misleading',
  'spam',
  'harassment',
  'other',
] as const;
export type ReportReason = (typeof reportReasonValues)[number];
export const reportReasonSchema = z.enum(reportReasonValues);

// ---------------------------------------------------------------------------
// reports.status
// ---------------------------------------------------------------------------
export const reportStatusValues = ['open', 'resolved'] as const;
export type ReportStatus = (typeof reportStatusValues)[number];
export const reportStatusSchema = z.enum(reportStatusValues);

// ---------------------------------------------------------------------------
// assessments.verdict
// ---------------------------------------------------------------------------
export const assessmentVerdictValues = ['real', 'fake', 'unverifiable'] as const;
export type AssessmentVerdict = (typeof assessmentVerdictValues)[number];
export const assessmentVerdictSchema = z.enum(assessmentVerdictValues);

// ---------------------------------------------------------------------------
// assessments.source
// ---------------------------------------------------------------------------
export const assessmentSourceValues = ['admin', 'auto_real'] as const;
export type AssessmentSource = (typeof assessmentSourceValues)[number];
export const assessmentSourceSchema = z.enum(assessmentSourceValues);

// ---------------------------------------------------------------------------
// reputation_events.kind
// ---------------------------------------------------------------------------
export const reputationEventKindValues = [
  'RESPONSIBLE_POST',
  'VALID_REPORT',
  'MISINFO_POST',
  'MISINFO_RESHARE',
  'REVERSAL',
] as const;
export type ReputationEventKind = (typeof reputationEventKindValues)[number];
export const reputationEventKindSchema = z.enum(reputationEventKindValues);

// ---------------------------------------------------------------------------
// reputation_events.status
// ---------------------------------------------------------------------------
export const reputationEventStatusValues = ['eligible', 'held', 'voided', 'counted'] as const;
export type ReputationEventStatus = (typeof reputationEventStatusValues)[number];
export const reputationEventStatusSchema = z.enum(reputationEventStatusValues);

// ---------------------------------------------------------------------------
// appeals.status
// ---------------------------------------------------------------------------
export const appealStatusValues = ['open', 'upheld', 'overturned'] as const;
export type AppealStatus = (typeof appealStatusValues)[number];
export const appealStatusSchema = z.enum(appealStatusValues);

// ---------------------------------------------------------------------------
// admin_audit_log.actor_kind
// ---------------------------------------------------------------------------
export const auditActorKindValues = ['admin', 'system'] as const;
export type AuditActorKind = (typeof auditActorKindValues)[number];
export const auditActorKindSchema = z.enum(auditActorKindValues);

// ---------------------------------------------------------------------------
// notifications.type
// ---------------------------------------------------------------------------
export const notificationTypeValues = [
  'post_flagged',
  'assessment_decided',
  'appeal_opened',
  'appeal_resolved',
  'report_resolved',
  'wave_finalized',
  'new_follower',
  'like',
  'comment',
  'reshare',
  'message',
] as const;
export type NotificationType = (typeof notificationTypeValues)[number];
export const notificationTypeSchema = z.enum(notificationTypeValues);

// ---------------------------------------------------------------------------
// post_public_status_v — derived labels (not a DB CHECK, but used in API)
// ---------------------------------------------------------------------------
export const postLabelValues = [
  'fact_checked_false',
  'fact_checked_true',
  'none',
  'unverifiable',
  'auto_flagged',
] as const;
export type PostLabel = (typeof postLabelValues)[number];
export const postLabelSchema = z.enum(postLabelValues);

// ---------------------------------------------------------------------------
// PUBLIC_SCORE_VISIBILITY config value
// ---------------------------------------------------------------------------
export const scoreVisibilityValues = ['tier_only', 'full'] as const;
export type ScoreVisibility = (typeof scoreVisibilityValues)[number];
export const scoreVisibilitySchema = z.enum(scoreVisibilityValues);
