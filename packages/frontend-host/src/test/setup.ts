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

// Carbon responsive navigation evaluates media queries when it mounts. jsdom
// does not implement matchMedia, so expose the browser-compatible no-op shape.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Carbon dropdowns scroll the highlighted list item into view. jsdom does not
// implement this browser API, so provide the no-op layout equivalent for tests.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
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
