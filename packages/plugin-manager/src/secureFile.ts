import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readManagerSecureTextFileV1(
  pathInput: string,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('manager_secure_file_limit_invalid');
  }
  const path = resolve(pathInput);
  const pathDetails = await lstat(path);
  if (!pathDetails.isFile() || pathDetails.isSymbolicLink()) {
    throw new Error('manager_secure_file_invalid');
  }
  const flags =
    constants.O_RDONLY |
    (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
  const handle = await open(path, flags);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > maximumBytes) {
      throw new Error('manager_secure_file_invalid');
    }
    const bytes = Buffer.alloc(details.size);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== details.size) {
      throw new Error('manager_secure_file_short_read');
    }
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}
