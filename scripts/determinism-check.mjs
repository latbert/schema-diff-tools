#!/usr/bin/env node
// Determinism harness: run diff + validate twice on identical inputs and
// assert byte-equal JSON output. Zero network. Exits non-zero on mismatch.
import { diffSchemas, validateInstance } from '../packages/schema-diff-engine/dist/index.js';

let failures = 0;

function check(name, a, b) {
  const ok = a === b;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' (outputs differ between runs)'}`);
}

const oldSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  definitions: { id: { type: 'string', pattern: '^[0-9]+$' } },
  type: 'object',
  properties: {
    id: { $ref: '#/definitions/id' },
    count: { type: 'integer', minimum: 0 },
    state: { enum: ['new', 'open', 'closed'] },
  },
  required: ['id'],
};

const newSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  definitions: { id: { type: 'string', pattern: '^[0-9a-f]+$' } },
  type: 'object',
  properties: {
    id: { $ref: '#/definitions/id' },
    count: { type: 'integer', minimum: 1 },
    state: { enum: ['open', 'closed'] },
    assignee: { type: 'string' },
  },
  required: ['id', 'count'],
};

const instance = { id: '123', count: 0, extra: true };

const cases = [
  ['diff (breaking-heavy pair)', () => JSON.stringify(diffSchemas(oldSchema, newSchema))],
  ['diff (identical pair)', () => JSON.stringify(diffSchemas(oldSchema, JSON.parse(JSON.stringify(oldSchema))))],
  ['validate (valid instance)', () => JSON.stringify(validateInstance(oldSchema, { id: '42' }))],
  ['validate (invalid instance)', () => JSON.stringify(validateInstance(newSchema, instance))],
];

for (const [name, fn] of cases) {
  const [x, y] = [fn(), fn()];
  check(name, x, y);
}

console.log(failures === 0 ? 'determinism: ALL PASS' : `determinism: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
