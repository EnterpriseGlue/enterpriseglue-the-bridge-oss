import { describe, it, expect, vi } from 'vitest';
import { platformAdminApi } from '@src/api/platform-admin/admin';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('platformAdminApi', () => {
  it('calls getSettings endpoint', async () => {
    (apiClient.get as any).mockResolvedValue({ syncPushEnabled: true });
    const result = await platformAdminApi.getSettings();
    expect(apiClient.get).toHaveBeenCalledWith('/api/admin/settings');
    expect(result).toBeDefined();
  });

  it('calls updateSettings endpoint', async () => {
    (apiClient.put as any).mockResolvedValue({ success: true });
    await platformAdminApi.updateSettings({ syncPushEnabled: false });
    expect(apiClient.put).toHaveBeenCalledWith('/api/admin/settings', { syncPushEnabled: false });
  });

  it('calls getEnvironments endpoint', async () => {
    (apiClient.get as any).mockResolvedValue([]);
    await platformAdminApi.getEnvironments();
    expect(apiClient.get).toHaveBeenCalledWith('/api/admin/environments');
  });

  it('calls createEnvironment endpoint', async () => {
    (apiClient.post as any).mockResolvedValue({ id: 'env-1', name: 'Test' });
    await platformAdminApi.createEnvironment({ name: 'Test' });
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/environments', { name: 'Test' });
  });

  it('calls deleteEnvironment endpoint', async () => {
    (apiClient.delete as any).mockResolvedValue({});
    await platformAdminApi.deleteEnvironment('env-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/admin/environments/env-1');
  });

  it('calls getUsers endpoint', async () => {
    (apiClient.get as any).mockResolvedValue([]);
    await platformAdminApi.getUsers({ limit: 10 });
    expect(apiClient.get).toHaveBeenCalledWith('/api/users', { limit: 10 });
  });

  it('calls searchUsers endpoint', async () => {
    (apiClient.get as any).mockResolvedValue([]);
    await platformAdminApi.searchUsers('test');
    expect(apiClient.get).toHaveBeenCalledWith('/api/admin/users/search', { q: 'test' });
  });
});
