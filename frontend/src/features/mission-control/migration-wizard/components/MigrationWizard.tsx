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
} from '@carbon/react'
import { CheckmarkFilled, CircleDash } from '@carbon/icons-react'
import { createCountBadge, getBadgePosition } from '../../../shared/components/viewer/viewerUtils'
import { BADGE_STYLES } from '../../../shared/components/viewer/viewerConstants'
import styles from './MigrationWizard.module.css'
import { useMigrationData } from '../hooks'
import { typeCategory, toHumanName, parseActivities, normalizeName } from '../utils'

const Viewer = React.lazy(() => import('../../../shared/components/Viewer'))

export default function MigrationWizard() {
  const { tenantNavigate } = useTenantNavigate()
  const { state }: any = useLocation()
  const instanceIds: string[] = state?.instanceIds || []
  const preselectedKey: string | undefined = state?.selectedKey || undefined
  const preselectedVersion: number | undefined = state?.selectedVersion

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
    error,
    setError,
    overrides,
    setOverrides,
    triggerOverrides,
    setTriggerOverrides,
    removed,
    setRemoved,
    successMsg,
    setSuccessMsg,
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

  // Function to apply source diagram badges
  const applySourceBadges = React.useCallback(() => {
    const api = srcViewerApi.current
    const counts: Record<string, number> = (activeCountsQ.data as any) || {}
    if (!api) return
    try { api.clearBadges() } catch {}
    try { api.clearHighlights() } catch {}
    const position = getBadgePosition('active')
    for (const [actId, count] of Object.entries(counts)) {
      if (!count) continue
      const badge = createCountBadge(count, {
        fontSize: BADGE_STYLES.fontSize,
        fontWeight: BADGE_STYLES.fontWeight,
        ...BADGE_STYLES.pill,
      })
      try { api.addBadge(actId, badge, position) } catch {}
      try { api.highlightSrc(actId) } catch {}
    }
  }, [activeCountsQ.data])

  // Draw overlays on source diagram (green count badges + strong highlight)
  React.useEffect(() => {
    if (!srcViewerApi.current || sourceXmlQ.status !== 'success') return
    applySourceBadges()
  }, [sourceXmlQ.status, applySourceBadges])

  // Function to apply target diagram badges
  const applyTargetBadges = React.useCallback(() => {
    const api = tgtViewerApi.current
    if (!api) return
    try { api.clearBadges() } catch {}
    const position = getBadgePosition('active')
    for (const [actId, count] of Object.entries(targetPlannedCounts)) {
      if (!count) continue
      const badge = createCountBadge(`+${count}`, {
        fontSize: BADGE_STYLES.fontSize,
        fontWeight: BADGE_STYLES.fontWeight,
        ...BADGE_STYLES.pill,
        backgroundColor: '#0f62fe',
      })
      try { api.addBadge(actId, badge, position) } catch {}
    }
  }, [targetPlannedCounts])

  // Draw overlays on target diagram (blue +N badges from mapping)
  React.useEffect(() => {
    if (!tgtViewerApi.current || targetXmlQ.status !== 'success') return
    applyTargetBadges()
  }, [targetXmlQ.status, applyTargetBadges])

  // Reusable auto-map (by functional name within type category)
  const runAutoMap = React.useCallback(() => {
    if (!basePlan) return
    const nameToId = new Map<string, string>()
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g,'').trim()
    for (const a of targetActivities) {
      const key = norm(a.name || a.id)
      if (key && !nameToId.has(key)) nameToId.set(key, a.id)
    }
    const next: Record<number, string> = {}
    const instructions: any[] = Array.isArray((basePlan as any)?.instructions) ? (basePlan as any).instructions : []
    for (let idx = 0; idx < instructions.length; idx++) {
      const ins = instructions[idx]
      if (ins?.targetActivityId) continue // already suggested by engine
      const srcId = Array.isArray(ins?.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
      if (!srcId) continue
      const srcMeta = sourceActivities.get(srcId)
      const key = norm((srcMeta?.name || srcId))
      const match = nameToId.get(key)
      if (match) next[idx] = match
    }
    if (Object.keys(next).length > 0) setOverrides(prev => ({ ...prev, ...next }))
  }, [basePlan, targetActivities, sourceActivities])

  // Auto-map by functional name when engine plan lacks targets
  React.useEffect(() => {
    if (!basePlan) return
    if (targetActivities.length === 0 || sourceActivities.size === 0) return
    runAutoMap()
  }, [basePlan, targetActivities, sourceActivities, runAutoMap])

  return (
    <div style={{ padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-4)' }}>
      {error && <InlineNotification lowContrast kind="error" title={error} onCloseButtonClick={() => setError(null)} />}

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
            <ComboBox
              id="src-ver"
              titleText="Version"
              placeholder={srcVer ? String(srcVer) : 'Select source version'}
              items={versionsForKey(srcKey) as any}
              itemToString={(it: any) => (it != null ? String(it) : '')}
              selectedItem={srcVer as any}
              disabled={lockSource}
              onChange={({ selectedItem }: any) => {
                const val = typeof selectedItem === 'number' ? selectedItem : Number(selectedItem)
                if (!isNaN(val)) { setSrcVer(val); setPlan(null); setValidation(null) }
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
            <ComboBox
              id="tgt-ver"
              titleText="Version"
              placeholder={tgtVer ? String(tgtVer) : 'Select target version'}
              items={versionsForKey(tgtKey) as any}
              itemToString={(it: any) => (it != null ? String(it) : '')}
              selectedItem={tgtVer as any}
              onChange={({ selectedItem }: any) => {
                const val = typeof selectedItem === 'number' ? selectedItem : Number(selectedItem)
                if (!isNaN(val)) { setTgtVer(val); setPlan(null); setValidation(null) }
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
            <Checkbox id="update-triggers" labelText="Update Event Triggers" checked={updateEventTriggers} onChange={(evt, data) => setUpdateEventTriggers(!!data.checked)} />
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
              {!srcKey || !srcVer || !tgtKey || !tgtVer
                ? 'Select source and target process + version to build a migration plan.'
                : generating
                ? 'Building migration plan…'
                : basePlan
                ? 'Migration plan is up to date.'
                : 'Migration plan will be built automatically.'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--spacing-2)', alignItems: 'stretch', height: 300 }}>
          <div style={{ border: '1px solid var(--color-border-primary)', position: 'relative' }}>
            {sourceXmlQ.isLoading ? (
              <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading source...</div>
            ) : (
              <React.Suspense fallback={<div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading diagram...</div>}>
                <Viewer 
                  xml={(sourceXmlQ.data as any) || ''} 
                  onReady={(api) => { srcViewerApi.current = api; try { api.fitViewport() } catch {} }} 
                  onDiagramReset={applySourceBadges}
                />
              </React.Suspense>
            )}
          </div>
          <div style={{ border: '1px solid var(--color-border-primary)', position: 'relative' }}>
            {targetXmlQ.isLoading ? (
              <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading target...</div>
            ) : (
              <React.Suspense fallback={<div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Loading diagram...</div>}>
                <Viewer 
                  xml={(targetXmlQ.data as any) || ''} 
                  onReady={(api) => { tgtViewerApi.current = api; try { api.fitViewport() } catch {} }} 
                  onDiagramReset={applyTargetBadges}
                />
              </React.Suspense>
            )}
          </div>
        </div>
      </div>

      <div className={styles.mappingSection} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Mapping</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center' }}>
            <Checkbox id="toggle-active-only" labelText="Show only active in selection" checked={showActiveOnly} onChange={(evt, data) => setShowActiveOnly(!!data.checked)} />
            <Checkbox id="toggle-incompat" labelText="Show incompatible targets" checked={showIncompatibleTargets} onChange={(evt, data) => setShowIncompatibleTargets(!!data.checked)} />
            <Checkbox id="toggle-mapped" labelText="Show only mapped" checked={showOnlyMapped} onChange={(evt, data) => { const v = !!data.checked; setShowOnlyMapped(v); if (v) setShowOnlyUnmapped(false) }} />
            <Checkbox id="toggle-unmapped" labelText="Show only unmapped" checked={showOnlyUnmapped} onChange={(evt, data) => { const v = !!data.checked; setShowOnlyUnmapped(v); if (v) setShowOnlyMapped(false) }} />
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>{planInstructions.length} instructions</div>
            <Button size="sm" kind="ghost" onClick={runAutoMap}>Auto map</Button>
            <Button size="sm" kind="ghost" onClick={() => { setOverrides({}); setTriggerOverrides({}); setRemoved({}) }}>Reset suggestions</Button>
          </div>
        </div>
        {successMsg && (
          <InlineNotification lowContrast kind="success" title={successMsg} onCloseButtonClick={() => setSuccessMsg(null)} />
        )}
        {(plan && targetXmlQ.status === 'success' && sourceXmlQ.status === 'success') ? (
        <div className={styles.mappingTable}>
        <Table size="sm">
          <TableHead>
            <TableRow>
              <TableHeader>Source elements</TableHeader>
              <TableHeader>Target elements</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {planInstructions.length === 0 && (
              <TableRow>
                <TableCell colSpan={3}><InlineNotification lowContrast kind="info" title="No instructions returned by engine" /></TableCell>
              </TableRow>
            )}
            {planInstructions.map((ins: any, idx: number) => {
                const baseTgt = (ins as any).targetActivityId ?? (Array.isArray((ins as any).targetActivityIds) ? (ins as any).targetActivityIds[0] : undefined)
                const tgtId = overrides[idx] || baseTgt
                const mapped = !!tgtId
                const status: 'Auto'|'Manual'|'Unmapped' = (!mapped)
                  ? 'Unmapped'
                  : (overrides[idx] && baseTgt && overrides[idx] !== baseTgt)
                    ? 'Manual'
                    : 'Auto'
                const srcId = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds[0] : undefined
                const srcType = srcId ? sourceActivities.get(srcId)?.type : undefined
                const srcCat = srcType ? typeCategory(srcType) : undefined
                const isActive = Array.isArray(ins.sourceActivityIds) ? ins.sourceActivityIds.some((sid: string) => activeSet.has(sid)) : false
                if (showActiveOnly && !isActive) return null
                if (showOnlyMapped && !mapped) return null
                if (showOnlyUnmapped && mapped) return null
                const items = targetActivities
                  .map(a => ({ id: a.id, label: (a.name && a.name.trim()) ? a.name : toHumanName(a.id), type: a.type }))
                const selectedItem = tgtId ? items.find(i => i.id === tgtId) : undefined
                const meta = srcId ? sourceActivities.get(srcId) : undefined
                const srcName = (meta?.name || '').trim()
                const srcLabel = srcName ? srcName : (srcId ? toHumanName(srcId) : ins.sourceActivityIds.join(', '))
                return (
                  <TableRow
                    key={idx}
                    onMouseEnter={() => {
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
                    onClick={() => setPinnedIdx(p => p === idx ? null : idx)}
                  >
                    <TableCell>{srcLabel}</TableCell>
                    <TableCell>
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
                        <Button size="sm" kind="ghost" onClick={() => setRemoved(prev => ({ ...prev, [idx]: true }))}>Remove</Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {status === 'Unmapped' ? (
                        <CircleDash style={{ color: 'var(--color-text-tertiary)' }} title="Unmapped" />
                      ) : (
                        <CheckmarkFilled style={{ color: 'var(--color-success)' }} title={status} />
                      )}
                    </TableCell>
                  </TableRow>
                )
            })}
          </TableBody>
        </Table>
        </div>
        ) : null}
      </div>

      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Validation</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center' }}>
            <Checkbox id="errors-only" labelText="Errors only" checked={showErrorsOnly} onChange={(evt, data) => { setShowErrorsOnly(!!data.checked); if (showWarningsOnly && data.checked) setShowWarningsOnly(false) }} />
            <Checkbox id="warnings-only" labelText="Warnings only" checked={showWarningsOnly} onChange={(evt, data) => { setShowWarningsOnly(!!data.checked); if (showErrorsOnly && data.checked) setShowErrorsOnly(false) }} />
            <Button size="sm" kind="primary" onClick={() => validateMutation.mutate()} disabled={!plan || validateMutation.isPending}>Validate</Button>
          </div>
        </div>
        {validation ? (
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
              {Array.isArray(validation?.instructionReports) && validation.instructionReports.length > 0 ? (
                validation.instructionReports.flatMap((rep: any) => {
                  const src = (rep?.instruction?.sourceActivityIds || []).join(', ')
                  const tgt = rep?.instruction?.targetActivityId || ''
                  const failures = (rep?.failures || []).map((f: any) => ({ level: 'Error', msg: f?.errorMessage || String(f) }))
                  const warnings = (rep?.warnings || []).map((w: any) => ({ level: 'Warning', msg: w?.warningMessage || String(w) }))
                  const rows = [...failures, ...warnings].filter((r) => (!showErrorsOnly || r.level==='Error') && (!showWarningsOnly || r.level==='Warning'))
                  if (rows.length === 0) return [<TableRow key={`${src}->${tgt}-ok`}><TableCell>{src}</TableCell><TableCell>{tgt}</TableCell><TableCell>OK</TableCell><TableCell>—</TableCell></TableRow>]
                  return rows.map((r: any, i: number) => (
                    <TableRow key={`${src}->${tgt}-${r.level}-${i}`}>
                      <TableCell style={{ fontFamily: 'var(--font-mono)' }}>{src}</TableCell>
                      <TableCell style={{ fontFamily: 'var(--font-mono)' }}>{tgt}</TableCell>
                      <TableCell>{r.level}</TableCell>
                      <TableCell>{r.msg}</TableCell>
                    </TableRow>
                  ))
                })
              ) : (
                <TableRow><TableCell colSpan={4}><InlineNotification lowContrast kind="success" title="No issues reported" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          <InlineNotification lowContrast kind="info" title="No validation data yet" />
        )}
      </div>

      <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Execute</div>
        <div style={{ fontSize: 'var(--text-12)', display: 'grid', rowGap: 'var(--spacing-1)' }}>
          <div>Instances selected: {instanceIds.length}</div>
          <div>Plan instructions: {planInstructions.length}</div>
          <div>Affected instances: {previewQ.data?.count ?? '—'}</div>
          <div>Choose either async batch or direct execution.</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Checkbox id="opt-skip-listeners" labelText="Skip custom listeners" checked={skipCustomListeners} onChange={(evt, data) => setSkipCustomListeners(!!data.checked)} />
          <Checkbox id="opt-skip-io" labelText="Skip IO mappings" checked={skipIoMappings} onChange={(evt, data) => setSkipIoMappings(!!data.checked)} />
          <Button size="sm" kind="ghost" onClick={() => setVarsOpen(true)}>Set variables</Button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          <Button size="sm" kind="primary" disabled={!plan || executeMutation.isPending} onClick={() => executeMutation.mutate()}>Create migration batch</Button>
          <Button size="sm" kind="secondary" disabled={!plan || executeDirectMutation.isPending} onClick={() => executeDirectMutation.mutate()}>Run directly (no batch)</Button>
          <Button size="sm" kind="ghost" onClick={() => tenantNavigate('/mission-control/processes')}>Cancel</Button>
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
              <div>Type</div>
              <div>Scope</div>
              <div></div>
            </div>
          )}
          {varRows.length === 0 && (
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>No variables. Click Add variable.</div>
          )}
          {varRows.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '280px 1fr 200px 160px 72px', columnGap: 'var(--spacing-3)', alignItems: 'center' }}>
              <TextInput size="sm" id={`var-name-${i}`} labelText="Name" hideLabel value={row.name} onChange={(e: any) => setVarRows(prev => prev.map((r, idx) => idx===i ? { ...r, name: e.target.value } : r))} placeholder="variableName" />
              <TextInput size="sm" id={`var-val-${i}`} labelText="Value" hideLabel value={row.value} onChange={(e: any) => setVarRows(prev => prev.map((r, idx) => idx===i ? { ...r, value: e.target.value } : r))} placeholder="value" />
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
    </div>
  )
}
