// Camunda Platform 7: Implementation required rule
// Flags tasks/events that require an implementation/reference but are missing it.

// Minimal helper to check BPMN types without importing node typings
function isAny(node: any, types: string[]): boolean {
  const t = node && node.$type;
  return !!t && types.includes(t);
}

export default function implementationRequired() {
  function hasAnyAttr(node: any, keys: string[]): boolean {
    const a = (node && node.$attrs) || {};
    return keys.some((k) => a[k] != null && String(a[k]).trim() !== '');
  }

  function check(node: any, reporter: any) {
    // Business Rule Task: require DMN decisionRef or classic Java/expression
    if (isAny(node, [ 'bpmn:BusinessRuleTask' ])) {
      const ok = hasAnyAttr(node, [
        'camunda:decisionRef',
        'camunda:class',
        'camunda:expression',
        'camunda:delegateExpression'
      ]);
      if (!ok) {
        reporter.report(node.id, 'Business Rule Task must have a defined <Implementation>');
      }
      return;
    }

    // Service Task: require Java/expression/external impl
    if (isAny(node, [ 'bpmn:ServiceTask' ])) {
      const a = (node && node.$attrs) || {};
      const ok = hasAnyAttr(node, [ 'camunda:class', 'camunda:expression', 'camunda:delegateExpression' ])
        || (a['camunda:type'] === 'external');
      if (!ok) {
        reporter.report(node.id, 'Service Task must have a defined <Implementation>');
      }
      return;
    }

    // Script Task: require script content or resource
    if (isAny(node, [ 'bpmn:ScriptTask' ])) {
      const ok = hasAnyAttr(node, [ 'script', 'camunda:resource' ]) && hasAnyAttr(node, [ 'scriptFormat' ]);
      if (!ok) {
        reporter.report(node.id, 'Script Task must define script and scriptFormat');
      }
      return;
    }

    // Send/Receive Task: require message reference
    if (isAny(node, [ 'bpmn:SendTask', 'bpmn:ReceiveTask' ])) {
      if (!node.messageRef) {
        reporter.report(node.id, 'Task must reference a <message>');
      }
      return;
    }

    // Call Activity: require calledElement
    if (isAny(node, [ 'bpmn:CallActivity' ])) {
      if (!hasAnyAttr(node, [ 'calledElement', 'camunda:calledElement' ])) {
        reporter.report(node.id, 'Call Activity must define <calledElement>');
      }
      return;
    }
  }

  return { check };
}
