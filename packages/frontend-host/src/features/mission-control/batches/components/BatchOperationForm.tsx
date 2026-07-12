import { useContext, useMemo, useState } from 'react';
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate';
import { useQuery } from '@tanstack/react-query';
import { useSelectedEngine } from '../../../../components/EngineSelector';
import {
  Button,
  Form,
  FormGroup,
  TextInput,
  Checkbox,
  Select,
  SelectItem,
  InlineLoading,
  InlineNotification,
} from '@carbon/react';
import { apiClient } from '../../../../shared/api/client';
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils';
import { AuthContext } from '../../../../contexts/AuthContext';
import { evaluateActionSnapshot } from '../../../../shared/auth/guards';

interface BatchOperationConfig {
  type: 'delete' | 'suspend' | 'activate' | 'retries';
  title: string;
  endpoint: string;
  actionId: string;
  fields: {
    deleteReason?: boolean;
    skipCustomListeners?: boolean;
    skipIoMappings?: boolean;
    failIfNotExists?: boolean;
    skipSubprocesses?: boolean;
    retries?: boolean;
  };
}

const BATCH_CONFIGS: Record<string, BatchOperationConfig> = {
  delete: {
    type: 'delete',
    title: 'Cancel Process Instances',
    endpoint: '/mission-control-api/batches/process-instances/delete',
    actionId: 'engine.runtime.batches.process-instances.delete',
    fields: {
      deleteReason: true,
      skipCustomListeners: true,
      skipIoMappings: true,
      failIfNotExists: true,
      skipSubprocesses: true,
    },
  },
  suspend: {
    type: 'suspend',
    title: 'Suspend Process Instances',
    endpoint: '/mission-control-api/batches/process-instances/suspend',
    actionId: 'engine.runtime.batches.process-instances.suspend',
    fields: {},
  },
  activate: {
    type: 'activate',
    title: 'Activate Process Instances',
    endpoint: '/mission-control-api/batches/process-instances/activate',
    actionId: 'engine.runtime.batches.process-instances.activate',
    fields: {},
  },
  retries: {
    type: 'retries',
    title: 'Set Job Retries',
    endpoint: '/mission-control-api/batches/jobs/retries',
    actionId: 'engine.runtime.batches.jobs.retry',
    fields: {
      retries: true,
    },
  },
};

interface Props {
  operationType: 'delete' | 'suspend' | 'activate' | 'retries';
}

export default function BatchOperationForm({ operationType }: Props) {
  const { tenantNavigate } = useTenantNavigate();
  const config = BATCH_CONFIGS[operationType];
  const authContext = useContext(AuthContext);

  const [formData, setFormData] = useState({
    processDefinitionKey: '',
    deleteReason: '',
    skipCustomListeners: false,
    skipIoMappings: false,
    failIfNotExists: false,
    skipSubprocesses: false,
    retries: 3,
    auditReason: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEngineId = useSelectedEngine();
  const engineResource = useMemo(() => ({ type: 'engine' as const, id: selectedEngineId ?? null }), [selectedEngineId]);
  const submitDecision = evaluateActionSnapshot(authContext?.permissions ?? null, config.actionId, engineResource);
  const submitDeniedReason = submitDecision.allowed ? null : submitDecision.reason || 'Action unavailable';
  const auditReason = formData.auditReason.trim();
  const auditReasonMissing = auditReason.length === 0;

  // Fetch process definitions for dropdown
  const q = useQuery({
    queryKey: ['mission-control', 'batch-process-definitions', selectedEngineId],
    queryFn: () => {
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : '';
      return apiClient.get<any[]>(`/mission-control-api/process-definitions${params}`, undefined, { credentials: 'include' });
    },
    enabled: !!selectedEngineId,
  });

  const processDefinitions = q.data || []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitDeniedReason) {
      setError(submitDeniedReason);
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const payload: any = {
        processDefinitionKey: formData.processDefinitionKey,
        engineId: selectedEngineId,
      };

      if (config.fields.deleteReason) payload.deleteReason = auditReason;
      payload.auditReason = auditReason;
      if (config.fields.skipCustomListeners) payload.skipCustomListeners = formData.skipCustomListeners;
      if (config.fields.skipIoMappings) payload.skipIoMappings = formData.skipIoMappings;
      if (config.fields.failIfNotExists) payload.failIfNotExists = formData.failIfNotExists;
      if (config.fields.skipSubprocesses) payload.skipSubprocesses = formData.skipSubprocesses;
      if (config.fields.retries) payload.retries = formData.retries;

      await apiClient.post(config.endpoint, payload, { credentials: 'include' });
      tenantNavigate('/mission-control/batches');
    } catch (err) {
      setError(getUiErrorMessage(err, 'Failed to submit batch operation'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 'var(--spacing-5)', maxWidth: 800 }}>
      <h2>{config.title}</h2>
      {error && (
        <InlineNotification
          kind="error"
          title="Error"
          subtitle={error}
          lowContrast
          style={{ marginBottom: 'var(--spacing-4)' }}
        />
      )}
      <Form onSubmit={handleSubmit}>
        <FormGroup legendText="Batch Configuration">
          <Select
            id="processDefinitionKey"
            labelText="Process Definition"
            value={formData.processDefinitionKey}
            onChange={(e) => setFormData({ ...formData, processDefinitionKey: e.target.value })}
            required
          >
            <SelectItem value="" text="Select a process definition" />
            {processDefinitions?.map((pd: any) => (
              <SelectItem key={pd.key} value={pd.key} text={`${pd.name || pd.key} (v${pd.version})`} />
            ))}
          </Select>

          <TextInput
            id="auditReason"
            labelText={config.fields.deleteReason ? 'Cancel reason' : 'Audit reason'}
            value={formData.auditReason}
            onChange={(e) => setFormData({ ...formData, auditReason: e.target.value, deleteReason: e.target.value })}
            placeholder={
              config.fields.deleteReason
                ? 'e.g., Business request was canceled upstream.'
                : 'e.g., Pausing instances while dependency maintenance runs.'
            }
            required
          />

          {config.fields.retries && (
            <TextInput
              id="retries"
              labelText="Number of Retries"
              type="number"
              value={formData.retries}
              onChange={(e) => setFormData({ ...formData, retries: parseInt(e.target.value) })}
              min={0}
            />
          )}

          {config.fields.skipCustomListeners && (
            <Checkbox
              id="skipCustomListeners"
              labelText="Skip Custom Listeners"
              checked={formData.skipCustomListeners}
              onChange={(e) => setFormData({ ...formData, skipCustomListeners: e.target.checked })}
            />
          )}

          {config.fields.skipIoMappings && (
            <Checkbox
              id="skipIoMappings"
              labelText="Skip I/O Mappings"
              checked={formData.skipIoMappings}
              onChange={(e) => setFormData({ ...formData, skipIoMappings: e.target.checked })}
            />
          )}

          {config.fields.failIfNotExists && (
            <Checkbox
              id="failIfNotExists"
              labelText="Fail if Not Exists"
              checked={formData.failIfNotExists}
              onChange={(e) => setFormData({ ...formData, failIfNotExists: e.target.checked })}
            />
          )}

          {config.fields.skipSubprocesses && (
            <Checkbox
              id="skipSubprocesses"
              labelText="Skip Subprocesses"
              checked={formData.skipSubprocesses}
              onChange={(e) => setFormData({ ...formData, skipSubprocesses: e.target.checked })}
            />
          )}
        </FormGroup>

        <div style={{ marginTop: 'var(--spacing-5)', display: 'flex', gap: 'var(--spacing-2)' }}>
          <Button
            type="submit"
            disabled={submitting || !formData.processDefinitionKey || !!submitDeniedReason || auditReasonMissing}
            title={submitDeniedReason || (auditReasonMissing ? 'Audit reason is required' : undefined)}
          >
            {submitting ? <InlineLoading description="Creating..." /> : `Create ${config.title}`}
          </Button>
          <Button kind="secondary" onClick={() => tenantNavigate('/mission-control/batches')}>
            Cancel
          </Button>
        </div>
      </Form>
    </div>
  );
}
