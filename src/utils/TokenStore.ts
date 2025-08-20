import * as vscode from 'vscode';
import { TokenInfo, UniversalAuthLoginRequest } from '../api/InfisicalApi';

export class TokenStore {
  private static readonly TOKEN_INFO_KEY = 'infisicalAi.tokenInfo';
  private static readonly CREDENTIALS_KEY = 'infisicalAi.credentials';
  
  constructor(
    private globalState: vscode.Memento,
    private secretStorage: vscode.SecretStorage
  ) {}

  async setTokenInfo(tokenInfo: TokenInfo): Promise<void> {
    await this.globalState.update(TokenStore.TOKEN_INFO_KEY, tokenInfo);
  }

  async getTokenInfo(): Promise<TokenInfo | undefined> {
    return this.globalState.get<TokenInfo>(TokenStore.TOKEN_INFO_KEY);
  }

  async clearTokenInfo(): Promise<void> {
    await this.globalState.update(TokenStore.TOKEN_INFO_KEY, undefined);
  }

  async setCredentials(credentials: UniversalAuthLoginRequest): Promise<void> {
    const credentialsJson = JSON.stringify(credentials);
    await this.secretStorage.store(TokenStore.CREDENTIALS_KEY, credentialsJson);
  }

  async getCredentials(): Promise<UniversalAuthLoginRequest | undefined> {
    const credentialsJson = await this.secretStorage.get(TokenStore.CREDENTIALS_KEY);
    if (!credentialsJson) {
      return undefined;
    }
    
    try {
      return JSON.parse(credentialsJson) as UniversalAuthLoginRequest;
    } catch (error) {
      console.error('Error parsing stored credentials:', error);
      await this.clearCredentials();
      return undefined;
    }
  }

  async clearCredentials(): Promise<void> {
    await this.secretStorage.delete(TokenStore.CREDENTIALS_KEY);
  }

  hasValidToken(): boolean {
    const tokenInfo = this.globalState.get<TokenInfo>(TokenStore.TOKEN_INFO_KEY);
    if (!tokenInfo) {
      return false;
    }

    const now = Date.now();
    return tokenInfo.expiresAt > now;
  }

  getToken(): string | undefined {
    const tokenInfo = this.globalState.get<TokenInfo>(TokenStore.TOKEN_INFO_KEY);
    return tokenInfo?.accessToken;
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