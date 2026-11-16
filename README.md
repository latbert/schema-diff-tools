# schema-diff-tools

Deterministic JSON Schema tools for agents and humans: **path-level diff + breaking-change classification + instance validation**, as an npm engine (`@nopilot/schema-diff-engine`) plus a local-first MCP server (`@nopilot/schema-mcp`).

**Why not just "ask the model"?** LLMs are famously unreliable at "is this schema change backwards-compatible?" — they miss nested `required` additions and misjudge type narrowing. This engine answers deterministically: same input → byte-identical output, every time.

## The local-first difference

The npm side proves the demand (`json-schema-diff`: ~270k weekly downloads); the MCP side is nearly empty — the closest existing server sees ~36 weekly visitors and validates single schemas only. Most hosted API-diff services upload your schemas to their gateway. Proprietary API contracts should not take that trip.

`schema-mcp` runs **entirely on your machine**:

| | hosted schema-diff services | schema-mcp |
|---|---|---|
| Where your schemas go | uploaded to their API | never leave the process |
| Works offline | no | yes |
| Breaking-change classification | varies | deterministic, path-level |
| `$ref` handling | often server-side fetch | same-document only, zero network |
| Source available | mostly closed | MIT, full tests |

Three hard guarantees (enforced by design and tests):

1. **Deterministic action tools, not AI wrappers** — no LLM calls anywhere; identical input produces identical output.
2. **Pure local computation** — zero network requests (external `$ref`s are reported `not_supported`, never fetched), zero external data sources; the whole test suite runs offline.
3. **Runs locally, no hosted gateway** — stdio or localhost HTTP, bind 127.0.0.1 by default.

## Tools (MCP)

### `schema_diff`

Two schema versions in → classified change list out. Each entry: path (JSON-pointer style), kind, severity (`breaking` / `non_breaking` / `not_supported`), description, old/new values.

Breaking: required addition, type narrowing or disjoint type change, enum value removal, minimum/maximum/minLength/minItems tightening, pattern change (conservatively breaking — regex re-acceptance is undecidable), format change/addition, required-property deletion, `additionalProperties` restriction, `const` change.

Non-breaking: optional property addition, type widening, constraint removal/loosening, enum addition, required removal.

**`not_supported` is explicit, never silent**: `if`/`then`/`else`/`not`/`unevaluated*` subtrees (severity depends on evaluation order), `anyOf`/`oneOf`/`allOf` variant-count changes (index-wise diff is meaningless), `$id` changes, external/dangling refs. Each carries a `reason`.

Same-document `$ref` / `#definitions` / `$defs` are inlined before diffing (cycles broken), so changes inside a `$ref` target are attributed to the referencing paths too.

### `schema_validate`

Validate an instance document against a schema (draft-07 or 2020-12, auto-detected from `$schema`). Same-document `$ref` and standard formats (email, date-time, uri, …) supported. Sorted issues with `instancePath`/`schemaPath`/`keyword`.

## Install & run

```bash
npm install -g @nopilot/schema-mcp
schema-mcp                          # stdio (default)
schema-mcp --transport http --port 9430   # stateless Streamable HTTP on 127.0.0.1
```

MCP client config (stdio):

```json
{
  "mcpServers": {
    "schema": { "command": "schema-mcp" }
  }
}
```

## Engine usage (npm)

```js
import { diffSchemas, validateInstance } from '@nopilot/schema-diff-engine';

const r = diffSchemas(oldSchema, newSchema);
// → { changes: [{ path: '/properties/age/minimum', kind: 'minimum_tightened',
//     severity: 'breaking', description, old: 0, new: 18 }],
//     hasBreaking: true, breakingCount, nonBreakingCount, notSupportedCount,
//     dialect: { from, to } }

validateInstance(schema, { id: 'abc' });  // → { valid, issues: [...] }
```

Inputs may be objects, JSON strings, or local file paths (MCP layer).

## Development

```bash
npm install
npm test              # build + typecheck + 36 vitest tests + determinism harness
npm run determinism   # byte-equality spot checks only
npm run publish:dry   # npm publish --dry-run for both packages
```

## Dependencies & licenses

Runtime dependencies (mature, permissive, maintained; no GPL/AGPL anywhere in the tree):

| package | version | license | role |
|---|---|---|---|
| ajv | ^8.20.0 | MIT | JSON Schema validation engine (draft-07 + 2020-12 builds) |
| ajv-formats | ^3.0.1 | MIT | standard format vocabulary for ajv |
| @modelcontextprotocol/sdk | ^1.32.2 | MIT | official MCP TypeScript SDK (server only) |
| zod | ^4.6.7 | MIT | tool input schema |
| express | ^5.2.1 | MIT | HTTP transport host |

All transitive runtime dependencies are MIT/Apache-2.0/ISC. (Diff/classification logic is dependency-free — first-party code only; ajv powers `schema_validate`.)

License of this project: **MIT** (see [LICENSE](./LICENSE)).

## Publishing

This repo ships to **zero** registries by itself. See [PUBLISH.md](./PUBLISH.md) for the manual npm publish + MCP registry submission steps.
