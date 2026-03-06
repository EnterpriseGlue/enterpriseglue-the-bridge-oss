import '@testing-library/jest-dom';
import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from '../../../../frontend/test/mocks/server';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = TestResizeObserver;
}

// jsdom 28 replaces the global Blob with its own implementation that
// lacks .stream(), which Response.blob() needs internally.
if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
  (Blob.prototype as any).stream = function () {
    return new ReadableStream({
      start: async (controller) => {
        controller.enqueue(new Uint8Array(await (this as Blob).arrayBuffer()));
        controller.close();
      },
    });
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
