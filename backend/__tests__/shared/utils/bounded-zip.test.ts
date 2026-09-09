import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import archiver from 'archiver';
import { readMemoryZip } from '@enterpriseglue/shared/utils/bounded-zip.js';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';

const fixture = (level: 0 | 6 = 6) => Buffer.from(zipSync({ 'a.bpmn': Buffer.from('hello '.repeat(100)) }, { level }));
const central = (zip: Buffer) => zip.readUInt32LE(zip.length - 6);
const read = (zip: Buffer) => readMemoryZip(zip).map(entry => entry.getData());

describe('bounded in-memory ZIP reader', () => {
  it.each(['not-a-zip', ['archive'], { length: 22 }, new Uint8Array(22), null, undefined])('rejects non-Buffer request input (%j)', input => {
    expect(() => readMemoryZip(input)).toThrow('input must be a Buffer');
  });

  it('owns its validated bytes for deferred entry reads', () => {
    const zip = fixture();
    const entries = readMemoryZip(zip);
    zip.fill(0);
    expect(entries[0].getData().toString()).toBe('hello '.repeat(100));
  });

  it.each([0, 6] as const)('reads stored/deflated entries (level %s)', level => {
    expect(read(fixture(level))[0].toString()).toBe('hello '.repeat(100));
  });

  it('reads actual archiver streaming descriptors, directories and Unicode names', async () => {
    const zip = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      zip.on('data', chunk => chunks.push(Buffer.from(chunk)));
      zip.on('end', () => resolve(Buffer.concat(chunks)));
      zip.on('error', reject);
    });
    zip.append('', { name: 'empty/' });
    zip.append('<definitions/>', { name: 'processes/決定.bpmn' });
    await zip.finalize();
    const entries = readMemoryZip(await done);
    expect(entries.find(entry => entry.entryName === 'empty/')?.isDirectory).toBe(true);
    expect(entries.find(entry => entry.entryName === 'processes/決定.bpmn')?.getData().toString()).toBe('<definitions/>');
  });

  it('rejects declared expansion, compressed input and entry-count excesses before decompression', () => {
    expect(() => readMemoryZip(fixture(), { maxUncompressedBytes: 20 })).toThrow('uncompressed bytes');
    expect(() => readMemoryZip(fixture(), { maxBytes: 20 })).toThrow('compressed bytes');
    const zip = Buffer.from(zipSync({ a: Buffer.from('a'), b: Buffer.from('b') }));
    expect(() => readMemoryZip(zip, { maxEntries: 1 })).toThrow('entries');
  });

  it('bounds real inflation when both headers lie about uncompressed size', () => {
    const zip = fixture();
    zip.writeUInt32LE(1, 22);
    zip.writeUInt32LE(1, central(zip) + 24);
    expect(() => read(zip)).toThrow('oversized compressed data');
  });

  it('checks real length and CRC, including stored data', () => {
    const badCrc = fixture(0);
    badCrc[30 + badCrc.readUInt16LE(26) + badCrc.readUInt16LE(28)] ^= 1;
    expect(() => read(badCrc)).toThrow('checksum');
    const badSize = fixture(0);
    badSize.writeUInt32LE(601, 22);
    badSize.writeUInt32LE(601, central(badSize) + 24);
    expect(() => read(badSize)).toThrow('entry size');
  });

  it('rejects duplicate raw names before lookup can overwrite them', () => {
    const zip = Buffer.from(zipSync({ aa: Buffer.from('a'), bb: Buffer.from('b') }));
    const first = central(zip);
    const second = first + 46 + zip.readUInt16LE(first + 28) + zip.readUInt16LE(first + 30) + zip.readUInt16LE(first + 32);
    zip.write('aa', second + 46);
    expect(() => readMemoryZip(zip)).toThrow('duplicate path');
  });

  it('rejects truncated archives and conflicting local metadata', () => {
    const zip = fixture();
    expect(() => read(zip.subarray(0, zip.length - 1))).toThrow('ZIP archive');
    zip[30] ^= 1;
    expect(() => read(zip)).toThrow('conflicting entry headers');
  });

  it('rejects overlapping entries even when both local headers are valid', () => {
    const contents = Buffer.from('inner');
    const inner = Buffer.from(zipSync({ 'inner.bpmn': contents }, { level: 0 }));
    const zip = Buffer.from(zipSync({ outer: inner.subarray(0, central(inner)), 'inner.bpmn': contents }, { level: 0 }));
    const first = central(zip);
    const second = first + 46 + zip.readUInt16LE(first + 28) + zip.readUInt16LE(first + 30) + zip.readUInt16LE(first + 32);
    const embeddedHeader = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
    zip.writeUInt32LE(embeddedHeader, second + 42);
    expect(() => readMemoryZip(zip)).toThrow('overlapping entries');
  });

  it('rejects corrupt and truncated streaming data descriptors', async () => {
    const writer = archiver('zip');
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      writer.on('data', chunk => chunks.push(Buffer.from(chunk)));
      writer.on('end', () => resolve(Buffer.concat(chunks)));
      writer.on('error', reject);
    });
    writer.append('process', { name: 'flow.bpmn' });
    await writer.finalize();
    const zip = await done;
    const directory = central(zip);
    expect(zip.readUInt16LE(6) & 8).toBe(8);
    const descriptor = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28) + zip.readUInt32LE(directory + 20);
    const corrupt = Buffer.from(zip);
    corrupt[descriptor + 8] ^= 1;
    expect(() => readMemoryZip(corrupt)).toThrow('invalid data descriptor');
    const truncated = Buffer.concat([zip.subarray(0, descriptor + 8), zip.subarray(directory)]);
    truncated.writeUInt32LE(descriptor + 8, truncated.length - 6);
    expect(() => readMemoryZip(truncated)).toThrow('truncated');
  });

  it.each(['encryption', 'ZIP64', 'multipart', 'special file'])('rejects unsupported %s records', kind => {
    const zip = fixture();
    const directory = central(zip);
    if (kind === 'encryption') zip.writeUInt16LE(1, directory + 8);
    if (kind === 'ZIP64') zip.writeUInt32LE(0xffffffff, directory + 24);
    if (kind === 'multipart') zip.writeUInt16LE(1, zip.length - 18);
    if (kind === 'special file') zip.writeUInt32LE(0xa0000000, directory + 38);
    expect(() => read(zip)).toThrow('unsupported');
  });

  it('preserves a leading filename BOM instead of turning it into an allowed config path', () => {
    const name = '\uFEFFbundle.json';
    const zip = Buffer.from(zipSync({ [name]: Buffer.from('{}') }));
    expect(readMemoryZip(zip)[0].entryName).toBe(name);
    expect(() => configBundleArchiveService.readZip(zip)).toThrow('not declared');
  });

  it('retains configuration traversal and normalized duplicate rejection', () => {
    const malicious = (names: string[]) => Buffer.from(zipSync(Object.fromEntries(names.map(name => [name, Buffer.from('{}')]))));
    expect(() => configBundleArchiveService.readZip(malicious(['../bundle.json']))).toThrow('Invalid configuration archive path');
    expect(() => configBundleArchiveService.readZip(malicious(['bundle.json', './bundle.json']))).toThrow('duplicate path');
  });
});
