/**
 * scripts/generate-openapi.ts (TASK-075, REQ-034)
 *
 * Generates the complete OpenAPI 3.1 contract from Zod schemas and API specification.
 * Output path: docs/openapi.yaml
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import yaml from 'js-yaml';
import {
  userRoleValues,
  userStatusValues,
  mediaKindValues,
  mediaContentTypeValues,
  postKindValues,
  postStatusValues,
  tierValues,
  detectionStatusValues,
  detectionBandValues,
  reportReasonValues,
  reportStatusValues,
  assessmentVerdictValues,
  assessmentSourceValues,
  reputationEventKindValues,
  reputationEventStatusValues,
  voidReasonValues,
  appealStatusValues,
  auditActorKindValues,
  notificationTypeValues,
  postLabelValues,
  scoreVisibilityValues,
} from '../packages/shared/src/enums.js';

function buildOpenApiDoc() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FakeNews Intervention Platform API',
      description:
        'Official OpenAPI 3.1.0 specification for the FakeNews intervention and reputation platform (Updated for v2.0 Reputation Policy).',
      version: '2.0.0',
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Base API v1 endpoint',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication, registration, sessions, email tokens' },
      { name: 'Users', description: 'User profile management, following, blocking, account deletion' },
      { name: 'Posts', description: 'Post publication, revision editing, deletion, and feed presentation' },
      { name: 'Feed', description: 'Global public feed and following feed with keyset pagination' },
      { name: 'Social', description: 'Likes (with retraction hooks), comments, search, and suggestions' },
      { name: 'Governance', description: 'User reports, admin assessments, and event appeals' },
      { name: 'Score', description: 'Reputation score, ledger history, wave projections, and verification' },
      { name: 'Notifications', description: 'Notification polling and real-time Server-Sent Events (SSE)' },
      { name: 'Messages', description: 'One-to-one direct messages via REST and WebSocket' },
      { name: 'Media', description: 'Image attachment and avatar uploads via S3 storage' },
      { name: 'Admin', description: 'Review queue, assessments, wave management, analytics, and CSV exports' },
      { name: 'System', description: 'System health, readiness, and observability metrics' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'sid',
          description: 'HTTP-only session cookie',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Bearer token for system endpoints (e.g. Prometheus metrics)',
        },
      },
      schemas: {
        // Shared Enums
        UserRole: { type: 'string', enum: userRoleValues },
        UserStatus: { type: 'string', enum: userStatusValues },
        MediaKind: { type: 'string', enum: mediaKindValues },
        MediaContentType: { type: 'string', enum: mediaContentTypeValues },
        PostKind: { type: 'string', enum: postKindValues },
        PostStatus: { type: 'string', enum: postStatusValues },
        Tier: { type: 'string', enum: tierValues },
        DetectionStatus: { type: 'string', enum: detectionStatusValues },
        DetectionBand: { type: 'string', enum: detectionBandValues },
        ReportReason: { type: 'string', enum: reportReasonValues },
        ReportStatus: { type: 'string', enum: reportStatusValues },
        AssessmentVerdict: { type: 'string', enum: assessmentVerdictValues },
        AssessmentSource: { type: 'string', enum: assessmentSourceValues },
        ReputationEventKind: { type: 'string', enum: reputationEventKindValues },
        ReputationEventStatus: { type: 'string', enum: reputationEventStatusValues },
        VoidReason: { type: 'string', enum: voidReasonValues },
        AppealStatus: { type: 'string', enum: appealStatusValues },
        AuditActorKind: { type: 'string', enum: auditActorKindValues },
        NotificationType: { type: 'string', enum: notificationTypeValues },
        PostLabel: { type: 'string', enum: postLabelValues },
        ScoreVisibility: { type: 'string', enum: scoreVisibilityValues },

        // Error Envelope
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId'],
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Validation failed' },
                details: { type: 'object', additionalProperties: true },
                requestId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },

        // Models
        UserSummary: {
          type: 'object',
          required: ['id', 'username', 'displayName', 'avatarUrl', 'tier'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            displayName: { type: 'string' },
            avatarUrl: { type: ['string', 'null'] },
            tier: { $ref: '#/components/schemas/Tier' },
          },
        },
        Me: {
          type: 'object',
          required: ['id', 'username', 'email', 'displayName', 'bio', 'avatarUrl', 'role', 'status', 'emailVerified', 'score', 'createdAt'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            bio: { type: 'string' },
            avatarUrl: { type: ['string', 'null'] },
            role: { $ref: '#/components/schemas/UserRole' },
            status: { $ref: '#/components/schemas/UserStatus' },
            emailVerified: { type: 'boolean' },
            score: {
              type: 'object',
              required: ['q', 'sigma', 'tier'],
              properties: {
                q: { type: 'string', description: 'Numeric decimal string' },
                sigma: { type: 'string', description: 'Numeric decimal string' },
                tier: { $ref: '#/components/schemas/Tier' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Post: {
          type: 'object',
          required: ['id', 'kind', 'author', 'body', 'sourceUrl', 'images', 'status', 'createdAt', 'editedAt', 'label', 'underAppeal', 'requiresShareConfirmation', 'counts', 'viewer', 'reshareOf'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            kind: { $ref: '#/components/schemas/PostKind' },
            author: { $ref: '#/components/schemas/UserSummary' },
            body: { type: 'string' },
            sourceUrl: { type: ['string', 'null'] },
            images: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'url', 'width', 'height'],
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                },
              },
            },
            status: { $ref: '#/components/schemas/PostStatus' },
            createdAt: { type: 'string', format: 'date-time' },
            editedAt: { type: ['string', 'null'], format: 'date-time' },
            label: { $ref: '#/components/schemas/PostLabel' },
            underAppeal: { type: 'boolean' },
            requiresShareConfirmation: { type: 'boolean' },
            counts: {
              type: 'object',
              required: ['likes', 'comments', 'reshares'],
              properties: {
                likes: { type: 'integer' },
                comments: { type: 'integer' },
                reshares: { type: 'integer' },
              },
            },
            viewer: {
              type: 'object',
              required: ['liked', 'reshared'],
              properties: {
                liked: { type: 'boolean' },
                reshared: { type: 'boolean' },
              },
            },
            reshareOf: {
              oneOf: [{ $ref: '#/components/schemas/Post' }, { type: 'null' }],
            },
            authorView: {
              type: 'object',
              properties: {
                detection: {
                  type: 'object',
                  properties: {
                    status: { $ref: '#/components/schemas/DetectionStatus' },
                    band: { oneOf: [{ $ref: '#/components/schemas/DetectionBand' }, { type: 'null' }] },
                  },
                },
                events: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      kind: { $ref: '#/components/schemas/ReputationEventKind' },
                      value: { type: 'integer', enum: [-1, 1] },
                      status: { $ref: '#/components/schemas/ReputationEventStatus' },
                    },
                  },
                },
              },
            },
          },
        },
        Comment: {
          type: 'object',
          required: ['id', 'postId', 'author', 'body', 'createdAt'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            postId: { type: 'string', format: 'uuid' },
            author: { $ref: '#/components/schemas/UserSummary' },
            body: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        LedgerRow: {
          type: 'object',
          required: ['waveNumber', 'nPos', 'nNeg', 'nAdj', 'r', 'sigmaUsed', 'qBefore', 'delta', 'qAfter', 'formulaVersion', 'finalizedAt'],
          properties: {
            waveNumber: { type: 'integer' },
            nPos: { type: 'integer' },
            nNeg: { type: 'integer' },
            nAdj: { type: 'integer' },
            r: { type: 'integer' },
            sigmaUsed: { type: 'string' },
            qBefore: { type: 'string' },
            delta: { type: 'string' },
            qAfter: { type: 'string' },
            formulaVersion: { type: 'string' },
            finalizedAt: { type: 'string', format: 'date-time' },
          },
        },
        EventItem: {
          type: 'object',
          required: ['id', 'kind', 'value', 'status', 'waveNumber', 'voidReason', 'post', 'assessment', 'reversesEventId', 'appeal', 'createdAt'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            kind: { $ref: '#/components/schemas/ReputationEventKind' },
            value: { type: 'integer', enum: [-1, 1] },
            status: { $ref: '#/components/schemas/ReputationEventStatus' },
            waveNumber: { type: ['integer', 'null'] },
            voidReason: { oneOf: [{ $ref: '#/components/schemas/VoidReason' }, { type: 'null' }] },
            post: {
              type: 'object',
              required: ['id', 'excerpt'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                excerpt: { type: 'string' },
              },
            },
            assessment: {
              type: ['object', 'null'],
              properties: {
                verdict: { $ref: '#/components/schemas/AssessmentVerdict' },
                source: { $ref: '#/components/schemas/AssessmentSource' },
                rationale: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
            reversesEventId: { type: ['string', 'null'], format: 'uuid' },
            appeal: {
              type: ['object', 'null'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                status: { $ref: '#/components/schemas/AppealStatus' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Request Schemas
        RegisterInput: {
          type: 'object',
          required: ['username', 'email', 'password', 'displayName'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 20, pattern: '^[a-z0-9_]{3,20}$' },
            email: { type: 'string', format: 'email', maxLength: 255 },
            password: { type: 'string', minLength: 10, maxLength: 128 },
            displayName: { type: 'string', minLength: 1, maxLength: 50 },
          },
        },
        LoginInput: {
          type: 'object',
          required: ['identifier', 'password'],
          properties: {
            identifier: { type: 'string', minLength: 1, maxLength: 128 },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        VerifyEmailInput: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 1 },
          },
        },
        ForgotPasswordInput: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 255 },
          },
        },
        ResetPasswordInput: {
          type: 'object',
          required: ['token', 'password'],
          properties: {
            token: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 10, maxLength: 128 },
          },
        },
        ChangePasswordInput: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', minLength: 1 },
            newPassword: { type: 'string', minLength: 10, maxLength: 128 },
          },
        },
        UpdateMeInput: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 50 },
            bio: { type: 'string', maxLength: 300 },
            avatarMediaId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
        DeleteMeInput: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', minLength: 1 },
          },
        },
        CreatePostInput: {
          type: 'object',
          required: ['body'],
          properties: {
            body: { type: 'string', minLength: 20, maxLength: 500 },
            sourceUrl: { type: 'string', format: 'uri', maxLength: 2048 },
            mediaIds: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
              maxItems: 4,
            },
          },
        },
        EditPostInput: {
          type: 'object',
          properties: {
            body: { type: 'string', minLength: 20, maxLength: 500 },
            sourceUrl: { type: ['string', 'null'], format: 'uri', maxLength: 2048 },
          },
        },
        ReshareInput: {
          type: 'object',
          properties: {
            comment: { type: 'string', maxLength: 500 },
            acknowledgedWarning: { type: 'boolean', default: false },
          },
        },
        CommentInput: {
          type: 'object',
          required: ['body'],
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 300 },
          },
        },
        ReportInput: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { $ref: '#/components/schemas/ReportReason' },
            details: { type: 'string', maxLength: 500 },
          },
        },
        AssessmentInput: {
          type: 'object',
          required: ['verdict', 'rationale'],
          properties: {
            verdict: { $ref: '#/components/schemas/AssessmentVerdict' },
            rationale: { type: 'string', minLength: 10, maxLength: 2000 },
            detectionResultId: { type: 'string', format: 'uuid' },
          },
        },
        AppealInput: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string', minLength: 20, maxLength: 1000 },
          },
        },
        ResolveAppealInput: {
          type: 'object',
          required: ['decision', 'note'],
          properties: {
            decision: { type: 'string', enum: ['upheld', 'overturned'] },
            note: { type: 'string', minLength: 10, maxLength: 1000 },
            newVerdict: { type: 'string', enum: ['real', 'unverifiable'] },
            rationale: { type: 'string', minLength: 10, maxLength: 2000 },
          },
        },
        MessageInput: {
          type: 'object',
          required: ['body'],
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 1000 },
          },
        },
        ReadNotificationsInput: {
          type: 'object',
          properties: {
            ids: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        SuspendUserInput: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string', minLength: 5, maxLength: 1000 },
          },
        },

        // Analytics models
        OverviewAnalytics: {
          type: 'object',
          required: ['users', 'posts', 'waves', 'openQueue', 'openAppeals', 'detectionStatusCounts'],
          properties: {
            users: { type: 'integer' },
            posts: { type: 'integer' },
            waves: { type: 'integer' },
            openQueue: { type: 'integer' },
            openAppeals: { type: 'integer' },
            detectionStatusCounts: {
              type: 'object',
              required: ['queued', 'running', 'ok', 'failed', 'failed_permanent'],
              properties: {
                queued: { type: 'integer' },
                running: { type: 'integer' },
                ok: { type: 'integer' },
                failed: { type: 'integer' },
                failed_permanent: { type: 'integer' },
              },
            },
          },
        },
        DetectorAnalytics: {
          type: 'object',
          required: ['countsByBand', 'failureRate', 'avgLatencyMs', 'agreement'],
          properties: {
            countsByBand: {
              type: 'object',
              required: ['likely_real', 'uncertain', 'likely_fake'],
              properties: {
                likely_real: { type: 'integer' },
                uncertain: { type: 'integer' },
                likely_fake: { type: 'integer' },
              },
            },
            failureRate: { type: 'number' },
            avgLatencyMs: { type: 'number' },
            agreement: {
              type: 'object',
              required: [
                'adminFakeVsBandLikelyFake',
                'adminFakeVsBandUncertain',
                'adminFakeVsBandLikelyReal',
                'adminRealVsBandLikelyReal',
                'adminRealVsBandUncertain',
                'adminRealVsBandLikelyFake',
              ],
              properties: {
                adminFakeVsBandLikelyFake: { type: 'integer' },
                adminFakeVsBandUncertain: { type: 'integer' },
                adminFakeVsBandLikelyReal: { type: 'integer' },
                adminRealVsBandLikelyReal: { type: 'integer' },
                adminRealVsBandUncertain: { type: 'integer' },
                adminRealVsBandLikelyFake: { type: 'integer' },
              },
            },
          },
        },
        WaveAnalyticsRow: {
          type: 'object',
          required: ['number', 'usersScored', 'nPos', 'nNeg', 'nAdj', 'sumDelta'],
          properties: {
            number: { type: 'integer' },
            usersScored: { type: 'integer' },
            nPos: { type: 'integer' },
            nNeg: { type: 'integer' },
            nAdj: { type: 'integer' },
            sumDelta: { type: 'string' },
          },
        },
        SpreadRow: {
          type: 'object',
          required: ['waveNumber', 'authorTier', 'reshares', 'likes'],
          properties: {
            waveNumber: { type: 'integer' },
            authorTier: { $ref: '#/components/schemas/Tier' },
            reshares: {
              type: 'object',
              required: ['before', 'after'],
              properties: {
                before: { type: 'integer' },
                after: { type: 'integer' },
              },
            },
            likes: {
              type: 'object',
              required: ['before', 'after'],
              properties: {
                before: { type: 'integer' },
                after: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    paths: {
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user account',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterInput' } } },
          },
          responses: {
            '201': {
              description: 'Account created and session initialized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['user'],
                    properties: { user: { $ref: '#/components/schemas/Me' } },
                  },
                },
              },
            },
            '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
            '409': { description: 'Username or email taken', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Sign in to account',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } },
          },
          responses: {
            '200': {
              description: 'Authenticated session initialized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['user'],
                    properties: { user: { $ref: '#/components/schemas/Me' } },
                  },
                },
              },
            },
            '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
            '429': { description: 'Rate limit / lockout exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'End current session',
          security: [{ cookieAuth: [] }],
          responses: {
            '204': { description: 'Session ended' },
            '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user identity and score summary',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Current user profile',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['user'],
                    properties: { user: { $ref: '#/components/schemas/Me' } },
                  },
                },
              },
            },
            '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          },
        },
      },
      '/auth/verify-email': {
        post: {
          tags: ['Auth'],
          summary: 'Verify email address with verification token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VerifyEmailInput' } } },
          },
          responses: {
            '204': { description: 'Email verified' },
            '400': { description: 'Invalid or expired token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          },
        },
      },
      '/auth/resend-verification': {
        post: {
          tags: ['Auth'],
          summary: 'Resend verification email',
          security: [{ cookieAuth: [] }],
          responses: {
            '204': { description: 'Verification email queued' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request password reset token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ForgotPasswordInput' } } },
          },
          responses: {
            '204': { description: 'Password reset email queued if email exists' },
          },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Reset password with token and revoke existing sessions',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordInput' } } },
          },
          responses: {
            '204': { description: 'Password reset' },
            '400': { description: 'Invalid or expired token' },
          },
        },
      },
      '/auth/change-password': {
        post: {
          tags: ['Auth'],
          summary: 'Change password while authenticated',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordInput' } } },
          },
          responses: {
            '204': { description: 'Password changed; other sessions invalidated' },
            '401': { description: 'Current password invalid' },
          },
        },
      },
      '/auth/sessions': {
        get: {
          tags: ['Auth'],
          summary: 'List active sessions for current user',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Active sessions',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'createdAt', 'expiresAt', 'current'],
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            createdAt: { type: 'string', format: 'date-time' },
                            expiresAt: { type: 'string', format: 'date-time' },
                            current: { type: 'boolean' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/auth/sessions/{id}': {
        delete: {
          tags: ['Auth'],
          summary: 'Revoke an active session',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '204': { description: 'Session revoked' },
            '404': { description: 'Session not found' },
          },
        },
      },
      '/users/{username}': {
        get: {
          tags: ['Users'],
          summary: 'Get public user profile',
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Public profile with score visibility rules applied',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'username', 'displayName', 'bio', 'avatarUrl', 'tier', 'counts', 'viewer', 'createdAt'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      username: { type: 'string' },
                      displayName: { type: 'string' },
                      bio: { type: 'string' },
                      avatarUrl: { type: ['string', 'null'] },
                      tier: { $ref: '#/components/schemas/Tier' },
                      q: { type: 'string', description: 'Present only if public score visibility allows' },
                      counts: {
                        type: 'object',
                        required: ['posts', 'followers', 'following'],
                        properties: {
                          posts: { type: 'integer' },
                          followers: { type: 'integer' },
                          following: { type: 'integer' },
                        },
                      },
                      viewer: {
                        type: 'object',
                        required: ['following', 'blocked'],
                        properties: {
                          following: { type: 'boolean' },
                          blocked: { type: 'boolean' },
                        },
                      },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            '404': { description: 'User not found or blocked' },
          },
        },
      },
      '/users/me': {
        patch: {
          tags: ['Users'],
          summary: 'Update current user profile',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateMeInput' } } },
          },
          responses: {
            '200': {
              description: 'Updated user profile',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['user'],
                    properties: { user: { $ref: '#/components/schemas/Me' } },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Users'],
          summary: 'Delete user account with PII anonymization (RUL-022, SEC-014)',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteMeInput' } } },
          },
          responses: {
            '204': { description: 'Account deleted and anonymized' },
            '401': { description: 'Password incorrect' },
          },
        },
      },
      '/users/me/export': {
        get: {
          tags: ['Users'],
          summary: 'Full GDPR data export in JSON format (SEC-014)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Full profile, posts, comments, likes, follows, events, ledger, and notifications',
              content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
            },
          },
        },
      },
      '/users/{username}/posts': {
        get: {
          tags: ['Users'],
          summary: 'List user published posts with keyset pagination',
          parameters: [
            { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/{username}/followers': {
        get: {
          tags: ['Users'],
          summary: 'List user followers',
          parameters: [
            { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/{username}/following': {
        get: {
          tags: ['Users'],
          summary: 'List users followed by user',
          parameters: [
            { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/{username}/follow': {
        post: {
          tags: ['Users'],
          summary: 'Follow a user',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '204': { description: 'Followed' },
            '409': { description: 'Already following or self-follow' },
          },
        },
        delete: {
          tags: ['Users'],
          summary: 'Unfollow a user',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Unfollowed' } },
        },
      },
      '/users/{username}/block': {
        post: {
          tags: ['Users'],
          summary: 'Block a user',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'User blocked' } },
        },
        delete: {
          tags: ['Users'],
          summary: 'Unblock a user',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'User unblocked' } },
        },
      },
      '/users/me/blocks': {
        get: {
          tags: ['Users'],
          summary: 'List users blocked by current user',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/suggestions': {
        get: {
          tags: ['Users'],
          summary: 'Get follow suggestions (RUL-029 two-hop mutuals, tier-independent)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/search/posts': {
        get: {
          tags: ['Social'],
          summary: 'Full-text search posts (RUL-030)',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/search/users': {
        get: {
          tags: ['Social'],
          summary: 'Trigram username and display name search (RUL-030)',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/media': {
        post: {
          tags: ['Media'],
          summary: 'Upload media image (re-encoded to WebP, 5 MB limit)',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file', 'kind'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    kind: { $ref: '#/components/schemas/MediaKind' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'url', 'width', 'height'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      url: { type: 'string' },
                      width: { type: 'integer' },
                      height: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '413': { description: 'Payload too large (> 5 MB)' },
            '415': { description: 'Unsupported media type' },
          },
        },
      },
      '/posts': {
        post: {
          tags: ['Posts'],
          summary: 'Create an original post (queues automated detection)',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePostInput' } } },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Post' } } } },
            '400': { description: 'Validation error' },
          },
        },
      },
      '/posts/{id}': {
        get: {
          tags: ['Posts'],
          summary: 'Get post by id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Post' } } } },
            '404': { description: 'Post not found' },
          },
        },
        patch: {
          tags: ['Posts'],
          summary: 'Edit post within 15-minute edit window (RUL-017)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EditPostInput' } } },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Post' } } } },
            '409': { description: 'Edit window expired or assessment already decided' },
          },
        },
        delete: {
          tags: ['Posts'],
          summary: 'Soft-delete post (triggers retraction if reshare)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '204': { description: 'Post deleted' } },
        },
      },
      '/feed/global': {
        get: {
          tags: ['Feed'],
          summary: 'Global chronological feed (RUL-031)',
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/feed/following': {
        get: {
          tags: ['Feed'],
          summary: 'Followed users feed including own posts',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/posts/{id}/reshare': {
        post: {
          tags: ['Posts'],
          summary: 'Reshare a post (awards RESPONSIBLE_RESHARE or creates MISINFO_RESHARE, RUL-019)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ReshareInput' } } },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Post' } } } },
            '409': { description: 'CONFIRMATION_REQUIRED when sharing flagged/false post without confirmation' },
          },
        },
        delete: {
          tags: ['Posts'],
          summary: 'Retract reshare before wave finalization (DEC-005, RUL-007)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '204': { description: 'Reshare retracted' } },
        },
      },
      '/posts/{id}/like': {
        post: {
          tags: ['Social'],
          summary: 'Like a post (syncs MISINFO_LIKE if fake, RUL-032)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '204': { description: 'Liked' } },
        },
        delete: {
          tags: ['Social'],
          summary: 'Unlike a post (retracts MISINFO_LIKE before wave finalization, DEC-001, DEC-005)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '204': { description: 'Unliked' } },
        },
      },
      '/posts/{id}/comments': {
        get: {
          tags: ['Social'],
          summary: 'List comments on a post (oldest first)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Social'],
          summary: 'Add a comment (comments never generate scoring events, DEC-006)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CommentInput' } } },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Comment' } } } },
          },
        },
      },
      '/comments/{id}': {
        delete: {
          tags: ['Social'],
          summary: 'Delete comment',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '204': { description: 'Comment deleted' } },
        },
      },
      '/posts/{id}/report': {
        post: {
          tags: ['Governance'],
          summary: 'Report post to review queue (RUL-020)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportInput' } } },
          },
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: { id: { type: 'string', format: 'uuid' } },
                  },
                },
              },
            },
            '403': { description: 'Cannot report own post' },
            '409': { description: 'Duplicate active report on this post' },
          },
        },
      },
      '/me/score': {
        get: {
          tags: ['Score'],
          summary: 'Get reputation score details and pending wave projection across all 7 event kinds',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['q', 'sigma', 'tier', 'currentWave', 'thresholds'],
                    properties: {
                      q: { type: 'string' },
                      sigma: { type: 'string' },
                      tier: { $ref: '#/components/schemas/Tier' },
                      currentWave: {
                        type: 'object',
                        required: ['number', 'openedAt', 'pending'],
                        properties: {
                          number: { type: 'integer' },
                          openedAt: { type: 'string', format: 'date-time' },
                          pending: {
                            type: 'object',
                            required: ['nPos', 'nNeg', 'nAdj', 'r', 'projectedDelta'],
                            properties: {
                              nPos: { type: 'integer' },
                              nNeg: { type: 'integer' },
                              nAdj: { type: 'integer' },
                              r: { type: 'integer' },
                              projectedDelta: { type: 'string' },
                            },
                          },
                        },
                      },
                      thresholds: {
                        type: 'object',
                        required: ['trustedMin', 'lowMax'],
                        properties: {
                          trustedMin: { type: 'string' },
                          lowMax: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/me/score/history': {
        get: {
          tags: ['Score'],
          summary: 'List finalized reputation wave ledger rows',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/LedgerRow' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/me/score/history/{waveNumber}': {
        get: {
          tags: ['Score'],
          summary: 'Get wave ledger breakdown and contributing events',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'waveNumber', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['row', 'events'],
                    properties: {
                      row: { $ref: '#/components/schemas/LedgerRow' },
                      events: { type: 'array', items: { $ref: '#/components/schemas/EventItem' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/me/events': {
        get: {
          tags: ['Score'],
          summary: 'List user reputation events (including void reasons and statuses)',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/ReputationEventStatus' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/EventItem' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/events/{id}/appeal': {
        post: {
          tags: ['Governance'],
          summary: 'Open an appeal on a negative reputation event (RUL-016: MISINFO_POST, RESHARE, LIKE)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AppealInput' } } },
          },
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'status'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      status: { $ref: '#/components/schemas/AppealStatus' },
                    },
                  },
                },
              },
            },
            '409': { description: 'APPEAL_NOT_ALLOWED or duplicate appeal' },
          },
        },
      },
      '/me/appeals': {
        get: {
          tags: ['Governance'],
          summary: 'List appeals opened by caller',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'status', 'reason', 'resolutionNote', 'createdAt', 'resolvedAt'],
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            status: { $ref: '#/components/schemas/AppealStatus' },
                            reason: { type: 'string' },
                            resolutionNote: { type: ['string', 'null'] },
                            createdAt: { type: 'string', format: 'date-time' },
                            resolvedAt: { type: ['string', 'null'], format: 'date-time' },
                          },
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/{username}/score': {
        get: {
          tags: ['Score'],
          summary: 'Get public reputation score for user (RUL-023 score visibility)',
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['tier'],
                    properties: {
                      tier: { $ref: '#/components/schemas/Tier' },
                      q: { type: 'string', description: 'Available only if visibility allows' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/waves/current': {
        get: {
          tags: ['Score'],
          summary: 'Get currently active open reputation wave number',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['number', 'openedAt'],
                    properties: {
                      number: { type: 'integer' },
                      openedAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List user notifications',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'unread', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'type', 'actor', 'postId', 'payload', 'createdAt', 'readAt'],
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            type: { $ref: '#/components/schemas/NotificationType' },
                            actor: { oneOf: [{ $ref: '#/components/schemas/UserSummary' }, { type: 'null' }] },
                            postId: { type: ['string', 'null'], format: 'uuid' },
                            payload: { type: 'object', additionalProperties: true },
                            createdAt: { type: 'string', format: 'date-time' },
                            readAt: { type: ['string', 'null'], format: 'date-time' },
                          },
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/notifications/unread-count': {
        get: {
          tags: ['Notifications'],
          summary: 'Get count of unread notifications',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['count'],
                    properties: { count: { type: 'integer' } },
                  },
                },
              },
            },
          },
        },
      },
      '/notifications/read': {
        post: {
          tags: ['Notifications'],
          summary: 'Mark notifications as read',
          security: [{ cookieAuth: [] }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ReadNotificationsInput' } } },
          },
          responses: { '204': { description: 'Marked as read' } },
        },
      },
      '/notifications/stream': {
        get: {
          tags: ['Notifications'],
          summary: 'Server-Sent Events (SSE) notification stream with 25s heartbeat',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Event stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/messages/conversations': {
        get: {
          tags: ['Messages'],
          summary: 'List direct message conversation threads',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['user', 'lastMessage', 'unreadCount'],
                          properties: {
                            user: { $ref: '#/components/schemas/UserSummary' },
                            lastMessage: { type: 'object', additionalProperties: true },
                            unreadCount: { type: 'integer' },
                          },
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/messages/with/{username}': {
        get: {
          tags: ['Messages'],
          summary: 'Get message history with user',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'senderId', 'body', 'createdAt', 'readAt'],
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            senderId: { type: 'string', format: 'uuid' },
                            body: { type: 'string' },
                            createdAt: { type: 'string', format: 'date-time' },
                            readAt: { type: ['string', 'null'], format: 'date-time' },
                          },
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Messages'],
          summary: 'Send direct message (messages never affect scoring, DEC-006)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageInput' } } },
          },
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'body', 'createdAt'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      body: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            '404': { description: 'User not found or blocked' },
          },
        },
      },
      '/messages/with/{username}/read': {
        post: {
          tags: ['Messages'],
          summary: 'Mark conversation with user as read',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Messages marked read' } },
        },
      },
      '/admin/queue': {
        get: {
          tags: ['Admin'],
          summary: 'Get moderator review queue prioritized by reports, detection, and flags',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['post', 'priority', 'openReports', 'reshares', 'reasons'],
                          properties: {
                            post: { $ref: '#/components/schemas/Post' },
                            priority: { type: 'integer' },
                            openReports: { type: 'integer' },
                            reshares: { type: 'integer' },
                            reasons: { type: 'array', items: { type: 'string' } },
                          },
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/posts/{id}': {
        get: {
          tags: ['Admin'],
          summary: 'Full post inspection for admin assessment',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['post', 'author', 'detections', 'reports', 'assessments', 'events', 'appeals'],
                    properties: {
                      post: { $ref: '#/components/schemas/Post' },
                      author: {
                        type: 'object',
                        required: ['id', 'username', 'q', 'sigma', 'tier'],
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          username: { type: 'string' },
                          q: { type: 'string' },
                          sigma: { type: 'string' },
                          tier: { $ref: '#/components/schemas/Tier' },
                        },
                      },
                      detections: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      reports: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      assessments: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      events: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      appeals: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Admin'],
          summary: 'Admin deletion of infringing post with audit logging',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } } },
          },
          responses: { '204': { description: 'Post soft deleted' } },
        },
      },
      '/admin/posts/{id}/assessments': {
        post: {
          tags: ['Admin'],
          summary: 'Submit admin assessment verdict (creates reputation events, handles Good-Faith Windows and superseding)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssessmentInput' } } },
          },
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['assessment', 'eventsCreated', 'eventsVoided', 'reversalsCreated'],
                    properties: {
                      assessment: { type: 'object', additionalProperties: true },
                      eventsCreated: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['kind', 'count'],
                          properties: {
                            kind: { $ref: '#/components/schemas/ReputationEventKind' },
                            count: { type: 'integer' },
                          },
                        },
                      },
                      eventsVoided: { type: 'integer' },
                      reversalsCreated: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '403': { description: 'CONFLICT_OF_INTEREST (admin participated in post, reshare, report, or like)' },
            '409': { description: 'ALREADY_EXISTS (same admin verdict already current)' },
          },
        },
      },
      '/admin/posts/{id}/release': {
        post: {
          tags: ['Admin'],
          summary: 'Release held post (RUL-024 low tier held post release)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '204': { description: 'Post released' } },
        },
      },
      '/admin/posts/{id}/redetect': {
        post: {
          tags: ['Admin'],
          summary: 'Requeue post for automated detector classification',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '202': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['detectionId'],
                    properties: { detectionId: { type: 'string', format: 'uuid' } },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/detections/{id}/requeue': {
        post: {
          tags: ['Admin'],
          summary: 'Retry a permanently failed detection job',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '202': { description: 'Job requeued' } },
        },
      },
      '/admin/appeals': {
        get: {
          tags: ['Admin'],
          summary: 'List user appeals awaiting moderator resolution',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/AppealStatus' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/appeals/{id}/resolve': {
        post: {
          tags: ['Admin'],
          summary: 'Resolve appeal: uphold or overturn assessment',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResolveAppealInput' } } },
          },
          responses: {
            '200': { description: 'Appeal resolved' },
            '403': { description: 'CONFLICT_OF_INTEREST' },
          },
        },
      },
      '/admin/waves': {
        get: {
          tags: ['Admin'],
          summary: 'List reputation waves and status',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'number', 'status', 'openedAt', 'finalizedAt'],
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            number: { type: 'integer' },
                            status: { type: 'string', enum: ['open', 'finalized'] },
                            openedAt: { type: 'string', format: 'date-time' },
                            finalizedAt: { type: ['string', 'null'], format: 'date-time' },
                          },
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/waves/{id}/ledger': {
        get: {
          tags: ['Admin'],
          summary: 'View finalized wave ledger entries with username',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: {
                        type: 'array',
                        items: {
                          type: 'object',
                          allOf: [{ $ref: '#/components/schemas/LedgerRow' }, { properties: { username: { type: 'string' } } }],
                        },
                      },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/waves/{id}/finalize': {
        post: {
          tags: ['Admin'],
          summary: 'Manually finalize wave and calculate scores idempotently',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['alreadyFinalized', 'wave', 'usersScored', 'eventsCounted'],
                    properties: {
                      alreadyFinalized: { type: 'boolean' },
                      wave: { type: 'object', additionalProperties: true },
                      usersScored: { type: 'integer' },
                      eventsCounted: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/verify-scores': {
        post: {
          tags: ['Admin'],
          summary: 'Run scoring engine mathematical and invariant audit (I1 through I6)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'issues'],
                    properties: {
                      ok: { type: 'boolean' },
                      issues: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/users': {
        get: {
          tags: ['Admin'],
          summary: 'List users with administrative status, sigma, and q',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/UserStatus' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/Me' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/users/{id}': {
        get: {
          tags: ['Admin'],
          summary: 'Inspect user account details and complete wave score history',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['user', 'scoreHistory'],
                    properties: {
                      user: { $ref: '#/components/schemas/Me' },
                      scoreHistory: { type: 'array', items: { $ref: '#/components/schemas/LedgerRow' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/users/{id}/suspend': {
        post: {
          tags: ['Admin'],
          summary: 'Suspend user account with audit trail',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SuspendUserInput' } } },
          },
          responses: {
            '204': { description: 'User suspended' },
            '403': { description: 'Admins cannot suspend other admins' },
          },
        },
      },
      '/admin/users/{id}/unsuspend': {
        post: {
          tags: ['Admin'],
          summary: 'Restore suspended user account',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SuspendUserInput' } } },
          },
          responses: { '204': { description: 'User restored' } },
        },
      },
      '/admin/audit': {
        get: {
          tags: ['Admin'],
          summary: 'Query immutable administrator audit logs',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items', 'nextCursor'],
                    properties: {
                      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/analytics/overview': {
        get: {
          tags: ['Admin'],
          summary: 'Admin dashboard overview statistics (TASK-073)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OverviewAnalytics' },
                },
              },
            },
          },
        },
      },
      '/admin/analytics/detector': {
        get: {
          tags: ['Admin'],
          summary: 'Detector operational and classification analytics (TASK-073)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DetectorAnalytics' },
                },
              },
            },
          },
        },
      },
      '/admin/analytics/waves': {
        get: {
          tags: ['Admin'],
          summary: 'Per-wave scoring aggregation totals (TASK-073)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/WaveAnalyticsRow' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/analytics/spread': {
        get: {
          tags: ['Admin'],
          summary: 'Post reshare and like spread before and after label time by publisher tier (TASK-070)',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SpreadRow' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/admin/export/ledger.csv': {
        get: {
          tags: ['Admin'],
          summary: 'Export reputation ledger rows as RFC 4180 CSV (TASK-074)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'waveNumber', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'CSV document containing wave ledger records',
              content: { 'text/csv': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/admin/export/events.csv': {
        get: {
          tags: ['Admin'],
          summary: 'Export reputation events (including MISINFO_LIKE and void reasons) as RFC 4180 CSV (TASK-074)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'waveNumber', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'CSV document containing reputation events',
              content: { 'text/csv': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/admin/export/assessments.csv': {
        get: {
          tags: ['Admin'],
          summary: 'Export assessments as RFC 4180 CSV (TASK-074)',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'waveNumber', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'CSV document containing assessment records',
              content: { 'text/csv': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/admin/detector/status': {
        get: {
          tags: ['Admin'],
          summary: 'Get health and model metadata from detector service',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['health', 'modelInfo'],
                    properties: {
                      health: { type: 'object', additionalProperties: true },
                      modelInfo: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/healthz': {
        get: {
          tags: ['System'],
          summary: 'Service liveness probe',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status'],
                    properties: { status: { type: 'string', example: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      '/readyz': {
        get: {
          tags: ['System'],
          summary: 'Service readiness probe (checks DB, migrations, detector)',
          responses: {
            '200': {
              description: 'Service fully ready',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ready', 'db', 'detector'],
                    properties: {
                      ready: { type: 'boolean' },
                      db: { type: 'boolean' },
                      detector: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            '503': { description: 'One or more subsystem dependencies not ready' },
          },
        },
      },
      '/metrics': {
        get: {
          tags: ['System'],
          summary: 'Prometheus metrics endpoint',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Prometheus metrics text format',
              content: { 'text/plain': { schema: { type: 'string' } } },
            },
          },
        },
      },
    },
  };
}

export function generateOpenApiYaml(): string {
  const doc = buildOpenApiDoc();
  return yaml.dump(doc, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
  });
}

function main() {
  const outPath = resolve(process.cwd(), 'docs/openapi.yaml');
  mkdirSync(dirname(outPath), { recursive: true });
  const yamlContent = generateOpenApiYaml();
  writeFileSync(outPath, yamlContent, 'utf-8');
  console.log(`Generated OpenAPI 3.1 specification at: ${outPath}`);
}

if (process.argv[1]?.includes('generate-openapi')) {
  main();
}
