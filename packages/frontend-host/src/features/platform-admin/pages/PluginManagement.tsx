import { Power, Renew, WarningAlt } from '@carbon/icons-react';
import {
  Accordion,
  AccordionItem,
  Button,
  InlineLoading,
  InlineNotification,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import React, { useCallback, useEffect, useState } from 'react';
import type { PluginPlatformCapabilityCatalogV1 } from '@enterpriseglue/plugin-sdk';

import { PageHeader, PageLayout, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import { useAuth } from '../../../shared/hooks/useAuth';
import { evaluateActionSnapshot } from '../../../shared/auth/guards';
import { PluginLifecycleManager } from '../components/PluginLifecycleManager';
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
  if (!plugin.compatible) return <Tag size="sm" type="red">Incompatible</Tag>;
  if (!plugin.enabled) return <Tag size="sm" type="gray">Disabled</Tag>;
  if (!plugin.healthy) return <Tag size="sm" type="warm-gray">Degraded</Tag>;
  return <Tag size="sm" type="green">Enabled</Tag>;
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

export default function PluginManagement({ embedded = false }: { embedded?: boolean }) {
  const { permissions } = useAuth();
  const hasPermissionSnapshot = Boolean(permissions);
  const platformResource = { type: 'platform' as const, id: null };
  const settingsRead = evaluateActionSnapshot(
    permissions,
    'platform.settings.read',
    platformResource,
  );
  const settingsManage = evaluateActionSnapshot(
    permissions,
    'platform.settings.manage',
    platformResource,
  );
  const canReadPlugins = !hasPermissionSnapshot || settingsRead.allowed;
  const canManagePlugins = !hasPermissionSnapshot || settingsManage.allowed;
  const [plugins, setPlugins] = useState<PluginSafeSummaryV1[]>([]);
  const [platformRevision, setPlatformRevision] = useState(0);
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
      setPlatformRevision(list.revision);
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
    if (!canReadPlugins) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [canReadPlugins, refresh]);

  const applyPending = async () => {
    if (!pending || !emergency || !canManagePlugins) return;
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

  if (!canReadPlugins) {
    const unavailable = (
      <InlineNotification
        kind="error"
        title="Plugin administration unavailable"
        subtitle={settingsRead.reason || 'The current user cannot read platform settings.'}
        hideCloseButton
        lowContrast
      />
    );
    return embedded ? unavailable : (
      <PageLayout style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        <PageHeader
          icon={Power}
          title="Plugin management"
          subtitle="Discover, install, update and operate signed plugins through the customer-local Plugin Manager."
          gradient={PAGE_GRADIENTS.red}
          variant="productive"
        />
        {unavailable}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      padding={embedded ? '0' : undefined}
      className={`eg-plugin-management${embedded ? ' eg-plugin-management--embedded' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-5)',
        minHeight: embedded ? undefined : '100vh',
      }}
    >
      {!embedded && (
        <PageHeader
          icon={Power}
          title="Plugin management"
          subtitle="Discover, install, update and operate signed plugins through the customer-local Plugin Manager."
          gradient={PAGE_GRADIENTS.red}
          variant="productive"
        />
      )}

      {embedded && (
        <header className="eg-plugin-management__intro">
          <h2 id="plugins-title">Plugins</h2>
          <p>Discover, install, update and operate signed plugins without rebuilding EnterpriseGlue.</p>
        </header>
      )}

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
          title="Emergency controls are active"
          subtitle="New plugin execution is blocked. Plugin configuration is unchanged."
          hideCloseButton
          lowContrast
        />
      )}

      <PluginLifecycleManager
        canManage={canManagePlugins}
        installedPlugins={plugins}
        platformRevision={platformRevision}
        installedContent={<section className="eg-plugin-management__section" aria-labelledby="installed-plugins-title">
        <div className="eg-plugin-management__section-header">
          <div>
            <h3 id="installed-plugins-title">Installed plugins</h3>
            <p>Control runtime availability independently from installation and commercial entitlement.</p>
          </div>
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
            subtitle="Choose a signed release from Available to create a verified installation review."
            hideCloseButton
            lowContrast
          />
        ) : (
          <TableContainer className="eg-plugin-management__table">
            <Table aria-label="Installed plugins" size="md" useZebraStyles>
              <TableHead>
                <TableRow>
                  <TableHeader>Plugin</TableHeader>
                  <TableHeader>Version</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Health</TableHeader>
                  <TableHeader>Runtime access</TableHeader>
                  <TableHeader className="eg-plugin-management__actions-heading">Actions</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {plugins.map((plugin) => (
                  <TableRow key={plugin.pluginId}>
                    <TableCell>
                      <div className="eg-plugin-management__plugin-name">{plugin.displayName}</div>
                      <code className="eg-plugin-management__plugin-id">{plugin.pluginId}</code>
                    </TableCell>
                    <TableCell>
                      <div>{plugin.version}</div>
                      <span className="eg-plugin-management__meta">Revision {plugin.revision}</span>
                    </TableCell>
                    <TableCell>{statusTag(plugin)}</TableCell>
                    <TableCell>
                      <Tag size="sm" type={plugin.healthy ? 'green' : 'warm-gray'}>
                        {plugin.healthy ? 'Healthy' : 'Needs attention'}
                      </Tag>
                      {plugin.reasonCode !== 'none' && (
                        <div className="eg-plugin-management__meta">{plugin.reasonCode}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="eg-plugin-management__meta">Runtime {plugin.state}</span>
                      <div className="eg-plugin-management__meta">Entitlement {plugin.entitled}</div>
                    </TableCell>
                    <TableCell className="eg-plugin-management__actions-cell">
                      <OverflowMenu
                        size="sm"
                        flipped
                        iconDescription={`Actions for ${plugin.displayName}`}
                        aria-label={`Actions for ${plugin.displayName}`}
                      >
                        <OverflowMenuItem
                          itemText={plugin.enabled ? `Disable ${plugin.displayName}` : `Enable ${plugin.displayName}`}
                          isDelete={plugin.enabled}
                          disabled={
                            busy ||
                            !canManagePlugins ||
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
                        />
                      </OverflowMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </section>}
      />

      <section className="eg-plugin-management__section" aria-labelledby="advanced-plugin-operations-title">
        <div className="eg-plugin-management__section-header">
          <div>
            <h3 id="advanced-plugin-operations-title">Advanced operations</h3>
            <p>Use these controls only when recovery or platform intervention is needed.</p>
          </div>
        </div>
        <Accordion className="eg-plugin-management__accordion">
          <AccordionItem title="Emergency controls">
            <div className="eg-plugin-management__accordion-content">
              <p>Stop all plugin execution without changing which plugins are enabled. Clearing the stop resumes eligible plugins.</p>
              {emergency && (
                <p className="eg-plugin-management__meta">
                  Revision {emergency.revision} · Last changed {new Date(emergency.updatedAt).toLocaleString()}
                </p>
              )}
              {loading ? (
                <InlineLoading description="Loading emergency controls" />
              ) : (
                <Button
                  kind={emergencyActive ? 'primary' : 'danger--tertiary'}
                  size="sm"
                  renderIcon={emergencyActive ? Renew : WarningAlt}
                  disabled={!emergency || busy || !canManagePlugins}
                  onClick={() => setPending({ kind: 'emergency', disabled: !emergencyActive })}
                >
                  {emergencyActive ? 'Clear emergency controls' : 'Stop all plugins'}
                </Button>
              )}
            </div>
          </AccordionItem>

          <AccordionItem title="Host compatibility">
            <div className="eg-plugin-management__accordion-content">
              {loading ? (
                <InlineLoading description="Loading host compatibility" />
              ) : capabilities ? (
                <>
                  <div className="eg-plugin-management__compatibility-summary">
                    Host {capabilities.compatibility.hostVersion} · SDK {capabilities.compatibility.sdkVersion} ·{' '}
                    <Tag size="sm" type="blue">Protocol v1</Tag>
                  </div>
                  <p className="eg-plugin-management__meta">
                    Supports host {capabilities.compatibility.supportWindow.hostMinorLines.join(', ')} · SDK {capabilities.compatibility.supportWindow.sdkVersions.join(', ')}
                  </p>
                  <p className="eg-plugin-management__meta">
                    {capabilities.permissions.length} permissions · {capabilities.slots.length} extension slots · {capabilities.events.length} event types
                  </p>
                </>
              ) : (
                <p>Host compatibility information is unavailable.</p>
              )}
            </div>
          </AccordionItem>

          {deploymentExecution?.execution && (
            <AccordionItem title="Deployment lifecycle">
              <div className="eg-plugin-management__accordion-content">
                <p>
                  <code>{deploymentExecution.execution.pluginId}</code> · {deploymentExecution.execution.operation} · desired revision {deploymentExecution.desiredRevision}
                </p>
                <p className="eg-plugin-management__meta">
                  Completed {deploymentExecution.execution.completedPhases.length} phases · Updated {new Date(deploymentExecution.execution.updatedAt).toLocaleString()}
                </p>
                {executionStatusTag(deploymentExecution)}
              </div>
            </AccordionItem>
          )}

          {deadLetters.length > 0 && (
            <AccordionItem title={`Event delivery recovery (${deadLetters.length})`}>
              <div className="eg-plugin-management__accordion-content eg-plugin-management__recovery-list">
                <p>Failures are payload-free. Requeue only after the plugin or policy problem is corrected.</p>
                {deadLetters.map((delivery) => (
                  <div className="eg-plugin-management__recovery-item" key={delivery.deliveryId}>
                    <div>
                      <strong>{delivery.pluginId}</strong>
                      <div className="eg-plugin-management__meta">
                        Attempt {delivery.attempt} of {delivery.maxAttempts} · {delivery.reasonCode}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      kind="tertiary"
                      renderIcon={Renew}
                      disabled={busy || !canManagePlugins}
                      onClick={() => setPending({ kind: 'dead-letter', delivery })}
                    >
                      Requeue delivery
                    </Button>
                  </div>
                ))}
              </div>
            </AccordionItem>
          )}

          {audits.length > 0 && (
            <AccordionItem title="Recent control activity">
              <div className="eg-plugin-management__accordion-content eg-plugin-management__audit-list">
                {audits.slice(0, 20).map((event) => (
                  <div className="eg-plugin-management__audit-item" key={event.eventId}>
                    <div>
                      <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                      <div className="eg-plugin-management__meta">
                        {event.pluginId ?? 'All plugins'} · {event.fromState ?? 'none'} → {event.toState ?? 'none'}
                      </div>
                    </div>
                    <span className="eg-plugin-management__meta">{new Date(event.occurredAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </AccordionItem>
          )}
        </Accordion>
      </section>

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
              ? 'This changes only the durable runtime gate. Installation, updates and removal remain separate Plugin Manager operations.'
              : 'The host will retry this minimized event through the same declared subscription. No event payload is shown or editable here.'}
        </p>
        {busy && <InlineLoading description="Applying control change" />}
      </Modal>
    </PageLayout>
  );
}
