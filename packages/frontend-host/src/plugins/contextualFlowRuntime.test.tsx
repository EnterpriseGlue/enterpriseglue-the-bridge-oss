/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import type { PluginContextualFlowRequestV1 } from '@enterpriseglue/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  __contextualFlowRuntimeTestUtils,
  useHostContextualFlowSurfaceV1,
} from './contextualFlowRuntime';

function request(
  owner = 'io.enterpriseglue.alpha',
): PluginContextualFlowRequestV1 {
  return {
    flowId: `${owner}.incident-analysis`,
    title: 'Analyze incident',
    sourceContext: {
      schemaVersion: 1,
      objectType: 'incident',
      objectRef: 'incident-42',
      engineRef: 'engine-a',
    },
    returnContext: {
      schemaVersion: 1,
      surface: 'incident-detail',
      objectRef: 'incident-42',
    },
    render: () => null,
  };
}

describe('host contextual flow runtime', () => {
  it('accepts only namespaced flows with the closed safe context shape', () => {
    expect(
      __contextualFlowRuntimeTestUtils.validRequest(
        'io.enterpriseglue.alpha',
        request(),
      ),
    ).toBe(true);

    const wrongOwner = request();
    wrongOwner.flowId = 'io.enterpriseglue.beta.incident-analysis';
    expect(
      __contextualFlowRuntimeTestUtils.validRequest(
        'io.enterpriseglue.alpha',
        wrongOwner,
      ),
    ).toBe(false);

    const unsafe = request();
    (unsafe.sourceContext as unknown as Record<string, unknown>).variables = {
      customer: 'secret',
    };
    expect(
      __contextualFlowRuntimeTestUtils.validRequest(
        'io.enterpriseglue.alpha',
        unsafe,
      ),
    ).toBe(false);
  });

  it('prevents cross-plugin replacement and emits deterministic lifecycle events', () => {
    const lifecycle = vi.fn();
    const first = { ...request(), onLifecycle: lifecycle };
    const replacement = {
      ...request(),
      flowId: 'io.enterpriseglue.alpha.replacement',
      onLifecycle: lifecycle,
    };
    const { result } = renderHook(() => useHostContextualFlowSurfaceV1());

    act(() => {
      expect(
        result.current.open(
          'io.enterpriseglue.alpha',
          'launcher-alpha',
          first,
        ),
      ).toBe(true);
    });
    expect(result.current.active?.request.flowId).toBe(first.flowId);

    act(() => {
      expect(
        result.current.open(
          'io.enterpriseglue.beta',
          'launcher-beta',
          request('io.enterpriseglue.beta'),
        ),
      ).toBe(false);
    });
    expect(result.current.active?.ownerPluginId).toBe(
      'io.enterpriseglue.alpha',
    );

    act(() => {
      expect(
        result.current.open(
          'io.enterpriseglue.alpha',
          'launcher-alpha',
          replacement,
        ),
      ).toBe(true);
    });
    act(() => result.current.back('io.enterpriseglue.alpha'));

    expect(lifecycle.mock.calls.map(([event]) => event.reason)).toEqual([
      'opened',
      'replaced',
      'opened',
      'returned',
    ]);
    expect(result.current.active).toBeNull();
  });
});
