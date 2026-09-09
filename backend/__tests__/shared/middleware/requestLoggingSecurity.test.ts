import { describe, expect, it } from 'vitest';
import morgan from 'morgan';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Morgan registers its built-in tokens on the exported function at runtime.
const tokens = morgan as unknown as morgan.TokenIndexer;

describe('request logging security', () => {
  it('escapes Unicode line separators and control characters in request fields', () => {
    const request = {
      method: 'GET',
      url: '/processes\u2028forged\u2029record\nnext\rline',
      headers: { 'user-agent': 'browser\u2028forged\u2029record', referer: 'https://example.test/\nentry' },
    } as unknown as IncomingMessage;
    const line = morgan.compile(':method :url :user-agent :referrer')(tokens, request, {} as ServerResponse);
    expect(line).toBe('GET /processes\\u2028forged\\u2029record\\nnext\\rline browser\\u2028forged\\u2029record https://example.test/\\nentry');
    expect(line).not.toMatch(/[\u2028\u2029\r\n]/u);
  });

  it('preserves ordinary request fields', () => {
    const request = { method: 'GET', url: '/api/engines?limit=50', headers: {} } as IncomingMessage;
    expect(morgan.compile(':method :url')(tokens, request, {} as ServerResponse))
      .toBe('GET /api/engines?limit=50');
  });
});
