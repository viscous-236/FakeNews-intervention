/**
 * apps/api/test/middleware/validate.test.ts (TASK-037)
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate.js';
import { errorHandler } from '../../src/middleware/errors.js';

describe('validate middleware (REQ-010)', () => {
  const schema = z.object({
    username: z.string().min(3),
    count: z.number().int().positive(),
  }).strict();

  const app = express();
  app.use(express.json());
  app.post('/validate-body', validate({ body: schema }), (req, res) => {
    res.json({ data: req.body });
  });

  const querySchema = z.object({
    page: z.string().regex(/^\d+$/),
  });
  app.get('/validate-query', validate({ query: querySchema }), (req, res) => {
    res.json({ query: req.query });
  });

  app.use(errorHandler);
  const request = supertest(app);

  it('passes on valid request body', async () => {
    const res = await request
      .post('/validate-body')
      .send({ username: 'alice', count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ username: 'alice', count: 5 });
  });

  it('rejects with 400 VALIDATION_ERROR and field details on invalid body', async () => {
    const res = await request
      .post('/validate-body')
      .send({ username: 'a', count: -1, extraKey: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toBeDefined();
    expect(res.body.error.details.fields.username).toBeDefined();
    expect(res.body.error.details.fields.count).toBeDefined();
    expect(res.body.error.details.fields.extraKey).toBeDefined();
  });

  it('validates query parameters', async () => {
    const valid = await request.get('/validate-query?page=2');
    expect(valid.status).toBe(200);

    const invalid = await request.get('/validate-query?page=abc');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});
