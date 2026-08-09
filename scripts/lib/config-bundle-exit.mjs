export const ConfigBundleExitCode = Object.freeze({
  USAGE: 64,
  VALIDATION: 2,
  AUTHORIZATION: 3,
  CONFLICT: 4,
  RECONCILIATION: 5,
  TRANSPORT: 6,
  RUNTIME: 1,
});

export function classifyConfigBundleHttpFailure(status, phase = 'request') {
  if (status === 401 || status === 403) return ConfigBundleExitCode.AUTHORIZATION;
  if (status === 409) return ConfigBundleExitCode.CONFLICT;
  if (status === 400 || status === 413 || status === 422) return ConfigBundleExitCode.VALIDATION;
  if (status >= 500 || phase === 'transport') return ConfigBundleExitCode.TRANSPORT;
  return ConfigBundleExitCode.RUNTIME;
}

export function reconciliationExitCode(result) {
  return result?.reconciliation?.identitySnapshot?.status === 'failed'
    ? ConfigBundleExitCode.RECONCILIATION
    : null;
}

export function reconciliationWaitState(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'completed';
  if (tasks.some((task) => task?.status === 'cancelled')) return 'failed';
  return tasks.every((task) => task?.status === 'completed') ? 'completed' : 'pending';
}
