import { createRequire } from 'node:module';
import type { ValidationIssue, ValidationResult } from './types.js';
import { SchemaDiffError } from './types.js';

// ajv ships runtime CJS builds whose separately-authored .d.ts entries do not
// play well with ESM default imports; load them through createRequire and
// bridge to minimal structural types (compile + errors is all we use).
const require_ = createRequire(import.meta.url);

interface CompiledValidator {
  (data: unknown): boolean;
  errors: { instancePath: string; schemaPath: string; keyword: string; message?: string; params?: Record<string, unknown> }[] | null;
}

interface AjvLike {
  compile(schema: Record<string, unknown>): CompiledValidator;
}

type AjvCtor = new (opts?: { allErrors?: boolean; strict?: boolean | 'log' }) => AjvLike;

const AjvCtorV7 = require_('ajv/dist/ajv.js') as AjvCtor;
const AjvCtor2020 = require_('ajv/dist/2020.js') as AjvCtor;
const addFormats = require_('ajv-formats') as (ajv: AjvLike, formats?: unknown) => unknown;

export type Dialect = 'draft-07' | '2020-12';

/** Detect the dialect from a $schema URI. Defaults to draft-07 when absent. */
export function detectDialect(schema: unknown): Dialect {
  if (typeof schema === 'object' && schema !== null && '$schema' in schema) {
    const uri = String((schema as Record<string, unknown>)['$schema']);
    if (uri.includes('2020-12')) return '2020-12';
    if (uri.includes('draft-07')) return 'draft-07';
  }
  return 'draft-07';
}

function makeValidator(dialect: Dialect): AjvLike {
  const ajv =
    dialect === '2020-12'
      ? new AjvCtor2020({ allErrors: true, strict: false })
      : new AjvCtorV7({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/**
 * Validate an instance document against a JSON Schema. Same-document $ref and
 * the standard format vocabulary are supported; both draft-07 and 2020-12
 * dialects are compiled with their matching Ajv build.
 */
export function validateInstance(schema: unknown, instance: unknown): ValidationResult {
  if (typeof schema === 'boolean') {
    // trivial boolean schemas need no compiler
    return {
      valid: schema,
      issues: schema
        ? []
        : [
            {
              instancePath: '',
              schemaPath: '',
              keyword: 'boolean-schema',
              message: 'boolean schema `false` rejects every instance',
            },
          ],
    };
  }
  if (typeof schema !== 'object' || schema === null) {
    throw new SchemaDiffError('invalid_schema', 'Schema must be an object or boolean');
  }
  const ajv = makeValidator(detectDialect(schema));
  let validate: CompiledValidator;
  try {
    validate = ajv.compile(schema as Record<string, unknown>);
  } catch (err) {
    throw new SchemaDiffError(
      'schema_compile_failed',
      `Schema failed to compile: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const valid = Boolean(validate(instance));
  const rawErrors = (validate as { errors?: CompiledValidator['errors'] }).errors ?? [];
  const issues: ValidationIssue[] = rawErrors.map((e) => ({
    instancePath: e.instancePath,
    schemaPath: e.schemaPath,
    keyword: e.keyword,
    message: e.message ?? '',
    ...(e.params ? { params: e.params } : {}),
  }));
  // deterministic order: by instancePath then keyword
  issues.sort((a, b) => (a.instancePath + a.keyword).localeCompare(b.instancePath + b.keyword));
  return { valid, issues };
}
