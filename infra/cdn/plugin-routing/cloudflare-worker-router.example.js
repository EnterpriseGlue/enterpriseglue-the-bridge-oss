const BACKEND_PREFIXES = [
  '/_enterpriseglue/plugins/',
  '/api/',
  '/engines-api/',
  '/starbase-api/',
  '/mission-control-api/',
  '/git-api/',
  '/vcs-api/',
  '/health',
];

function usesBackend(pathname) {
  if (BACKEND_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return /^\/t\/[^/]+\/(api|engines-api|starbase-api|mission-control-api|git-api|vcs-api|health)(\/|$)/.test(
    pathname,
  );
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (usesBackend(incoming.pathname)) {
      const backend = new URL(env.ENTERPRISEGLUE_BACKEND_ORIGIN);
      backend.pathname = incoming.pathname;
      backend.search = incoming.search;
      return fetch(new Request(backend, request));
    }
    return env.ENTERPRISEGLUE_STATIC_FRONTEND.fetch(request);
  },
};
