/**
 * OpenAPI 3.1 contract staleness and schema validation test (REQ-034, TASK-075).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { generateOpenApiYaml } from '../../../scripts/generate-openapi.js';

function getOpenApiPath(): string {
  const rootPath = resolve(process.cwd(), 'docs/openapi.yaml');
  if (existsSync(rootPath)) return rootPath;
  const subPath = resolve(process.cwd(), '../../docs/openapi.yaml');
  if (existsSync(subPath)) return subPath;
  return resolve(__dirname, '../../../docs/openapi.yaml');
}

describe('OpenAPI Specification (REQ-034)', () => {
  it('docs/openapi.yaml exists and is up to date with generator', () => {
    const yamlPath = getOpenApiPath();
    const existingContent = readFileSync(yamlPath, 'utf-8');
    const freshGenerated = generateOpenApiYaml();

    expect(existingContent).toBe(freshGenerated);
  });

  it('parses valid OpenAPI 3.1.0 document with all required root keys', () => {
    const yamlPath = getOpenApiPath();
    const doc = yaml.load(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toBeDefined();
    expect(doc.servers).toBeDefined();
    expect(doc.paths).toBeDefined();
    expect(doc.components).toBeDefined();
    expect(Object.keys(doc.paths as object).length).toBeGreaterThanOrEqual(70);
  });
});
