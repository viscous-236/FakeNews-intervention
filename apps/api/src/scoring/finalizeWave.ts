/**
 * apps/api/src/scoring/finalizeWave.ts (TASK-022)
 *
 * Wave finalization transaction (Section 1.5).
 * Aggregates eligible events for the wave, computes rewards R_i,
 * updates users.q, writes ledger rows to user_wave_reputation,
 * transitions events to 'counted', finalizes current wave,
 * opens the next wave, records admin audit log, and notifies affected users.
 */

import Decimal from 'decimal.js';
import { type PoolClient } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { AppError } from '../app.js';
import { computeR, applyUpdate } from './pure.js';

export interface WaveActor {
  kind: 'admin' | 'system';
  userId?: string;
}

export interface FinalizedWaveInfo {
  id: string;
  number: number;
  status: 'open' | 'finalized';
  formula_version: string;
  opened_at: Date;
  finalized_at: Date | null;
}

export interface FinalizeWaveResult {
  alreadyFinalized: boolean;
  wave: FinalizedWaveInfo;
  usersScored: number;
  eventsCounted: number;
}

interface UserRow {
  id: string;
  sigma: string;
  q: string;
}

interface EventAggregateRow {
  user_id: string;
  n_pos: string;
  n_neg: string;
  n_adj: string;
}

async function runFinalizeWave(
  tx: PoolClient,
  waveId?: string,
  actor: WaveActor = { kind: 'system' },
): Promise<FinalizeWaveResult> {
  // 1. Enable scoring bypass in session
  await tx.query("SET LOCAL app.scoring = 'on'");

  // 2. Lock target wave FOR UPDATE
  let targetWaveId = waveId;
  if (!targetWaveId) {
    const openRes = await tx.query<{ id: string }>(
      `SELECT id FROM waves WHERE status = 'open' FOR UPDATE`,
    );
    const openRow = openRes.rows[0];
    if (!openRow) {
      throw new AppError(404, 'NOT_FOUND', 'No open wave found');
    }
    targetWaveId = openRow.id;
  }

  const waveRes = await tx.query<FinalizedWaveInfo>(
    `SELECT id, number, status, formula_version, opened_at, finalized_at
     FROM waves
     WHERE id = $1
     FOR UPDATE`,
    [targetWaveId],
  );

  const wave = waveRes.rows[0];
  if (!wave) {
    throw new AppError(404, 'NOT_FOUND', 'Wave not found');
  }

  // Idempotent return if already finalized
  if (wave.status === 'finalized') {
    return {
      alreadyFinalized: true,
      wave,
      usersScored: 0,
      eventsCounted: 0,
    };
  }

  // 3. Lock all users in deterministic order (by id)
  const usersRes = await tx.query<UserRow>(
    `SELECT id, sigma, q
     FROM users
     WHERE created_at <= now()
     ORDER BY id
     FOR UPDATE`,
  );

  // 4. Aggregate eligible events for this wave
  const aggRes = await tx.query<EventAggregateRow>(
    `SELECT
       user_id,
       count(*) FILTER (WHERE kind IN ('RESPONSIBLE_POST','RESPONSIBLE_RESHARE','VALID_REPORT')) AS n_pos,
       count(*) FILTER (WHERE kind IN ('MISINFO_POST','MISINFO_RESHARE','MISINFO_LIKE')) AS n_neg,
       COALESCE(sum(value) FILTER (WHERE kind = 'REVERSAL'), 0) AS n_adj
     FROM reputation_events
     WHERE wave_id = $1 AND status = 'eligible'
     GROUP BY user_id`,
    [wave.id],
  );

  const aggMap = new Map<string, { nPos: number; nNeg: number; nAdj: number }>();
  for (const row of aggRes.rows) {
    aggMap.set(row.user_id, {
      nPos: parseInt(row.n_pos, 10) || 0,
      nNeg: parseInt(row.n_neg, 10) || 0,
      nAdj: parseInt(row.n_adj, 10) || 0,
    });
  }

  // 5. Update each user score and insert ledger row
  const pendingNotifications: {
    userId: string;
    payload: { waveNumber: number; r: number; delta: string; qAfter: string };
  }[] = [];

  for (const user of usersRes.rows) {
    const agg = aggMap.get(user.id) ?? { nPos: 0, nNeg: 0, nAdj: 0 };
    const r = computeR(agg);
    const qBefore = new Decimal(user.q);
    const sigma = new Decimal(user.sigma);
    const { delta, qAfter } = applyUpdate(qBefore, sigma, r);

    await tx.query(
      `INSERT INTO user_wave_reputation (
         user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        user.id,
        wave.id,
        agg.nPos,
        agg.nNeg,
        agg.nAdj,
        r,
        sigma.toFixed(3),
        qBefore.toFixed(3),
        delta.toFixed(3),
        qAfter.toFixed(3),
        wave.formula_version,
      ],
    );

    await tx.query(
      `UPDATE users
       SET q = $1, updated_at = now()
       WHERE id = $2`,
      [qAfter.toFixed(3), user.id],
    );

    if (r !== 0) {
      pendingNotifications.push({
        userId: user.id,
        payload: {
          waveNumber: wave.number,
          r,
          delta: delta.toFixed(3),
          qAfter: qAfter.toFixed(3),
        },
      });
    }
  }

  // 6. Transition eligible events in this wave to counted
  const eventsUpdateRes = await tx.query(
    `UPDATE reputation_events
     SET status = 'counted', ledger_user_id = user_id, ledger_wave_id = wave_id
     WHERE wave_id = $1 AND status = 'eligible'`,
    [wave.id],
  );
  const eventsCounted = eventsUpdateRes.rowCount ?? 0;

  // 7. Finalize current wave, then open wave number + 1
  const finalizedWaveRes = await tx.query<FinalizedWaveInfo>(
    `UPDATE waves
     SET status = 'finalized',
         finalized_at = now(),
         finalized_by = $2,
         finalized_by_system = $3
     WHERE id = $1
     RETURNING id, number, status, formula_version, opened_at, finalized_at`,
    [wave.id, actor.kind === 'admin' ? actor.userId ?? null : null, actor.kind === 'system'],
  );
  const finalizedWave = finalizedWaveRes.rows[0];
  if (!finalizedWave) {
    throw new AppError(500, 'INTERNAL', 'Failed to retrieve finalized wave');
  }

  await tx.query(
    `INSERT INTO waves (number, status)
     VALUES ($1, 'open')`,
    [wave.number + 1],
  );

  // 8. Insert admin audit log row
  await tx.query(
    `INSERT INTO admin_audit_log (
       actor_kind, actor_id, action, entity_type, entity_id, after
     ) VALUES ($1, $2, 'wave.finalize', 'wave', $3, $4)`,
    [
      actor.kind,
      actor.kind === 'admin' ? actor.userId ?? null : null,
      wave.id,
      JSON.stringify({
        waveNumber: wave.number,
        usersScored: usersRes.rows.length,
        eventsCounted,
      }),
    ],
  );

  // 9. Send notifications for users with r <> 0
  for (const notif of pendingNotifications) {
    await tx.query(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1, 'wave_finalized', $2)`,
      [notif.userId, JSON.stringify(notif.payload)],
    );
  }

  return {
    alreadyFinalized: false,
    wave: finalizedWave,
    usersScored: usersRes.rows.length,
    eventsCounted,
  };
}

/**
 * Execute wave finalization in a single transaction.
 */
export async function finalizeWave(
  waveId?: string,
  actor: WaveActor = { kind: 'system' },
  client?: PoolClient,
): Promise<FinalizeWaveResult> {
  if (client) {
    return runFinalizeWave(client, waveId, actor);
  }
  return withTransaction((tx) => runFinalizeWave(tx, waveId, actor));
}
