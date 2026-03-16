import { describe, expect, it } from 'vitest';
import {
  buildLinkedProcessCreationPayload,
  getCreateLinkedProcessName,
  toBpmnProcessId,
} from '@src/features/starbase/utils/processCreation';

describe('processCreation', () => {
  describe('getCreateLinkedProcessName', () => {
    it('returns the trimmed call activity name for process links', () => {
      const element = {
        businessObject: {
          $type: 'bpmn:CallActivity',
          name: '  Perform Refund Quality Check  ',
        },
      };

      expect(getCreateLinkedProcessName(element, 'process')).toBe('Perform Refund Quality Check');
    });

    it('returns null when the selected element has no usable name', () => {
      const element = {
        businessObject: {
          $type: 'bpmn:CallActivity',
          name: '   ',
        },
      };

      expect(getCreateLinkedProcessName(element, 'process')).toBeNull();
    });

    it('returns the trimmed task name for decision links', () => {
      const element = {
        businessObject: {
          $type: 'bpmn:BusinessRuleTask',
          name: 'Risk Check',
        },
      };

      expect(getCreateLinkedProcessName(element, 'decision')).toBe('Risk Check');
    });
  });

  describe('toBpmnProcessId', () => {
    it('normalizes spaces and punctuation', () => {
      expect(toBpmnProcessId('Perform Refund Quality Check')).toBe('Perform_Refund_Quality_Check');
      expect(toBpmnProcessId('Review / Approve')).toBe('Review_Approve');
    });

    it('ensures the process id starts with a valid BPMN identifier character', () => {
      expect(toBpmnProcessId('123 Start')).toBe('Process_123_Start');
    });
  });

  describe('buildLinkedProcessCreationPayload', () => {
    it('builds a BPMN creation payload from the call activity name', () => {
      const payload = buildLinkedProcessCreationPayload('Perform Refund Quality Check');

      expect(payload.fileName).toBe('Perform Refund Quality Check');
      expect(payload.targetKey).toBe('Perform_Refund_Quality_Check');
      expect(payload.xml).toContain('id="Perform_Refund_Quality_Check"');
      expect(payload.xml).toContain('name="Perform Refund Quality Check"');
      expect(payload.xml).toContain('bpmnElement="Perform_Refund_Quality_Check"');
    });

    it('escapes XML-sensitive characters in the generated process name', () => {
      const payload = buildLinkedProcessCreationPayload('A&B <Flow>');

      expect(payload.fileName).toBe('A&B <Flow>');
      expect(payload.xml).toContain('name="A&amp;B &lt;Flow&gt;"');
    });
  });
});
