import type { DiffEntry } from './types.js';

/**
 * Minimal JSON pointer escape (RFC 6901).
 */
export function escapePointer(part: string): string {
  return part.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function joinPath(base: string, part: string): string {
  return base === '' ? `/${escapePointer(part)}` : `${base}/${escapePointer(part)}`;
}

/**
 * Resolve a JSON pointer (or full URI with fragment) against a root document.
 * Returns undefined for unresolvable refs (caller decides how to report).
 */
export function resolvePointer(root: unknown, pointer: string): unknown {
  const frag = pointer.startsWith('#') ? pointer.slice(1) : pointer;
  if (frag === '' || frag === '/') return root;
  const parts = frag.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Collect every $ref string reachable from a node (first N, for cycle guard). */
export function collectRefs(node: unknown, acc: string[] = [], depth = 0): string[] {
  if (depth > 32 || acc.length > 1000) return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc, depth + 1);
    return acc;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        if (!acc.includes(value)) acc.push(value);
      } else {
        collectRefs(value, acc, depth + 1);
      }
    }
  }
  return acc;
}

/**
 * Inline same-document $ref resolution with cycle breaking.
 * - Only "#..." fragment refs pointing inside the same document are resolved.
 * - External refs (http(s)://, other fragments) are NOT fetched (zero network);
 *   nodes behind them are compared by their raw ref string and flagged
 *   not_supported when they change.
 * - Cycles are broken by leaving a "#$ref:<target>" placeholder leaf.
 */
export function dereference(
  schema: unknown,
  root: unknown = schema,
  seen: Set<unknown> = new Set(),
): unknown {
  if (Array.isArray(schema)) {
    if (seen.has(schema)) return '#$cycle';
    seen.add(schema);
    const out = schema.map((item) => dereference(item, root, seen));
    seen.delete(schema);
    return out;
  }
  if (typeof schema === 'object' && schema !== null) {
    const obj = schema as Record<string, unknown>;
    if (typeof obj['$ref'] === 'string' && Object.keys(obj).length === 1) {
      const ref = obj['$ref'];
      if (!ref.startsWith('#')) {
        // external ref: keep as opaque leaf (zero network by contract)
        return { '$external-ref': ref };
      }
      const target = resolvePointer(root, ref);
      if (target === undefined) {
        return { '$dangling-ref': ref };
      }
      if (seen.has(obj)) return '#$cycle';
      seen.add(obj);
      const resolved = dereference(target, root, seen);
      seen.delete(obj);
      return resolved;
    }
    if (seen.has(schema)) return '#$cycle';
    seen.add(schema);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = dereference(value, root, seen);
    }
    seen.delete(schema);
    return out;
  }
  return schema;
}

/**
 * Diff two dereferenced schema trees node by node, emitting classified
 * DiffEntry values. Deterministic key order: union of keys, old-first then new-only.
 */
export function diffNodes(
  oldNode: unknown,
  newNode: unknown,
  path: string,
  changes: DiffEntry[],
  options: { propertiesMode: boolean },
): void {
  const oldObj = typeof oldNode === 'object' && oldNode !== null && !Array.isArray(oldNode) ? (oldNode as Record<string, unknown>) : null;
  const newObj = typeof newNode === 'object' && newNode !== null && !Array.isArray(newNode) ? (newNode as Record<string, unknown>) : null;

  if (oldObj === null || newObj === null) {
    // schema removed entirely / replaced by boolean etc.
    if (oldNode !== newNode && JSON.stringify(oldNode) !== JSON.stringify(newNode)) {
      changes.push({
        path,
        kind: 'schema_removed',
        severity: oldNode === undefined ? 'non_breaking' : 'breaking',
        description:
          oldNode === undefined
            ? `new subschema appeared at ${path}`
            : `subschema changed at ${path}: ${JSON.stringify(oldNode)} → ${JSON.stringify(newNode)}`,
        old: oldNode,
        new: newNode,
      });
    }
    return;
  }

  // keywords whose VALUE is another schema subtree — recurse
  const SUBSCHEMA_KEYWORDS = new Set(['items', 'additionalItems', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'unevaluatedProperties', 'unevaluatedItems']);
  // keywords whose value is a map of name -> subschema
  const MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependencies', 'dependentSchemas']);

  const keys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].sort();

  for (const key of keys) {
    const oldV = oldObj[key];
    const newV = newObj[key];
    const keyPath = joinPath(path, key);

    // $id / id change: report not_supported (identity semantics affect ref resolution)
    if (key === '$id' || key === 'id') {
      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        changes.push({
          path: keyPath,
          kind: 'unsupported_keyword_changed',
          severity: 'not_supported',
          description: `${key} changed: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`,
          reason: 'Schema identity change alters $ref resolution scope; re-diff after inlining refs.',
          old: oldV,
          new: newV,
        });
      }
      continue;
    }

    // dereference() rewrites external refs to opaque leaves; classify those here
    if (key === '$external-ref') {
      if (oldV !== newV) {
        changes.push({
          path,
          kind: 'unsupported_keyword_changed',
          severity: 'not_supported',
          description: `external $ref changed: ${String(oldV)} → ${String(newV)}`,
          reason: 'External references are never fetched (zero-network contract); compare the target schemas manually.',
          old: oldV,
          new: newV,
        });
      }
      continue;
    }
    if (key === '$dangling-ref') {
      if (oldV !== newV) {
        changes.push({
          path,
          kind: 'unsupported_keyword_changed',
          severity: 'not_supported',
          description: `dangling $ref changed: ${String(oldV)} → ${String(newV)}`,
          reason: 'The reference target does not resolve inside its own document; fix the schema before diffing.',
          old: oldV,
          new: newV,
        });
      }
      continue;
    }

    // $ref vs inline changes are handled by dereference() before we get here.
    if (key === '$ref') {
      if (oldV !== newV) {
        // only reachable for external refs (same-doc refs were inlined)
        changes.push({
          path: keyPath,
          kind: 'unsupported_keyword_changed',
          severity: 'not_supported',
          description: `external $ref changed: ${String(oldV)} → ${String(newV)}`,
          reason: 'External references are never fetched (zero-network contract); compare the target schemas manually.',
          old: oldV,
          new: newV,
        });
      }
      continue;
    }

    if (MAP_KEYWORDS.has(key)) {
      const oldMap = (typeof oldV === 'object' && oldV !== null ? oldV : {}) as Record<string, unknown>;
      const newMap = (typeof newV === 'object' && newV !== null ? newV : {}) as Record<string, unknown>;
      for (const subKey of [...new Set([...Object.keys(oldMap), ...Object.keys(newMap)])].sort()) {
        const subPath = joinPath(keyPath, subKey);
        if (!(subKey in newMap)) {
          // property schema deleted: breaking iff the property was required
          const wasRequired =
            Array.isArray(oldObj['required']) && (oldObj['required'] as unknown[]).includes(subKey);
          changes.push({
            path: subPath,
            kind: 'property_removed',
            severity: wasRequired ? 'breaking' : 'non_breaking',
            description: wasRequired
              ? `required property ${JSON.stringify(subKey)} removed`
              : `optional property ${JSON.stringify(subKey)} removed`,
            old: oldMap[subKey],
          });
          continue;
        }
        if (!(subKey in oldMap)) {
          changes.push({
            path: subPath,
            kind: 'property_added',
            severity: 'non_breaking',
            description: `optional property ${JSON.stringify(subKey)} added`,
            new: newMap[subKey],
          });
          continue;
        }
        diffNodes(oldMap[subKey], newMap[subKey], subPath, changes, options);
      }
      continue;
    }

    if (SUBSCHEMA_KEYWORDS.has(key)) {
      const DYNAMIC = new Set(['if', 'then', 'else', 'not', 'unevaluatedProperties', 'unevaluatedItems']);
      if (oldV === undefined && newV !== undefined) {
        changes.push({
          path: keyPath,
          kind: 'schema_added',
          severity: DYNAMIC.has(key) ? 'not_supported' : 'breaking',
          description: `"${key}" constraint added`,
          reason: DYNAMIC.has(key)
            ? `"${key}" depends on dynamic evaluation; severity classified as not_supported.`
            : undefined,
          new: newV,
        });
        continue;
      }
      if (newV === undefined && oldV !== undefined) {
        changes.push({
          path: keyPath,
          kind: 'schema_removed',
          severity: DYNAMIC.has(key) ? 'not_supported' : 'non_breaking',
          description: `"${key}" constraint removed`,
          reason: DYNAMIC.has(key)
            ? `"${key}" depends on dynamic evaluation; severity classified as not_supported.`
            : undefined,
          old: oldV,
        });
        continue;
      }
      if (DYNAMIC.has(key)) {
        // changes inside if/then/else/not/unevaluated* have direction-dependent
        // severity (a "not" subtree narrowing LOOSENS); report, don't guess.
        const subChanges: DiffEntry[] = [];
        diffNodes(oldV, newV, keyPath, subChanges, options);
        if (subChanges.length > 0) {
          changes.push({
            path: keyPath,
            kind: 'unsupported_keyword_changed',
            severity: 'not_supported',
            description: `"${key}" subtree changed (${subChanges.length} nested change${subChanges.length > 1 ? 's' : ''}: ${subChanges.map((c) => c.description).slice(0, 3).join('; ')})`,
            reason: `"${key}" severity depends on dynamic evaluation order; nested changes are not classified. Review manually.`,
            old: oldV,
            new: newV,
          });
        }
        continue;
      }
      diffNodes(oldV, newV, keyPath, changes, options);
      continue;
    }

    // anyOf / oneOf / allOf: array-of-schemas, diff index-wise + length changes
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      const oldArr = Array.isArray(oldV) ? oldV : [];
      const newArr = Array.isArray(newV) ? newV : [];
      const wasConditional = key === 'anyOf' || key === 'oneOf' || key === 'allOf';
      void wasConditional;
      if (oldArr.length !== newArr.length) {
        changes.push({
          path: keyPath,
          kind: 'unsupported_keyword_changed',
          severity: 'not_supported',
          description: `"${key}" variant count changed: ${oldArr.length} → ${newArr.length}`,
          reason: `"${key}" is order-dependent; index-wise diff is meaningless when the variant count changes. Align variants or diff manually.`,
          old: oldArr.length,
          new: newArr.length,
        });
        continue;
      }
      for (let i = 0; i < oldArr.length; i++) {
        diffNodes(oldArr[i], newArr[i], `${keyPath}/${i}`, changes, options);
      }
      continue;
    }

    // required: split into per-property entries for precise paths
    if (key === 'required') {
      const oldSet = new Set(Array.isArray(oldV) ? (oldV as unknown[]) : []);
      const newSet = new Set(Array.isArray(newV) ? (newV as unknown[]) : []);
      const parentProps = path; // required lives next to properties; property path = parent properties container
      for (const added of [...newSet].filter((x) => !oldSet.has(x)).sort()) {
        changes.push({
          path: `${parentProps}/required`,
          kind: 'required_added',
          severity: 'breaking',
          description: `new required property ${JSON.stringify(String(added))} at ${parentProps === '' ? 'root' : parentProps.replace('/properties', '')}`,
          new: added,
        });
      }
      for (const removed of [...oldSet].filter((x) => !newSet.has(x)).sort()) {
        changes.push({
          path: `${parentProps}/required`,
          kind: 'required_removed',
          severity: 'non_breaking',
          description: `required constraint dropped for ${JSON.stringify(String(removed))}`,
          old: removed,
        });
      }
      continue;
    }

    // scalar keyword changes
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
      changes.push(classifyImported(key, keyPath, oldV, newV));
    }
  }
}

import { classifyKeywordChange, isUnsupportedKeyword } from './classify.js';

function classifyImported(key: string, keyPath: string, oldV: unknown, newV: unknown): DiffEntry {
  if (isUnsupportedKeyword(key)) {
    const entry = classifyKeywordChange(keyPath, key, oldV, newV);
    return entry; // already not_supported with reason
  }
  return classifyKeywordChange(keyPath, key, oldV, newV);
}
