import type { Request } from 'express';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { hash, safeDecrypt } from '@enterpriseglue/shared/services/encryption.js';
import { RegexProvider } from './providers/regex-provider.js';
import { PresidioProvider } from './providers/presidio-provider.js';
import { GcpDlpProvider } from './providers/gcp-dlp-provider.js';
import { AwsComprehendProvider } from './providers/aws-comprehend-provider.js';
import { AzurePiiProvider } from './providers/azure-pii-provider.js';
import { applyRedactions, buildRedactions, mergeDetections } from './utils.js';
import type { PiiDetection, PiiProvider, PiiProviderOptions, PiiScope } from './types.js';

const DEFAULT_TENANT_ID = 'default';
const DEFAULT_DENY_KEYS = ['password', 'secret', 'token', 'ssn', 'iban'];
const VALID_SCOPES: PiiScope[] = ['processDetails', 'history', 'logs', 'errors', 'audit'];

export type PiiSettings = {
  piiRegexEnabled: boolean;
  piiExternalProviderEnabled: boolean;
  piiExternalProviderType: string | null;
  piiExternalProviderEndpoint: string | null;
  piiExternalProviderAuthHeader: string | null;
  piiExternalProviderAuthToken: string | null;
  piiExternalProviderProjectId: string | null;
  piiExternalProviderRegion: string | null;
  piiRedactionStyle: string;
  piiScopes: PiiScope[];
  piiMaxPayloadSizeBytes: number;
};

type SettingsResolver = (req: Request) => Promise<PiiSettings>;

class PiiRedactionService {
  private readonly regexProvider = new RegexProvider();
  private readonly providers: Record<string, PiiProvider> = {
    presidio: new PresidioProvider(),
    gcp_dlp: new GcpDlpProvider(),
    aws_comprehend: new AwsComprehendProvider(),
    azure_pii: new AzurePiiProvider(),
  };
  private readonly cache = new Map<string, string>();
  private readonly cacheLimit = 1000;

  async redactPayload(req: Request, payload: any, scope: PiiScope): Promise<any> {
    const settings = await this.resolveSettings(req);
    if (!this.isEnabled(settings, scope)) return payload;

    const tenantId = req.tenant?.tenantId || DEFAULT_TENANT_ID;
    return this.redactValue(payload, settings, tenantId);
  }

  private async resolveSettings(req: Request): Promise<PiiSettings> {
    const resolver = req.app?.locals?.piiSettingsResolver as SettingsResolver | undefined;
    if (resolver) return resolver(req);
    const settings = await platformSettingsService.getWithSecrets();
    return {
      ...settings,
      piiScopes: this.normalizeScopes(settings.piiScopes),
    };
  }

  private isEnabled(settings: PiiSettings, scope: PiiScope): boolean {
    if (!settings.piiRegexEnabled && !settings.piiExternalProviderEnabled) return false;
    if (!Array.isArray(settings.piiScopes)) return false;
    return settings.piiScopes.includes(scope);
  }

  private async redactValue(value: any, settings: PiiSettings, tenantId: string): Promise<any> {
    if (value == null) return value;
    if (typeof value === 'string') {
      return this.redactText(value, settings, tenantId);
    }
    if (Array.isArray(value)) {
      const out = await Promise.all(value.map((item) => this.redactValue(item, settings, tenantId)));
      return out;
    }
    if (typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && this.shouldDenyKey(key)) {
          out[key] = buildRedactions([{ start: 0, end: child.length, type: 'SENSITIVE' }], settings.piiRedactionStyle)
            .map((r) => r.replacement)
            .join('');
          continue;
        }
        out[key] = await this.redactValue(child, settings, tenantId);
      }
      return out;
    }
    return value;
  }

  private shouldDenyKey(key: string): boolean {
    const normalized = String(key || '').toLowerCase();
    return DEFAULT_DENY_KEYS.some((deny) => normalized.includes(deny));
  }

  private async redactText(text: string, settings: PiiSettings, tenantId: string): Promise<string> {
    if (!text) return text;
    const cacheKey = this.buildCacheKey(text, settings, tenantId);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const detections: PiiDetection[] = [];
    if (settings.piiRegexEnabled) {
      detections.push(...(await this.regexProvider.analyze(text)));
    }

    if (settings.piiExternalProviderEnabled && settings.piiExternalProviderType) {
      const provider = this.providers[settings.piiExternalProviderType];
      if (provider && this.canSendExternal(text, settings.piiMaxPayloadSizeBytes)) {
        try {
          const external = await provider.analyze(text, this.toProviderOptions(settings));
          detections.push(...external.map((d): PiiDetection => ({ ...d, source: 'external' as const })));
        } catch {
          // External provider failure should not block regex-only redaction
        }
      }
    }

    const merged = mergeDetections(detections);
    if (!merged.length) {
      this.setCache(cacheKey, text);
      return text;
    }

    const redactions = buildRedactions(merged, settings.piiRedactionStyle);
    const redacted = applyRedactions(text, redactions);
    this.setCache(cacheKey, redacted);
    return redacted;
  }

  private canSendExternal(text: string, maxBytes: number): boolean {
    return Buffer.byteLength(text, 'utf8') <= maxBytes;
  }

  private toProviderOptions(settings: PiiSettings): PiiProviderOptions {
    return {
      endpoint: settings.piiExternalProviderEndpoint,
      authHeader: settings.piiExternalProviderAuthHeader,
      authToken: settings.piiExternalProviderAuthToken
        ? safeDecrypt(settings.piiExternalProviderAuthToken)
        : null,
      projectId: settings.piiExternalProviderProjectId,
      region: settings.piiExternalProviderRegion,
    };
  }

  private normalizeScopes(scopes: string[]): PiiScope[] {
    return (scopes || []).filter((scope): scope is PiiScope => VALID_SCOPES.includes(scope as PiiScope));
  }

  private buildCacheKey(text: string, settings: PiiSettings, tenantId: string): string {
    const signature = [
      settings.piiRegexEnabled ? 'r1' : 'r0',
      settings.piiExternalProviderEnabled ? settings.piiExternalProviderType || 'none' : 'none',
      settings.piiRedactionStyle || '<TYPE>',
      settings.piiMaxPayloadSizeBytes,
    ].join(':');
    return `${tenantId}:${signature}:${hash(text)}`;
  }

  private setCache(key: string, value: string) {
    this.cache.set(key, value);
    if (this.cache.size > this.cacheLimit) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }
}

export const piiRedactionService = new PiiRedactionService();
