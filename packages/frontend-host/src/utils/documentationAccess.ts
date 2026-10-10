const storageKey = 'enterpriseglue.documentation.browser-request';
const lifetime = 15 * 60 * 1000;
type DocumentationRequest = { state: string; challenge: string; createdAt: number };
const valid = (value: unknown): value is DocumentationRequest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as DocumentationRequest;
  return /^[A-Za-z0-9_-]{43}$/.test(candidate.state) && /^[A-Za-z0-9_-]{43}$/.test(candidate.challenge)
    && Number.isFinite(candidate.createdAt) && candidate.createdAt <= Date.now() && candidate.createdAt > Date.now() - lifetime;
};
export function getDocumentationRequest(search: string): DocumentationRequest | null {
  try {
    const query = new URLSearchParams(search);
    if (query.has('state') || query.has('challenge')) {
      const next = { state: query.get('state'), challenge: query.get('challenge'), createdAt: Date.now() };
      if (!valid(next)) return null;
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    }
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    return valid(saved) ? saved : null;
  } catch { return null; }
}
export function clearDocumentationRequest(): void {
  try { sessionStorage.removeItem(storageKey); } catch { /* No authority is stored in browser storage. */ }
}
export function isDocumentationIntent(search: string): boolean {
  return new URLSearchParams(search).get('intent') === 'documentation';
}
export function accountDestination(documentation: boolean, registration = false): string {
  return documentation ? '/documentation/access' : registration ? '/cloud/onboarding' : '/login';
}
