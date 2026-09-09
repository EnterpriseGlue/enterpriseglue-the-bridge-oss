import { crc32, inflateRawSync } from 'node:zlib';
import { Errors } from '../interfaces/middleware/errorHandler.js';

export interface MemoryZipEntry {
  entryName: string;
  isDirectory: boolean;
  header: { size: number };
  getData(): Buffer;
}

/** In-memory, single-disk ZIP reader. No filesystem extraction or path writes.
 * Supports stored/deflated entries, including streaming data descriptors.
 * Central-directory lengths are checked before allocation; zlib enforces an
 * independent output ceiling and CRC/actual-size checks reject dishonest sizes.
 * Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */
export function readMemoryZip(
  input: unknown,
  { maxBytes = 25 * 1024 * 1024, maxUncompressedBytes = 100 * 1024 * 1024, maxEntries = 10_000 } = {},
): MemoryZipEntry[] {
  const invalid = (detail = 'invalid'): never => { throw Errors.validation(`ZIP archive ${detail}`); };
  for (const limit of [maxBytes, maxUncompressedBytes, maxEntries]) {
    if (!Number.isSafeInteger(limit) || limit <= 0) invalid('limits must be positive safe integers');
  }
  // Reject request parameter tampering explicitly before observing byte counts.
  // Own the bounded bytes so deferred entry reads cannot see caller mutations.
  if (!Buffer.isBuffer(input)) throw Errors.validation('ZIP archive input must be a Buffer');
  if (input.byteLength > maxBytes) throw Errors.validation(`ZIP archive exceeds ${maxBytes} compressed bytes`);
  const buffer = Buffer.from(input);
  if (buffer.length < 22) invalid();
  const range = (offset: number, length: number, end = buffer.length): void => {
    if (offset < 0 || length < 0 || offset + length > end) invalid('contains truncated or overlapping records');
  };
  let end = buffer.length - 22;
  const earliest = Math.max(0, end - 0xffff);
  while (end >= earliest) {
    if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break;
    end -= 1;
  }
  if (end < earliest) invalid();
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) invalid('uses unsupported ZIP64 records');
  if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0 || buffer.readUInt16LE(end + 8) !== count) invalid('uses unsupported multipart records');
  if (count > maxEntries) invalid(`exceeds ${maxEntries} entries`);
  if (directoryOffset + directorySize !== end) invalid('has an invalid central directory');
  let cursor = directoryOffset;
  let totalBytes = 0;
  const names = new Set<string>();
  const records: Array<{ start: number; end: number }> = [];
  const entries: MemoryZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    range(cursor, 46, end);
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) invalid('has an invalid central directory');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if ([compressedSize, size, localOffset].includes(0xffffffff)) invalid('uses unsupported ZIP64 records');
    if (buffer.readUInt16LE(cursor + 34) !== 0) invalid('uses unsupported multipart records');
    if ((flags & ~0x080e) !== 0 || ![0, 8].includes(method)) invalid('uses unsupported encryption or compression');
    range(cursor + 46, nameLength + extraLength + commentLength, end);
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    let entryName: string;
    try { entryName = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(nameBytes); } catch { return invalid('contains a non-UTF-8 filename'); }
    if (!entryName || entryName.includes('\0')) invalid('contains an invalid filename');
    if (names.has(entryName)) invalid(`contains duplicate path: ${entryName}`);
    names.add(entryName);
    const unixType = (buffer.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
    if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) invalid('contains an unsupported special file');
    const isDirectory = entryName.endsWith('/') || unixType === 0x4000;
    if (isDirectory && size !== 0) invalid('contains a nonempty directory record');
    totalBytes += size;
    if (totalBytes > maxUncompressedBytes) invalid(`exceeds ${maxUncompressedBytes} uncompressed bytes`);

    range(localOffset, 30, directoryOffset);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) invalid('has an invalid local header');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    range(localOffset + 30, localNameLength + localExtraLength, directoryOffset);
    if (buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method
      || !nameBytes.equals(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength))) invalid('has conflicting entry headers');
    if (!(flags & 8) && (buffer.readUInt32LE(localOffset + 14) !== checksum
      || buffer.readUInt32LE(localOffset + 18) !== compressedSize || buffer.readUInt32LE(localOffset + 22) !== size)) invalid('has conflicting entry sizes or checksum');
    range(dataOffset, compressedSize, directoryOffset);
    let recordEnd = dataOffset + compressedSize;
    if (flags & 8) {
      range(recordEnd, 12, directoryOffset);
      // A descriptor signature is optional. CRC can itself equal the signature.
      const matches = (offset: number): boolean => offset + 12 <= directoryOffset
        && buffer.readUInt32LE(offset) === checksum && buffer.readUInt32LE(offset + 4) === compressedSize
        && buffer.readUInt32LE(offset + 8) === size;
      if (matches(recordEnd)) recordEnd += 12;
      else if (buffer.readUInt32LE(recordEnd) === 0x08074b50 && matches(recordEnd + 4)) recordEnd += 16;
      else invalid('has an invalid data descriptor');
    }
    records.push({ start: localOffset, end: recordEnd });
    let contents: Buffer | undefined;
    entries.push({ entryName, isDirectory, header: { size }, getData: () => {
      if (contents) return contents;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      let decoded: Buffer;
      try {
        decoded = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
      } catch { return invalid('contains invalid or oversized compressed data'); }
      if (decoded.length !== size || crc32(decoded) !== checksum) invalid('has an invalid entry size or checksum');
      contents = decoded;
      return contents;
    } });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) invalid('has an invalid central directory length');
  records.sort((left, right) => left.start - right.start);
  for (let i = 1; i < records.length; i += 1) {
    if (records[i].start < records[i - 1].end) invalid('contains overlapping entries');
  }
  return entries;
}
