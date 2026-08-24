import { createHash } from 'node:crypto';

import {
  pluginInstallApprovalV1Schema,
  pluginInstallReviewV1Schema,
  pluginInstallationIntentV1Schema,
  pluginManagerCapabilityV1Schema,
  pluginReleaseV1Schema,
  type PluginInstallApprovalV1,
  type PluginInstallReviewV1,
  type PluginInstallationIntentV1,
  type PluginInstallationObservationV1,
  type PluginInstallationReasonV1,
  type PluginManagerCapabilityV1,
  type PluginReleaseV1,
} from '@enterpriseglue/plugin-sdk/manager';
import {
  createPluginLifecyclePlanEnvelopeV1,
  type PluginDeploymentLifecyclePlanV1,
  type PluginLifecyclePlanEnvelopeV1,
} from '@enterpriseglue/plugin-installer';

export interface PluginManagerEnvironmentV1 {
  hostVersion: string;
  hostArtifact: string;
  hostApiVersion: string;
  sdkVersion: string;
  platformRevision: number;
  deploymentMode: PluginInstallationIntentV1['deploymentMode'];
  platform: 'docker' | 'kubernetes' | 'openshift';
  architecture: 'amd64' | 'arm64';
  database: 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'spanner';
  entitlementState:
    | 'not_required'
    | 'unavailable'
    | 'trial'
    | 'active'
    | 'grace'
    | 'expired'
    | 'revoked';
}

export interface ClaimedPluginInstallationIntentV1 {
  intent: PluginInstallationIntentV1;
  leaseToken: string;
  revision: number;
  leaseExpiresAt: string;
  review?: PluginInstallReviewV1;
}

export interface PluginManagerHostPortV1 {
  advertiseCapability(capability: PluginManagerCapabilityV1): Promise<void>;
  claimIntent(input: {
    managerId: string;
    leaseDurationMs: number;
    occurredAt: string;
  }): Promise<ClaimedPluginInstallationIntentV1 | null>;
  renewIntentLease(input: {
    installationId: string;
    leaseToken: string;
    expectedRevision: number;
    leaseDurationMs: number;
    occurredAt: string;
  }): Promise<{ revision: number; leaseExpiresAt: string }>;
  publishReview(input: {
    leaseToken: string;
    expectedRevision: number;
    review: PluginInstallReviewV1;
  }): Promise<{ revision: number; leaseRetained: boolean }>;
  readApproval(input: {
    installationId: string;
    reviewSha256: string;
    planSha256: string;
  }): Promise<{ approval: PluginInstallApprovalV1; revision: number } | null>;
  publishObservation(input: {
    leaseToken: string;
    expectedRevision: number;
    observation: PluginInstallationObservationV1;
  }): Promise<{ revision: number }>;
}

export interface PluginReleaseResolverPortV1 {
  resolve(
    release: string,
    source: PluginInstallationIntentV1['source'],
  ): Promise<PluginReleaseV1>;
}

export interface PluginManagerLifecyclePortV1 {
  execute(input: {
    intent: PluginInstallationIntentV1;
    release: PluginReleaseV1;
    envelope: PluginLifecyclePlanEnvelopeV1;
    managerId: string;
  }): Promise<{
    status: 'succeeded' | 'failed' | 'manual_intervention';
    reasonCode: PluginInstallationReasonV1;
    occurredAt: string;
  }>;
}

export interface NativePluginManagerOptionsV1 {
  capability: PluginManagerCapabilityV1;
  environment: PluginManagerEnvironmentV1;
  host: PluginManagerHostPortV1;
  releases: PluginReleaseResolverPortV1;
  lifecycle: PluginManagerLifecyclePortV1;
  leaseDurationMs?: number;
  approvalPollIntervalMs?: number;
  approvalPollLimit?: number;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
}

export type PluginManagerRunResultV1 =
  | { status: 'idle' }
  | {
      status: 'awaiting_approval';
      installationId: string;
      review: PluginInstallReviewV1;
    }
  | {
      status: 'blocked' | 'completed' | 'failed' | 'manual_intervention';
      installationId: string;
      observation: PluginInstallationObservationV1;
    };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function hashPluginManagerDocumentV1(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function semverTuple(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
}

function satisfiesBoundedRange(version: string, range: string): boolean {
  const value = semverTuple(version);
  if (!value) return false;
  const exact = semverTuple(range);
  if (exact) return value.every((part, index) => part === exact[index]);
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (caret) {
    const minimum = caret.slice(1).map(Number) as [number, number, number];
    return (
      value[0] === minimum[0] &&
      (value[1] > minimum[1] ||
        (value[1] === minimum[1] && value[2] >= minimum[2]))
    );
  }
  return false;
}

function finding(
  status: 'pass' | 'warning' | 'blocked',
  reasonCode: PluginInstallationReasonV1,
  summary: string,
) {
  return { status, reasonCode, summary };
}

export function createPluginInstallPlanV1(input: {
  intent: PluginInstallationIntentV1;
  release: PluginReleaseV1;
}): PluginLifecyclePlanEnvelopeV1 {
  const operation = input.intent.operation ?? 'install';
  const migrationImage = input.release.artifacts.find(
    (artifact) => artifact.role === 'migration',
  )?.subject;
  const upgrading = operation === 'upgrade';
  if (
    upgrading &&
    !input.release.updateEdges.some(
      (edge) => edge.fromVersion === input.intent.fromVersion,
    )
  ) {
    throw new Error('release_update_edge_missing');
  }
  const phases: PluginDeploymentLifecyclePlanV1['phases'] = upgrading
    ? [
        'stage',
        ...(input.intent.currentEnabled
          ? (['drain', 'deactivate'] as const)
          : []),
        'checkpoint',
        ...(migrationImage ? (['migrate'] as const) : []),
        ...(input.intent.currentEnabled
          ? (['activate', 'ready'] as const)
          : []),
        'commit',
      ]
    : ['stage', ...(migrationImage ? (['migrate'] as const) : []), 'commit'];
  const plan: PluginDeploymentLifecyclePlanV1 = {
    apiVersion: 'lifecycle-plan.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginLifecyclePlan',
    operation,
    pluginId: input.intent.pluginId,
    fromVersion: input.intent.fromVersion,
    toVersion: input.release.version,
    fromDataSchema: upgrading ? input.release.schemaTransition.from : 0,
    toDataSchema: input.release.schemaTransition.to,
    migrationImage,
    rollbackSupported:
      !upgrading ||
      input.release.schemaTransition.rollbackClass !== 'forward_only',
    phases,
  };
  return createPluginLifecyclePlanEnvelopeV1(
    input.intent.expectedPlatformRevision + 1,
    plan,
  );
}

export function createPluginInstallReviewV1(input: {
  intent: PluginInstallationIntentV1;
  release: PluginReleaseV1;
  environment: PluginManagerEnvironmentV1;
  envelope: PluginLifecyclePlanEnvelopeV1;
  generatedAt: string;
  expiresAt: string;
}): PluginInstallReviewV1 {
  const operation = input.intent.operation ?? 'install';
  const declaredCompatible =
    satisfiesBoundedRange(
      input.environment.hostVersion,
      input.release.compatibility.hostRange,
    ) &&
    satisfiesBoundedRange(
      input.environment.hostApiVersion,
      input.release.compatibility.hostApiRange,
    ) &&
    satisfiesBoundedRange(
      input.environment.sdkVersion,
      input.release.compatibility.sdkRange,
    ) &&
    input.release.compatibility.deploymentModes.includes(
      input.environment.deploymentMode,
    ) &&
    input.release.compatibility.architectures.includes(
      input.environment.architecture,
    );
  const evidence = input.release.compatibility.evidence.some(
    (candidate) =>
      candidate.hostVersion === input.environment.hostVersion &&
      candidate.hostArtifact === input.environment.hostArtifact &&
      candidate.deploymentMode === input.environment.deploymentMode &&
      candidate.platform === input.environment.platform &&
      candidate.architecture === input.environment.architecture &&
      candidate.database === input.environment.database,
  );
  const entitlementAllowed =
    !input.release.entitlementSku ||
    ['trial', 'active', 'grace'].includes(input.environment.entitlementState);
  const releaseAllowed = input.release.releaseState === 'available';
  const compatibility = !declaredCompatible
    ? finding('blocked', 'host_incompatible', 'Declared host, API, SDK, deployment, or architecture range does not match.')
    : !evidence
      ? finding('blocked', 'validation_pending', 'No retained exact-host compatibility evidence matches this deployment target.')
      : finding('pass', 'none', 'Declared and exact tested compatibility are verified.');
  const identity = releaseAllowed
    ? finding('pass', 'none', 'Immutable release identity and release state are eligible for installation.')
    : finding(
        'blocked',
        input.release.releaseState === 'security_revoked'
          ? 'security_revoked'
          : 'release_withdrawn',
        'This release is not available for a new installation.',
      );
  const entitlement = entitlementAllowed
    ? finding('pass', 'none', 'Entitlement state permits installation.')
    : finding('blocked', 'entitlement_inactive', 'Entitlement state does not permit installation.');
  const permissionsAndData = finding(
    input.release.data.leavesDeployment ? 'warning' : 'pass',
    'none',
    input.release.data.leavesDeployment
      ? 'Declared plugin data may leave this deployment; review the product data-flow policy.'
      : 'Declared plugin data remains in this deployment.',
  );
  const infrastructure = finding(
    input.release.infrastructure.egressPolicy === 'none' ? 'pass' : 'warning',
    'none',
    `Resource and egress policy ${input.release.infrastructure.egressPolicy} are declared by the signed release.`,
  );
  const migrationAndRollback = finding(
    input.release.schemaTransition.rollbackClass === 'forward_only'
      ? 'warning'
      : 'pass',
    'none',
    `Rollback class is ${input.release.schemaTransition.rollbackClass}.`,
  );
  const base = {
    apiVersion: 'install-review.plugin.enterpriseglue.io/v1' as const,
    kind: 'EnterpriseGluePluginInstallReview' as const,
    installationId: input.intent.installationId,
    pluginId: input.intent.pluginId,
    version: input.release.version,
    release: input.intent.release,
    planSha256: input.envelope.planSha256!,
    platformRevision: input.intent.expectedPlatformRevision,
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    identity,
    compatibility,
    permissionsAndData,
    infrastructure,
    migrationAndRollback,
    entitlement,
    entitlementState: input.environment.entitlementState,
    rollbackClass: input.release.schemaTransition.rollbackClass,
    requestedPermissions: input.release.permissions,
    materialChanges:
      operation === 'upgrade'
        ? [
            'plugin-version',
            ...(input.release.schemaTransition.from ===
            input.release.schemaTransition.to
              ? []
              : ['data-schema']),
            ...(input.release.permissions.length === 0
              ? []
              : ['permissions-review']),
          ]
        : ['initial-install'],
    approvable: [identity, compatibility, entitlement].every(
      (item) => item.status !== 'blocked',
    ),
  };
  return {
    ...base,
    reviewSha256: hashPluginManagerDocumentV1(base),
  };
}

function observation(input: {
  intent: PluginInstallationIntentV1;
  release?: PluginReleaseV1;
  revision: number;
  state: PluginInstallationObservationV1['state'];
  reasonCode: PluginInstallationReasonV1;
  planSha256?: string;
  occurredAt: string;
  retryable?: boolean;
  recoveryActions?: PluginInstallationObservationV1['recoveryActions'];
}): PluginInstallationObservationV1 {
  return {
    apiVersion: 'installation-observation.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginInstallationObservation',
    installationId: input.intent.installationId,
    pluginId: input.intent.pluginId,
    version: input.release?.version,
    revision: input.revision,
    state: input.state,
    reasonCode: input.reasonCode,
    planSha256: input.planSha256,
    occurredAt: input.occurredAt,
    retryable: input.retryable ?? false,
    recoveryActions: input.recoveryActions ?? [],
  };
}

export class NativePluginManagerV1 {
  private readonly leaseDurationMs: number;
  private readonly approvalPollIntervalMs: number;
  private readonly approvalPollLimit: number;
  private readonly now: () => Date;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: NativePluginManagerOptionsV1) {
    this.options.capability = pluginManagerCapabilityV1Schema.parse(
      options.capability,
    );
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.approvalPollIntervalMs = options.approvalPollIntervalMs ?? 1_000;
    this.approvalPollLimit = options.approvalPollLimit ?? 1;
    this.now = options.now ?? (() => new Date());
    this.wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async readiness(): Promise<PluginManagerCapabilityV1> {
    const capability = pluginManagerCapabilityV1Schema.parse({
      ...this.options.capability,
      observedAt: this.now().toISOString(),
    });
    await this.options.host.advertiseCapability(capability);
    return capability;
  }

  async runOnce(): Promise<PluginManagerRunResultV1> {
    await this.readiness();
    const claim = await this.options.host.claimIntent({
      managerId: this.options.capability.managerId,
      leaseDurationMs: this.leaseDurationMs,
      occurredAt: this.now().toISOString(),
    });
    if (!claim) return { status: 'idle' };
    const intent = pluginInstallationIntentV1Schema.parse(claim.intent);
    let release: PluginReleaseV1;
    try {
      release = pluginReleaseV1Schema.parse(
        await this.options.releases.resolve(intent.release, intent.source),
      );
    } catch (error) {
      return this.publishSafeFailure({
        claim,
        intent,
        revision: claim.revision,
        reasonCode: safePluginManagerFailureReasonV1(error),
        retryable: isRetryablePluginManagerFailureV1(error),
      });
    }
    if (release.pluginId !== intent.pluginId) {
      return this.publishSafeFailure({
        claim,
        intent,
        release,
        revision: claim.revision,
        reasonCode: 'verification_failed',
        retryable: false,
      });
    }
    if (!this.options.capability.operations.includes(intent.operation)) {
      return this.publishSafeFailure({
        claim,
        intent,
        release,
        revision: claim.revision,
        reasonCode: 'manager_incompatible',
        retryable: false,
      });
    }
    let envelope: PluginLifecyclePlanEnvelopeV1;
    let review: PluginInstallReviewV1;
    try {
      envelope = createPluginInstallPlanV1({ intent, release });
      const generatedAt = this.now();
      const reusableReview =
        claim.review &&
        Date.parse(claim.review.expiresAt) > generatedAt.getTime()
          ? this.assertReusableReview(claim.review, intent, release, envelope)
          : undefined;
      review =
        reusableReview ??
        createPluginInstallReviewV1({
          intent,
          release,
          environment: this.options.environment,
          envelope,
          generatedAt: generatedAt.toISOString(),
          expiresAt: new Date(
            generatedAt.getTime() + 15 * 60_000,
          ).toISOString(),
        });
    } catch (error) {
      return this.publishSafeFailure({
        claim,
        intent,
        release,
        revision: claim.revision,
        reasonCode: safePluginManagerFailureReasonV1(error),
        retryable: false,
      });
    }
    const publishedReview =
      await this.options.host.publishReview({
        leaseToken: claim.leaseToken,
        expectedRevision: claim.revision,
        review,
      });
    let revision = publishedReview.revision;
    if (!review.approvable) {
      const blocked = observation({
        intent,
        release,
        revision,
        state: 'failed',
        reasonCode:
          review.identity.reasonCode !== 'none'
            ? review.identity.reasonCode
            : review.compatibility.reasonCode !== 'none'
              ? review.compatibility.reasonCode
              : review.entitlement.reasonCode,
        planSha256: review.planSha256,
        occurredAt: this.now().toISOString(),
      });
      await this.options.host.publishObservation({
        leaseToken: claim.leaseToken,
        expectedRevision: revision,
        observation: blocked,
      });
      return {
        status: 'blocked',
        installationId: intent.installationId,
        observation: blocked,
      };
    }
    if (!publishedReview.leaseRetained) {
      return {
        status: 'awaiting_approval',
        installationId: intent.installationId,
        review,
      };
    }

    for (let attempt = 0; attempt < this.approvalPollLimit; attempt += 1) {
      const approvalResult = await this.options.host.readApproval({
        installationId: intent.installationId,
        reviewSha256: review.reviewSha256,
        planSha256: review.planSha256,
      });
      if (!approvalResult) {
        if (attempt + 1 < this.approvalPollLimit) {
          await this.wait(this.approvalPollIntervalMs);
          const renewed = await this.options.host.renewIntentLease({
            installationId: intent.installationId,
            leaseToken: claim.leaseToken,
            expectedRevision: revision,
            leaseDurationMs: this.leaseDurationMs,
            occurredAt: this.now().toISOString(),
          });
          revision = renewed.revision;
        }
        continue;
      }
      const approval = pluginInstallApprovalV1Schema.parse(
        approvalResult.approval,
      );
      if (
        approval.reviewSha256 !== review.reviewSha256 ||
        approval.planSha256 !== review.planSha256 ||
        approval.expectedRevision + 1 !== approvalResult.revision ||
        Date.parse(approval.expiresAt) <= this.now().getTime()
      ) {
        return this.publishSafeFailure({
          claim,
          intent,
          release,
          revision,
          planSha256: review.planSha256,
          reasonCode:
            Date.parse(approval.expiresAt) <= this.now().getTime()
              ? 'approval_expired'
              : 'approval_digest_mismatch',
          retryable: false,
        });
      }
      revision = approvalResult.revision;
      if (approval.decision === 'reject') {
        const cancelled = observation({
          intent,
          release,
          revision,
          state: 'cancelled',
          reasonCode: 'administrator_cancelled',
          planSha256: review.planSha256,
          occurredAt: this.now().toISOString(),
        });
        await this.options.host.publishObservation({
          leaseToken: claim.leaseToken,
          expectedRevision: revision,
          observation: cancelled,
        });
        return {
          status: 'blocked',
          installationId: intent.installationId,
          observation: cancelled,
        };
      }
      let result: Awaited<ReturnType<NativePluginManagerV1['executeWithLeaseRenewal']>>;
      try {
        result = await this.executeWithLeaseRenewal({
          claim,
          revision,
          intent,
          release,
          envelope,
        });
      } catch (error) {
        return this.publishSafeFailure({
          claim,
          intent,
          release,
          revision,
          planSha256: review.planSha256,
          reasonCode: safePluginManagerFailureReasonV1(error),
          retryable: isRetryablePluginManagerFailureV1(error),
        });
      }
      const completed = observation({
        intent,
        release,
        revision,
        state:
          result.status === 'succeeded'
            ? 'ready'
            : result.status === 'manual_intervention'
              ? 'manual_intervention'
              : 'failed',
        reasonCode: result.reasonCode,
        planSha256: review.planSha256,
        occurredAt: result.occurredAt,
        retryable: result.status === 'failed',
        recoveryActions:
          result.status === 'failed'
            ? ['retry', 'rollback']
            : result.status === 'manual_intervention'
              ? ['manual_intervention']
              : [],
      });
      await this.options.host.publishObservation({
        leaseToken: claim.leaseToken,
        expectedRevision: revision,
        observation: completed,
      });
      return {
        status:
          result.status === 'succeeded'
            ? 'completed'
            : result.status,
        installationId: intent.installationId,
        observation: completed,
      };
    }
    return {
      status: 'awaiting_approval',
      installationId: intent.installationId,
      review,
    };
  }

  private assertReusableReview(
    reviewInput: PluginInstallReviewV1,
    intent: PluginInstallationIntentV1,
    release: PluginReleaseV1,
    envelope: PluginLifecyclePlanEnvelopeV1,
  ): PluginInstallReviewV1 {
    const review = pluginInstallReviewV1Schema.parse(reviewInput);
    const { reviewSha256, ...unsigned } = review;
    if (
      review.installationId !== intent.installationId ||
      review.pluginId !== intent.pluginId ||
      review.release !== intent.release ||
      review.version !== release.version ||
      review.planSha256 !== envelope.planSha256 ||
      hashPluginManagerDocumentV1(unsigned) !== reviewSha256
    ) {
      throw new Error('stored_review_identity_or_digest_mismatch');
    }
    return review;
  }

  private async publishSafeFailure(input: {
    claim: ClaimedPluginInstallationIntentV1;
    intent: PluginInstallationIntentV1;
    release?: PluginReleaseV1;
    revision: number;
    planSha256?: string;
    reasonCode: PluginInstallationReasonV1;
    retryable: boolean;
  }): Promise<PluginManagerRunResultV1> {
    const failed = observation({
      intent: input.intent,
      release: input.release,
      revision: input.revision,
      state: 'failed',
      reasonCode: input.reasonCode,
      planSha256: input.planSha256,
      occurredAt: this.now().toISOString(),
      retryable: input.retryable,
      recoveryActions: input.retryable ? ['retry'] : [],
    });
    await this.options.host.publishObservation({
      leaseToken: input.claim.leaseToken,
      expectedRevision: input.revision,
      observation: failed,
    });
    return {
      status: 'failed',
      installationId: input.intent.installationId,
      observation: failed,
    };
  }

  private async executeWithLeaseRenewal(input: {
    claim: ClaimedPluginInstallationIntentV1;
    revision: number;
    intent: PluginInstallationIntentV1;
    release: PluginReleaseV1;
    envelope: PluginLifecyclePlanEnvelopeV1;
  }) {
    let renewalError: unknown;
    let renewing: Promise<void> | undefined;
    const renew = () => {
      if (renewing || renewalError) return;
      renewing = this.options.host
        .renewIntentLease({
          installationId: input.intent.installationId,
          leaseToken: input.claim.leaseToken,
          expectedRevision: input.revision,
          leaseDurationMs: this.leaseDurationMs,
          occurredAt: this.now().toISOString(),
        })
        .then(() => undefined)
        .catch((error: unknown) => {
          renewalError = error;
        })
        .finally(() => {
          renewing = undefined;
        });
    };
    const timer = setInterval(renew, Math.max(1_000, Math.floor(this.leaseDurationMs / 3)));
    timer.unref();
    try {
      const result = await this.options.lifecycle.execute({
        intent: input.intent,
        release: input.release,
        envelope: input.envelope,
        managerId: this.options.capability.managerId,
      });
      if (renewing) await renewing;
      if (renewalError) throw renewalError;
      return result;
    } finally {
      clearInterval(timer);
    }
  }
}

export function safePluginManagerFailureReasonV1(
  error: unknown,
): PluginInstallationReasonV1 {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/approval/.test(message)) return 'approval_digest_mismatch';
  if (/provenance|builder|workflow identity/.test(message)) {
    return 'provenance_invalid';
  }
  if (/signature|signer|cosign|trust|digest|tamper/.test(message)) {
    return 'signature_invalid';
  }
  if (/entitlement/.test(message)) return 'entitlement_inactive';
  if (/compatib|host.range|platform|architecture/.test(message)) {
    return 'host_incompatible';
  }
  if (/acqui|registry|download|offline.delivery.import/.test(message)) {
    return 'acquisition_failed';
  }
  if (/migrat/.test(message)) return 'migration_failed';
  if (/readiness|health/.test(message)) return 'health_gate_failed';
  if (/stage|lifecycle|adapter|compose|kubernetes|openshift/.test(message)) {
    return 'staging_failed';
  }
  return 'verification_failed';
}

export function isRetryablePluginManagerFailureV1(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    /signature|signer|cosign|trust|digest|tamper|provenance|builder|workflow identity|entitlement|compatib|host.range|platform|architecture|approval/.test(
      message,
    )
  ) {
    return false;
  }
  return /429|5\d\d|timeout|temporar|connection|network|acqui|registry|download|adapter|compose|kubernetes|openshift/.test(
    message,
  );
}
