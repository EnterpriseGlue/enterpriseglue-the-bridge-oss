import { init, parse } from 'es-module-lexer';

export const PLUGIN_FRONTEND_ENTRY_MAX_BYTES = 20 * 1024 * 1024;

export type PluginFrontendAssetPolicyErrorCode =
  | 'entry_size_invalid'
  | 'entry_encoding_invalid'
  | 'entry_syntax_invalid'
  | 'module_import_forbidden'
  | 'direct_network_forbidden'
  | 'dynamic_code_forbidden'
  | 'unsafe_html_forbidden'
  | 'global_style_forbidden'
  | 'duplicate_runtime_forbidden'
  | 'executable_markdown_forbidden';

export class PluginFrontendAssetPolicyError extends Error {
  constructor(
    public readonly code: PluginFrontendAssetPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginFrontendAssetPolicyError';
  }
}

interface ForbiddenSourcePattern {
  code: Exclude<
    PluginFrontendAssetPolicyErrorCode,
    | 'entry_size_invalid'
    | 'entry_encoding_invalid'
    | 'entry_syntax_invalid'
    | 'module_import_forbidden'
  >;
  pattern: RegExp;
  message: string;
}

const forbiddenSourcePatterns: readonly ForbiddenSourcePattern[] = [
  {
    code: 'direct_network_forbidden',
    pattern:
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|\bnavigator\s*\.\s*sendBeacon\b|\bwindow\s*\.\s*open\b|\blocation\s*\.\s*(?:assign|replace)\b|\blocation\s*\.\s*href\s*=/,
    message:
      'Plugin frontend modules must use host API and navigation ports instead of direct browser network or navigation primitives',
  },
  {
    code: 'dynamic_code_forbidden',
    pattern:
      /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]|\bset(?:Timeout|Interval)\s*\(\s*["'`]/,
    message:
      'Plugin frontend modules must not evaluate strings as executable code',
  },
  {
    code: 'unsafe_html_forbidden',
    pattern:
      /\bdangerouslySetInnerHTML\b|(?:^|[^A-Za-z0-9_$])innerHTML\s*=|\binsertAdjacentHTML\b|\bdocument\s*\.\s*write\b|\bDOMParser\b/,
    message:
      'Plugin frontend modules must render structured components and text without executable HTML sinks',
  },
  {
    code: 'global_style_forbidden',
    pattern:
      /\bdocument\s*\.\s*head\b|\bcreateElement\s*\(\s*["'`](?:style|link)["'`]\s*\)|\badoptedStyleSheets\b|\bCSSStyleSheet\b/,
    message:
      'Plugin frontend modules must not install global styles or stylesheets',
  },
  {
    code: 'duplicate_runtime_forbidden',
    pattern:
      /\bReactDOM\b|\b(?:createRoot|hydrateRoot)\s*\(|__REACT_DEVTOOLS_GLOBAL_HOOK__|__SECRET_INTERNALS_DO_NOT_USE|__CLIENT_INTERNALS_DO_NOT_USE|react(?:-dom)?\.production\.min/,
    message:
      'Plugin frontend modules must use the exact host-owned React and Carbon runtimes',
  },
  {
    code: 'executable_markdown_forbidden',
    pattern:
      /\b(?:ReactMarkdown|reactMarkdown|MarkdownIt|markdownit|marked\s*\.\s*parse|remarkHtml|rehypeRaw)\b/,
    message:
      'Plugin frontend modules must not turn support Markdown or HTML into executable DOM',
  },
];

/**
 * Validate one signed same-origin frontend entry before it is staged or served.
 *
 * The v1 frontend format is deliberately a single, self-contained ESM file. It
 * receives React, Carbon, routing, API, navigation, notification, and telemetry
 * only through the host context. This verifier is defense in depth for trusted
 * publisher code; it does not turn same-origin JavaScript into an untrusted-code
 * sandbox.
 */
export async function assertSafePluginFrontendEntryV1(
  bytes: Uint8Array,
): Promise<void> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > PLUGIN_FRONTEND_ENTRY_MAX_BYTES
  ) {
    throw new PluginFrontendAssetPolicyError(
      'entry_size_invalid',
      'Plugin frontend entry has an invalid size',
    );
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PluginFrontendAssetPolicyError(
      'entry_encoding_invalid',
      'Plugin frontend entry is not valid UTF-8',
    );
  }
  if (source.includes('\0')) {
    throw new PluginFrontendAssetPolicyError(
      'entry_encoding_invalid',
      'Plugin frontend entry contains a NUL byte',
    );
  }

  await init;
  let imports: ReturnType<typeof parse>[0];
  try {
    [imports] = parse(source);
  } catch {
    throw new PluginFrontendAssetPolicyError(
      'entry_syntax_invalid',
      'Plugin frontend entry is not valid ECMAScript module syntax',
    );
  }
  if (imports.length > 0) {
    throw new PluginFrontendAssetPolicyError(
      'module_import_forbidden',
      'Plugin frontend entry must be a self-contained module without imports or import.meta',
    );
  }

  for (const forbidden of forbiddenSourcePatterns) {
    if (forbidden.pattern.test(source)) {
      throw new PluginFrontendAssetPolicyError(
        forbidden.code,
        forbidden.message,
      );
    }
  }
}
