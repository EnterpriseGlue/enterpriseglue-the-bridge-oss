import { describe, it, expect } from 'vitest';
import {
  extractBpmnProcessId,
  extractDmnDecisionId,
  updateStarbaseFileNameInXml,
} from '@enterpriseglue/shared/utils/starbase-xml.js';

describe('starbase xml utils', () => {
  it('extracts BPMN process id', () => {
    const xml = '<definitions><process id="process_1"></process></definitions>';
    expect(extractBpmnProcessId(xml)).toBe('process_1');
    expect(extractBpmnProcessId('<definitions></definitions>')).toBeNull();
  });

  it('extracts DMN decision id', () => {
    const xml = '<definitions><decision id="decision_1"></decision></definitions>';
    expect(extractDmnDecisionId(xml)).toBe('decision_1');
    expect(extractDmnDecisionId('<definitions></definitions>')).toBeNull();
  });

  it('updates starbase file name in xml', () => {
    const xml = `
      <definitions>
        <properties>
          <property name="starbase:fileId" value="file-1" />
          <property name="starbase:fileName" value="Old Name" />
        </properties>
      </definitions>
    `;

    const result = updateStarbaseFileNameInXml(xml, 'file-1', 'New Name');
    expect(result.updated).toBe(true);
    expect(result.xml).toContain('value="New Name"');
  });

  it('does not update when file id missing', () => {
    const xml = '<definitions><properties></properties></definitions>';
    const result = updateStarbaseFileNameInXml(xml, 'file-1', 'New Name');
    expect(result.updated).toBe(false);
  });
});
