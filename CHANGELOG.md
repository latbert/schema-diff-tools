# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-17

### Added

- `schema_diff`: path-level diff between two JSON Schema versions with breaking-change classification — required additions, type narrowing/changes, enum value removals, minimum/maximum/minLength/minItems tightening, pattern changes (conservatively breaking; regex containment is undecidable), format changes, required-property deletion, `additionalProperties` restriction, `const` changes → breaking; optional property additions, type widening, constraint removal/loosening, enum additions → non-breaking.
- Same-document `$ref` / `#definitions` / `$defs` inlining with cycle breaking; changes inside referenced targets are tracked to their inlined locations. External refs are never fetched (zero-network contract) and reported `not_supported`.
- Explicit `not_supported` reporting — never silent mislabeling — for `if`/`then`/`else`/`not`/`unevaluated*` subtrees, `anyOf`/`oneOf`/`allOf` variant-count changes, `$id` changes, and external/dangling refs.
- `schema_validate`: instance validation for draft-07 and 2020-12 (auto-detected), with same-document `$ref` and the standard format vocabulary; sorted issues with instancePath/schemaPath/keyword.
- `schema-mcp` MCP server (stdio + stateless Streamable HTTP), built on the official MCP TypeScript SDK. Pure local computation: zero network calls, zero LLM, zero external data sources.
- Determinism harness: identical inputs always produce byte-identical output (`scripts/determinism-check.mjs`).
