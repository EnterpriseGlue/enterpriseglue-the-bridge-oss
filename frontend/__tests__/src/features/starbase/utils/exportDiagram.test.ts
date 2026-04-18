import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  canExportDiagram,
  captureDiagramSvg,
  computePdfLayout,
  DEFAULT_PDF_PADDING_PT,
  fitViewportBeforeExport,
  svgToPdfBlob,
  toDownloadBaseName,
} from '@src/features/starbase/utils/exportDiagram';

// jsdom does not implement SVGGraphicsElement.getBBox which svg2pdf.js relies
// on for text layout. Provide a deterministic stub sufficient for the export
// round-trip in tests. Real browsers supply this natively.
beforeAll(() => {
  const proto = (globalThis as any).SVGElement?.prototype;
  if (proto && typeof proto.getBBox !== 'function') {
    proto.getBBox = function getBBoxStub() {
      return { x: 0, y: 0, width: 100, height: 20 };
    };
  }
});

const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300" viewBox="0 0 400 300">
  <rect x="20" y="20" width="200" height="100" stroke="#333" fill="#fff" />
  <text x="40" y="70" font-family="Arial" font-size="14">Approval</text>
</svg>`;

describe('exportDiagram.captureDiagramSvg', () => {
  it('throws when the modeler has no saveSVG method', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      captureDiagramSvg({} as any),
    ).rejects.toThrow(/only available for BPMN diagrams and DMN DRDs/i);
  });

  it('throws when saveSVG returns an empty string', async () => {
    const modeler = { saveSVG: async () => ({ svg: '   ' }) };
    await expect(captureDiagramSvg(modeler)).rejects.toThrow(/empty/i);
  });

  it('returns the svg markup from a healthy modeler and attempts fit-viewport', async () => {
    const zoom = vi.fn();
    const canvas = { zoom };
    const modeler = {
      saveSVG: vi.fn(async () => ({ svg: SAMPLE_SVG })),
      get: vi.fn((service: string) => (service === 'canvas' ? canvas : undefined)),
    };

    const result = await captureDiagramSvg(modeler);
    expect(result).toContain('<svg');
    expect(zoom).toHaveBeenCalledWith('fit-viewport');
    expect(modeler.saveSVG).toHaveBeenCalled();
  });
});

describe('exportDiagram.fitViewportBeforeExport', () => {
  it('swallows errors from modelers that throw in canvas access', () => {
    const modeler = {
      saveSVG: async () => ({ svg: SAMPLE_SVG }),
      get: () => {
        throw new Error('no canvas here');
      },
    };
    expect(() => fitViewportBeforeExport(modeler)).not.toThrow();
  });

  it('no-ops for null modeler', () => {
    expect(() => fitViewportBeforeExport(null)).not.toThrow();
  });
});

describe('exportDiagram.svgToPdfBlob', () => {
  it('produces a non-empty application/pdf blob from a valid SVG string', async () => {
    const blob = await svgToPdfBlob(SAMPLE_SVG);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('throws a descriptive error for non-SVG input', async () => {
    await expect(svgToPdfBlob('not svg at all')).rejects.toThrow(/parse/i);
  });
});

describe('exportDiagram.canExportDiagram', () => {
  it('returns false for null / bare modelers', () => {
    expect(canExportDiagram(null)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(canExportDiagram({} as any)).toBe(false);
  });

  it('returns true for a BPMN-style single-viewer modeler with saveSVG', () => {
    const modeler = { saveSVG: async () => ({ svg: SAMPLE_SVG }) };
    expect(canExportDiagram(modeler)).toBe(true);
  });

  it('returns true for DMN when the active view is the DRD', () => {
    const modeler = {
      getActiveView: () => ({ type: 'drd' }),
      getActiveViewer: () => ({ saveSVG: async () => ({ svg: SAMPLE_SVG }) }),
    };
    expect(canExportDiagram(modeler)).toBe(true);
  });

  it('returns false for DMN when the active view is a decision table', () => {
    const modeler = {
      getActiveView: () => ({ type: 'decisionTable' }),
      getActiveViewer: () => ({ saveSVG: async () => ({ svg: SAMPLE_SVG }) }),
    };
    expect(canExportDiagram(modeler)).toBe(false);
  });
});

describe('exportDiagram.computePdfLayout', () => {
  it('defaults to a 200pt margin on every side', () => {
    expect(DEFAULT_PDF_PADDING_PT).toBe(200);
    const layout = computePdfLayout(400, 300);
    expect(layout).toEqual({
      pageWidth: 800,   // 400 + 2*200
      pageHeight: 700,  // 300 + 2*200
      orientation: 'landscape',
      svgX: 200,
      svgY: 200,
      svgWidth: 400,
      svgHeight: 300,
    });
  });

  it('allows zero padding for edge-to-edge rendering', () => {
    const layout = computePdfLayout(400, 300, 0);
    expect(layout.pageWidth).toBe(400);
    expect(layout.pageHeight).toBe(300);
    expect(layout.svgX).toBe(0);
    expect(layout.svgY).toBe(0);
  });

  it('falls back to the default for non-finite or negative padding', () => {
    expect(computePdfLayout(400, 300, Number.NaN).svgX).toBe(DEFAULT_PDF_PADDING_PT);
    expect(computePdfLayout(400, 300, -50).svgX).toBe(DEFAULT_PDF_PADDING_PT);
  });

  it('flips orientation to portrait once padding makes the page taller than wide', () => {
    // 100x400 diagram already portrait; confirm padding does not flip it.
    const portrait = computePdfLayout(100, 400, 50);
    expect(portrait.orientation).toBe('portrait');
    // A nearly-square diagram with symmetric padding stays in whichever is larger.
    const landscape = computePdfLayout(400, 300, 200);
    expect(landscape.orientation).toBe('landscape');
  });
});

describe('exportDiagram.toDownloadBaseName', () => {
  it('sanitises raw names and falls back for meaningless input', () => {
    expect(toDownloadBaseName('My Process')).toBe('My Process');
    expect(toDownloadBaseName('')).toBe('diagram');
    expect(toDownloadBaseName('///')).toBe('diagram');
  });
});
