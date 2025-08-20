import { vi } from 'vitest';
import { TokenInfo, UniversalAuthLoginRequest } from '../../api/InfisicalApi';

export class MockTokenStore {
  private tokenInfo: TokenInfo | undefined;
  private credentials: UniversalAuthLoginRequest | undefined;

  constructor(
    private globalState: any = {},
    private secretStorage: any = {}
  ) {}

  async setTokenInfo(tokenInfo: TokenInfo): Promise<void> {
    this.tokenInfo = tokenInfo;
  }

  async getTokenInfo(): Promise<TokenInfo | undefined> {
    return this.tokenInfo;
  }

  async clearTokenInfo(): Promise<void> {
    this.tokenInfo = undefined;
  }

  async setCredentials(credentials: UniversalAuthLoginRequest): Promise<void> {
    this.credentials = credentials;
  }

  async getCredentials(): Promise<UniversalAuthLoginRequest | undefined> {
    return this.credentials;
  }

  async clearCredentials(): Promise<void> {
    this.credentials = undefined;
  }

  hasValidToken(): boolean {
    if (!this.tokenInfo) {
      return false;
    }

    const now = Date.now();
    return this.tokenInfo.expiresAt > now;
  }

  getToken(): string | undefined {
    return this.tokenInfo?.accessToken;
  }

  hasToken(): boolean {
    return this.hasValidToken();
  }

  async setToken(token: string): Promise<void> {
    const tokenInfo: TokenInfo = {
      accessToken: token,
      expiresAt: Date.now() + (3600 * 1000),
      renewalThresholdSeconds: 60
    };
    await this.setTokenInfo(tokenInfo);
  }

  async clearToken(): Promise<void> {
    await this.clearTokenInfo();
  }
}