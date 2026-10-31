/**
 * apps/api/src/modules/media/service.ts (TASK-041, REQ-022)
 *
 * Media processing, normalization, and upload service.
 * Decodes and re-encodes to WebP (quality 82, longest side capped at 4096 px,
 * metadata stripped) per REQ-022, then uploads to S3.
 */

import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { config } from '../../config.js';
import { AppError } from '../../middleware/errors.js';
import { putObject } from '../../storage/s3.js';
import { insertMedia } from './repo.js';

export interface ProcessMediaInput {
  ownerId: string;
  kind: 'avatar' | 'post_image';
  buffer: Buffer;
  mimeType: string;
}

export interface MediaUploadResult {
  id: string;
  url: string;
  width: number;
  height: number;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export async function processAndUploadMedia(
  input: ProcessMediaInput,
): Promise<MediaUploadResult> {
  // 1. Verify MIME type per REQ-022 / plan Section 1.7
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Only JPEG, PNG, and WebP images are supported',
    );
  }

  // 2. Decode and process with sharp (REQ-022)
  let processedBuffer: Buffer;
  let outWidth: number;
  let outHeight: number;

  try {
    let pipeline = sharp(input.buffer).rotate();
    const metadata = await pipeline.metadata();

    if (!metadata.width || !metadata.height) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Could not read image dimensions');
    }

    // Cap longest side at 4096 px
    if (metadata.width > 4096 || metadata.height > 4096) {
      pipeline = pipeline.resize(4096, 4096, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Re-encode to WebP quality 82, strip metadata
    pipeline = pipeline.webp({ quality: 82 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    processedBuffer = data;
    outWidth = info.width;
    outHeight = info.height;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid or unreadable image file');
  }

  // 3. Generate media ID and S3 object key (DEC-009)
  const mediaId = randomUUID();
  const objectKey = mediaId;

  // 4. Upload to S3 storage
  await putObject(objectKey, processedBuffer, 'image/webp');

  // 5. Record media entry in database
  const mediaRow = await insertMedia({
    id: mediaId,
    ownerId: input.ownerId,
    kind: input.kind,
    objectKey,
    contentType: 'image/webp',
    bytes: processedBuffer.length,
    width: outWidth,
    height: outHeight,
  });

  return {
    id: mediaRow.id,
    url: `${config.S3_PUBLIC_BASE_URL}/${mediaRow.id}`,
    width: mediaRow.width,
    height: mediaRow.height,
  };
}
