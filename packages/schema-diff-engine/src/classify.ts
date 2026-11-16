import type { DiffEntry, Severity } from './types.js';

/**
 * Keywords whose change semantics this engine does NOT classify (→ not_supported,
 * explicitly reported, never silently ignored). Anything outside this list is
 * handled by the classifier below.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  // compositor-heavy / conditional constructs: severity depends on runtime
  // evaluation order, so we refuse to guess instead of mislabeling.
  'if',
  'then',
  'else',
  'not',
  // 2020-12 content vocabularies (annotation-only in most validators)
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  // unevaluated* needs full dynamic evaluation to classify
  'unevaluatedProperties',
  'unevaluatedItems',
  // legacy draft-04/06 constructs still seen in the wild
  'id',
  '$id-changed-exclusive', // marker, see classifier
]);

export function isUnsupportedKeyword(keyword: string): boolean {
  return UNSUPPORTED_KEYWORDS.has(keyword);
}

/** All keywords we explicitly do not classify. Exported for reporting. */
export const NOT_SUPPORTED_KEYWORDS = [...UNSUPPORTED_KEYWORDS];

function typeIsSubtype(narrow: unknown, wide: unknown): boolean {
  // narrow ⊆ wide ?
  const n = Array.isArray(narrow) ? narrow : [narrow];
  const w = Array.isArray(wide) ? wide : [wide];
  return n.every((t) => w.includes(t));
}

function typesString(t: unknown): string {
  return Array.isArray(t) ? t.join('|') : String(t);
}

/**
 * Classify a single keyword-level change at a schema node.
 * oldV/newV are the raw keyword values (undefined = keyword absent on that side).
 */
export function classifyKeywordChange(
  path: string,
  keyword: string,
  oldV: unknown,
  newV: unknown,
): DiffEntry {
  const desc = (what: string): string => `${what} at ${path}`;
  const base = { path, old: oldV, new: newV };

  switch (keyword) {
    case 'required': {
      const oldSet = new Set(Array.isArray(oldV) ? oldV : []);
      const newSet = new Set(Array.isArray(newV) ? newV : []);
      const added = [...newSet].filter((x) => !oldSet.has(x));
      const removed = [...oldSet].filter((x) => !newSet.has(x));
      // caller splits per-property entries; this handles the whole-keyword view
      if (added.length > 0) {
        return {
          ...base,
          kind: 'required_added',
          severity: 'breaking',
          description: desc(`required properties added: ${added.map((a) => JSON.stringify(a)).join(', ')}`),
        };
      }
      return {
        ...base,
        kind: 'required_removed',
        severity: 'non_breaking',
        description: desc(`required properties removed: ${removed.map((a) => JSON.stringify(a)).join(', ')}`),
      };
    }

    case 'type': {
      if (oldV === undefined) {
        return {
          ...base,
          kind: 'type_changed',
          severity: 'breaking',
          description: desc(`type constraint added (was unconstrained): ${typesString(newV)}`),
        };
      }
      if (newV === undefined) {
        return {
          ...base,
          kind: 'type_widened',
          severity: 'non_breaking',
          description: desc('type constraint removed (now unconstrained)'),
        };
      }
      if (typeIsSubtype(newV, oldV)) {
        const equal =
          JSON.stringify(Array.isArray(oldV) ? [...oldV].sort() : [oldV]) ===
          JSON.stringify(Array.isArray(newV) ? [...newV].sort() : [newV]);
        if (equal) {
          return {
            ...base,
            kind: 'other',
            severity: 'non_breaking',
            description: desc(`type reordered but equivalent (${typesString(newV)})`),
          };
        }
        return {
          ...base,
          kind: 'type_narrowed',
          severity: 'breaking',
          description: desc(`type narrowed: ${typesString(oldV)} → ${typesString(newV)}`),
        };
      }
      if (typeIsSubtype(oldV, newV)) {
        return {
          ...base,
          kind: 'type_widened',
          severity: 'non_breaking',
          description: desc(`type widened: ${typesString(oldV)} → ${typesString(newV)}`),
        };
      }
      // neither subset: some old values rejected → breaking
      return {
        ...base,
        kind: 'type_changed',
        severity: 'breaking',
        description: desc(`type changed: ${typesString(oldV)} → ${typesString(newV)} (some previously valid values rejected)`),
      };
    }

    case 'enum': {
      if (oldV === undefined) {
        return { ...base, kind: 'enum_added', severity: 'breaking', description: desc('enum constraint added') };
      }
      if (newV === undefined) {
        return { ...base, kind: 'enum_removed', severity: 'non_breaking', description: desc('enum constraint removed') };
      }
      const oldList = Array.isArray(oldV) ? oldV : [];
      const newList = new Set(Array.isArray(newV) ? newV.map((v) => JSON.stringify(v)) : []);
      const removedValues = oldList.filter((v) => !newList.has(JSON.stringify(v)));
      const newListSet = new Set(oldList.map((v) => JSON.stringify(v)));
      const addedValues = (Array.isArray(newV) ? newV : []).filter((v) => !newListSet.has(JSON.stringify(v)));
      if (removedValues.length > 0) {
        return {
          ...base,
          kind: 'enum_removed_value',
          severity: 'breaking',
          description: desc(`enum values removed: ${removedValues.map((v) => JSON.stringify(v)).join(', ')}`),
        };
      }
      if (addedValues.length > 0) {
        return {
          ...base,
          kind: 'enum_added_value',
          severity: 'non_breaking',
          description: desc(`enum values added: ${addedValues.map((v) => JSON.stringify(v)).join(', ')}`),
        };
      }
      return { ...base, kind: 'other', severity: 'non_breaking', description: desc('enum reordered but equivalent') };
    }

    case 'const': {
      const eq = JSON.stringify(oldV) === JSON.stringify(newV);
      return eq
        ? { ...base, kind: 'other', severity: 'non_breaking', description: desc('const equivalent') }
        : {
            ...base,
            kind: 'const_changed',
            severity: 'breaking',
            description: desc(`const changed: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`),
          };
    }

    case 'minimum':
    case 'exclusiveMinimum': {
      const o = typeof oldV === 'number' ? oldV : undefined;
      const n = typeof newV === 'number' ? newV : undefined;
      if (n === undefined) {
        return { ...base, kind: 'minimum_loosened', severity: 'non_breaking', description: desc(`${keyword} removed`) };
      }
      if (o === undefined) {
        return { ...base, kind: 'minimum_tightened', severity: 'breaking', description: desc(`${keyword} added: ${n}`) };
      }
      if (n > o) {
        return { ...base, kind: 'minimum_tightened', severity: 'breaking', description: desc(`${keyword} tightened: ${o} → ${n}`) };
      }
      return { ...base, kind: 'minimum_loosened', severity: 'non_breaking', description: desc(`${keyword} loosened: ${o} → ${n}`) };
    }

    case 'maximum':
    case 'exclusiveMaximum': {
      const o = typeof oldV === 'number' ? oldV : undefined;
      const n = typeof newV === 'number' ? newV : undefined;
      if (n === undefined) {
        return { ...base, kind: 'maximum_loosened', severity: 'non_breaking', description: desc(`${keyword} removed`) };
      }
      if (o === undefined) {
        return { ...base, kind: 'maximum_tightened', severity: 'breaking', description: desc(`${keyword} added: ${n}`) };
      }
      if (n < o) {
        return { ...base, kind: 'maximum_tightened', severity: 'breaking', description: desc(`${keyword} tightened: ${o} → ${n}`) };
      }
      return { ...base, kind: 'maximum_loosened', severity: 'non_breaking', description: desc(`${keyword} loosened: ${o} → ${n}`) };
    }

    case 'minLength':
    case 'minItems':
    case 'minProperties': {
      const o = typeof oldV === 'number' ? oldV : undefined;
      const n = typeof newV === 'number' ? newV : undefined;
      const kind = keyword === 'minLength' ? 'min_length_tightened' : 'min_items_tightened';
      if (n !== undefined && (o === undefined || n > o)) {
        return { ...base, kind, severity: 'breaking', description: desc(`${keyword} tightened: ${o ?? 'absent'} → ${n}`) };
      }
      return { ...base, kind, severity: 'non_breaking', description: desc(`${keyword} loosened/unchanged`) };
    }

    case 'pattern': {
      if (oldV === undefined) {
        return { ...base, kind: 'pattern_added', severity: 'breaking', description: desc(`pattern added: ${String(newV)}`) };
      }
      if (newV === undefined) {
        return { ...base, kind: 'pattern_removed', severity: 'non_breaking', description: desc('pattern removed') };
      }
      if (oldV === newV) {
        return { ...base, kind: 'other', severity: 'non_breaking', description: desc('pattern unchanged') };
      }
      // regex containment is undecidable in general: same-source changes are
      // classified breaking unless provably loosened — we conservatively mark
      // any change as breaking and say why in the description.
      return {
        ...base,
        kind: 'pattern_tightened',
        severity: 'breaking',
        description: desc(`pattern changed: ${String(oldV)} → ${String(newV)} (regex re-acceptance is undecidable; treated as potentially rejecting previously valid values)`),
      };
    }

    case 'format': {
      if (oldV === undefined) {
        return { ...base, kind: 'format_added', severity: 'breaking', description: desc(`format added: ${String(newV)}`) };
      }
      if (newV === undefined) {
        return { ...base, kind: 'format_removed', severity: 'non_breaking', description: desc('format removed') };
      }
      return {
        ...base,
        kind: 'format_changed',
        severity: 'breaking',
        description: desc(`format changed: ${String(oldV)} → ${String(newV)}`),
      };
    }

    case 'additionalProperties': {
      const wasOpen = oldV === undefined || oldV === true;
      const nowOpen = newV === undefined || newV === true;
      if (!wasOpen && nowOpen) {
        return { ...base, kind: 'additional_properties_loosened', severity: 'non_breaking', description: desc('additionalProperties relaxed') };
      }
      if (wasOpen && !nowOpen) {
        return {
          ...base,
          kind: 'additional_properties_tightened',
          severity: 'breaking',
          description: desc(`additionalProperties restricted: ${JSON.stringify(oldV ?? true)} → ${JSON.stringify(newV ?? false)}`),
        };
      }
      return { ...base, kind: 'other', severity: 'non_breaking', description: desc('additionalProperties equivalent') };
    }

    default:
      return {
        ...base,
        kind: 'unsupported_keyword_changed',
        severity: 'not_supported',
        description: desc(`keyword "${keyword}" changed`),
        reason: `Change semantics for "${keyword}" are not classified by this engine; review manually.`,
      };
  }
}

/** Severity helper re-exported for tests. */
export function severityOf(entry: DiffEntry): Severity {
  return entry.severity;
}
