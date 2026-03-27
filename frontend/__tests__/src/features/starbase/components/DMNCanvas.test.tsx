import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// ── Mock heavy DMN modeler dependency before importing the component ─────────
const mockImportXML = vi.fn().mockResolvedValue({});
const mockSaveXML = vi.fn().mockResolvedValue({ xml: '<dmn />' });
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockGetViews = vi.fn().mockReturnValue([]);
const mockOpen = vi.fn().mockResolvedValue({});
const mockGetActiveViewer = vi.fn().mockReturnValue({ on: vi.fn(), off: vi.fn() });

vi.mock('camunda-dmn-js', () => ({
  CamundaPlatformModeler: vi.fn().mockImplementation(() => ({
    importXML: mockImportXML,
    saveXML: mockSaveXML,
    on: mockOn,
    off: mockOff,
    getViews: mockGetViews,
    open: mockOpen,
    getActiveViewer: mockGetActiveViewer,
    attachTo: vi.fn(),
    detach: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// Stub CSS import
vi.mock('camunda-dmn-js/dist/assets/camunda-platform-modeler.css', () => ({}));

import DMNCanvas from '@src/features/starbase/components/DMNCanvas';

describe('DMNCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports DMNCanvas component', () => {
    expect(DMNCanvas).toBeDefined();
    expect(typeof DMNCanvas).toBe('function');
  });

  it('renders transparent overlay div when readOnly is true', () => {
    const { container } = render(<DMNCanvas xml="<dmn />" readOnly={true} />);

    // The wrapper div is the outermost element
    const wrapperDiv = container.firstElementChild as HTMLElement;
    const overlayDiv = wrapperDiv.querySelector('[style*="position: absolute"]') as HTMLElement;
    expect(overlayDiv).not.toBeNull();
    expect(overlayDiv!.style.zIndex).toBe('10');
    expect(overlayDiv!.style.inset).toBe('0px');
    expect(overlayDiv!.style.background).toBe('transparent');
  });

  it('does NOT render overlay div when readOnly is false', () => {
    const { container } = render(<DMNCanvas xml="<dmn />" readOnly={false} />);

    const wrapperDiv = container.firstElementChild as HTMLElement;
    const overlayDiv = wrapperDiv.querySelector('[style*="position: absolute"]');
    expect(overlayDiv).toBeNull();
  });

  it('does NOT render overlay div by default (readOnly unset)', () => {
    const { container } = render(<DMNCanvas xml="<dmn />" />);

    const wrapperDiv = container.firstElementChild as HTMLElement;
    const overlayDiv = wrapperDiv.querySelector('[style*="position: absolute"]');
    expect(overlayDiv).toBeNull();
  });
});
