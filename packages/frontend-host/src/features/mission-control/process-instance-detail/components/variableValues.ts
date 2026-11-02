/** Numeric UI writes must survive JSON transport without precision loss. */
export function validateNumericVariableValue(value: unknown, type: string): void {
  if (!['Integer', 'Long', 'Double'].includes(type) || value === null) return
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Value must be a finite number')
  if (type === 'Double') return
  if (!Number.isSafeInteger(value)) throw new Error('Value must be an integer within the exact supported range')
  if (type === 'Integer' && (value < -2147483648 || value > 2147483647)) {
    throw new Error('Integer value must be between -2147483648 and 2147483647')
  }
}

export function parseTypedVariableValue(raw: string, type: string): unknown {
  if (type === 'String') return raw
  const text = raw.trim()
  if (text === '') return null
  if (type === 'Boolean') {
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true'
    throw new Error('Boolean values must be true or false')
  }
  if (['Integer', 'Long', 'Double'].includes(type)) {
    if (type !== 'Double' && !/^[+-]?\d+$/.test(text)) throw new Error('Value must be a whole decimal integer')
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('Value must be a number')
    const value = Number(text)
    validateNumericVariableValue(value, type)
    return value
  }
  if (type === 'Object' || type === 'Json') return JSON.parse(raw)
  return raw
}

/** Retain integer lexemes before JSON.parse can round a typed bulk value. */
export function parseBulkVariableInput(raw: string): Record<string, unknown> {
  const sources = new WeakMap<object, string>();
  const parsed = JSON.parse(raw || '{}', function (this: object, key: string, value: unknown, context?: { source?: string }) {
    if (key === 'value' && typeof value === 'number') sources.set(this, context?.source || '');
    return value;
  });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Bulk upload JSON must be an object');
  for (const input of Object.values(parsed)) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
    const variable = input as Record<string, unknown>;
    if (!['Integer', 'Long'].includes(String(variable.type)) || variable.value === null) continue;
    const source = typeof variable.value === 'string' ? variable.value : sources.get(input);
    if (!source) throw new Error('Use a string for typed integer bulk values when exact JSON source validation is unavailable');
    variable.value = parseTypedVariableValue(source, String(variable.type));
  }
  return parsed;
}
