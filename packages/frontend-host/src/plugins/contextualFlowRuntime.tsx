import { Modal } from '@carbon/react';
import type {
  PluginContextualFlowControllerV1,
  PluginContextualFlowLifecycleReasonV1,
  PluginContextualFlowRequestV1,
} from '@enterpriseglue/plugin-sdk';
import React from 'react';

export interface ActiveContextualFlowV1 {
  ownerPluginId: string;
  launcherKey: string;
  request: PluginContextualFlowRequestV1;
}

export interface HostContextualFlowSurfaceV1 {
  active: ActiveContextualFlowV1 | null;
  open(
    ownerPluginId: string,
    launcherKey: string,
    request: PluginContextualFlowRequestV1,
  ): boolean;
  close(
    ownerPluginId: string,
    reason: 'closed' | 'cancelled' | 'completed',
  ): void;
  back(ownerPluginId: string): void;
}

function validShortText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function validSourceContext(
  value: PluginContextualFlowRequestV1['sourceContext'],
): boolean {
  const allowedKeys = new Set([
    'schemaVersion',
    'objectType',
    'objectRef',
    'engineRef',
    'tenantRef',
    'displayName',
    'product',
    'productVersion',
  ]);
  const objectTypes = new Set([
    'engine',
    'process-instance',
    'incident',
    'failed-job',
    'batch',
  ]);
  return (
    value?.schemaVersion === 1 &&
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    objectTypes.has(value.objectType) &&
    validShortText(value.objectRef, 500) &&
    [
      value.engineRef,
      value.tenantRef,
      value.displayName,
      value.product,
      value.productVersion,
    ].every((entry) => entry === undefined || validShortText(entry, 500))
  );
}

function validReturnContext(
  value: PluginContextualFlowRequestV1['returnContext'],
): boolean {
  if (value === undefined) return true;
  const surfaces = new Set([
    'engine-detail',
    'process-instance',
    'incident-detail',
    'failed-job-detail',
    'batch-detail',
    'plugin-route',
  ]);
  return (
    value.schemaVersion === 1 &&
    Object.keys(value).every((key) =>
      key === 'schemaVersion' || key === 'surface' || key === 'objectRef',
    ) &&
    surfaces.has(value.surface) &&
    (value.objectRef === undefined || validShortText(value.objectRef, 500))
  );
}

function validRequest(
  ownerPluginId: string,
  request: PluginContextualFlowRequestV1,
): boolean {
  return (
    request.flowId.startsWith(`${ownerPluginId}.`) &&
    validShortText(request.flowId, 250) &&
    validShortText(request.title, 200) &&
    (request.backLabel === undefined || validShortText(request.backLabel, 80)) &&
    typeof request.render === 'function' &&
    (request.onLifecycle === undefined ||
      typeof request.onLifecycle === 'function') &&
    validSourceContext(request.sourceContext) &&
    validReturnContext(request.returnContext)
  );
}

function emitLifecycle(
  active: ActiveContextualFlowV1,
  reason: PluginContextualFlowLifecycleReasonV1,
): void {
  active.request.onLifecycle?.({ reason, flowId: active.request.flowId });
}

function restoreLauncherFocus(launcherKey: string): void {
  if (typeof document === 'undefined') return;
  const restore = () => {
    const launchers = document.querySelectorAll<HTMLElement>(
      '[data-eg-contextual-flow-launcher]',
    );
    const launcher = [...launchers].find(
      (candidate) =>
        candidate.dataset.egContextualFlowLauncher === launcherKey,
    );
    const target = launcher?.matches('button, [href], [tabindex]')
      ? launcher
      : launcher?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
    target?.focus();
  };
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(restore));
  } else {
    queueMicrotask(restore);
  }
}

export function useHostContextualFlowSurfaceV1(): HostContextualFlowSurfaceV1 {
  const [active, setActive] = React.useState<ActiveContextualFlowV1 | null>(
    null,
  );
  const activeRef = React.useRef<ActiveContextualFlowV1 | null>(null);

  const replaceActive = React.useCallback(
    (next: ActiveContextualFlowV1 | null) => {
      activeRef.current = next;
      setActive(next);
    },
    [],
  );

  return React.useMemo(
    () => ({
      active,
      open(ownerPluginId, launcherKey, request) {
        if (!validRequest(ownerPluginId, request)) return false;
        const current = activeRef.current;
        if (current && current.ownerPluginId !== ownerPluginId) return false;
        if (current) emitLifecycle(current, 'replaced');
        const next = { ownerPluginId, launcherKey, request };
        replaceActive(next);
        emitLifecycle(next, 'opened');
        return true;
      },
      close(ownerPluginId, reason) {
        const current = activeRef.current;
        if (!current || current.ownerPluginId !== ownerPluginId) return;
        replaceActive(null);
        emitLifecycle(current, reason);
        restoreLauncherFocus(current.launcherKey);
      },
      back(ownerPluginId) {
        const current = activeRef.current;
        if (!current || current.ownerPluginId !== ownerPluginId) return;
        replaceActive(null);
        emitLifecycle(current, 'returned');
        restoreLauncherFocus(current.launcherKey);
      },
    }),
    [active, replaceActive],
  );
}

const GlobalContextualFlowSurface =
  React.createContext<HostContextualFlowSurfaceV1 | null>(null);

export function useGlobalContextualFlowSurfaceV1(): HostContextualFlowSurfaceV1 | null {
  return React.useContext(GlobalContextualFlowSurface);
}

export function bindPluginContextualFlowControllerV1(
  surface: HostContextualFlowSurfaceV1,
  ownerPluginId: string,
  launcherKey: string,
  isAvailable: () => boolean,
): PluginContextualFlowControllerV1 {
  return {
    open(request) {
      return isAvailable()
        ? surface.open(ownerPluginId, launcherKey, request)
        : false;
    },
    close(reason = 'closed') {
      surface.close(ownerPluginId, reason);
    },
    back() {
      surface.back(ownerPluginId);
    },
  };
}

export function HostContextualFlowContentV1({
  surface,
}: {
  surface: HostContextualFlowSurfaceV1;
}): React.ReactNode {
  const active = surface.active;
  if (!active) return null;
  return active.request.render({
    sourceContext: Object.freeze({ ...active.request.sourceContext }),
    returnContext: active.request.returnContext
      ? Object.freeze({ ...active.request.returnContext })
      : undefined,
    close: () => surface.close(active.ownerPluginId, 'closed'),
    back: () => surface.back(active.ownerPluginId),
    complete: () => surface.close(active.ownerPluginId, 'completed'),
  });
}

export function HostContextualFlowProviderV1({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const surface = useHostContextualFlowSurfaceV1();
  const active = surface.active;
  return (
    <GlobalContextualFlowSurface.Provider value={surface}>
      {children}
      <Modal
        open={Boolean(active)}
        size="lg"
        modalHeading={active?.request.title ?? 'Contextual task'}
        primaryButtonText="Close"
        secondaryButtonText={
          active?.request.returnContext
            ? (active.request.backLabel ?? 'Back')
            : (undefined as unknown as string)
        }
        onRequestSubmit={() => {
          if (active) surface.close(active.ownerPluginId, 'closed');
        }}
        onSecondarySubmit={() => {
          if (active) surface.back(active.ownerPluginId);
        }}
        onRequestClose={() => {
          if (active) surface.close(active.ownerPluginId, 'cancelled');
        }}
      >
        <HostContextualFlowContentV1 surface={surface} />
      </Modal>
    </GlobalContextualFlowSurface.Provider>
  );
}

export const __contextualFlowRuntimeTestUtils = {
  validRequest,
  validSourceContext,
  validReturnContext,
};
