import { Add, Renew, Upload } from '@carbon/icons-react';
import {
  Accordion,
  AccordionItem,
  Button,
  InlineLoading,
  InlineNotification,
  Modal,
  Pagination,
  Search as CarbonSearch,
  Select,
  SelectItem,
  TextInput,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PluginCatalogV2,
  PluginInstallReviewV1,
  PluginProductDescriptorV1,
} from '@enterpriseglue/plugin-sdk';

import {
  createPluginInstallation,
  decidePluginInstallation,
  getPluginCatalog,
  getPluginManagerStatus,
  listPluginInstallations,
  recoverPluginInstallation,
  type PluginInstallationSummaryV1,
  type PluginManagerStatusV1,
  type PluginSafeSummaryV1,
} from '../api/pluginPlatform';

interface PluginLifecycleManagerProps {
  canManage: boolean;
  installedPlugins: PluginSafeSummaryV1[];
  platformRevision: number;
  installedContent: React.ReactNode;
}

interface AvailableProduct {
  descriptor: PluginProductDescriptorV1;
  release: PluginCatalogV2['products'][number]['releases'][number];
}

interface PendingInstall {
  product: AvailableProduct;
  deploymentMode: PluginProductDescriptorV1['deploymentModes'][number];
  operation: 'install' | 'upgrade';
  fromVersion?: string;
  currentEnabled?: boolean;
}

interface PendingManualInstall {
  source: 'connected_registry' | 'offline_delivery';
  pluginId: string;
  release: string;
  deploymentMode: 'compose_planner' | 'compose_managed' | 'kubernetes' | 'openshift';
}

const ACTIVITY_PAGE_SIZES = [10, 25, 50];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function newestRelease(
  product: PluginCatalogV2['products'][number],
): PluginCatalogV2['products'][number]['releases'][number] {
  const stable = product.releases.filter(
    (release) => release.channel === 'stable' && release.state === 'available',
  );
  return [...(stable.length > 0 ? stable : product.releases)].sort(
    (left, right) => {
      const leftParts = left.version.split(/[.-]/).slice(0, 3).map(Number);
      const rightParts = right.version.split(/[.-]/).slice(0, 3).map(Number);
      for (let index = 0; index < 3; index += 1) {
        const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return right.version.localeCompare(left.version);
    },
  )[0];
}

function stateTag(state: string) {
  if (['failed', 'manual_intervention', 'rollback_pending'].includes(state)) {
    return <Tag type="red">{state.replace(/_/g, ' ')}</Tag>;
  }
  if (['ready', 'enabled', 'verified'].includes(state)) {
    return <Tag type="green">{state.replace(/_/g, ' ')}</Tag>;
  }
  if (['awaiting_approval', 'approved', 'acquiring', 'planning', 'upgrading'].includes(state)) {
    return <Tag type="blue">{state.replace(/_/g, ' ')}</Tag>;
  }
  return <Tag type="gray">{state.replace(/_/g, ' ')}</Tag>;
}

function reviewTag(finding: PluginInstallReviewV1['identity']) {
  return (
    <Tag type={finding.status === 'pass' ? 'green' : finding.status === 'warning' ? 'warm-gray' : 'red'}>
      {finding.status}
    </Tag>
  );
}

function ReviewFinding({
  title,
  finding,
}: {
  title: string;
  finding: PluginInstallReviewV1['identity'];
}) {
  return (
    <AccordionItem title={title}>
      <div className="eg-plugin-manager__review-finding">
        {reviewTag(finding)}
        <p>{finding.summary}</p>
        {finding.reasonCode !== 'none' && (
          <code className="eg-plugin-management__plugin-id">{finding.reasonCode}</code>
        )}
      </div>
    </AccordionItem>
  );
}

function ManagerAvailability({ status }: { status: PluginManagerStatusV1 | null }) {
  if (!status) return null;
  if (!status.available || !status.capability) {
    return (
      <InlineNotification
        kind="warning"
        title="Plugin Manager is unavailable"
        subtitle="Installed plugins remain usable. Start or configure the local manager before planning an installation."
        hideCloseButton
        lowContrast
      />
    );
  }
  return (
    <div className="eg-plugin-manager__availability" role="status">
      <span>
        Local manager <strong>{status.capability.state.replace(/_/g, ' ')}</strong>
      </span>
      <span>Version {status.capability.managerVersion}</span>
      <span>{status.capability.deploymentModes.map((mode) => mode.replace(/_/g, ' ')).join(', ')}</span>
    </div>
  );
}

export function PluginLifecycleManager({
  canManage,
  installedPlugins,
  platformRevision,
  installedContent,
}: PluginLifecycleManagerProps) {
  const [manager, setManager] = useState<PluginManagerStatusV1 | null>(null);
  const [catalog, setCatalog] = useState<PluginCatalogV2 | null>(null);
  const [activity, setActivity] = useState<PluginInstallationSummaryV1[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);
  const [pendingManualInstall, setPendingManualInstall] =
    useState<PendingManualInstall | null>(null);
  const [selectedInstallation, setSelectedInstallation] =
    useState<PluginInstallationSummaryV1 | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [managerResult, catalogResult, activityResult] = await Promise.all([
        getPluginManagerStatus(),
        getPluginCatalog(),
        listPluginInstallations({ limit: pageSize, offset: (page - 1) * pageSize }),
      ]);
      setManager(managerResult);
      setCatalog(catalogResult.catalog);
      setActivity(activityResult.items);
      setActivityTotal(activityResult.total);
      setSelectedInstallation((current) => {
        if (!current) return null;
        return activityResult.items.find(
          (item) => item.intent.installationId === current.intent.installationId,
        ) ?? current;
      });
    } catch {
      setError('Plugin installation state could not be loaded. Existing plugins are unaffected.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const hasActiveWork = activity.some((item) =>
      ['requested', 'planning', 'approved', 'acquiring', 'verified', 'staged_disabled', 'upgrading', 'uninstalling'].includes(item.state),
    );
    if (!hasActiveWork) return undefined;
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [activity, refresh]);

  const available = useMemo<AvailableProduct[]>(() => {
    if (!catalog) return [];
    const search = normalize(query);
    return catalog.products
      .map((product) => ({ descriptor: product.descriptor, release: newestRelease(product) }))
      .filter(({ descriptor }) => {
        if (!search) return true;
        return normalize(`${descriptor.displayName} ${descriptor.summary} ${descriptor.pluginId} ${descriptor.categories.join(' ')}`).includes(search);
      });
  }, [catalog, query]);

  const updates = useMemo(() => {
    if (!catalog) return [];
    return installedPlugins.flatMap((installed) => {
      const product = catalog.products.find((candidate) => candidate.descriptor.pluginId === installed.pluginId);
      if (!product) return [];
      const target = newestRelease(product);
      return target.version === installed.version ? [] : [{ installed, descriptor: product.descriptor, target }];
    });
  }, [catalog, installedPlugins]);

  const managerCanPlan = Boolean(manager?.available && manager.capability && manager.capability.state !== 'unavailable');

  const submitInstall = async () => {
    if (!pendingInstall || !canManage || !managerCanPlan) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await createPluginInstallation({
        pluginId: pendingInstall.product.descriptor.pluginId,
        release: pendingInstall.product.release.release,
        source: 'connected_registry',
        operation: pendingInstall.operation,
        fromVersion: pendingInstall.fromVersion,
        currentEnabled: pendingInstall.currentEnabled,
        deploymentMode: pendingInstall.deploymentMode,
        expectedPlatformRevision: platformRevision,
        idempotencyKey: `plugin-manager-ui-${crypto.randomUUID()}`,
      });
      setPendingInstall(null);
      setPage(1);
      await refresh();
      setSelectedInstallation({
        intent,
        state: 'requested',
        reasonCode: 'none',
        revision: 0,
        review: null,
        approval: null,
        latestObservation: null,
        updatedAt: intent.requestedAt,
      });
    } catch {
      setError('The installation request was not accepted. Refresh the manager state and try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitManualInstall = async () => {
    if (!pendingManualInstall || !canManage || !managerCanPlan) return;
    setBusy(true);
    setError(null);
    try {
      await createPluginInstallation({
        ...pendingManualInstall,
        expectedPlatformRevision: platformRevision,
        idempotencyKey: `plugin-manager-ui-${crypto.randomUUID()}`,
      });
      setPendingManualInstall(null);
      setPage(1);
      await refresh();
    } catch {
      setError('The installation request was not accepted. Check the immutable release, local delivery and manager configuration.');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    const review = selectedInstallation?.review;
    if (!selectedInstallation || !review || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      await decidePluginInstallation({
        installationId: selectedInstallation.intent.installationId,
        decision,
        reviewSha256: review.reviewSha256,
        planSha256: review.planSha256,
        expectedRevision: selectedInstallation.revision,
      });
      setSelectedInstallation(null);
      await refresh();
    } catch {
      setError('The review changed or expired. Refresh the activity and approve the current plan.');
    } finally {
      setBusy(false);
    }
  };

  const recover = async (item: PluginInstallationSummaryV1, action: 'cancel' | 'retry') => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      await recoverPluginInstallation({
        installationId: item.intent.installationId,
        action,
        expectedRevision: item.revision,
      });
      setSelectedInstallation(null);
      await refresh();
    } catch {
      setError('The recovery action was not accepted. Refresh the installation state and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="eg-plugin-manager" aria-labelledby="plugin-lifecycle-title">
      <div className="eg-plugin-management__section-header">
        <div>
          <h3 id="plugin-lifecycle-title">Plugin lifecycle</h3>
          <p>Discover, review and install signed plugins through the customer-local Plugin Manager.</p>
        </div>
        <Button kind="ghost" size="sm" renderIcon={Renew} disabled={loading || busy} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {error && (
        <InlineNotification kind="error" title="Plugin Manager error" subtitle={error} lowContrast onCloseButtonClick={() => setError(null)} />
      )}
      <ManagerAvailability status={manager} />

      <Tabs>
        <TabList aria-label="Plugin lifecycle sections" contained>
          <Tab>Available</Tab>
          <Tab>Installed</Tab>
          <Tab>Updates</Tab>
          <Tab>Installation activity</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="eg-plugin-manager__panel">
              <div className="eg-plugin-manager__panel-toolbar">
                <CarbonSearch
                  id="plugin-catalog-search"
                  size="md"
                  labelText="Search available plugins"
                  placeholder="Search plugins"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className="eg-plugin-manager__toolbar-actions">
                  <Button kind="tertiary" renderIcon={Add} disabled={!canManage || !managerCanPlan} onClick={() => setPendingManualInstall({ source: 'connected_registry', pluginId: '', release: '', deploymentMode: manager?.capability?.deploymentModes[0] ?? 'compose_planner' })}>
                    Add from registry
                  </Button>
                  <Button kind="tertiary" renderIcon={Upload} disabled={!canManage || !managerCanPlan} onClick={() => setPendingManualInstall({ source: 'offline_delivery', pluginId: '', release: '', deploymentMode: manager?.capability?.deploymentModes[0] ?? 'compose_planner' })}>
                    Add offline delivery
                  </Button>
                </div>
              </div>
              {loading ? (
                <InlineLoading description="Loading available plugins" />
              ) : !catalog ? (
                <InlineNotification kind="info" title="No catalog configured" subtitle="Configure a signed static catalog or manager registry source to discover plugins." hideCloseButton lowContrast />
              ) : available.length === 0 ? (
                <InlineNotification kind="info" title="No matching plugins" subtitle="Try another name, category or plugin ID." hideCloseButton lowContrast />
              ) : (
                <TableContainer className="eg-plugin-management__table">
                  <Table aria-label="Available plugins" size="md" useZebraStyles>
                    <TableHead><TableRow>
                      <TableHeader>Plugin</TableHeader><TableHeader>Publisher</TableHeader><TableHeader>Release</TableHeader><TableHeader>Deployment</TableHeader><TableHeader>Commercial access</TableHeader><TableHeader>Action</TableHeader>
                    </TableRow></TableHead>
                    <TableBody>{available.map((product) => (
                      <TableRow key={product.descriptor.pluginId}>
                        <TableCell><strong>{product.descriptor.displayName}</strong><span className="eg-plugin-management__meta">{product.descriptor.summary}</span><code className="eg-plugin-management__plugin-id">{product.descriptor.pluginId}</code></TableCell>
                        <TableCell>{product.descriptor.publisher.displayName}<span className="eg-plugin-management__meta">{product.descriptor.publisher.verification.replace(/_/g, ' ')}</span></TableCell>
                        <TableCell>{product.release.version}<span className="eg-plugin-management__meta">{product.release.channel} · {product.release.state}</span></TableCell>
                        <TableCell>{product.descriptor.deploymentModes.map((mode) => mode.replace(/_/g, ' ')).join(', ')}<span className="eg-plugin-management__meta">{product.descriptor.architectures.join(', ')}</span></TableCell>
                        <TableCell><Tag type={product.descriptor.commercialAction === 'entitled' ? 'green' : 'blue'}>{product.descriptor.commercialAction}</Tag></TableCell>
                        <TableCell><Button size="sm" disabled={!canManage || !managerCanPlan || product.release.state !== 'available'} onClick={() => setPendingInstall({ product, deploymentMode: product.descriptor.deploymentModes[0], operation: 'install' })}>Review and add</Button></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </TableContainer>
              )}
            </div>
          </TabPanel>
          <TabPanel><div className="eg-plugin-manager__panel">{installedContent}</div></TabPanel>
          <TabPanel>
            <div className="eg-plugin-manager__panel">
              {loading ? <InlineLoading description="Checking plugin updates" /> : updates.length === 0 ? (
                <InlineNotification kind="success" title="Installed plugins are current" subtitle="No newer catalog release is available for the installed plugins." hideCloseButton lowContrast />
              ) : (
                <TableContainer className="eg-plugin-management__table"><Table aria-label="Plugin updates" size="md" useZebraStyles>
                  <TableHead><TableRow><TableHeader>Plugin</TableHeader><TableHeader>Installed</TableHeader><TableHeader>Available</TableHeader><TableHeader>Status</TableHeader><TableHeader>Action</TableHeader></TableRow></TableHead>
                  <TableBody>{updates.map((update) => <TableRow key={update.installed.pluginId}>
                    <TableCell><strong>{update.descriptor.displayName}</strong><code className="eg-plugin-management__plugin-id">{update.installed.pluginId}</code></TableCell>
                    <TableCell>{update.installed.version}</TableCell><TableCell>{update.target.version}</TableCell><TableCell><Tag type={update.target.state === 'available' ? 'blue' : 'red'}>{update.target.state}</Tag></TableCell>
                    <TableCell><Button size="sm" disabled={!canManage || !managerCanPlan || update.target.state !== 'available' || !manager?.capability?.operations.includes('upgrade')} onClick={() => setPendingInstall({ product: { descriptor: update.descriptor, release: update.target }, deploymentMode: update.descriptor.deploymentModes[0], operation: 'upgrade', fromVersion: update.installed.version, currentEnabled: update.installed.enabled })}>Review update</Button></TableCell>
                  </TableRow>)}</TableBody>
                </Table></TableContainer>
              )}
            </div>
          </TabPanel>
          <TabPanel>
            <div className="eg-plugin-manager__panel">
              {loading ? <InlineLoading description="Loading installation activity" /> : activity.length === 0 ? (
                <InlineNotification kind="info" title="No installation activity" subtitle="Requests and safe lifecycle progress will appear here." hideCloseButton lowContrast />
              ) : (
                <>
                  <TableContainer className="eg-plugin-management__table"><Table aria-label="Installation activity" size="md" useZebraStyles>
                    <TableHead><TableRow><TableHeader>Plugin</TableHeader><TableHeader>Requested</TableHeader><TableHeader>Status</TableHeader><TableHeader>Reason</TableHeader><TableHeader>Action</TableHeader></TableRow></TableHead>
                    <TableBody>{activity.map((item) => <TableRow key={item.intent.installationId}>
                      <TableCell><strong>{item.intent.pluginId}</strong><code className="eg-plugin-management__plugin-id">{item.intent.installationId}</code></TableCell>
                      <TableCell>{new Date(item.intent.requestedAt).toLocaleString()}<span className="eg-plugin-management__meta">{item.intent.deploymentMode.replace(/_/g, ' ')}</span></TableCell>
                      <TableCell>{stateTag(item.state)}<span className="eg-plugin-management__meta">Revision {item.revision}</span></TableCell>
                      <TableCell>{item.reasonCode.replace(/_/g, ' ')}</TableCell>
                      <TableCell><div className="eg-plugin-manager__row-actions"><Button kind="ghost" size="sm" onClick={() => setSelectedInstallation(item)}>{item.review ? 'Review details' : 'View details'}</Button>{['failed', 'manual_intervention'].includes(item.state) && <Button kind="ghost" size="sm" disabled={!canManage || busy} onClick={() => void recover(item, 'retry')}>Retry</Button>}{['requested', 'awaiting_approval'].includes(item.state) && <Button kind="danger--ghost" size="sm" disabled={!canManage || busy} onClick={() => void recover(item, 'cancel')}>Cancel</Button>}</div></TableCell>
                    </TableRow>)}</TableBody>
                  </Table></TableContainer>
                  <Pagination page={page} pageSize={pageSize} pageSizes={ACTIVITY_PAGE_SIZES} totalItems={activityTotal} itemsPerPageText="Items per page" onChange={({ page: nextPage, pageSize: nextPageSize }) => { setPage(nextPage); setPageSize(nextPageSize); }} />
                </>
              )}
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Modal open={pendingInstall !== null} modalHeading={pendingInstall ? `${pendingInstall.operation === 'upgrade' ? 'Update' : 'Add'} ${pendingInstall.product.descriptor.displayName}` : 'Add plugin'} primaryButtonText="Create review" secondaryButtonText="Cancel" primaryButtonDisabled={busy || !managerCanPlan || !canManage} onRequestClose={() => !busy && setPendingInstall(null)} onRequestSubmit={() => void submitInstall()}>
        {pendingInstall && <div className="eg-plugin-manager__install-form">
          <InlineNotification kind="info" title="No deployment changes yet" subtitle="The local manager will verify this immutable release and prepare an exact plan for your approval." hideCloseButton lowContrast />
          <dl className="eg-plugin-manager__summary-list"><div><dt>Plugin</dt><dd>{pendingInstall.product.descriptor.pluginId}</dd></div>{pendingInstall.fromVersion && <div><dt>Installed</dt><dd>{pendingInstall.fromVersion}</dd></div>}<div><dt>{pendingInstall.operation === 'upgrade' ? 'Target' : 'Version'}</dt><dd>{pendingInstall.product.release.version}</dd></div><div><dt>Release</dt><dd><code>{pendingInstall.product.release.release}</code></dd></div></dl>
          <Select id="plugin-deployment-mode" labelText="Deployment mode" value={pendingInstall.deploymentMode} onChange={(event) => setPendingInstall((current) => current ? { ...current, deploymentMode: event.target.value as PendingInstall['deploymentMode'] } : current)}>
            {pendingInstall.product.descriptor.deploymentModes.map((mode) => <SelectItem key={mode} value={mode} text={mode.replace(/_/g, ' ')} />)}
          </Select>
          {busy && <InlineLoading description="Creating installation review" />}
        </div>}
      </Modal>

      <Modal open={pendingManualInstall !== null} modalHeading={pendingManualInstall?.source === 'offline_delivery' ? 'Add offline delivery' : 'Add from connected registry'} primaryButtonText="Create review" secondaryButtonText="Cancel" primaryButtonDisabled={busy || !pendingManualInstall?.pluginId.trim() || !/^\S+@sha256:[a-f0-9]{64}$/.test(pendingManualInstall?.release ?? '')} onRequestClose={() => !busy && setPendingManualInstall(null)} onRequestSubmit={() => void submitManualInstall()}>
        {pendingManualInstall && <div className="eg-plugin-manager__install-form">
          <InlineNotification kind="info" title={pendingManualInstall.source === 'offline_delivery' ? 'Transfer the delivery locally first' : 'Registry access stays in the local manager'} subtitle={pendingManualInstall.source === 'offline_delivery' ? 'Place the verified delivery in the manager intake directory. The browser uploads no archive bytes.' : 'Enter only an immutable release reference. Registry credentials, proxy settings and private CAs never enter the browser or backend.'} hideCloseButton lowContrast />
          <TextInput id="manual-plugin-id" labelText="Plugin ID" placeholder="io.enterpriseglue.plugin-name" value={pendingManualInstall.pluginId} onChange={(event) => setPendingManualInstall((current) => current ? { ...current, pluginId: event.target.value } : current)} />
          <TextInput id="manual-plugin-release" labelText="Immutable release reference" helperText="Use registry/repository@sha256:<64 lowercase hexadecimal characters>." placeholder="registry.example/plugins/release@sha256:…" value={pendingManualInstall.release} onChange={(event) => setPendingManualInstall((current) => current ? { ...current, release: event.target.value.trim() } : current)} />
          <Select id="manual-deployment-mode" labelText="Deployment mode" value={pendingManualInstall.deploymentMode} onChange={(event) => setPendingManualInstall((current) => current ? { ...current, deploymentMode: event.target.value as PendingManualInstall['deploymentMode'] } : current)}>
            {(manager?.capability?.deploymentModes ?? ['compose_planner']).map((mode) => <SelectItem key={mode} value={mode} text={mode.replace(/_/g, ' ')} />)}
          </Select>
          {busy && <InlineLoading description="Creating installation review" />}
        </div>}
      </Modal>

      <Modal open={selectedInstallation !== null} modalHeading={selectedInstallation?.review ? `Review ${selectedInstallation.intent.pluginId}` : `Installation ${selectedInstallation?.intent.pluginId ?? ''}`} primaryButtonText={selectedInstallation?.review?.approvable ? 'Approve exact plan' : 'Close'} secondaryButtonText={selectedInstallation?.review?.approvable ? 'Reject' : undefined} primaryButtonDisabled={busy} onSecondarySubmit={() => void decide('reject')} onRequestClose={() => !busy && setSelectedInstallation(null)} onRequestSubmit={() => selectedInstallation?.review?.approvable ? void decide('approve') : setSelectedInstallation(null)}>
        {selectedInstallation && <div className="eg-plugin-manager__review">
          <div className="eg-plugin-manager__review-heading"><div>{stateTag(selectedInstallation.state)}<span className="eg-plugin-management__meta">Updated {new Date(selectedInstallation.updatedAt).toLocaleString()}</span></div>{selectedInstallation.reasonCode !== 'none' && <code>{selectedInstallation.reasonCode}</code>}</div>
          {selectedInstallation.review ? <>
            <InlineNotification kind={selectedInstallation.review.approvable ? 'info' : 'error'} title={selectedInstallation.review.approvable ? 'Review the exact verified plan' : 'This plan cannot be approved'} subtitle="Approval is bound to the review and plan digests below. A changed plan requires a new approval." hideCloseButton lowContrast />
            <Accordion>
              <ReviewFinding title="1. Identity and immutable release" finding={selectedInstallation.review.identity} />
              <ReviewFinding title="2. Compatibility" finding={selectedInstallation.review.compatibility} />
              <ReviewFinding title="3. Permissions and data access" finding={selectedInstallation.review.permissionsAndData} />
              <ReviewFinding title="4. Network, resources, configuration and secrets" finding={selectedInstallation.review.infrastructure} />
              <ReviewFinding title="5. Migration, backup, rollback and downtime" finding={selectedInstallation.review.migrationAndRollback} />
              <ReviewFinding title="6. Entitlement and support" finding={selectedInstallation.review.entitlement} />
              <AccordionItem title="7. Final digest approval"><div className="eg-plugin-manager__review-finding"><dl className="eg-plugin-manager__summary-list"><div><dt>Review digest</dt><dd><code>{selectedInstallation.review.reviewSha256}</code></dd></div><div><dt>Plan digest</dt><dd><code>{selectedInstallation.review.planSha256}</code></dd></div><div><dt>Expires</dt><dd>{new Date(selectedInstallation.review.expiresAt).toLocaleString()}</dd></div><div><dt>Rollback</dt><dd>{selectedInstallation.review.rollbackClass.replace(/_/g, ' ')}</dd></div><div><dt>Entitlement</dt><dd>{selectedInstallation.review.entitlementState.replace(/_/g, ' ')}</dd></div></dl></div></AccordionItem>
            </Accordion>
          </> : <InlineNotification kind="info" title="Planning is in progress" subtitle="The manager is verifying identity, compatibility, artifacts, permissions and rollback prerequisites." hideCloseButton lowContrast />}
          {busy && <InlineLoading description="Recording approval" />}
        </div>}
      </Modal>
    </section>
  );
}
