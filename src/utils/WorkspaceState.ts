import * as vscode from 'vscode';
import { WorkspacePermissions } from '../api/InfisicalApi';

export interface ProjectEnvironmentState {
  projectId: string;
  projectName: string;
  environmentSlug: string;
  environmentName: string;
  lastSelected: number;
  permissions?: WorkspacePermissions;
}

export class WorkspaceState {
  private static readonly PROJECT_ENV_KEY = 'infisicalAi.projectEnvironment';
  
  constructor(private workspaceState: vscode.Memento) {}

  async setProjectEnvironment(state: ProjectEnvironmentState): Promise<void> {
    const stateWithTimestamp = {
      ...state,
      lastSelected: Date.now()
    };
    await this.workspaceState.update(WorkspaceState.PROJECT_ENV_KEY, stateWithTimestamp);
  }

  getProjectEnvironment(): ProjectEnvironmentState | undefined {
    return this.workspaceState.get<ProjectEnvironmentState>(WorkspaceState.PROJECT_ENV_KEY);
  }

  async clearProjectEnvironment(): Promise<void> {
    await this.workspaceState.update(WorkspaceState.PROJECT_ENV_KEY, undefined);
  }

  hasProjectEnvironment(): boolean {
    const state = this.getProjectEnvironment();
    return state !== undefined && state.projectId && state.environmentSlug;
  }

  getCurrentProjectId(): string | undefined {
    return this.getProjectEnvironment()?.projectId;
  }

  getCurrentEnvironmentSlug(): string | undefined {
    return this.getProjectEnvironment()?.environmentSlug;
  }

  getDisplayName(): string {
    const state = this.getProjectEnvironment();
    if (!state) {
      return 'No project selected';
    }
    
    const projectDisplay = state.projectName || state.projectId;
    const envDisplay = state.environmentName || state.environmentSlug;
    
    // Add permission indicator to display name
    if (state.permissions) {
      const permissionIndicator = this.getPermissionIndicator(state.permissions);
      return `${projectDisplay}/${envDisplay}${permissionIndicator}`;
    }
    
    return `${projectDisplay}/${envDisplay}`;
  }

  private getPermissionIndicator(permissions: WorkspacePermissions): string {
    if (!permissions.canRead) {
      return ' 🚫';
    } else if (!permissions.canWrite) {
      return ' 👁️'; // Read-only indicator
    } else if (permissions.effectiveRole === 'admin' || permissions.effectiveRole === 'owner') {
      return ' 👑'; // Admin/Owner indicator
    }
    return ''; // Default (member/write access)
  }

  getPermissions(): WorkspacePermissions | undefined {
    return this.getProjectEnvironment()?.permissions;
  }

  async updatePermissions(permissions: WorkspacePermissions): Promise<void> {
    const currentState = this.getProjectEnvironment();
    if (currentState) {
      await this.setProjectEnvironment({
        ...currentState,
        permissions
      });
    }
  }

  isReadOnly(): boolean {
    const permissions = this.getPermissions();
    return permissions ? !permissions.canWrite : true; // Default to read-only if unknown
  }

  canCreateSecrets(): boolean {
    const permissions = this.getPermissions();
    return permissions ? permissions.canCreateSecrets : false;
  }

  canUpdateSecrets(): boolean {
    const permissions = this.getPermissions();
    return permissions ? permissions.canUpdateSecrets : false;
  }

  canDeleteSecrets(): boolean {
    const permissions = this.getPermissions();
    return permissions ? permissions.canDeleteSecrets : false;
  }

  getEffectiveRole(): string {
    const permissions = this.getPermissions();
    if (!permissions) {
      return 'Unknown';
    }
    
    // Capitalize first letter
    return permissions.effectiveRole.charAt(0).toUpperCase() + permissions.effectiveRole.slice(1);
  }

  getRoleDisplayName(): string {
    const permissions = this.getPermissions();
    if (!permissions) {
      return 'Unknown Role';
    }
    
    const roleNames = permissions.roles.length > 0 ? permissions.roles.join(', ') : permissions.effectiveRole;
    return roleNames;
  }
}