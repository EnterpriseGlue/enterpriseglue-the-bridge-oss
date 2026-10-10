import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentationAccess from '@src/pages/DocumentationAccess';
import Signup from '@src/pages/Signup';
import CloudEmailAuth from '@src/pages/CloudEmailAuth';
import { apiClient } from '@src/shared/api/client';
import { accountDestination, getDocumentationRequest } from '@src/utils/documentationAccess';
import userEvent from '@testing-library/user-event';
vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, isLoading: false }) }));
vi.mock('@src/shared/components/PublicAuthShell', () => ({ default: ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => <><h1>{title}</h1><p>{description}</p>{children}</> }));
vi.mock('@src/enterprise/extensionRegistry', () => ({ isMultiTenantEnabled: () => false }));
const browserRequest = `?state=${'s'.repeat(43)}&challenge=${'c'.repeat(43)}`;
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.mocked(apiClient.get).mockResolvedValue([{ id: 'google', displayName: 'Google', protocol: 'oidc' }]); vi.mocked(apiClient.post).mockResolvedValue({}); });
describe('documentation-only account entry', () => {
  it('offers existing account methods without requesting organization provisioning', async () => {
    render(<MemoryRouter initialEntries={[`/documentation/access${browserRequest}`]}><DocumentationAccess /></MemoryRouter>);
    expect(screen.getByText(/No Cloud organization or workspace is required/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/signup?intent=documentation');
    expect(screen.getByRole('link', { name: 'Sign in with a passkey' })).toHaveAttribute('href', '/signup/email/signin?intent=documentation');
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.get).toHaveBeenCalledWith('/api/auth/cloud-signup/providers');
  });
  it('uses the configured staging documentation origin without an organization route when browser context is missing', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ documentationOrigin: 'https://docs.staging.enterpriseglue.ai' });
    render(<MemoryRouter initialEntries={['/documentation/access']}><DocumentationAccess /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Open documentation' })).toHaveAttribute('href', 'https://docs.staging.enterpriseglue.ai');
    expect(apiClient.get).toHaveBeenCalledExactlyOnceWith('/api/auth/documentation/configuration');
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('keeps a documentation request across the identity-provider redirect without accepting external destinations', () => {
    const first = getDocumentationRequest(browserRequest); expect(first).not.toBeNull();
    expect(getDocumentationRequest('')).toEqual(first);
    expect(accountDestination(true, true)).toBe('/documentation/access');
    expect(getDocumentationRequest('?state=bad&challenge=bad&returnTo=https://other.test')).toBeNull();
  });
  it('uses documentation copy and preserves the account-only email method', async () => {
    render(<MemoryRouter initialEntries={['/signup?intent=documentation']}><Signup /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Create your EnterpriseGlue account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with email' })).toHaveAttribute('href', '/signup/email?intent=documentation');
    expect(screen.queryByText(/then create your EnterpriseGlue organization/)).not.toBeInTheDocument();
  });
  it('carries documentation intent into email verification without a provisioning request', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/signup/email?intent=documentation']}><CloudEmailAuth /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'reader@example.test');
    await user.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/auth/cloud-signup/email/request', { email: 'reader@example.test', intent: 'documentation' });
  });
});
