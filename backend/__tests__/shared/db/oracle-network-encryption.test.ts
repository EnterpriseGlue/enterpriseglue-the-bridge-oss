import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDatabaseConfig } from '@enterpriseglue/shared/config/database.js';
import {
  initializeOracleNetworkEncryption, oracleApplicationConnectString, oracleNetworkEncryptionOptions,
  validateOracleNetworkConfiguration,
} from '@enterpriseglue/shared/db/oracle-network-encryption.js';

vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, fstatSync: vi.fn(original.fstatSync) };
});

let directory: string;
const required = 'SQLNET.ENCRYPTION_CLIENT = REQUIRED\nSQLNET.ENCRYPTION_TYPES_CLIENT = (AES256)\n';
const profile = () => ({ databaseType: 'oracle', oracleNetworkEncryption: 'native-aes256-required' as const, oracleNetConfigDir: directory });
const environment = () => ({ DATABASE_TYPE: 'oracle', ORACLE_USER: 'main', ORACLE_PASSWORD: 'unit-fixture', ORACLE_CONNECTION_STRING: 'db:1521/FREEPDB1' });

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'eg-oracle-net-'));
  writeFileSync(path.join(directory, 'sqlnet.ora'), required);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('Oracle encryption deployment contract', () => {
  it('preserves connection precedence and derives a native SID descriptor', () => {
    expect(oracleApplicationConnectString({ ...profile(), oracleHost: 'db', oracleSid: 'FREE' })).toBe('(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db)(PORT=1521))(CONNECT_DATA=(SID=FREE)))');
    expect(oracleApplicationConnectString({ ...profile(), oracleHost: 'ignored', oracleConnectionString: 'APP' })).toBe('APP');
    expect(() => oracleApplicationConnectString({ ...profile(), oracleHost: 'db', oracleSid: 'FREE)(PROTOCOL=TCPS' })).toThrow('valid host and SID');
  });
  it('retains Thin mode without a native-library or file requirement', () => {
    expect(loadDatabaseConfig(environment()).oracleNetworkEncryption).toBe('default');
    expect(oracleNetworkEncryptionOptions({}, 'tcps://db/service')).toBeUndefined();
    const driver = { initOracleClient: vi.fn(), thin: true };
    initializeOracleNetworkEncryption(driver, {}, 'db:1521/FREEPDB1');
    expect(driver.initOracleClient).not.toHaveBeenCalled();
  });
  it('loads the optional profile independently of authentication configuration', () => {
    const config = loadDatabaseConfig({ ...environment(), ORACLE_NETWORK_ENCRYPTION: 'native-aes256-required', ORACLE_NET_CONFIG_DIR: directory });
    const options = oracleNetworkEncryptionOptions(config, config.oracleConnectionString!)!;
    expect(options.configDir).not.toBe(directory);
    expect(readFileSync(path.join(options.configDir, 'sqlnet.ora'), 'utf8')).toContain('REQUIRED');
  });
  it.each(['native-required', 'required', 'off', 'requested'])('rejects unknown mode %s', mode => {
    expect(() => loadDatabaseConfig({ ...environment(), ORACLE_NETWORK_ENCRYPTION: mode })).toThrow();
  });
  it('rejects an opt-in for another database', () => {
    expect(() => loadDatabaseConfig({ DATABASE_TYPE: 'mysql', ORACLE_NETWORK_ENCRYPTION: 'native-aes256-required', ORACLE_NET_CONFIG_DIR: directory })).toThrow('DATABASE_TYPE=oracle');
  });
  it('rejects an unused profile directory', () => {
    expect(() => validateOracleNetworkConfiguration({ oracleNetConfigDir: directory })).toThrow('requires ORACLE_NETWORK_ENCRYPTION');
  });
  it.each([undefined, 'relative/path'])('requires an absolute directory (%s)', oracleNetConfigDir => {
    expect(() => validateOracleNetworkConfiguration({ ...profile(), oracleNetConfigDir })).toThrow('absolute directory');
  });
  it.each([
    'SQLNET.ENCRYPTION_CLIENT=REQUESTED\nSQLNET.ENCRYPTION_TYPES_CLIENT=(AES256)',
    'SQLNET.ENCRYPTION_CLIENT=REQUIRED\nSQLNET.ENCRYPTION_TYPES_CLIENT=(AES256,AES128)',
    'SQLNET.ENCRYPTION_CLIENT=REQUIRED',
    required + 'SQLNET.ENCRYPTION_CLIENT=REQUIRED',
    required + 'IFILE=/another/profile',
    required + 'NAMES.DIRECTORY_PATH=(LDAP,TNSNAMES)',
    required + 'malformed setting',
    required + 'SOME_OPTION="quoted value"',
  ])('rejects a profile that cannot enforce the canonical policy (%#)', text => {
    writeFileSync(path.join(directory, 'sqlnet.ora'), text);
    expect(() => validateOracleNetworkConfiguration(profile())).toThrow('Oracle native network encryption:');
  });
  it('accepts case, whitespace, multiline lists, comments, and direct checksum settings', () => {
    writeFileSync(path.join(directory, 'sqlnet.ora'), "# Don't loosen encryption\nsqlnet.encryption_client = required # profile\nSQLNET.ENCRYPTION_TYPES_CLIENT = (\n AES256\n)\nSQLNET.CRYPTO_CHECKSUM_CLIENT=REQUIRED\nSQLNET.CRYPTO_CHECKSUM_TYPES_CLIENT=(SHA256)\n");
    expect(validateOracleNetworkConfiguration(profile())).toEqual({ configDir: directory });
    const snapshot = oracleNetworkEncryptionOptions(profile(), 'db/service')!;
    expect(readFileSync(path.join(snapshot.configDir, 'sqlnet.ora'), 'utf8')).toContain('NAMES.DIRECTORY_PATH=(TNSNAMES,EZCONNECT)');
  });
  it('normalizes the documented scalar AES256 value to one cipher', () => {
    writeFileSync(path.join(directory, 'sqlnet.ora'), required.replace('(AES256)', 'AES256'));
    const snapshot = oracleNetworkEncryptionOptions(profile(), 'db/service')!;
    expect(readFileSync(path.join(snapshot.configDir, 'sqlnet.ora'), 'utf8')).toContain('SQLNET.ENCRYPTION_TYPES_CLIENT=(AES256)');
  });
  it('allows TCP hostnames beginning with config without treating them as providers', () => {
    expect(oracleNetworkEncryptionOptions(profile(), 'config-db.example.test:1521/app')).toBeDefined();
  });
  it('fails for missing files and oversized profiles', () => {
    rmSync(path.join(directory, 'sqlnet.ora'));
    expect(() => validateOracleNetworkConfiguration(profile())).toThrow('missing, unreadable');
    writeFileSync(path.join(directory, 'sqlnet.ora'), required + '#'.repeat(65_536));
    expect(() => validateOracleNetworkConfiguration(profile())).toThrow('too large');
  });
  it('reads the checked open file when the mounted path is replaced during validation', () => {
    const original = vi.mocked(fs.fstatSync).getMockImplementation()!;
    vi.mocked(fs.fstatSync).mockImplementationOnce(descriptor => {
      const stat = original(descriptor);
      fs.renameSync(path.join(directory, 'sqlnet.ora'), path.join(directory, 'previous.ora'));
      writeFileSync(path.join(directory, 'sqlnet.ora'), 'SQLNET.ENCRYPTION_CLIENT=REJECTED');
      return stat;
    });
    expect(validateOracleNetworkConfiguration(profile())).toEqual({ configDir: directory });
    expect(() => validateOracleNetworkConfiguration(profile())).toThrow('restrict client encryption types');
  });
  it('bounds the read when an already opened configuration grows after its size check', () => {
    const original = vi.mocked(fs.fstatSync).getMockImplementation()!;
    vi.mocked(fs.fstatSync).mockImplementationOnce(descriptor => {
      const stat = original(descriptor);
      fs.appendFileSync(path.join(directory, 'sqlnet.ora'), '#'.repeat(65_536));
      return stat;
    });
    expect(() => validateOracleNetworkConfiguration(profile())).toThrow('too large');
  });
  it.each([
    'tcps://db:2443/service', '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=db)))',
    'db/service?encryption_client=rejected', 'config-file:///tmp/provider.json',
    'user:password@db/service', 'db/service?ssl_server_dn_match=false',
    '(DESCRIPTION=(ADDRESS=(PROTOCOL=IPC)(KEY=local))(CONNECT_DATA=(SERVICE_NAME=app)))',
    'https://db/service',
  ])('rejects unsupported transport or overrides without exposing the descriptor (%#)', descriptor => {
    try { oracleNetworkEncryptionOptions(profile(), descriptor); throw new Error('unexpected success'); }
    catch (error) { expect((error as Error).message).not.toContain(descriptor); expect((error as Error).message).toMatch(/supports TCP|without encryption overrides/); }
  });
  it('preserves TCP HA descriptors and verifies dedicated TNS files', () => {
    const descriptor = '(DESCRIPTION=(FAILOVER=on)(ADDRESS=(PROTOCOL=TCP)(HOST=db1)(PORT=1521))(ADDRESS=(PROTOCOL=TCP)(HOST=db2)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=app)))';
    writeFileSync(path.join(directory, 'tnsnames.ora'), `APP = ${descriptor}`);
    const options = oracleNetworkEncryptionOptions(profile(), descriptor);
    expect(oracleNetworkEncryptionOptions(profile(), 'APP')).toEqual(options);
    writeFileSync(path.join(directory, 'tnsnames.ora'), 'APP=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=db)))');
    expect(() => oracleNetworkEncryptionOptions(profile(), 'APP')).toThrow('TCP transport');
  });
  it('requires identical native initialization options for repeated pool creation', () => {
    const driver = { initOracleClient: vi.fn(), thin: false };
    initializeOracleNetworkEncryption(driver, profile(), 'db/service');
    initializeOracleNetworkEncryption(driver, profile(), 'db/service');
    expect(driver.initOracleClient.mock.calls[0]).toEqual(driver.initOracleClient.mock.calls[1]);
    expect(driver.initOracleClient.mock.calls[0][0].configDir).not.toBe(directory);
  });
  it('retains a required immutable profile after a source-file replacement', () => {
    const options = oracleNetworkEncryptionOptions(profile(), 'db/service')!;
    writeFileSync(path.join(directory, 'sqlnet.ora'), 'SQLNET.ENCRYPTION_CLIENT=REJECTED');
    expect(readFileSync(path.join(options.configDir, 'sqlnet.ora'), 'utf8')).toContain('REQUIRED');
    expect(() => oracleNetworkEncryptionOptions(profile(), 'db/service')).toThrow('restrict client encryption types');
  });
  it('does not fall back after initialization failure or an ineffective initializer', () => {
    const driver = { initOracleClient: vi.fn(() => { throw new Error('sensitive native detail'); }), thin: true };
    expect(() => initializeOracleNetworkEncryption(driver, profile(), 'db/service')).toThrow('Oracle Client initialization failed');
    driver.initOracleClient = vi.fn();
    expect(() => initializeOracleNetworkEncryption(driver, profile(), 'db/service')).toThrow('Oracle Client initialization failed');
  });
});
