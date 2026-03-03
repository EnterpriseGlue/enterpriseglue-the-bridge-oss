import React from 'react';
import { useRoutes } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { getEnterpriseFrontendPlugin } from './loadEnterpriseFrontendPlugin';

type Scope = 'root' | 'tenant';

export function EnterpriseRoutesHost({
  scope,
  fallbackTo,
}: {
  scope: Scope;
  fallbackTo?: string;
}) {
  const [routes, setRoutes] = React.useState<RouteObject[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    getEnterpriseFrontendPlugin()
      .then((plugin) => {
        if (cancelled) return;
        const list = scope === 'tenant' ? plugin.tenantRoutes : plugin.routes;
        setRoutes((Array.isArray(list) ? list : []) as RouteObject[]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [scope]);

  const element = useRoutes(routes);

  if (!loaded) return null;

  if (!element) {
    if (fallbackTo) return null;
    return null;
  }

  return element;
}
