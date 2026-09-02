import { describe, it, expect, vi } from 'vitest';
import { applyZoomWithPadding, createCountBadge, getBadgePosition, getCompletionDotPosition, hasBpmnDiagramLayout } from '@src/features/shared/components/viewer/viewerUtils';
import { BADGE_POSITIONS_RECTANGLE, PADDING_FACTOR } from '@src/features/shared/components/viewer/viewerConstants';

describe('viewerUtils', () => {
  it('applies zoom with padding', () => {
    const zoom = vi.fn();
    const viewbox = vi.fn().mockReturnValue({ scale: 2, x: 0, y: 0, width: 100, height: 80 });
    const canvas = { zoom, viewbox };

    applyZoomWithPadding(canvas);

    expect(zoom).toHaveBeenCalledWith('fit-viewport', 'auto');
    expect(zoom).toHaveBeenCalledWith(2 * PADDING_FACTOR, { x: 50, y: 40 });
  });

  it('creates a count badge with display text', () => {
    const badge = createCountBadge(5, 'incidents');
    expect(badge.textContent).toContain('5');
  });

  it('caps large badge counts', () => {
    const badge = createCountBadge(1500, 'active');
    expect(badge.textContent).toContain('999+');
  });

  it('returns badge position for state', () => {
    expect(getBadgePosition('active')).toEqual(BADGE_POSITIONS_RECTANGLE.active);
  });

  it('returns completion dot position', () => {
    expect(getCompletionDotPosition()).toEqual({ bottom: -2, left: 5 });
  });

  it('recognizes namespaced BPMN diagram interchange layout', () => {
    expect(hasBpmnDiagramLayout(`
      <bpmndi:BPMNDiagram>
        <bpmndi:BPMNPlane>
          <bpmndi:BPMNShape />
        </bpmndi:BPMNPlane>
      </bpmndi:BPMNDiagram>
    `)).toBe(true);
  });

  it('recognizes unprefixed BPMN diagram interchange layout', () => {
    expect(hasBpmnDiagramLayout('<BPMNDiagram><BPMNPlane><BPMNShape /></BPMNPlane></BPMNDiagram>')).toBe(true);
  });

  it('rejects executable BPMN without drawable layout coordinates', () => {
    expect(hasBpmnDiagramLayout('<bpmn:definitions><bpmn:process isExecutable="true" /></bpmn:definitions>')).toBe(false);
    expect(hasBpmnDiagramLayout('<bpmndi:BPMNDiagram><bpmndi:BPMNPlane /></bpmndi:BPMNDiagram>')).toBe(false);
    expect(hasBpmnDiagramLayout(null)).toBe(false);
  });
});
