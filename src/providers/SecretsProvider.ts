import * as vscode from 'vscode';
import {
  InfisicalApi,
  InfisicalEnvironment,
  InfisicalFolder,
  InfisicalProject,
  InfisicalSecret
} from '../api/InfisicalApi';

export const ContextValue = {
  Project: 'infisical.project',
  Environment: 'infisical.environment',
  EnvironmentRevealed: 'infisical.environment.revealed',
  Folder: 'infisical.folder',
  FolderRevealed: 'infisical.folder.revealed',
  Secret: 'infisical.secret'
} as const;

export type TreeNode =
  | ProjectNode
  | EnvironmentNode
  | FolderNode
  | SecretNode
  | MessageNode;

export class ProjectNode extends vscode.TreeItem {
  readonly kind = 'project' as const;

  constructor(public readonly project: InfisicalProject) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = ContextValue.Project;
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = `Project: ${project.name}\nID: ${project.id}`;
  }
}

export class EnvironmentNode extends vscode.TreeItem {
  readonly kind = 'environment' as const;

  constructor(
    public readonly project: InfisicalProject,
    public readonly environment: InfisicalEnvironment,
    public readonly revealed: boolean = false
  ) {
    super(environment.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = revealed
      ? ContextValue.EnvironmentRevealed
      : ContextValue.Environment;
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.description = environment.slug;
    this.tooltip = `Environment: ${environment.name} (${environment.slug})`;
    this.command = {
      command: 'infisical.openSecretsPanel',
      title: 'Open Secrets',
      arguments: [{ project, environment, path: '/' }]
    };
  }
}

export class FolderNode extends vscode.TreeItem {
  readonly kind = 'folder' as const;

  constructor(
    public readonly project: InfisicalProject,
    public readonly environment: InfisicalEnvironment,
    public readonly parentPath: string,
    public readonly folder: InfisicalFolder,
    public readonly revealed: boolean = false
  ) {
    super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = revealed ? ContextValue.FolderRevealed : ContextValue.Folder;
    this.iconPath = vscode.ThemeIcon.Folder;
    this.tooltip = `Folder: ${this.fullPath}`;
    this.command = {
      command: 'infisical.openSecretsPanel',
      title: 'Open Secrets',
      arguments: [{ project, environment, path: this.fullPath }]
    };
  }

  get fullPath(): string {
    return joinSecretPath(this.parentPath, this.folder.name);
  }
}

export class SecretNode extends vscode.TreeItem {
  readonly kind = 'secret' as const;

  constructor(
    public readonly project: InfisicalProject,
    public readonly environment: InfisicalEnvironment,
    public readonly secretPath: string,
    public readonly secret: InfisicalSecret,
    public readonly revealed: boolean = false
  ) {
    super(secret.secretKey, vscode.TreeItemCollapsibleState.None);
    this.contextValue = ContextValue.Secret;
    this.iconPath = new vscode.ThemeIcon('key');
    this.description = revealed
      ? secret.secretValue || '(empty)'
      : maskValue(secret.secretValue);
    this.tooltip = new vscode.MarkdownString(
      `**${secret.secretKey}**\n\nPath: \`${secretPath}\`\n\nClick to view & edit.`
    );
    this.command = {
      command: 'infisical.viewSecret',
      title: 'View Secret',
      arguments: [this]
    };
  }
}

export class MessageNode extends vscode.TreeItem {
  readonly kind = 'message' as const;

  constructor(
    label: string,
    icon: string,
    command?: vscode.Command,
    contextValue?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    if (command) this.command = command;
    if (contextValue) this.contextValue = contextValue;
  }
}

export function joinSecretPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

function maskValue(value: string): string {
  if (!value) return '(empty)';
  if (value.length <= 4) return '••••';
  return value.slice(0, 2) + '••••' + value.slice(-2);
}

function scopeKey(projectId: string, envSlug: string, path: string): string {
  return `${projectId}|${envSlug}|${path}`;
}

function ancestorPaths(path: string): string[] {
  if (path === '/') return ['/'];
  const parts = path.split('/').filter(Boolean);
  const out = ['/'];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    out.push(acc);
  }
  return out;
}

export class InfisicalTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly revealedScopes = new Set<string>();

  constructor(private api: InfisicalApi) {}

  refresh(node?: TreeNode): void {
    this._onDidChangeTreeData.fire(node);
  }

  revealScope(projectId: string, envSlug: string, path: string): void {
    const key = scopeKey(projectId, envSlug, path);
    if (this.revealedScopes.has(key)) return;
    this.revealedScopes.add(key);
    this.refresh();
  }

  hideScope(projectId: string, envSlug: string, path: string): void {
    const key = scopeKey(projectId, envSlug, path);
    if (!this.revealedScopes.delete(key)) return;
    this.refresh();
  }

  hasScope(projectId: string, envSlug: string, path: string): boolean {
    return this.revealedScopes.has(scopeKey(projectId, envSlug, path));
  }

  isPathRevealed(projectId: string, envSlug: string, path: string): boolean {
    for (const ancestor of ancestorPaths(path)) {
      if (this.revealedScopes.has(scopeKey(projectId, envSlug, ancestor))) return true;
    }
    return false;
  }

  clearScopes(): void {
    if (this.revealedScopes.size === 0) return;
    this.revealedScopes.clear();
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!this.api.isAuthenticated()) {
      return [
        new MessageNode('Login to Infisical', 'sign-in', {
          command: 'infisical.login',
          title: 'Login'
        })
      ];
    }

    try {
      if (!element) {
        const projects = await this.api.getProjects();
        if (projects.length === 0) {
          return [new MessageNode('No projects found', 'info')];
        }
        return projects.map((p) => new ProjectNode(p));
      }

      if (element.kind === 'project') {
        const envs = await this.api.getEnvironments(element.project.id);
        if (envs.length === 0) {
          return [new MessageNode('No environments', 'info')];
        }
        return envs.map(
          (e) =>
            new EnvironmentNode(
              element.project,
              e,
              this.hasScope(element.project.id, e.slug, '/')
            )
        );
      }

      if (element.kind === 'environment') {
        return this.loadPathChildren(element.project, element.environment, '/');
      }

      if (element.kind === 'folder') {
        return this.loadPathChildren(element.project, element.environment, element.fullPath);
      }

      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load';
      return [new MessageNode(message, 'error')];
    }
  }

  private async loadPathChildren(
    project: InfisicalProject,
    environment: InfisicalEnvironment,
    path: string
  ): Promise<TreeNode[]> {
    const [folders, secrets] = await Promise.all([
      this.api.listFolders({
        workspaceId: project.id,
        environment: environment.slug,
        secretPath: path
      }),
      this.api.listSecrets({
        workspaceId: project.id,
        environment: environment.slug,
        secretPath: path
      })
    ]);

    const secretsRevealed = this.isPathRevealed(project.id, environment.slug, path);

    const folderNodes = folders
      .filter((f) => f.name && f.name !== '/')
      .map(
        (f) =>
          new FolderNode(
            project,
            environment,
            path,
            f,
            this.hasScope(project.id, environment.slug, joinSecretPath(path, f.name))
          )
      );

    const secretNodes = secrets.map(
      (s) => new SecretNode(project, environment, path, s, secretsRevealed)
    );

    if (folderNodes.length === 0 && secretNodes.length === 0) {
      return [new MessageNode('Empty', 'info')];
    }

    return [...folderNodes, ...secretNodes];
  }
}
