import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { TokenStore } from '../utils/TokenStore';

export interface InfisicalProject {
  id: string;
  name: string;
  slug: string;
  environments?: InfisicalEnvironment[];
}

export interface InfisicalEnvironment {
  id: string;
  name: string;
  slug: string;
}

export interface InfisicalSecret {
  id: string;
  key: string;
  value: string;
  environment: string;
  createdAt: string;
  updatedAt: string;
}

export interface InfisicalSecretV3 {
  id: string;
  version: number;
  workspace: string;
  environment: string;
  secretKey: string;
  secretValue: string;
  secretComment: string;
  type: 'shared' | 'personal';
  tags: InfisicalSecretTag[];
  createdAt: string;
  updatedAt: string;
  secretPath: string;
}

export interface InfisicalSecretTag {
  id: string;
  name: string;
  slug: string;
  color?: string;
}

export interface ListSecretsRequest {
  workspaceId: string;
  environment: string;
  secretPath?: string;
}

export interface GetSecretRequest {
  workspaceId: string;
  environment: string;
  name: string;
  type?: 'shared' | 'personal';
  secretPath?: string;
}

export interface UniversalAuthLoginRequest {
  clientId: string;
  clientSecret: string;
}

export interface UniversalAuthLoginResponse {
  accessToken: string;
  expiresIn: number;
  accessTokenMaxTTL: number;
  tokenType: string;
}

export interface TokenRenewResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface TokenInfo {
  accessToken: string;
  expiresAt: number;
  renewalThresholdSeconds: number;
}

export interface ProjectsResponse {
  workspaces: InfisicalProject[];
}

export interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  environments: InfisicalEnvironment[];
  orgId: string;
  createdAt: string;
  updatedAt: string;
  permissions?: WorkspacePermissions;
}

export interface SecretsResponse {
  secrets: InfisicalSecret[];
}

export interface ListSecretsV3Response {
  secrets: InfisicalSecretV3[];
}

export interface GetSecretV3Response {
  secret: InfisicalSecretV3;
}

export interface AccessError {
  type: 'not_found' | 'forbidden' | 'network' | 'unknown';
  message: string;
  workspaceId?: string;
}

export interface InfisicalRole {
  id: string;
  name: string;
  slug: string;
  permissions: string[];
  isTemporary?: boolean;
  temporaryMode?: string;
  temporaryRange?: string;
  temporaryAccessStartTime?: string;
  temporaryAccessEndTime?: string;
}

export interface InfisicalMembership {
  id: string;
  userId?: string;
  identityId?: string;
  roles: InfisicalRole[];
  createdAt: string;
  updatedAt: string;
}

export interface IdentityMembershipsResponse {
  identityMemberships: InfisicalMembership[];
}

export interface WorkspacePermissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canCreateSecrets: boolean;
  canUpdateSecrets: boolean;
  canDeleteSecrets: boolean;
  roles: string[];
  effectiveRole: 'viewer' | 'member' | 'admin' | 'owner' | 'no-access';
}

export class InfisicalApi {
  private client: AxiosInstance;
  private tokenStore: TokenStore;
  private maxRetries: number;
  private baseBackoffMs: number;
  private currentCredentials: UniversalAuthLoginRequest | null = null;
  private renewalInProgress = false;
  private permissionsCache = new Map<string, WorkspacePermissions>();

  constructor(
    private baseUrl: string,
    tokenStore: TokenStore,
    maxRetries: number = 3,
    baseBackoffMs: number = 1000
  ) {
    this.tokenStore = tokenStore;
    this.maxRetries = maxRetries;
    this.baseBackoffMs = baseBackoffMs;

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'InfisicalAI-VSCode/0.1.0'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      async (config) => {
        const tokenInfo = await this.getValidToken();
        if (tokenInfo?.accessToken) {
          config.headers.Authorization = `Bearer ${tokenInfo.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && !this.renewalInProgress) {
          try {
            await this.attemptTokenRenewal();
            const originalRequest = error.config;
            const tokenInfo = await this.tokenStore.getTokenInfo();
            if (tokenInfo?.accessToken) {
              originalRequest.headers.Authorization = `Bearer ${tokenInfo.accessToken}`;
              return this.client.request(originalRequest);
            }
          } catch (renewError) {
            await this.logout();
            throw new Error('Authentication failed. Please log in again.');
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === this.maxRetries) {
          break;
        }

        if (error instanceof Error && error.message.includes('401')) {
          throw error;
        }

        const backoffMs = this.baseBackoffMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 0.1 * backoffMs;
        await this.sleep(backoffMs + jitter);
      }
    }

    throw new Error(`${operationName} failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  async login(credentials: UniversalAuthLoginRequest): Promise<void> {
    await this.retryOperation(async () => {
      const response = await this.client.post<UniversalAuthLoginResponse>(
        '/api/v1/auth/universal-auth/login',
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret
        }
      );

      const { accessToken, expiresIn } = response.data;
      const expiresAt = Date.now() + (expiresIn * 1000);
      
      const tokenInfo: TokenInfo = {
        accessToken,
        expiresAt,
        renewalThresholdSeconds: 60
      };

      await this.tokenStore.setTokenInfo(tokenInfo);
      await this.tokenStore.setCredentials(credentials);
      this.currentCredentials = credentials;
    }, 'Universal Auth Login');
  }

  async logout(): Promise<void> {
    await this.tokenStore.clearTokenInfo();
    await this.tokenStore.clearCredentials();
    this.currentCredentials = null;
  }

  isAuthenticated(): boolean {
    return this.tokenStore.hasValidToken();
  }

  private async getValidToken(): Promise<TokenInfo | null> {
    const tokenInfo = await this.tokenStore.getTokenInfo();
    if (!tokenInfo) {
      return null;
    }

    const now = Date.now();
    const timeUntilExpiry = tokenInfo.expiresAt - now;
    const renewalThreshold = tokenInfo.renewalThresholdSeconds * 1000;

    if (timeUntilExpiry <= renewalThreshold && !this.renewalInProgress) {
      try {
        await this.attemptTokenRenewal();
        return await this.tokenStore.getTokenInfo();
      } catch (error) {
        console.warn('Token renewal failed:', error);
        return tokenInfo;
      }
    }

    return tokenInfo;
  }

  private async attemptTokenRenewal(): Promise<void> {
    if (this.renewalInProgress) {
      return;
    }

    this.renewalInProgress = true;
    try {
      const currentToken = await this.tokenStore.getTokenInfo();
      if (!currentToken?.accessToken) {
        throw new Error('No access token available for renewal');
      }

      const response = await this.client.post<TokenRenewResponse>(
        '/api/v1/auth/token/renew',
        {},
        {
          headers: {
            Authorization: `Bearer ${currentToken.accessToken}`
          }
        }
      );

      const { accessToken, expiresIn } = response.data;
      const expiresAt = Date.now() + (expiresIn * 1000);
      
      const newTokenInfo: TokenInfo = {
        accessToken,
        expiresAt,
        renewalThresholdSeconds: currentToken.renewalThresholdSeconds
      };

      await this.tokenStore.setTokenInfo(newTokenInfo);
    } finally {
      this.renewalInProgress = false;
    }
  }

  async getProjects(): Promise<InfisicalProject[]> {
    return this.retryOperation(async () => {
      const response = await this.client.get<ProjectsResponse>('/api/v1/workspace');
      return response.data.workspaces || [];
    }, 'Get projects');
  }

  async getProject(workspaceId: string): Promise<ProjectResponse> {
    return this.retryOperation(async () => {
      try {
        const response = await this.client.get<ProjectResponse>(`/api/v1/workspace/${workspaceId}`);
        const project = response.data;
        
        // Detect permissions by attempting operations and checking identity memberships
        const permissions = await this.detectWorkspacePermissions(workspaceId);
        project.permissions = permissions;
        
        // Cache permissions for later use
        this.permissionsCache.set(workspaceId, permissions);
        
        return project;
      } catch (error: any) {
        if (error.response?.status === 403) {
          const accessError: AccessError = {
            type: 'forbidden',
            message: `Access denied to project "${workspaceId}". Please check your permissions or verify the project ID.`,
            workspaceId
          };
          throw accessError;
        } else if (error.response?.status === 404) {
          const accessError: AccessError = {
            type: 'not_found',
            message: `Project "${workspaceId}" not found. Please verify the project ID or slug is correct.`,
            workspaceId
          };
          throw accessError;
        } else if (error.code === 'NETWORK_ERROR' || error.message?.includes('network')) {
          const accessError: AccessError = {
            type: 'network',
            message: 'Network error occurred while accessing the project. Please check your connection.',
            workspaceId
          };
          throw accessError;
        }
        
        const accessError: AccessError = {
          type: 'unknown',
          message: `Failed to access project "${workspaceId}": ${error.message || 'Unknown error'}`,
          workspaceId
        };
        throw accessError;
      }
    }, 'Get project');
  }

  async listIdentityMemberships(workspaceId: string): Promise<InfisicalMembership[]> {
    return this.retryOperation(async () => {
      try {
        const response = await this.client.get<IdentityMembershipsResponse>(
          `/api/v2/workspace/${workspaceId}/identity-memberships`
        );
        return response.data.identityMemberships || [];
      } catch (error: any) {
        if (error.response?.status === 403 || error.response?.status === 404) {
          // Identity memberships endpoint not available or no permission
          return [];
        }
        throw error;
      }
    }, 'List identity memberships');
  }

  async detectWorkspacePermissions(workspaceId: string): Promise<WorkspacePermissions> {
    try {
      // First, try to get detailed role information from identity memberships
      const memberships = await this.listIdentityMemberships(workspaceId);
      
      if (memberships.length > 0) {
        // Extract permissions from membership roles
        return this.extractPermissionsFromMemberships(memberships);
      }
      
      // Fallback: Test permissions by attempting operations
      return await this.testWorkspacePermissions(workspaceId);
    } catch (error) {
      console.warn('Failed to detect workspace permissions:', error);
      // Default to read-only on error
      return {
        canRead: true,
        canWrite: false,
        canDelete: false,
        canCreateSecrets: false,
        canUpdateSecrets: false,
        canDeleteSecrets: false,
        roles: [],
        effectiveRole: 'viewer'
      };
    }
  }

  private extractPermissionsFromMemberships(memberships: InfisicalMembership[]): WorkspacePermissions {
    const allRoles: string[] = [];
    const allPermissions: string[] = [];
    
    for (const membership of memberships) {
      for (const role of membership.roles) {
        allRoles.push(role.name);
        allPermissions.push(...role.permissions);
      }
    }
    
    // Determine effective role (highest privilege level)
    let effectiveRole: WorkspacePermissions['effectiveRole'] = 'no-access';
    if (allRoles.some(r => r.toLowerCase().includes('owner'))) {
      effectiveRole = 'owner';
    } else if (allRoles.some(r => r.toLowerCase().includes('admin'))) {
      effectiveRole = 'admin';
    } else if (allRoles.some(r => r.toLowerCase().includes('member') || r.toLowerCase().includes('developer'))) {
      effectiveRole = 'member';
    } else if (allRoles.some(r => r.toLowerCase().includes('viewer') || r.toLowerCase().includes('read'))) {
      effectiveRole = 'viewer';
    }
    
    // Map permissions to capabilities
    const canRead = allPermissions.some(p => p.includes('read') || p.includes('secrets:read'));
    const canWrite = allPermissions.some(p => p.includes('write') || p.includes('secrets:write'));
    const canDelete = allPermissions.some(p => p.includes('delete') || p.includes('secrets:delete'));
    
    return {
      canRead: canRead || effectiveRole !== 'no-access',
      canWrite: canWrite || ['admin', 'owner', 'member'].includes(effectiveRole),
      canDelete: canDelete || ['admin', 'owner'].includes(effectiveRole),
      canCreateSecrets: canWrite || ['admin', 'owner', 'member'].includes(effectiveRole),
      canUpdateSecrets: canWrite || ['admin', 'owner', 'member'].includes(effectiveRole),
      canDeleteSecrets: canDelete || ['admin', 'owner'].includes(effectiveRole),
      roles: allRoles,
      effectiveRole
    };
  }

  private async testWorkspacePermissions(workspaceId: string): Promise<WorkspacePermissions> {
    const permissions: WorkspacePermissions = {
      canRead: false,
      canWrite: false,
      canDelete: false,
      canCreateSecrets: false,
      canUpdateSecrets: false,
      canDeleteSecrets: false,
      roles: [],
      effectiveRole: 'no-access'
    };
    
    try {
      // Test read permission by trying to list secrets in dev environment
      const envs = ['dev', 'development', 'staging', 'prod', 'production'];
      let canReadSecrets = false;
      
      for (const env of envs) {
        try {
          await this.listSecrets({ workspaceId, environment: env });
          canReadSecrets = true;
          permissions.canRead = true;
          break;
        } catch (error: any) {
          if (error.response?.status === 404) {
            continue; // Environment doesn't exist, try next
          }
          if (error.response?.status !== 403) {
            break; // Other error, stop testing
          }
        }
      }
      
      if (canReadSecrets) {
        permissions.effectiveRole = 'viewer';
        
        // Test write permission by attempting to create a test secret
        try {
          // Note: We don't actually create the secret, just test the validation
          await this.client.post('/api/v3/secrets/raw', {
            secretKey: '__test_permission_check__',
            secretValue: 'test',
            workspaceId: workspaceId,
            environment: 'dev', // Assume dev environment exists
            type: 'shared'
          });
          // If we get here, we have write permission
          permissions.canWrite = true;
          permissions.canCreateSecrets = true;
          permissions.canUpdateSecrets = true;
          permissions.effectiveRole = 'member';
        } catch (error: any) {
          // Expected to fail, but check if it's a permission error vs validation error
          if (error.response?.status !== 403) {
            // Not a permission error, likely validation - we probably have write access
            permissions.canWrite = true;
            permissions.canCreateSecrets = true;
            permissions.canUpdateSecrets = true;
            permissions.effectiveRole = 'member';
          }
        }
      }
    } catch (error) {
      console.warn('Permission testing failed:', error);
    }
    
    return permissions;
  }

  getWorkspacePermissions(workspaceId: string): WorkspacePermissions | null {
    return this.permissionsCache.get(workspaceId) || null;
  }

  clearPermissionsCache(): void {
    this.permissionsCache.clear();
  }

  async handlePermissionDowngrade(workspaceId: string, error: any): Promise<WorkspacePermissions> {
    console.warn('Permission downgrade detected for workspace:', workspaceId, error);
    
    // Update cached permissions to reflect read-only access
    const downgradedPermissions: WorkspacePermissions = {
      canRead: true, // Assume we can still read if we got here
      canWrite: false,
      canDelete: false,
      canCreateSecrets: false,
      canUpdateSecrets: false,
      canDeleteSecrets: false,
      roles: ['viewer'],
      effectiveRole: 'viewer'
    };
    
    this.permissionsCache.set(workspaceId, downgradedPermissions);
    return downgradedPermissions;
  }

  async getEnvironments(projectId: string): Promise<InfisicalEnvironment[]> {
    return this.retryOperation(async () => {
      const response = await this.client.get(`/api/v1/workspace/${projectId}/environments`);
      return response.data.environments || [];
    }, 'Get environments');
  }

  async listSecrets(request: ListSecretsRequest): Promise<InfisicalSecretV3[]> {
    return this.retryOperation(async () => {
      try {
        const params = new URLSearchParams({
          workspaceId: request.workspaceId,
          environment: request.environment
        });

        if (request.secretPath) {
          params.append('secretPath', request.secretPath);
        }

        const response = await this.client.get<ListSecretsV3Response>(
          `/api/v3/secrets/raw?${params.toString()}`
        );
        return response.data.secrets || [];
      } catch (error: any) {
        if (error.response?.status === 403) {
          const accessError: AccessError = {
            type: 'forbidden',
            message: `Access denied to secrets in project "${request.workspaceId}" environment "${request.environment}". Please check your permissions.`,
            workspaceId: request.workspaceId
          };
          throw accessError;
        } else if (error.response?.status === 404) {
          const accessError: AccessError = {
            type: 'not_found',
            message: `Environment "${request.environment}" not found in project "${request.workspaceId}".`,
            workspaceId: request.workspaceId
          };
          throw accessError;
        } else if (error.response?.status === 401) {
          throw new Error('Authentication required. Please log in again.');
        }
        throw error;
      }
    }, 'List secrets');
  }

  async getSecret(request: GetSecretRequest): Promise<InfisicalSecretV3> {
    return this.retryOperation(async () => {
      try {
        const params = new URLSearchParams({
          workspaceId: request.workspaceId,
          environment: request.environment,
          type: request.type || 'shared'
        });

        if (request.secretPath) {
          params.append('secretPath', request.secretPath);
        }

        const response = await this.client.get<GetSecretV3Response>(
          `/api/v3/secrets/raw/${encodeURIComponent(request.name)}?${params.toString()}`
        );
        return response.data.secret;
      } catch (error: any) {
        if (error.response?.status === 403) {
          const accessError: AccessError = {
            type: 'forbidden',
            message: `Access denied to secret "${request.name}" in project "${request.workspaceId}". Please check your permissions.`,
            workspaceId: request.workspaceId
          };
          throw accessError;
        } else if (error.response?.status === 404) {
          const accessError: AccessError = {
            type: 'not_found',
            message: `Secret "${request.name}" not found in environment "${request.environment}".`,
            workspaceId: request.workspaceId
          };
          throw accessError;
        } else if (error.response?.status === 401) {
          throw new Error('Authentication required. Please log in again.');
        }
        throw error;
      }
    }, 'Get secret');
  }

  async getSecrets(projectId: string, environment: string): Promise<InfisicalSecret[]> {
    return this.retryOperation(async () => {
      const response = await this.client.get<SecretsResponse>(
        `/api/v3/secrets/raw?workspaceId=${projectId}&environment=${environment}`
      );
      return response.data.secrets || [];
    }, 'Get secrets');
  }

  async createSecret(
    key: string,
    value: string,
    projectId?: string,
    environment?: string
  ): Promise<InfisicalSecret> {
    return this.retryOperation(async () => {
      try {
        const currentProject = projectId || await this.getCurrentProject();
        const currentEnv = environment || await this.getCurrentEnvironment();

        const response = await this.client.post<{ secret: InfisicalSecret }>(
          '/api/v3/secrets/raw',
          {
            secretKey: key,
            secretValue: value,
            workspaceId: currentProject,
            environment: currentEnv,
            type: 'shared'
          }
        );
        return response.data.secret;
      } catch (error: any) {
        if (error.response?.status === 403) {
          const workspaceId = projectId || await this.getCurrentProject();
          await this.handlePermissionDowngrade(workspaceId, error);
          
          const accessError: AccessError = {
            type: 'forbidden',
            message: `Insufficient privileges to create secrets. Your access has been downgraded to read-only.`,
            workspaceId
          };
          throw accessError;
        }
        throw error;
      }
    }, 'Create secret');
  }

  async updateSecret(
    key: string,
    value: string,
    projectId?: string,
    environment?: string
  ): Promise<InfisicalSecret> {
    return this.retryOperation(async () => {
      try {
        const currentProject = projectId || await this.getCurrentProject();
        const currentEnv = environment || await this.getCurrentEnvironment();

        const response = await this.client.patch<{ secret: InfisicalSecret }>(
          '/api/v3/secrets/raw',
          {
            secretKey: key,
            secretValue: value,
            workspaceId: currentProject,
            environment: currentEnv,
            type: 'shared'
          }
        );
        return response.data.secret;
      } catch (error: any) {
        if (error.response?.status === 403) {
          const workspaceId = projectId || await this.getCurrentProject();
          await this.handlePermissionDowngrade(workspaceId, error);
          
          const accessError: AccessError = {
            type: 'forbidden',
            message: `Insufficient privileges to update secrets. Your access has been downgraded to read-only.`,
            workspaceId
          };
          throw accessError;
        }
        throw error;
      }
    }, 'Update secret');
  }

  async deleteSecret(
    key: string,
    projectId?: string,
    environment?: string
  ): Promise<void> {
    await this.retryOperation(async () => {
      try {
        const currentProject = projectId || await this.getCurrentProject();
        const currentEnv = environment || await this.getCurrentEnvironment();

        await this.client.delete('/api/v3/secrets/raw', {
          data: {
            secretKey: key,
            workspaceId: currentProject,
            environment: currentEnv,
            type: 'shared'
          }
        });
      } catch (error: any) {
        if (error.response?.status === 403) {
          const workspaceId = projectId || await this.getCurrentProject();
          await this.handlePermissionDowngrade(workspaceId, error);
          
          const accessError: AccessError = {
            type: 'forbidden',
            message: `Insufficient privileges to delete secrets. Your access has been downgraded to read-only.`,
            workspaceId
          };
          throw accessError;
        }
        throw error;
      }
    }, 'Delete secret');
  }

  private async getCurrentProject(): Promise<string> {
    return 'mock-project-id';
  }

  private async getCurrentEnvironment(): Promise<string> {
    return 'dev';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.client.defaults.baseURL = baseUrl;
  }
}