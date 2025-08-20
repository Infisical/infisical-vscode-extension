import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceState, ProjectEnvironmentState } from '../../utils/WorkspaceState';

describe('WorkspaceState', () => {
  let workspaceState: WorkspaceState;
  let mockWorkspaceState: any;

  beforeEach(() => {
    mockWorkspaceState = {
      get: vi.fn(),
      update: vi.fn()
    };

    workspaceState = new WorkspaceState(mockWorkspaceState);
  });

  describe('setProjectEnvironment', () => {
    it('should store project environment state with timestamp', async () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: 'dev',
        environmentName: 'Development',
        lastSelected: Date.now()
      };

      await workspaceState.setProjectEnvironment(state);

      expect(mockWorkspaceState.update).toHaveBeenCalledWith(
        'infisicalAi.projectEnvironment',
        expect.objectContaining({
          projectId: 'cm123456789',
          projectName: 'Test Project',
          environmentSlug: 'dev',
          environmentName: 'Development',
          lastSelected: expect.any(Number)
        })
      );
    });

    it('should update timestamp when setting project environment', async () => {
      const now = Date.now();
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: 'dev',
        environmentName: 'Development',
        lastSelected: now - 1000
      };

      await workspaceState.setProjectEnvironment(state);

      const calledWith = mockWorkspaceState.update.mock.calls[0][1];
      expect(calledWith.lastSelected).toBeGreaterThanOrEqual(now);
    });
  });

  describe('getProjectEnvironment', () => {
    it('should retrieve stored project environment state', () => {
      const expectedState: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: 'prod',
        environmentName: 'Production',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(expectedState);

      const result = workspaceState.getProjectEnvironment();

      expect(mockWorkspaceState.get).toHaveBeenCalledWith('infisicalAi.projectEnvironment');
      expect(result).toEqual(expectedState);
    });

    it('should return undefined when no state is stored', () => {
      mockWorkspaceState.get.mockReturnValueOnce(undefined);

      const result = workspaceState.getProjectEnvironment();

      expect(result).toBeUndefined();
    });
  });

  describe('clearProjectEnvironment', () => {
    it('should clear stored project environment state', async () => {
      await workspaceState.clearProjectEnvironment();

      expect(mockWorkspaceState.update).toHaveBeenCalledWith(
        'infisicalAi.projectEnvironment',
        undefined
      );
    });
  });

  describe('hasProjectEnvironment', () => {
    it('should return true when valid project environment exists', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: 'dev',
        environmentName: 'Development',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.hasProjectEnvironment()).toBe(true);
    });

    it('should return false when no project environment exists', () => {
      mockWorkspaceState.get.mockReturnValueOnce(undefined);

      expect(workspaceState.hasProjectEnvironment()).toBe(false);
    });

    it('should return false when project ID is missing', () => {
      const state = {
        projectId: '',
        projectName: 'Test Project',
        environmentSlug: 'dev',
        environmentName: 'Development',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.hasProjectEnvironment()).toBe(false);
    });

    it('should return false when environment slug is missing', () => {
      const state = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: '',
        environmentName: 'Development',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.hasProjectEnvironment()).toBe(false);
    });
  });

  describe('getCurrentProjectId', () => {
    it('should return current project ID', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: 'dev',
        environmentName: 'Development',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.getCurrentProjectId()).toBe('cm123456789');
    });

    it('should return undefined when no state exists', () => {
      mockWorkspaceState.get.mockReturnValueOnce(undefined);

      expect(workspaceState.getCurrentProjectId()).toBeUndefined();
    });
  });

  describe('getCurrentEnvironmentSlug', () => {
    it('should return current environment slug', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Test Project',
        environmentSlug: 'staging',
        environmentName: 'Staging',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.getCurrentEnvironmentSlug()).toBe('staging');
    });

    it('should return undefined when no state exists', () => {
      mockWorkspaceState.get.mockReturnValueOnce(undefined);

      expect(workspaceState.getCurrentEnvironmentSlug()).toBeUndefined();
    });
  });

  describe('getDisplayName', () => {
    it('should return formatted display name with project name and environment name', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'My Awesome Project',
        environmentSlug: 'prod',
        environmentName: 'Production',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.getDisplayName()).toBe('My Awesome Project/Production');
    });

    it('should fallback to project ID and environment slug when names are missing', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: '',
        environmentSlug: 'dev',
        environmentName: '',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.getDisplayName()).toBe('cm123456789/dev');
    });

    it('should return default message when no state exists', () => {
      mockWorkspaceState.get.mockReturnValueOnce(undefined);

      expect(workspaceState.getDisplayName()).toBe('No project selected');
    });

    it('should handle missing project name gracefully', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: '',
        environmentSlug: 'test',
        environmentName: 'Testing Environment',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.getDisplayName()).toBe('cm123456789/Testing Environment');
    });

    it('should handle missing environment name gracefully', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Cool Project',
        environmentSlug: 'staging',
        environmentName: '',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      expect(workspaceState.getDisplayName()).toBe('Cool Project/staging');
    });
  });

  describe('state management edge cases', () => {
    it('should handle concurrent state updates', async () => {
      const state1: ProjectEnvironmentState = {
        projectId: 'project1',
        projectName: 'Project 1',
        environmentSlug: 'dev',
        environmentName: 'Development',
        lastSelected: Date.now()
      };

      const state2: ProjectEnvironmentState = {
        projectId: 'project2',
        projectName: 'Project 2',
        environmentSlug: 'prod',
        environmentName: 'Production',
        lastSelected: Date.now()
      };

      const promises = [
        workspaceState.setProjectEnvironment(state1),
        workspaceState.setProjectEnvironment(state2)
      ];

      await Promise.all(promises);

      expect(mockWorkspaceState.update).toHaveBeenCalledTimes(2);
    });

    it('should handle state with very long names', () => {
      const longName = 'A'.repeat(1000);
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: longName,
        environmentSlug: 'dev',
        environmentName: longName,
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe(`${longName}/${longName}`);
    });

    it('should handle state with special characters', () => {
      const state: ProjectEnvironmentState = {
        projectId: 'cm123456789',
        projectName: 'Project with "special" characters & symbols',
        environmentSlug: 'dev-test',
        environmentName: 'Development/Testing Environment',
        lastSelected: Date.now()
      };

      mockWorkspaceState.get.mockReturnValueOnce(state);

      const displayName = workspaceState.getDisplayName();
      expect(displayName).toBe('Project with "special" characters & symbols/Development/Testing Environment');
    });
  });
});