import * as vscode from 'vscode';
import { InfisicalSecretsProvider } from './providers/SecretsProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ControlPanelProvider } from './providers/ControlPanelProvider';
import { InfisicalApi } from './api/InfisicalApi';
import { TokenStore } from './utils/TokenStore';
import { TelemetryService } from './utils/TelemetryService';
import { ErrorHandler } from './utils/ErrorHandler';
import { WorkspaceState } from './utils/WorkspaceState';

let secretsProvider: InfisicalSecretsProvider;
let authProvider: AuthProvider;
let controlPanelProvider: ControlPanelProvider;
let infisicalApi: InfisicalApi;
let telemetryService: TelemetryService;
let workspaceState: WorkspaceState;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log('Infisical AI extension is now active!');

  const tokenStore = new TokenStore(context.globalState, context.secrets);
  const config = vscode.workspace.getConfiguration('infisicalAi');
  const baseUrl = config.get<string>('baseUrl', 'https://us.infisical.com');
  
  workspaceState = new WorkspaceState(context.workspaceState);
  infisicalApi = new InfisicalApi(baseUrl, tokenStore);
  telemetryService = new TelemetryService(context, config.get<boolean>('telemetryEnabled', false));
  
  secretsProvider = new InfisicalSecretsProvider(infisicalApi, workspaceState);
  authProvider = new AuthProvider(infisicalApi, context);
  controlPanelProvider = new ControlPanelProvider(context.extensionUri, infisicalApi, workspaceState);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'infisicalAi.switchEnvironment';
  updateStatusBar();

  const secretsTreeView = vscode.window.createTreeView('infisicalSecrets', {
    treeDataProvider: secretsProvider,
    showCollapseAll: true
  });

  const authTreeView = vscode.window.createTreeView('infisicalAuth', {
    treeDataProvider: authProvider,
    showCollapseAll: false
  });

  vscode.commands.executeCommand('setContext', 'infisicalAi.authenticated', false);

  const commands = [
    vscode.commands.registerCommand('infisicalAi.openControlPanel', async () => {
      try {
        await controlPanelProvider.show();
        telemetryService.track('controlPanelOpened');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to open control panel');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.login', async () => {
      try {
        const regions = [
          { label: '🇺🇸 US Region (us.infisical.com)', value: 'US' },
          { label: '🇪🇺 EU Region (eu.infisical.com)', value: 'EU' }
        ];

        const selectedRegion = await vscode.window.showQuickPick(regions, {
          placeHolder: 'Select your Infisical region'
        });

        if (!selectedRegion) {
          return;
        }

        const clientId = await vscode.window.showInputBox({
          prompt: 'Enter Universal Auth Client ID',
          ignoreFocusOut: true,
          password: false,
          placeHolder: 'Your Universal Auth Client ID'
        });

        if (!clientId) {
          return;
        }

        const clientSecret = await vscode.window.showInputBox({
          prompt: 'Enter Universal Auth Client Secret',
          ignoreFocusOut: true,
          password: true,
          placeHolder: 'Your Universal Auth Client Secret'
        });

        if (!clientSecret) {
          return;
        }

        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Authenticating with Infisical Universal Auth...',
          cancellable: false
        }, async () => {
          const baseUrl = selectedRegion.value === 'EU' ? 'https://eu.infisical.com' : 'https://us.infisical.com';
          infisicalApi.setBaseUrl(baseUrl);
          
          await infisicalApi.login({ clientId, clientSecret });
          await vscode.commands.executeCommand('setContext', 'infisicalAi.authenticated', true);
          secretsProvider.refresh();
          authProvider.refresh();
        });

        vscode.window.showInformationMessage(`Successfully authenticated with Infisical ${selectedRegion.value} region!`);
        telemetryService.track('loginSuccess', { region: selectedRegion.value });
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to authenticate with Infisical');
        telemetryService.track('loginError', { error: String(error) });
      }
    }),

    vscode.commands.registerCommand('infisicalAi.logout', async () => {
      try {
        await infisicalApi.logout();
        await vscode.commands.executeCommand('setContext', 'infisicalAi.authenticated', false);
        secretsProvider.refresh();
        authProvider.refresh();
        vscode.window.showInformationMessage('Successfully logged out from Infisical');
        telemetryService.track('logout');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to log out');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.refreshSecrets', async () => {
      try {
        await secretsProvider.loadSecrets();
        telemetryService.track('secretsRefreshed');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to refresh secrets');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.createSecret', async () => {
      try {
        if (!workspaceState.canCreateSecrets()) {
          vscode.window.showWarningMessage('Insufficient privileges to create secrets. You have read-only access.');
          return;
        }

        const key = await vscode.window.showInputBox({
          prompt: 'Enter secret key',
          ignoreFocusOut: true
        });

        if (!key) {
          return;
        }

        const value = await vscode.window.showInputBox({
          prompt: 'Enter secret value',
          ignoreFocusOut: true,
          password: true
        });

        if (!value) {
          return;
        }

        await infisicalApi.createSecret(key, value);
        secretsProvider.refresh();
        vscode.window.showInformationMessage(`Secret "${key}" created successfully`);
        telemetryService.track('secretCreated');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to create secret');
        // Check if permission downgrade occurred
        if (error instanceof Error && error.message.includes('downgraded to read-only')) {
          await workspaceState.updatePermissions(
            infisicalApi.getWorkspacePermissions(workspaceState.getCurrentProjectId() || '') || 
            { canRead: true, canWrite: false, canDelete: false, canCreateSecrets: false, canUpdateSecrets: false, canDeleteSecrets: false, roles: ['viewer'], effectiveRole: 'viewer' }
          );
          updateStatusBar();
        }
      }
    }),

    vscode.commands.registerCommand('infisicalAi.updateSecret', async (secretItem) => {
      try {
        if (!workspaceState.canUpdateSecrets()) {
          vscode.window.showWarningMessage('Insufficient privileges to update secrets. You have read-only access.');
          return;
        }

        if (!secretItem?.key) {
          return;
        }

        const newValue = await vscode.window.showInputBox({
          prompt: `Enter new value for "${secretItem.key}"`,
          ignoreFocusOut: true,
          password: true
        });

        if (!newValue) {
          return;
        }

        await infisicalApi.updateSecret(secretItem.key, newValue);
        secretsProvider.refresh();
        vscode.window.showInformationMessage(`Secret "${secretItem.key}" updated successfully`);
        telemetryService.track('secretUpdated');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to update secret');
        // Check if permission downgrade occurred
        if (error instanceof Error && error.message.includes('downgraded to read-only')) {
          await workspaceState.updatePermissions(
            infisicalApi.getWorkspacePermissions(workspaceState.getCurrentProjectId() || '') || 
            { canRead: true, canWrite: false, canDelete: false, canCreateSecrets: false, canUpdateSecrets: false, canDeleteSecrets: false, roles: ['viewer'], effectiveRole: 'viewer' }
          );
          updateStatusBar();
        }
      }
    }),

    vscode.commands.registerCommand('infisicalAi.deleteSecret', async (secretItem) => {
      try {
        if (!workspaceState.canDeleteSecrets()) {
          vscode.window.showWarningMessage('Insufficient privileges to delete secrets. You have read-only access.');
          return;
        }

        if (!secretItem?.key) {
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete secret "${secretItem.key}"?`,
          { modal: true },
          'Delete'
        );

        if (confirm !== 'Delete') {
          return;
        }

        await infisicalApi.deleteSecret(secretItem.key);
        secretsProvider.refresh();
        vscode.window.showInformationMessage(`Secret "${secretItem.key}" deleted successfully`);
        telemetryService.track('secretDeleted');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to delete secret');
        // Check if permission downgrade occurred
        if (error instanceof Error && error.message.includes('downgraded to read-only')) {
          await workspaceState.updatePermissions(
            infisicalApi.getWorkspacePermissions(workspaceState.getCurrentProjectId() || '') || 
            { canRead: true, canWrite: false, canDelete: false, canCreateSecrets: false, canUpdateSecrets: false, canDeleteSecrets: false, roles: ['viewer'], effectiveRole: 'viewer' }
          );
          updateStatusBar();
        }
      }
    }),

    vscode.commands.registerCommand('infisicalAi.explainUsage', async (secretItem) => {
      try {
        if (!secretItem?.key) {
          return;
        }

        vscode.window.showInformationMessage(`AI explanation for "${secretItem.key}" would appear here`);
        telemetryService.track('explainUsage', { secretKey: secretItem.key });
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to explain usage');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.autoFixMissing', async () => {
      try {
        vscode.window.showInformationMessage('AI auto-fix for missing secrets would run here');
        telemetryService.track('autoFixMissing');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to auto-fix missing secrets');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.smartDiff', async () => {
      try {
        vscode.window.showInformationMessage('Smart diff comparison would appear here');
        telemetryService.track('smartDiff');
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to run smart diff');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.nlAction', async () => {
      try {
        const action = await vscode.window.showInputBox({
          prompt: 'Describe what you want to do with your secrets',
          ignoreFocusOut: true,
          placeHolder: 'e.g., "Create a secret for database URL"'
        });

        if (!action) {
          return;
        }

        vscode.window.showInformationMessage(`AI would process: "${action}"`);
        telemetryService.track('nlAction', { action });
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to process natural language action');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.switchEnvironment', async () => {
      try {
        if (!infisicalApi.isAuthenticated()) {
          vscode.window.showWarningMessage('Please authenticate with Infisical first');
          return;
        }

        const currentState = workspaceState.getProjectEnvironment();
        if (!currentState?.projectId) {
          vscode.window.showWarningMessage('No project selected. Please select a project first in the Control Panel');
          return;
        }

        const project = await infisicalApi.getProject(currentState.projectId);
        const environments = project.environments.map(env => ({
          label: env.name,
          description: env.slug,
          value: env.slug
        }));

        const selected = await vscode.window.showQuickPick(environments, {
          placeHolder: `Current: ${currentState.environmentName || currentState.environmentSlug}`,
          title: `Switch Environment for ${project.name}`
        });

        if (!selected) {
          return;
        }

        const env = project.environments.find(e => e.slug === selected.value);
        if (!env) {
          return;
        }

        await workspaceState.setProjectEnvironment({
          projectId: project.id,
          projectName: project.name,
          environmentSlug: env.slug,
          environmentName: env.name,
          lastSelected: Date.now()
        });

        updateStatusBar();
        await secretsProvider.loadSecrets();
        vscode.window.showInformationMessage(`Switched to ${env.name} environment`);
        telemetryService.track('environmentSwitched', { 
          projectId: project.id, 
          environment: env.slug 
        });
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to switch environment');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.updateStatusBar', () => {
      updateStatusBar();
    }),

    vscode.commands.registerCommand('infisicalAi.showSecretDetail', async (secret) => {
      try {
        if (!secret?.secretKey) {
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          'secretDetail',
          `Secret: ${secret.secretKey}`,
          vscode.ViewColumn.Two,
          {
            enableScripts: false,
            retainContextWhenHidden: false
          }
        );

        const maskedValue = secret.secretValue.length <= 4 
          ? '••••' 
          : secret.secretValue.substring(0, 2) + '••••' + secret.secretValue.substring(secret.secretValue.length - 2);

        const tags = secret.tags.map((tag: any) => `<span class="tag">${tag.name}</span>`).join('');

        panel.webview.html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Secret Details</title>
            <style>
              body { 
                font-family: var(--vscode-font-family); 
                color: var(--vscode-foreground);
                padding: 20px;
                line-height: 1.6;
              }
              .field { 
                margin-bottom: 16px; 
                padding: 12px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                border-radius: 4px;
              }
              .label { 
                font-weight: bold; 
                color: var(--vscode-textPreformat-foreground);
                margin-bottom: 4px;
              }
              .value { 
                font-family: var(--vscode-editor-font-family);
                background: var(--vscode-textCodeBlock-background);
                padding: 8px;
                border-radius: 3px;
                border: 1px solid var(--vscode-panel-border);
              }
              .tag {
                background: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 2px 6px;
                border-radius: 12px;
                font-size: 12px;
                margin-right: 6px;
              }
              .readonly-notice {
                background: var(--vscode-inputValidation-infoBackground);
                color: var(--vscode-inputValidation-infoForeground);
                border: 1px solid var(--vscode-inputValidation-infoBorder);
                padding: 12px;
                border-radius: 4px;
                margin-bottom: 20px;
              }
            </style>
          </head>
          <body>
            <div class="readonly-notice">
              🔒 Read-only view - Values are masked for security
            </div>
            
            <div class="field">
              <div class="label">Secret Key</div>
              <div class="value">${secret.secretKey}</div>
            </div>
            
            <div class="field">
              <div class="label">Secret Value</div>
              <div class="value">${maskedValue}</div>
            </div>
            
            <div class="field">
              <div class="label">Type</div>
              <div class="value">${secret.type}</div>
            </div>
            
            ${secret.secretComment ? `
            <div class="field">
              <div class="label">Comment</div>
              <div class="value">${secret.secretComment}</div>
            </div>
            ` : ''}
            
            ${secret.secretPath !== '/' ? `
            <div class="field">
              <div class="label">Path</div>
              <div class="value">${secret.secretPath}</div>
            </div>
            ` : ''}
            
            ${tags ? `
            <div class="field">
              <div class="label">Tags</div>
              <div class="value">${tags}</div>
            </div>
            ` : ''}
            
            <div class="field">
              <div class="label">Environment</div>
              <div class="value">${secret.environment}</div>
            </div>
            
            <div class="field">
              <div class="label">Version</div>
              <div class="value">${secret.version}</div>
            </div>
            
            <div class="field">
              <div class="label">Created</div>
              <div class="value">${new Date(secret.createdAt).toLocaleString()}</div>
            </div>
            
            <div class="field">
              <div class="label">Last Updated</div>
              <div class="value">${new Date(secret.updatedAt).toLocaleString()}</div>
            </div>
          </body>
          </html>
        `;

        telemetryService.track('secretDetailViewed', { secretKey: secret.secretKey });
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to show secret details');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.filterSecrets', async () => {
      try {
        const currentFilter = secretsProvider.getCurrentFilter();
        const filter = await vscode.window.showInputBox({
          prompt: 'Enter filter text to search secrets by key, comment, or tags',
          value: currentFilter,
          placeHolder: 'e.g., database, api, env'
        });

        if (filter !== undefined) {
          secretsProvider.setFilter(filter);
          telemetryService.track('secretsFiltered', { filterLength: filter.length });
        }
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to filter secrets');
      }
    }),

    vscode.commands.registerCommand('infisicalAi.setSecretPath', async () => {
      try {
        const currentPath = secretsProvider.getCurrentSecretPath();
        const path = await vscode.window.showInputBox({
          prompt: 'Enter secret path (use / for root)',
          value: currentPath,
          placeHolder: '/',
          validateInput: (value) => {
            if (!value) {
              return 'Path cannot be empty';
            }
            if (!value.startsWith('/')) {
              return 'Path must start with /';
            }
            return null;
          }
        });

        if (path !== undefined) {
          secretsProvider.setSecretPath(path);
          telemetryService.track('secretPathChanged', { path });
        }
      } catch (error) {
        ErrorHandler.handle(error, 'Failed to set secret path');
      }
    })
  ];

  context.subscriptions.push(
    ...commands,
    secretsTreeView,
    authTreeView,
    statusBarItem,
    telemetryService
  );

  const autoRefreshInterval = config.get<number>('autoRefreshInterval', 300000);
  if (autoRefreshInterval > 0) {
    const refreshTimer = setInterval(() => {
      if (infisicalApi.isAuthenticated() && workspaceState.hasProjectEnvironment()) {
        secretsProvider.loadSecrets();
      }
    }, autoRefreshInterval);

    context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
  }

  if (infisicalApi.isAuthenticated()) {
    vscode.commands.executeCommand('setContext', 'infisicalAi.authenticated', true);
  }
}

function updateStatusBar() {
  if (!statusBarItem) {
    return;
  }

  if (!infisicalApi.isAuthenticated()) {
    statusBarItem.text = '$(key) Infisical: Not authenticated';
    statusBarItem.tooltip = 'Click to authenticate with Infisical';
    statusBarItem.command = 'infisicalAi.login';
    statusBarItem.show();
    
    // Clear permission contexts
    vscode.commands.executeCommand('setContext', 'infisicalAi.canWrite', false);
    vscode.commands.executeCommand('setContext', 'infisicalAi.canDelete', false);
    return;
  }

  const currentState = workspaceState.getProjectEnvironment();
  if (!currentState) {
    statusBarItem.text = '$(key) Infisical: No project';
    statusBarItem.tooltip = 'Click to select a project and environment';
    statusBarItem.command = 'infisicalAi.openControlPanel';
    statusBarItem.show();
    
    // Clear permission contexts
    vscode.commands.executeCommand('setContext', 'infisicalAi.canWrite', false);
    vscode.commands.executeCommand('setContext', 'infisicalAi.canDelete', false);
    return;
  }

  const displayName = workspaceState.getDisplayName();
  const permissions = workspaceState.getPermissions();
  
  statusBarItem.text = `$(key) Infisical: ${displayName}`;
  
  // Enhanced tooltip with permission information
  let tooltip = `Current: ${displayName}\nRole: ${workspaceState.getEffectiveRole()}`;
  if (permissions) {
    if (workspaceState.isReadOnly()) {
      tooltip += '\n🔒 Read-only access';
    } else {
      tooltip += '\n✏️ Read/Write access';
    }
  }
  tooltip += '\nClick to switch environment';
  
  statusBarItem.tooltip = tooltip;
  statusBarItem.command = 'infisicalAi.switchEnvironment';
  statusBarItem.show();
  
  // Set permission contexts for conditional menu items
  vscode.commands.executeCommand('setContext', 'infisicalAi.canWrite', workspaceState.canUpdateSecrets());
  vscode.commands.executeCommand('setContext', 'infisicalAi.canDelete', workspaceState.canDeleteSecrets());
}

export function deactivate() {
  if (telemetryService) {
    telemetryService.dispose();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}