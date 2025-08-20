import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InfisicalApi, InfisicalSecretV3, ListSecretsRequest, GetSecretRequest, AccessError } from '../../api/InfisicalApi';
import { MockTokenStore } from '../mocks/TokenStore.mock';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('InfisicalApi - Secrets V3 Operations', () => {
  let api: InfisicalApi;
  let tokenStore: MockTokenStore;
  let mockAxiosInstance: any;

  const mockSecret: InfisicalSecretV3 = {
    id: 'secret123',
    version: 1,
    workspace: 'proj123',
    environment: 'dev',
    secretKey: 'DATABASE_URL',
    secretValue: 'postgresql://localhost:5432/myapp',
    secretComment: 'Main database connection',
    type: 'shared',
    tags: [
      { id: 'tag1', name: 'database', slug: 'database', color: 'blue' },
      { id: 'tag2', name: 'env', slug: 'env' }
    ],
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-02T00:00:00Z',
    secretPath: '/'
  };

  beforeEach(async () => {
    tokenStore = new MockTokenStore();
    
    mockAxiosInstance = {
      get: vi.fn(),
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

  describe('listSecrets', () => {
    it('should successfully list secrets for project and environment', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const mockResponse = {
        secrets: [mockSecret]
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.listSecrets(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=proj123&environment=dev'
      );
      expect(result).toEqual([mockSecret]);
    });

    it('should include secretPath parameter when provided', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'prod',
        secretPath: '/api/keys'
      };

      const mockResponse = { secrets: [] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.listSecrets(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=proj123&environment=prod&secretPath=%2Fapi%2Fkeys'
      );
    });

    it('should handle empty secrets response', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const mockResponse = { secrets: [] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.listSecrets(request);

      expect(result).toEqual([]);
    });

    it('should handle 403 forbidden error with proper AccessError', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(forbiddenError);

      await expect(api.listSecrets(request)).rejects.toMatchObject({
        type: 'forbidden',
        message: 'Access denied to secrets in project "proj123" environment "dev". Please check your permissions.',
        workspaceId: 'proj123'
      });
    });

    it('should handle 404 not found error with proper AccessError', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'nonexistent'
      };

      const notFoundError = {
        response: { status: 404 },
        message: 'Not Found'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(notFoundError);

      await expect(api.listSecrets(request)).rejects.toMatchObject({
        type: 'not_found',
        message: 'Environment "nonexistent" not found in project "proj123".',
        workspaceId: 'proj123'
      });
    });

    it('should handle 401 authentication error', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const authError = {
        response: { status: 401 },
        message: 'Unauthorized'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(authError);

      await expect(api.listSecrets(request)).rejects.toThrow('Authentication required. Please log in again.');
    });

    it('should retry on transient errors', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const mockResponse = { secrets: [mockSecret] };

      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Another temporary error'))
        .mockResolvedValueOnce({ data: mockResponse });

      const result = await api.listSecrets(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(result).toEqual([mockSecret]);
    });
  });

  describe('getSecret', () => {
    it('should successfully get a specific secret', async () => {
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        name: 'DATABASE_URL'
      };

      const mockResponse = { secret: mockSecret };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.getSecret(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/DATABASE_URL?workspaceId=proj123&environment=dev&type=shared'
      );
      expect(result).toEqual(mockSecret);
    });

    it('should include all parameters when provided', async () => {
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'prod',
        name: 'API_KEY',
        type: 'personal',
        secretPath: '/api'
      };

      const mockResponse = { secret: mockSecret };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.getSecret(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/API_KEY?workspaceId=proj123&environment=prod&type=personal&secretPath=%2Fapi'
      );
    });

    it('should handle URL encoding for secret names with special characters', async () => {
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        name: 'SECRET/WITH@SPECIAL#CHARS'
      };

      const mockResponse = { secret: mockSecret };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.getSecret(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/SECRET%2FWITH%40SPECIAL%23CHARS?workspaceId=proj123&environment=dev&type=shared'
      );
    });

    it('should handle 403 forbidden error for specific secret', async () => {
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        name: 'RESTRICTED_SECRET'
      };

      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(forbiddenError);

      await expect(api.getSecret(request)).rejects.toMatchObject({
        type: 'forbidden',
        message: 'Access denied to secret "RESTRICTED_SECRET" in project "proj123". Please check your permissions.',
        workspaceId: 'proj123'
      });
    });

    it('should handle 404 not found error for specific secret', async () => {
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        name: 'NONEXISTENT_SECRET'
      };

      const notFoundError = {
        response: { status: 404 },
        message: 'Not Found'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(notFoundError);

      await expect(api.getSecret(request)).rejects.toMatchObject({
        type: 'not_found',
        message: 'Secret "NONEXISTENT_SECRET" not found in environment "dev".',
        workspaceId: 'proj123'
      });
    });

    it('should default to shared type when not specified', async () => {
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        name: 'DATABASE_URL'
      };

      const mockResponse = { secret: mockSecret };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.getSecret(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('type=shared')
      );
    });
  });

  describe('parameter encoding', () => {
    it('should properly encode workspace IDs with special characters', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj-123@test',
        environment: 'dev'
      };

      const mockResponse = { secrets: [] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.listSecrets(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=proj-123%40test&environment=dev'
      );
    });

    it('should properly encode environment names with special characters', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev-test@branch'
      };

      const mockResponse = { secrets: [] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.listSecrets(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=proj123&environment=dev-test%40branch'
      );
    });

    it('should properly encode secret paths', async () => {
      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        secretPath: '/api/keys with spaces'
      };

      const mockResponse = { secrets: [] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      await api.listSecrets(request);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=proj123&environment=dev&secretPath=%2Fapi%2Fkeys%20with%20spaces'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle secrets with complex tag structures', async () => {
      const complexSecret: InfisicalSecretV3 = {
        ...mockSecret,
        tags: [
          { id: 'tag1', name: 'database', slug: 'database', color: 'blue' },
          { id: 'tag2', name: 'production', slug: 'production', color: 'red' },
          { id: 'tag3', name: 'critical', slug: 'critical' },
          { id: 'tag4', name: 'env-var', slug: 'env-var', color: 'green' }
        ]
      };

      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const mockResponse = { secrets: [complexSecret] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.listSecrets(request);

      expect(result[0].tags).toHaveLength(4);
      expect(result[0].tags.map(t => t.name)).toEqual(['database', 'production', 'critical', 'env-var']);
    });

    it('should handle secrets with empty comments and paths', async () => {
      const minimalSecret: InfisicalSecretV3 = {
        ...mockSecret,
        secretComment: '',
        secretPath: '/',
        tags: []
      };

      const request: ListSecretsRequest = {
        workspaceId: 'proj123',
        environment: 'dev'
      };

      const mockResponse = { secrets: [minimalSecret] };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.listSecrets(request);

      expect(result[0].secretComment).toBe('');
      expect(result[0].secretPath).toBe('/');
      expect(result[0].tags).toEqual([]);
    });

    it('should handle very long secret names', async () => {
      const longName = 'A'.repeat(500);
      const request: GetSecretRequest = {
        workspaceId: 'proj123',
        environment: 'dev',
        name: longName
      };

      const mockResponse = { secret: { ...mockSecret, secretKey: longName } };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await api.getSecret(request);

      expect(result.secretKey).toBe(longName);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(longName))
      );
    });
  });
});