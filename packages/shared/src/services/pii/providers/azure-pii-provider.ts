import type { PiiDetection, PiiProvider, PiiProviderOptions } from '../types.js';
import { buildAuthHeaders, postJson } from '../http.js';
import { applyRedactions, buildRedactions } from '../utils.js';

export class AzurePiiProvider implements PiiProvider {
  async analyze(text: string, options?: PiiProviderOptions): Promise<PiiDetection[]> {
    if (!options?.endpoint) return [];
    const base = options.endpoint.replace(/\/$/, '');
    const url = `${base}/language/:analyze-text?api-version=2023-04-01`;
    const body = {
      kind: 'PiiEntityRecognition',
      analysisInput: {
        documents: [{ id: '1', language: options?.language || 'en', text }],
      },
    };
    const headers = buildAuthHeaders(options);
    const response = await postJson<any>(url, body, headers);
    const entities = response?.results?.documents?.[0]?.entities ?? [];
    return entities.map((item: any) => ({
      start: item?.offset ?? 0,
      end: (item?.offset ?? 0) + (item?.length ?? 0),
      type: item?.category || 'UNKNOWN',
      score: item?.confidenceScore,
      source: 'external',
    }));
  }

  async anonymize(text: string, detections: PiiDetection[]): Promise<{ text: string; redactions: any[] }> {
    const redactions = buildRedactions(detections);
    return { text: applyRedactions(text, redactions), redactions };
  }
}
