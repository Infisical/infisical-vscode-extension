import * as vscode from 'vscode';
import { InfisicalApi, InfisicalSecretV3, InfisicalSecretTag, AccessError } from '../api/InfisicalApi';
import { WorkspaceState } from '../utils/WorkspaceState';

export class SecretItem extends vscode.TreeItem {
  constructor(
    public readonly secret: InfisicalSecretV3,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(secret.secretKey, collapsibleState);
    
    const maskedValue = this.maskValue(secret.secretValue);
    this.description = maskedValue;
    this.tooltip = this.buildTooltip(secret);
    this.contextValue = 'secret';
    this.iconPath = this.getIconForSecret(secret);
    
    this.command = {
      command: 'infisicalAi.showSecretDetail',
      title: 'Show Secret Details',
      arguments: [secret]
    };
  }

  private maskValue(value: string): string {
    if (value.length <= 4) {
      return '••••';
    }
    return value.substring(0, 2) + '••••' + value.substring(value.length - 2);
  }

  private buildTooltip(secret: InfisicalSecretV3): string {
    const maskedValue = this.maskValue(secret.secretValue);
    const tags = secret.tags.map(t => t.name).join(', ');
    
    let tooltip = `Key: ${secret.secretKey}\nValue: ${maskedValue}\nType: ${secret.type}`;
    
    if (secret.secretComment) {
      tooltip += `\nComment: ${secret.secretComment}`;
    }
    
    if (tags) {
      tooltip += `\nTags: ${tags}`;
    }
    
    if (secret.secretPath !== '/') {
      tooltip += `\nPath: ${secret.secretPath}`;
    }
    
    tooltip += `\nUpdated: ${new Date(secret.updatedAt).toLocaleDateString()}`;
    
    return tooltip;
  }

  private getIconForSecret(secret: InfisicalSecretV3): vscode.ThemeIcon {
    if (secret.type === 'personal') {
      return new vscode.ThemeIcon('person');
    }
    
    if (secret.tags.some(tag => tag.name.toLowerCase().includes('env'))) {
      return new vscode.ThemeIcon('symbol-variable');
    }
    
    if (secret.tags.some(tag => tag.name.toLowerCase().includes('db'))) {
      return new vscode.ThemeIcon('database');
    }
    
    return new vscode.ThemeIcon('key');
  }
}

export class SecretPathItem extends vscode.TreeItem {
  constructor(
    public readonly path: string,
    public readonly secretCount: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(path === '/' ? 'Root' : path.split('/').pop() || path, collapsibleState);
    this.description = `${secretCount} secrets`;
    this.tooltip = `Path: ${path}\n${secretCount} secrets`;
    this.contextValue = 'secretPath';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class ErrorItem extends vscode.TreeItem {
  constructor(message: string, action?: string, command?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error');
    this.contextValue = 'error';
    
    if (action && command) {
      this.command = {
        command,
        title: action,
        arguments: []
      };
    }
  }
}

export class LoadingItem extends vscode.TreeItem {
  constructor(message: string = 'Loading secrets...') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'loading';
  }
}

export class InfisicalSecretsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private secrets: InfisicalSecretV3[] = [];
  private loading = false;
  private error: string | null = null;
  private filter = '';
  private secretPath = '/';

  constructor(
    private infisicalApi: InfisicalApi,
    private workspaceState: WorkspaceState
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setFilter(filter: string): void {
    this.filter = filter.toLowerCase();
    this.refresh();
  }

  setSecretPath(path: string): void {
    this.secretPath = path || '/';
    this.loadSecrets();
  }

  async loadSecrets(): Promise<void> {
    const state = this.workspaceState.getProjectEnvironment();
    if (!state?.projectId || !state?.environmentSlug) {
      this.secrets = [];
      this.error = null;
      this.refresh();
      return;
    }

    this.loading = true;
    this.error = null;
    this.refresh();

    try {
      const secrets = await this.infisicalApi.listSecrets({
        workspaceId: state.projectId,
        environment: state.environmentSlug,
        secretPath: this.secretPath
      });

      this.secrets = secrets;
      this.loading = false;
      this.refresh();
    } catch (error) {
      this.loading = false;
      if (this.isAccessError(error)) {
        this.error = error.message;
      } else if (error instanceof Error) {
        this.error = error.message;
      } else {
        this.error = 'Failed to load secrets';
      }
      this.refresh();
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.infisicalApi.isAuthenticated()) {
      return [new ErrorItem('Not authenticated', 'Login', 'infisicalAi.login')];
    }

    const state = this.workspaceState.getProjectEnvironment();
    if (!state?.projectId || !state?.environmentSlug) {
      return [new ErrorItem('No project/environment selected', 'Open Control Panel', 'infisicalAi.openControlPanel')];
    }

    if (this.loading) {
      return [new LoadingItem()];
    }

    if (this.error) {
      if (this.error.includes('Access denied')) {
        return [new ErrorItem(this.error, 'Check Permissions', 'infisicalAi.openControlPanel')];
      }
      return [new ErrorItem(this.error, 'Retry', 'infisicalAi.refreshSecrets')];
    }

    if (!element) {
      return this.getRootItems();
    }

    if (element instanceof SecretPathItem) {
      return this.getSecretsForPath(element.path);
    }

    return [];
  }

  private getRootItems(): vscode.TreeItem[] {
    if (this.secrets.length === 0) {
      return [new ErrorItem('No secrets found', 'Create Secret', 'infisicalAi.createSecret')];
    }

    // Group secrets by path
    const pathGroups = this.groupSecretsByPath(this.getFilteredSecrets());
    
    if (pathGroups.size === 1 && pathGroups.has('/')) {
      // If all secrets are in root path, show them directly
      return this.getSecretsForPath('/');
    }

    // Show path groups
    return Array.from(pathGroups.entries()).map(([path, secrets]) => 
      new SecretPathItem(path, secrets.length)
    );
  }

  private getSecretsForPath(path: string): SecretItem[] {
    const pathSecrets = this.getFilteredSecrets().filter(s => s.secretPath === path);
    return pathSecrets.map(secret => new SecretItem(secret));
  }

  private getFilteredSecrets(): InfisicalSecretV3[] {
    if (!this.filter) {
      return this.secrets;
    }

    return this.secrets.filter(secret => 
      secret.secretKey.toLowerCase().includes(this.filter) ||
      secret.secretComment.toLowerCase().includes(this.filter) ||
      secret.tags.some(tag => tag.name.toLowerCase().includes(this.filter))
    );
  }

  private groupSecretsByPath(secrets: InfisicalSecretV3[]): Map<string, InfisicalSecretV3[]> {
    const groups = new Map<string, InfisicalSecretV3[]>();
    
    for (const secret of secrets) {
      const path = secret.secretPath || '/';
      if (!groups.has(path)) {
        groups.set(path, []);
      }
      groups.get(path)!.push(secret);
    }
    
    return groups;
  }

  private isAccessError(error: any): error is AccessError {
    return error && typeof error.type === 'string' && typeof error.message === 'string';
  }

  // Public methods for external access
  getSecrets(): InfisicalSecretV3[] {
    return this.secrets;
  }

  getCurrentFilter(): string {
    return this.filter;
  }

  getCurrentSecretPath(): string {
    return this.secretPath;
  }

  isLoading(): boolean {
    return this.loading;
  }

  getError(): string | null {
    return this.error;
  }
}