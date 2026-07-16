export type IdentityProviderFailureCode =
  | 'invalid_credentials'
  | 'invalid_signature'
  | 'provider_unavailable'
  | 'timeout'
  | 'malformed_response'
  | 'missing_subject'
  | 'incomplete_entitlements';

/**
 * A stable diagnostic classification for protocol adapters. Browser login
 * routes intentionally retain their generic responses; callers that record
 * diagnostics can use this code without parsing or storing provider payloads.
 */
export class IdentityProviderFailure extends Error {
  readonly name = 'IdentityProviderFailure';
  readonly cause?: unknown;

  constructor(readonly code: IdentityProviderFailureCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
  }
}

export function classifyIdentityProviderFailure(
  error: unknown,
  fallback: IdentityProviderFailureCode = 'malformed_response',
): IdentityProviderFailure {
  if (error instanceof IdentityProviderFailure) return error;
  const message = error instanceof Error ? error.message : String(error || 'Identity provider request failed');
  const normalized = message.toLowerCase();
  const code: IdentityProviderFailureCode =
    /timed? out|aborterror|timeout/.test(normalized) ? 'timeout'
      : /incomplete.*group|group.*incomplete|overage/.test(normalized) ? 'incomplete_entitlements'
        : /credential|bind password|client secret|certificate reference/.test(normalized) ? 'invalid_credentials'
          : /signature|audience|recipient|nonce|signing key|jwt|id token|issuer/.test(normalized) ? 'invalid_signature'
            : /subject.*required|nameid|email address|did not include a dn/.test(normalized) ? 'missing_subject'
              : /unavailable|failed \([45]\d\d\)|fetch failed|certificate verification|network|search failed/.test(normalized) ? 'provider_unavailable'
                : fallback;
  return new IdentityProviderFailure(code, message, { cause: error });
}
