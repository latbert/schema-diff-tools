import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'node:fs/promises';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  diffSchemas,
  validateInstance,
  SchemaDiffError,
  NOT_SUPPORTED_KEYWORDS,
} from '@nopilot/schema-diff-engine';

export const SERVER_NAME = 'schema-mcp';
export const SERVER_VERSION = '1.0.0';

const MAX_SCHEMA_BYTES = 16 * 1024 * 1024; // 16MB per schema document

function errorPayload(err: unknown) {
  if (err instanceof SchemaDiffError) {
    return { isError: true as const, code: err.code, message: err.message };
  }
  return { isError: true as const, code: 'internal_error', message: String(err) };
}

function text(content: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }] };
}

/** Parse schema input: inline object, inline JSON string, or local file path. */
async function loadSchema(input: unknown, label: string): Promise<unknown> {
  if (typeof input === 'object' && input !== null) return input;
  if (typeof input !== 'string') {
    throw new SchemaDiffError('invalid_schema_input', `${label}: expected an object, a JSON string, or a file path`);
  }
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new SchemaDiffError(
        'invalid_json',
        `${label}: string starts with '{' but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  // file path
  const resolved = path.resolve(trimmed);
  try {
    await access(resolved);
    const s = await stat(resolved);
    if (!s.isFile()) throw new Error('not a regular file');
    if (s.size > MAX_SCHEMA_BYTES) {
      throw new SchemaDiffError('schema_too_large', `${label}: file exceeds ${MAX_SCHEMA_BYTES} bytes`);
    }
    const content = await readFile(resolved, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err instanceof SchemaDiffError) throw err;
    throw new SchemaDiffError(
      'schema_file_unreadable',
      `${label}: cannot read schema from "${trimmed}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const schemaInput = z
  .union([z.string().min(1), z.record(z.string(), z.unknown())])
  .describe(
    'Schema source: an inline JSON Schema object, a JSON string, or a path to a local .json file.',
  );

export function registerSchemaTools(server: McpServer): void {
  server.registerTool(
    'schema_diff',
    {
      title: 'Diff two JSON Schemas',
      description:
        'Diff two JSON Schema versions at path level with breaking-change classification. ' +
        'Breaking: required addition, type narrowing, enum value removal, minimum/maximum/minLength/minItems ' +
        'tightening, pattern change, format change, required-property deletion, additionalProperties restriction, ' +
        'const change. Non-breaking: optional property addition, type widening, constraint removal/loosening, ' +
        'enum addition. Same-document $ref/#definitions/$defs are inlined and tracked; external refs are NEVER ' +
        'fetched (zero network) and reported as not_supported. if/then/else/not/unevaluated* and anyOf/oneOf ' +
        'variant-count changes are explicitly reported not_supported with reasons — never silently ignored. ' +
        'Deterministic: identical inputs give identical output. Pure local computation.',
      inputSchema: {
        old_schema: schemaInput.describe('The old (baseline) schema version'),
        new_schema: schemaInput.describe('The new (candidate) schema version'),
      },
    },
    async ({ old_schema, new_schema }) => {
      try {
        const oldS = await loadSchema(old_schema, 'old_schema');
        const newS = await loadSchema(new_schema, 'new_schema');
        const result = diffSchemas(oldS, newS);
        return text({ ...result, notSupportedKeywords: NOT_SUPPORTED_KEYWORDS });
      } catch (err) {
        return text(errorPayload(err));
      }
    },
  );

  server.registerTool(
    'schema_validate',
    {
      title: 'Validate instance against JSON Schema',
      description:
        'Validate a JSON instance document against a JSON Schema (draft-07 or 2020-12, auto-detected from ' +
        '$schema). Supports same-document $ref and the standard format vocabulary (email, date-time, uri, ...). ' +
        'Returns valid flag plus sorted issues with instancePath/schemaPath/keyword. Deterministic; pure local ' +
        'computation, zero network.',
      inputSchema: {
        schema: schemaInput.describe('The JSON Schema to validate against'),
        instance: z
          .union([z.string().min(1), z.record(z.string(), z.unknown()), z.array(z.unknown())])
          .describe('The instance document: object, array, or a JSON string / local file path'),
      },
    },
    async ({ schema, instance }) => {
      try {
        const s = await loadSchema(schema, 'schema');
        const i = await loadSchema(instance, 'instance');
        return text(validateInstance(s, i));
      } catch (err) {
        return text(errorPayload(err));
      }
    },
  );
}
