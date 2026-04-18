import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDiagramToPdf, type ViewerFactories } from '@src/features/starbase/utils/renderDiagramToPdf';

// jsdom does not implement SVGElement.getBBox which svg2pdf.js relies on
// for text layout. Provide a deterministic stub sufficient for the export
// round-trip in tests. Matches the stub pattern used by
// `exportDiagram.test.ts`.
beforeAll(() => {
  const proto = (globalThis as any).SVGElement?.prototype;
  if (proto && typeof proto.getBBox !== 'function') {
    proto.getBBox = function getBBoxStub() {
      return { x: 0, y: 0, width: 100, height: 20 };
    };
  }
});

const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect x="10" y="10" width="80" height="40" fill="#fff" stroke="#333" />
  <text x="20" y="35" font-family="Arial" font-size="12">Hello</text>
</svg>`;

// Helpers -----------------------------------------------------------------

function trackUrlLifecycle() {
  const created: string[] = [];
  const revoked: string[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:mock/${created.length}:${blob.type || 'application/octet-stream'}:${blob.size}`;
    created.push(url);
    return url;
  });
  const revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
  (globalThis as any).URL.createObjectURL = createObjectURL;
  (globalThis as any).URL.revokeObjectURL = revokeObjectURL;
  return { created, revoked, createObjectURL, revokeObjectURL };
}

function makeFakeViewerCtor(options: { failImport?: boolean } = {}) {
  const destroy = vi.fn();
  const importXML = vi.fn(async () => {
    if (options.failImport) throw new Error('bad XML');
  });
  const saveSVG = vi.fn(async () => ({ svg: SAMPLE_SVG }));
  const get = vi.fn(() => ({ zoom: vi.fn() }));

  const ctor = vi.fn(function Ctor(_opts: { container: HTMLElement }) {
    return { importXML, saveSVG, get, destroy };
  }) as unknown as new (opts: { container: HTMLElement }) => any;

  return { ctor, importXML, saveSVG, destroy };
}

// Tests -------------------------------------------------------------------

describe('renderDiagramToPdf', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    trackUrlLifecycle();
  });

  it('throws immediately when xml is empty', async () => {
    await expect(
      renderDiagramToPdf({ xml: '', name: 'demo', type: 'bpmn' }),
    ).rejects.toThrow(/empty/i);
    expect(document.body.children.length).toBe(0);
  });

  it('renders a BPMN diagram by instantiating the BPMN viewer and exporting via the shared pipeline', async () => {
    const bpmn = makeFakeViewerCtor();
    const dmn = makeFakeViewerCtor();
    const factories: ViewerFactories = {
      loadBpmnViewer: async () => bpmn.ctor,
      loadDmnViewer: async () => dmn.ctor,
    };

    await renderDiagramToPdf(
      { xml: '<definitions />', name: 'Order Process', type: 'bpmn' },
      factories,
    );

    expect(bpmn.importXML).toHaveBeenCalledWith('<definitions />');
    expect(bpmn.saveSVG).toHaveBeenCalledTimes(1);
    expect(dmn.importXML).not.toHaveBeenCalled();
    // Cleans up both the viewer and the off-screen DOM container.
    expect(bpmn.destroy).toHaveBeenCalledTimes(1);
    expect(document.body.children.length).toBe(0);
  });

  it('renders a DMN diagram via the DMN viewer factory', async () => {
    const bpmn = makeFakeViewerCtor();
    const dmn = makeFakeViewerCtor();
    const factories: ViewerFactories = {
      loadBpmnViewer: async () => bpmn.ctor,
      loadDmnViewer: async () => dmn.ctor,
    };

    await renderDiagramToPdf(
      { xml: '<definitions />', name: 'Credit Decision', type: 'dmn' },
      factories,
    );

    expect(dmn.importXML).toHaveBeenCalledWith('<definitions />');
    expect(dmn.saveSVG).toHaveBeenCalledTimes(1);
    expect(bpmn.importXML).not.toHaveBeenCalled();
    expect(dmn.destroy).toHaveBeenCalledTimes(1);
  });

  it('surfaces viewer.importXML failures and still cleans up the container', async () => {
    const bpmn = makeFakeViewerCtor({ failImport: true });
    const dmn = makeFakeViewerCtor();

    await expect(
      renderDiagramToPdf(
        { xml: '<bad-xml/>', name: 'broken', type: 'bpmn' },
        {
          loadBpmnViewer: async () => bpmn.ctor,
          loadDmnViewer: async () => dmn.ctor,
        },
      ),
    ).rejects.toThrow(/bad XML/);

    // Even on failure the off-screen container must be removed and
    // destroy called to release modeler resources.
    expect(bpmn.destroy).toHaveBeenCalledTimes(1);
    expect(document.body.children.length).toBe(0);
  });

  it('mounts the viewer in an off-screen container during rendering', async () => {
    let containerDuringImport: HTMLElement | null = null;
    const bpmn = makeFakeViewerCtor();
    // Capture whatever element was passed to the viewer at construction.
    const originalCtor = bpmn.ctor;
    const spyingCtor = vi.fn(function Ctor(opts: { container: HTMLElement }) {
      containerDuringImport = opts.container;
      return (originalCtor as unknown as (opts: any) => any)(opts);
    });

    await renderDiagramToPdf(
      { xml: '<definitions />', name: 'diagram', type: 'bpmn' },
      {
        loadBpmnViewer: async () => spyingCtor as unknown as new (opts: { container: HTMLElement }) => any,
        loadDmnViewer: async () => makeFakeViewerCtor().ctor,
      },
    );

    expect(containerDuringImport).toBeTruthy();
    // Must be off-screen (not visible) while active.
    expect(containerDuringImport!.style.position).toBe('absolute');
    expect(containerDuringImport!.style.left).toBe('-10000px');
    // And removed from the DOM after rendering completes.
    expect(containerDuringImport!.isConnected).toBe(false);
  });
});
