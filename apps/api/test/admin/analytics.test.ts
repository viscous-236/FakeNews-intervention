/** Phase 11 Analytics & Exports test suite (TASK-076, TEST-090 through TEST-094). */

import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { withTransaction } from '../../src/db/tx.js';
import { closeTestPool, getTestPool, truncateAll } from '../setup/db.js';
import { createTestUser } from '../setup/factories.js';

function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < csvText.length && csvText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\r') {
        if (i + 1 < csvText.length && csvText[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return rows;
}

describe('Admin Analytics & Exports (TASK-073, TASK-074, TASK-076)', () => {
  const request = supertest(createApp());
  let adminCookie: string;
  let userCookie: string;

  async function session(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await getTestPool().query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [userId, createHash('sha256').update(token).digest('hex')],
    );
    return `${config.SESSION_COOKIE_NAME}=${token}`;
  }

  beforeEach(async () => {
    await truncateAll();
    const admin = await createTestUser({ role: 'admin' });
    adminCookie = await session(admin.id);
    const regularUser = await createTestUser({ username: 'reg_user' });
    userCookie = await session(regularUser.id);
  });

  afterAll(async () => {
    await closePool();
    await closeTestPool();
  });

  it('TEST-090: Analytics and export endpoints return 403 for non-admins and 401 unauthenticated', async () => {
    const endpoints = [
      '/api/v1/admin/analytics/overview',
      '/api/v1/admin/analytics/detector',
      '/api/v1/admin/analytics/waves',
      '/api/v1/admin/analytics/spread',
      '/api/v1/admin/export/ledger.csv',
      '/api/v1/admin/export/events.csv',
      '/api/v1/admin/export/assessments.csv',
    ];

    for (const ep of endpoints) {
      const resUnauth = await request.get(ep);
      expect(resUnauth.status).toBe(401);

      const resForbidden = await request.get(ep).set('Cookie', userCookie);
      expect(resForbidden.status).toBe(403);
    }
  });

  it('TEST-091: Overview numbers equal counts computed directly from tables', async () => {
    const pool = getTestPool();
    const author = await createTestUser({ username: 'author1' });

    // Insert 2 posts
    const p1 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'First test post for analytics overview.', 'published', 'neutral', now())
       RETURNING id`,
      [author.id],
    );
    const p2 = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Second test post for analytics overview.', 'published', 'neutral', now())
       RETURNING id`,
      [author.id],
    );

    // Insert detection results
    await pool.query(
      `INSERT INTO detection_results (post_id, post_revision, status, band, p_fake, latency_ms, model_name, model_version)
       VALUES ($1, 1, 'ok', 'likely_fake', 0.95, 120, 'roberta-fake-news', 'v1.0'),
              ($2, 1, 'failed_permanent', NULL, NULL, 50, 'roberta-fake-news', 'v1.0')`,
      [p1.rows[0]!.id, p2.rows[0]!.id],
    );

    // Insert a report
    const reporter = await createTestUser({ username: 'reporter1' });
    await pool.query<{ id: string }>(
      `INSERT INTO reports (post_id, reporter_id, reason, status)
       VALUES ($1, $2, 'false_information', 'open') RETURNING id`,
      [p1.rows[0]!.id, reporter.id],
    );

    // Insert an assessment
    const admin = await pool.query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const ass = await pool.query<{ id: string }>(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'fake', 'admin', $2, 'Assessed as fake in test overview.') RETURNING id`,
      [p1.rows[0]!.id, admin.rows[0]!.id],
    );

    // Insert reputation event & open appeal
    const openWave = await pool.query<{ id: string }>(`SELECT id FROM waves WHERE status = 'open' LIMIT 1`);
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, wave_id)
       VALUES ($1, $2, $3, 'MISINFO_POST', -1, 'eligible', $4) RETURNING id`,
      [author.id, p1.rows[0]!.id, ass.rows[0]!.id, openWave.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO appeals (event_id, appellant_id, assessment_id, status, reason)
       VALUES ($1, $2, $3, 'open', 'I am appealing this false post assessment.')`,
      [ev.rows[0]!.id, author.id, ass.rows[0]!.id],
    );

    // Call overview endpoint
    const response = await request.get('/api/v1/admin/analytics/overview').set('Cookie', adminCookie);
    expect(response.status).toBe(200);

    // Direct counts
    const expectedUsers = Number((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0]!.count);
    const expectedPosts = Number((await pool.query('SELECT count(*)::int AS count FROM posts')).rows[0]!.count);
    const expectedWaves = Number((await pool.query('SELECT count(*)::int AS count FROM waves')).rows[0]!.count);
    const expectedQueue = Number((await pool.query('SELECT count(*)::int AS count FROM review_queue_v')).rows[0]!.count);
    const expectedAppeals = Number(
      (await pool.query("SELECT count(*)::int AS count FROM appeals WHERE status = 'open'")).rows[0]!.count,
    );
    const expectedStatusCounts = (
      await pool.query<{ status: string; count: number }>(
        'SELECT status, count(*)::int AS count FROM detection_results GROUP BY status',
      )
    ).rows;

    expect(response.body.users).toBe(expectedUsers);
    expect(response.body.posts).toBe(expectedPosts);
    expect(response.body.waves).toBe(expectedWaves);
    expect(response.body.openQueue).toBe(expectedQueue);
    expect(response.body.openAppeals).toBe(expectedAppeals);

    for (const sc of expectedStatusCounts) {
      expect(response.body.detectionStatusCounts[sc.status]).toBe(sc.count);
    }
  });

  it('TEST-092: Detector analytics confusion counts equal a direct SQL computation', async () => {
    const pool = getTestPool();
    const admin = await pool.query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = admin.rows[0]!.id;

    const author = await createTestUser({ username: 'detector_author' });

    // Helper to create post with detection result & admin assessment
    async function createAssessedPost(band: 'likely_fake' | 'uncertain' | 'likely_real', verdict: 'fake' | 'real') {
      const p = await pool.query<{ id: string }>(
        `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
         VALUES ($1, 'original', 'Body with sufficient length for post test.', 'published', 'neutral', now())
         RETURNING id`,
        [author.id],
      );
      const postId = p.rows[0]!.id;
      await pool.query(
        `INSERT INTO detection_results (post_id, post_revision, status, band, p_fake, latency_ms, model_name, model_version)
         VALUES ($1, 1, 'ok', $2, 0.8, 150, 'roberta-fake-news', 'v1.0')`,
        [postId, band],
      );
      await pool.query(
        `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
         VALUES ($1, 1, $2, 'admin', $3, 'Direct SQL comparison test.')`,
        [postId, verdict, adminId],
      );
      return postId;
    }

    // 2 admin fake vs likely_fake
    await createAssessedPost('likely_fake', 'fake');
    await createAssessedPost('likely_fake', 'fake');
    // 1 admin fake vs uncertain
    await createAssessedPost('uncertain', 'fake');
    // 1 admin real vs likely_real
    await createAssessedPost('likely_real', 'real');
    // 1 admin real vs uncertain
    await createAssessedPost('uncertain', 'real');

    const res = await request.get('/api/v1/admin/analytics/detector').set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    const directAgreement = await pool.query<{ verdict: string; band: string; count: number }>(
      `SELECT a.verdict, d.band, count(*)::int AS count
       FROM assessments a
       JOIN post_latest_detection_v d ON d.post_id = a.post_id
       WHERE a.source = 'admin' AND a.is_current AND d.band IS NOT NULL
       GROUP BY a.verdict, d.band`,
    );

    const agreementMap = new Map<string, number>();
    for (const row of directAgreement.rows) {
      agreementMap.set(`${row.verdict}:${row.band}`, row.count);
    }

    expect(res.body.agreement.adminFakeVsBandLikelyFake).toBe(agreementMap.get('fake:likely_fake') ?? 0);
    expect(res.body.agreement.adminFakeVsBandUncertain).toBe(agreementMap.get('fake:uncertain') ?? 0);
    expect(res.body.agreement.adminRealVsBandLikelyReal).toBe(agreementMap.get('real:likely_real') ?? 0);
    expect(res.body.agreement.adminRealVsBandUncertain).toBe(agreementMap.get('real:uncertain') ?? 0);
    expect(res.body.agreement.adminFakeVsBandLikelyReal).toBe(0);
    expect(res.body.agreement.adminRealVsBandLikelyFake).toBe(0);

    expect(res.body.countsByBand.likely_fake).toBe(2);
    expect(res.body.countsByBand.uncertain).toBe(2);
    expect(res.body.countsByBand.likely_real).toBe(1);
    expect(res.body.failureRate).toBe(0);
    expect(res.body.avgLatencyMs).toBe(150);
  });

  it('TEST-093: CSV exports round-trip values containing commas, quotes and newlines', async () => {
    const pool = getTestPool();
    const admin = await pool.query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = admin.rows[0]!.id;
    const author = await createTestUser({ username: 'csv_author' });

    // Special string containing commas, double quotes, and CRLF / newlines
    const complexRationale =
      'First line of rationale, with commas.\n"Quoted section" with more details,\r\nand a third line concluding the assessment.';

    const p = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'CSV export test content here with sufficient length.', 'published', 'neutral', now())
       RETURNING id`,
      [author.id],
    );
    const postId = p.rows[0]!.id;

    await pool.query(
      `INSERT INTO assessments (post_id, post_revision, verdict, source, decided_by, rationale)
       VALUES ($1, 1, 'fake', 'admin', $2, $3)`,
      [postId, adminId, complexRationale],
    );

    // Insert an event with void_reason
    await pool.query(
      `INSERT INTO reputation_events (user_id, post_id, assessment_id, kind, value, status, void_reason)
       VALUES ($1, $2, (SELECT id FROM assessments WHERE post_id = $2 LIMIT 1), 'MISINFO_POST', -1, 'voided', 'assessment_superseded')`,
      [author.id, postId],
    );

    // Insert a wave ledger row
    const openWave = await pool.query<{ id: string }>(`SELECT id FROM waves WHERE status = 'open' LIMIT 1`);
    await withTransaction(async (tx) => {
      await tx.query("SET LOCAL app.scoring = 'on'");
      await tx.query(
        `INSERT INTO user_wave_reputation (user_id, wave_id, n_pos, n_neg, n_adj, r, sigma_used, q_before, delta, q_after, formula_version)
         VALUES ($1, $2, 3, 1, 0, 2, 0.500, 0.000, 1.000, 1.000, 'v2')`,
        [author.id, openWave.rows[0]!.id],
      );
    });

    // 1. Test assessments.csv
    const assessCsvRes = await request.get('/api/v1/admin/export/assessments.csv').set('Cookie', adminCookie);
    expect(assessCsvRes.status).toBe(200);
    expect(assessCsvRes.headers['content-type']).toContain('text/csv');
    expect(assessCsvRes.headers['content-disposition']).toContain('attachment; filename="assessments.csv"');

    const parsedAssess = parseCsv(assessCsvRes.text);
    expect(parsedAssess.length).toBeGreaterThanOrEqual(2);
    const assessHeaders = parsedAssess[0]!;
    const rationaleIdx = assessHeaders.indexOf('rationale');
    expect(rationaleIdx).toBeGreaterThan(-1);

    const matchingRow = parsedAssess.find((row) => row[rationaleIdx] === complexRationale);
    expect(matchingRow).toBeDefined();
    expect(matchingRow![rationaleIdx]).toBe(complexRationale);

    // 2. Test events.csv
    const eventsCsvRes = await request.get('/api/v1/admin/export/events.csv').set('Cookie', adminCookie);
    expect(eventsCsvRes.status).toBe(200);
    expect(eventsCsvRes.headers['content-type']).toContain('text/csv');
    const parsedEvents = parseCsv(eventsCsvRes.text);
    const eventHeaders = parsedEvents[0]!;
    const voidReasonIdx = eventHeaders.indexOf('void_reason');
    expect(voidReasonIdx).toBeGreaterThan(-1);
    const voidedEventRow = parsedEvents.find((row) => row[voidReasonIdx] === 'assessment_superseded');
    expect(voidedEventRow).toBeDefined();

    // 3. Test ledger.csv
    const ledgerCsvRes = await request.get('/api/v1/admin/export/ledger.csv?waveNumber=1').set('Cookie', adminCookie);
    expect(ledgerCsvRes.status).toBe(200);
    expect(ledgerCsvRes.headers['content-type']).toContain('text/csv');
    const parsedLedger = parseCsv(ledgerCsvRes.text);
    expect(parsedLedger.length).toBeGreaterThanOrEqual(2);
    const ledgerHeaders = parsedLedger[0]!;
    expect(ledgerHeaders).toContain('wave_number');
    expect(ledgerHeaders).toContain('q_after');

    // Filter by non-existent wave returns only headers
    const emptyLedgerRes = await request.get('/api/v1/admin/export/ledger.csv?waveNumber=9999').set('Cookie', adminCookie);
    expect(emptyLedgerRes.status).toBe(200);
    const parsedEmpty = parseCsv(emptyLedgerRes.text);
    expect(parsedEmpty.length).toBe(1); // header only
  });

  it('TEST-094: The spread query splits reshares before and after label time correctly by tier, and waves analytics returns per-wave metrics', async () => {
    const publisher = await createTestUser({ username: 'spread_publisher' });
    const actor = await createTestUser({ username: 'spread_actor' });
    const afterActor = await createTestUser({ username: 'spread_after_actor' });
    const pool = getTestPool();

    await pool.query(`UPDATE waves SET opened_at = now() - interval '2 days' WHERE number = 1`);
    const post = await pool.query<{ id: string }>(
      `INSERT INTO posts (author_id, kind, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'original', 'Spread analytics post with enough content.', 'published', 'neutral', now() - interval '2 days')
       RETURNING id`,
      [publisher.id],
    );
    const postId = post.rows[0]!.id;
    await pool.query(
      `INSERT INTO assessments
         (post_id, post_revision, verdict, source, decided_by, rationale, created_at)
       SELECT $1, 1, 'fake', 'admin', id, 'Admin label for spread analytics.', now() - interval '1 day'
         FROM users WHERE role = 'admin' LIMIT 1`,
      [postId],
    );

    await pool.query(
      `INSERT INTO posts
         (author_id, kind, reshare_of_post_id, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'reshare', $2, '', 'published', 'neutral', now() - interval '36 hours')`,
      [actor.id, postId],
    );
    await pool.query(
      `INSERT INTO posts
         (author_id, kind, reshare_of_post_id, body, status, author_tier_at_post, created_at)
       VALUES ($1, 'reshare', $2, '', 'published', 'neutral', now() - interval '2 hours')`,
      [afterActor.id, postId],
    );
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, updated_at)
       VALUES ($1, $2, now() - interval '36 hours', now() - interval '36 hours')`,
      [actor.id, postId],
    );
    const secondLiker = await createTestUser({ username: 'spread_second_liker' });
    await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at, updated_at)
       VALUES ($1, $2, now() - interval '2 hours', now() - interval '2 hours')`,
      [secondLiker.id, postId],
    );

    const spreadRes = await request.get('/api/v1/admin/analytics/spread').set('Cookie', adminCookie);
    expect(spreadRes.status).toBe(200);
    expect(spreadRes.body.items).toEqual([
      {
        waveNumber: 1,
        authorTier: 'neutral',
        reshares: { before: 1, after: 1 },
        likes: { before: 1, after: 1 },
      },
    ]);

    // Test GET /api/v1/admin/analytics/waves
    const wavesRes = await request.get('/api/v1/admin/analytics/waves').set('Cookie', adminCookie);
    expect(wavesRes.status).toBe(200);
    expect(Array.isArray(wavesRes.body.items)).toBe(true);
    expect(wavesRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(wavesRes.body.items[0]).toHaveProperty('number');
    expect(wavesRes.body.items[0]).toHaveProperty('usersScored');
    expect(wavesRes.body.items[0]).toHaveProperty('nPos');
    expect(wavesRes.body.items[0]).toHaveProperty('nNeg');
    expect(wavesRes.body.items[0]).toHaveProperty('nAdj');
    expect(wavesRes.body.items[0]).toHaveProperty('sumDelta');
  });
});
