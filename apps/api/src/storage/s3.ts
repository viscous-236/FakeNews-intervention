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
import { config } from '../config.js';
import { logger } from '../logger.js';

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

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
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
