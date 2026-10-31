/**
 * apps/api/test/db/enum-parity.test.ts (TASK-018, TEST-104)
 *
 * Parses CHECK constraints from migration SQL files and asserts parity
 * with TypeScript enum arrays in packages/shared/src/enums.ts.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as sharedEnums from '@app/shared';

const migrationsDir = path.resolve(__dirname, '../../src/db/migrations');

function getMigrationSql(): string {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  return files.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf-8')).join('\n');
}

function getTableSql(allSql: string, tableName: string): string {
  const regex = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${tableName}\\s*\\(([\\s\\S]*?)\\);`, 'i');
  const match = allSql.match(regex);
  if (!match || !match[1]) {
    throw new Error(`Table ${tableName} not found in SQL`);
  }
  return match[1];
}

function extractColumnEnum(tableSql: string, columnName: string): string[] {
  const regex = new RegExp(`${columnName}[^)]*?IN\\s*\\(([^)]+)\\)`, 'i');
  const match = tableSql.match(regex);
  if (!match || !match[1]) {
    throw new Error(`Column ${columnName} enum CHECK not found`);
  }
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"\s]+|['"\s]+$/g, ''))
    .filter(Boolean);
}

describe('Enum Parity with Database Migrations (TEST-104)', () => {
  const allSql = getMigrationSql();

  it('users.role matches userRoleValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'users'), 'role');
    expect(vals).toEqual([...sharedEnums.userRoleValues]);
  });

  it('users.status matches userStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'users'), 'status');
    expect(vals).toEqual([...sharedEnums.userStatusValues]);
  });

  it('media.kind matches mediaKindValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'media'), 'kind');
    expect(vals).toEqual([...sharedEnums.mediaKindValues]);
  });

  it('media.content_type matches mediaContentTypeValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'media'), 'content_type');
    expect(vals).toEqual([...sharedEnums.mediaContentTypeValues]);
  });

  it('email_tokens.purpose matches emailTokenPurposeValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'email_tokens'), 'purpose');
    expect(vals).toEqual([...sharedEnums.emailTokenPurposeValues]);
  });

  it('email_outbox.status matches emailOutboxStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'email_outbox'), 'status');
    expect(vals).toEqual([...sharedEnums.emailOutboxStatusValues]);
  });

  it('posts.kind matches postKindValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'posts'), 'kind');
    expect(vals).toEqual([...sharedEnums.postKindValues]);
  });

  it('posts.status matches postStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'posts'), 'status');
    expect(vals).toEqual([...sharedEnums.postStatusValues]);
  });

  it('posts.author_tier_at_post matches tierValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'posts'), 'author_tier_at_post');
    expect(vals).toEqual([...sharedEnums.tierValues]);
  });

  it('detection_results.status matches detectionStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'detection_results'), 'status');
    expect(vals).toEqual([...sharedEnums.detectionStatusValues]);
  });

  it('detection_results.band matches detectionBandValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'detection_results'), 'band');
    expect(vals).toEqual([...sharedEnums.detectionBandValues]);
  });

  it('waves.status matches waveStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'waves'), 'status');
    expect(vals).toEqual([...sharedEnums.waveStatusValues]);
  });

  it('reports.reason matches reportReasonValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'reports'), 'reason');
    expect(vals).toEqual([...sharedEnums.reportReasonValues]);
  });

  it('reports.status matches reportStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'reports'), 'status');
    expect(vals).toEqual([...sharedEnums.reportStatusValues]);
  });

  it('assessments.verdict matches assessmentVerdictValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'assessments'), 'verdict');
    expect(vals).toEqual([...sharedEnums.assessmentVerdictValues]);
  });

  it('assessments.source matches assessmentSourceValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'assessments'), 'source');
    expect(vals).toEqual([...sharedEnums.assessmentSourceValues]);
  });

  it('reputation_events.kind has all 7 kinds matching reputationEventKindValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'reputation_events'), 'kind');
    expect(vals).toHaveLength(7);
    expect(vals).toEqual([...sharedEnums.reputationEventKindValues]);
  });

  it('reputation_events.status matches reputationEventStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'reputation_events'), 'status');
    expect(vals).toEqual([...sharedEnums.reputationEventStatusValues]);
  });

  it('reputation_events.void_reason has all 3 reasons matching voidReasonValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'reputation_events'), 'void_reason');
    expect(vals).toHaveLength(3);
    expect(vals).toEqual([...sharedEnums.voidReasonValues]);
  });

  it('appeals.status matches appealStatusValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'appeals'), 'status');
    expect(vals).toEqual([...sharedEnums.appealStatusValues]);
  });

  it('admin_audit_log.actor_kind matches auditActorKindValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'admin_audit_log'), 'actor_kind');
    expect(vals).toEqual([...sharedEnums.auditActorKindValues]);
  });

  it('notifications.type matches notificationTypeValues', () => {
    const vals = extractColumnEnum(getTableSql(allSql, 'notifications'), 'type');
    expect(vals).toEqual([...sharedEnums.notificationTypeValues]);
  });
});
