import type { PiiDetection, PiiProvider, PiiProviderOptions } from '../types.js';
import { buildAuthHeaders, postJson } from '../http.js';
import { applyRedactions, buildRedactions } from '../utils.js';

export class AwsComprehendProvider implements PiiProvider {
  async analyze(text: string, options?: PiiProviderOptions): Promise<PiiDetection[]> {
    if (!options?.endpoint) return [];
    const url = options.endpoint.replace(/\/$/, '');
    const body = { Text: text, LanguageCode: options?.language || 'en' };
    const headers = buildAuthHeaders(options);
    const response = await postJson<any>(url, body, headers);
    const entities = response?.Entities ?? [];
    return entities.map((item: any) => ({
      start: item?.BeginOffset ?? 0,
      end: item?.EndOffset ?? 0,
      type: item?.Type || 'UNKNOWN',
      score: item?.Score,
      source: 'external',
    }));
  }

  async anonymize(text: string, detections: PiiDetection[]): Promise<{ text: string; redactions: any[] }> {
    const redactions = buildRedactions(detections);
    return { text: applyRedactions(text, redactions), redactions };
  }
}
