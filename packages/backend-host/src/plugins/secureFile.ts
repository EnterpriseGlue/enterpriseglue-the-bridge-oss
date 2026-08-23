import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';

export interface SecureFileReadOptionsV1 {
  maxBytes: number;
  minBytes?: number;
  requirePrivateMode?: boolean;
  followSymlinks?: boolean;
}

/**
 * Read a bounded regular file through one descriptor so validation and use
 * cannot be separated by a path replacement. The fixed-size buffer also keeps
 * a file that grows concurrently from bypassing the configured memory bound.
 */
export async function readSecureRegularFileV1(
  path: string,
  options: SecureFileReadOptionsV1,
): Promise<Buffer> {
  const target = options.followSymlinks === false ? path : await realpath(path);
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat({ bigint: true });
    const minBytes = BigInt(options.minBytes ?? 0);
    const maxBytes = BigInt(options.maxBytes);
    if (
      !before.isFile() ||
      before.size < minBytes ||
      before.size > maxBytes ||
      (options.requirePrivateMode === true &&
        (Number(before.mode) & 0o077) !== 0)
    ) {
      throw new Error('Secure file validation failed');
    }

    const expectedSize = Number(before.size);
    const bytes = Buffer.alloc(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const result = await handle.read(
        bytes,
        offset,
        expectedSize - offset,
        offset,
      );
      if (result.bytesRead === 0) {
        throw new Error('Secure file changed while it was being read');
      }
      offset += result.bytesRead;
    }

    const overflowProbe = Buffer.alloc(1);
    const overflow = await handle.read(overflowProbe, 0, 1, expectedSize);
    const after = await handle.stat({ bigint: true });
    if (
      overflow.bytesRead !== 0 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error('Secure file changed while it was being read');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
