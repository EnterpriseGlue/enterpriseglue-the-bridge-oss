import { describe, expect, it, vi } from 'vitest';

import {
  relayValidatedPluginSseV1,
  type PluginSseDownstreamV1,
} from './pluginSseProxy.js';

class MemorySseDownstream implements PluginSseDownstreamV1 {
  readonly headers = new Map<string, string>();
  readonly chunks: string[] = [];
  statusCode = 0;
  writableEnded = false;

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  once(_event: 'drain', listener: () => void): void {
    listener();
  }

  end(): void {
    this.writableEnded = true;
  }
}

class DisconnectingBackpressureDownstream extends MemorySseDownstream {
  disconnected = false;
  drainObserved = false;

  override write(chunk: string): boolean {
    this.chunks.push(chunk);
    this.disconnected = true;
    return false;
  }

  override once(_event: 'drain', listener: () => void): void {
    this.drainObserved = true;
    listener();
  }
}

function streamResponse(chunks: string[], contentType = 'text/event-stream') {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': contentType },
    },
  );
}

describe('plugin SSE proxy', () => {
  it('relays only canonical schema-validated JSON events and heartbeats', async () => {
    const downstream = new MemorySseDownstream();
    const assertEvent = vi.fn(async (payload: unknown) => {
      if (
        !payload ||
        typeof payload !== 'object' ||
        (payload as { state?: unknown }).state !== 'analyzing'
      ) {
        throw new Error('invalid');
      }
    });

    await expect(
      relayValidatedPluginSseV1({
        upstream: streamResponse([
          ': plugin heartbeat\n\nid: progress-1\r\n',
          'event: progress\r\ndata: {"state":"analyzing"}\r\n\r\n',
        ]),
        downstream,
        maximumBytes: 4_096,
        assertEvent,
        isClientDisconnected: () => false,
      }),
    ).resolves.toBe('completed');

    expect(assertEvent).toHaveBeenCalledWith({ state: 'analyzing' });
    expect(downstream.statusCode).toBe(200);
    expect(downstream.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(downstream.chunks.join('')).toBe(
      ': keepalive\n\nid: progress-1\nevent: progress\ndata: {"state":"analyzing"}\n\n',
    );
    expect(downstream.writableEnded).toBe(true);
  });

  it('terminates with a fixed host error when an event violates its schema', async () => {
    const downstream = new MemorySseDownstream();

    await expect(
      relayValidatedPluginSseV1({
        upstream: streamResponse(['data: {"raw":"forbidden"}\n\n']),
        downstream,
        maximumBytes: 4_096,
        assertEvent: async () => {
          throw new Error('schema mismatch');
        },
        isClientDisconnected: () => false,
      }),
    ).resolves.toBe('upstream_invalid');

    expect(downstream.chunks).toEqual([
      'event: error\ndata: {"code":"stream_invalid"}\n\n',
    ]);
    expect(downstream.writableEnded).toBe(true);
  });

  it('rejects wrong content types and enforces the operation byte ceiling', async () => {
    const wrongType = new MemorySseDownstream();
    await expect(
      relayValidatedPluginSseV1({
        upstream: streamResponse(
          ['data: {"state":"analyzing"}\n\n'],
          'application/json',
        ),
        downstream: wrongType,
        maximumBytes: 4_096,
        assertEvent: async () => undefined,
        isClientDisconnected: () => false,
      }),
    ).resolves.toBe('upstream_invalid');
    expect(wrongType.chunks).toEqual([]);

    const oversized = new MemorySseDownstream();
    await expect(
      relayValidatedPluginSseV1({
        upstream: streamResponse([
          `data: ${JSON.stringify({ value: 'x'.repeat(200) })}\n\n`,
        ]),
        downstream: oversized,
        maximumBytes: 64,
        assertEvent: async () => undefined,
        isClientDisconnected: () => false,
      }),
    ).resolves.toBe('upstream_invalid');
    expect(oversized.chunks).toEqual([
      'event: error\ndata: {"code":"stream_invalid"}\n\n',
    ]);
  });

  it('honors downstream backpressure and cancels upstream after client disconnect', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"state":"analyzing"}\n\n'),
      encoder.encode('data: {"state":"resolved"}\n\n'),
    ];
    let readIndex = 0;
    const cancel = vi.fn(async () => undefined);
    const read = vi.fn(async () => {
      const value = chunks[readIndex++];
      return value
        ? { done: false as const, value }
        : { done: true as const };
    });
    const downstream = new DisconnectingBackpressureDownstream();

    await expect(
      relayValidatedPluginSseV1({
        upstream: {
          status: 200,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-type'
                ? 'text/event-stream'
                : null,
          },
          body: { getReader: () => ({ read, cancel }) },
        },
        downstream,
        maximumBytes: 4_096,
        assertEvent: async () => undefined,
        isClientDisconnected: () => downstream.disconnected,
      }),
    ).resolves.toBe('client_disconnected');

    expect(downstream.drainObserved).toBe(true);
    expect(downstream.chunks).toEqual([
      'data: {"state":"analyzing"}\n\n',
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(downstream.writableEnded).toBe(false);
  });
});
