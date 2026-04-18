/**
 * Headless BPMN/DMN → PDF rendering.
 *
 * Used by entry points that do not already have an on-screen modeler,
 * e.g. the project file list overflow menu's "Download as PDF" action.
 * The Starbase editor has its own path via `exportDiagramAsPdf(modeler, ...)`
 * because it owns a live modeler instance; this helper is for the case
 * where we only have the raw XML.
 *
 * Implementation notes:
 *
 * - The viewer libraries (`bpmn-js/lib/NavigatedViewer`,
 *   `dmn-js/lib/NavigatedViewer`) are loaded via dynamic `import()` so they
 *   do not inflate the ProjectDetail route bundle. They are effectively
 *   free anyway because they share their chunks with the editor-vendor
 *   chunk, but keeping the boundary lazy is the safe default.
 * - The viewer is mounted into a detached off-screen `<div>` with a
 *   fixed size large enough to allow `fit-viewport` to compute sensible
 *   bounds without the element being laid out by the main document.
 *   The container is removed in `finally` so we never leave stray DOM
 *   around, even if the viewer throws mid-import.
 * - All filename/sanitization concerns are delegated to the shared
 *   `toDownloadBaseName` + `exportDiagramAsPdf` helpers so the produced
 *   PDF has the same name as the editor-based export for the same file.
 */

import { exportDiagramAsPdf, toDownloadBaseName } from './exportDiagram';

export interface RenderDiagramToPdfOptions {
  /** Raw BPMN XML or DMN XML of the file to export. */
  xml: string;
  /** Starbase file name (used verbatim for the PDF filename). */
  name: string;
  /** Starbase file type; controls which viewer library is loaded. */
  type: 'bpmn' | 'dmn';
}

/** Minimal dynamic-import factories for the two viewer libraries. */
export interface ViewerFactories {
  loadBpmnViewer: () => Promise<new (opts: { container: HTMLElement }) => HeadlessViewer>;
  loadDmnViewer: () => Promise<new (opts: { container: HTMLElement }) => HeadlessViewer>;
}

/** Subset of the viewer API we rely on. */
interface HeadlessViewer {
  importXML(xml: string): Promise<unknown>;
  saveSVG?(opts?: unknown): Promise<{ svg: string }>;
  get?(service: string): unknown;
  /** dmn-js only. */
  getActiveView?: () => { type?: string } | null | undefined;
  /** dmn-js only. */
  getActiveViewer?: () => HeadlessViewer | null | undefined;
  /** Most viewers expose `destroy()`; some use `_destroy()`. */
  destroy?: () => void;
}

const defaultViewerFactories: ViewerFactories = {
  loadBpmnViewer: async () => {
    const mod = await import('bpmn-js/lib/NavigatedViewer');
    // Some bundler configurations expose the constructor under .default.
    return (mod as any).default ?? (mod as any);
  },
  loadDmnViewer: async () => {
    const mod = await import('dmn-js/lib/NavigatedViewer');
    return (mod as any).default ?? (mod as any);
  },
};

/**
 * Create an off-screen container, load the correct viewer, render the XML,
 * export the result to PDF, and clean up. Throws (for the caller to toast)
 * on any failure.
 */
export async function renderDiagramToPdf(
  opts: RenderDiagramToPdfOptions,
  factories: ViewerFactories = defaultViewerFactories,
): Promise<void> {
  const { xml, name, type } = opts;
  if (!xml || typeof xml !== 'string') {
    throw new Error('Diagram source is empty; nothing to export.');
  }

  const container = document.createElement('div');
  // Off-screen, but with real pixel dimensions so fit-viewport can compute
  // bounds. Real browsers lay out detached elements only when attached; we
  // attach to document.body but keep it visually off-screen.
  container.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:0',
    'width:1200px',
    'height:800px',
    'pointer-events:none',
    'visibility:hidden',
  ].join(';');
  document.body.appendChild(container);

  let viewer: HeadlessViewer | null = null;
  try {
    const ViewerCtor =
      type === 'bpmn' ? await factories.loadBpmnViewer() : await factories.loadDmnViewer();
    viewer = new ViewerCtor({ container });
    await viewer.importXML(xml);

    await exportDiagramAsPdf(viewer, {
      baseName: toDownloadBaseName(name),
      type,
    });
  } finally {
    try {
      viewer?.destroy?.();
    } catch {
      /* ignore destroy errors — we still need to clean up the DOM node */
    }
    container.remove();
  }
}
