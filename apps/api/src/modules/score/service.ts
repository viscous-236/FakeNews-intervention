/**
 * apps/api/src/modules/score/service.ts (TASK-045, Section 1.7, RUL-016, RUL-023)
 *
 * Scoring domain service: pending aggregates, ledger history, events, appeals, and visibility rules.
 */

import { withTransaction } from '../../db/tx.js';
import { config } from '../../config.js';
import { AppError } from '../../middleware/errors.js';
import { encodeCursor, decodeCursor, type DecodedCursor } from '../../db/cursor.js';
import { computeTier } from '../users/service.js';
import { type ViewerContext } from '../posts/service.js';
import { findUserByUsername } from '../users/repo.js';
import { computeR } from '../../scoring/pure.js';
import {
  getCurrentOpenWave,
  getPendingAggregateForUser,
  findUserLedgerHistory,
  findUserLedgerByWaveNumber,
  findEventsForWaveAndUser,
  findUserEvents,
  findEventByIdAndUser,
  insertAppeal,
  findUserAppeals,
  type LedgerJoinedRow,
  type EventJoinedRow,
  type AppealRow,
} from './repo.js';

export interface MyScoreResponse {
  q: string;
  sigma: string;
  tier: 'trusted' | 'neutral' | 'low';
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

export interface LedgerRowOutput {
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

export interface EventItemOutput {
  id: string;
  kind: string;
  value: number;
  status: string;
  waveNumber: number | null;
  voidReason: string | null;
  post: {
    id: string;
    excerpt: string;
  };
  assessment: {
    verdict: string;
    source: string;
    createdAt: string;
    rationale: string;
  } | null;
  reversesEventId: string | null;
  appeal: {
    id: string;
    status: string;
  } | null;
  createdAt: string;
}

export interface AppealOutput {
  id: string;
  status: string;
  reason: string;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

function serializeLedgerRow(row: LedgerJoinedRow): LedgerRowOutput {
  return {
    waveNumber: row.wave_number,
    nPos: row.n_pos,
    nNeg: row.n_neg,
    nAdj: row.n_adj,
    r: row.r,
    sigmaUsed: parseFloat(row.sigma_used).toFixed(3),
    qBefore: parseFloat(row.q_before).toFixed(3),
    delta: parseFloat(row.delta).toFixed(3),
    qAfter: parseFloat(row.q_after).toFixed(3),
    formulaVersion: row.formula_version,
    finalizedAt: row.finalized_at ? new Date(row.finalized_at).toISOString() : null,
  };
}

function serializeEventItem(row: EventJoinedRow): EventItemOutput {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    status: row.status,
    waveNumber: row.wave_number,
    voidReason: row.void_reason,
    post: {
      id: row.post_id,
      excerpt: row.post_body.slice(0, 100),
    },
    assessment: row.assessment_id
      ? {
          verdict: row.assessment_verdict!,
          source: row.assessment_source!,
          createdAt: new Date(row.assessment_created_at!).toISOString(),
          rationale: row.assessment_rationale!,
        }
      : null,
    reversesEventId: row.reverses_event_id,
    appeal: row.appeal_id
      ? {
          id: row.appeal_id,
          status: row.appeal_status!,
        }
      : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function serializeAppealItem(row: AppealRow): AppealOutput {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    resolutionNote: row.resolution_note,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

export async function getMyScore(user: {
  id: string;
  q: string;
  sigma: string;
}): Promise<MyScoreResponse> {
  const qNum = parseFloat(user.q);
  const sigmaNum = parseFloat(user.sigma);
  const tier = computeTier(qNum);

  const openWave = await getCurrentOpenWave();
  let pendingCounts = { nPos: 0, nNeg: 0, nAdj: 0 };
  let waveNumber = 0;
  let waveOpenedAt = new Date().toISOString();

  if (openWave) {
    waveNumber = openWave.number;
    waveOpenedAt = new Date(openWave.opened_at).toISOString();
    pendingCounts = await getPendingAggregateForUser(user.id, openWave.id);
  }

  const r = computeR(pendingCounts);
  const delta = sigmaNum * r;

  return {
    q: (isNaN(qNum) ? 0 : qNum).toFixed(3),
    sigma: (isNaN(sigmaNum) ? 0.5 : sigmaNum).toFixed(3),
    tier,
    currentWave: {
      number: waveNumber,
      openedAt: waveOpenedAt,
      pending: {
        nPos: pendingCounts.nPos,
        nNeg: pendingCounts.nNeg,
        nAdj: pendingCounts.nAdj,
        r,
        projectedDelta: delta.toFixed(3),
      },
    },
    thresholds: {
      trustedMin: config.Q_TRUSTED_MIN.toFixed(3),
      lowMax: config.Q_LOW_MAX.toFixed(3),
    },
  };
}

export async function getMyScoreHistory(
  userId: string,
  options: {
    cursor?: string;
    limit: number;
  },
): Promise<{ items: LedgerRowOutput[]; nextCursor: string | null }> {
  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findUserLedgerHistory(userId, {
    cursor: decodedCursor,
    limit: options.limit,
  });

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;
  const items = itemsToReturn.map(serializeLedgerRow);

  let nextCursor: string | null = null;
  if (hasMore && itemsToReturn.length > 0) {
    const lastRow = itemsToReturn[itemsToReturn.length - 1]!;
    nextCursor = encodeCursor(new Date(lastRow.created_at), lastRow.wave_id);
  }

  return { items, nextCursor };
}

export async function getMyScoreHistoryByWaveNumber(
  userId: string,
  waveNumber: number,
): Promise<{ row: LedgerRowOutput; events: EventItemOutput[] }> {
  const row = await findUserLedgerByWaveNumber(userId, waveNumber);
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Score history not found for wave');
  }

  const events = await findEventsForWaveAndUser(userId, row.wave_id);

  return {
    row: serializeLedgerRow(row),
    events: events.map(serializeEventItem),
  };
}

export async function getMyEvents(
  userId: string,
  options: {
    status?: string;
    cursor?: string;
    limit: number;
  },
): Promise<{ items: EventItemOutput[]; nextCursor: string | null }> {
  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findUserEvents(userId, {
    status: options.status,
    cursor: decodedCursor,
    limit: options.limit,
  });

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;
  const items = itemsToReturn.map(serializeEventItem);

  let nextCursor: string | null = null;
  if (hasMore && itemsToReturn.length > 0) {
    const lastRow = itemsToReturn[itemsToReturn.length - 1]!;
    nextCursor = encodeCursor(new Date(lastRow.created_at), lastRow.id);
  }

  return { items, nextCursor };
}

export async function appealEvent(
  userId: string,
  eventId: string,
  input: { reason: string },
): Promise<{ id: string; status: 'open' }> {
  const event = await findEventByIdAndUser(eventId, userId);
  if (!event) {
    throw new AppError(404, 'NOT_FOUND', 'Event not found');
  }

  // RUL-016: negative events only
  const allowedKinds = ['MISINFO_POST', 'MISINFO_RESHARE', 'MISINFO_LIKE'];
  if (!allowedKinds.includes(event.kind)) {
    throw new AppError(
      400,
      'INVALID_APPEAL',
      'Only negative reputation events can be appealed',
    );
  }

  if (event.has_appeal) {
    throw new AppError(
      409,
      'ALREADY_EXISTS',
      'An appeal already exists for this event',
    );
  }

  if (event.status === 'voided') {
    throw new AppError(400, 'INVALID_APPEAL', 'Cannot appeal a voided event');
  }

  // Check window
  const windowMs = config.APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(event.assessment_created_at).getTime() + windowMs;
  if (Date.now() > expiresAt) {
    throw new AppError(
      409,
      'APPEAL_WINDOW_EXPIRED',
      'Appeal window has expired',
    );
  }

  return withTransaction(async (tx) => {
    const appeal = await insertAppeal(
      {
        eventId: event.id,
        assessmentId: event.assessment_id,
        appellantId: userId,
        reason: input.reason,
      },
      tx,
    );
    return { id: appeal.id, status: 'open' };
  });
}

export async function getMyAppeals(
  userId: string,
  options: {
    cursor?: string;
    limit: number;
  },
): Promise<{ items: AppealOutput[]; nextCursor: string | null }> {
  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findUserAppeals(userId, {
    cursor: decodedCursor,
    limit: options.limit,
  });

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;
  const items = itemsToReturn.map(serializeAppealItem);

  let nextCursor: string | null = null;
  if (hasMore && itemsToReturn.length > 0) {
    const lastRow = itemsToReturn[itemsToReturn.length - 1]!;
    nextCursor = encodeCursor(new Date(lastRow.created_at), lastRow.id);
  }

  return { items, nextCursor };
}

export async function getUserScore(
  username: string,
  viewer?: ViewerContext,
): Promise<{ tier: 'trusted' | 'neutral' | 'low'; q?: string }> {
  const user = await findUserByUsername(username);
  if (!user || user.status === 'deleted' || user.deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  const qNum = parseFloat(user.q);
  const tier = computeTier(qNum);

  const isSelf = viewer?.id === user.id;
  const isAdmin = viewer?.role === 'admin';
  const showFull = config.PUBLIC_SCORE_VISIBILITY === 'full';

  if (showFull || isSelf || isAdmin) {
    return {
      tier,
      q: (isNaN(qNum) ? 0 : qNum).toFixed(3),
    };
  }

  return { tier };
}

export async function getCurrentWaveInfo(): Promise<{
  number: number;
  openedAt: string;
}> {
  const wave = await getCurrentOpenWave();
  if (!wave) {
    throw new AppError(404, 'NOT_FOUND', 'No open wave found');
  }

  return {
    number: wave.number,
    openedAt: new Date(wave.opened_at).toISOString(),
  };
}
