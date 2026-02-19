import type { PiiDetection, PiiProvider, PiiProviderOptions } from '../types.js';
import { buildAuthHeaders, postJson } from '../http.js';
import { applyRedactions, buildRedactions } from '../utils.js';

export class PresidioProvider implements PiiProvider {
  async analyze(text: string, options?: PiiProviderOptions): Promise<PiiDetection[]> {
    if (!options?.endpoint) return [];
    const url = `${options.endpoint.replace(/\/$/, '')}/analyze`;
    const body = { text, language: options?.language || 'en' };
    const headers = buildAuthHeaders(options);
    const response = await postJson<any[]>(url, body, headers);
    return (response || []).map((item) => ({
      start: item.start,
      end: item.end,
      type: item.entity_type || item.type || 'UNKNOWN',
      score: item.score,
      source: 'external',
    }));
  }

  async anonymize(text: string, detections: PiiDetection[]): Promise<{ text: string; redactions: any[] }> {
    const redactions = buildRedactions(detections);
    return { text: applyRedactions(text, redactions), redactions };
  }
}
