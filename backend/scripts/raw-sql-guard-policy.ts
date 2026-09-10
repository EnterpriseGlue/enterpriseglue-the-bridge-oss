export type RawQueryPattern = {
  label: string;
  regex: RegExp;
};

/** Receiver-name-independent detection prevents aliases such as `runner` or
 * `transport` from bypassing the production raw-SQL boundary. */
export const RAW_QUERY_PATTERNS: readonly RawQueryPattern[] = Object.freeze([
  { label: '*.query(', regex: /\.\s*query\s*\(/ },
  { label: '*.getCreateSchemaSQL(', regex: /\.\s*getCreateSchemaSQL\s*\(/ },
]);

export function rawQueryPatternLabels(line: string): string[] {
  return RAW_QUERY_PATTERNS
    .filter((pattern) => pattern.regex.test(line))
    .map((pattern) => pattern.label);
}
