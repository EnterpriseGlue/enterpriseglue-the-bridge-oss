import { describe, it, expect } from 'vitest';
import type { FrontendPluginContext } from '@enterpriseglue/enterprise-plugin-api/frontend';

/**
 * Host Conformance Test — Layer 2 contract validation (frontend).
 *
 * Verifies that the OSS frontend host constructs a FrontendPluginContext
 * satisfying the contract interfaces defined in `@enterpriseglue/enterprise-plugin-api`.
 *
 * The host builds this context in loadEnterpriseFrontendPlugin.ts (lines 125-138)
 * and passes it to the EE plugin via `plugin.init(context)`.
 *
 * If someone removes or renames a host export that the contract promises,
 * this test fails — preventing silent breaks for EE consumers.
 */

describe('Frontend host contract conformance', () => {
  it('host provides apiClient matching PluginApiClient interface', async () => {
    const { apiClient } = await import('@src/shared/api/client');

    expect(typeof apiClient.get).toBe('function');
    expect(typeof apiClient.post).toBe('function');
    expect(typeof apiClient.put).toBe('function');
    expect(typeof apiClient.patch).toBe('function');
    expect(typeof apiClient.delete).toBe('function');
    expect(typeof apiClient.getBlob).toBe('function');
  });

  it('host provides API error utilities matching PluginApiErrorUtils interface', async () => {
    const { ApiError } = await import('@src/shared/api/client');
    const { parseApiError, getUiErrorMessage, getErrorMessageFromResponse } = await import(
      '@src/shared/api/apiErrorUtils'
    );

    expect(typeof ApiError).toBe('function');
    expect(typeof parseApiError).toBe('function');
    expect(typeof getUiErrorMessage).toBe('function');
    expect(typeof getErrorMessageFromResponse).toBe('function');
  });

  it('host provides PageHeader, PageLayout, PAGE_GRADIENTS matching contract', async () => {
    const { PageHeader, PageLayout, PAGE_GRADIENTS } = await import(
      '@src/shared/components/PageLayout'
    );

    expect(PageHeader).toBeDefined();
    expect(PageLayout).toBeDefined();
    expect(PAGE_GRADIENTS).toBeDefined();
    expect(typeof PAGE_GRADIENTS).toBe('object');
  });

  it('host provides ConfirmModal component', async () => {
    const mod = await import('@src/shared/components/ConfirmModal');
    const ConfirmModal = mod.default;

    expect(ConfirmModal).toBeDefined();
  });

  it('host provides InviteMemberModal component', async () => {
    const mod = await import('@src/components/InviteMemberModal');
    const InviteMemberModal = mod.default;

    expect(InviteMemberModal).toBeDefined();
  });

  it('host provides useAuth hook', async () => {
    const { useAuth } = await import('@src/shared/hooks/useAuth');
    expect(typeof useAuth).toBe('function');
  });

  it('host provides useModal hook', async () => {
    const { useModal } = await import('@src/shared/hooks/useModal');
    expect(typeof useModal).toBe('function');
  });

  it('host provides useToast hook', async () => {
    const { useToast } = await import('@src/shared/notifications/ToastProvider');
    expect(typeof useToast).toBe('function');
  });

  it('context object built from host exports satisfies FrontendPluginContext shape', async () => {
    const { apiClient, ApiError } = await import('@src/shared/api/client');
    const { parseApiError, getUiErrorMessage, getErrorMessageFromResponse } = await import(
      '@src/shared/api/apiErrorUtils'
    );
    const { PageHeader, PageLayout, PAGE_GRADIENTS } = await import(
      '@src/shared/components/PageLayout'
    );
    const confirmMod = await import('@src/shared/components/ConfirmModal');
    const inviteMod = await import('@src/components/InviteMemberModal');
    const { useAuth } = await import('@src/shared/hooks/useAuth');
    const { useModal } = await import('@src/shared/hooks/useModal');
    const { useToast } = await import('@src/shared/notifications/ToastProvider');

    // Build the same context object the host builds in loadEnterpriseFrontendPlugin.ts
    const context: FrontendPluginContext = {
      api: {
        client: apiClient,
        errors: {
          ApiError: ApiError as any,
          parseApiError,
          getUiErrorMessage,
          getErrorMessageFromResponse,
        },
      },
      components: {
        PageHeader,
        PageLayout,
        PAGE_GRADIENTS,
        ConfirmModal: confirmMod.default,
        InviteMemberModal: inviteMod.default,
      },
      hooks: { useAuth, useModal, useToast },
    };

    // If this assignment compiles, the host conforms to the contract.
    // Also verify at runtime that all branches are populated.
    expect(context.api.client).toBeDefined();
    expect(context.api.errors).toBeDefined();
    expect(context.components.PageHeader).toBeDefined();
    expect(context.components.PageLayout).toBeDefined();
    expect(context.components.PAGE_GRADIENTS).toBeDefined();
    expect(context.components.ConfirmModal).toBeDefined();
    expect(context.components.InviteMemberModal).toBeDefined();
    expect(context.hooks.useAuth).toBeDefined();
    expect(context.hooks.useModal).toBeDefined();
    expect(context.hooks.useToast).toBeDefined();
  });
});
