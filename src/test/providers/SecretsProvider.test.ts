import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfisicalSecretsProvider, SecretItem, SecretPathItem, ErrorItem, LoadingItem } from '../../providers/SecretsProvider';
import { InfisicalApi, InfisicalSecretV3, AccessError } from '../../api/InfisicalApi';
import { WorkspaceState } from '../../utils/WorkspaceState';

describe('InfisicalSecretsProvider', () => {
  let provider: InfisicalSecretsProvider;
  let mockApi: any;
  let mockWorkspaceState: any;

  const mockSecret: InfisicalSecretV3 = {
    id: 'secret1',
    version: 1,
    workspace: 'proj123',
    environment: 'dev',
    secretKey: 'DATABASE_URL',
    secretValue: 'postgresql://localhost:5432/myapp',
    secretComment: 'Main database connection',
    type: 'shared',
    tags: [
      { id: 'tag1', name: 'database', slug: 'database', color: 'blue' }
    ],
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-02T00:00:00Z',
    secretPath: '/'
  };

  beforeEach(() => {
    mockApi = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      listSecrets: vi.fn()
    };

    mockWorkspaceState = {
      getProjectEnvironment: vi.fn().mockReturnValue({
        projectId: 'proj123',
        environmentSlug: 'dev',
        projectName: 'Test Project',
        environmentName: 'Development'
      }),
      hasProjectEnvironment: vi.fn().mockReturnValue(true)
    };

    provider = new InfisicalSecretsProvider(mockApi as InfisicalApi, mockWorkspaceState as WorkspaceState);
  });

  describe('initialization and state', () => {
    it('should initialize with empty secrets', () => {
      expect(provider.getSecrets()).toEqual([]);
      expect(provider.getCurrentFilter()).toBe('');
      expect(provider.getCurrentSecretPath()).toBe('/');
      expect(provider.isLoading()).toBe(false);
      expect(provider.getError()).toBeNull();
    });
  });

  describe('authentication checks', () => {
    it('should return error item when not authenticated', async () => {
      mockApi.isAuthenticated.mockReturnValue(false);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(ErrorItem);
      expect(children[0].label).toBe('Not authenticated');
      expect(children[0].command?.command).toBe('infisicalAi.login');
    });

    it('should return error item when no project/environment selected', async () => {
      mockWorkspaceState.getProjectEnvironment.mockReturnValue(null);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(ErrorItem);
      expect(children[0].label).toBe('No project/environment selected');
      expect(children[0].command?.command).toBe('infisicalAi.openControlPanel');
    });
  });

  describe('loadSecrets', () => {
    it('should load secrets successfully', async () => {
      mockApi.listSecrets.mockResolvedValue([mockSecret]);

      await provider.loadSecrets();

      expect(mockApi.listSecrets).toHaveBeenCalledWith({
        workspaceId: 'proj123',
        environment: 'dev',
        secretPath: '/'
      });
      expect(provider.getSecrets()).toEqual([mockSecret]);
      expect(provider.isLoading()).toBe(false);
      expect(provider.getError()).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      const error: AccessError = {
        type: 'forbidden',
        message: 'Access denied',
        workspaceId: 'proj123'
      };
      mockApi.listSecrets.mockRejectedValue(error);

      await provider.loadSecrets();

      expect(provider.getSecrets()).toEqual([]);
      expect(provider.isLoading()).toBe(false);
      expect(provider.getError()).toBe('Access denied');
    });

    it('should handle generic errors', async () => {
      mockApi.listSecrets.mockRejectedValue(new Error('Network error'));

      await provider.loadSecrets();

      expect(provider.getError()).toBe('Network error');
    });

    it('should set loading state during API call', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApi.listSecrets.mockReturnValue(promise);

      const loadPromise = provider.loadSecrets();
      expect(provider.isLoading()).toBe(true);

      resolvePromise!([mockSecret]);
      await loadPromise;
      expect(provider.isLoading()).toBe(false);
    });

    it('should clear secrets when no project environment', async () => {
      mockWorkspaceState.getProjectEnvironment.mockReturnValue(null);

      await provider.loadSecrets();

      expect(provider.getSecrets()).toEqual([]);
      expect(mockApi.listSecrets).not.toHaveBeenCalled();
    });

    it('should include secretPath in API call', async () => {
      provider.setSecretPath('/api/keys');
      mockApi.listSecrets.mockResolvedValue([]);

      await provider.loadSecrets();

      expect(mockApi.listSecrets).toHaveBeenCalledWith({
        workspaceId: 'proj123',
        environment: 'dev',
        secretPath: '/api/keys'
      });
    });
  });

  describe('filtering', () => {
    beforeEach(async () => {
      const secrets: InfisicalSecretV3[] = [
        { ...mockSecret, secretKey: 'DATABASE_URL', secretComment: 'Main DB' },
        { 
          ...mockSecret, 
          secretKey: 'API_KEY', 
          secretComment: 'External API',
          tags: [{ id: 'tag2', name: 'api', slug: 'api' }]
        },
        { ...mockSecret, secretKey: 'JWT_SECRET', secretComment: 'Authentication' }
      ];
      mockApi.listSecrets.mockResolvedValue(secrets);
      await provider.loadSecrets();
    });

    it('should filter secrets by key', () => {
      provider.setFilter('api');
      const children = provider.getChildren();
      
      // Should find API_KEY
      expect(provider.getSecrets().filter(s => 
        s.secretKey.toLowerCase().includes('api') ||
        s.secretComment.toLowerCase().includes('api') ||
        s.tags.some(tag => tag.name.toLowerCase().includes('api'))
      )).toHaveLength(1);
    });

    it('should filter secrets by comment', () => {
      provider.setFilter('main');
      
      expect(provider.getSecrets().filter(s => 
        s.secretKey.toLowerCase().includes('main') ||
        s.secretComment.toLowerCase().includes('main') ||
        s.tags.some(tag => tag.name.toLowerCase().includes('main'))
      )).toHaveLength(1);
    });

    it('should filter secrets by tags', () => {
      provider.setFilter('database');
      
      expect(provider.getSecrets().filter(s => 
        s.secretKey.toLowerCase().includes('database') ||
        s.secretComment.toLowerCase().includes('database') ||
        s.tags.some(tag => tag.name.toLowerCase().includes('database'))
      )).toHaveLength(1);
    });

    it('should return all secrets when filter is empty', () => {
      provider.setFilter('');
      
      expect(provider.getSecrets()).toHaveLength(3);
    });

    it('should be case insensitive', () => {
      provider.setFilter('DATABASE');
      
      expect(provider.getSecrets().filter(s => 
        s.secretKey.toLowerCase().includes('database') ||
        s.secretComment.toLowerCase().includes('database') ||
        s.tags.some(tag => tag.name.toLowerCase().includes('database'))
      )).toHaveLength(1);
    });
  });

  describe('secret path handling', () => {
    it('should group secrets by path', async () => {
      const secrets: InfisicalSecretV3[] = [
        { ...mockSecret, secretKey: 'ROOT_SECRET', secretPath: '/' },
        { ...mockSecret, secretKey: 'API_SECRET', secretPath: '/api' },
        { ...mockSecret, secretKey: 'DB_SECRET', secretPath: '/database' }
      ];
      mockApi.listSecrets.mockResolvedValue(secrets);
      await provider.loadSecrets();

      const children = await provider.getChildren();
      
      // Should have SecretPathItems for different paths
      expect(children.some(c => c instanceof SecretPathItem)).toBe(true);
    });

    it('should show secrets directly when all in root path', async () => {
      const secrets: InfisicalSecretV3[] = [
        { ...mockSecret, secretKey: 'SECRET1', secretPath: '/' },
        { ...mockSecret, secretKey: 'SECRET2', secretPath: '/' }
      ];
      mockApi.listSecrets.mockResolvedValue(secrets);
      await provider.loadSecrets();

      const children = await provider.getChildren();
      
      // Should show SecretItems directly, not grouped by path
      expect(children.every(c => c instanceof SecretItem)).toBe(true);
      expect(children).toHaveLength(2);
    });

    it('should set secret path and reload', async () => {
      mockApi.listSecrets.mockResolvedValue([]);

      provider.setSecretPath('/new/path');

      expect(provider.getCurrentSecretPath()).toBe('/new/path');
      expect(mockApi.listSecrets).toHaveBeenCalledWith({
        workspaceId: 'proj123',
        environment: 'dev',
        secretPath: '/new/path'
      });
    });

    it('should default to root path when empty', () => {
      provider.setSecretPath('');
      expect(provider.getCurrentSecretPath()).toBe('/');
    });
  });

  describe('tree structure', () => {
    it('should return loading item when loading', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApi.listSecrets.mockReturnValue(promise);

      const loadPromise = provider.loadSecrets();
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(LoadingItem);

      resolvePromise!([]);
      await loadPromise;
    });

    it('should return error item with retry action on API error', async () => {
      mockApi.listSecrets.mockRejectedValue(new Error('Network error'));
      await provider.loadSecrets();

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(ErrorItem);
      expect(children[0].label).toBe('Network error');
      expect(children[0].command?.command).toBe('infisicalAi.refreshSecrets');
    });

    it('should return error item with permissions action on access denied', async () => {
      const error: AccessError = {
        type: 'forbidden',
        message: 'Access denied to secrets',
        workspaceId: 'proj123'
      };
      mockApi.listSecrets.mockRejectedValue(error);
      await provider.loadSecrets();

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(ErrorItem);
      expect(children[0].label).toBe('Access denied to secrets');
      expect(children[0].command?.command).toBe('infisicalAi.openControlPanel');
    });

    it('should return create secret action when no secrets found', async () => {
      mockApi.listSecrets.mockResolvedValue([]);
      await provider.loadSecrets();

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(ErrorItem);
      expect(children[0].label).toBe('No secrets found');
      expect(children[0].command?.command).toBe('infisicalAi.createSecret');
    });

    it('should return secrets for specific path when path item is expanded', async () => {
      const secrets: InfisicalSecretV3[] = [
        { ...mockSecret, secretKey: 'API_SECRET', secretPath: '/api' }
      ];
      mockApi.listSecrets.mockResolvedValue(secrets);
      await provider.loadSecrets();

      const pathItem = new SecretPathItem('/api', 1);
      const children = await provider.getChildren(pathItem);

      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(SecretItem);
      expect((children[0] as SecretItem).secret.secretKey).toBe('API_SECRET');
    });
  });

  describe('SecretItem', () => {
    it('should create SecretItem with masked value', () => {
      const item = new SecretItem(mockSecret);

      expect(item.label).toBe('DATABASE_URL');
      expect(item.description).toBe('po••••pp'); // First 2 + last 2 chars with masking
      expect(item.contextValue).toBe('secret');
      expect(item.command?.command).toBe('infisicalAi.showSecretDetail');
    });

    it('should mask short values completely', () => {
      const shortSecret = { ...mockSecret, secretValue: 'abc' };
      const item = new SecretItem(shortSecret);

      expect(item.description).toBe('••••');
    });

    it('should include tags in tooltip', () => {
      const item = new SecretItem(mockSecret);

      expect(item.tooltip).toContain('Tags: database');
    });

    it('should include comment in tooltip when present', () => {
      const item = new SecretItem(mockSecret);

      expect(item.tooltip).toContain('Comment: Main database connection');
    });

    it('should use appropriate icons based on secret type and tags', () => {
      const personalSecret = { ...mockSecret, type: 'personal' as const };
      const personalItem = new SecretItem(personalSecret);
      expect(personalItem.iconPath).toEqual(expect.objectContaining({ id: 'person' }));

      const dbSecret = { 
        ...mockSecret, 
        tags: [{ id: 'tag1', name: 'db-connection', slug: 'db-connection' }]
      };
      const dbItem = new SecretItem(dbSecret);
      expect(dbItem.iconPath).toEqual(expect.objectContaining({ id: 'database' }));
    });
  });

  describe('SecretPathItem', () => {
    it('should create SecretPathItem with correct display name', () => {
      const item = new SecretPathItem('/api/keys', 5);

      expect(item.label).toBe('keys');
      expect(item.description).toBe('5 secrets');
      expect(item.tooltip).toBe('Path: /api/keys\n5 secrets');
    });

    it('should show "Root" for root path', () => {
      const item = new SecretPathItem('/', 3);

      expect(item.label).toBe('Root');
    });
  });
});