import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenStore } from '../../utils/TokenStore';
import { TokenInfo, UniversalAuthLoginRequest } from '../../api/InfisicalApi';

describe('TokenStore', () => {
  let tokenStore: TokenStore;
  let mockGlobalState: any;
  let mockSecretStorage: any;

  beforeEach(() => {
    mockGlobalState = {
      get: vi.fn(),
      update: vi.fn()
    };

    mockSecretStorage = {
      store: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    };

    tokenStore = new TokenStore(mockGlobalState, mockSecretStorage);
  });

  describe('token info management', () => {
    it('should store and retrieve token info', async () => {
      const tokenInfo: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000,
        renewalThresholdSeconds: 60
      };

      await tokenStore.setTokenInfo(tokenInfo);
      expect(mockGlobalState.update).toHaveBeenCalledWith('infisicalAi.tokenInfo', tokenInfo);

      mockGlobalState.get.mockReturnValueOnce(tokenInfo);
      const retrieved = await tokenStore.getTokenInfo();
      expect(retrieved).toEqual(tokenInfo);
      expect(mockGlobalState.get).toHaveBeenCalledWith('infisicalAi.tokenInfo');
    });

    it('should clear token info', async () => {
      await tokenStore.clearTokenInfo();
      expect(mockGlobalState.update).toHaveBeenCalledWith('infisicalAi.tokenInfo', undefined);
    });

    it('should return undefined when no token info exists', async () => {
      mockGlobalState.get.mockReturnValueOnce(undefined);
      const tokenInfo = await tokenStore.getTokenInfo();
      expect(tokenInfo).toBeUndefined();
    });
  });

  describe('credentials management', () => {
    it('should store and retrieve credentials securely', async () => {
      const credentials: UniversalAuthLoginRequest = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      };

      await tokenStore.setCredentials(credentials);
      expect(mockSecretStorage.store).toHaveBeenCalledWith(
        'infisicalAi.credentials',
        JSON.stringify(credentials)
      );

      mockSecretStorage.get.mockResolvedValueOnce(JSON.stringify(credentials));
      const retrieved = await tokenStore.getCredentials();
      expect(retrieved).toEqual(credentials);
      expect(mockSecretStorage.get).toHaveBeenCalledWith('infisicalAi.credentials');
    });

    it('should clear credentials', async () => {
      await tokenStore.clearCredentials();
      expect(mockSecretStorage.delete).toHaveBeenCalledWith('infisicalAi.credentials');
    });

    it('should return undefined when no credentials exist', async () => {
      mockSecretStorage.get.mockResolvedValueOnce(undefined);
      const credentials = await tokenStore.getCredentials();
      expect(credentials).toBeUndefined();
    });

    it('should handle corrupted credentials gracefully', async () => {
      mockSecretStorage.get.mockResolvedValueOnce('invalid-json');
      
      const credentials = await tokenStore.getCredentials();
      expect(credentials).toBeUndefined();
      expect(mockSecretStorage.delete).toHaveBeenCalledWith('infisicalAi.credentials');
    });
  });

  describe('token validation', () => {
    it('should return true for valid token', () => {
      const tokenInfo: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000,
        renewalThresholdSeconds: 60
      };

      mockGlobalState.get.mockReturnValueOnce(tokenInfo);
      expect(tokenStore.hasValidToken()).toBe(true);
    });

    it('should return false for expired token', () => {
      const tokenInfo: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() - 1000,
        renewalThresholdSeconds: 60
      };

      mockGlobalState.get.mockReturnValueOnce(tokenInfo);
      expect(tokenStore.hasValidToken()).toBe(false);
    });

    it('should return false when no token exists', () => {
      mockGlobalState.get.mockReturnValueOnce(undefined);
      expect(tokenStore.hasValidToken()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle concurrent token operations', async () => {
      const tokenInfo: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600000,
        renewalThresholdSeconds: 60
      };

      const promises = [
        tokenStore.setTokenInfo(tokenInfo),
        tokenStore.setTokenInfo(tokenInfo),
        tokenStore.setTokenInfo(tokenInfo)
      ];

      await Promise.all(promises);
      expect(mockGlobalState.update).toHaveBeenCalledTimes(3);
    });

    it('should handle token expiry edge case', () => {
      const now = Date.now();
      const tokenInfo: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: now,
        renewalThresholdSeconds: 60
      };

      mockGlobalState.get.mockReturnValueOnce(tokenInfo);
      expect(tokenStore.hasValidToken()).toBe(false);
    });

    it('should handle very old token', () => {
      const tokenInfo: TokenInfo = {
        accessToken: 'test-token',
        expiresAt: Date.now() - 86400000,
        renewalThresholdSeconds: 60
      };

      mockGlobalState.get.mockReturnValueOnce(tokenInfo);
      expect(tokenStore.hasValidToken()).toBe(false);
    });
  });
});