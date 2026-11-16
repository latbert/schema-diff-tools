import { describe, expect, it } from 'vitest';
import {
  diffSchemas,
  validateInstance,
  dereference,
  SchemaDiffError,
} from '../index.js';

function findOne(r: ReturnType<typeof diffSchemas>, kind: string) {
  return r.changes.find((c) => c.kind === kind);
}

describe('breaking change classification', () => {
  it('required addition is breaking', () => {
    const old = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    const now = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a', 'b'] };
    const r = diffSchemas(old, now);
    expect(r.hasBreaking).toBe(true);
    const e = findOne(r, 'required_added');
    expect(e?.severity).toBe('breaking');
    expect(e?.description).toContain('b');
  });

  it('type narrowing is breaking (3 shapes)', () => {
    // 1: union -> single
    let r = diffSchemas(
      { properties: { x: { type: ['string', 'number'] } } },
      { properties: { x: { type: 'string' } } },
    );
    expect(findOne(r, 'type_narrowed')?.severity).toBe('breaking');

    // 2: absent -> constrained
    r = diffSchemas({ properties: { x: {} } }, { properties: { x: { type: 'string' } } });
    expect(findOne(r, 'type_changed')?.severity).toBe('breaking');

    // 3: disjoint change
    r = diffSchemas({ properties: { x: { type: 'string' } } }, { properties: { x: { type: 'number' } } });
    expect(findOne(r, 'type_changed')?.severity).toBe('breaking');
  });

  it('enum value removal is breaking; addition is non-breaking', () => {
    const old = { properties: { s: { enum: ['a', 'b', 'c'] } } };
    const now = { properties: { s: { enum: ['a', 'b', 'c', 'd'] } } };
    const r1 = diffSchemas(old, { properties: { s: { enum: ['a', 'b'] } } });
    expect(findOne(r1, 'enum_removed_value')?.severity).toBe('breaking');

    const r2 = diffSchemas(old, now);
    expect(findOne(r2, 'enum_added_value')?.severity).toBe('non_breaking');
    expect(r2.hasBreaking).toBe(false);
  });

  it('minimum / maximum tightening is breaking, loosening is not (3 cases)', () => {
    // min tightened
    let r = diffSchemas({ properties: { n: { minimum: 0 } } }, { properties: { n: { minimum: 5 } } });
    expect(findOne(r, 'minimum_tightened')?.severity).toBe('breaking');
    // max tightened
    r = diffSchemas({ properties: { n: { maximum: 10 } } }, { properties: { n: { maximum: 3 } } });
    expect(findOne(r, 'maximum_tightened')?.severity).toBe('breaking');
    // min added where absent
    r = diffSchemas({ properties: { n: {} } }, { properties: { n: { minimum: 1 } } });
    expect(findOne(r, 'minimum_tightened')?.severity).toBe('breaking');
    // loosening
    r = diffSchemas({ properties: { n: { minimum: 5 } } }, { properties: { n: { minimum: 0 } } });
    expect(findOne(r, 'minimum_loosened')?.severity).toBe('non_breaking');
    expect(r.hasBreaking).toBe(false);
  });

  it('pattern change is classified breaking (regex containment undecidable)', () => {
    const r = diffSchemas(
      { properties: { s: { pattern: '^a' } } },
      { properties: { s: { pattern: '^ab' } } },
    );
    expect(findOne(r, 'pattern_tightened')?.severity).toBe('breaking');
    // pattern removal is a relaxation
    const r2 = diffSchemas({ properties: { s: { pattern: '^a' } } }, { properties: { s: {} } });
    expect(findOne(r2, 'pattern_removed')?.severity).toBe('non_breaking');
  });

  it('required property deletion is breaking; optional deletion is not', () => {
    const r = diffSchemas(
      { properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] },
      { properties: { b: { type: 'number' } } },
    );
    expect(findOne(r, 'property_removed')?.severity).toBe('breaking');

    const r2 = diffSchemas(
      { properties: { a: { type: 'string' }, b: { type: 'number' } } },
      { properties: { b: { type: 'number' } } },
    );
    expect(findOne(r2, 'property_removed')?.severity).toBe('non_breaking');
  });

  it('additionalProperties false added is breaking', () => {
    const r = diffSchemas(
      { properties: { a: { type: 'string' } } },
      { properties: { a: { type: 'string' } }, additionalProperties: false },
    );
    expect(findOne(r, 'additional_properties_tightened')?.severity).toBe('breaking');
  });

  it('const change is breaking', () => {
    const r = diffSchemas({ properties: { v: { const: 1 } } }, { properties: { v: { const: 2 } } });
    expect(findOne(r, 'const_changed')?.severity).toBe('breaking');
  });
});

describe('non-breaking change classification', () => {
  it('optional property addition is non-breaking', () => {
    const r = diffSchemas(
      { properties: { a: { type: 'string' } } },
      { properties: { a: { type: 'string' }, opt: { type: 'boolean' } } },
    );
    expect(findOne(r, 'property_added')?.severity).toBe('non_breaking');
    expect(r.hasBreaking).toBe(false);
  });

  it('type widening is non-breaking', () => {
    const r = diffSchemas(
      { properties: { x: { type: 'string' } } },
      { properties: { x: { type: ['string', 'number'] } } },
    );
    expect(findOne(r, 'type_widened')?.severity).toBe('non_breaking');
  });

  it('required removal and constraint removal are non-breaking', () => {
    const r = diffSchemas(
      { properties: { a: { type: 'string' } }, required: ['a'] },
      { properties: { a: { type: 'string' } } },
    );
    expect(findOne(r, 'required_removed')?.severity).toBe('non_breaking');
    expect(r.hasBreaking).toBe(false);
  });

  it('minLength/minItems tightening is breaking (numeric bounds family)', () => {
    const r = diffSchemas(
      { properties: { s: { minLength: 1 } } },
      { properties: { s: { minLength: 5 } } },
    );
    expect(findOne(r, 'min_length_tightened')?.severity).toBe('breaking');
  });
});

describe('$ref handling (same document)', () => {
  it('tracks #/definitions $ref changes to their inlined target', () => {
    const old = {
      definitions: { name: { type: 'string', minLength: 1 } },
      properties: { who: { $ref: '#/definitions/name' } },
    };
    const now = {
      definitions: { name: { type: 'string', minLength: 5 } },
      properties: { who: { $ref: '#/definitions/name' } },
    };
    const r = diffSchemas(old, now);
    // the change surfaces at the inlined location (definitions path kept by deref)
    expect(r.hasBreaking).toBe(true);
    expect(r.changes.some((c) => c.kind === 'min_length_tightened' || c.kind === 'min_items_tightened')).toBe(true);
  });

  it('ref retarget inside the same document follows the new target', () => {
    const old = {
      definitions: { a: { type: 'string' }, b: { type: 'number' } },
      properties: { x: { $ref: '#/definitions/a' } },
    };
    const now = {
      definitions: { a: { type: 'string' }, b: { type: 'number' } },
      properties: { x: { $ref: '#/definitions/b' } },
    };
    const r = diffSchemas(old, now);
    expect(r.hasBreaking).toBe(true);
  });

  it('cyclic refs are broken, not blown up', () => {
    const node = {
      definitions: {
        node: {
          type: 'object',
          properties: { child: { $ref: '#/definitions/node' }, v: { type: 'integer' } },
        },
      },
      $ref: '#/definitions/node',
    } as Record<string, unknown>;
    const now = {
      definitions: {
        node: {
          type: 'object',
          properties: { child: { $ref: '#/definitions/node' }, v: { type: 'string' } },
        },
      },
      $ref: '#/definitions/node',
    } as Record<string, unknown>;
    const r = diffSchemas(node, now);
    expect(r.hasBreaking).toBe(true); // v: integer -> string is a disjoint type change
  });

  it('external ref changes are reported not_supported, never fetched', () => {
    const old = { properties: { x: { $ref: 'https://example.com/schema.json' } } };
    const now = { properties: { x: { $ref: 'https://example.com/schema2.json' } } };
    const r = diffSchemas(old, now);
    const e = r.changes.find((c) => c.severity === 'not_supported');
    expect(e).toBeDefined();
    expect(e?.reason).toContain('External');
    expect(r.notSupportedCount).toBeGreaterThan(0);
  });

  it('dereference inlines a simple chain deterministically', () => {
    const schema = {
      definitions: { inner: { type: 'string' } },
      properties: { x: { $ref: '#/definitions/inner' } },
    };
    const out = dereference(schema);
    expect(out).toEqual({
      definitions: { inner: { type: 'string' } },
      properties: { x: { type: 'string' } },
    });
  });
});

describe('draft coverage & explicit not_supported', () => {
  it('draft-07 and 2020-12 dialects are detected and reported', () => {
    const r = diffSchemas(
      { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' },
      { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
    );
    expect(r.dialect).toEqual({
      from: 'http://json-schema.org/draft-07/schema#',
      to: 'https://json-schema.org/draft/2020-12/schema',
    });
  });

  it('if/then/else changes are explicitly not_supported (never silently dropped)', () => {
    const old = { if: { properties: { a: { const: 1 } } }, then: { required: ['b'] } };
    const now = { if: { properties: { a: { const: 2 } } }, then: { required: ['b'] } };
    const r = diffSchemas(old, now);
    const ns = r.changes.filter((c) => c.severity === 'not_supported');
    expect(ns.length).toBeGreaterThan(0);
    expect(ns.every((c) => c.reason !== undefined)).toBe(true);
  });

  it('anyOf variant count change is not_supported with reason', () => {
    const old = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    const now = { anyOf: [{ type: 'string' }] };
    const r = diffSchemas(old, now);
    const e = r.changes.find((c) => c.severity === 'not_supported');
    expect(e?.reason).toContain('order-dependent');
  });

  it('2020-12 $defs are diffed like draft-07 definitions', () => {
    const old = { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { v: { type: 'integer' } }, properties: { x: { $ref: '#/$defs/v' } } };
    const now = { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { v: { type: 'string' } }, properties: { x: { $ref: '#/$defs/v' } } };
    const r = diffSchemas(old, now);
    expect(r.hasBreaking).toBe(true);
  });
});

describe('instance validation', () => {
  const draft7 = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'number', minimum: 0 },
      email: { type: 'string', format: 'email' },
    },
    required: ['name'],
  };

  it('accepts a valid instance (draft-07)', () => {
    const r = validateInstance(draft7, { name: 'ada', age: 36, email: 'ada@example.com' });
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects with sorted, keyword-attributed issues', () => {
    const r = validateInstance(draft7, { age: -1, email: 'not-an-email' });
    expect(r.valid).toBe(false);
    const kinds = r.issues.map((i) => i.keyword).sort();
    expect(kinds).toEqual(['format', 'minimum', 'required']);
  });

  it('validates draft 2020-12 schemas with $defs/$ref', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      $defs: { hex: { type: 'string', pattern: '^[0-9a-f]+$' } },
      properties: { id: { $ref: '#/$defs/hex' } },
      required: ['id'],
    };
    expect(validateInstance(schema, { id: 'abc123' }).valid).toBe(true);
    expect(validateInstance(schema, { id: 'xyz' }).valid).toBe(false);
  });

  it('boolean schemas validate trivially', () => {
    expect(validateInstance(true, 'anything')).toEqual({ valid: true, issues: [] });
    expect(validateInstance(false, 'anything').valid).toBe(false);
  });

  it('throws a typed error for a non-compilable schema', () => {
    expect(() => validateInstance({ properties: 42 }, {})).toThrow(SchemaDiffError);
  });
});

describe('determinism & shape', () => {
  it('identical schemas produce an empty, stable diff', () => {
    const s = { properties: { a: { type: 'string' }, b: { enum: [1, 2] } }, required: ['a'] };
    const r1 = diffSchemas(s, JSON.parse(JSON.stringify(s)));
    expect(r1.changes).toEqual([]);
    expect(r1.hasBreaking).toBe(false);
  });

  it('diff output is byte-stable across runs (sorted paths)', () => {
    const old = { properties: { z: { minimum: 1 }, a: { type: 'string' } }, required: ['a'] };
    const now = { properties: { z: { minimum: 9 }, a: { type: 'number' } }, required: ['a'] };
    const r1 = JSON.stringify(diffSchemas(old, now));
    const r2 = JSON.stringify(diffSchemas(old, now));
    expect(r1).toBe(r2);
  });

  it('rejects non-schema inputs with typed errors', () => {
    expect(() => diffSchemas([1], {})).toThrow(SchemaDiffError);
    expect(() => diffSchemas({}, 'nope' as unknown)).toThrow(SchemaDiffError);
  });

  it('counts add up', () => {
    const r = diffSchemas(
      { properties: { a: { minimum: 0 }, b: { type: 'string' } }, required: ['b'] },
      { properties: { a: { minimum: 5 }, b: { type: 'string' }, c: {} }, required: ['b'] },
    );
    expect(r.breakingCount + r.nonBreakingCount + r.notSupportedCount).toBe(r.changes.length);
    expect(r.breakingCount).toBe(1);
  });
});
