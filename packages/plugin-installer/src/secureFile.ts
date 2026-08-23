import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export class SecureFileReadErrorV1 extends Error {
  constructor(readonly code: 'file_invalid' | 'file_too_large') {
    super(code);
    this.name = 'SecureFileReadErrorV1';
  }
}

export async function readBoundedRegularFileV1(
  path: string,
  maximumBytes: number,
): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const details = await handle.stat();
    if (!details.isFile()) {
      throw new SecureFileReadErrorV1('file_invalid');
    }
    if (details.size > maximumBytes) {
      throw new SecureFileReadErrorV1('file_too_large');
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}
