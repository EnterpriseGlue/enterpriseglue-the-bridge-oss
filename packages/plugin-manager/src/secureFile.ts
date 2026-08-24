import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readManagerSecureBytesFileV1(
  pathInput: string,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('manager_secure_file_limit_invalid');
  }
  const path = resolve(pathInput);
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW;
  let handle: FileHandle;
  try {
    handle = await open(path, flags);
  } catch {
    throw new Error('manager_secure_file_invalid');
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      !Number.isSafeInteger(before.size) ||
      before.size > maximumBytes
    ) {
      throw new Error('manager_secure_file_invalid');
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const overflow = Buffer.alloc(1);
    const overflowRead = await handle.read(overflow, 0, 1, bytes.length);
    const after = await handle.stat();
    if (
      offset !== before.size ||
      overflowRead.bytesRead !== 0 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error('manager_secure_file_changed');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readManagerSecureTextFileV1(
  pathInput: string,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('manager_secure_file_limit_invalid');
  }
  return (await readManagerSecureBytesFileV1(pathInput, maximumBytes)).toString(
    'utf8',
  );
}
