import { GitOAuthAuthorizeResponseSchema, GitProviderIdParamsSchema, type GitCredential } from '@enterpriseglue/shared/schemas/git/repository.js';
import { apiClient } from '../../../shared/api/client';
import { getBrowserSessionRevision } from '../../../utils/browserSession';
import { getPersonalGitCredential, verifiedPersonalCredential } from './personalCredentials';

export const GIT_OAUTH_COMPLETED = 'enterpriseglue.git.oauth.completed';
export const GIT_OAUTH_FAILED = 'enterpriseglue.git.oauth.failed';
export const isGitOAuthState = (state: unknown): state is string => typeof state === 'string' && /^[a-f0-9]{64}$/.test(state);

/** Popup messages identify a continuation; only the authenticated API supplies credentials. */
export function beginGitOAuth(providerId: string, userId: string, assertCurrent: () => void): { result: Promise<GitCredential>; cancel: () => void } {
  assertCurrent();
  if (!userId || !GitProviderIdParamsSchema.safeParse({ providerId }).success) throw new Error('Git OAuth request was not verified');
  const session = getBrowserSessionRevision(), origin = window.location.origin;
  const popup = window.open('about:blank', `eg_git_oauth_${crypto.randomUUID()}`, 'width=600,height=700');
  if (!popup) throw new Error('Popup was blocked');
  const controller = new AbortController();
  let done = false, state: string | null = null, verifying = false;
  let rejectResult!: (error: Error) => void, resolveResult!: (credential: GitCredential) => void;
  const result = new Promise<GitCredential>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const check = () => { assertCurrent(); if (done || session !== getBrowserSessionRevision()) throw new Error('Git OAuth context changed'); };
  const cleanup = () => {
    window.clearInterval(poll); window.clearTimeout(deadline); window.removeEventListener('message', onMessage);
    controller.abort();
    try { popup.close(); } catch { /* Only the owned popup is closed. */ }
  };
  const fail = (message: string) => { if (!done) { done = true; cleanup(); rejectResult(new Error(message)); } };
  const onMessage = (event: MessageEvent) => {
    if (done || verifying || !state || event.origin !== origin || event.source !== popup) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.state !== state) return;
    if (data.type === GIT_OAUTH_FAILED && Object.keys(data).length === 2) { fail('Git OAuth authorization failed'); return; }
    if (data.type !== GIT_OAUTH_COMPLETED || Object.keys(data).length !== 3) return;
    void (async () => {
      try {
        check();
        const receipt = verifiedPersonalCredential(data.credential, userId, providerId);
        if (receipt.authType !== 'oauth') throw new Error('Unexpected credential kind');
        verifying = true;
        const retained = await getPersonalGitCredential(userId, providerId);
        check();
        if (retained.id !== receipt.id || retained.authType !== 'oauth') throw new Error('Credential readback mismatch');
        done = true; cleanup(); resolveResult(retained);
      } catch { fail('Git OAuth credential was not verified'); }
    })();
  };
  window.addEventListener('message', onMessage);
  const poll = window.setInterval(() => {
    try { check(); if (!verifying && popup.closed) fail('Git OAuth window closed before verification'); }
    catch { fail('Git OAuth context changed'); }
  }, 500);
  const deadline = window.setTimeout(() => fail('Git OAuth authorization timed out'), 10 * 60 * 1000);
  void (async () => {
    try {
      const response = GitOAuthAuthorizeResponseSchema.safeParse(await apiClient.get(`/git-api/oauth/${encodeURIComponent(providerId)}/authorize`, undefined, { signal: controller.signal }));
      check();
      if (!response.success || !isGitOAuthState(response.data.state)) throw new Error('Invalid authorization response');
      const url = new URL(response.data.authUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== response.data.state) throw new Error('Invalid authorization URL');
      state = response.data.state;
      popup.location.replace(url.href);
    } catch { fail('Git OAuth authorization was not verified'); }
  })();
  return { result, cancel: () => fail('Git OAuth cancelled') };
}
