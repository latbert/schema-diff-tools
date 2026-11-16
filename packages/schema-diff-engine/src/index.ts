import type { DiffEntry, DiffResult } from './types.js';
import { dereference, diffNodes } from './diff.js';
import { detectDialect } from './validate.js';
import { SchemaDiffError } from './types.js';

const DRAFT_07_URI = 'http://json-schema.org/draft-07/schema#';
const DRAFT_2020_12_URI = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Diff two JSON Schema documents at path level, with breaking-change
 * classification. Same-document $ref/#definitions/$defs are inlined before
 * diffing; external refs are never fetched (zero network by contract) and
 * changes to them are reported as not_supported.
 *
 * Deterministic: changes are sorted by (path, kind) and the diff of identical
 * inputs is always empty.
 */
export function diffSchemas(oldSchema: unknown, newSchema: unknown): DiffResult {
  if (
    (typeof oldSchema !== 'object' || oldSchema === null || Array.isArray(oldSchema)) &&
    typeof oldSchema !== 'boolean'
  ) {
    throw new SchemaDiffError('invalid_schema', 'old schema must be an object or boolean');
  }
  if (
    (typeof newSchema !== 'object' || newSchema === null || Array.isArray(newSchema)) &&
    typeof newSchema !== 'boolean'
  ) {
    throw new SchemaDiffError('invalid_schema', 'new schema must be an object or boolean');
  }

  const dialectFrom = detectDialect(oldSchema) === '2020-12' ? DRAFT_2020_12_URI : DRAFT_07_URI;
  const dialectTo = detectDialect(newSchema) === '2020-12' ? DRAFT_2020_12_URI : DRAFT_07_URI;

  // boolean edge cases
  if (typeof oldSchema === 'boolean' || typeof newSchema === 'boolean') {
    const changes: DiffEntry[] = [];
    if (oldSchema === newSchema) {
      return { changes, breakingCount: 0, nonBreakingCount: 0, notSupportedCount: 0, hasBreaking: false, dialect: { from: dialectFrom, to: dialectTo } };
    }
    if (oldSchema === true && newSchema === false) {
      changes.push({ path: '', kind: 'schema_removed', severity: 'breaking', description: 'schema changed from true (accept all) to false (accept none)' });
    } else if (oldSchema === false && newSchema === true) {
      changes.push({ path: '', kind: 'schema_added', severity: 'non_breaking', description: 'schema changed from false (accept none) to true (accept all)' });
    } else if (typeof oldSchema === 'boolean') {
      // boolean -> object
      changes.push(
        oldSchema
          ? { path: '', kind: 'schema_added', severity: 'breaking', description: 'schema changed from true (unconstrained) to an object schema' }
          : { path: '', kind: 'schema_added', severity: 'non_breaking', description: 'schema changed from false to an object schema' },
      );
    } else {
      changes.push(
        newSchema === true
          ? { path: '', kind: 'schema_removed', severity: 'non_breaking', description: 'object schema replaced by true (unconstrained)' }
          : { path: '', kind: 'schema_removed', severity: 'breaking', description: 'object schema replaced by false (accept none)' },
      );
    }
    return {
      changes,
      breakingCount: changes.filter((c) => c.severity === 'breaking').length,
      nonBreakingCount: changes.filter((c) => c.severity === 'non_breaking').length,
      notSupportedCount: 0,
      hasBreaking: changes.some((c) => c.severity === 'breaking'),
      dialect: { from: dialectFrom, to: dialectTo },
    };
  }

  const oldResolved = dereference(oldSchema);
  const newResolved = dereference(newSchema);
  const changes: DiffEntry[] = [];
  diffNodes(oldResolved, newResolved, '', changes, { propertiesMode: true });
  changes.sort((a, b) => (a.path + '\u0000' + a.kind).localeCompare(b.path + '\u0000' + b.kind));

  return {
    changes,
    breakingCount: changes.filter((c) => c.severity === 'breaking').length,
    nonBreakingCount: changes.filter((c) => c.severity === 'non_breaking').length,
    notSupportedCount: changes.filter((c) => c.severity === 'not_supported').length,
    hasBreaking: changes.some((c) => c.severity === 'breaking'),
    dialect: { from: dialectFrom, to: dialectTo },
  };
}

// Public API barrel: engine entrypoint re-exports the full surface.
export { validateInstance, detectDialect } from './validate.js';
export type { Dialect } from './validate.js';
export { dereference, resolvePointer, collectRefs } from './diff.js';
export { classifyKeywordChange, isUnsupportedKeyword, NOT_SUPPORTED_KEYWORDS } from './classify.js';
export { SchemaDiffError } from './types.js';
export type {
  ChangeKind,
  Severity,
  ValidationIssue,
  ValidationResult,
} from './types.js';
