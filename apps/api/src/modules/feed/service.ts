/**
 * apps/api/src/modules/feed/service.ts (TASK-044, RUL-028, RUL-031)
 *
 * Domain service for feeds: global feed and following feed.
 */

import { encodeCursor, decodeCursor, type DecodedCursor } from '../../db/cursor.js';
import { serializePost, type PostOutput, type ViewerContext } from '../posts/service.js';
import { findGlobalFeed, findFollowingFeed } from './repo.js';

export interface FeedResponse {
  items: PostOutput[];
  nextCursor: string | null;
}

export async function getGlobalFeed(
  options: {
    cursor?: string;
    limit: number;
  },
  viewer?: ViewerContext,
): Promise<FeedResponse> {
  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findGlobalFeed({
    cursor: decodedCursor,
    limit: options.limit,
    viewerId: viewer?.id,
  });

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;

  const items = await Promise.all(
    itemsToReturn.map((row) => serializePost(row, viewer)),
  );

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

export async function getFollowingFeed(
  options: {
    cursor?: string;
    limit: number;
  },
  viewer: ViewerContext,
): Promise<FeedResponse> {
  let decodedCursor: DecodedCursor | null = null;
  if (options.cursor) {
    decodedCursor = decodeCursor(options.cursor);
  }

  const rows = await findFollowingFeed({
    cursor: decodedCursor,
    limit: options.limit,
    viewerId: viewer.id,
  });

  const hasMore = rows.length > options.limit;
  const itemsToReturn = hasMore ? rows.slice(0, options.limit) : rows;

  const items = await Promise.all(
    itemsToReturn.map((row) => serializePost(row, viewer)),
  );

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
