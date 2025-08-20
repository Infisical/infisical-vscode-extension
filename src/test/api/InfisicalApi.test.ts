import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InfisicalApi, UniversalAuthLoginRequest, UniversalAuthLoginResponse, TokenRenewResponse } from '../../api/InfisicalApi';
import { MockTokenStore } from '../mocks/TokenStore.mock';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('InfisicalApi', () => {
  let api: InfisicalApi;
  let tokenStore: MockTokenStore;
  let mockAxiosInstance: any;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    
    mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      defaults: { baseURL: 'https://us.infisical.com' },
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    };

    mockedAxios.create = vi.fn().mockReturnValue(mockAxiosInstance);
    
    api = new InfisicalApi('https://us.infisical.com', tokenStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should successfully authenticate with valid credentials', async () => {
      const credentials: UniversalAuthLoginRequest = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      };

      const mockResponse: UniversalAuthLoginResponse = {
        accessToken: 'test-access-token',
        expiresIn: 3600,
        accessTokenMaxTTL: 7200,
        tokenType: 'Bearer'
      };

      mockAxiosInstance.post.mockResolvedValueOnce({ data: mockResponse });

      await api.login(credentials);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/auth/universal-auth/login',
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret
        }
      );

      const storedTokenInfo = await tokenStore.getTokenInfo();
      expect(storedTokenInfo).toEqual({
        accessToken: 'test-access-token',
        expiresAt: expect.any(Number),
        renewalThresholdSeconds: 60
      });

      const storedCredentials = await tokenStore.getCredentials();
      expect(storedCredentials).toEqual(credentials);
    });

    it('should retry on network errors', async () => {
      const credentials: UniversalAuthLoginRequest = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      };

      const mockResponse: UniversalAuthLoginResponse = {
        accessToken: 'test-access-token',
        expiresIn: 3600,
        accessTokenMaxTTL: 7200,
        tokenType: 'Bearer'
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: mockResponse });

      await api.login(credentials);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      const credentials: UniversalAuthLoginRequest = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      };

      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(api.login(credentials)).rejects.toThrow('Universal Auth Login failed after 3 attempts');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it('should not retry on 401 errors', async () => {
      const credentials: UniversalAuthLoginRequest = {
        clientId: 'invalid-client-id',
        clientSecret: 'invalid-client-secret'
      };

      const authError = new Error('401 Unauthorized');
      mockAxiosInstance.post.mockRejectedValueOnce(authError);

      await expect(api.login(credentials)).rejects.toThrow('401 Unauthorized');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('token renewal', () => {
    beforeEach(async () => {
      const mockTokenInfo = {
        accessToken: 'current-token',
        expiresAt: Date.now() + 30000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(mockTokenInfo);
    });

    it('should renew token when near expiry', async () => {
      const mockRenewResponse: TokenRenewResponse = {
        accessToken: 'new-access-token',
        expiresIn: 3600,
        tokenType: 'Bearer'
      };

      mockAxiosInstance.post.mockResolvedValueOnce({ data: mockRenewResponse });

      const tokenInfo = {
        accessToken: 'current-token',
        expiresAt: Date.now() + 30000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      const validToken = await (api as any).getValidToken();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/auth/token/renew',
        {},
        {
          headers: {
            Authorization: 'Bearer current-token'
          }
        }
      );

      const updatedTokenInfo = await tokenStore.getTokenInfo();
      expect(updatedTokenInfo?.accessToken).toBe('new-access-token');
    });

    it('should not renew token when not near expiry', async () => {
      const tokenInfo = {
        accessToken: 'current-token',
        expiresAt: Date.now() + 300000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      const validToken = await (api as any).getValidToken();

      expect(mockAxiosInstance.post).not.toHaveBeenCalledWith('/api/v1/auth/token/renew');
      expect(validToken?.accessToken).toBe('current-token');
    });

    it('should handle renewal failure gracefully', async () => {
      const tokenInfo = {
        accessToken: 'current-token',
        expiresAt: Date.now() + 30000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      mockAxiosInstance.post.mockRejectedValueOnce(new Error('Renewal failed'));

      const validToken = await (api as any).getValidToken();

      expect(validToken?.accessToken).toBe('current-token');
    });
  });

  describe('401 handling in interceptors', () => {
    it('should attempt token renewal on 401 response', async () => {
      const mockRenewResponse: TokenRenewResponse = {
        accessToken: 'renewed-token',
        expiresIn: 3600,
        tokenType: 'Bearer'
      };

      const originalError = {
        response: { status: 401 },
        config: { headers: {} }
      };

      const renewalMock = vi.fn().mockResolvedValue({ data: mockRenewResponse });
      const retryMock = vi.fn().mockResolvedValue({ data: 'success' });

      mockAxiosInstance.post.mockImplementation((url: string) => {
        if (url === '/api/v1/auth/token/renew') {
          return renewalMock();
        }
        return Promise.reject(originalError);
      });

      mockAxiosInstance.request.mockImplementation(retryMock);

      const tokenInfo = {
        accessToken: 'original-token',
        expiresAt: Date.now() + 300000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const result = await responseInterceptor(originalError);

      expect(renewalMock).toHaveBeenCalled();
      expect(retryMock).toHaveBeenCalled();
    });

    it('should logout and throw error if renewal fails on 401', async () => {
      const originalError = {
        response: { status: 401 },
        config: { headers: {} }
      };

      mockAxiosInstance.post.mockRejectedValueOnce(new Error('Renewal failed'));

      const tokenInfo = {
        accessToken: 'original-token',
        expiresAt: Date.now() + 300000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      
      await expect(responseInterceptor(originalError)).rejects.toThrow('Authentication failed. Please log in again.');
      
      expect(await tokenStore.getTokenInfo()).toBeUndefined();
      expect(await tokenStore.getCredentials()).toBeUndefined();
    });
  });

  describe('logout', () => {
    it('should clear token and credentials', async () => {
      const tokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000,
        renewalThresholdSeconds: 60
      };
      
      const credentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      };

      await tokenStore.setTokenInfo(tokenInfo);
      await tokenStore.setCredentials(credentials);

      await api.logout();

      expect(await tokenStore.getTokenInfo()).toBeUndefined();
      expect(await tokenStore.getCredentials()).toBeUndefined();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when token is valid', async () => {
      const tokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      expect(api.isAuthenticated()).toBe(true);
    });

    it('should return false when token is expired', async () => {
      const tokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() - 1000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);

      expect(api.isAuthenticated()).toBe(false);
    });

    it('should return false when no token exists', () => {
      expect(api.isAuthenticated()).toBe(false);
    });
  });

  describe('base URL configuration', () => {
    it('should set US region URL', () => {
      api.setBaseUrl('https://us.infisical.com');
      expect(api.getBaseUrl()).toBe('https://us.infisical.com');
      expect(mockAxiosInstance.defaults.baseURL).toBe('https://us.infisical.com');
    });

    it('should set EU region URL', () => {
      api.setBaseUrl('https://eu.infisical.com');
      expect(api.getBaseUrl()).toBe('https://eu.infisical.com');
      expect(mockAxiosInstance.defaults.baseURL).toBe('https://eu.infisical.com');
    });
  });

  describe('API operations', () => {
    beforeEach(async () => {
      const tokenInfo = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 3600000,
        renewalThresholdSeconds: 60
      };
      await tokenStore.setTokenInfo(tokenInfo);
    });

    it('should get projects successfully', async () => {
      const mockProjects = [
        { id: 'proj1', name: 'Project 1', slug: 'project-1' },
        { id: 'proj2', name: 'Project 2', slug: 'project-2' }
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { workspaces: mockProjects }
      });

      const projects = await api.getProjects();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace');
      expect(projects).toEqual(mockProjects);
    });

    it('should get environments successfully', async () => {
      const mockEnvironments = [
        { id: 'env1', name: 'Development', slug: 'dev' },
        { id: 'env2', name: 'Production', slug: 'prod' }
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { environments: mockEnvironments }
      });

      const environments = await api.getEnvironments('proj1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace/proj1/environments');
      expect(environments).toEqual(mockEnvironments);
    });

    it('should get secrets successfully', async () => {
      const mockSecrets = [
        {
          id: 'secret1',
          key: 'API_KEY',
          value: 'secret-value',
          environment: 'dev',
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z'
        }
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { secrets: mockSecrets }
      });

      const secrets = await api.getSecrets('proj1', 'dev');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=proj1&environment=dev'
      );
      expect(secrets).toEqual(mockSecrets);
    });
  });
});