// Camunda Platform 7 lint setup without bpmnlint loader.
// Provide a custom rule that emulates the Modeler "implementation required" checks.
import implementationRequired from './bpmn-engine-rules/implementation-required';

export const camundaConfig = {
  rules: {
    // Use top-level rule name; our resolver maps it to the custom factory
    'implementation-required': 'error'
  }
};

export const camundaResolver = {
  resolveRule(pkg: string, ruleName: string) {
    if ((pkg === 'bpmnlint' || pkg === 'bpmnlint-plugin-custom' || pkg === 'custom')
      && ruleName === 'implementation-required') {
      return (implementationRequired as any);
    }
    return null as any;
  }
};
