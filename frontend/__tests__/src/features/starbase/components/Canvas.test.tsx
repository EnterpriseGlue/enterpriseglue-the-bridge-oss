import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// ── Mock heavy modeler dependencies before importing the component ──────────
const mockImportXML = vi.fn().mockResolvedValue({});
const mockSaveXML = vi.fn().mockResolvedValue({ xml: '<bpmn />' });
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockGet = vi.fn().mockReturnValue({ close: vi.fn(), _update: vi.fn() });
const mockAttachTo = vi.fn();
const mockDetach = vi.fn();

vi.mock('camunda-bpmn-js/lib/camunda-platform/Modeler', () => ({
  default: vi.fn().mockImplementation(() => ({
    importXML: mockImportXML,
    saveXML: mockSaveXML,
    on: mockOn,
    off: mockOff,
    get: mockGet,
    attachTo: mockAttachTo,
    detach: mockDetach,
    destroy: vi.fn(),
  })),
}));

vi.mock('camunda-bpmn-moddle/resources/camunda.json', () => ({ default: {} }));
vi.mock('bpmn-js-bpmnlint', () => ({ default: {} }));
vi.mock('@src/config/bpmn-engine-lint', () => ({
  camundaConfig: {},
  camundaResolver: {},
}));
vi.mock('@src/features/starbase/components/ProblemsPanel', () => ({
  default: () => <div data-testid="problems-panel" />,
}));

// Stub CSS imports
vi.mock('bpmn-js/dist/assets/diagram-js.css', () => ({}));
vi.mock('bpmn-js/dist/assets/bpmn-font/css/bpmn.css', () => ({}));
vi.mock('bpmn-js/dist/assets/bpmn-font/css/bpmn-codes.css', () => ({}));
vi.mock('bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css', () => ({}));
vi.mock('@src/styles/lint-overrides.css', () => ({}));
vi.mock('@bpmn-io/properties-panel/dist/assets/properties-panel.css', () => ({}));
vi.mock('camunda-bpmn-js/dist/assets/camunda-platform-modeler.css', () => ({}));

import Canvas from '@src/features/starbase/components/Canvas';

describe('Canvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports Canvas component', () => {
    expect(Canvas).toBeDefined();
    expect(typeof Canvas).toBe('function');
  });

  it('renders transparent overlay div when readOnly is true', () => {
    const { container } = render(<Canvas xml="<bpmn />" readOnly={true} />);

    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).toContain('canvas-read-only');

    // Overlay div: position absolute, inset 0, z-index 10
    const overlayDiv = outerDiv.querySelector('[style*="position: absolute"]') as HTMLElement;
    expect(overlayDiv).not.toBeNull();
    expect(overlayDiv!.style.zIndex).toBe('10');
    expect(overlayDiv!.style.inset).toBe('0px');
    expect(overlayDiv!.style.background).toBe('transparent');
  });

  it('does NOT render overlay div when readOnly is false', () => {
    const { container } = render(<Canvas xml="<bpmn />" readOnly={false} />);

    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).not.toContain('canvas-read-only');

    const overlayDiv = outerDiv.querySelector('[style*="position: absolute"]');
    expect(overlayDiv).toBeNull();
  });

  it('does NOT render overlay div by default (readOnly unset)', () => {
    const { container } = render(<Canvas xml="<bpmn />" />);

    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).not.toContain('canvas-read-only');
  });
});
