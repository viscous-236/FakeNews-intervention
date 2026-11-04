/**
 * apps/api/src/storage/s3.ts (TASK-041)
 *
 * S3-compatible client for SeaweedFS / MinIO / AWS S3.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { AppError } from '../middleware/appError.js';

/** Section 1.1: API → S3 times out after 20 s. */
export const S3_TIMEOUT_MS = 20_000;

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: S3_TIMEOUT_MS,
        requestTimeout: S3_TIMEOUT_MS,
      }),
    });
  }
  return s3Client;
}

export async function ensureBucketExists(): Promise<void> {
  const client = getS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch {
    logger.info({ bucket: config.S3_BUCKET }, 'S3 bucket check failed, creating bucket');
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
    } catch (createErr) {
      logger.warn({ createErr }, 'Could not create bucket (may already exist)');
    }
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = getS3Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    // Section 1.7: object storage failure on upload → 502 UPSTREAM_FAILED
    logger.error({ err, key }, 'Object storage upload failed');
    throw new AppError(502, 'UPSTREAM_FAILED', 'Object storage is unavailable');
  }
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
    }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const client = getS3Client();
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
      }),
    );
    if (!res.Body) return null;
    const byteArray = await res.Body.transformToByteArray();
    return Buffer.from(byteArray);
  } catch {
    return null;
  }
}
