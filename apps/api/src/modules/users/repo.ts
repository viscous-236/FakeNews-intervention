/**
 * apps/api/src/modules/users/repo.ts (TASK-016, TASK-040)
 *
 * SQL repository for users table (GUD-001, GUD-002, PAT-001).
 */

import { type PoolClient } from '../../db/pool.js';
import { getPool } from '../../db/pool.js';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  sigma: string; // numeric as string
  q: string; // numeric as string
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface InsertUserParams {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role?: 'user' | 'admin';
  sigma: number;
}

export async function insertUser(params: InsertUserParams, client?: PoolClient): Promise<UserRow> {
  const executor = client ?? getPool();
  const sql = `
    INSERT INTO users (
      username,
      email,
      password_hash,
      display_name,
      role,
      sigma
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id, username, email, password_hash, display_name, bio,
      avatar_media_id, role, status, sigma, q,
      created_at, updated_at, deleted_at
  `;
  const values = [
    params.username,
    params.email,
    params.passwordHash,
    params.displayName,
    params.role ?? 'user',
    params.sigma.toFixed(3),
  ];
  const res = await executor.query<UserRow>(sql, values);
  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to insert user');
  }
  return row;
}

export async function findUserByUsername(
  username: string,
  client?: PoolClient,
): Promise<UserRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<UserRow>(
    `SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL`,
    [username],
  );
  return res.rows[0] ?? null;
}

export async function findUserById(id: string, client?: PoolClient): Promise<UserRow | null> {
  const executor = client ?? getPool();
  const res = await executor.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export interface UserCounts {
  posts: number;
  followers: number;
  following: number;
}

export async function getUserCounts(userId: string, client?: PoolClient): Promise<UserCounts> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    posts: string;
    followers: string;
    following: string;
  }>(
    `SELECT
      (SELECT count(*) FROM posts WHERE author_id = $1 AND deleted_at IS NULL AND status = 'published') AS posts,
      (SELECT count(*) FROM follows WHERE followee_id = $1) AS followers,
      (SELECT count(*) FROM follows WHERE follower_id = $1) AS following`,
    [userId],
  );
  const row = res.rows[0];
  return {
    posts: parseInt(row?.posts ?? '0', 10),
    followers: parseInt(row?.followers ?? '0', 10),
    following: parseInt(row?.following ?? '0', 10),
  };
}

export interface ViewerRelationship {
  following: boolean;
  blocked: boolean;
}

export async function getViewerRelationship(
  viewerId: string,
  targetId: string,
  client?: PoolClient,
): Promise<ViewerRelationship> {
  const executor = client ?? getPool();
  const res = await executor.query<{
    is_following: boolean;
    is_blocked: boolean;
  }>(
    `SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
      EXISTS(SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)) AS is_blocked`,
    [viewerId, targetId],
  );
  const row = res.rows[0];
  return {
    following: Boolean(row?.is_following),
    blocked: Boolean(row?.is_blocked),
  };
}

export async function checkMediaExists(mediaId: string, client?: PoolClient): Promise<boolean> {
  const executor = client ?? getPool();
  const res = await executor.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM media WHERE id = $1) AS exists`,
    [mediaId],
  );
  return Boolean(res.rows[0]?.exists);
}

export async function updateUserProfile(
  userId: string,
  updates: {
    displayName?: string;
    bio?: string;
    avatarMediaId?: string | null;
  },
  client?: PoolClient,
): Promise<UserRow> {
  const executor = client ?? getPool();
  const setClauses: string[] = ['updated_at = now()'];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.displayName !== undefined) {
    setClauses.push(`display_name = $${idx++}`);
    values.push(updates.displayName);
  }
  if (updates.bio !== undefined) {
    setClauses.push(`bio = $${idx++}`);
    values.push(updates.bio);
  }
  if (updates.avatarMediaId !== undefined) {
    setClauses.push(`avatar_media_id = $${idx++}`);
    values.push(updates.avatarMediaId);
  }

  values.push(userId);
  const sql = `
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${idx}
    RETURNING *
  `;
  const res = await executor.query<UserRow>(sql, values);
  const row = res.rows[0];
  if (!row) {
    throw new Error('User not found');
  }
  return row;
}

export async function anonymizeUser(userId: string, client: PoolClient): Promise<void> {
  // 1. Delete all sessions
  await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

  // 2. Anonymize user row per RUL-022 and SEC-014
  await client.query(
    `UPDATE users
     SET
       username = 'deleted_' || substring(replace(id::text, '-', '') from 1 for 8),
       email = 'deleted+' || id::text || '@invalid.local',
       display_name = 'Deleted user',
       bio = '',
       avatar_media_id = NULL,
       password_hash = 'DELETED_' || gen_random_uuid(),
       status = 'deleted',
       deleted_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

export interface UserExportData {
  exportedAt: string;
  profile: {
    id: string;
    username: string;
    email: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    role: string;
    status: string;
    score: {
      q: string;
      sigma: string;
    };
    createdAt: string;
  };
  posts: Array<{
    id: string;
    kind: string;
    reshareOfPostId: string | null;
    body: string;
    sourceUrl: string | null;
    status: string;
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
  }>;
  comments: Array<{
    id: string;
    postId: string;
    body: string;
    createdAt: string;
    deletedAt: string | null;
  }>;
  likes: Array<{
    postId: string;
    createdAt: string;
    deletedAt: string | null;
  }>;
  follows: {
    following: Array<{
      userId: string;
      createdAt: string;
    }>;
    followers: Array<{
      userId: string;
      createdAt: string;
    }>;
  };
  events: Array<{
    id: string;
    kind: string;
    value: number;
    status: string;
    voidReason: string | null;
    createdAt: string;
  }>;
  ledger: Array<{
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
  }>;
  notifications: Array<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
    readAt: string | null;
  }>;
}

export async function fetchUserExportData(
  user: UserRow,
  s3PublicBaseUrl: string,
  client?: PoolClient,
): Promise<UserExportData> {
  const executor = client ?? getPool();
  const userId = user.id;

  // 1. Posts
  const postsRes = await executor.query<{
    id: string;
    kind: string;
    reshare_of_post_id: string | null;
    body: string;
    source_url: string | null;
    status: string;
    created_at: Date;
    edited_at: Date | null;
    deleted_at: Date | null;
  }>(
    `SELECT id, kind, reshare_of_post_id, body, source_url, status, created_at, edited_at, deleted_at
     FROM posts
     WHERE author_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  // 2. Comments
  const commentsRes = await executor.query<{
    id: string;
    post_id: string;
    body: string;
    created_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT id, post_id, body, created_at, deleted_at
     FROM comments
     WHERE author_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  // 3. Likes (active & retracted per Section 1.7 line 878)
  const likesRes = await executor.query<{
    post_id: string;
    created_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT post_id, created_at, deleted_at
     FROM likes
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  // 4. Follows
  const followingRes = await executor.query<{
    followee_id: string;
    created_at: Date;
  }>(
    `SELECT followee_id, created_at FROM follows WHERE follower_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  const followersRes = await executor.query<{
    follower_id: string;
    created_at: Date;
  }>(
    `SELECT follower_id, created_at FROM follows WHERE followee_id = $1 ORDER BY created_at DESC`,
    [userId],
  );

  // 5. Events
  const eventsRes = await executor.query<{
    id: string;
    kind: string;
    value: number;
    status: string;
    void_reason: string | null;
    created_at: Date;
  }>(
    `SELECT id, kind, value, status, void_reason, created_at
     FROM reputation_events
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  // 6. Ledger
  const ledgerRes = await executor.query<{
    wave_number: number;
    n_pos: number;
    n_neg: number;
    n_adj: number;
    r: number;
    sigma_used: string;
    q_before: string;
    delta: string;
    q_after: string;
    formula_version: string;
    finalized_at: Date | null;
  }>(
    `SELECT
       w.number AS wave_number,
       uwr.n_pos,
       uwr.n_neg,
       uwr.n_adj,
       uwr.r,
       uwr.sigma_used::text,
       uwr.q_before::text,
       uwr.delta::text,
       uwr.q_after::text,
       uwr.formula_version,
       w.finalized_at
     FROM user_wave_reputation uwr
     JOIN waves w ON w.id = uwr.wave_id
     WHERE uwr.user_id = $1
     ORDER BY w.number DESC`,
    [userId],
  );

  // 7. Notifications
  const notifRes = await executor.query<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    created_at: Date;
    read_at: Date | null;
  }>(
    `SELECT id, type, payload, created_at, read_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: user.avatar_media_id ? `${s3PublicBaseUrl}/${user.avatar_media_id}` : null,
      role: user.role,
      status: user.status,
      score: {
        q: parseFloat(user.q).toFixed(3),
        sigma: parseFloat(user.sigma).toFixed(3),
      },
      createdAt: new Date(user.created_at).toISOString(),
    },
    posts: postsRes.rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      reshareOfPostId: p.reshare_of_post_id,
      body: p.body,
      sourceUrl: p.source_url,
      status: p.status,
      createdAt: new Date(p.created_at).toISOString(),
      editedAt: p.edited_at ? new Date(p.edited_at).toISOString() : null,
      deletedAt: p.deleted_at ? new Date(p.deleted_at).toISOString() : null,
    })),
    comments: commentsRes.rows.map((c) => ({
      id: c.id,
      postId: c.post_id,
      body: c.body,
      createdAt: new Date(c.created_at).toISOString(),
      deletedAt: c.deleted_at ? new Date(c.deleted_at).toISOString() : null,
    })),
    likes: likesRes.rows.map((l) => ({
      postId: l.post_id,
      createdAt: new Date(l.created_at).toISOString(),
      deletedAt: l.deleted_at ? new Date(l.deleted_at).toISOString() : null,
    })),
    follows: {
      following: followingRes.rows.map((f) => ({
        userId: f.followee_id,
        createdAt: new Date(f.created_at).toISOString(),
      })),
      followers: followersRes.rows.map((f) => ({
        userId: f.follower_id,
        createdAt: new Date(f.created_at).toISOString(),
      })),
    },
    events: eventsRes.rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      value: e.value,
      status: e.status,
      voidReason: e.void_reason,
      createdAt: new Date(e.created_at).toISOString(),
    })),
    ledger: ledgerRes.rows.map((l) => ({
      waveNumber: l.wave_number,
      nPos: l.n_pos,
      nNeg: l.n_neg,
      nAdj: l.n_adj,
      r: l.r,
      sigmaUsed: parseFloat(l.sigma_used).toFixed(3),
      qBefore: parseFloat(l.q_before).toFixed(3),
      delta: parseFloat(l.delta).toFixed(3),
      qAfter: parseFloat(l.q_after).toFixed(3),
      formulaVersion: l.formula_version,
      finalizedAt: l.finalized_at ? new Date(l.finalized_at).toISOString() : null,
    })),
    notifications: notifRes.rows.map((n) => ({
      id: n.id,
      type: n.type,
      payload: n.payload,
      createdAt: new Date(n.created_at).toISOString(),
      readAt: n.read_at ? new Date(n.read_at).toISOString() : null,
    })),
  };
}
