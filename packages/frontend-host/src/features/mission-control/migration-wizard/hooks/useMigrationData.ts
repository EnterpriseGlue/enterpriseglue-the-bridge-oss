import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../../../../contexts/AuthContext';
import { permissionSnapshotAuthorityKey } from '../../../../contexts/authSessionPermissions';
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate';
import { useSelectedEngine } from '../../../../components/EngineSelector';
import { useToast } from '../../../../shared/notifications/ToastProvider';
import { useProjectActionFence } from '../../../starbase/hooks/useProjectActionFence';
import { listProcessDefinitions } from '../../processes-overview/api/processDefinitions';
import { withEngineContext } from '../../shared/engineContext';
import { MigrationExecuteRequestSchema, type MigrationPlan, type MigrationValidationResult } from '@enterpriseglue/shared/schemas/mission-control/migration.js';
import { generateMigrationPlan, validateMigrationPlan, executeMigration, executeMigrationAsync, previewMigration, activeMigrationSources, fetchProcessDefinitionXml } from '../api/migration';
import { canonicalId, selectedInstances, mappedPlan, migrationVariables, type MigrationVariableRow } from '../utils/migrationPayload';
export interface MigrationDataParams {
    instanceIds: string[];
    originEngineId?: string;
    preselectedKey?: string;
    preselectedVersion?: number;
    selectionInvalid?: boolean;
}
export function useMigrationData({ instanceIds: candidates, originEngineId, preselectedKey, preselectedVersion, selectionInvalid }: MigrationDataParams) {
    const { tenantNavigate } = useTenantNavigate(), selectedEngineId = useSelectedEngine(), { notify } = useToast();
    const auth = React.useContext(AuthContext), location = useLocation();
    const authenticated = auth?.isAuthenticated === true && !auth.isLoading;
    const authority = JSON.stringify([selectedEngineId, authenticated, auth?.user?.session?.principal.id || auth?.user?.id || auth?.permissions?.userId,
        auth?.user?.session?.tenant.id, auth?.sessionRevision, permissionSnapshotAuthorityKey(auth?.permissions), location.pathname, location.search]);
    const parsedIds = selectedInstances(candidates), originMatches = !!selectedEngineId && originEngineId === selectedEngineId;
    const instanceIds = originMatches && parsedIds ? parsedIds : [];
    const initialKey = originMatches ? preselectedKey : undefined, initialVersion = originMatches ? preselectedVersion : undefined;
    const inputKey = JSON.stringify([authority, candidates, originEngineId, preselectedKey, preselectedVersion, selectionInvalid]);
    const defsQ = useQuery({ queryKey: ['mission-control', 'migration', 'defs', authority], queryFn: () => listProcessDefinitions(selectedEngineId), enabled: authenticated && !!selectedEngineId });
    const defs = defsQ.data || [];
    const processItems = React.useMemo(() => Array.from(new Map(defs.filter(d => canonicalId(d.key)).map(d => [d.key, { key: d.key, label: d.name || d.key }])).values()).sort((a, b) => a.label.localeCompare(b.label)), [defs]);
    const versionsForKey = (key?: string) => [...new Set(defs.filter(d => d.key === key && Number.isSafeInteger(d.version) && d.version > 0).map(d => d.version))].sort((a, b) => b - a);
    const idFor = (key?: string, version?: number) => { const matches = defs.filter(d => d.key === key && d.version === version && canonicalId(d.id)); return matches.length === 1 ? matches[0].id : undefined; };
    const [srcKey, setSrcKey] = React.useState(initialKey), [srcVer, setSrcVer] = React.useState(initialVersion);
    const [tgtKey, setTgtKey] = React.useState(initialKey), [tgtVer, setTgtVer] = React.useState<number | undefined>();
    const [updateEventTriggers, setUpdateEventTriggers] = React.useState(false);
    const [storedPlan, storePlan] = React.useState<{
        scope: string;
        value: MigrationPlan;
    } | null>(null);
    const [overrides, setOverrides] = React.useState<Record<number, string>>({}), [triggerOverrides, setTriggerOverrides] = React.useState<Record<number, boolean>>({}), [removed, setRemoved] = React.useState<Record<number, boolean>>({});
    const [validation, setValidation] = React.useState<MigrationValidationResult | null>(null), [generating, setGenerating] = React.useState(false);
    const [generationError, setGenerationError] = React.useState<string | null>(null), [executionError, setExecutionError] = React.useState<string | null>(null);
    const [showErrorsOnly, setShowErrorsOnly] = React.useState(false), [showWarningsOnly, setShowWarningsOnly] = React.useState(false), [showIncompatibleTargets, setShowIncompatibleTargets] = React.useState(false);
    const [showOnlyMapped, setShowOnlyMapped] = React.useState(false), [showOnlyUnmapped, setShowOnlyUnmapped] = React.useState(false), [showActiveOnly, setShowActiveOnly] = React.useState(instanceIds.length > 0);
    const [varsOpen, setVarsOpen] = React.useState(false), [varRows, setVarRows] = React.useState<MigrationVariableRow[]>([]);
    const [skipCustomListeners, setSkipCustomListeners] = React.useState(false), [skipIoMappings, setSkipIoMappings] = React.useState(false), [pinnedIdx, setPinnedIdx] = React.useState<number | null>(null);
    React.useEffect(() => { setSrcKey(initialKey); setSrcVer(initialVersion); setTgtKey(initialKey); setTgtVer(undefined); setVarRows([]); setVarsOpen(false); setPinnedIdx(null); setSkipCustomListeners(false); setSkipIoMappings(false); setUpdateEventTriggers(false); }, [inputKey]);
    const selectionError = selectionInvalid || !parsedIds || (candidates.length > 0 && !originMatches)
        ? 'The selected instances do not belong to this migration context. Select them again from Processes.'
        : candidates.length && initialKey && initialVersion !== undefined && defsQ.isSuccess && !idFor(initialKey, initialVersion)
            ? 'The selected source version is unavailable. Select the instances again from Processes.' : null;
    React.useEffect(() => {
        if (!defsQ.data || selectionError)
            return;
        if (srcKey && srcVer === undefined)
            setSrcVer(versionsForKey(srcKey)[0]);
        if (tgtKey && tgtVer === undefined)
            setTgtVer(versionsForKey(tgtKey)[0]);
    }, [srcKey, srcVer, tgtKey, tgtVer, defsQ.data, selectionError]);
    const srcDefId = idFor(srcKey, srcVer), tgtDefId = idFor(tgtKey, tgtVer);
    const selectionScope = JSON.stringify([authority, inputKey, srcKey, srcVer, tgtKey, tgtVer, srcDefId, tgtDefId, updateEventTriggers, selectionError]);
    const selectionFence = useProjectActionFence(selectionScope), selectionCheck = selectionFence.capture();
    const generation = React.useRef<object | null>(null);
    React.useEffect(() => { storePlan(null); setOverrides({}); setTriggerOverrides({}); setRemoved({}); setValidation(null); setGenerating(false); setGenerationError(null); generation.current = null; }, [selectionScope]);
    async function handleGeneratePlan() {
        try {
            selectionCheck();
        }
        catch {
            return;
        }
        if (!authenticated || selectionError || !srcDefId || !tgtDefId || generation.current)
            return;
        const token = {};
        generation.current = token;
        setGenerating(true);
        storePlan(null);
        setValidation(null);
        setGenerationError(null);
        try {
            const result = await generateMigrationPlan(srcDefId, tgtDefId, selectedEngineId, updateEventTriggers);
            selectionCheck();
            if (generation.current !== token)
                return;
            storePlan({ scope: selectionScope, value: result });
            setOverrides({});
            setTriggerOverrides({});
            setRemoved({});
        }
        catch {
            try {
                selectionCheck();
                if (generation.current === token)
                    setGenerationError('The migration plan could not be verified. Check the selection and generate it again.');
            }
            catch { }
        }
        finally {
            if (generation.current === token) {
                generation.current = null;
                setGenerating(false);
            }
        }
    }
    React.useEffect(() => { void handleGeneratePlan(); }, [selectionScope]);
    const basePlan = storedPlan?.scope === selectionScope ? storedPlan.value : null;
    const planWithOverrides = React.useMemo(() => mappedPlan(basePlan, overrides, triggerOverrides, removed), [basePlan, overrides, triggerOverrides, removed]);
    const planInstructions = basePlan?.instructions || [];
    const variablePayload = React.useMemo(() => {
        try {
            return { value: migrationVariables(varRows), error: null };
        }
        catch (error) {
            return { value: {}, error: error instanceof Error ? error.message : 'Check migration variables.' };
        }
    }, [varRows]);
    const varsObj = variablePayload.value, varsError = variablePayload.error;
    const previewQ = useQuery({ queryKey: ['mission-control', 'migration', 'preview', authority, planWithOverrides, instanceIds],
        queryFn: () => previewMigration(planWithOverrides!, instanceIds, selectedEngineId), enabled: authenticated && !selectionError && !!planWithOverrides });
    const activeCountsQ = useQuery({ queryKey: ['mission-control', 'migration', 'active-src', authority, instanceIds],
        queryFn: () => activeMigrationSources(instanceIds, selectedEngineId), enabled: authenticated && !selectionError && instanceIds.length > 0 });
    // The private draft identity stays in memory; no variable values enter query keys or storage.
    const identity = JSON.stringify([selectionScope, planWithOverrides, instanceIds, skipCustomListeners, skipIoMappings, varRows]);
    const draft = React.useRef({ identity, revision: 0 });
    if (draft.current.identity !== identity)
        draft.current = { identity, revision: draft.current.revision + 1 };
    const owner = draft.current, reviewKey = owner.revision, reviewFence = useProjectActionFence(JSON.stringify([authority, reviewKey])), reviewCheck = reviewFence.capture();
    type Payload = {
        engineId: string;
        plan: MigrationPlan;
        processInstanceIds: string[];
        skipCustomListeners: boolean;
        skipIoMappings: boolean;
        variables: typeof varsObj;
    };
    const approval = React.useRef<{
        owner: typeof owner;
        payload: Payload;
    } | null>(null), activeValidation = React.useRef<object | null>(null), inFlight = React.useRef<object | null>(null), blocked = React.useRef(false);
    const [validating, setValidating] = React.useState(false), [executing, setExecuting] = React.useState<'batch' | 'direct' | null>(null), [approvedRevision, setApprovedRevision] = React.useState<number | null>(null);
    React.useEffect(() => { approval.current = null; activeValidation.current = null; setApprovedRevision(null); setValidation(null); setValidating(false); }, [reviewKey]);
    const canReview = authenticated && !selectionError && !varsError && !!planWithOverrides && previewQ.isSuccess && !previewQ.isFetching && previewQ.data.count > 0 && !inFlight.current && !blocked.current;
    const payload = (): Payload => {
        if (!canReview || !selectedEngineId || !planWithOverrides)
            throw Error('The migration selection is not ready for review');
        return structuredClone({ engineId: selectedEngineId, plan: planWithOverrides, processInstanceIds: instanceIds, skipCustomListeners, skipIoMappings, variables: varsObj });
    };
    const validate = async () => {
        reviewCheck();
        if (activeValidation.current)
            throw Error('Validation already running');
        const snapshot = payload(), token = {};
        activeValidation.current = token;
        approval.current = null;
        setApprovedRevision(null);
        setValidating(true);
        try {
            const response = await validateMigrationPlan(snapshot.plan, snapshot.processInstanceIds, snapshot.engineId, snapshot.variables);
            try {
                reviewCheck();
            }
            catch {
                return { response, stale: true };
            }
            if (activeValidation.current !== token)
                return { response, stale: true };
            const clean = [...response.instructionReports, ...Object.values(response.variableReports || {})].every(r => !r.failures?.length && !r.warnings?.length);
            if (clean) {
                approval.current = { owner, payload: snapshot };
                setApprovedRevision(reviewKey);
            }
            return { response, stale: false };
        }
        catch (error) {
            try {
                reviewCheck();
                notify({ kind: 'error', title: 'Validation failed', subtitle: 'The current migration plan could not be verified.' });
            }
            catch { }
            throw error;
        }
        finally {
            if (activeValidation.current === token) {
                activeValidation.current = null;
                setValidating(false);
            }
        }
    };
    const execute = async (mode: 'batch' | 'direct', auditReason?: string) => {
        reviewCheck();
        if (inFlight.current || blocked.current)
            throw Error('A migration is already pending or needs reconciliation');
        const approved = approval.current;
        if (!approved || approved.owner !== owner || JSON.stringify(payload()) !== JSON.stringify(approved.payload))
            throw Error('Review the current migration selection before executing');
        const request = MigrationExecuteRequestSchema.safeParse({ ...approved.payload, auditReason: auditReason?.trim() });
        if (!request.success)
            throw Error('A valid audit reason is required');
        const token = {};
        inFlight.current = token;
        setExecuting(mode);
        setExecutionError(null);
        approval.current = null;
        setApprovedRevision(null);
        try {
            const { plan, ...rest } = request.data;
            const response = mode === 'batch' ? await executeMigrationAsync({ ...rest, migrationPlan: plan }) : await executeMigration({ ...rest, migrationPlan: plan });
            reviewCheck();
            if (mode === 'batch' && 'id' in response)
                tenantNavigate(withEngineContext(`/mission-control/batches/${response.id}`, selectedEngineId));
            else {
                notify({ kind: 'success', title: 'Migration completed' });
                tenantNavigate(withEngineContext('/mission-control/processes', selectedEngineId));
            }
            return response;
        }
        catch (error) {
            blocked.current = true;
            try {
                reviewCheck();
                setExecutionError('Migration outcome was not verified. Check the affected instances and batches before another attempt.');
            }
            catch { }
            throw error;
        }
        finally {
            if (inFlight.current === token) {
                inFlight.current = null;
                setExecuting(null);
            }
        }
    };
    const validateMutation = { isPending: validating, mutateAsync: validate };
    const executeMutation = { isPending: executing === 'batch', mutateAsync: (reason?: string) => execute('batch', reason), mutate: (reason?: string) => { void execute('batch', reason).catch(() => { }); } };
    const executeDirectMutation = { isPending: executing === 'direct', mutateAsync: (reason?: string) => execute('direct', reason), mutate: (reason?: string) => { void execute('direct', reason).catch(() => { }); } };
    const sourceXmlQ = useQuery({ queryKey: ['mission-control', 'migration', 'src-xml', authority, srcDefId], queryFn: () => fetchProcessDefinitionXml(srcDefId!, selectedEngineId), enabled: authenticated && !!srcDefId && !selectionError });
    const targetXmlQ = useQuery({ queryKey: ['mission-control', 'migration', 'tgt-xml', authority, tgtDefId], queryFn: () => fetchProcessDefinitionXml(tgtDefId!, selectedEngineId), enabled: authenticated && !!tgtDefId && !selectionError });
    const activeSet = React.useMemo(() => new Set(Object.keys(activeCountsQ.data || {})), [activeCountsQ.data]);
    const targetPlannedCounts = React.useMemo(() => {
        const out: Record<string, number> = {};
        for (const instruction of planWithOverrides?.instructions || []) {
            for (const target of instruction.targetActivityIds) {
                const sum = instruction.sourceActivityIds.reduce((n, id) => n + (activeCountsQ.data?.[id] || 0), 0);
                if (sum)
                    out[target] = (out[target] || 0) + sum;
            }
        }
        return out;
    }, [planWithOverrides, activeCountsQ.data]);
    const lockSource = instanceIds.length > 0 && !!initialKey && initialVersion !== undefined;
    return { defsQ, sourceXmlQ, targetXmlQ, activeCountsQ, previewQ, validateMutation, executeMutation, executeDirectMutation, defs, processItems, versionsForKey, idFor,
        basePlan, plan: basePlan, planWithOverrides, planInstructions, activeSet, targetPlannedCounts, varsObj, varsError, selectionError, generationError, executionError, reviewKey, canReview,
        reviewApproved: approvedRevision === reviewKey, lockSource, generating, selectedEngineId, instanceIds, srcKey, setSrcKey, srcVer, setSrcVer, tgtKey, setTgtKey, tgtVer, setTgtVer,
        updateEventTriggers, setUpdateEventTriggers, setPlan: (_value: null) => storePlan(null), validation, setValidation, overrides, setOverrides, triggerOverrides, setTriggerOverrides, removed, setRemoved,
        showErrorsOnly, setShowErrorsOnly, showWarningsOnly, setShowWarningsOnly, showIncompatibleTargets, setShowIncompatibleTargets, showOnlyMapped, setShowOnlyMapped, showOnlyUnmapped, setShowOnlyUnmapped,
        showActiveOnly, setShowActiveOnly, varsOpen, setVarsOpen, varRows, setVarRows, skipCustomListeners, setSkipCustomListeners, skipIoMappings, setSkipIoMappings, pinnedIdx, setPinnedIdx, handleGeneratePlan };
}
