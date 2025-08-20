import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { InfisicalApi, ProjectResponse, AccessError } from '../../api/InfisicalApi';
import { MockTokenStore } from '../mocks/TokenStore.mock';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('InfisicalApi - Project Operations', () => {
  let api: InfisicalApi;
  let tokenStore: MockTokenStore;
  let mockAxiosInstance: any;

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

  describe('getProject', () => {
    it('should successfully get project by ID', async () => {
      const mockProject: ProjectResponse = {
        id: 'cm123456789',
        name: 'Test Project',
        slug: 'test-project',
        environments: [
          { id: 'env1', name: 'Development', slug: 'dev' },
          { id: 'env2', name: 'Production', slug: 'prod' }
        ],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await api.getProject('cm123456789');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace/cm123456789');
      expect(result).toEqual(mockProject);
    });

    it('should successfully get project by slug', async () => {
      const mockProject: ProjectResponse = {
        id: 'cm123456789',
        name: 'Test Project',
        slug: 'test-project',
        environments: [
          { id: 'env1', name: 'Development', slug: 'dev' }
        ],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await api.getProject('test-project');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace/test-project');
      expect(result).toEqual(mockProject);
    });

    it('should handle 403 forbidden error with proper AccessError', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(forbiddenError);

      await expect(api.getProject('cm123456789')).rejects.toMatchObject({
        type: 'forbidden',
        message: 'Access denied to project "cm123456789". Please check your permissions or verify the project ID.',
        workspaceId: 'cm123456789'
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace/cm123456789');
    });

    it('should handle 404 not found error with proper AccessError', async () => {
      const notFoundError = {
        response: { status: 404 },
        message: 'Not Found'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(notFoundError);

      await expect(api.getProject('invalid-project')).rejects.toMatchObject({
        type: 'not_found',
        message: 'Project "invalid-project" not found. Please verify the project ID or slug is correct.',
        workspaceId: 'invalid-project'
      });
    });

    it('should handle network errors with proper AccessError', async () => {
      const networkError = {
        code: 'NETWORK_ERROR',
        message: 'Network Error'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(networkError);

      await expect(api.getProject('cm123456789')).rejects.toMatchObject({
        type: 'network',
        message: 'Network error occurred while accessing the project. Please check your connection.',
        workspaceId: 'cm123456789'
      });
    });

    it('should handle unknown errors with proper AccessError', async () => {
      const unknownError = new Error('Something went wrong');

      mockAxiosInstance.get.mockRejectedValueOnce(unknownError);

      await expect(api.getProject('cm123456789')).rejects.toMatchObject({
        type: 'unknown',
        message: 'Failed to access project "cm123456789": Something went wrong',
        workspaceId: 'cm123456789'
      });
    });

    it('should retry on transient errors before giving up', async () => {
      const project: ProjectResponse = {
        id: 'cm123456789',
        name: 'Test Project',
        slug: 'test-project',
        environments: [],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Another temporary error'))
        .mockResolvedValueOnce({ data: project });

      const result = await api.getProject('cm123456789');

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(result).toEqual(project);
    });

    it('should handle project with no environments', async () => {
      const mockProject: ProjectResponse = {
        id: 'cm123456789',
        name: 'Empty Project',
        slug: 'empty-project',
        environments: [],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await api.getProject('cm123456789');

      expect(result.environments).toEqual([]);
      expect(result.environments.length).toBe(0);
    });

    it('should handle project with multiple environments', async () => {
      const mockProject: ProjectResponse = {
        id: 'cm123456789',
        name: 'Multi-Env Project',
        slug: 'multi-env-project',
        environments: [
          { id: 'env1', name: 'Development', slug: 'dev' },
          { id: 'env2', name: 'Staging', slug: 'staging' },
          { id: 'env3', name: 'Production', slug: 'prod' },
          { id: 'env4', name: 'Testing', slug: 'test' }
        ],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await api.getProject('cm123456789');

      expect(result.environments).toHaveLength(4);
      expect(result.environments.map(e => e.slug)).toEqual(['dev', 'staging', 'prod', 'test']);
    });
  });

  describe('region handling', () => {
    it('should work with US region', async () => {
      const usApi = new InfisicalApi('https://us.infisical.com', tokenStore as any);
      
      const mockProject: ProjectResponse = {
        id: 'us-project',
        name: 'US Project',
        slug: 'us-project',
        environments: [],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await usApi.getProject('us-project');

      expect(result).toEqual(mockProject);
    });

    it('should work with EU region', async () => {
      const euApi = new InfisicalApi('https://eu.infisical.com', tokenStore as any);
      
      const mockProject: ProjectResponse = {
        id: 'eu-project',
        name: 'EU Project',
        slug: 'eu-project',
        environments: [],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await euApi.getProject('eu-project');

      expect(result).toEqual(mockProject);
    });
  });

  describe('edge cases', () => {
    it('should handle empty workspace ID', async () => {
      await expect(api.getProject('')).rejects.toMatchObject({
        type: 'unknown',
        workspaceId: ''
      });
    });

    it('should handle special characters in workspace ID', async () => {
      const mockProject: ProjectResponse = {
        id: 'project-with-special-chars',
        name: 'Project With Special Chars',
        slug: 'project-with-special-chars',
        environments: [],
        orgId: 'org123',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProject });

      const result = await api.getProject('project-with-special-chars');

      expect(result).toEqual(mockProject);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/workspace/project-with-special-chars');
    });
  });
});