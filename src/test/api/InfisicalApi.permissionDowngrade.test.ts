import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InfisicalApi, AccessError } from '../../api/InfisicalApi';
import { MockTokenStore } from '../mocks/TokenStore.mock';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('InfisicalApi - Permission Downgrade Handling', () => {
  let api: InfisicalApi;
  let tokenStore: MockTokenStore;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    tokenStore = new MockTokenStore();
    
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
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

  describe('createSecret permission downgrade', () => {
    it('should handle 403 error and downgrade permissions', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.post.mockRejectedValueOnce(forbiddenError);

      await expect(api.createSecret('TEST_KEY', 'test-value', 'proj123', 'dev'))
        .rejects.toMatchObject({
          type: 'forbidden',
          message: 'Insufficient privileges to create secrets. Your access has been downgraded to read-only.',
          workspaceId: 'proj123'
        });

      // Check that permissions were downgraded and cached
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toMatchObject({
        canRead: true,
        canWrite: false,
        canDelete: false,
        canCreateSecrets: false,
        canUpdateSecrets: false,
        canDeleteSecrets: false,
        roles: ['viewer'],
        effectiveRole: 'viewer'
      });
    });

    it('should allow other errors to propagate normally', async () => {
      const networkError = new Error('Network error');
      mockAxiosInstance.post.mockRejectedValueOnce(networkError);

      await expect(api.createSecret('TEST_KEY', 'test-value', 'proj123', 'dev'))
        .rejects.toThrow('Network error');

      // Should not cache permissions on non-permission errors
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toBeNull();
    });
  });

  describe('updateSecret permission downgrade', () => {
    it('should handle 403 error and downgrade permissions', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.patch.mockRejectedValueOnce(forbiddenError);

      await expect(api.updateSecret('TEST_KEY', 'new-value', 'proj123', 'dev'))
        .rejects.toMatchObject({
          type: 'forbidden',
          message: 'Insufficient privileges to update secrets. Your access has been downgraded to read-only.',
          workspaceId: 'proj123'
        });

      // Check that permissions were downgraded and cached
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toMatchObject({
        effectiveRole: 'viewer',
        canWrite: false,
        canUpdateSecrets: false
      });
    });

    it('should handle validation errors without downgrading permissions', async () => {
      const validationError = {
        response: { status: 400 },
        message: 'Invalid secret key format'
      };

      mockAxiosInstance.patch.mockRejectedValueOnce(validationError);

      await expect(api.updateSecret('INVALID KEY', 'new-value', 'proj123', 'dev'))
        .rejects.toMatchObject({
          response: { status: 400 }
        });

      // Should not cache permissions on validation errors
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toBeNull();
    });
  });

  describe('deleteSecret permission downgrade', () => {
    it('should handle 403 error and downgrade permissions', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.delete.mockRejectedValueOnce(forbiddenError);

      await expect(api.deleteSecret('TEST_KEY', 'proj123', 'dev'))
        .rejects.toMatchObject({
          type: 'forbidden',
          message: 'Insufficient privileges to delete secrets. Your access has been downgraded to read-only.',
          workspaceId: 'proj123'
        });

      // Check that permissions were downgraded and cached
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toMatchObject({
        effectiveRole: 'viewer',
        canDelete: false,
        canDeleteSecrets: false
      });
    });

    it('should handle 404 errors without permission downgrade', async () => {
      const notFoundError = {
        response: { status: 404 },
        message: 'Secret not found'
      };

      mockAxiosInstance.delete.mockRejectedValueOnce(notFoundError);

      await expect(api.deleteSecret('NONEXISTENT_KEY', 'proj123', 'dev'))
        .rejects.toMatchObject({
          response: { status: 404 }
        });

      // Should not cache permissions on not found errors
      const cachedPermissions = api.getWorkspacePermissions('proj123');
      expect(cachedPermissions).toBeNull();
    });
  });

  describe('permission downgrade with retry mechanism', () => {
    it('should handle downgrade after retries exhausted', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      // Mock all retry attempts failing with 403
      mockAxiosInstance.post
        .mockRejectedValueOnce(forbiddenError)
        .mockRejectedValueOnce(forbiddenError)
        .mockRejectedValueOnce(forbiddenError);

      await expect(api.createSecret('TEST_KEY', 'test-value', 'proj123', 'dev'))
        .rejects.toMatchObject({
          type: 'forbidden',
          message: expect.stringContaining('downgraded to read-only')
        });

      // Should have attempted the operation (not retried on 403)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should not retry on permission errors', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.post.mockRejectedValueOnce(forbiddenError);

      await expect(api.createSecret('TEST_KEY', 'test-value', 'proj123', 'dev'))
        .rejects.toMatchObject({
          type: 'forbidden'
        });

      // Should not retry on 403 errors
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('permission caching behavior', () => {
    it('should cache permissions per workspace', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      // Fail operations for two different workspaces
      mockAxiosInstance.post.mockRejectedValue(forbiddenError);

      await expect(api.createSecret('KEY1', 'value1', 'proj123', 'dev'))
        .rejects.toMatchObject({ type: 'forbidden' });

      await expect(api.createSecret('KEY2', 'value2', 'proj456', 'dev'))
        .rejects.toMatchObject({ type: 'forbidden' });

      // Should have separate cached permissions for each workspace
      const permissions1 = api.getWorkspacePermissions('proj123');
      const permissions2 = api.getWorkspacePermissions('proj456');

      expect(permissions1).toBeTruthy();
      expect(permissions2).toBeTruthy();
      expect(permissions1).toEqual(permissions2); // Same downgraded permissions
    });

    it('should clear all cached permissions when requested', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.post.mockRejectedValueOnce(forbiddenError);

      await expect(api.createSecret('TEST_KEY', 'test-value', 'proj123', 'dev'))
        .rejects.toMatchObject({ type: 'forbidden' });

      expect(api.getWorkspacePermissions('proj123')).toBeTruthy();

      api.clearPermissionsCache();

      expect(api.getWorkspacePermissions('proj123')).toBeNull();
    });
  });

  describe('getCurrentProject and getCurrentEnvironment fallback', () => {
    it('should use mock values when project/environment not provided', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.post.mockRejectedValueOnce(forbiddenError);

      // Call without explicit project/environment
      await expect(api.createSecret('TEST_KEY', 'test-value'))
        .rejects.toMatchObject({
          type: 'forbidden',
          workspaceId: 'mock-project-id' // Should use the mock project ID
        });

      // Should cache permissions for the mock project
      const cachedPermissions = api.getWorkspacePermissions('mock-project-id');
      expect(cachedPermissions).toBeTruthy();
      expect(cachedPermissions?.effectiveRole).toBe('viewer');
    });
  });
});