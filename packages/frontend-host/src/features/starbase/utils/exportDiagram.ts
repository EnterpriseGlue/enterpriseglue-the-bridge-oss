/**
 * Starbase diagram export utilities.
 *
 * Converts a BPMN/DMN modeler instance's current SVG rendering into a PDF
 * or SVG Blob and triggers a download. Designed for the editor's "Download
 * as PDF" action.
 *
 * Notes
 * - Dependencies (`jspdf`, `svg2pdf.js`) are imported dynamically so they
 *   are only pulled into the bundle when a user actually exports.
 * - Before reading SVG the caller should call `canvas.zoom('fit-viewport')`
 *   via `fitViewportBeforeExport` so the produced image reflects the full
 *   diagram regardless of current pan/zoom.
 * - PDF rendering preserves vector fidelity (text remains selectable) when
 *   `svg2pdf.js` can interpret the SVG. Complex SVG features may fall back
 *   to rasterisation inside `svg2pdf.js`; this is acceptable for Starbase
 *   diagrams which use a constrained visual language.
 */

import {
  buildStarbaseFileName,
  sanitizeFileNameSegment,
} from '@enterpriseglue/shared/utils/starbase-filenames.js';
import { downloadBlob } from '../../../utils/safeDom';

/** Minimal shape of a bpmn-js / dmn-js modeler we need for export. */
export interface DiagramModelerLike {
  saveSVG?: (
    opts?: unknown,
  ) => Promise<{ svg: string }>;
  get?: (service: string) => unknown;
  /** dmn-js only — returns the currently active view descriptor. */
  getActiveView?: () => { type?: string } | null | undefined;
  /** dmn-js only — returns the viewer instance for the active view. */
  getActiveViewer?: () => DiagramModelerLike | null | undefined;
}

/**
 * Return `true` when the current modeler view can produce a meaningful SVG
 * for diagram export. Always `true` for BPMN (single-viewer) modelers. For
 * DMN, only the DRD view is exportable; decision tables, literal
 * expressions, etc. are non-diagram and should be excluded from PDF/SVG
 * export.
 */
export function canExportDiagram(modeler: DiagramModelerLike | null | undefined): boolean {
  if (!modeler) return false;
  // DMN modelers expose getActiveView. BPMN modelers do not.
  if (typeof modeler.getActiveView === 'function') {
    try {
      const view = modeler.getActiveView();
      return !!view && view.type === 'drd';
    } catch {
      return false;
    }
  }
  // BPMN (or any single-viewer modeler) — always exportable if saveSVG exists.
  return typeof modeler.saveSVG === 'function' || typeof modeler.getActiveViewer === 'function';
}

export interface ExportDiagramOptions {
  /** Base filename (usually the Starbase file name without extension). */
  baseName: string;
  /**
   * Starbase file type (`bpmn`/`dmn`). Used only to select a meaningful
   * fallback when `baseName` is missing.
   */
  type?: string | null;
  /**
   * White padding (in PDF points, equivalent to SVG pixels under svg2pdf.js)
   * applied around the diagram inside the generated PDF page. Defaults to
   * `DEFAULT_PDF_PADDING_PT`.
   */
  paddingPt?: number;
}

/**
 * Default white padding (in PDF points) applied around the diagram when
 * rendering to PDF. jsPDF uses pt internally and svg2pdf.js maps SVG user
 * units 1:1 to pt, so this is effectively the pixel padding requested by
 * the user (“~200 px”).
 */
export const DEFAULT_PDF_PADDING_PT = 200;

export interface PdfLayout {
  /** Total PDF page width, including padding on both sides. */
  pageWidth: number;
  /** Total PDF page height, including padding on both sides. */
  pageHeight: number;
  /** jsPDF orientation computed from the padded page. */
  orientation: 'landscape' | 'portrait';
  /** X offset at which svg2pdf should place the diagram inside the page. */
  svgX: number;
  /** Y offset at which svg2pdf should place the diagram inside the page. */
  svgY: number;
  /** Diagram width passed to svg2pdf (== source SVG width). */
  svgWidth: number;
  /** Diagram height passed to svg2pdf (== source SVG height). */
  svgHeight: number;
}

/**
 * Pure helper that computes the PDF page geometry for a given diagram size
 * and padding. Extracted from `svgToPdfBlob` so the padding math can be
 * unit-tested without the jspdf/svg2pdf dynamic imports.
 */
export function computePdfLayout(
  width: number,
  height: number,
  paddingPt: number = DEFAULT_PDF_PADDING_PT,
): PdfLayout {
  const safePadding = Number.isFinite(paddingPt) && paddingPt >= 0 ? paddingPt : DEFAULT_PDF_PADDING_PT;
  const pageWidth = width + safePadding * 2;
  const pageHeight = height + safePadding * 2;
  return {
    pageWidth,
    pageHeight,
    orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
    svgX: safePadding,
    svgY: safePadding,
    svgWidth: width,
    svgHeight: height,
  };
}

/**
 * Fit the modeler's viewport before export so the rendered SVG includes the
 * full diagram. Silently ignores modelers without a canvas service.
 */
export function fitViewportBeforeExport(modeler: DiagramModelerLike | null | undefined): void {
  if (!modeler || typeof modeler.get !== 'function') return;
  try {
    const canvas = modeler.get('canvas') as { zoom?: (value: string) => void } | undefined;
    canvas?.zoom?.('fit-viewport');
  } catch {
    /* ignore fit failures, export still proceeds */
  }
}

/**
 * Extract SVG markup from a modeler. Handles both BPMN single-viewer modelers
 * (saveSVG on the top-level modeler) and DMN multi-viewer modelers (saveSVG
 * on the active viewer for DRD views). Throws a descriptive error on failure
 * so callers can surface a user-visible toast.
 */
export async function captureDiagramSvg(modeler: DiagramModelerLike): Promise<string> {
  if (!canExportDiagram(modeler)) {
    throw new Error('Diagram export is only available for BPMN diagrams and DMN DRDs.');
  }

  // Prefer saveSVG on the active viewer when the modeler is a multi-viewer
  // container (dmn-js). Fall back to the top-level saveSVG for BPMN.
  const activeViewer = typeof modeler.getActiveViewer === 'function'
    ? modeler.getActiveViewer()
    : null;
  const target: DiagramModelerLike | null =
    activeViewer && typeof activeViewer.saveSVG === 'function' ? activeViewer : modeler;

  if (!target || typeof target.saveSVG !== 'function') {
    throw new Error('Diagram export is not available for this view.');
  }

  fitViewportBeforeExport(target);
  const result = await target.saveSVG();
  const svg = result && typeof result.svg === 'string' ? result.svg : '';
  if (!svg.trim()) {
    throw new Error('Diagram is empty; nothing to export.');
  }
  return svg;
}

/** Parse an SVG string and return the root `<svg>` element (detached). */
function parseSvgDocument(svg: string): SVGSVGElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement as unknown as SVGSVGElement | null;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Could not parse diagram SVG for export.');
  }
  return root;
}

interface SvgDimensions {
  width: number;
  height: number;
}

/**
 * Resolve the rendered SVG's pixel dimensions. Falls back to the viewBox when
 * explicit width/height attributes are absent (typical for bpmn-js output).
 */
function resolveSvgDimensions(svgEl: SVGSVGElement): SvgDimensions {
  const parseUnitless = (value: string | null): number | null => {
    if (!value) return null;
    const num = parseFloat(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  const explicitWidth = parseUnitless(svgEl.getAttribute('width'));
  const explicitHeight = parseUnitless(svgEl.getAttribute('height'));
  if (explicitWidth && explicitHeight) {
    return { width: explicitWidth, height: explicitHeight };
  }

  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [, , w, h] = parts;
      if (w > 0 && h > 0) {
        return { width: w, height: h };
      }
    }
  }

  // Last-resort fallback (A4 landscape-ish) — should be unreachable for
  // bpmn-js output which always emits a viewBox.
  return { width: 1240, height: 877 };
}

/**
 * Render a BPMN/DMN DRD modeler's current diagram as a PDF blob and trigger a
 * browser download. Uses dynamic imports to keep `jspdf` and `svg2pdf.js` out
 * of the main bundle.
 */
export async function exportDiagramAsPdf(
  modeler: DiagramModelerLike,
  opts: ExportDiagramOptions,
): Promise<void> {
  const svg = await captureDiagramSvg(modeler);
  const blob = await svgToPdfBlob(svg, { paddingPt: opts.paddingPt });
  const filename = buildStarbaseFileName(opts.baseName, opts.type ?? null, {
    forceExtension: 'pdf',
    fallbackBase: 'diagram',
  });
  downloadBlob(blob, filename);
}

/** Render the modeler's current diagram as an SVG blob and download it. */
export async function exportDiagramAsSvg(
  modeler: DiagramModelerLike,
  opts: ExportDiagramOptions,
): Promise<void> {
  const svg = await captureDiagramSvg(modeler);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const filename = buildStarbaseFileName(opts.baseName, opts.type ?? null, {
    forceExtension: 'svg',
    fallbackBase: 'diagram',
  });
  downloadBlob(blob, filename);
}

/**
 * Convert an SVG string to a PDF Blob using jspdf + svg2pdf.js. Extracted so
 * it can be unit tested in isolation with jsdom.
 *
 * A white padding (default `DEFAULT_PDF_PADDING_PT`) is added around the
 * diagram by growing the page and offsetting the svg2pdf render origin. The
 * jsPDF page background is white by default, so no explicit fill is needed.
 */
export async function svgToPdfBlob(
  svg: string,
  opts: { paddingPt?: number } = {},
): Promise<Blob> {
  const svgEl = parseSvgDocument(svg);
  const { width, height } = resolveSvgDimensions(svgEl);
  const layout = computePdfLayout(width, height, opts.paddingPt);

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ]);

  const pdf = new jsPDF({
    orientation: layout.orientation,
    unit: 'pt',
    format: [layout.pageWidth, layout.pageHeight],
    compress: true,
  });

  await svg2pdf(svgEl, pdf, {
    x: layout.svgX,
    y: layout.svgY,
    width: layout.svgWidth,
    height: layout.svgHeight,
  });

  const arrayBuffer = pdf.output('arraybuffer');
  return new Blob([arrayBuffer], { type: 'application/pdf' });
}

/**
 * Sanitize an arbitrary display name to a download base name. Exposed so the
 * editor can derive a safe filename from the current file/title label.
 */
export function toDownloadBaseName(name: unknown): string {
  return sanitizeFileNameSegment(name, 'diagram');
}
