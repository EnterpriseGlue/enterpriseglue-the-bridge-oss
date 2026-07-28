import { describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  consumeJsonSseResponse,
} from './client';

function response(chunks: string[], contentType = 'text/event-stream') {
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

describe('JSON SSE client', () => {
  it('parses split canonical events and ignores host heartbeats', async () => {
    const onEvent = vi.fn();
    await consumeJsonSseResponse(
      response([
        ': keepalive\n\nid: progress-1\nev',
        'ent: progress\ndata: {"state":"analyzing"}\n\n',
      ]),
      onEvent,
    );
    expect(onEvent).toHaveBeenCalledWith({
      id: 'progress-1',
      event: 'progress',
      data: { state: 'analyzing' },
    });
  });

  it('rejects host error events and truncated streams', async () => {
    await expect(
      consumeJsonSseResponse(
        response([
          'event: error\ndata: {"code":"stream_invalid"}\n\n',
        ]),
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      consumeJsonSseResponse(
        response(['data: {"state":"analyzing"}']),
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('requires the event-stream content type', async () => {
    await expect(
      consumeJsonSseResponse(
        response(['data: {}\n\n'], 'application/json'),
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('cancels the browser stream when event handling rejects the payload', async () => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const eventStream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: progress\ndata: {"state":"analyzing"}\n\n'),
          );
        },
        cancel,
      }),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      },
    );

    await expect(
      consumeJsonSseResponse(eventStream, () => {
        throw new Error('plugin event binding failed');
      }),
    ).rejects.toThrow('plugin event binding failed');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
