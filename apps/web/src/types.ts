/**
 * Domain types. Every shape here mirrors what the API actually serializes
 * (plan Section 1.7 "Shared shapes" and the admin/analytics endpoints).
 * Decimals arrive as strings and are never computed on in the client.
 */

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type Tier = 'trusted' | 'neutral' | 'low';
export type PostKind = 'original' | 'reshare';
export type PostStatus = 'published' | 'held' | 'deleted';
export type PostLabel =
  'fact_checked_false' | 'fact_checked_true' | 'none' | 'unverifiable' | 'auto_flagged';
export type DetectionStatus = 'queued' | 'running' | 'ok' | 'failed' | 'failed_permanent';
export type DetectionBand = 'likely_fake' | 'uncertain' | 'likely_real';
export type ReportReason = 'false_information' | 'misleading' | 'spam' | 'harassment' | 'other';
export type ReportStatus = 'open' | 'resolved';
export type AssessmentVerdict = 'real' | 'fake' | 'unverifiable';
export type AssessmentSource = 'admin' | 'auto_real';
export type ReputationEventKind =
  | 'RESPONSIBLE_POST'
  | 'RESPONSIBLE_RESHARE'
  | 'VALID_REPORT'
  | 'MISINFO_POST'
  | 'MISINFO_RESHARE'
  | 'MISINFO_LIKE'
  | 'REVERSAL';
export type ReputationEventStatus = 'eligible' | 'held' | 'voided' | 'counted';
export type VoidReason = 'cap_exceeded' | 'assessment_superseded' | 'interaction_retracted';
export type AppealStatus = 'open' | 'upheld' | 'overturned';
export type NotificationType =
  | 'post_flagged'
  | 'assessment_decided'
  | 'appeal_opened'
  | 'appeal_resolved'
  | 'report_resolved'
  | 'wave_finalized'
  | 'new_follower'
  | 'like'
  | 'comment'
  | 'reshare'
  | 'message';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  tier: Tier;
}

export interface Me {
  id: string;
  username: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  score: { q: string; sigma: string; tier: Tier };
  createdAt: string;
}

/** GET /users/:username */
export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  tier: Tier;
  q?: string;
  counts: { posts: number; followers: number; following: number };
  viewer: { following: boolean; blocked: boolean };
  createdAt: string;
}

export interface PostImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface Post {
  id: string;
  kind: PostKind;
  author: UserSummary;
  body: string;
  sourceUrl: string | null;
  images: PostImage[];
  status: PostStatus;
  createdAt: string;
  editedAt: string | null;
  label: PostLabel;
  underAppeal: boolean;
  requiresShareConfirmation: boolean;
  counts: { likes: number; comments: number; reshares: number };
  viewer: { liked: boolean; reshared: boolean };
  reshareOf: Post | null;
  authorView?: {
    detection: { status: DetectionStatus; band: DetectionBand | null };
    events: Array<{ kind: ReputationEventKind; value: number; status: ReputationEventStatus }>;
  };
  adminView?: {
    detection: {
      status: DetectionStatus;
      band: DetectionBand | null;
      pFake: string | null;
      modelName: string | null;
      modelVersion: string | null;
    };
  };
}

export interface Comment {
  id: string;
  postId: string;
  author: UserSummary;
  body: string;
  createdAt: string;
}

export interface LedgerRow {
  waveNumber: number;
  nPos: number;
  nNeg: number;
  nAdj: number;
  r: number;
  sigmaUsed: string;
  qBefore: string;
  delta: string;
  qAfter: string;
  formulaVersion: string;
  finalizedAt: string | null;
}

export interface EventItem {
  id: string;
  kind: ReputationEventKind;
  value: number;
  status: ReputationEventStatus;
  waveNumber: number | null;
  voidReason: VoidReason | null;
  post: { id: string; excerpt: string };
  assessment: {
    verdict: AssessmentVerdict;
    source: AssessmentSource;
    rationale: string;
    createdAt: string;
  } | null;
  reversesEventId: string | null;
  appeal: { id: string; status: AppealStatus } | null;
  createdAt: string;
}

/** GET /me/score */
export interface ScoreResponse {
  q: string;
  sigma: string;
  tier: Tier;
  currentWave: {
    number: number;
    openedAt: string;
    pending: {
      nPos: number;
      nNeg: number;
      nAdj: number;
      r: number;
      projectedDelta: string;
      projectedQ: string;
    };
  };
  thresholds: { trustedMin: string; lowMax: string };
}

/** GET /me/appeals */
export interface AppealItem {
  id: string;
  status: AppealStatus;
  reason: string;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** GET /admin/appeals */
export interface AdminAppealItem extends AppealItem {
  eventId: string;
  assessmentId: string;
  appellantId: string;
  newAssessmentId: string | null;
  appellant: UserSummary | null;
  event: {
    kind: ReputationEventKind;
    value: number;
    status: ReputationEventStatus;
    post: { id: string; excerpt: string };
  } | null;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  actor: UserSummary | null;
  postId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface MessageItem {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface ConversationItem {
  user: UserSummary;
  lastMessage: MessageItem;
  unreadCount: number;
}

export interface SessionItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
}

/** GET /admin/queue */
export interface ReviewQueueItem {
  post: Post;
  priority: number;
  openReports: number;
  reshares: number;
  reasons: string[];
}

/** GET /admin/posts/:id */
export interface AdminPostDetail {
  post: Post;
  author: { id: string; username: string; q: string; sigma: string; tier: Tier };
  interactors: { resharers: number; likers: number; reporters: number };
  conflictOfInterest: boolean;
  detections: Array<{
    id: string;
    postRevision: number;
    status: DetectionStatus;
    attempts: number;
    band: DetectionBand | null;
    pFake: string | null;
    modelName: string | null;
    modelVersion: string | null;
    latencyMs: number | null;
    errorCode: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  reports: Array<{
    id: string;
    reporter: UserSummary;
    reason: ReportReason;
    details: string;
    status: ReportStatus;
    createdAt: string;
  }>;
  assessments: Array<{
    id: string;
    verdict: AssessmentVerdict;
    source: AssessmentSource;
    decidedBy: string | null;
    rationale: string;
    isCurrent: boolean;
    supersedesId: string | null;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    userId: string;
    username: string;
    kind: ReputationEventKind;
    value: number;
    status: ReputationEventStatus;
    voidReason: VoidReason | null;
    createdAt: string;
  }>;
  appeals: Array<{
    id: string;
    eventId: string;
    appellantId: string;
    status: AppealStatus;
    reason: string;
    resolutionNote: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

/** GET /admin/waves */
export interface WaveItem {
  id: string;
  number: number;
  status: 'open' | 'finalized';
  formulaVersion: string;
  openedAt: string;
  finalizedAt: string | null;
  finalizedBySystem: boolean;
  usersScored?: number;
  eventsCounted?: number;
  pendingEvents?: number;
  heldEvents?: number;
}

export interface AdminLedgerRow extends LedgerRow {
  user: UserSummary;
}

/** GET /admin/users */
export interface AdminUserItem {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  sigma: string;
  q: string;
  tier: Tier;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** GET /admin/users/:id */
export interface AdminUserDetail {
  user: AdminUserItem;
  counts: { posts: number; followers: number; following: number };
  posts: Array<{ id: string; kind: PostKind; status: PostStatus; createdAt: string }>;
  events: Array<{
    id: string;
    postId: string;
    kind: ReputationEventKind;
    value: number;
    status: ReputationEventStatus;
    voidReason: VoidReason | null;
    createdAt: string;
  }>;
  appeals: Array<{
    id: string;
    eventId: string;
    status: AppealStatus;
    reason: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  ledger: LedgerRow[];
}

/** GET /admin/audit */
export interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorKind: 'admin' | 'system';
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

/** GET /admin/analytics/overview */
export interface AdminOverview {
  users: number;
  posts: number;
  waves: number;
  openQueue: number;
  openAppeals: number;
  detectionStatusCounts: Record<DetectionStatus, number>;
}

/** GET /admin/analytics/detector */
export interface DetectorAnalytics {
  countsByBand: Record<DetectionBand, number>;
  failureRate: number;
  avgLatencyMs: number;
  agreement: {
    adminFakeVsBandLikelyFake: number;
    adminFakeVsBandUncertain: number;
    adminFakeVsBandLikelyReal: number;
    adminRealVsBandLikelyReal: number;
    adminRealVsBandUncertain: number;
    adminRealVsBandLikelyFake: number;
  };
}

/** GET /admin/analytics/waves */
export interface WaveAnalyticsRow {
  number: number;
  usersScored: number;
  nPos: number;
  nNeg: number;
  nAdj: number;
  sumDelta: string;
}

/** GET /admin/analytics/spread */
export interface SpreadRow {
  waveNumber: number;
  authorTier: Tier;
  reshares: { before: number; after: number };
  likes: { before: number; after: number };
}

/** GET /admin/detector/status */
export interface DetectorStatus {
  health: { status: string; model_loaded?: boolean } | null;
  modelInfo: {
    model_name: string;
    model_version: string;
    trained_at?: string;
    dataset?: string;
    metrics?: Record<string, number>;
    recommended_thresholds?: { fake_high: number; real_low: number };
  } | null;
}

/** POST /admin/verify-scores */
export interface VerifyResult {
  ok: boolean;
  issues: Array<{
    invariant: string;
    userId: string;
    waveId?: string;
    waveNumber?: number;
    expected: string;
    actual: string;
    message?: string;
  }>;
}
