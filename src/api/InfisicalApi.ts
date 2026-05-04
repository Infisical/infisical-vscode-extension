import axios, { AxiosInstance } from 'axios';
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
  version: number;
  workspace: string;
  environment: string;
  secretKey: string;
  secretValue: string;
  secretComment: string;
  type: 'shared' | 'personal';
  secretPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface InfisicalFolder {
  id: string;
  name: string;
  path?: string;
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

export interface TokenInfo {
  accessToken: string;
  expiresAt: number;
  renewalThresholdSeconds: number;
}

export interface ListSecretsRequest {
  workspaceId: string;
  environment: string;
  secretPath?: string;
}

export interface SecretMutationRequest {
  workspaceId: string;
  environment: string;
  secretKey: string;
  secretValue?: string;
  secretPath?: string;
}

interface ProjectsResponse {
  workspaces: InfisicalProject[];
}

interface ProjectResponse {
  workspace: {
    id: string;
    name: string;
    slug: string;
    environments: InfisicalEnvironment[];
  };
}

interface ListSecretsResponse {
  secrets: InfisicalSecret[];
}

interface SecretResponse {
  secret: InfisicalSecret;
}

interface ListFoldersResponse {
  folders: InfisicalFolder[];
}

export class InfisicalApi {
  private client: AxiosInstance;

  constructor(
    private baseUrl: string,
    private tokenStore: TokenStore,
    private onUnauthorized?: () => void
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Infisical-VSCode/0.2.0'
      }
    });

    this.client.interceptors.request.use(async (config) => {
      const token = await this.tokenStore.getTokenInfo();
      if (token) {
        config.headers.Authorization = `Bearer ${token.accessToken}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          await this.logout();
          this.onUnauthorized?.();
        }
        return Promise.reject(error);
      }
    );
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.client.defaults.baseURL = baseUrl;
  }

  isAuthenticated(): boolean {
    return this.tokenStore.hasValidToken();
  }

  async setUserToken(token: string): Promise<void> {
    const expiresAt = parseJwtExpiry(token) ?? Date.now() + 24 * 60 * 60 * 1000;
    await this.tokenStore.setTokenInfo({
      accessToken: token,
      expiresAt,
      renewalThresholdSeconds: 0
    });
  }

  async checkAuth(): Promise<void> {
    await this.client.post('/api/v1/auth/checkAuth');
  }

  async logout(): Promise<void> {
    await this.tokenStore.clearTokenInfo();
  }

  async getProjects(): Promise<InfisicalProject[]> {
    const response = await this.client.get<ProjectsResponse>('/api/v1/workspace');
    return response.data.workspaces || [];
  }

  async getEnvironments(workspaceId: string): Promise<InfisicalEnvironment[]> {
    const response = await this.client.get<ProjectResponse>(`/api/v1/workspace/${workspaceId}`);
    return response.data.workspace?.environments || [];
  }

  async listSecrets(request: ListSecretsRequest): Promise<InfisicalSecret[]> {
    const params = new URLSearchParams({
      workspaceId: request.workspaceId,
      environment: request.environment,
      secretPath: request.secretPath || '/'
    });
    const response = await this.client.get<ListSecretsResponse>(
      `/api/v3/secrets/raw?${params.toString()}`
    );
    return response.data.secrets || [];
  }

  async listFolders(request: ListSecretsRequest): Promise<InfisicalFolder[]> {
    const params = new URLSearchParams({
      workspaceId: request.workspaceId,
      environment: request.environment,
      path: request.secretPath || '/'
    });
    const response = await this.client.get<ListFoldersResponse>(
      `/api/v1/folders?${params.toString()}`
    );
    return response.data.folders || [];
  }

  async createSecret(request: SecretMutationRequest): Promise<InfisicalSecret> {
    const response = await this.client.post<SecretResponse>(
      `/api/v3/secrets/raw/${encodeURIComponent(request.secretKey)}`,
      {
        workspaceId: request.workspaceId,
        environment: request.environment,
        secretValue: request.secretValue ?? '',
        secretPath: request.secretPath || '/',
        type: 'shared'
      }
    );
    return response.data.secret;
  }

  async updateSecret(request: SecretMutationRequest): Promise<InfisicalSecret> {
    const response = await this.client.patch<SecretResponse>(
      `/api/v3/secrets/raw/${encodeURIComponent(request.secretKey)}`,
      {
        workspaceId: request.workspaceId,
        environment: request.environment,
        secretValue: request.secretValue ?? '',
        secretPath: request.secretPath || '/',
        type: 'shared'
      }
    );
    return response.data.secret;
  }

  async deleteSecret(request: SecretMutationRequest): Promise<void> {
    await this.client.delete(
      `/api/v3/secrets/raw/${encodeURIComponent(request.secretKey)}`,
      {
        data: {
          workspaceId: request.workspaceId,
          environment: request.environment,
          secretPath: request.secretPath || '/',
          type: 'shared'
        }
      }
    );
  }
}

function parseJwtExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
