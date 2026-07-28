import { createHash } from 'node:crypto';

import {
  ociDigestReferenceSchema,
  pluginIdSchema,
  semVerSchema,
  type PluginId,
} from '@enterpriseglue/plugin-sdk';

import type {
  PluginDeploymentLifecyclePhaseV1,
  PluginDeploymentLifecyclePlanV1,
} from './index.js';

export type PluginLifecycleExecutionStatusV1 =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'manual_intervention';

export type PluginLifecycleExecutionReasonV1 =
  | 'none'
  | 'phase_failed'
  | 'lease_expired'
  | 'plan_mismatch'
  | 'rollback_unavailable';

export interface PluginLifecyclePlanEnvelopeV1 {
  schemaVersion: 1;
  desiredRevision: number;
  plan: PluginDeploymentLifecyclePlanV1 | null;
  planSha256: string | null;
}

export interface PluginLifecycleExecutionV1 {
  apiVersion: 'lifecycle-execution.plugin.enterpriseglue.io/v1';
  kind: 'EnterpriseGluePluginLifecycleExecution';
  executionId: string;
  revision: number;
  desiredRevision: number;
  planSha256: string;
  pluginId: PluginId;
  operation: PluginDeploymentLifecyclePlanV1['operation'];
  status: PluginLifecycleExecutionStatusV1;
  completedPhases: PluginDeploymentLifecyclePhaseV1[];
  nextPhase?: PluginDeploymentLifecyclePhaseV1;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  reasonCode: PluginLifecycleExecutionReasonV1;
  createdAt: string;
  updatedAt: string;
}

export type PluginLifecycleExecutionErrorCode =
  | 'execution_terminal'
  | 'execution_not_claimed'
  | 'lease_held'
  | 'lease_expired'
  | 'lease_owner_mismatch'
  | 'phase_out_of_order'
  | 'plan_mismatch'
  | 'execution_invalid'
  | 'execution_not_found'
  | 'execution_active'
  | 'revision_conflict'
  | 'store_locked'
  | 'store_corrupt'
  | 'plan_unavailable';

export class PluginLifecycleExecutionError extends Error {
  constructor(
    public readonly code: PluginLifecycleExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginLifecycleExecutionError';
  }
}

const operationValues = new Set<PluginDeploymentLifecyclePlanV1['operation']>([
  'install',
  'upgrade',
  'rollback',
  'disable',
  'enable',
  'uninstall',
]);
const phaseValues = new Set<PluginDeploymentLifecyclePhaseV1>([
  'stage',
  'checkpoint',
  'migrate',
  'ready',
  'activate',
  'drain',
  'deactivate',
  'retain_data',
  'export_data',
  'delete_data',
  'remove',
  'commit',
]);
const executionStatusValues = new Set<PluginLifecycleExecutionStatusV1>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'manual_intervention',
]);
const executionReasonValues = new Set<PluginLifecycleExecutionReasonV1>([
  'none',
  'phase_failed',
  'lease_expired',
  'plan_mismatch',
  'rollback_unavailable',
]);

function executionReasonMatchesStatus(
  status: PluginLifecycleExecutionStatusV1,
  reason: PluginLifecycleExecutionReasonV1,
): boolean {
  if (status === 'queued') {
    return reason === 'none' || reason === 'lease_expired';
  }
  if (status === 'failed') return reason === 'phase_failed';
  if (status === 'manual_intervention') {
    return reason === 'rollback_unavailable';
  }
  return reason === 'none';
}

function expectedPhases(
  plan: PluginDeploymentLifecyclePlanV1,
): PluginDeploymentLifecyclePhaseV1[] | undefined {
  const migrate = plan.migrationImage ? (['migrate'] as const) : [];
  if (plan.operation === 'install') {
    return ['stage', ...migrate, 'commit'];
  }
  if (plan.operation === 'upgrade' || plan.operation === 'rollback') {
    const withoutRuntime: PluginDeploymentLifecyclePhaseV1[] = [
      'stage',
      'checkpoint',
      ...migrate,
      'commit',
    ];
    const withRuntime: PluginDeploymentLifecyclePhaseV1[] = [
      'stage',
      'drain',
      'deactivate',
      'checkpoint',
      ...migrate,
      'activate',
      'ready',
      'commit',
    ];
    if (
      plan.phases.length === withRuntime.length &&
      plan.phases.every((phase, index) => phase === withRuntime[index])
    ) {
      return withRuntime;
    }
    return withoutRuntime;
  }
  if (plan.operation === 'enable') {
    return ['activate', 'ready', 'commit'];
  }
  if (plan.operation === 'disable') {
    return ['drain', 'deactivate', 'commit'];
  }
  if (!plan.dataAction) return undefined;
  const dataPhase = {
    retain: 'retain_data',
    export: 'export_data',
    delete: 'delete_data',
  } as const;
  const withoutRuntime: PluginDeploymentLifecyclePhaseV1[] = [
    dataPhase[plan.dataAction],
    'remove',
    'commit',
  ];
  const withRuntime = [
    'drain',
    'deactivate',
    ...withoutRuntime,
  ] as PluginDeploymentLifecyclePhaseV1[];
  if (
    plan.phases.length === withRuntime.length &&
    plan.phases.every((phase, index) => phase === withRuntime[index])
  ) {
    return withRuntime;
  }
  return withoutRuntime;
}

function planSemanticsAreValid(
  plan: PluginDeploymentLifecyclePlanV1,
): boolean {
  const phases = expectedPhases(plan);
  if (
    !phases ||
    phases.length !== plan.phases.length ||
    phases.some((phase, index) => plan.phases[index] !== phase)
  ) {
    return false;
  }
  if (
    (plan.operation === 'uninstall') !==
    (plan.dataAction !== undefined)
  ) {
    return false;
  }
  if (plan.operation === 'install') {
    return (
      plan.fromVersion === undefined &&
      plan.toVersion !== undefined &&
      plan.fromDataSchema === 0
    );
  }
  if (
    plan.operation === 'upgrade' ||
    plan.operation === 'rollback' ||
    plan.operation === 'enable' ||
    plan.operation === 'disable'
  ) {
    return (
      plan.fromVersion !== undefined &&
      plan.toVersion !== undefined
    );
  }
  return (
    plan.fromVersion !== undefined &&
    plan.toVersion === undefined &&
    plan.toDataSchema === 0
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    )
    .join(',')}}`;
}

export function hashPluginLifecyclePlanV1(
  plan: PluginDeploymentLifecyclePlanV1,
): string {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

export function createPluginLifecyclePlanEnvelopeV1(
  desiredRevision: number,
  plan: PluginDeploymentLifecyclePlanV1 | null,
): PluginLifecyclePlanEnvelopeV1 {
  if (!Number.isInteger(desiredRevision) || desiredRevision < 0) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Desired revision must be a non-negative integer',
    );
  }
  const snapshot = plan ? structuredClone(plan) : null;
  return {
    schemaVersion: 1,
    desiredRevision,
    plan: snapshot,
    planSha256: snapshot ? hashPluginLifecyclePlanV1(snapshot) : null,
  };
}

export function parsePluginLifecyclePlanEnvelopeV1(
  input: unknown,
): PluginLifecyclePlanEnvelopeV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle plan envelope must be an object',
    );
  }
  const envelope = input as Partial<PluginLifecyclePlanEnvelopeV1>;
  if (
    envelope.schemaVersion !== 1 ||
    !Number.isInteger(envelope.desiredRevision) ||
    (envelope.desiredRevision ?? -1) < 0
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle plan envelope revision is invalid',
    );
  }
  if (envelope.plan === null && envelope.planSha256 === null) {
    return structuredClone(envelope as PluginLifecyclePlanEnvelopeV1);
  }
  if (
    !envelope.plan ||
    typeof envelope.plan !== 'object' ||
    envelope.plan.apiVersion !==
      'lifecycle-plan.plugin.enterpriseglue.io/v1' ||
    envelope.plan.kind !== 'EnterpriseGluePluginLifecyclePlan' ||
    !operationValues.has(envelope.plan.operation) ||
    !Number.isInteger(envelope.plan.fromDataSchema) ||
    envelope.plan.fromDataSchema < 0 ||
    !Number.isInteger(envelope.plan.toDataSchema) ||
    envelope.plan.toDataSchema < 0 ||
    typeof envelope.plan.rollbackSupported !== 'boolean' ||
    !Array.isArray(envelope.plan.phases) ||
    envelope.plan.phases.length === 0 ||
    envelope.plan.phases.some((phase) => !phaseValues.has(phase)) ||
    envelope.plan.phases.at(-1) !== 'commit' ||
    envelope.plan.phases.includes('migrate') !==
      (envelope.plan.migrationImage !== undefined) ||
    (envelope.plan.dataAction !== undefined &&
      !['retain', 'export', 'delete'].includes(
        envelope.plan.dataAction,
      )) ||
    !planSemanticsAreValid(envelope.plan) ||
    !/^[a-f0-9]{64}$/.test(envelope.planSha256 ?? '')
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle plan envelope plan is invalid',
    );
  }
  pluginIdSchema.parse(envelope.plan.pluginId);
  if (envelope.plan.fromVersion !== undefined) {
    semVerSchema.parse(envelope.plan.fromVersion);
  }
  if (envelope.plan.toVersion !== undefined) {
    semVerSchema.parse(envelope.plan.toVersion);
  }
  if (envelope.plan.migrationImage !== undefined) {
    ociDigestReferenceSchema.parse(envelope.plan.migrationImage);
  }
  if (
    hashPluginLifecyclePlanV1(envelope.plan) !== envelope.planSha256
  ) {
    throw new PluginLifecycleExecutionError(
      'plan_mismatch',
      'Lifecycle plan envelope hash does not match its plan',
    );
  }
  return structuredClone(envelope as PluginLifecyclePlanEnvelopeV1);
}

function assertExecutionId(value: string, field: string): void {
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      `${field} must be an opaque 8-200 character identifier`,
    );
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle execution timestamps must be ISO-8601 values',
    );
  }
  return parsed;
}

function assertPlanMatches(
  execution: PluginLifecycleExecutionV1,
  envelope: PluginLifecyclePlanEnvelopeV1,
): PluginDeploymentLifecyclePlanV1 {
  if (
    !envelope.plan ||
    envelope.desiredRevision !== execution.desiredRevision ||
    envelope.plan.pluginId !== execution.pluginId ||
    envelope.plan.operation !== execution.operation ||
    envelope.planSha256 !== execution.planSha256 ||
    hashPluginLifecyclePlanV1(envelope.plan) !== execution.planSha256
  ) {
    throw new PluginLifecycleExecutionError(
      'plan_mismatch',
      'Lifecycle execution does not match the immutable desired-state plan',
    );
  }
  return envelope.plan;
}

export function parsePluginLifecycleExecutionV1(
  input: unknown,
  envelopeInput: unknown,
): PluginLifecycleExecutionV1 {
  const envelope = parsePluginLifecyclePlanEnvelopeV1(envelopeInput);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle execution must be an object',
    );
  }
  const execution = input as Partial<PluginLifecycleExecutionV1>;
  if (
    execution.apiVersion !==
      'lifecycle-execution.plugin.enterpriseglue.io/v1' ||
    execution.kind !== 'EnterpriseGluePluginLifecycleExecution' ||
    !Number.isInteger(execution.desiredRevision) ||
    (execution.desiredRevision ?? -1) < 0 ||
    !Number.isInteger(execution.revision) ||
    (execution.revision ?? -1) < 0 ||
    !/^[a-f0-9]{64}$/.test(execution.planSha256 ?? '') ||
    !operationValues.has(execution.operation!) ||
    !executionStatusValues.has(execution.status!) ||
    !executionReasonValues.has(execution.reasonCode!) ||
    !executionReasonMatchesStatus(
      execution.status!,
      execution.reasonCode!,
    ) ||
    !Array.isArray(execution.completedPhases) ||
    execution.completedPhases.some((phase) => !phaseValues.has(phase)) ||
    (execution.nextPhase !== undefined &&
      !phaseValues.has(execution.nextPhase))
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle execution structure is invalid',
    );
  }
  assertExecutionId(execution.executionId ?? '', 'executionId');
  timestamp(execution.createdAt ?? '');
  timestamp(execution.updatedAt ?? '');
  if (
    timestamp(execution.updatedAt!) < timestamp(execution.createdAt!)
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle execution update cannot predate creation',
    );
  }
  const parsed = structuredClone(
    execution as PluginLifecycleExecutionV1,
  );
  const plan = assertPlanMatches(parsed, envelope);
  const expectedCompleted = plan.phases.slice(
    0,
    parsed.completedPhases.length,
  );
  const expectedNext = plan.phases[parsed.completedPhases.length];
  if (
    expectedCompleted.some(
      (phase, index) => parsed.completedPhases[index] !== phase,
    ) ||
    parsed.nextPhase !== expectedNext ||
    (parsed.status === 'succeeded' &&
      parsed.completedPhases.length !== plan.phases.length) ||
    (parsed.status !== 'succeeded' &&
      parsed.completedPhases.length === plan.phases.length) ||
    (parsed.status === 'running') !==
      Boolean(parsed.leaseOwner && parsed.leaseExpiresAt) ||
    (parsed.status !== 'running' &&
      (parsed.leaseOwner !== undefined ||
        parsed.leaseExpiresAt !== undefined))
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle execution checkpoint is inconsistent with its plan',
    );
  }
  if (parsed.leaseOwner) {
    assertExecutionId(parsed.leaseOwner, 'lease owner');
    timestamp(parsed.leaseExpiresAt!);
  }
  return parsed;
}

function assertMutable(execution: PluginLifecycleExecutionV1): void {
  if (
    execution.status === 'succeeded' ||
    execution.status === 'manual_intervention'
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_terminal',
      `Lifecycle execution is already ${execution.status}`,
    );
  }
}

function assertLease(
  execution: PluginLifecycleExecutionV1,
  owner: string,
  occurredAt: string,
): void {
  if (
    execution.status !== 'running' ||
    !execution.leaseOwner ||
    !execution.leaseExpiresAt
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_not_claimed',
      'Lifecycle execution must be claimed before changing a phase',
    );
  }
  if (execution.leaseOwner !== owner) {
    throw new PluginLifecycleExecutionError(
      'lease_owner_mismatch',
      'Lifecycle execution lease belongs to another worker',
    );
  }
  if (timestamp(execution.leaseExpiresAt) <= timestamp(occurredAt)) {
    throw new PluginLifecycleExecutionError(
      'lease_expired',
      'Lifecycle execution lease has expired',
    );
  }
}

export function createPluginLifecycleExecutionV1(input: {
  envelope: PluginLifecyclePlanEnvelopeV1;
  executionId: string;
  occurredAt: string;
}): PluginLifecycleExecutionV1 {
  const plan = input.envelope.plan;
  if (
    !plan ||
    input.envelope.planSha256 !== hashPluginLifecyclePlanV1(plan)
  ) {
    throw new PluginLifecycleExecutionError(
      'plan_mismatch',
      'A lifecycle execution requires a matching non-empty plan envelope',
    );
  }
  assertExecutionId(input.executionId, 'executionId');
  timestamp(input.occurredAt);
  return {
    apiVersion: 'lifecycle-execution.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecycleExecution',
    executionId: input.executionId,
    revision: 0,
    desiredRevision: input.envelope.desiredRevision,
    planSha256: input.envelope.planSha256,
    pluginId: plan.pluginId,
    operation: plan.operation,
    status: 'queued',
    completedPhases: [],
    nextPhase: plan.phases[0],
    reasonCode: 'none',
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  };
}

export function claimPluginLifecycleExecutionV1(input: {
  execution: PluginLifecycleExecutionV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  owner: string;
  occurredAt: string;
  leaseDurationMs: number;
}): PluginLifecycleExecutionV1 {
  const execution = structuredClone(input.execution);
  assertMutable(execution);
  assertPlanMatches(execution, input.envelope);
  assertExecutionId(input.owner, 'lease owner');
  const now = timestamp(input.occurredAt);
  if (
    execution.status === 'running' &&
    execution.leaseExpiresAt &&
    timestamp(execution.leaseExpiresAt) > now &&
    execution.leaseOwner !== input.owner
  ) {
    throw new PluginLifecycleExecutionError(
      'lease_held',
      'Lifecycle execution lease is held by another worker',
    );
  }
  if (
    !Number.isInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 300_000
  ) {
    throw new PluginLifecycleExecutionError(
      'execution_invalid',
      'Lifecycle lease duration must be 1-300 seconds',
    );
  }
  execution.status = 'running';
  execution.revision += 1;
  execution.leaseOwner = input.owner;
  execution.leaseExpiresAt = new Date(
    now + input.leaseDurationMs,
  ).toISOString();
  execution.reasonCode = 'none';
  execution.updatedAt = input.occurredAt;
  return execution;
}

export function renewPluginLifecycleExecutionLeaseV1(input: {
  execution: PluginLifecycleExecutionV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  owner: string;
  occurredAt: string;
  leaseDurationMs: number;
}): PluginLifecycleExecutionV1 {
  assertPlanMatches(input.execution, input.envelope);
  assertLease(input.execution, input.owner, input.occurredAt);
  return claimPluginLifecycleExecutionV1(input);
}

export function completePluginLifecyclePhaseV1(input: {
  execution: PluginLifecycleExecutionV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  owner: string;
  phase: PluginDeploymentLifecyclePhaseV1;
  occurredAt: string;
}): PluginLifecycleExecutionV1 {
  const execution = structuredClone(input.execution);
  assertMutable(execution);
  const plan = assertPlanMatches(execution, input.envelope);
  assertLease(execution, input.owner, input.occurredAt);
  if (execution.nextPhase !== input.phase) {
    throw new PluginLifecycleExecutionError(
      'phase_out_of_order',
      `Expected lifecycle phase ${execution.nextPhase ?? 'none'}, received ${input.phase}`,
    );
  }
  execution.completedPhases.push(input.phase);
  execution.revision += 1;
  const nextPhase = plan.phases[execution.completedPhases.length];
  execution.nextPhase = nextPhase;
  execution.updatedAt = input.occurredAt;
  if (!nextPhase) {
    execution.status = 'succeeded';
    execution.reasonCode = 'none';
    delete execution.leaseOwner;
    delete execution.leaseExpiresAt;
  }
  return execution;
}

export function failPluginLifecycleExecutionV1(input: {
  execution: PluginLifecycleExecutionV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  owner: string;
  occurredAt: string;
}): PluginLifecycleExecutionV1 {
  const execution = structuredClone(input.execution);
  assertMutable(execution);
  const plan = assertPlanMatches(execution, input.envelope);
  assertLease(execution, input.owner, input.occurredAt);
  const irreversibleMigration =
    execution.completedPhases.includes('migrate') &&
    !plan.rollbackSupported;
  execution.status = irreversibleMigration
    ? 'manual_intervention'
    : 'failed';
  execution.revision += 1;
  execution.reasonCode = irreversibleMigration
    ? 'rollback_unavailable'
    : 'phase_failed';
  execution.updatedAt = input.occurredAt;
  delete execution.leaseOwner;
  delete execution.leaseExpiresAt;
  return execution;
}

export function recoverExpiredPluginLifecycleExecutionV1(input: {
  execution: PluginLifecycleExecutionV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  occurredAt: string;
}): PluginLifecycleExecutionV1 {
  const execution = structuredClone(input.execution);
  assertMutable(execution);
  assertPlanMatches(execution, input.envelope);
  const now = timestamp(input.occurredAt);
  if (
    execution.status !== 'running' ||
    !execution.leaseExpiresAt ||
    timestamp(execution.leaseExpiresAt) > now
  ) {
    return execution;
  }
  execution.status = 'queued';
  execution.revision += 1;
  execution.reasonCode = 'lease_expired';
  execution.updatedAt = input.occurredAt;
  delete execution.leaseOwner;
  delete execution.leaseExpiresAt;
  return execution;
}
