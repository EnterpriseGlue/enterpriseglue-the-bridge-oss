export function getCreateLinkedFileName(
  element: any,
  linkType: 'process' | 'decision' | null | undefined,
): string | null {
  if (!linkType || !element) return null

  const bo = element.businessObject || element
  const raw = bo?.name ?? bo?.get?.('name') ?? element?.name ?? null
  const trimmed = typeof raw === 'string' ? raw.trim() : ''

  return trimmed || null
}

export const getCreateLinkedProcessName = getCreateLinkedFileName

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
}

export function toBpmnProcessId(processName: string, fallback = 'Process_1'): string {
  const normalized = String(processName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)

  if (!normalized) return fallback
  if (/^[A-Za-z_]/.test(normalized)) return normalized
  return `Process_${normalized}`.slice(0, 64)
}

export function toDmnDecisionId(decisionName: string, fallback = 'Decision_1'): string {
  const normalized = String(decisionName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)

  if (!normalized) return fallback
  if (/^[A-Za-z_]/.test(normalized)) return normalized
  return `Decision_${normalized}`.slice(0, 64)
}

export function buildLinkedProcessCreationPayload(rawProcessName: string): {
  fileName: string
  targetKey: string
  xml: string
} {
  const fileName = String(rawProcessName || '').trim() || 'Process'
  const processId = toBpmnProcessId(fileName)
  const escapedProcessName = escapeXmlAttribute(fileName)

  return {
    fileName,
    targetKey: processId,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${processId}" name="${escapedProcessName}" isExecutable="true" camunda:historyTimeToLive="60">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`,
  }
}

export function buildLinkedDecisionCreationPayload(rawDecisionName: string): {
  fileName: string
  targetKey: string
  xml: string
} {
  const fileName = String(rawDecisionName || '').trim() || 'Decision'
  const decisionId = toDmnDecisionId(fileName)
  const escapedDecisionName = escapeXmlAttribute(fileName)

  return {
    fileName,
    targetKey: decisionId,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:camunda="http://camunda.org/schema/1.0/dmn" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="Definitions_1" name="Definitions" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="${decisionId}" name="${escapedDecisionName}" camunda:historyTimeToLive="60">
    <decisionTable id="DecisionTable_1">
      <input id="InputClause_1">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text>input</text>
        </inputExpression>
      </input>
      <output id="OutputClause_1" name="result" typeRef="string"/>
      <rule id="Rule_1">
        <inputEntry id="InputEntry_1">
          <text>-</text>
        </inputEntry>
        <outputEntry id="OutputEntry_1">
          <text>"ok"</text>
        </outputEntry>
      </rule>
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="${decisionId}">
        <dc:Bounds x="160" y="160" width="180" height="80" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>`,
  }
}
