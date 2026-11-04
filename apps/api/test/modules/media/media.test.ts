/**
 * apps/api/test/modules/media/media.test.ts (TASK-041)
 *
 * Tests for media uploads, REQ-022 WebP normalization, SeaweedFS storage,
 * and orphaned media cleanup job.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../../src/app.js';
import { getTestPool, closeTestPool, truncateAll } from '../../setup/db.js';
import { config } from '../../../src/config.js';
import { createUser } from '../../../src/modules/users/service.js';
import { ensureBucketExists, getObjectBuffer } from '../../../src/storage/s3.js';
import { cleanupOrphanedMedia } from '../../../src/jobs/mediaCleanup.js';

function extractCookie(headers: Record<string, unknown>): string {
  const h = headers['set-cookie'];
  return Array.isArray(h) ? String(h[0] || '') : typeof h === 'string' ? h : '';
}

describe('Media Module & S3 Storage (TASK-041, REQ-022)', () => {
  const app = createApp();
  const request = supertest(app);
  let activeCookie: string;
  let activeUserId: string;

  beforeAll(async () => {
    await truncateAll();
    await ensureBucketExists();

    const user = await createUser({
      username: 'media_uploader',
      email: 'media@example.com',
      password: 'password12345',
      displayName: 'Media Uploader',
    });
    activeUserId = user.id;

    const loginRes = await request
      .post('/api/v1/auth/login')
      .set('Origin', config.APP_ORIGIN)
      .send({ identifier: 'media_uploader', password: 'password12345' });
    activeCookie = extractCookie(loginRes.headers);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('Rejects unauthenticated or unverified requests', async () => {
    const smallPng = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const unauthRes = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .field('kind', 'avatar')
      .attach('file', smallPng, 'test.png');
    expect(unauthRes.status).toBe(401);
  });

  it('Rejects missing file or invalid kind', async () => {
    // Missing file
    const noFileRes = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'avatar');
    expect(noFileRes.status).toBe(400);
    expect(noFileRes.body.error.code).toBe('VALIDATION_ERROR');

    // Invalid kind
    const smallPng = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toBuffer();

    const badKindRes = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'invalid_kind_foo')
      .attach('file', smallPng, 'test.png');
    expect(badKindRes.status).toBe(400);
    expect(badKindRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Rejects unsupported media types (415)', async () => {
    const textBuffer = Buffer.from('this is a plain text file, not an image');

    const res = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'avatar')
      .attach('file', textBuffer, 'doc.txt');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('Rejects files exceeding 5 MB limit (413 PAYLOAD_TOO_LARGE)', async () => {
    // Create dummy buffer of 5.1 MB
    const largeBuffer = Buffer.alloc(5.1 * 1024 * 1024);

    const res = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'post_image')
      .attach('file', largeBuffer, 'huge.jpg');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('Uploads, normalizes to WebP, and stores in SeaweedFS (REQ-022)', async () => {
    const pool = getTestPool();

    // Create 120x80 red JPEG image
    const jpegBuffer = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const res = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'avatar')
      .attach('file', jpegBuffer, 'avatar.jpg');

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.url).toBe(`${config.S3_PUBLIC_BASE_URL}/${res.body.id}`);
    expect(res.body.width).toBe(120);
    expect(res.body.height).toBe(80);

    // Verify DB entry
    const dbRes = await pool.query(`SELECT * FROM media WHERE id = $1`, [res.body.id]);
    expect(dbRes.rows.length).toBe(1);
    const mediaRow = dbRes.rows[0];
    expect(mediaRow.owner_id).toBe(activeUserId);
    expect(mediaRow.content_type).toBe('image/webp');
    expect(mediaRow.kind).toBe('avatar');

    // Verify real S3 object retrieved from SeaweedFS
    const s3Buffer = await getObjectBuffer(mediaRow.object_key);
    expect(s3Buffer).not.toBeNull();
    expect(s3Buffer!.length).toBe(mediaRow.bytes);

    // Verify sharp reads it back as valid WebP
    const s3Meta = await sharp(s3Buffer!).metadata();
    expect(s3Meta.format).toBe('webp');
    expect(s3Meta.width).toBe(120);
    expect(s3Meta.height).toBe(80);
  });

  it('Downscales images exceeding 4096 px longest side (REQ-022)', async () => {
    // Create 5000x2500 image
    const largePng = await sharp({
      create: { width: 5000, height: 2500, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png()
      .toBuffer();

    const res = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'post_image')
      .attach('file', largePng, 'panorama.png');

    expect(res.status).toBe(201);
    expect(res.body.width).toBe(4096);
    expect(res.body.height).toBe(2048);
  });

  it('Cleans up unreferenced orphaned media older than 24 hours', async () => {
    const pool = getTestPool();

    // 1. Upload media item that will be orphaned
    const pngBuffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 100, b: 100 } },
    })
      .png()
      .toBuffer();

    const uploadRes = await request
      .post('/api/v1/media')
      .set('Origin', config.APP_ORIGIN)
      .set('Cookie', activeCookie)
      .field('kind', 'post_image')
      .attach('file', pngBuffer, 'orphan.png');
    expect(uploadRes.status).toBe(201);
    const orphanId = uploadRes.body.id;

    // Immediately run cleanup — media is young (< 24h), should NOT be purged
    const youngPurged = await cleanupOrphanedMedia(24);
    expect(youngPurged).toBe(0);

    // Manually age the media in DB to 25 hours ago
    await pool.query(`UPDATE media SET created_at = now() - interval '25 hours' WHERE id = $1`, [
      orphanId,
    ]);

    // Now run cleanup — should purge the orphaned row
    const purged = await cleanupOrphanedMedia(24);
    expect(purged).toBeGreaterThanOrEqual(1);

    // Verify row deleted from DB
    const checkDb = await pool.query(`SELECT 1 FROM media WHERE id = $1`, [orphanId]);
    expect(checkDb.rows.length).toBe(0);

    // Verify deleted from S3
    const s3Check = await getObjectBuffer(orphanId);
    expect(s3Check).toBeNull();
  });
});
