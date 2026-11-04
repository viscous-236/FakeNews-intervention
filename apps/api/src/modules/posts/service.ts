/**
 * apps/api/src/modules/posts/service.ts (TASK-043, RUL-017, RUL-019, RUL-024)
 *
 * Post domain service: creation, retrieval, serialization, editing, and deletion.
 */

import { type PoolClient } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { config } from '../../config.js';
import { AppError } from '../../middleware/errors.js';
import { encodeCursor, decodeCursor, type DecodedCursor } from '../../db/cursor.js';
import { tierOfValue } from '../../scoring/tier.js';
import { type UserSummary } from '../users/service.js';
import { findUserByUsername } from '../users/repo.js';
import { retractReshareEventOnDelete } from '../../scoring/events.js';
import {
  insertPost,
  attachMediaToPost,
  queueDetectionResult,
  findPostById,
  findPostPublicStatus,
  findPostLatestDetection,
  findPostImages,
  countPostInteractions,
  findViewerInteractions,
  findAuthorPostEvents,
  checkCanEditPost,
  updatePostContent,
  softDeletePostRow,
  findPostsByUser,
  type PostAuthorJoinedRow,
} from './repo.js';

export interface PostImageItem {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface PostOutput {
  id: string;
  kind: 'original' | 'reshare';
  author: UserSummary;
  body: string;
  sourceUrl: string | null;
  images: PostImageItem[];
  status: 'published' | 'held' | 'deleted';
  createdAt: string;
  editedAt: string | null;
  label: 'none' | 'auto_flagged' | 'fact_checked_true' | 'fact_checked_false' | 'unverifiable';
  underAppeal: boolean;
  requiresShareConfirmation: boolean;
  counts: { likes: number; comments: number; reshares: number };
  viewer: { liked: boolean; reshared: boolean };
  reshareOf: PostOutput | null;
  authorView?: {
    detection: {
      status: string;
      band: string | null;
    };
    events: Array<{
      kind: string;
      value: number;
      status: string;
    }>;
  };
  adminView?: {
    detection: {
      status: string;
      band: string | null;
      pFake: string | null;
      modelName: string | null;
      modelVersion: string | null;
    };
  };
}

export interface ViewerContext {
  id: string;
  role: 'user' | 'admin';
}

/**
 * Serialize a post row into the full Post shape (Section 1.7 / line 856).
 */
export async function serializePost(
  row: PostAuthorJoinedRow,
  viewer?: ViewerContext,
  isRecursive = false,
  client?: PoolClient,
): Promise<PostOutput> {
  const authorTier = tierOfValue(row.author_q);
  const author: UserSummary = {
    id: row.author_id,
    username: row.author_username,
    displayName: row.author_display_name,
    avatarUrl: row.author_avatar_media_id
      ? `${config.S3_PUBLIC_BASE_URL}/${row.author_avatar_media_id}`
      : null,
    tier: authorTier,
  };

  const imagesRaw = await findPostImages(row.id, client);
  const images: PostImageItem[] = imagesRaw.map((img) => ({
    id: img.id,
    url: `${config.S3_PUBLIC_BASE_URL}/${img.id}`,
    width: img.width,
    height: img.height,
  }));

  const counts = await countPostInteractions(row.id, client);
  const viewerState = viewer
    ? await findViewerInteractions(row.id, viewer.id, client)
    : { liked: false, reshared: false };

  const { label, under_appeal } = await findPostPublicStatus(row.id, client);

  // RUL-019 / RUL-024 requires confirmation if false, auto_flagged, or low-tier author
  const requiresShareConfirmation =
    label === 'auto_flagged' || label === 'fact_checked_false' || authorTier === 'low';

  // ReshareOf (1 level only)
  let reshareOf: PostOutput | null = null;
  if (!isRecursive && row.kind === 'reshare' && row.reshare_of_post_id) {
    const parent = await findPostById(row.reshare_of_post_id, client);
    if (parent) {
      reshareOf = await serializePost(parent, viewer, true, client);
    }
  }

  // Views for author & admin
  const isAuthor = viewer?.id === row.author_id;
  const isAdmin = viewer?.role === 'admin';

  let authorView: PostOutput['authorView'] | undefined;
  let adminView: PostOutput['adminView'] | undefined;

  if (isAuthor || isAdmin) {
    const detection = await findPostLatestDetection(row.id, client);
    const events = await findAuthorPostEvents(row.id, row.author_id, client);

    authorView = {
      detection: {
        status: detection?.status ?? 'queued',
        band: detection?.band ?? null,
      },
      events: events.map((e) => ({
        kind: e.kind,
        value: e.value,
        status: e.status,
      })),
    };

    if (isAdmin) {
      adminView = {
        detection: {
          status: detection?.status ?? 'queued',
          band: detection?.band ?? null,
          pFake: detection?.p_fake ?? null,
          modelName: detection?.model_name ?? null,
          modelVersion: detection?.model_version ?? null,
        },
      };
    }
  }

  return {
    id: row.id,
    kind: row.kind,
    author,
    body: row.body,
    sourceUrl: row.source_url,
    images,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null,
    label,
    underAppeal: under_appeal,
    requiresShareConfirmation,
    counts,
    viewer: viewerState,
    reshareOf,
    ...(authorView ? { authorView } : {}),
    ...(adminView ? { adminView } : {}),
  };
}

export async function createPost(
  author: { id: string; q: string | number; role: 'user' | 'admin' },
  input: {
    body: string;
    sourceUrl?: string | null;
    mediaIds?: string[];
  },
): Promise<PostOutput> {
  const authorTier = tierOfValue(author.q);

  // RUL-024: low-tier hold check
  const status: 'published' | 'held' =
    config.HOLD_LOW_TIER_POSTS && authorTier === 'low' ? 'held' : 'published';

  return withTransaction(async (tx) => {
    // 1. Insert post row
    const postRow = await insertPost(
      {
        authorId: author.id,
        kind: 'original',
        body: input.body,
        sourceUrl: input.sourceUrl,
        status,
        authorTier,
      },
      tx,
    );

    // 2. Attach media
    if (input.mediaIds && input.mediaIds.length > 0) {
      await attachMediaToPost(postRow.id, input.mediaIds, tx);
    }

    // 3. Queue detection (post_revision = 1)
    await queueDetectionResult(postRow.id, 1, tx);

    return serializePost(postRow, { id: author.id, role: author.role }, false, tx);
  });
}

export async function getPostById(postId: string, viewer?: ViewerContext): Promise<PostOutput> {
  const row = await findPostById(postId);
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Post not found');
  }

  const isAuthor = viewer?.id === row.author_id;
  const isAdmin = viewer?.role === 'admin';

  // Deleted posts: invisible except to author and admins
  if (row.status === 'deleted' || row.deleted_at !== null) {
    if (!isAuthor && !isAdmin) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
  }

  // Held posts: visible only to author and admins per RUL-024
  if (row.status === 'held') {
    if (!isAuthor && !isAdmin) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }
  }

  return serializePost(row, viewer);
}

export async function editPost(
  postId: string,
  authorId: string,
  input: {
    body?: string;
    sourceUrl?: string | null;
  },
): Promise<PostOutput> {
  return withTransaction(async (tx) => {
    // RUL-017 edit eligibility check
    const check = await checkCanEditPost(postId, authorId, config.EDIT_WINDOW_MINUTES, tx);
    if (!check.allowed) {
      throw new AppError(409, 'EDIT_NOT_ALLOWED', check.reason || 'Edit not allowed');
    }

    const currentPost = await findPostById(postId, tx);
    if (!currentPost) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }

    // Update content and increment revision
    const updated = await updatePostContent(
      {
        postId,
        oldRevision: currentPost.revision,
        oldBody: currentPost.body,
        oldSourceUrl: currentPost.source_url,
        newBody: input.body,
        newSourceUrl: input.sourceUrl,
      },
      tx,
    );

    // Enqueue re-detection for new revision
    await queueDetectionResult(postId, updated.revision, tx);

    return serializePost(updated, { id: authorId, role: 'user' }, false, tx);
  });
}

export async function deletePost(postId: string, userId: string, isAdmin = false): Promise<void> {
  return withTransaction(async (tx) => {
    const post = await findPostById(postId, tx);
    if (!post || post.status === 'deleted' || post.deleted_at !== null) {
      throw new AppError(404, 'NOT_FOUND', 'Post not found');
    }

    if (post.author_id !== userId && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot delete another user post');
    }

    // Soft delete
    await softDeletePostRow(postId, tx);

    // If reshare, retract unfinalized event per DEC-005 / RUL-019
    if (post.kind === 'reshare' && post.reshare_of_post_id) {
      await retractReshareEventOnDelete(tx, post.author_id, post.reshare_of_post_id);
    }
  });
}

export async function getUserPosts(
  username: string,
  options: {
    cursor?: string;
    limit: number;
  },
  viewer?: ViewerContext,
): Promise<{ items: PostOutput[]; nextCursor: string | null }> {
  const user = await findUserByUsername(username);
  if (!user || user.status === 'deleted' || user.deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  const isAuthor = viewer?.id === user.id;
  const isAdmin = viewer?.role === 'admin';
  const includeHeld = isAuthor || isAdmin;

  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findPostsByUser(user.id, {
    includeHeld,
    cursor: decodedCursor,
    limit: options.limit,
  });

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;

  const items = await Promise.all(itemsToReturn.map((row) => serializePost(row, viewer)));

  let nextCursor: string | null = null;
  if (hasMore && itemsToReturn.length > 0) {
    const lastRow = itemsToReturn[itemsToReturn.length - 1]!;
    nextCursor = encodeCursor(new Date(lastRow.created_at), lastRow.id);
  }

  return {
    items,
    nextCursor,
  };
}
