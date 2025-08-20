import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InfisicalApi, InfisicalMembership, WorkspacePermissions, InfisicalRole } from '../../api/InfisicalApi';
import { MockTokenStore } from '../mocks/TokenStore.mock';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('InfisicalApi - Permissions Detection', () => {
  let api: InfisicalApi;
  let tokenStore: MockTokenStore;
  let mockAxiosInstance: any;

  const mockRole: InfisicalRole = {
    id: 'role1',
    name: 'Developer',
    slug: 'developer',
    permissions: ['secrets:read', 'secrets:write']
  };

  const mockMembership: InfisicalMembership = {
    id: 'membership1',
    identityId: 'identity1',
    roles: [mockRole],
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-02T00:00:00Z'
  };

  beforeEach(async () => {
    tokenStore = new MockTokenStore();
    
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      defaults: { baseURL: 'https://us.infisical.com' },
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    };

    mockedAxios.create = vi.fn().mockReturnValue(mockAxiosInstance);
    
    api = new InfisicalApi('https://us.infisical.com', tokenStore as any);

    const tokenInfo = {
      accessToken: 'valid-token',
      expiresAt: Date.now() + 3600000,
      renewalThresholdSeconds: 60
    };
    await tokenStore.setTokenInfo(tokenInfo);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listIdentityMemberships', () => {
    it('should successfully list identity memberships', async () => {
      const mockResponse = {
        identityMemberships: [mockMembership]
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.listIdentityMemberships('proj123');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v2/workspace/proj123/identity-memberships'
      );
      expect(result).toEqual([mockMembership]);
    });

    it('should return empty array on 403/404 errors', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce({
        response: { status: 403 }
      });

      const result = await api.listIdentityMemberships('proj123');

      expect(result).toEqual([]);
    });

    it('should throw on other errors', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(api.listIdentityMemberships('proj123')).rejects.toThrow('Network error');
    });
  });

  describe('detectWorkspacePermissions', () => {
    it('should extract permissions from memberships when available', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [mockMembership] }
      });

      const permissions = await api.detectWorkspacePermissions('proj123');

      expect(permissions).toMatchObject({
        canRead: true,
        canWrite: true,
        canDelete: false,
        canCreateSecrets: true,
        canUpdateSecrets: true,
        canDeleteSecrets: false,
        roles: ['Developer'],
        effectiveRole: 'member'
      });
    });

    it('should fall back to permission testing when no memberships', async () => {
      // Mock empty memberships response
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [] }
      });

      // Mock successful secrets listing (indicating read permission)
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { secrets: [] }
      });

      // Mock write permission test (POST should not return 403)
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 400 }, // Validation error, not permission error
        message: 'Validation failed'
      });

      const permissions = await api.detectWorkspacePermissions('proj123');

      expect(permissions.canRead).toBe(true);
      expect(permissions.canWrite).toBe(true);
      expect(permissions.effectiveRole).toBe('member');
    });

    it('should handle permission testing failure gracefully', async () => {
      // Mock empty memberships response
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [] }
      });

      // Mock failed secrets listing (no read permission)
      mockAxiosInstance.get.mockRejectedValueOnce({
        response: { status: 403 }
      });

      const permissions = await api.detectWorkspacePermissions('proj123');

      expect(permissions).toMatchObject({
        canRead: false,
        canWrite: false,
        canDelete: false,
        canCreateSecrets: false,
        canUpdateSecrets: false,
        canDeleteSecrets: false,
        roles: [],
        effectiveRole: 'no-access'
      });
    });
  });

  describe('extractPermissionsFromMemberships', () => {
    it('should correctly extract admin permissions', async () => {
      const adminRole: InfisicalRole = {
        id: 'role1',
        name: 'Admin',
        slug: 'admin',
        permissions: ['secrets:read', 'secrets:write', 'secrets:delete', 'workspace:admin']
      };

      const adminMembership: InfisicalMembership = {
        id: 'membership1',
        identityId: 'identity1',
        roles: [adminRole],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [adminMembership] }
      });

      const permissions = await api.detectWorkspacePermissions('proj123');

      expect(permissions).toMatchObject({
        canRead: true,
        canWrite: true,
        canDelete: true,
        canCreateSecrets: true,
        canUpdateSecrets: true,
        canDeleteSecrets: true,
        roles: ['Admin'],
        effectiveRole: 'admin'
      });
    });

    it('should correctly extract viewer permissions', async () => {
      const viewerRole: InfisicalRole = {
        id: 'role1',
        name: 'Viewer',
        slug: 'viewer',
        permissions: ['secrets:read']
      };

      const viewerMembership: InfisicalMembership = {
        id: 'membership1',
        identityId: 'identity1',
        roles: [viewerRole],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [viewerMembership] }
      });

      const permissions = await api.detectWorkspacePermissions('proj123');

      expect(permissions).toMatchObject({
        canRead: true,
        canWrite: false,
        canDelete: false,
        canCreateSecrets: false,
        canUpdateSecrets: false,
        canDeleteSecrets: false,
        roles: ['Viewer'],
        effectiveRole: 'viewer'
      });
    });

    it('should handle multiple roles correctly', async () => {
      const role1: InfisicalRole = {
        id: 'role1',
        name: 'Viewer',
        slug: 'viewer',
        permissions: ['secrets:read']
      };

      const role2: InfisicalRole = {
        id: 'role2',
        name: 'Developer',
        slug: 'developer',
        permissions: ['secrets:write']
      };

      const multiRoleMembership: InfisicalMembership = {
        id: 'membership1',
        identityId: 'identity1',
        roles: [role1, role2],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [multiRoleMembership] }
      });

      const permissions = await api.detectWorkspacePermissions('proj123');

      expect(permissions.roles).toEqual(['Viewer', 'Developer']);
      expect(permissions.canRead).toBe(true);
      expect(permissions.canWrite).toBe(true);
      expect(permissions.effectiveRole).toBe('member'); // Developer role takes precedence
    });
  });

  describe('handlePermissionDowngrade', () => {
    it('should cache downgraded permissions', async () => {
      const downgradedPermissions = await api.handlePermissionDowngrade('proj123', new Error('403 Forbidden'));

      expect(downgradedPermissions).toMatchObject({
        canRead: true,
        canWrite: false,
        canDelete: false,
        canCreateSecrets: false,
        canUpdateSecrets: false,
        canDeleteSecrets: false,
        roles: ['viewer'],
        effectiveRole: 'viewer'
      });

      // Check that permissions are cached
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toEqual(downgradedPermissions);
    });
  });

  describe('getWorkspacePermissions', () => {
    it('should return cached permissions', async () => {
      const testPermissions: WorkspacePermissions = {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canCreateSecrets: true,
        canUpdateSecrets: true,
        canDeleteSecrets: false,
        roles: ['Developer'],
        effectiveRole: 'member'
      };

      // First, detect permissions to populate cache
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [mockMembership] }
      });

      await api.detectWorkspacePermissions('proj123');

      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toBeTruthy();
      expect(cachedPermissions?.effectiveRole).toBe('member');
    });

    it('should return null for unknown workspace', () => {
      const permissions = api.getWorkspacePermissions('unknown-workspace');
      expect(permissions).toBeNull();
    });
  });

  describe('clearPermissionsCache', () => {
    it('should clear all cached permissions', async () => {
      // Populate cache
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { identityMemberships: [mockMembership] }
      });

      await api.detectWorkspacePermissions('proj123');
      expect(api.getWorkspacePermissions('proj123')).toBeTruthy();

      // Clear cache
      api.clearPermissionsCache();
      expect(api.getWorkspacePermissions('proj123')).toBeNull();
    });
  });
});