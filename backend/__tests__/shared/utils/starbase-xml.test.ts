import { describe, it, expect } from 'vitest';
import {
  extractBpmnCallActivityLinks,
  extractBpmnProcessId,
  extractDmnDecisionId,
  remapStarbaseFileReferencesInXml,
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

  it('extracts BPMN call activity links by calledElement and starbase file metadata', () => {
    const xml = `
      <bpmn:definitions>
        <bpmn:process id="Parent_Process">
          <bpmn:callActivity id="CallActivity_1" name="Review invoice" calledElement="child_process">
            <bpmn:extensionElements>
              <camunda:properties>
                <camunda:property name="starbase:fileId" value="file-child" />
              </camunda:properties>
            </bpmn:extensionElements>
          </bpmn:callActivity>
          <bpmn:callActivity id="CallActivity_2" camunda:calledElement="fallback_process" />
          <bpmn:businessRuleTask id="BusinessRuleTask_1" name="Evaluate policy" camunda:decisionRef="decision_policy">
            <bpmn:extensionElements>
              <camunda:properties>
                <camunda:property name="starbase:fileId" value="file-decision" />
              </camunda:properties>
            </bpmn:extensionElements>
          </bpmn:businessRuleTask>
          <bpmn:endEvent id="EndEvent_1" name="Send invoice">
            <bpmn:extensionElements>
              <camunda:properties>
                <camunda:property name="starbase:fileId" value="file-child" />
                <camunda:property name="starbase:targetProcessId" value="child_process" />
              </camunda:properties>
            </bpmn:extensionElements>
            <bpmn:messageEventDefinition messageRef="Message_EndEvent_1" />
          </bpmn:endEvent>
        </bpmn:process>
      </bpmn:definitions>
    `;

    expect(extractBpmnCallActivityLinks(xml)).toEqual([
      {
        elementId: 'CallActivity_1',
        elementName: 'Review invoice',
        targetProcessId: 'child_process',
        targetFileId: 'file-child',
      },
      {
        elementId: 'CallActivity_2',
        elementName: null,
        targetProcessId: 'fallback_process',
        targetFileId: null,
      },
      {
        elementId: 'BusinessRuleTask_1',
        elementName: 'Evaluate policy',
        targetProcessId: null,
        targetDecisionId: 'decision_policy',
        targetFileId: 'file-decision',
      },
      {
        elementId: 'EndEvent_1',
        elementName: 'Send invoice',
        targetProcessId: 'child_process',
        targetDecisionId: null,
        targetFileId: 'file-child',
      },
    ]);
  });

  it('updates starbase file name in xml', () => {
    const xml = `
      <definitions>
        <callActivity id="CallActivity_1" name="Old Name">
          <extensionElements>
            <properties>
              <property name="starbase:fileId" value="file-1" />
              <property name="starbase:fileName" value="Old Name" />
            </properties>
          </extensionElements>
        </callActivity>
      </definitions>
    `;

    const result = updateStarbaseFileNameInXml(xml, 'file-1', 'New Name');
    expect(result.updated).toBe(true);
    expect(result.xml).toContain('value="New Name"');
  });

  it('updates BPMN element names when auto-sync is enabled', () => {
    const xml = `
      <definitions>
        <businessRuleTask id="Activity_1" name="Old Name">
          <extensionElements>
            <properties>
              <property name="starbase:fileId" value="file-1" />
              <property name="starbase:fileName" value="Old Name" />
              <property name="starbase:nameSyncMode" value="auto" />
            </properties>
          </extensionElements>
        </businessRuleTask>
      </definitions>
    `;

    const result = updateStarbaseFileNameInXml(xml, 'file-1', 'New Name');
    expect(result.updated).toBe(true);
    expect(result.xml).toContain('name="New Name"');
  });

  it('updates semantic message names for linked message end events', () => {
    const xml = `
      <bpmn:definitions>
        <bpmn:message id="Message_EndEvent_1" name="Old Name" />
        <bpmn:endEvent id="EndEvent_1" name="Send Old Name">
          <bpmn:extensionElements>
            <camunda:properties>
              <camunda:property name="starbase:fileId" value="file-1" />
              <camunda:property name="starbase:fileName" value="Old Name" />
              <camunda:property name="starbase:nameSyncMode" value="auto" />
              <camunda:property name="starbase:messageRefId" value="Message_EndEvent_1" />
            </camunda:properties>
          </bpmn:extensionElements>
          <bpmn:messageEventDefinition messageRef="Message_EndEvent_1" />
        </bpmn:endEvent>
      </bpmn:definitions>
    `;

    const result = updateStarbaseFileNameInXml(xml, 'file-1', 'New Name');
    expect(result.updated).toBe(true);
    expect(result.xml).toContain('<bpmn:message id="Message_EndEvent_1" name="New Name" />');
    expect(result.xml).toContain('<bpmn:endEvent id="EndEvent_1" name="New Name">');
  });

  it('remaps starbase file references in xml', () => {
    const xml = `
      <definitions>
        <callActivity id="CallActivity_1" name="Call child" calledElement="child_process">
          <extensionElements>
            <properties>
              <property name="starbase:fileId" value="old-child" />
              <property name="starbase:fileName" value="Child Diagram" />
            </properties>
          </extensionElements>
        </callActivity>
      </definitions>
    `;

    const result = remapStarbaseFileReferencesInXml(xml, new Map([
      ['old-child', { fileId: 'new-child', fileName: 'Imported Child Diagram' }],
    ]));

    expect(result.replacements).toBe(1);
    expect(result.xml).toContain('value="new-child"');
    expect(result.xml).toContain('value="Imported Child Diagram"');
    expect(result.xml).not.toContain('value="old-child"');
  });

  it('does not update when file id missing', () => {
    const xml = '<definitions><properties></properties></definitions>';
    const result = updateStarbaseFileNameInXml(xml, 'file-1', 'New Name');
    expect(result.updated).toBe(false);
  });
});
