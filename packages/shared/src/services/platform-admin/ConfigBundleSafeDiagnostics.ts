export type ConfigBundleFailureKind = 'apply' | 'runtime_reconciliation' | 'identity_replay';

const OPERATOR_SAFE_FAILURES: Record<ConfigBundleFailureKind, string> = {
  apply: 'Configuration bundle apply failed; inspect protected server logs',
  runtime_reconciliation: 'Configuration runtime reconciliation failed; inspect protected server logs',
  identity_replay: 'Configuration identity replay failed; inspect protected server logs',
};

/**
 * Configuration execution failures can originate in secret resolution,
 * adapters, databases, and remote endpoints. Persist only a stable operator
 * message in receipts/tasks; the original exception belongs in protected logs.
 */
export function operatorSafeConfigBundleFailure(kind: ConfigBundleFailureKind): string {
  return OPERATOR_SAFE_FAILURES[kind];
}
