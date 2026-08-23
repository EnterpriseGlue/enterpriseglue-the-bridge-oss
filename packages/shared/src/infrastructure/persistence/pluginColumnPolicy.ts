const PLUGIN_KEY_LENGTH_BY_COLUMN: Readonly<Record<string, number>> = {
  id: 128,
  actor_ref: 256,
  bucket_hash: 128,
  call_id_hash: 128,
  circuit_reason_code: 100,
  circuit_state: 32,
  correlation_id: 256,
  delivery_id: 256,
  deployment_ref: 256,
  enablement_scope: 32,
  entitlement_state: 32,
  event_id: 256,
  event_sha256: 64,
  event_type: 250,
  grant_set_hash: 128,
  idempotency_key_hash: 128,
  identity_hash: 64,
  invocation_hash: 128,
  job_ref: 256,
  job_type: 250,
  key_hash: 128,
  lease_id: 256,
  lease_owner: 256,
  manifest_sha256: 64,
  notification_ref: 256,
  operation_id: 250,
  permission: 100,
  plugin_id: 200,
  reason_code: 100,
  request_hash: 128,
  scheduled_by_ref: 256,
  scope: 32,
  snapshot_hash: 128,
  source_record_hash: 128,
  state: 100,
  status: 100,
  storage_key: 256,
  subject_ref: 256,
  subscription_type: 250,
  template_id: 250,
  tenant_ref: 256,
  tenant_ref_key: 256,
  type: 100,
};

const PLUGIN_LARGE_TEXT_COLUMNS = new Set([
  'event_json',
  'projection_json',
  'response_json',
  'value_json',
]);

export function pluginKeyColumnLength(columnName: string): number {
  return PLUGIN_KEY_LENGTH_BY_COLUMN[columnName] ?? 256;
}

export function isPluginLargeTextColumn(columnName: string): boolean {
  return PLUGIN_LARGE_TEXT_COLUMNS.has(columnName);
}
