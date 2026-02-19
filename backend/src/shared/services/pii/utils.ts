import type { PiiDetection, Redaction } from './types.js';

export function buildRedactions(detections: PiiDetection[], redactionStyle = '<TYPE>'): Redaction[] {
  return detections.map((d) => ({
    start: d.start,
    end: d.end,
    type: d.type,
    replacement: redactionStyle.includes('<TYPE>')
      ? redactionStyle.replace('<TYPE>', d.type)
      : redactionStyle,
  }));
}

export function applyRedactions(text: string, redactions: Redaction[]): string {
  if (!redactions.length) return text;
  const ordered = [...redactions].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let cursor = 0;
  for (const r of ordered) {
    if (r.start < cursor) continue;
    out += text.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  out += text.slice(cursor);
  return out;
}

export function mergeDetections(detections: PiiDetection[]): PiiDetection[] {
  if (!detections.length) return [];
  const ordered = [...detections].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const merged: PiiDetection[] = [];
  for (const d of ordered) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(d);
      continue;
    }
    if (d.start < last.end) {
      const dLen = d.end - d.start;
      const lastLen = last.end - last.start;
      const dPriority = d.source === 'external' ? 2 : 1;
      const lastPriority = last.source === 'external' ? 2 : 1;
      if (dPriority > lastPriority || (dPriority === lastPriority && dLen > lastLen)) {
        merged[merged.length - 1] = d;
      }
      continue;
    }

    // Merge adjacent spans of same type if close
    if (d.start - last.end <= 1 && d.type === last.type) {
      merged[merged.length - 1] = {
        ...last,
        end: d.end,
        score: Math.max(last.score ?? 0, d.score ?? 0) || last.score || d.score,
      };
      continue;
    }

    merged.push(d);
  }
  return merged;
}
