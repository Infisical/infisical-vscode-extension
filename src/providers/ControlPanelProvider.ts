import * as vscode from 'vscode';
import { InfisicalApi, AccessError } from '../api/InfisicalApi';
import { WorkspaceState } from '../utils/WorkspaceState';

export class ControlPanelProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly infisicalApi: InfisicalApi,
    private readonly workspaceState: WorkspaceState
  ) {}

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'infisicalControlPanel',
      'Infisical AI Control Panel',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
        ]
      }
    );

    this.panel.webview.html = this.getWebviewContent();
    this.setupMessageHandling();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private getWebviewContent(): string {
    const webviewUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'webview.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${this.panel!.webview.cspSource} 'unsafe-inline'; style-src ${this.panel!.webview.cspSource} 'unsafe-inline';">
    <title>Infisical AI Control Panel</title>
</head>
<body>
    <div id="root"></div>
    <script>
        const vscode = acquireVsCodeApi();
        window.acquireVsCodeApi = () => vscode;
    </script>
    <script src="${webviewUri}"></script>
</body>
</html>`;
  }

  private setupMessageHandling(): void {
    this.panel!.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case 'ready':
            this.sendAuthState();
            break;

          case 'authenticate':
            await this.handleAuthenticate(message.data);
            break;

          case 'logout':
            await this.handleLogout();
            break;

          case 'loadProjects':
            await this.handleLoadProjects();
            break;

          case 'loadEnvironments':
            await this.handleLoadEnvironments(message.data.projectId);
            break;

          case 'loadProject':
            await this.handleLoadProject(message.data.workspaceId);
            break;

          case 'setProjectEnvironment':
            await this.handleSetProjectEnvironment(message.data.projectId, message.data.environment);
            break;

          case 'loadSecrets':
            await this.handleLoadSecrets(message.data.projectId, message.data.environment);
            break;

          case 'getPermissions':
            this.sendPermissions();
            break;
        }
      } catch (error) {
        this.sendError(error instanceof Error ? error.message : 'Unknown error occurred');
      }
    });
  }

  private sendAuthState(): void {
    this.panel?.webview.postMessage({
      type: 'authStateChanged',
      data: {
        isAuthenticated: this.infisicalApi.isAuthenticated(),
        clientId: '',
        clientSecret: ''
      }
    });
    
    // Also send current permissions if available
    this.sendPermissions();
  }

  private sendPermissions(): void {
    const permissions = this.workspaceState.getPermissions();
    const currentState = this.workspaceState.getProjectEnvironment();
    
    this.panel?.webview.postMessage({
      type: 'permissionsLoaded',
      data: {
        permissions,
        project: currentState ? {
          id: currentState.projectId,
          name: currentState.projectName,
          environment: currentState.environmentName,
          effectiveRole: this.workspaceState.getEffectiveRole(),
          roleDisplayName: this.workspaceState.getRoleDisplayName(),
          isReadOnly: this.workspaceState.isReadOnly()
        } : null
      }
    });
  }

  private async handleAuthenticate(data: { clientId: string; clientSecret: string; region: 'US' | 'EU' }): Promise<void> {
    try {
      const baseUrl = data.region === 'EU' ? 'https://eu.infisical.com' : 'https://us.infisical.com';
      this.infisicalApi.setBaseUrl(baseUrl);
      
      await this.infisicalApi.login({
        clientId: data.clientId,
        clientSecret: data.clientSecret
      });
      
      this.sendAuthState();
      await vscode.commands.executeCommand('setContext', 'infisicalAi.authenticated', true);
    } catch (error) {
      this.sendError(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleLogout(): Promise<void> {
    await this.infisicalApi.logout();
    this.sendAuthState();
    await vscode.commands.executeCommand('setContext', 'infisicalAi.authenticated', false);
  }

  private async handleLoadProjects(): Promise<void> {
    const mockProjects = [
      { id: 'proj1', name: 'My Web App', slug: 'my-web-app' },
      { id: 'proj2', name: 'Mobile API', slug: 'mobile-api' },
      { id: 'proj3', name: 'Analytics Service', slug: 'analytics-service' }
    ];

    this.panel?.webview.postMessage({
      type: 'projectsLoaded',
      data: mockProjects
    });
  }

  private async handleLoadEnvironments(projectId: string): Promise<void> {
    const mockEnvironments = [
      { id: 'env1', name: 'Development', slug: 'dev' },
      { id: 'env2', name: 'Staging', slug: 'staging' },
      { id: 'env3', name: 'Production', slug: 'prod' }
    ];

    this.panel?.webview.postMessage({
      type: 'environmentsLoaded',
      data: mockEnvironments
    });
  }

  private async handleLoadProject(workspaceId: string): Promise<void> {
    try {
      console.log(`Loading project with ID: ${workspaceId}`);
      const project = await this.infisicalApi.getProject(workspaceId);
      
      if (!project) {
        throw new Error('No project data received');
      }
      
      console.log('Project loaded successfully:', project);
      
      this.panel?.webview.postMessage({
        type: 'projectLoaded',
        data: project
      });
    } catch (error) {
      console.error('Error loading project:', error);
      
      if (this.isAccessError(error)) {
        this.panel?.webview.postMessage({
          type: 'projectError',
          data: {
            type: error.type,
            message: error.message,
            workspaceId: error.workspaceId || workspaceId
          }
        });
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Unexpected error loading project:', errorMessage);
        
        this.panel?.webview.postMessage({
          type: 'projectError',
          data: {
            type: 'unknown',
            message: `Failed to load project: ${errorMessage}`,
            workspaceId
          }
        });
      }
    }
  }

  private async handleSetProjectEnvironment(projectId: string, environment: string): Promise<void> {
    try {
      const project = await this.infisicalApi.getProject(projectId);
      const env = project.environments.find(e => e.slug === environment);
      
      if (!env) {
        throw new Error(`Environment '${environment}' not found in project`);
      }

      await this.workspaceState.setProjectEnvironment({
        projectId: project.id,
        projectName: project.name,
        environmentSlug: env.slug,
        environmentName: env.name,
        lastSelected: Date.now(),
        permissions: project.permissions
      });

      await vscode.commands.executeCommand('infisicalAi.updateStatusBar');
      
      // Send permission information to webview
      if (project.permissions) {
        this.panel?.webview.postMessage({
          type: 'permissionsUpdated',
          data: project.permissions
        });
      }
    } catch (error) {
      this.sendError(`Failed to set project environment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleLoadSecrets(projectId: string, environment: string): Promise<void> {
    const mockSecrets = [
      {
        id: 'secret1',
        key: 'DATABASE_URL',
        value: 'postgresql://...',
        environment,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'secret2',
        key: 'API_KEY',
        value: 'sk-...',
        environment,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'secret3',
        key: 'JWT_SECRET',
        value: 'super-secret-key',
        environment,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    this.panel?.webview.postMessage({
      type: 'secretsLoaded',
      data: mockSecrets
    });
  }

  private isAccessError(error: any): error is AccessError {
    return error && typeof error.type === 'string' && typeof error.message === 'string';
  }

  private sendError(message: string): void {
    this.panel?.webview.postMessage({
      type: 'error',
      data: message
    });
  }
}