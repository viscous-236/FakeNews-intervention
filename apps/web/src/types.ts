/**
 * Domain types matching the OpenAPI 3.1 specification (TASK-077).
 */

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type Tier = 'trusted' | 'neutral' | 'low';
export type PostKind = 'original' | 'reshare';
export type PostStatus = 'published' | 'held' | 'deleted';
export type PostLabel =
  | 'fact_checked_false'
  | 'fact_checked_true'
  | 'none'
  | 'unverifiable'
  | 'auto_flagged';
export type DetectionStatus = 'queued' | 'running' | 'ok' | 'failed' | 'failed_permanent';
export type DetectionBand = 'likely_fake' | 'uncertain' | 'likely_real';
export type ReportReason =
  | 'false_information'
  | 'misleading'
  | 'spam'
  | 'harassment'
  | 'other';
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
export type VoidReason =
  | 'cap_exceeded'
  | 'assessment_superseded'
  | 'interaction_retracted';
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
  emailVerified: boolean;
  score: {
    q: string;
    sigma: string;
    tier: Tier;
  };
  createdAt: string;
}

export interface UserProfile extends UserSummary {
  bio: string;
  role: UserRole;
  status: UserStatus;
  emailVerified?: boolean;
  score?: {
    q?: string;
    sigma?: string;
    tier: Tier;
  };
  counts: {
    followers: number;
    following: number;
    posts: number;
  };
  viewer: {
    following: boolean;
    blocked: boolean;
  };
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
  counts: {
    likes: number;
    comments: number;
    reshares: number;
  };
  viewer: {
    liked: boolean;
    reshared: boolean;
  };
  reshareOf: Post | null;
  authorView?: {
    detection?: {
      status: DetectionStatus;
      band: DetectionBand | null;
    };
    events?: Array<{
      kind: ReputationEventKind;
      value: number;
      status: ReputationEventStatus;
    }>;
  };
  adminView?: {
    detection?: {
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
  finalizedAt: string;
}

export interface EventItem {
  id: string;
  kind: ReputationEventKind;
  value: number;
  status: ReputationEventStatus;
  waveNumber: number | null;
  voidReason: VoidReason | null;
  post: {
    id: string;
    excerpt: string;
  };
  assessment: {
    verdict: AssessmentVerdict;
    source: AssessmentSource;
    rationale: string;
    createdAt: string;
  } | null;
  reversesEventId: string | null;
  appeal: {
    id: string;
    status: AppealStatus;
  } | null;
  createdAt: string;
}

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
    };
  };
  thresholds: {
    trustedMin: string;
    lowMax: string;
  };
}

export interface AppealItem {
  id: string;
  eventId: string;
  userId: string;
  reason: string;
  status: AppealStatus;
  resolutionNote: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  resolvedAt: string | null;
  event?: EventItem;
  user?: UserSummary;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  read: boolean;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  sender?: UserSummary;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface ConversationItem {
  id: string;
  peer: UserSummary;
  lastMessage: MessageItem | null;
  unreadCount: number;
  updatedAt: string;
}

export interface ReviewQueueItem {
  postId: string;
  post: Post;
  priority: number;
  reportCount: number;
  detectionBand: DetectionBand | null;
  pFake: string | null;
}

export interface WaveItem {
  number: number;
  status: 'open' | 'finalized';
  openedAt: string;
  finalizedAt: string | null;
  stats?: {
    participants: number;
    eventsCount: number;
  };
}

export interface AdminOverviewStats {
  totalUsers: number;
  totalPosts: number;
  totalWaves: number;
  openReports: number;
  openAppeals: number;
  pendingQueue: number;
  detector: {
    healthy: boolean;
    modelName: string;
    modelVersion: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}
