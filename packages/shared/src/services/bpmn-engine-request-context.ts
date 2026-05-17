import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type BpmnEngineRequestContext = {
  requestId: string;
  userId?: string;
  tenantId?: string;
  tenantSlug?: string;
  engineId?: string;
};

const storage = new AsyncLocalStorage<BpmnEngineRequestContext>();

export function runWithBpmnEngineRequestContext<T>(context: Partial<BpmnEngineRequestContext>, callback: () => T): T {
  const requestId = context.requestId || randomUUID();
  return storage.run({ ...context, requestId }, callback);
}

export function getBpmnEngineRequestContext(): BpmnEngineRequestContext | null {
  return storage.getStore() || null;
}

export function updateBpmnEngineRequestContext(update: Partial<Omit<BpmnEngineRequestContext, 'requestId'>>) {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, update);
}

