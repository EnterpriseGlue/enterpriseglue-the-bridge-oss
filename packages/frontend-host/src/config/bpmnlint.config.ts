// bpmnlint configuration for BPMN validation
// Simplified config that works in the browser without bundling
export default {
  rules: {
    'bpmnlint/label-required': 'warn',
    'bpmnlint/no-disconnected': 'error',
    'bpmnlint/start-event-required': 'error',
    'bpmnlint/end-event-required': 'error',
    'bpmnlint/fake-join': 'error',
    'bpmnlint/no-implicit-split': 'warn',
    'bpmnlint/single-blank-start-event': 'error',
    'bpmnlint/single-event-definition': 'error'
  }
};
