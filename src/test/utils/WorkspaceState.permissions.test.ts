import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { WorkspaceState, ProjectEnvironmentState } from '../../utils/WorkspaceState';
import { WorkspacePermissions } from '../../api/InfisicalApi';

// Mock vscode
vi.mock('vscode', () => ({
  default: {
    Memento: vi.fn()
  }
}));

describe('WorkspaceState - Permissions', () => {
  let workspaceState: WorkspaceState;
  let mockMemento: any;

  const mockPermissions: WorkspacePermissions = {
    canRead: true,
    canWrite: true,
    canDelete: false,
    canCreateSecrets: true,
    canUpdateSecrets: true,
    canDeleteSecrets: false,
    roles: ['Developer', 'QA'],
    effectiveRole: 'member'
  };

  const mockProjectState: ProjectEnvironmentState = {
    projectId: 'proj123',
    projectName: 'Test Project',
    environmentSlug: 'dev',
    environmentName: 'Development',
    lastSelected: Date.now(),
    permissions: mockPermissions
  };

  beforeEach(() => {
    mockMemento = {
      get: vi.fn(),
      update: vi.fn()
    };

    workspaceState = new WorkspaceState(mockMemento);
  });

  describe('getDisplayName with permissions', () => {
    it('should show permission indicator for read-only access', () => {
      const readOnlyPermissions: WorkspacePermissions = {
        ...mockPermissions,
        canWrite: false,
        canCreateSecrets: false,
        canUpdateSecrets: false
      };

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: readOnlyPermissions
      });

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Test Project/Development 👁️');
    });

    it('should show admin indicator for admin role', () => {
      const adminPermissions: WorkspacePermissions = {
        ...mockPermissions,
        canDelete: true,
        canDeleteSecrets: true,
        effectiveRole: 'admin'
      };

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: adminPermissions
      });

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Test Project/Development 👑');
    });

    it('should show owner indicator for owner role', () => {
      const ownerPermissions: WorkspacePermissions = {
        ...mockPermissions,
        canDelete: true,
        canDeleteSecrets: true,
        effectiveRole: 'owner'
      };

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: ownerPermissions
      });

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Test Project/Development 👑');
    });

    it('should show no-access indicator for no permissions', () => {
      const noAccessPermissions: WorkspacePermissions = {
        canRead: false,
        canWrite: false,
        canDelete: false,
        canCreateSecrets: false,
        canUpdateSecrets: false,
        canDeleteSecrets: false,
        roles: [],
        effectiveRole: 'no-access'
      };

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: noAccessPermissions
      });

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Test Project/Development 🚫');
    });

    it('should show no indicator for normal member access', () => {
      mockMemento.get.mockReturnValue(mockProjectState);

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Test Project/Development');
    });

    it('should work without permissions', () => {
      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: undefined
      });

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Test Project/Development');
    });
  });

  describe('permission getters', () => {
    beforeEach(() => {
      mockMemento.get.mockReturnValue(mockProjectState);
    });

    it('should return correct permissions', () => {
      const permissions = workspaceState.getPermissions();
      expect(permissions).toEqual(mockPermissions);
    });

    it('should check read-only status correctly', () => {
      expect(workspaceState.isReadOnly()).toBe(false);

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: { ...mockPermissions, canWrite: false }
      });

      expect(workspaceState.isReadOnly()).toBe(true);
    });

    it('should check create secrets permission', () => {
      expect(workspaceState.canCreateSecrets()).toBe(true);

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: { ...mockPermissions, canCreateSecrets: false }
      });

      expect(workspaceState.canCreateSecrets()).toBe(false);
    });

    it('should check update secrets permission', () => {
      expect(workspaceState.canUpdateSecrets()).toBe(true);

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: { ...mockPermissions, canUpdateSecrets: false }
      });

      expect(workspaceState.canUpdateSecrets()).toBe(false);
    });

    it('should check delete secrets permission', () => {
      expect(workspaceState.canDeleteSecrets()).toBe(false);

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: { ...mockPermissions, canDeleteSecrets: true }
      });

      expect(workspaceState.canDeleteSecrets()).toBe(true);
    });

    it('should return effective role', () => {
      expect(workspaceState.getEffectiveRole()).toBe('Member');
    });

    it('should return role display name', () => {
      expect(workspaceState.getRoleDisplayName()).toBe('Developer, QA');
    });

    it('should handle missing permissions gracefully', () => {
      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: undefined
      });

      expect(workspaceState.isReadOnly()).toBe(true); // Default to read-only
      expect(workspaceState.canCreateSecrets()).toBe(false);
      expect(workspaceState.canUpdateSecrets()).toBe(false);
      expect(workspaceState.canDeleteSecrets()).toBe(false);
      expect(workspaceState.getEffectiveRole()).toBe('Unknown');
      expect(workspaceState.getRoleDisplayName()).toBe('Unknown Role');
    });

    it('should handle missing project state gracefully', () => {
      mockMemento.get.mockReturnValue(undefined);

      expect(workspaceState.getPermissions()).toBeUndefined();
      expect(workspaceState.isReadOnly()).toBe(true);
      expect(workspaceState.canCreateSecrets()).toBe(false);
      expect(workspaceState.canUpdateSecrets()).toBe(false);
      expect(workspaceState.canDeleteSecrets()).toBe(false);
      expect(workspaceState.getEffectiveRole()).toBe('Unknown');
      expect(workspaceState.getRoleDisplayName()).toBe('Unknown Role');
    });
  });

  describe('updatePermissions', () => {
    beforeEach(() => {
      mockMemento.get.mockReturnValue(mockProjectState);
    });

    it('should update permissions in existing state', async () => {
      const newPermissions: WorkspacePermissions = {
        ...mockPermissions,
        canWrite: false,
        effectiveRole: 'viewer'
      };

      await workspaceState.updatePermissions(newPermissions);

      expect(mockMemento.update).toHaveBeenCalledWith(
        'infisicalAi.projectEnvironment',
        {
          ...mockProjectState,
          permissions: newPermissions
        }
      );
    });

    it('should handle updating permissions when no state exists', async () => {
      mockMemento.get.mockReturnValue(undefined);

      const newPermissions: WorkspacePermissions = {
        ...mockPermissions,
        effectiveRole: 'viewer'
      };

      await workspaceState.updatePermissions(newPermissions);

      // Should not call update when no existing state
      expect(mockMemento.update).not.toHaveBeenCalled();
    });
  });

  describe('role display formatting', () => {
    it('should handle single role', () => {
      const singleRolePermissions: WorkspacePermissions = {
        ...mockPermissions,
        roles: ['Admin'],
        effectiveRole: 'admin'
      };

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: singleRolePermissions
      });

      expect(workspaceState.getRoleDisplayName()).toBe('Admin');
    });

    it('should handle empty roles array', () => {
      const noRolesPermissions: WorkspacePermissions = {
        ...mockPermissions,
        roles: [],
        effectiveRole: 'member'
      };

      mockMemento.get.mockReturnValue({
        ...mockProjectState,
        permissions: noRolesPermissions
      });

      expect(workspaceState.getRoleDisplayName()).toBe('member');
    });

    it('should capitalize effective role properly', () => {
      const testCases = [
        { effectiveRole: 'viewer', expected: 'Viewer' },
        { effectiveRole: 'member', expected: 'Member' },
        { effectiveRole: 'admin', expected: 'Admin' },
        { effectiveRole: 'owner', expected: 'Owner' },
        { effectiveRole: 'no-access', expected: 'No-access' }
      ];

      testCases.forEach(({ effectiveRole, expected }) => {
        const permissions: WorkspacePermissions = {
          ...mockPermissions,
          effectiveRole: effectiveRole as any
        };

        mockMemento.get.mockReturnValue({
          ...mockProjectState,
          permissions
        });

        expect(workspaceState.getEffectiveRole()).toBe(expected);
      });
    });
  });
});