import { describe, it, expect, vi } from 'vitest';
import { extractBpmnProcessId, extractDmnDecisionId } from '@enterpriseglue/shared/utils/starbase-xml.js';

describe('starbase XML utilities', () => {
  it('extracts BPMN process ID', () => {
    const xml = '<bpmn:process id="Process_1" isExecutable="true"></bpmn:process>';
    const processId = extractBpmnProcessId(xml);
    expect(processId).toBe('Process_1');
  });

  it('extracts DMN decision ID', () => {
    const xml = '<decision id="Decision_1" name="Test Decision"></decision>';
    const decisionId = extractDmnDecisionId(xml);
    expect(decisionId).toBe('Decision_1');
  });

  it('returns null for invalid BPMN', () => {
    const xml = '<invalid>no process</invalid>';
    const processId = extractBpmnProcessId(xml);
    expect(processId).toBeNull();
  });

  it('returns null for invalid DMN', () => {
    const xml = '<invalid>no decision</invalid>';
    const decisionId = extractDmnDecisionId(xml);
    expect(decisionId).toBeNull();
  });
});
