import { vi } from 'vitest';

const mockVscode = {
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      update: vi.fn(),
    })),
  },
  commands: {
    executeCommand: vi.fn()
  },
  Uri: {
    parse: vi.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
  },
};

vi.mock('vscode', () => mockVscode);

global.fetch = vi.fn();