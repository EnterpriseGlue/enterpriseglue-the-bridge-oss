import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Resolve from TypeORM's real dependency capsule, rather than a mocked or
// top-level OpenTelemetry copy that might mask an older transitive version.
const require = createRequire(import.meta.url);
const typeOrmRequire = createRequire(require.resolve('typeorm'));
const spannerRequire = createRequire(typeOrmRequire.resolve('@google-cloud/spanner'));
const { W3CBaggagePropagator } = spannerRequire('@opentelemetry/core');
const { ROOT_CONTEXT, propagation } = spannerRequire('@opentelemetry/api');

function extract(baggage: string | string[]) {
  const carrier = { baggage };
  const context = new W3CBaggagePropagator().extract(ROOT_CONTEXT, carrier, {
    get: (value: typeof carrier, key: string) => value[key as keyof typeof carrier],
    keys: (value: typeof carrier) => Object.keys(value),
  });
  return propagation.getBaggage(context)?.getAllEntries() ?? [];
}

describe('Spanner production dependency security', () => {
  it('TypeORM resolves the qualified Spanner 9.1 SDK', () => {
    expect(typeOrmRequire('@google-cloud/spanner/package.json').version).toBe('9.1.0');
  });

  it('caps inbound baggage entries across multiple header values', () => {
    const first = Array.from({ length: 100 }, (_, i) => `a${i}=value`).join(',');
    const second = Array.from({ length: 400 }, (_, i) => `b${i}=value`).join(',');
    const entries = extract([first, second]);
    expect(entries).toHaveLength(180);
    expect(entries[0]).toEqual(['a0', { value: 'value' }]);
  });

  it('rejects oversized baggage entries while preserving valid entries', () => {
    const entries = extract(`oversized=${'x'.repeat(5000)},safe=value`);
    expect(entries).toEqual([['safe', { value: 'value' }]]);
  });
});
