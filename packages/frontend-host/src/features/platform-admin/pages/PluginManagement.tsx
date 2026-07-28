import { Power, Renew, WarningAlt } from '@carbon/icons-react';
import {
  Button,
  InlineLoading,
  InlineNotification,
  Modal,
  Tag,
  Tile,
} from '@carbon/react';
import React, { useCallback, useEffect, useState } from 'react';
import type { PluginPlatformCapabilityCatalogV1 } from '@enterpriseglue/plugin-sdk';

import { PageHeader, PageLayout, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import {
  getPluginDeploymentExecution,
  getPluginPlatformCapabilities,
  getPluginPlatformEmergencyState,
  listPluginEventDeadLetters,
  listPluginPlatformAudit,
  listPluginPlatformPlugins,
  requeuePluginEventDeadLetter,
  setPluginDeploymentEnabled,
  setPluginPlatformEmergencyState,
  type PluginPlatformEmergencyStateV1,
  type PluginPlatformAuditEventV1,
  type PluginDeploymentExecutionObservationV1,
  type PluginEventDeadLetterSafeSummaryV1,
  type PluginSafeSummaryV1,
} from '../api/pluginPlatform';

type PendingAction =
  | {
      kind: 'emergency';
      disabled: boolean;
    }
  | {
      kind: 'plugin';
      plugin: PluginSafeSummaryV1;
      enabled: boolean;
    }
  | {
      kind: 'dead-letter';
      delivery: PluginEventDeadLetterSafeSummaryV1;
    };

function idempotencyKey(scope: string): string {
  return `${scope}-${crypto.randomUUID()}`;
}

function statusTag(plugin: PluginSafeSummaryV1) {
  if (!plugin.compatible) return <Tag type="red">Incompatible</Tag>;
  if (!plugin.enabled) return <Tag type="gray">Disabled</Tag>;
  if (!plugin.healthy) return <Tag type="warm-gray">Degraded</Tag>;
  return <Tag type="green">Enabled</Tag>;
}

function executionStatusTag(
  observation: PluginDeploymentExecutionObservationV1,
) {
  if (observation.observationState === 'invalid') {
    return <Tag type="red">Invalid observation</Tag>;
  }
  if (observation.observationState === 'stale') {
    return <Tag type="warm-gray">Stale observation</Tag>;
  }
  if (!observation.execution) {
    return <Tag type="gray">Not started</Tag>;
  }
  if (observation.execution.status === 'succeeded') {
    return <Tag type="green">Succeeded</Tag>;
  }
  if (
    observation.execution.status === 'failed' ||
    observation.execution.status === 'manual_intervention'
  ) {
    return <Tag type="red">{observation.execution.status.replace(/_/g, ' ')}</Tag>;
  }
  return <Tag type="blue">{observation.execution.status}</Tag>;
}

export default function PluginManagement() {
  const [plugins, setPlugins] = useState<PluginSafeSummaryV1[]>([]);
  const [emergency, setEmergency] =
    useState<PluginPlatformEmergencyStateV1 | null>(null);
  const [audits, setAudits] = useState<PluginPlatformAuditEventV1[]>([]);
  const [deadLetters, setDeadLetters] = useState<
    PluginEventDeadLetterSafeSummaryV1[]
  >([]);
  const [deploymentExecution, setDeploymentExecution] =
    useState<PluginDeploymentExecutionObservationV1 | null>(null);
  const [capabilities, setCapabilities] =
    useState<PluginPlatformCapabilityCatalogV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [list, emergencyState, audit, execution, eventFailures, platformCapabilities] =
        await Promise.all([
        listPluginPlatformPlugins(),
        getPluginPlatformEmergencyState(),
        listPluginPlatformAudit(),
        getPluginDeploymentExecution(),
        listPluginEventDeadLetters(),
        getPluginPlatformCapabilities(),
      ]);
      setPlugins(list.plugins);
      setEmergency(emergencyState);
      setAudits(audit.events);
      setDeploymentExecution(execution);
      setDeadLetters(eventFailures.items);
      setCapabilities(platformCapabilities);
    } catch {
      setError('Plugin control state could not be loaded. Try again or inspect the host logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyPending = async () => {
    if (!pending || !emergency) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'emergency') {
        await setPluginPlatformEmergencyState({
          disabled: pending.disabled,
          expectedRevision: emergency.revision,
          idempotencyKey: idempotencyKey('plugin-emergency-ui'),
        });
      } else if (pending.kind === 'plugin') {
        await setPluginDeploymentEnabled({
          pluginId: pending.plugin.pluginId,
          enabled: pending.enabled,
          expectedRevision: pending.plugin.revision,
          idempotencyKey: idempotencyKey('plugin-lifecycle-ui'),
        });
      } else {
        await requeuePluginEventDeadLetter({
          pluginId: pending.delivery.pluginId,
          deliveryId: pending.delivery.deliveryId,
          expectedAttempt: pending.delivery.attempt,
        });
      }
      setPending(null);
      await refresh();
    } catch {
      setError(
        'The control change was not accepted. Refresh the state; another administrator may have changed it.',
      );
    } finally {
      setBusy(false);
    }
  };

  const emergencyActive = emergency?.disabled ?? false;
  const pendingIsDisable =
    pending?.kind === 'emergency'
      ? pending.disabled
      : pending?.kind === 'plugin'
        ? !pending.enabled
        : false;

  return (
    <PageLayout
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-5)',
        minHeight: '100vh',
      }}
    >
      <PageHeader
        icon={Power}
        title="Plugin management"
        subtitle="View installed plugins and control their runtime access. Installation and upgrades remain installer operations."
        gradient={PAGE_GRADIENTS.red}
      />

      {error && (
        <InlineNotification
          kind="error"
          title="Plugin control error"
          subtitle={error}
          lowContrast
          onCloseButtonClick={() => setError(null)}
        />
      )}

      {emergencyActive && (
        <InlineNotification
          kind="error"
          title="Emergency stop is active"
          subtitle="All new plugin execution is blocked. Ordinary EnterpriseGlue OSS remains available, and desired plugin state is preserved."
          hideCloseButton
          lowContrast
        />
      )}

      <Tile>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--spacing-5)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ marginTop: 0 }}>Platform emergency control</h2>
            <p style={{ marginBottom: 0, maxWidth: '72ch' }}>
              Stops every plugin through one durable gate without changing which plugins were
              enabled. Clearing the stop resumes only previously eligible plugins.
            </p>
            {emergency && (
              <p style={{ marginBottom: 0 }}>
                Revision {emergency.revision} · Last changed{' '}
                {new Date(emergency.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
          {loading ? (
            <InlineLoading description="Loading emergency state" />
          ) : (
            <Button
              kind={emergencyActive ? 'primary' : 'danger'}
              renderIcon={emergencyActive ? Renew : WarningAlt}
              disabled={!emergency || busy}
              onClick={() =>
                setPending({
                  kind: 'emergency',
                  disabled: !emergencyActive,
                })
              }
            >
              {emergencyActive ? 'Clear emergency stop' : 'Stop all plugins'}
            </Button>
          )}
        </div>
      </Tile>

      <Tile>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--spacing-5)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ marginTop: 0 }}>Host plugin contract</h2>
            <p style={{ maxWidth: '72ch' }}>
              Exact machine-readable capabilities enforced by this host. Named egress policies
              and trusted publisher identifiers are shown, but destinations, credentials, trust
              keys, tenant data, and plugin payloads are never included.
            </p>
            {loading ? (
              <InlineLoading description="Loading host plugin contract" />
            ) : capabilities ? (
              <>
                <p>
                  Host {capabilities.compatibility.hostVersion} · SDK{' '}
                  {capabilities.compatibility.sdkVersion} · Catalog{' '}
                  {capabilities.metadata.catalogRevision}
                </p>
                <p>
                  {capabilities.permissions.length} permissions · {capabilities.slots.length}{' '}
                  extension slots · {capabilities.events.length} event types
                  <br />
                  Supported host lines{' '}
                  {capabilities.compatibility.supportWindow.hostMinorLines.join(', ')} · SDK
                  lines {capabilities.compatibility.supportWindow.sdkMinorLines.join(', ')}
                  <br />
                  Supported SDK packages{' '}
                  {capabilities.compatibility.supportWindow.sdkVersions.join(', ')}
                </p>
                <p style={{ marginBottom: 0 }}>
                  Egress policies:{' '}
                  {capabilities.egressPolicies.map((entry) => entry.id).join(', ')}
                  <br />
                  Trusted publishers:{' '}
                  {capabilities.trustedPublishers.length > 0
                    ? capabilities.trustedPublishers.map((entry) => entry.id).join(', ')
                    : 'none'}
                </p>
              </>
            ) : (
              <p>The host plugin contract is unavailable.</p>
            )}
          </div>
          {!loading && capabilities && <Tag type="blue">Protocol v1</Tag>}
        </div>
      </Tile>

      <Tile>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--spacing-4)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ marginTop: 0 }}>Deployment lifecycle</h2>
            <p style={{ maxWidth: '72ch' }}>
              Safe installer progress from the local execution mirror. Runtime workload
              reconciliation has not been checked.
            </p>
            {loading ? (
              <InlineLoading description="Loading deployment lifecycle" />
            ) : deploymentExecution?.execution ? (
              <>
                <p>
                  <code>{deploymentExecution.execution.pluginId}</code> ·{' '}
                  {deploymentExecution.execution.operation} · desired revision{' '}
                  {deploymentExecution.desiredRevision}
                </p>
                <p>
                  Completed {deploymentExecution.execution.completedPhases.length} phase
                  {deploymentExecution.execution.completedPhases.length === 1 ? '' : 's'}
                  {deploymentExecution.execution.nextPhase
                    ? ` · Next ${deploymentExecution.execution.nextPhase}`
                    : ' · No remaining phase'}
                  <br />
                  Updated{' '}
                  {new Date(deploymentExecution.execution.updatedAt).toLocaleString()}
                </p>
                {deploymentExecution.execution.reasonCode !== 'none' && (
                  <p>
                    Safe reason:{' '}
                    <code>{deploymentExecution.execution.reasonCode}</code>
                  </p>
                )}
              </>
            ) : deploymentExecution ? (
              <p>
                Desired revision {deploymentExecution.desiredRevision} ·{' '}
                {deploymentExecution.observationState === 'not_started'
                  ? 'No lifecycle execution has started.'
                  : `Execution details are hidden because the observation is ${deploymentExecution.observationReason.replace(
                      /_/g,
                      ' ',
                    )}.`}
              </p>
            ) : (
              <p>No deployment lifecycle observation is available.</p>
            )}
          </div>
          {!loading && deploymentExecution && executionStatusTag(deploymentExecution)}
        </div>
      </Tile>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-4)',
        }}
      >
        <h2 style={{ margin: 0 }}>Installed plugins</h2>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Renew}
          disabled={loading || busy}
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
        >
          Refresh
        </Button>
      </div>

      {loading ? (
        <InlineLoading description="Loading installed plugins" />
      ) : plugins.length === 0 ? (
        <InlineNotification
          kind="info"
          title="No installed plugins"
          subtitle="Install a verified package with the supported installer. This page never acquires or deploys plugin artifacts."
          hideCloseButton
          lowContrast
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--spacing-4)',
          }}
        >
          {plugins.map((plugin) => (
            <Tile key={plugin.pluginId}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--spacing-3)',
                }}
              >
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: 'var(--spacing-2)' }}>
                    {plugin.displayName}
                  </h3>
                  <code>{plugin.pluginId}</code>
                </div>
                {statusTag(plugin)}
              </div>
              <p>
                Version {plugin.version} · State {plugin.state}
                <br />
                Entitlement {plugin.entitled} · Revision {plugin.revision}
              </p>
              {plugin.reasonCode !== 'none' && (
                <p>
                  Safe reason: <code>{plugin.reasonCode}</code>
                </p>
              )}
              <Button
                size="sm"
                kind={plugin.enabled ? 'danger--tertiary' : 'tertiary'}
                disabled={
                  busy ||
                  emergencyActive ||
                  (!plugin.enabled && !plugin.compatible)
                }
                onClick={() =>
                  setPending({
                    kind: 'plugin',
                    plugin,
                    enabled: !plugin.enabled,
                  })
                }
              >
                {plugin.enabled ? 'Disable runtime' : 'Enable runtime'}
              </Button>
            </Tile>
          ))}
        </div>
      )}

      <h2 style={{ marginBottom: 0 }}>Event delivery recovery</h2>
      <p style={{ marginTop: 0, maxWidth: '72ch' }}>
        Payload-free failures from isolated plugin event delivery. Tenant, engine, incident,
        job, exception, and request content are deliberately hidden. Requeue only after the
        plugin or policy problem has been corrected.
      </p>
      {loading ? (
        <InlineLoading description="Loading event delivery failures" />
      ) : deadLetters.length === 0 ? (
        <InlineNotification
          kind="success"
          title="No dead-lettered plugin events"
          subtitle="There are no event deliveries waiting for administrator recovery."
          hideCloseButton
          lowContrast
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 'var(--spacing-4)',
          }}
        >
          {deadLetters.map((delivery) => (
            <Tile key={delivery.deliveryId}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--spacing-3)',
                }}
              >
                <div>
                  <strong>{delivery.pluginId}</strong>
                  <div>
                    {delivery.subscriptionType
                      .replace('io.enterpriseglue.host.', '')
                      .replace('.v1', '')
                      .replace(/[-_]/g, ' ')}
                  </div>
                </div>
                <Tag type="red">Dead letter</Tag>
              </div>
              <p>
                Attempt {delivery.attempt} of {delivery.maxAttempts}
                <br />
                Safe reason: <code>{delivery.reasonCode}</code>
                <br />
                Updated {new Date(delivery.updatedAt).toLocaleString()}
              </p>
              <Button
                size="sm"
                kind="tertiary"
                renderIcon={Renew}
                disabled={busy}
                onClick={() =>
                  setPending({
                    kind: 'dead-letter',
                    delivery,
                  })
                }
              >
                Requeue delivery
              </Button>
            </Tile>
          ))}
        </div>
      )}

      <h2 style={{ marginBottom: 0 }}>Recent control activity</h2>
      {loading ? (
        <InlineLoading description="Loading recent control activity" />
      ) : audits.length === 0 ? (
        <p>No plugin control activity has been recorded yet.</p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
          }}
        >
          {audits.slice(0, 20).map((event) => (
            <Tile key={event.eventId}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--spacing-4)',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                  <div>
                    {event.pluginId ?? 'All plugins'} · {event.fromState ?? 'none'} →{' '}
                    {event.toState ?? 'none'}
                  </div>
                  <div>
                    Actor <code>{event.actorRef}</code> · Correlation{' '}
                    <code>{event.correlationId}</code>
                  </div>
                </div>
                <div>
                  <Tag type={event.reasonCode === 'none' ? 'gray' : 'warm-gray'}>
                    {event.reasonCode}
                  </Tag>
                  <div>{new Date(event.occurredAt).toLocaleString()}</div>
                </div>
              </div>
            </Tile>
          ))}
        </div>
      )}

      <Modal
        open={pending !== null}
        danger={pendingIsDisable}
        modalHeading={
          pending?.kind === 'emergency'
            ? pending.disabled
              ? 'Stop all plugins?'
              : 'Clear the emergency stop?'
            : pending?.kind === 'plugin'
              ? pending.enabled
                ? `Enable ${pending.plugin.displayName}?`
                : `Disable ${pending.plugin.displayName}?`
              : 'Requeue plugin event delivery?'
        }
        primaryButtonText={
          pending?.kind === 'emergency' && pending.disabled
            ? 'Stop all plugins'
            : 'Confirm'
        }
        secondaryButtonText="Cancel"
        primaryButtonDisabled={busy}
        onRequestClose={() => {
          if (!busy) setPending(null);
        }}
        onRequestSubmit={() => {
          void applyPending();
        }}
      >
        <p>
          {pending?.kind === 'emergency'
            ? 'This changes one durable platform gate. It does not uninstall plugins or erase their desired state.'
            : pending?.kind === 'plugin'
              ? 'This changes only the durable runtime gate. Install, upgrade, and removal remain supported-installer actions.'
              : 'The host will retry this minimized event through the same declared subscription. No event payload is shown or editable here.'}
        </p>
        {busy && <InlineLoading description="Applying control change" />}
      </Modal>
    </PageLayout>
  );
}
