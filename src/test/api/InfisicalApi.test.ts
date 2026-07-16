import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InfisicalApi } from '../../api/InfisicalApi';
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

  describe('setUserToken', () => {
    it('stores token info with expiry parsed from JWT', async () => {
      // JWT with exp = 9999999999 (year 2286)
      const payload = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url');
      const token = `header.${payload}.sig`;

      await api.setUserToken(token);

      const stored = await tokenStore.getTokenInfo();
      expect(stored?.accessToken).toBe(token);
      expect(stored?.expiresAt).toBe(9999999999 * 1000);
      expect(stored?.renewalThresholdSeconds).toBe(0);
    });

    it('falls back to 24h expiry for non-JWT tokens', async () => {
      const before = Date.now();
      await api.setUserToken('not-a-jwt');
      const after = Date.now();

      const stored = await tokenStore.getTokenInfo();
      expect(stored?.expiresAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
      expect(stored?.expiresAt).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000);
    });
  });

  describe('logout', () => {
    it('clears token info', async () => {
      await tokenStore.setTokenInfo({
        accessToken: 'x',
        expiresAt: Date.now() + 1000,
        renewalThresholdSeconds: 60
      });

      await api.logout();

      expect(await tokenStore.getTokenInfo()).toBeUndefined();
    });
  });

  describe('isAuthenticated', () => {
    it('returns true with a fresh token', async () => {
      await tokenStore.setTokenInfo({
        accessToken: 'x',
        expiresAt: Date.now() + 60_000,
        renewalThresholdSeconds: 60
      });
      expect(api.isAuthenticated()).toBe(true);
    });

    it('returns false with an expired token', async () => {
      await tokenStore.setTokenInfo({
        accessToken: 'x',
        expiresAt: Date.now() - 1,
        renewalThresholdSeconds: 60
      });
      expect(api.isAuthenticated()).toBe(false);
    });

    it('returns false with no token', () => {
      expect(api.isAuthenticated()).toBe(false);
    });
  });

  describe('base URL', () => {
    it('updates the axios baseURL', () => {
      api.setBaseUrl('https://eu.infisical.com');
      expect(api.getBaseUrl()).toBe('https://eu.infisical.com');
      expect(mockAxiosInstance.defaults.baseURL).toBe('https://eu.infisical.com');
    });
  });

  describe('CRUD', () => {
    beforeEach(async () => {
      await tokenStore.setTokenInfo({
        accessToken: 'tok',
        expiresAt: Date.now() + 600_000,
        renewalThresholdSeconds: 60
      });
    });

    it('lists projects', async () => {
      const projects = [{ id: 'p1', name: 'P1', slug: 'p1' }];
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { workspaces: projects } });

      const result = await api.getProjects();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace', {
        params: { type: 'secret-manager' }
      });
      expect(result).toEqual(projects);
    });

    it('lists environments', async () => {
      const environments = [{ id: 'e1', name: 'Dev', slug: 'dev' }];
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { workspace: { id: 'p1', name: 'P1', slug: 'p1', environments } }
      });

      const result = await api.getEnvironments('p1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace/p1');
      expect(result).toEqual(environments);
    });

    it('lists secrets at a path', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { secrets: [] } });

      await api.listSecrets({
        workspaceId: 'p1',
        environment: 'dev',
        secretPath: '/api/keys'
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/secrets/raw?workspaceId=p1&environment=dev&secretPath=%2Fapi%2Fkeys'
      );
    });

    it('lists folders at a path', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { folders: [] } });

      await api.listFolders({
        workspaceId: 'p1',
        environment: 'dev',
        secretPath: '/svc'
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v1/folders?workspaceId=p1&environment=dev&path=%2Fsvc'
      );
    });

    it('creates a secret', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { secret: { secretKey: 'KEY' } }
      });

      await api.createSecret({
        workspaceId: 'p1',
        environment: 'dev',
        secretKey: 'KEY',
        secretValue: 'val',
        secretPath: '/'
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/KEY',
        {
          workspaceId: 'p1',
          environment: 'dev',
          secretValue: 'val',
          secretPath: '/',
          type: 'shared'
        }
      );
    });

    it('updates a secret', async () => {
      mockAxiosInstance.patch.mockResolvedValueOnce({
        data: { secret: { secretKey: 'KEY' } }
      });

      await api.updateSecret({
        workspaceId: 'p1',
        environment: 'dev',
        secretKey: 'KEY',
        secretValue: 'newval',
        secretPath: '/'
      });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/KEY',
        {
          workspaceId: 'p1',
          environment: 'dev',
          secretValue: 'newval',
          secretPath: '/',
          type: 'shared'
        }
      );
    });

    it('deletes a secret', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({ data: {} });

      await api.deleteSecret({
        workspaceId: 'p1',
        environment: 'dev',
        secretKey: 'KEY',
        secretPath: '/'
      });

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/KEY',
        {
          data: {
            workspaceId: 'p1',
            environment: 'dev',
            secretPath: '/',
            type: 'shared'
          }
        }
      );
    });

    it('URL-encodes secret keys with special characters', async () => {
      mockAxiosInstance.patch.mockResolvedValueOnce({
        data: { secret: { secretKey: 'A/B' } }
      });

      await api.updateSecret({
        workspaceId: 'p1',
        environment: 'dev',
        secretKey: 'A/B',
        secretValue: 'v'
      });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/api/v3/secrets/raw/A%2FB',
        expect.any(Object)
      );
    });
  });
});
