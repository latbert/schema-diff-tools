/** Change severity classification. */
export type Severity = 'breaking' | 'non_breaking' | 'not_supported';

/** The JSON-Schema keyword/construct involved in the change. */
export type ChangeKind =
  | 'required_added'
  | 'required_removed'
  | 'property_removed'
  | 'property_added'
  | 'type_changed'
  | 'type_narrowed'
  | 'type_widened'
  | 'enum_removed_value'
  | 'enum_added_value'
  | 'enum_added'
  | 'enum_removed'
  | 'const_changed'
  | 'minimum_tightened'
  | 'minimum_loosened'
  | 'maximum_tightened'
  | 'maximum_loosened'
  | 'min_length_tightened'
  | 'min_items_tightened'
  | 'pattern_tightened'
  | 'pattern_loosened'
  | 'pattern_added'
  | 'pattern_removed'
  | 'format_added'
  | 'format_removed'
  | 'format_changed'
  | 'additional_properties_tightened'
  | 'additional_properties_loosened'
  | 'schema_removed'
  | 'schema_added'
  | 'unsupported_keyword_changed'
  | 'other';

export interface DiffEntry {
  /** JSON pointer style path into the schema (e.g. `/properties/age/minimum`). */
  path: string;
  kind: ChangeKind;
  severity: Severity;
  /** Human-readable description of old → new. */
  description: string;
  old?: unknown;
  new?: unknown;
  /** When severity is not_supported: which keyword/feature and why. */
  reason?: string;
}

export interface DiffResult {
  /** Path-level list of every detected change. */
  changes: DiffEntry[];
  /** Number of entries with severity 'breaking'. */
  breakingCount: number;
  /** Number of entries with severity 'non_breaking'. */
  nonBreakingCount: number;
  /** Number of entries with severity 'not_supported'. */
  notSupportedCount: number;
  /** Convenience verdict. */
  hasBreaking: boolean;
  /** Detected dialect per schema ($schema URI, defaulted). */
  dialect: { from: string; to: string };
}

export interface ValidationIssue {
  /** Instance path of the failing keyword. */
  instancePath: string;
  /** Schema path of the failing keyword. */
  schemaPath: string;
  keyword: string;
  message: string;
  params?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export class SchemaDiffError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SchemaDiffError';
    this.code = code;
  }
}
