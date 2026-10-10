import 'reflect-metadata';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { createHash } from 'node:crypto';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { DocumentationSessionService } from '@enterpriseglue/shared/services/DocumentationSessionService.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { verifyDocumentationIdentity } from '@enterpriseglue/shared/utils/documentation-identity.js';
import type { UserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
const schema = `documentation_${Date.now()}`;
let fixture: DataSource;
let originalSchema: string | undefined;
const table = getMetadataArgsStorage().tables.find((entry) => entry.target === RefreshToken)!;
const sessionId = '11111111-1111-4111-8111-111111111111';
const source: UserJwtPayload = { type: 'access', userId: 'reader', principalId: 'reader', principalType: 'user', sessionId, sessionClass: 'cloud_account', authenticationMethod: 'oidc', authSessionVersion: 0 };
beforeAll(async () => {
  if (process.env.SESSION_RACE_DISPOSABLE_POSTGRES !== 'true' || !process.env.MIGRATION_TEST_POSTGRES_CONTAINER) throw new Error('Owned disposable PostgreSQL is required');
  Object.assign(config, { tenancyMode: 'pooled', tenancyCloudRequired: true, cloudAccountIdentityEnabled: true, frontendUrl: 'https://app.staging.enterpriseglue.ai', documentationOrigin: 'https://docs.enterpriseglue.ai', documentationGatewaySecret: 'disposable-gateway-secret-'.repeat(2) });
  originalSchema = table.schema; table.schema = schema;
  fixture = new DataSource({ type: 'postgres', host: process.env.MIGRATION_TEST_POSTGRES_HOST, port: Number(process.env.MIGRATION_TEST_POSTGRES_PORT), username: process.env.MIGRATION_TEST_POSTGRES_USER, password: process.env.MIGRATION_TEST_POSTGRES_PASSWORD, database: process.env.MIGRATION_TEST_POSTGRES_DATABASE, schema, entities: [RefreshToken], synchronize: false });
  await fixture.initialize();
  await fixture.query(`CREATE SCHEMA "${schema}"`);
  await fixture.synchronize();
  await fixture.query(`CREATE TABLE "${schema}".tenants (id text PRIMARY KEY); CREATE TABLE "${schema}".provisioning_events (id text PRIMARY KEY)`);
  vi.mocked(getDataSource).mockResolvedValue(fixture);
}, 60_000);
afterAll(async () => {
  if (fixture?.isInitialized) { await fixture.query(`DROP SCHEMA "${schema}" CASCADE`); await fixture.destroy(); }
  table.schema = originalSchema;
});
it('consumes concurrent documentation handoffs once on PostgreSQL without creating tenants or provisioning events', async () => {
  await fixture.getRepository(RefreshToken).insert({ id: sessionId, userId: source.userId, tenantId: null, tokenHash: 'disposable-proof', createdAt: Date.now(), expiresAt: Date.now() + 600_000, revokedAt: null, deviceInfo: JSON.stringify({ sessionClass: 'cloud_account', retained: 'metadata' }) });
  const service = new DocumentationSessionService();
  const verifier = 'v'.repeat(43);
  const code = await service.grant(source, createHash('sha256').update(verifier).digest('base64url'));
  const results = await Promise.allSettled([service.exchange(code, verifier), service.exchange(code, verifier), service.exchange(code, verifier)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
  expect(await fixture.query(`SELECT count(*)::int AS count FROM "${schema}".tenants`)).toEqual([{ count: 0 }]);
  expect(await fixture.query(`SELECT count(*)::int AS count FROM "${schema}".provisioning_events`)).toEqual([{ count: 0 }]);
  const row = await fixture.getRepository(RefreshToken).findOneByOrFail({ id: sessionId });
  const accepted = results.find((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')!;
  const claims = verifyDocumentationIdentity(accepted.value, 'documentation_session');
  expect(JSON.parse(row.deviceInfo!)).toEqual({ sessionClass: 'cloud_account', retained: 'metadata', documentationSessions: [claims.jti] });
});
