export type PiiScope = 'processDetails' | 'history' | 'logs' | 'errors' | 'audit';

export type PiiDetection = {
  start: number;
  end: number;
  type: string;
  score?: number;
  source?: 'regex' | 'external';
};

export type Redaction = {
  start: number;
  end: number;
  type: string;
  replacement: string;
};

export interface PiiProviderOptions {
  language?: string;
  endpoint?: string | null;
  authHeader?: string | null;
  authToken?: string | null;
  projectId?: string | null;
  region?: string | null;
}

export interface PiiProvider {
  analyze(text: string, options?: PiiProviderOptions): Promise<PiiDetection[]>;
  anonymize(
    text: string,
    detections: PiiDetection[],
    options?: PiiProviderOptions
  ): Promise<{ text: string; redactions: Redaction[] }>;
}
