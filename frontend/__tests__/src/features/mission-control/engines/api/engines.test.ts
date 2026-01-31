import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEngines,
  getEngine,
  createEngine,
  updateEngine,
  deleteEngine,
  getEngineHealth,
  testEngineConnection,
  getEngineMembers,
  addEngineMember,
  updateEngineMemberRole,
  removeEngineMember,
  type Engine,
  type EngineHealth,
  type EngineMember,
} from '@src/features/mission-control/engines/api/engines';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('engines API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEngines', () => {
    it('gets all engines', async () => {
      const mockEngines: Engine[] = [
        {
          id: 'e1',
          name: 'Engine 1',
          baseUrl: 'http://localhost:8080',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockEngines);

      const result = await getEngines();

      expect(apiClient.get).toHaveBeenCalledWith('/api/engines', undefined, { credentials: 'include' });
      expect(result).toEqual(mockEngines);
    });

    it('returns engines with all properties', async () => {
      const mockEngines: Engine[] = [
        {
          id: 'e1',
          name: 'Production Engine',
          baseUrl: 'https://camunda.example.com',
          tenantId: 'tenant1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          status: 'online',
          version: '7.18.0',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockEngines);

      const result = await getEngines();

      expect(result[0]).toEqual(mockEngines[0]);
    });
  });

  describe('getEngine', () => {
    it('gets engine by id', async () => {
      const mockEngine: Engine = {
        id: 'e1',
        name: 'Engine 1',
        baseUrl: 'http://localhost:8080',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockEngine);

      const result = await getEngine('e1');

      expect(apiClient.get).toHaveBeenCalledWith('/api/engines/e1', undefined, { credentials: 'include' });
      expect(result).toEqual(mockEngine);
    });
  });

  describe('createEngine', () => {
    it('creates engine with required fields', async () => {
      const newEngine = {
        name: 'New Engine',
        baseUrl: 'http://localhost:8080',
      };
      const mockResponse: Engine = {
        id: 'e1',
        ...newEngine,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await createEngine(newEngine);

      expect(apiClient.post).toHaveBeenCalledWith('/api/engines', newEngine, { credentials: 'include' });
      expect(result).toEqual(mockResponse);
    });

    it('creates engine with optional fields', async () => {
      const newEngine = {
        name: 'Tenant Engine',
        baseUrl: 'http://localhost:8080',
        tenantId: 'tenant1',
      };
      const mockResponse: Engine = {
        id: 'e1',
        ...newEngine,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await createEngine(newEngine);

      expect(result.tenantId).toBe('tenant1');
    });
  });

  describe('updateEngine', () => {
    it('updates engine with partial data', async () => {
      const updates = { name: 'Updated Engine' };
      const mockResponse: Engine = {
        id: 'e1',
        name: 'Updated Engine',
        baseUrl: 'http://localhost:8080',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      vi.mocked(apiClient.put).mockResolvedValue(mockResponse);

      const result = await updateEngine('e1', updates);

      expect(apiClient.put).toHaveBeenCalledWith('/api/engines/e1', updates, { credentials: 'include' });
      expect(result).toEqual(mockResponse);
    });

    it('updates multiple engine properties', async () => {
      const updates = {
        name: 'Updated Engine',
        baseUrl: 'https://new-url.com',
        tenantId: 'new-tenant',
      };
      vi.mocked(apiClient.put).mockResolvedValue({} as Engine);

      await updateEngine('e1', updates);

      expect(apiClient.put).toHaveBeenCalledWith('/api/engines/e1', updates, { credentials: 'include' });
    });
  });

  describe('deleteEngine', () => {
    it('deletes engine', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      await deleteEngine('e1');

      expect(apiClient.delete).toHaveBeenCalledWith('/api/engines/e1', { credentials: 'include' });
    });
  });

  describe('getEngineHealth', () => {
    it('gets engine health status UP', async () => {
      const mockHealth: EngineHealth = {
        status: 'UP',
        version: '7.18.0',
        deployedProcessDefinitions: 10,
        activeProcessInstances: 5,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockHealth);

      const result = await getEngineHealth('e1');

      expect(apiClient.get).toHaveBeenCalledWith('/api/engines/e1/health', undefined, { credentials: 'include' });
      expect(result).toEqual(mockHealth);
    });

    it('gets engine health status DOWN', async () => {
      const mockHealth: EngineHealth = {
        status: 'DOWN',
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockHealth);

      const result = await getEngineHealth('e1');

      expect(result.status).toBe('DOWN');
    });

    it('gets engine health status UNKNOWN', async () => {
      const mockHealth: EngineHealth = {
        status: 'UNKNOWN',
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockHealth);

      const result = await getEngineHealth('e1');

      expect(result.status).toBe('UNKNOWN');
    });
  });

  describe('testEngineConnection', () => {
    it('tests successful connection', async () => {
      const mockResponse = { success: true, message: 'Connection successful' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await testEngineConnection('http://localhost:8080');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/engines/test-connection',
        { baseUrl: 'http://localhost:8080' },
        { credentials: 'include' }
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
    });

    it('tests failed connection', async () => {
      const mockResponse = { success: false, message: 'Connection failed' };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await testEngineConnection('http://invalid-url');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed');
    });
  });

  describe('getEngineMembers', () => {
    it('gets engine members', async () => {
      const mockMembers: EngineMember[] = [
        {
          id: 'm1',
          engineId: 'e1',
          userId: 'u1',
          role: 'owner',
          grantedAt: '2024-01-01T00:00:00Z',
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockMembers);

      const result = await getEngineMembers('e1');

      expect(apiClient.get).toHaveBeenCalledWith('/api/engines/e1/members', undefined, { credentials: 'include' });
      expect(result).toEqual(mockMembers);
    });

    it('returns members with user details', async () => {
      const mockMembers: EngineMember[] = [
        {
          id: 'm1',
          engineId: 'e1',
          userId: 'u1',
          role: 'deployer',
          grantedById: 'u2',
          grantedAt: '2024-01-01T00:00:00Z',
          user: {
            id: 'u1',
            email: 'user@example.com',
            name: 'John Doe',
          },
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockMembers);

      const result = await getEngineMembers('e1');

      expect(result[0].user?.name).toBe('John Doe');
    });
  });

  describe('addEngineMember', () => {
    it('adds member with owner role', async () => {
      const mockMember: EngineMember = {
        id: 'm1',
        engineId: 'e1',
        userId: 'u1',
        role: 'owner',
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockMember);

      const result = await addEngineMember('e1', 'u1', 'owner');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/engines/e1/members',
        { userId: 'u1', role: 'owner' },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockMember);
    });

    it('adds member with delegate role', async () => {
      const mockMember: EngineMember = {
        id: 'm1',
        engineId: 'e1',
        userId: 'u1',
        role: 'delegate',
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockMember);

      await addEngineMember('e1', 'u1', 'delegate');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/engines/e1/members',
        { userId: 'u1', role: 'delegate' },
        { credentials: 'include' }
      );
    });

    it('adds member with deployer role', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({} as EngineMember);

      await addEngineMember('e1', 'u1', 'deployer');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/engines/e1/members',
        { userId: 'u1', role: 'deployer' },
        { credentials: 'include' }
      );
    });

    it('adds member with operator role', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({} as EngineMember);

      await addEngineMember('e1', 'u1', 'operator');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/engines/e1/members',
        { userId: 'u1', role: 'operator' },
        { credentials: 'include' }
      );
    });
  });

  describe('updateEngineMemberRole', () => {
    it('updates member role', async () => {
      const mockMember: EngineMember = {
        id: 'm1',
        engineId: 'e1',
        userId: 'u1',
        role: 'operator',
      };
      vi.mocked(apiClient.put).mockResolvedValue(mockMember);

      const result = await updateEngineMemberRole('e1', 'm1', 'operator');

      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/engines/e1/members/m1',
        { role: 'operator' },
        { credentials: 'include' }
      );
      expect(result).toEqual(mockMember);
    });

    it('updates role from operator to deployer', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({} as EngineMember);

      await updateEngineMemberRole('e1', 'm1', 'deployer');

      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/engines/e1/members/m1',
        { role: 'deployer' },
        { credentials: 'include' }
      );
    });
  });

  describe('removeEngineMember', () => {
    it('removes engine member', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      await removeEngineMember('e1', 'm1');

      expect(apiClient.delete).toHaveBeenCalledWith('/api/engines/e1/members/m1', { credentials: 'include' });
    });
  });
});
