import type { PiiDetection, PiiProvider, PiiProviderOptions } from '../types.js';
import { buildAuthHeaders, postJson } from '../http.js';
import { applyRedactions, buildRedactions } from '../utils.js';

const DEFAULT_INFO_TYPES = ['PERSON_NAME', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IBAN', 'CREDIT_CARD_NUMBER'];

export class GcpDlpProvider implements PiiProvider {
  async analyze(text: string, options?: PiiProviderOptions): Promise<PiiDetection[]> {
    if (!options?.endpoint || !options?.projectId) return [];
    const location = options.region || 'global';
    const base = options.endpoint.replace(/\/$/, '');
    const url = `${base}/v2/projects/${options.projectId}/locations/${location}/content:inspect`;
    const body = {
      item: { value: text },
      inspectConfig: {
        infoTypes: DEFAULT_INFO_TYPES.map((name) => ({ name })),
        includeQuote: true,
      },
    };
    const headers = buildAuthHeaders(options);
    const response = await postJson<any>(url, body, headers);
    const findings = response?.result?.findings ?? [];
    return findings.map((item: any) => ({
      start: item?.location?.byteRange?.start ?? 0,
      end: item?.location?.byteRange?.end ?? 0,
      type: item?.infoType?.name || 'UNKNOWN',
      score: item?.likelihood ? Number(item.likelihood) : undefined,
      source: 'external',
    }));
  }

  async anonymize(text: string, detections: PiiDetection[]): Promise<{ text: string; redactions: any[] }> {
    const redactions = buildRedactions(detections);
    return { text: applyRedactions(text, redactions), redactions };
  }
}
