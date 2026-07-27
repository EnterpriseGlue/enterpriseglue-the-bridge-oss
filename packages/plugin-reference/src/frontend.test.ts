import { describe, expect, it } from 'vitest';

import plugin, { REFERENCE_PLUGIN_ID } from './frontend.js';

describe('reference plugin frontend', () => {
  it('uses only namespaced additive Carbon contributions', async () => {
    const host = {
      plugin: { id: plugin.pluginId, version: plugin.version },
      api: { request: async () => ({}) },
      navigation: { toContribution: () => undefined },
      notifications: { show: () => undefined },
      telemetry: { event: () => undefined },
      ui: {
        theme: 'g100',
        locale: 'en',
        direction: 'ltr',
        density: 'normal',
        prefersReducedMotion: false,
      },
      shared: {
        react: {
          createElement: () => null,
          useState: <T>(value: T) => [value, () => undefined],
        },
        reactDom: {},
        router: {},
        carbon: {
          Button: () => null,
          InlineNotification: () => null,
          Stack: () => null,
          Tag: () => null,
          Tile: () => null,
        },
        carbonIcons: {},
      },
    } as never;

    const contributions = await plugin.activate(host);
    expect(contributions.routes).toHaveLength(1);
    expect(contributions.navigation).toHaveLength(1);
    expect(contributions.slots ?? []).toEqual([]);
    expect(
      [
        ...(contributions.routes ?? []),
        ...(contributions.navigation ?? []),
      ].every((item) => item.id.startsWith(`${REFERENCE_PLUGIN_ID}.`)),
    ).toBe(true);
  });
});
