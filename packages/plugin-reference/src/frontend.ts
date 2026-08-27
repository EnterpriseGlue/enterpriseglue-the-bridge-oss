import type {
  FrontendPluginHostContextV1,
  PluginFrontendModuleV1,
  PluginRoutePropsV1,
} from '@enterpriseglue/plugin-sdk';

export const REFERENCE_PLUGIN_ID =
  'io.enterpriseglue.reference-health' as const;
export const REFERENCE_PLUGIN_VERSION = '0.1.0' as const;
export const REFERENCE_STATUS_OPERATION =
  `${REFERENCE_PLUGIN_ID}.read-status` as const;
export const REFERENCE_QUALIFICATION_OPERATION =
  `${REFERENCE_PLUGIN_ID}.qualify-runtime` as const;
export const REFERENCE_SCHEDULE_DELIVERY_OPERATION =
  `${REFERENCE_PLUGIN_ID}.deliver-scheduled-health` as const;
export const REFERENCE_EVENT_DELIVERY_OPERATION =
  `${REFERENCE_PLUGIN_ID}.consume-engine-inventory` as const;
export const REFERENCE_SCHEDULE_JOB_TYPE =
  `${REFERENCE_PLUGIN_ID}.health-check` as const;
const STATUS_ROUTE_ID = `${REFERENCE_PLUGIN_ID}.status`;

interface ReferenceStatus {
  status: 'ready';
  pluginId: typeof REFERENCE_PLUGIN_ID;
  version: typeof REFERENCE_PLUGIN_VERSION;
  apiRevision: '1';
}

function statusPage(host: FrontendPluginHostContextV1) {
  const React = host.shared.react;
  const { Button, InlineNotification, Stack, Tag, Tile } = host.shared.carbon;

  return function ReferenceStatusPage(_props: PluginRoutePropsV1) {
    const [status, setStatus] = React.useState<ReferenceStatus | null>(null);
    const [failed, setFailed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const refresh = async () => {
      setBusy(true);
      setFailed(false);
      try {
        setStatus(
          await host.api.request<ReferenceStatus>(
            REFERENCE_STATUS_OPERATION,
            { method: 'GET' },
          ),
        );
      } catch {
        setStatus(null);
        setFailed(true);
      } finally {
        setBusy(false);
      }
    };

    return React.createElement(
      'main',
      {
        style: {
          padding: 'var(--cds-spacing-07)',
          maxWidth: '48rem',
          margin: '0 auto',
        },
      },
      React.createElement(
        Stack,
        { gap: 6 },
        React.createElement('h1', null, 'Reference plugin'),
        React.createElement(
          'p',
          null,
          'A read-only, non-ION plugin proving the public plugin contracts are reusable.',
        ),
        failed
          ? React.createElement(InlineNotification, {
              kind: 'error',
              lowContrast: true,
              title: 'Reference sidecar unavailable',
              subtitle:
                'The host gateway rejected or could not reach the isolated plugin backend.',
              hideCloseButton: true,
            })
          : null,
        React.createElement(
          Tile,
          null,
          React.createElement(
            Stack,
            { gap: 4 },
            React.createElement(
              'div',
              null,
              React.createElement(
                Tag,
                { type: status ? 'green' : 'gray' },
                status?.status ?? 'not checked',
              ),
            ),
            status
              ? React.createElement(
                  'p',
                  null,
                  `${status.pluginId} ${status.version} · API ${status.apiRevision}`,
                )
              : null,
            React.createElement(
              Button,
              {
                type: 'button',
                size: 'sm',
                disabled: busy,
                onClick: refresh,
              },
              busy ? 'Checking…' : 'Check plugin status',
            ),
          ),
        ),
      ),
    );
  };
}

const plugin: PluginFrontendModuleV1 = {
  apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
  pluginId: REFERENCE_PLUGIN_ID,
  version: REFERENCE_PLUGIN_VERSION,
  activate(host) {
    return {
      routes: [
        {
          id: STATUS_ROUTE_ID,
          scope: 'tenant',
          relativePath: 'reference-plugin',
          component: statusPage(host),
        },
      ],
      navigation: [
        {
          id: `${REFERENCE_PLUGIN_ID}.navigation`,
          label: 'Reference plugin',
          routeId: STATUS_ROUTE_ID,
          section: 'main',
          order: 90,
        },
      ],
    };
  },
};

export default plugin;
