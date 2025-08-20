import * as vscode from 'vscode';
import { InfisicalApi } from '../api/InfisicalApi';

export class AuthItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description?: string,
    public readonly command?: vscode.Command,
    public readonly iconPath?: vscode.ThemeIcon
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.command = command;
    this.iconPath = iconPath;
  }
}

export class AuthProvider implements vscode.TreeDataProvider<AuthItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AuthItem | undefined | null | void> = new vscode.EventEmitter<AuthItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<AuthItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private infisicalApi: InfisicalApi,
    private context: vscode.ExtensionContext
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AuthItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AuthItem[]> {
    if (this.infisicalApi.isAuthenticated()) {
      return [];
    }

    return [
      new AuthItem(
        'Login to Infisical',
        'Connect with Universal Auth',
        {
          command: 'infisicalAi.login',
          title: 'Login'
        },
        new vscode.ThemeIcon('sign-in')
      ),
      new AuthItem(
        'Open Control Panel',
        'Web-based authentication',
        {
          command: 'infisicalAi.openControlPanel',
          title: 'Open Control Panel'
        },
        new vscode.ThemeIcon('browser')
      ),
      new AuthItem(
        'Get Infisical Credentials',
        'Visit Infisical dashboard',
        {
          command: 'vscode.open',
          title: 'Open Infisical',
          arguments: [vscode.Uri.parse('https://us.infisical.com')]
        },
        new vscode.ThemeIcon('link-external')
      )
    ];
  }
}