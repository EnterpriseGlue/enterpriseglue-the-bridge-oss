import { describe, expect, it } from 'vitest';

import {
  assertSafePluginFrontendEntryV1,
  type PluginFrontendAssetPolicyError,
} from './frontendAssetPolicy.js';

const bytes = (source: string) => Buffer.from(source, 'utf8');

describe('plugin frontend asset policy', () => {
  it('accepts a self-contained module that uses only the host context', async () => {
    await expect(
      assertSafePluginFrontendEntryV1(
        bytes(`
          const plugin = {
            apiVersion: "frontend.plugin.enterpriseglue.io/v1",
            pluginId: "io.enterpriseglue.reference",
            version: "1.0.0",
            activate(host) {
              const React = host.shared.react;
              const Button = host.shared.carbon.Button;
              return {
                routes: [{
                  id: "io.enterpriseglue.reference.home",
                  scope: "tenant",
                  relativePath: "reference",
                  component: () => React.createElement(Button, null, "Open")
                }]
              };
            }
          };
          export default plugin;
        `),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['module_import_forbidden', 'import React from "react"; export default React;'],
    ['module_import_forbidden', 'export default async () => import("./other.js");'],
    ['module_import_forbidden', 'export default import.meta.url;'],
    ['direct_network_forbidden', 'export default () => fetch("/api/raw");'],
    ['dynamic_code_forbidden', 'export default () => eval("1 + 1");'],
    [
      'unsafe_html_forbidden',
      'export default { activate: () => ({ dangerouslySetInnerHTML: {} }) };',
    ],
    [
      'global_style_forbidden',
      'export default () => document.head.append("style");',
    ],
    ['duplicate_runtime_forbidden', 'export default () => createRoot(node);'],
    [
      'executable_markdown_forbidden',
      'export default (text) => marked.parse(text);',
    ],
  ])('rejects %s source', async (code, source) => {
    await expect(
      assertSafePluginFrontendEntryV1(bytes(source)),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PluginFrontendAssetPolicyError>>({ code }),
    );
  });

  it('rejects empty, invalid UTF-8, and invalid module syntax', async () => {
    await expect(
      assertSafePluginFrontendEntryV1(new Uint8Array()),
    ).rejects.toMatchObject({ code: 'entry_size_invalid' });
    await expect(
      assertSafePluginFrontendEntryV1(Uint8Array.from([0xc3, 0x28])),
    ).rejects.toMatchObject({ code: 'entry_encoding_invalid' });
    await expect(
      assertSafePluginFrontendEntryV1(bytes('export default {')),
    ).rejects.toMatchObject({ code: 'entry_syntax_invalid' });
  });
});
