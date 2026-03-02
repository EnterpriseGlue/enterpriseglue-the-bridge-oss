import type { PiiDetection, PiiProvider, PiiProviderOptions } from '../types.js';
import { applyRedactions, buildRedactions } from '../utils.js';

const PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'EMAIL', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: 'PHONE', regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/g },
  { type: 'IBAN', regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { type: 'SSN', regex: /\b\d{3}-?\d{2}-?\d{4}\b/g },
  { type: 'CREDIT_CARD', regex: /\b(?:\d[ -]*?){13,19}\b/g },
  { type: 'IP_ADDRESS', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { type: 'URL', regex: /\bhttps?:\/\/[^\s]+\b/gi },
];

export class RegexProvider implements PiiProvider {
  async analyze(text: string, _options?: PiiProviderOptions): Promise<PiiDetection[]> {
    const detections: PiiDetection[] = [];
    for (const { type, regex } of PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = regex.exec(text)) !== null) {
        if (!match[0]) continue;
        detections.push({
          start: match.index,
          end: match.index + match[0].length,
          type,
          score: 0.7,
          source: 'regex',
        });
      }
    }
    return detections;
  }

  async anonymize(text: string, detections: PiiDetection[]): Promise<{ text: string; redactions: any[] }> {
    const redactions = buildRedactions(detections);
    return { text: applyRedactions(text, redactions), redactions };
  }
}
