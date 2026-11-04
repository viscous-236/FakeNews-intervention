/** Credibility spread and admin analytics (TASK-070, TASK-073). */

import { getPool } from '../../db/pool.js';

export interface SpreadRow {
  waveNumber: number;
  authorTier: 'trusted' | 'neutral' | 'low';
  reshares: { before: number; after: number };
  likes: { before: number; after: number };
}

export interface OverviewAnalytics {
  users: number;
  posts: number;
  waves: number;
  openQueue: number;
  openAppeals: number;
  detectionStatusCounts: Record<
    'queued' | 'running' | 'ok' | 'failed' | 'failed_permanent',
    number
  >;
}

export interface DetectorAnalytics {
  countsByBand: Record<'likely_real' | 'uncertain' | 'likely_fake', number>;
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

export interface WaveAnalyticsRow {
  number: number;
  usersScored: number;
  nPos: number;
  nNeg: number;
  nAdj: number;
  sumDelta: string;
}

export async function getOverviewAnalytics(): Promise<OverviewAnalytics> {
  const pool = getPool();
  const countsQuery = await pool.query<{
    users: string;
    posts: string;
    waves: string;
    open_queue: string;
    open_appeals: string;
  }>(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM posts) AS posts,
       (SELECT count(*)::int FROM waves) AS waves,
       (SELECT count(*)::int FROM review_queue_v) AS open_queue,
       (SELECT count(*)::int FROM appeals WHERE status = 'open') AS open_appeals`,
  );
  const row = countsQuery.rows[0]!;

  const statusQuery = await pool.query<{ status: string; count: string }>(
    `SELECT status, count(*)::int AS count
     FROM detection_results
     GROUP BY status`,
  );
  const detectionStatusCounts: OverviewAnalytics['detectionStatusCounts'] = {
    queued: 0,
    running: 0,
    ok: 0,
    failed: 0,
    failed_permanent: 0,
  };
  for (const s of statusQuery.rows) {
    if (s.status in detectionStatusCounts) {
      detectionStatusCounts[s.status as keyof OverviewAnalytics['detectionStatusCounts']] = Number(
        s.count,
      );
    }
  }

  return {
    users: Number(row.users),
    posts: Number(row.posts),
    waves: Number(row.waves),
    openQueue: Number(row.open_queue),
    openAppeals: Number(row.open_appeals),
    detectionStatusCounts,
  };
}

export async function getDetectorAnalytics(): Promise<DetectorAnalytics> {
  const pool = getPool();

  const bandQuery = await pool.query<{ band: string; count: string }>(
    `SELECT band, count(*)::int AS count
     FROM detection_results
     WHERE band IS NOT NULL
     GROUP BY band`,
  );
  const countsByBand: DetectorAnalytics['countsByBand'] = {
    likely_real: 0,
    uncertain: 0,
    likely_fake: 0,
  };
  for (const b of bandQuery.rows) {
    if (b.band in countsByBand) {
      countsByBand[b.band as keyof DetectorAnalytics['countsByBand']] = Number(b.count);
    }
  }

  const perfQuery = await pool.query<{
    total: string;
    failed: string;
    avg_latency_ms: string;
  }>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status IN ('failed', 'failed_permanent'))::int AS failed,
       COALESCE(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::float AS avg_latency_ms
     FROM detection_results`,
  );
  const perf = perfQuery.rows[0]!;
  const total = Number(perf.total);
  const failed = Number(perf.failed);
  const failureRate = total > 0 ? failed / total : 0;
  const avgLatencyMs = Number(perf.avg_latency_ms);

  const agreementQuery = await pool.query<{
    verdict: string;
    band: string;
    count: string;
  }>(
    `SELECT
       a.verdict,
       d.band,
       count(*)::int AS count
     FROM assessments a
     JOIN post_latest_detection_v d ON d.post_id = a.post_id
     WHERE a.source = 'admin' AND a.is_current AND d.band IS NOT NULL
     GROUP BY a.verdict, d.band`,
  );

  const agreementMap = new Map<string, number>();
  for (const r of agreementQuery.rows) {
    agreementMap.set(`${r.verdict}:${r.band}`, Number(r.count));
  }

  return {
    countsByBand,
    failureRate,
    avgLatencyMs,
    agreement: {
      adminFakeVsBandLikelyFake: agreementMap.get('fake:likely_fake') ?? 0,
      adminFakeVsBandUncertain: agreementMap.get('fake:uncertain') ?? 0,
      adminFakeVsBandLikelyReal: agreementMap.get('fake:likely_real') ?? 0,
      adminRealVsBandLikelyReal: agreementMap.get('real:likely_real') ?? 0,
      adminRealVsBandUncertain: agreementMap.get('real:uncertain') ?? 0,
      adminRealVsBandLikelyFake: agreementMap.get('real:likely_fake') ?? 0,
    },
  };
}

export async function getWavesAnalytics(): Promise<{ items: WaveAnalyticsRow[] }> {
  const result = await getPool().query<{
    number: number;
    users_scored: string;
    n_pos: string;
    n_neg: string;
    n_adj: string;
    sum_delta: string;
  }>(
    `SELECT
       w.number,
       count(uwr.user_id)::int AS users_scored,
       COALESCE(SUM(uwr.n_pos), 0)::int AS n_pos,
       COALESCE(SUM(uwr.n_neg), 0)::int AS n_neg,
       COALESCE(SUM(uwr.n_adj), 0)::int AS n_adj,
       COALESCE(SUM(uwr.delta), 0)::numeric(14,3)::text AS sum_delta
     FROM waves w
     LEFT JOIN user_wave_reputation uwr ON uwr.wave_id = w.id
     GROUP BY w.id, w.number
     ORDER BY w.number ASC`,
  );

  return {
    items: result.rows.map((row) => ({
      number: Number(row.number),
      usersScored: Number(row.users_scored),
      nPos: Number(row.n_pos),
      nNeg: Number(row.n_neg),
      nAdj: Number(row.n_adj),
      sumDelta: row.sum_delta,
    })),
  };
}

export async function getSpreadAnalytics(): Promise<{ items: SpreadRow[] }> {
  const result = await getPool().query<{
    wave_number: number;
    author_tier: 'trusted' | 'neutral' | 'low';
    reshares_before: string;
    reshares_after: string;
    likes_before: string;
    likes_after: string;
  }>(
    `WITH labeled_posts AS (
       SELECT p.id, p.author_tier_at_post AS author_tier, a.created_at AS label_time,
              COALESCE(w.number, 0) AS wave_number
         FROM posts p
         JOIN assessments a
           ON a.post_id = p.id AND a.is_current AND a.source = 'admin'
         LEFT JOIN waves w
           ON a.created_at >= w.opened_at
          AND (w.finalized_at IS NULL OR a.created_at < w.finalized_at)
        WHERE p.kind = 'original'
     )
     SELECT wave_number,
            author_tier,
            COALESCE(SUM((SELECT count(*) FROM posts r
                           WHERE r.reshare_of_post_id = lp.id
                             AND r.kind = 'reshare'
                             AND r.status <> 'deleted'
                             AND r.deleted_at IS NULL
                             AND r.created_at < lp.label_time)), 0)::int AS reshares_before,
            COALESCE(SUM((SELECT count(*) FROM posts r
                           WHERE r.reshare_of_post_id = lp.id
                             AND r.kind = 'reshare'
                             AND r.status <> 'deleted'
                             AND r.deleted_at IS NULL
                             AND r.created_at >= lp.label_time)), 0)::int AS reshares_after,
            COALESCE(SUM((SELECT count(*) FROM likes l
                           WHERE l.post_id = lp.id
                             AND l.deleted_at IS NULL
                             AND l.updated_at < lp.label_time)), 0)::int AS likes_before,
            COALESCE(SUM((SELECT count(*) FROM likes l
                           WHERE l.post_id = lp.id
                             AND l.deleted_at IS NULL
                             AND l.updated_at >= lp.label_time)), 0)::int AS likes_after
       FROM labeled_posts lp
      GROUP BY wave_number, author_tier
      ORDER BY wave_number ASC,
               CASE author_tier WHEN 'trusted' THEN 1 WHEN 'neutral' THEN 2 ELSE 3 END`,
  );

  return {
    items: result.rows.map((row) => ({
      waveNumber: Number(row.wave_number),
      authorTier: row.author_tier,
      reshares: {
        before: Number(row.reshares_before),
        after: Number(row.reshares_after),
      },
      likes: {
        before: Number(row.likes_before),
        after: Number(row.likes_after),
      },
    })),
  };
}
