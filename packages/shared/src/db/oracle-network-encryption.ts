import { constants, accessSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ORACLE_NATIVE_ENCRYPTION = 'native-aes256-required' as const;

export interface OracleNetworkConfiguration {
  databaseType?: string;
  oracleNetworkEncryption?: 'default' | typeof ORACLE_NATIVE_ENCRYPTION;
  oracleNetConfigDir?: string;
}

export function oracleApplicationConnectString(config: OracleNetworkConfiguration & {
  oracleConnectionString?: string; oracleHost?: string; oraclePort?: number;
  oracleServiceName?: string; oracleSid?: string;
}): string {
  if (config.oracleConnectionString) return config.oracleConnectionString;
  const port = config.oraclePort || 1521;
  if (config.oracleServiceName) return `${config.oracleHost}:${port}/${config.oracleServiceName}`;
  if (config.oracleNetworkEncryption === ORACLE_NATIVE_ENCRYPTION) {
    if (!config.oracleHost || !config.oracleSid || /[()=\s@?#]/.test(config.oracleHost + config.oracleSid)) {
      fail('native SID connections require valid host and SID values.');
    }
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.oracleHost})(PORT=${port}))(CONNECT_DATA=(SID=${config.oracleSid})))`;
  }
  return `${config.oracleHost}:${port}:${config.oracleSid}`;
}

function fail(reason: string): never {
  // Never include descriptor, configuration contents, credentials, or native errors.
  throw new Error(`Oracle native network encryption: ${reason}`);
}

function readConfiguration(file: string): string {
  try {
    accessSync(file, constants.R_OK);
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 65_536) fail('configuration must be a readable file of at most 64 KiB.');
    return readFileSync(file, 'utf8');
  } catch {
    return fail('required Oracle Net configuration is missing, unreadable, or too large.');
  }
}

function withoutComments(text: string): string {
  // This profile deliberately uses unquoted Oracle Net assignments. Quoting or
  // indirection needs a separate parser contract rather than a permissive check.
  const value = text.replace(/#[^\r\n]*/g, '');
  if (/["'\u0000]/.test(value)) fail('quoted values and NUL bytes are unsupported in the required profile.');
  return value;
}

export function validateOracleNetworkConfiguration(config: OracleNetworkConfiguration): { configDir: string } | undefined {
  if (!config.oracleNetworkEncryption || config.oracleNetworkEncryption === 'default') {
    if (config.oracleNetConfigDir) fail('ORACLE_NET_CONFIG_DIR requires ORACLE_NETWORK_ENCRYPTION=native-aes256-required.');
    return undefined;
  }
  if (config.oracleNetworkEncryption !== ORACLE_NATIVE_ENCRYPTION) fail('unsupported ORACLE_NETWORK_ENCRYPTION value.');
  if (config.databaseType !== 'oracle') fail('the required profile needs DATABASE_TYPE=oracle.');
  const configDir = config.oracleNetConfigDir;
  if (!configDir || !path.isAbsolute(configDir)) fail('ORACLE_NET_CONFIG_DIR must be an absolute directory.');

  validatedClientProfile(readConfiguration(path.join(configDir, 'sqlnet.ora')));
  return { configDir };
}

function validatedClientProfile(input: string): string {
  const text = withoutComments(input);
  const assignments = new Map<string, string>();
  const canonical = new Map<string, string>();
  // Accept complete direct assignments, including lists split over lines.
  const expression = /\s*([A-Z][A-Z0-9_.]*)\s*=\s*(\([^()]*\)|[^\s()=]+)\s*/giy;
  let offset = 0;
  while (text.slice(offset).trim()) {
    expression.lastIndex = offset;
    const match = expression.exec(text);
    if (!match) fail('sqlnet.ora must use complete direct assignments.');
    const key = match[1].toUpperCase();
    if (key === 'IFILE' || assignments.has(key)) fail('sqlnet.ora indirection and duplicate assignments are unsupported.');
    assignments.set(key, match[2].replace(/\s/g, '').toUpperCase());
    canonical.set(key, match[2].replace(/\s/g, ''));
    offset = expression.lastIndex;
  }
  if (assignments.get('SQLNET.ENCRYPTION_CLIENT') !== 'REQUIRED'
    || !['AES256', '(AES256)'].includes(assignments.get('SQLNET.ENCRYPTION_TYPES_CLIENT') || '')) {
    fail('sqlnet.ora must require encryption and restrict client encryption types to (AES256).');
  }
  canonical.set('SQLNET.ENCRYPTION_CLIENT', 'REQUIRED');
  canonical.set('SQLNET.ENCRYPTION_TYPES_CLIENT', '(AES256)');
  const naming = assignments.get('NAMES.DIRECTORY_PATH');
  if (naming && (!/^\((?:TNSNAMES|EZCONNECT)(?:,(?:TNSNAMES|EZCONNECT))*\)$/.test(naming))) {
    fail('the required profile supports only local TNS and Easy Connect naming.');
  }
  // Oracle's default also includes LDAP. Keep every resolved descriptor within
  // the dedicated, inspected profile instead of falling back to a directory.
  canonical.set('NAMES.DIRECTORY_PATH', naming || '(TNSNAMES,EZCONNECT)');
  return [...canonical].map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}

export function oracleNetworkEncryptionOptions(config: OracleNetworkConfiguration, connectString: string): { configDir: string } | undefined {
  const options = validateOracleNetworkConfiguration(config);
  if (!options) return undefined;
  const inspect = (text: string) => {
    const value = withoutComments(text);
    const protocols = [...value.matchAll(/\bPROTOCOL\s*=\s*([A-Z0-9_-]+)/gi)].map(match => match[1].toUpperCase());
    if (protocols.some(protocol => protocol !== 'TCP') || /^[a-z]+:\/\//i.test(value.trim()) && !/^tcp:\/\//i.test(value.trim())) {
      fail('the required profile only supports TCP transport.');
    }
    if (/\btcps\b|\bIFILE\s*=|\b(?:[A-Z_.]*ENCRYPTION[A-Z_.]*|[A-Z_.]*CRYPTO_CHECKSUM[A-Z_.]*|SSL_[A-Z_.]*|WALLET_[A-Z_.]*)\s*=/i.test(value)
      || /^config-[A-Z0-9_-]+:\/\//i.test(value.trim()) || value.includes('@')) {
      fail('the required profile supports TCP connections without encryption overrides, wallets, or configuration providers.');
    }
  };
  inspect(connectString);
  const profile = validatedClientProfile(readConfiguration(path.join(options.configDir, 'sqlnet.ora')));
  const namesFile = path.join(options.configDir, 'tnsnames.ora');
  const names = existsSync(namesFile) ? readConfiguration(namesFile) : undefined;
  if (names !== undefined) inspect(names);
  if (/^[A-Z0-9_.-]+$/i.test(connectString) && names === undefined) fail('TNS aliases require a dedicated tnsnames.ora file.');

  // OCI reads an immutable private snapshot. A ConfigMap projection or source
  // file replacement cannot relax enforcement on subsequently grown pools.
  // Share this cache across compiled source/package copies in the same process.
  const key = Symbol.for('enterpriseglue.oracle-native-profile/v1');
  type State = { entries: Map<string, { fingerprint: string; configDir: string }> };
  const globals = globalThis as unknown as Record<symbol, State | undefined>;
  const state = globals[key] ??= { entries: new Map() };
  if (state.entries.size === 0) process.once('exit', () => {
    for (const entry of state.entries.values()) rmSync(entry.configDir, { recursive: true, force: true });
  });
  const fingerprint = createHash('sha256').update(JSON.stringify([profile, names ?? null])).digest('hex');
  const cached = state.entries.get(options.configDir);
  if (cached) {
    if (cached.fingerprint !== fingerprint) fail('the Oracle Net profile changed; restart all Oracle processes to apply it.');
    return { configDir: cached.configDir };
  }
  const snapshot = mkdtempSync(path.join(tmpdir(), 'enterpriseglue-oracle-net-'));
  writeFileSync(path.join(snapshot, 'sqlnet.ora'), profile, { mode: 0o400 });
  if (names !== undefined) writeFileSync(path.join(snapshot, 'tnsnames.ora'), names, { mode: 0o400 });
  state.entries.set(options.configDir, { fingerprint, configDir: snapshot });
  return { configDir: snapshot };
}

export function initializeOracleNetworkEncryption(
  driver: { initOracleClient: (options: { configDir: string }) => void; thin?: boolean },
  config: OracleNetworkConfiguration,
  connectString: string,
): void {
  const options = oracleNetworkEncryptionOptions(config, connectString);
  if (!options) return;
  try {
    driver.initOracleClient(options);
    if (driver.thin !== false) fail('Thick mode was not enabled.');
  } catch {
    fail('Oracle Client initialization failed; check the Oracle-capable image, native libraries, and process initialization order.');
  }
}
