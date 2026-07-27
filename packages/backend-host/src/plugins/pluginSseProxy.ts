const MAX_SSE_EVENT_BYTES = 256 * 1024;
const MAX_SSE_EVENTS = 10_000;

export interface PluginSseDownstreamV1 {
  readonly writableEnded?: boolean;
  setHeader(name: string, value: string): void;
  status(code: number): PluginSseDownstreamV1;
  write(chunk: string): boolean;
  once(event: 'drain', listener: () => void): unknown;
  end(): void;
}

export type PluginSseRelayResultV1 =
  | 'completed'
  | 'client_disconnected'
  | 'upstream_invalid';

interface RelayPluginSseInputV1 {
  upstream: {
    status: number;
    headers: { get(name: string): string | null };
    body: unknown;
  };
  downstream: PluginSseDownstreamV1;
  maximumBytes: number;
  assertEvent(payload: unknown): Promise<void>;
  isClientDisconnected(): boolean;
}

interface PluginSseReaderV1 {
  read(): Promise<
    | { done: true; value?: undefined }
    | { done: false; value: Uint8Array }
  >;
  cancel(): Promise<void>;
}

interface ParsedSseEvent {
  event?: string;
  id?: string;
  data: unknown;
}

/**
 * Relays only canonical, schema-validated JSON SSE events.
 *
 * The proxy never forwards raw upstream lines. It parses one bounded event,
 * validates the JSON `data` value against the operation response schema, then
 * serializes a fresh event. This prevents header/field injection and keeps
 * plugin streams inside the same closed contract as ordinary JSON responses.
 */
export async function relayValidatedPluginSseV1(
  input: RelayPluginSseInputV1,
): Promise<PluginSseRelayResultV1> {
  if (
    input.upstream.status < 200 ||
    input.upstream.status >= 300 ||
    !isEventStream(input.upstream.headers.get('content-type')) ||
    !input.upstream.body
  ) {
    return 'upstream_invalid';
  }
  const declaredLength = Number(
    input.upstream.headers.get('content-length'),
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > input.maximumBytes
  ) {
    return 'upstream_invalid';
  }

  input.downstream.status(input.upstream.status);
  input.downstream.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  input.downstream.setHeader('Cache-Control', 'no-store');
  input.downstream.setHeader('X-Content-Type-Options', 'nosniff');
  input.downstream.setHeader('X-Accel-Buffering', 'no');

  const reader = (
    input.upstream.body as { getReader(): PluginSseReaderV1 }
  ).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let byteCount = 0;
  let eventCount = 0;

  try {
    while (true) {
      if (input.isClientDisconnected()) {
        await reader.cancel();
        return 'client_disconnected';
      }
      const next = await reader.read();
      if (next.done) break;
      byteCount += next.value.byteLength;
      if (byteCount > input.maximumBytes) {
        return await failStream(input, reader);
      }
      buffer += decoder.decode(next.value, { stream: true });
      while (true) {
        const boundary = eventBoundary(buffer);
        if (!boundary) break;
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        if (block.trim().length === 0) continue;
        if (Buffer.byteLength(block, 'utf8') > MAX_SSE_EVENT_BYTES) {
          return await failStream(input, reader);
        }
        if (heartbeatBlock(block)) {
          await writeWithBackpressure(input.downstream, ': keepalive\n\n');
          continue;
        }
        eventCount += 1;
        if (eventCount > MAX_SSE_EVENTS) {
          return await failStream(input, reader);
        }
        const event = parseEvent(block);
        if (!event) {
          return await failStream(input, reader);
        }
        try {
          await input.assertEvent(event.data);
        } catch {
          return await failStream(input, reader);
        }
        await writeWithBackpressure(
          input.downstream,
          serializeEvent(event),
        );
      }
      if (Buffer.byteLength(buffer, 'utf8') > MAX_SSE_EVENT_BYTES) {
        return await failStream(input, reader);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length !== 0) {
      return await failStream(input, reader);
    }
    if (!input.downstream.writableEnded) input.downstream.end();
    return 'completed';
  } catch {
    if (input.isClientDisconnected()) return 'client_disconnected';
    return await failStream(input, reader);
  }
}

function isEventStream(contentType: string | null): boolean {
  return Boolean(
    contentType &&
      /^text\/event-stream(?:\s*;|$)/i.test(contentType),
  );
}

function eventBoundary(
  value: string,
): { index: number; length: number } | undefined {
  const match = /(?:\r\n\r\n|\n\n|\r\r)/.exec(value);
  return match
    ? { index: match.index, length: match[0].length }
    : undefined;
}

function heartbeatBlock(block: string): boolean {
  const lines = block.split(/\r\n|\r|\n/);
  return lines.length > 0 && lines.every((line) => line.startsWith(':'));
}

function parseEvent(block: string): ParsedSseEvent | undefined {
  const lines = block.split(/\r\n|\r|\n/);
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'data') {
      data.push(value);
      continue;
    }
    if (
      field === 'event' &&
      /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(value)
    ) {
      if (event !== undefined) return undefined;
      event = value;
      continue;
    }
    if (field === 'id' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
      if (id !== undefined) return undefined;
      id = value;
      continue;
    }
    return undefined;
  }
  if (data.length === 0) return undefined;
  const serialized = data.join('\n');
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SSE_EVENT_BYTES) {
    return undefined;
  }
  try {
    return {
      ...(event ? { event } : {}),
      ...(id ? { id } : {}),
      data: JSON.parse(serialized),
    };
  } catch {
    return undefined;
  }
}

function serializeEvent(event: ParsedSseEvent): string {
  return [
    ...(event.id ? [`id: ${event.id}`] : []),
    ...(event.event ? [`event: ${event.event}`] : []),
    `data: ${JSON.stringify(event.data)}`,
    '',
    '',
  ].join('\n');
}

async function writeWithBackpressure(
  downstream: PluginSseDownstreamV1,
  value: string,
): Promise<void> {
  if (downstream.write(value)) return;
  await new Promise<void>((resolve) => {
    downstream.once('drain', resolve);
  });
}

async function failStream(
  input: RelayPluginSseInputV1,
  reader: PluginSseReaderV1,
): Promise<'upstream_invalid'> {
  try {
    await reader.cancel();
  } catch {
    // The fixed host error below is still safe if the upstream already failed.
  }
  if (!input.isClientDisconnected() && !input.downstream.writableEnded) {
    await writeWithBackpressure(
      input.downstream,
      'event: error\ndata: {"code":"stream_invalid"}\n\n',
    );
    input.downstream.end();
  }
  return 'upstream_invalid';
}
