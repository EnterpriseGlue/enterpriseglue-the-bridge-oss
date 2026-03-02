import React from 'react'
import { useLocation } from 'react-router-dom'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import {
  Button,
  InlineNotification,
  Dropdown,
  Checkbox,
  ComboBox,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Modal,
  TextInput,
  Tag,
  OverflowMenu,
  OverflowMenuItem,
} from '@carbon/react'
import { Information, TrashCan, Undo, Reset, MagicWand } from '@carbon/icons-react'
import { ExecutionOptionsPanel } from '../../../shared/components/ExecutionOptionsPanel'
import { ApplyMigrationModal } from './ApplyMigrationModal'
import { BpmnViewerWithBadges } from '../../../shared/components/viewer/BpmnViewerWithBadges'
import type { BadgeConfig } from '../../../shared/components/viewer/BpmnViewerWithBadges'
import styles from './MigrationWizard.module.css'
import { useMigrationData } from '../hooks'
import { typeCategory, toHumanName, parseActivities, normalizeName } from '../utils'

const MIGRATION_SESSION_KEY = 'migration-wizard-state'

function loadMigrationSession(): { instanceIds: string[]; selectedKey?: string; selectedVersion?: number } {
  try {
    const raw = sessionStorage.getItem(MIGRATION_SESSION_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { instanceIds: [] }
}

function saveMigrationSession(data: { instanceIds: string[]; selectedKey?: string; selectedVersion?: number }) {
  try { sessionStorage.setItem(MIGRATION_SESSION_KEY, JSON.stringify(data)) } catch {}
}

export default function MigrationWizard() {
  const { tenantNavigate, tenantSlug, navigate } = useTenantNavigate()
  const location = useLocation()
  const { state }: any = location
  const [statusInfoOpen, setStatusInfoOpen] = React.useState(false)
  const [reviewModalOpen, setReviewModalOpen] = React.useState(false)

  // Redirect to tenant-prefixed route if at root level
  React.useEffect(() => {
    if (!tenantSlug && !location.pathname.startsWith('/t/')) {
      navigate('/t/default/mission-control/migration/new', { replace: true, state })
    }
  }, [tenantSlug, location.pathname, state, navigate])

  // Coerce version to a valid number or undefined
  const toVersion = (v: any): number | undefined => {
    if (v == null) return undefined
    const n = Number(v)
    return isNaN(n) ? undefined : n
  }

  // Persist navigation state in sessionStorage so it survives page refresh
  const { instanceIds, preselectedKey, preselectedVersion } = React.useMemo(() => {
    if (state?.instanceIds?.length) {
      const data = {
        instanceIds: state.instanceIds as string[],
        selectedKey: state.selectedKey as string | undefined,
        selectedVersion: toVersion(state.selectedVersion),
      }
      saveMigrationSession(data)
      return {
        instanceIds: data.instanceIds,
        preselectedKey: data.selectedKey,
        preselectedVersion: data.selectedVersion,
      }
    }
    const saved = loadMigrationSession()
    return {
      instanceIds: saved.instanceIds || [],
      preselectedKey: saved.selectedKey,
      preselectedVersion: toVersion(saved.selectedVersion),
    }
  }, [state])

  // Use extracted data hook
  const migrationData = useMigrationData({ instanceIds, preselectedKey, preselectedVersion })
  const {
    sourceXmlQ,
    targetXmlQ,
    activeCountsQ,
    previewQ,
    validateMutation,
    executeMutation,
    executeDirectMutation,
    processItems,
    versionsForKey,
    basePlan,
    plan,
    planInstructions,
    activeSet,
    targetPlannedCounts,
    varsObj,
    lockSource,
    generating,
    srcKey,
    setSrcKey,
    srcVer,
    setSrcVer,
    tgtKey,
    setTgtKey,
    tgtVer,
    setTgtVer,
    updateEventTriggers,
    setUpdateEventTriggers,
    setPlan,
    validation,
    setValidation,
    overrides,
    setOverrides,
    triggerOverrides,
    setTriggerOverrides,
    removed,
    setRemoved,
    showErrorsOnly,
    setShowErrorsOnly,
    showWarningsOnly,
    setShowWarningsOnly,
    showIncompatibleTargets,
    setShowIncompatibleTargets,
    showOnlyMapped,
    setShowOnlyMapped,
    showOnlyUnmapped,
    setShowOnlyUnmapped,
    showActiveOnly,
    setShowActiveOnly,
    varsOpen,
    setVarsOpen,
    varRows,
    setVarRows,
    skipCustomListeners,
    setSkipCustomListeners,
    skipIoMappings,
    setSkipIoMappings,
    pinnedIdx,
    setPinnedIdx,
  } = migrationData

  // Diagram control APIs
  const srcViewerApi = React.useRef<any>(null)
  const tgtViewerApi = React.useRef<any>(null)

  // Parse activities from XML
  const targetActivities = React.useMemo(() => {
    const arr = parseActivities((targetXmlQ.data as any) || null)
    arr.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    return arr
  }, [targetXmlQ.data])

  const sourceActivities = React.useMemo(() => {
    const arr = parseActivities((sourceXmlQ.data as any) || null)
    const map = new Map<string, { name?: string; type: string }>()
    arr.forEach((a) => map.set(a.id, { name: a.name, type: a.type }))
    return map
  }, [sourceXmlQ.data])

  // Declarative badge arrays for BpmnViewerWithBadges
  const sourceBadges: BadgeConfig[] = React.useMemo(() => {
    const counts: Record<string, number> = (activeCountsQ.data as any) || {}
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([activityId, count]) => ({ activityId, count, state: 'active' as const }))
  }, [activeCountsQ.data])

  const targetBadges: BadgeConfig[] = React.useMemo(() => {
    return Object.entries(targetPlannedCounts)
      .filter(([, count]) => count > 0)
      .map(([activityId, count]) => ({
        activityId,
        count: `+${count}`,
        customStyle: { backgroundColor: '#0f62fe', color: '#ffffff' },
      }))
  }, [targetPlannedCounts])

  // Name normalizer for auto-mapping
  const norm = React.useCallback((s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim(), [])

  // Target name→id lookup for auto-map
  const targetNameToId = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const a of targetActivities) {
      const key = norm(a.name || a.id)
      if (key && !map.has(key)) map.set(key, a.id)
    }
    return map
  }, [targetActivities, norm])

  // Per-row auto-map: find matching target by normalized name
  const autoMapRow = React.useCallback((idx: number) => {
    if (!basePlan) return
    const instructions: any[] = Array.isArray((basePlan as any)?.instructions) ? (basePlan as any).instructions : []
    const ins = instructions[idx]
    if (!ins) return
    const srcId = Array.isArray(ins?.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
    if (!srcId) return
    const srcMeta = sourceActivities.get(srcId)
    const match = targetNameToId.get(norm(srcMeta?.name || srcId))
    if (match) setOverrides(prev => ({ ...prev, [idx]: match }))
  }, [basePlan, sourceActivities, targetNameToId, norm])

  // Reusable auto-map all (by functional name within type category)
  const runAutoMap = React.useCallback(() => {
    if (!basePlan) return
    const next: Record<number, string> = {}
    const instructions: any[] = Array.isArray((basePlan as any)?.instructions) ? (basePlan as any).instructions : []
    for (let idx = 0; idx < instructions.length; idx++) {
      const ins = instructions[idx]
      if (ins?.targetActivityId) continue // already suggested by engine
      const srcId = Array.isArray(ins?.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
      if (!srcId) continue
      const srcMeta = sourceActivities.get(srcId)
      const match = targetNameToId.get(norm(srcMeta?.name || srcId))
      if (match) next[idx] = match
    }
    if (Object.keys(next).length > 0) setOverrides(prev => ({ ...prev, ...next }))
  }, [basePlan, sourceActivities, targetNameToId, norm])

  // Per-row reset: clear override, trigger override, and removed state for a single row
  const resetRow = React.useCallback((idx: number) => {
    setOverrides(prev => { const next = { ...prev }; delete next[idx]; return next })
    setTriggerOverrides(prev => { const next = { ...prev }; delete next[idx]; return next })
    setRemoved(prev => { const next = { ...prev }; delete next[idx]; return next })
  }, [])

  // Auto-map by functional name when engine plan lacks targets
  React.useEffect(() => {
    if (!basePlan) return
    if (targetActivities.length === 0 || sourceActivities.size === 0) return
    runAutoMap()
  }, [basePlan, targetActivities, sourceActivities, runAutoMap])

  // Count visible mapped instructions (same filter logic as the table rows)
  const visibleMappedCount = React.useMemo(() => {
    let count = 0
    for (let idx = 0; idx < planInstructions.length; idx++) {
      const ins = planInstructions[idx]
      const isExcluded = !!removed[idx]
      const baseTgt = ins?.targetActivityId ?? (Array.isArray(ins?.targetActivityIds) ? ins.targetActivityIds[0] : undefined)
      const tgtId = overrides[idx] || baseTgt
      const mapped = !!tgtId
      const srcId = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
      const isActive = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds.some((sid: string) => activeSet.has(sid)) : false
      if (showActiveOnly && !isActive) continue
      if (showOnlyMapped && !mapped && !isExcluded) continue
      if (showOnlyUnmapped && (mapped || isExcluded)) continue
      if (mapped && !isExcluded) count++
    }
    return count
  }, [planInstructions, removed, overrides, activeSet, showActiveOnly, showOnlyMapped, showOnlyUnmapped])

  // Gated Review & Execute: validate first, open modal only if clean
  const handleReviewAndExecute = React.useCallback(async () => {
    try {
      const data = await validateMutation.mutateAsync()
      const reports: any[] = data?.instructionReports || []
      const hasIssues = reports.some((rep: any) => (rep?.failures?.length || 0) > 0 || (rep?.warnings?.length || 0) > 0)
      if (hasIssues) {
        setValidation(data)
      } else {
        setValidation(null)
        setReviewModalOpen(true)
      }
    } catch {
      // error already handled by onError in the mutation
    }
  }, [validateMutation, setValidation])

  return (
    <div style={{ padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-4)' }}>

      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-3)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', columnGap: 'var(--spacing-3)', alignItems: 'end' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', columnGap: 'var(--spacing-2)', alignItems: 'end' }}>
            <ComboBox
              id="src-key"
              titleText="Source Process"
              placeholder="Select source process"
              items={processItems}
              itemToString={(it: any) => it?.label || ''}
              selectedItem={processItems.find(p => p.key === srcKey) || null}
              disabled={lockSource}
              onChange={({ selectedItem }: any) => {
                const val = selectedItem?.key
                setSrcKey(val); setSrcVer(undefined); setPlan(null); setValidation(null)
              }}
            />
            <Dropdown
              id="src-ver"
              titleText="Version"
              label={srcVer != null ? String(srcVer) : 'Select source version'}
              items={versionsForKey(srcKey) as any}
              itemToString={(it: any) => (it != null ? String(it) : '')}
              selectedItem={srcVer as any}
              disabled={lockSource}
              onChange={({ selectedItem }: any) => {
                if (selectedItem == null) return
                const val = typeof selectedItem === 'number' ? selectedItem : Number(selectedItem)
                if (!isNaN(val) && val > 0) { setSrcVer(val); setPlan(null); setValidation(null) }
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', columnGap: 'var(--spacing-2)', alignItems: 'end' }}>
            <ComboBox
              id="tgt-key"
              titleText="Target Process"
              placeholder="Select target process"
              items={processItems}
              itemToString={(it: any) => it?.label || ''}
              selectedItem={processItems.find(p => p.key === tgtKey) || null}
              onChange={({ selectedItem }: any) => {
                const val = selectedItem?.key
                setTgtKey(val); setTgtVer(undefined); setPlan(null); setValidation(null)
              }}
            />
            <Dropdown
              id="tgt-ver"
              titleText="Version"
              label={tgtVer != null ? String(tgtVer) : 'Select target version'}
              items={versionsForKey(tgtKey) as any}
              itemToString={(it: any) => (it != null ? String(it) : '')}
              selectedItem={tgtVer as any}
              onChange={({ selectedItem }: any) => {
                if (selectedItem == null) return
                const val = typeof selectedItem === 'number' ? selectedItem : Number(selectedItem)
                if (!isNaN(val) && val > 0) { setTgtVer(val); setPlan(null); setValidation(null) }
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--spacing-2)', alignItems: 'stretch', height: 400 }}>
          <div style={{ border: '1px solid var(--color-border-primary)', position: 'relative' }}>
            {!sourceXmlQ.data && srcKey && srcVer ? (
              <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading source...</div>
            ) : sourceXmlQ.data ? (
              <BpmnViewerWithBadges
                xml={(sourceXmlQ.data as any) || ''}
                badges={sourceBadges}
                onReady={(api) => { srcViewerApi.current = api; try { api.fitViewport() } catch {} }}
              />
            ) : (
              <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Select source process and version</div>
            )}
          </div>
          <div style={{ border: '1px solid var(--color-border-primary)', position: 'relative' }}>
            {!targetXmlQ.data && tgtKey && tgtVer ? (
              <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading target...</div>
            ) : targetXmlQ.data ? (
              <BpmnViewerWithBadges
                xml={(targetXmlQ.data as any) || ''}
                badges={targetBadges}
                onReady={(api) => { tgtViewerApi.current = api; try { api.fitViewport() } catch {} }}
              />
            ) : (
              <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Select target process and version</div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.mappingSection} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Mapping</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
            <OverflowMenu size="sm" flipped ariaLabel="Filter options" menuOptionsClass="migration-filter-menu">
              <OverflowMenuItem itemText={`${showActiveOnly ? '✓ ' : ''}Show only active`} onClick={() => setShowActiveOnly(v => !v)} />
              <OverflowMenuItem itemText={`${showIncompatibleTargets ? '✓ ' : ''}Show incompatible targets`} onClick={() => setShowIncompatibleTargets(v => !v)} />
              <OverflowMenuItem itemText={`${showOnlyMapped ? '✓ ' : ''}Show only mapped`} onClick={() => { setShowOnlyMapped(v => { if (!v) setShowOnlyUnmapped(false); return !v }) }} />
              <OverflowMenuItem itemText={`${showOnlyUnmapped ? '✓ ' : ''}Show only unmapped`} onClick={() => { setShowOnlyUnmapped(v => { if (!v) setShowOnlyMapped(false); return !v }) }} />
            </OverflowMenu>
            <Button size="sm" kind="ghost" onClick={runAutoMap}>Auto map</Button>
            <Button size="sm" kind="ghost" onClick={() => { setOverrides({}); setTriggerOverrides({}); setRemoved({}) }}>Reset</Button>
          </div>
        </div>
        {(plan && targetXmlQ.status === 'success' && sourceXmlQ.status === 'success') ? (
        <div className={styles.mappingTable}>
        <Table size="sm">
          <TableHead>
            <TableRow>
              <TableHeader>Source elements</TableHeader>
              <TableHeader>Target elements</TableHeader>
              <TableHeader>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Status
                  <button
                    type="button"
                    onClick={() => setStatusInfoOpen(true)}
                    title="Learn about mapping statuses"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-tertiary)', lineHeight: 0 }}
                  >
                    <Information size={14} />
                  </button>
                </span>
              </TableHeader>
              <TableHeader style={{ width: '80px' }}>Actions</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {planInstructions.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}><InlineNotification lowContrast kind="info" title="No instructions returned by engine" /></TableCell>
              </TableRow>
            )}
            {planInstructions.map((ins: any, idx: number) => {
                const isExcluded = !!removed[idx]
                const baseTgt = (ins as any).targetActivityId ?? (Array.isArray((ins as any).targetActivityIds) ? (ins as any).targetActivityIds[0] : undefined)
                const tgtId = overrides[idx] || baseTgt
                const mapped = !!tgtId
                const status: 'Auto'|'Manual'|'Unmapped'|'Excluded' = isExcluded
                  ? 'Excluded'
                  : (!mapped)
                    ? 'Unmapped'
                    : (overrides[idx] && baseTgt && overrides[idx] !== baseTgt)
                      ? 'Manual'
                      : 'Auto'
                const srcId = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
                const srcType = srcId ? sourceActivities.get(srcId)?.type : undefined
                const srcCat = srcType ? typeCategory(srcType) : undefined
                const isActive = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds.some((sid: string) => activeSet.has(sid)) : false
                if (showActiveOnly && !isActive) return null
                if (showOnlyMapped && !mapped && !isExcluded) return null
                if (showOnlyUnmapped && (mapped || isExcluded)) return null
                const items = targetActivities
                  .map(a => ({ id: a.id, label: (a.name && a.name.trim()) ? a.name : toHumanName(a.id), type: a.type }))
                const selectedItem = tgtId ? items.find(i => i.id === tgtId) : undefined
                const meta = srcId ? sourceActivities.get(srcId) : undefined
                const srcName = (meta?.name || '').trim()
                const srcLabel = srcName ? srcName : (srcId ? toHumanName(srcId) : ins.sourceActivityIds.join(', '))
                const isManualOverride = status === 'Manual'
                const rowStyle: React.CSSProperties = isExcluded
                  ? { opacity: 0.5, textDecoration: 'line-through' }
                  : status === 'Unmapped' && isActive
                    ? { backgroundColor: 'var(--cds-support-warning, #f1c21b)11' }
                    : {}
                return (
                  <TableRow
                    key={idx}
                    style={rowStyle}
                    onMouseEnter={() => {
                      if (isExcluded) return
                      const sApi = srcViewerApi.current
                      const tApi = tgtViewerApi.current
                      try { sApi?.clearHighlights() } catch {}
                      try { tApi?.clearHighlights() } catch {}
                      if (srcId && sApi) { sApi.focus(srcId); sApi.highlightSrc(srcId) }
                      if (tgtId && tApi) { tApi.focus(tgtId); tApi.highlightTgt(tgtId) }
                    }}
                    onMouseLeave={() => {
                      if (pinnedIdx !== idx) {
                        try { srcViewerApi.current?.clearHighlights() } catch {}
                        try { tgtViewerApi.current?.clearHighlights() } catch {}
                      }
                    }}
                    onClick={() => !isExcluded && setPinnedIdx(p => p === idx ? null : idx)}
                  >
                    <TableCell>{srcLabel}</TableCell>
                    <TableCell>
                      {isExcluded ? (
                        <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Excluded from migration</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
                          <ComboBox
                            id={`tgt-${idx}`}
                            items={items}
                            selectedItem={selectedItem}
                            itemToString={(it: any) => it ? it.label : ''}
                            placeholder="Target element"
                            onChange={({ selectedItem }: any) => setOverrides((prev) => ({ ...prev, [idx]: selectedItem?.id }))}
                          />
                          {srcCat === 'event' && (
                            <Checkbox
                              id={`trg-${idx}`}
                              labelText="Recreate event"
                              checked={triggerOverrides.hasOwnProperty(String(idx)) ? !!triggerOverrides[idx] : !!(ins as any)?.updateEventTrigger}
                              onChange={(evt, data) => setTriggerOverrides(prev => ({ ...prev, [idx]: !!data.checked }))}
                            />
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {status === 'Excluded' ? (
                        <Tag size="sm" type="gray">Excluded</Tag>
                      ) : status === 'Unmapped' ? (
                        <Tag size="sm" type="red">Unmapped</Tag>
                      ) : status === 'Manual' ? (
                        <Tag size="sm" type="blue">Manual</Tag>
                      ) : (
                        <Tag size="sm" type="green">Auto</Tag>
                      )}
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'center', justifyContent: 'flex-end' }}>
                        {isExcluded ? (
                          <Button
                            size="sm"
                            kind="ghost"
                            hasIconOnly
                            renderIcon={Undo}
                            iconDescription="Restore this instruction"
                            tooltipPosition="left"
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setRemoved(prev => { const next = { ...prev }; delete next[idx]; return next }) }}
                          />
                        ) : (
                          <>
                            {!mapped && (
                              <Button
                                size="sm"
                                kind="ghost"
                                hasIconOnly
                                renderIcon={MagicWand}
                                iconDescription="Auto-map by name"
                                tooltipPosition="left"
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); autoMapRow(idx) }}
                              />
                            )}
                            {(isManualOverride || triggerOverrides.hasOwnProperty(String(idx))) && (
                              <Button
                                size="sm"
                                kind="ghost"
                                hasIconOnly
                                renderIcon={Reset}
                                iconDescription="Reset row to original"
                                tooltipPosition="left"
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); resetRow(idx) }}
                              />
                            )}
                            <Button
                              size="sm"
                              kind="ghost"
                              hasIconOnly
                              renderIcon={TrashCan}
                              iconDescription="Exclude from migration plan"
                              tooltipPosition="left"
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setRemoved(prev => ({ ...prev, [idx]: true })) }}
                            />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
            })}
          </TableBody>
        </Table>
        </div>
        ) : null}
      </div>

      {validation && (() => {
        const reports: any[] = validation?.instructionReports || []
        const errorCount = reports.reduce((sum: number, rep: any) => sum + (rep?.failures?.length || 0), 0)
        const warningCount = reports.reduce((sum: number, rep: any) => sum + (rep?.warnings?.length || 0), 0)
        if (errorCount === 0 && warningCount === 0) return null
        return (
          <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>Validation Issues</span>
                {errorCount > 0 && (
                  <Tag
                    size="sm"
                    type={showErrorsOnly ? 'red' : 'outline'}
                    onClick={() => { setShowErrorsOnly(v => !v); setShowWarningsOnly(false) }}
                    style={{ cursor: 'pointer' }}
                  >
                    {errorCount} error{errorCount === 1 ? '' : 's'}
                  </Tag>
                )}
                {warningCount > 0 && (
                  <Tag
                    size="sm"
                    type={showWarningsOnly ? 'magenta' : 'outline'}
                    onClick={() => { setShowWarningsOnly(v => !v); setShowErrorsOnly(false) }}
                    style={{ cursor: 'pointer' }}
                  >
                    {warningCount} warning{warningCount === 1 ? '' : 's'}
                  </Tag>
                )}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <Button size="sm" kind="ghost" onClick={() => setValidation(null)}>Dismiss</Button>
              </div>
            </div>
            <Table size="sm">
              <TableHead>
                <TableRow>
                  <TableHeader>Source</TableHeader>
                  <TableHeader>Target</TableHeader>
                  <TableHeader>Level</TableHeader>
                  <TableHeader>Message</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {validation.instructionReports.flatMap((rep: any) => {
                  const src = (rep?.instruction?.sourceActivityIds || []).join(', ')
                  const tgt = rep?.instruction?.targetActivityId || ''
                  const failures = (rep?.failures || []).map((f: any) => ({ level: 'Error', msg: f?.errorMessage || String(f) }))
                  const warnings = (rep?.warnings || []).map((w: any) => ({ level: 'Warning', msg: w?.warningMessage || String(w) }))
                  const rows = [...failures, ...warnings].filter((r) => (!showErrorsOnly || r.level==='Error') && (!showWarningsOnly || r.level==='Warning'))
                  if (rows.length === 0) return []
                  return rows.map((r: any, i: number) => (
                    <TableRow key={`${src}->${tgt}-${r.level}-${i}`}>
                      <TableCell style={{ fontFamily: 'var(--font-mono)' }}>{src}</TableCell>
                      <TableCell style={{ fontFamily: 'var(--font-mono)' }}>{tgt}</TableCell>
                      <TableCell>
                        <Tag size="sm" type={r.level === 'Error' ? 'red' : 'magenta'}>{r.level}</Tag>
                      </TableCell>
                      <TableCell>{r.msg}</TableCell>
                    </TableRow>
                  ))
                })}
              </TableBody>
            </Table>
          </div>
        )
      })()}

      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Execute</div>
        <div style={{ fontSize: 'var(--text-12)', display: 'grid', rowGap: 'var(--spacing-1)' }}>
          <div>Instances selected: {instanceIds.length}</div>
          <div>Plan instructions: {visibleMappedCount}</div>
          <div>Affected instances: {previewQ.data?.count ?? '—'}</div>
        </div>
        <div className={styles.centeredBtn} style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center' }}>
          <Button size="md" kind="primary" disabled={!plan || validateMutation.isPending} onClick={handleReviewAndExecute}>{validateMutation.isPending ? 'Validating…' : 'Review & Execute'}</Button>
          <Button size="md" kind="tertiary" onClick={() => setVarsOpen(true)}>Set variables</Button>
          <Button size="md" kind="ghost" onClick={() => tenantNavigate('/mission-control/processes')}>Cancel</Button>
        </div>
      </div>

      <Modal
        open={varsOpen}
        modalHeading="Migration Variables"
        primaryButtonText="Save"
        secondaryButtonText="Cancel"
        size="lg"
        hasScrollingContent
        onRequestClose={() => setVarsOpen(false)}
        onRequestSubmit={() => setVarsOpen(false)}
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-3)', minWidth: 900 }}>
          {varRows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 200px 160px 72px', columnGap: 'var(--spacing-3)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
              <div>Name</div>
              <div>Value</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Type
                <button type="button" title="String: text, Boolean: true/false, Long: integer, Double: decimal, JSON: object/array, Date: ISO date" style={{ background: 'none', border: 'none', cursor: 'help', padding: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-tertiary)', lineHeight: 0 }}>
                  <Information size={12} />
                </button>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Scope
                <button type="button" title="GLOBAL: variable is set on the process instance. LOCAL: variable is set on the current activity scope only." style={{ background: 'none', border: 'none', cursor: 'help', padding: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-tertiary)', lineHeight: 0 }}>
                  <Information size={12} />
                </button>
              </div>
              <div></div>
            </div>
          )}
          {varRows.length === 0 && (
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
              No variables defined. Variables set here will be applied to all migrated instances. Use this to initialize new variables required by the target process version, or to override existing values.
            </div>
          )}
          {varRows.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '280px 1fr 200px 160px 72px', columnGap: 'var(--spacing-3)', alignItems: 'center' }}>
              <TextInput size="sm" id={`var-name-${i}`} labelText="Name" hideLabel value={row.name} onChange={(e: any) => setVarRows(prev => prev.map((r, idx) => idx===i ? { ...r, name: e.target.value } : r))} placeholder="variableName" />
              <TextInput size="sm" id={`var-val-${i}`} labelText="Value" hideLabel value={row.value} onChange={(e: any) => setVarRows(prev => prev.map((r, idx) => idx===i ? { ...r, value: e.target.value } : r))} placeholder={row.type === 'Boolean' ? 'true / false' : row.type === 'Long' ? '42' : row.type === 'Double' ? '3.14' : row.type === 'JSON' ? '{"key": "value"}' : row.type === 'Date' ? '2025-01-01T00:00:00.000+0000' : 'value'} />
              <div style={{ width: '100%' }}>
                <Dropdown
                  size="sm"
                  id={`var-type-${i}`}
                  ariaLabel="Type"
                  direction="top"
                  titleText=""
                  label={row.type}
                  items={['String','Boolean','Long','Double','JSON','Date'] as any}
                  itemToString={(it: any) => String(it || '')}
                  selectedItem={row.type as any}
                  onChange={({ selectedItem }: any) => setVarRows(prev => prev.map((r, idx) => idx===i ? { ...r, type: String(selectedItem) } : r))}
                />
              </div>
              <div style={{ width: '100%' }}>
                <Dropdown
                  size="sm"
                  id={`var-scope-${i}`}
                  ariaLabel="Scope"
                  direction="top"
                  titleText=""
                  label={row.scope}
                  items={['GLOBAL','LOCAL'] as any}
                  itemToString={(it: any) => String(it || '')}
                  selectedItem={row.scope as any}
                  onChange={({ selectedItem }: any) => setVarRows(prev => prev.map((r, idx) => idx===i ? { ...r, scope: String(selectedItem) as any } : r))}
                />
              </div>
              <Button size="sm" kind="ghost" onClick={() => setVarRows(prev => prev.filter((_, idx) => idx !== i))}>Remove</Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => setVarRows(prev => [...prev, { name: '', type: 'String', value: '', scope: 'GLOBAL' }])}>Add variable</Button>
          </div>
        </div>
      </Modal>

      <ApplyMigrationModal
        open={reviewModalOpen}
        instanceCount={instanceIds.length}
        instructionCount={visibleMappedCount}
        mappedCount={visibleMappedCount}
        unmappedCount={(() => {
          let count = 0
          for (let idx = 0; idx < planInstructions.length; idx++) {
            const ins = planInstructions[idx]
            const isExcluded = !!removed[idx]
            const baseTgt = ins?.targetActivityId ?? (Array.isArray(ins?.targetActivityIds) ? ins.targetActivityIds[0] : undefined)
            const tgtId = overrides[idx] || baseTgt
            const mapped = !!tgtId
            const isActive = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds.some((sid: string) => activeSet.has(sid)) : false
            if (showActiveOnly && !isActive) continue
            if (showOnlyMapped && !mapped && !isExcluded) continue
            if (showOnlyUnmapped && (mapped || isExcluded)) continue
            if (!mapped && !isExcluded) count++
          }
          return count
        })()}
        unmappedWithActiveTokens={(() => {
          let count = 0
          for (let idx = 0; idx < planInstructions.length; idx++) {
            const ins = planInstructions[idx]
            const isExcluded = !!removed[idx]
            const baseTgt = ins?.targetActivityId ?? (Array.isArray(ins?.targetActivityIds) ? ins.targetActivityIds[0] : undefined)
            const tgtId = overrides[idx] || baseTgt
            const mapped = !!tgtId
            const isActive = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds.some((sid: string) => activeSet.has(sid)) : false
            if (showActiveOnly && !isActive) continue
            if (showOnlyMapped && !mapped && !isExcluded) continue
            if (showOnlyUnmapped && (mapped || isExcluded)) continue
            if (!mapped && !isExcluded && isActive) count++
          }
          return count
        })()}
        affectedCount={previewQ.data?.count}
        variableCount={varRows.filter(r => r.name.trim()).length}
        skipCustomListeners={skipCustomListeners}
        onSkipCustomListenersChange={setSkipCustomListeners}
        skipIoMappings={skipIoMappings}
        onSkipIoMappingsChange={setSkipIoMappings}
        updateEventTriggers={updateEventTriggers}
        onUpdateEventTriggersChange={setUpdateEventTriggers}
        eventInstructionCount={planInstructions.filter((ins: any) => {
          const srcId = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
          const srcType = srcId ? sourceActivities.get(srcId)?.type : undefined
          return srcType ? typeCategory(srcType) === 'event' : false
        }).length}
        payload={{ plan: migrationData.planWithOverrides, processInstanceIds: instanceIds, skipCustomListeners, skipIoMappings, variables: varsObj }}
        onClose={() => setReviewModalOpen(false)}
        onExecuteBatch={() => { executeMutation.mutate(); setReviewModalOpen(false) }}
        onExecuteDirect={() => { executeDirectMutation.mutate(); setReviewModalOpen(false) }}
        batchPending={executeMutation.isPending}
        directPending={executeDirectMutation.isPending}
      />

      <Modal
        open={statusInfoOpen}
        onRequestClose={() => setStatusInfoOpen(false)}
        modalHeading="Mapping Statuses"
        passiveModal
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-3) 0' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: '4px' }}>
              <Tag size="sm" type="green">Auto</Tag>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
              The mapping was automatically suggested by the Camunda migration engine. The source and target activities were matched by their element IDs.
            </p>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: '4px' }}>
              <Tag size="sm" type="blue">Manual</Tag>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
              The mapping was manually overridden. The target element differs from what the engine originally suggested. This is useful when element IDs changed between versions but the activity is functionally the same.
            </p>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: '4px' }}>
              <Tag size="sm" type="red">Unmapped</Tag>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
              No target element is assigned. If this source activity has active tokens, those tokens will be lost during migration. Select a target element or remove this instruction.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
