import { describe, expect, it } from 'vitest';
import { DataSource, EntitySchema } from 'typeorm';

describe('Oracle generated string persistence', () => {
  it('can return provider-sized JSON and Unicode without the native 200-byte buffer limit', async () => {
    const schema = new EntitySchema({
      name: 'OracleReturningFixture',
      columns: {
        id: { type: 'varchar2', length: 191, primary: true },
        payload: { type: 'varchar2', length: 4000, default: '{}' },
        count: { type: 'number', default: 0 },
      },
    });
    const ds = new DataSource({ type: 'oracle', username: 'fixture', entities: [schema] });
    // Build real ORM metadata/query output without opening a database connection.
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    const payload = JSON.stringify({ groups: Array(20).fill('組織の管理者'), issuer: 'https://identity.example.test/realms/application' });
    const [, parameters] = ds.createQueryBuilder().insert().into(schema)
      .values({ id: 'fixture', payload, count: 1 }).returning(['payload', 'count']).getQueryAndParameters();
    const outputs = parameters.filter(value => typeof value === 'object' && value?.dir === 3003);
    expect(Buffer.byteLength(payload)).toBeGreaterThan(200);
    expect(outputs[0].maxSize).toBeGreaterThanOrEqual(Buffer.byteLength(payload));
    expect(outputs[1]).not.toHaveProperty('maxSize');
  });
});
