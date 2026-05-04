import { vi } from 'vitest';

class TreeItem {
  label: string;
  collapsibleState: number;
  command?: any;
  description?: string;
  tooltip?: string | any;
  iconPath?: any;
  contextValue?: string;
  constructor(label: string, collapsibleState: number = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  static readonly Folder = new ThemeIcon('folder');
  static readonly File = new ThemeIcon('file');
  constructor(public id: string) {}
}

class MarkdownString {
  constructor(public value: string = '') {}
}

class EventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      }
    };
  };
  fire(value: T) {
    for (const l of this.listeners) l(value);
  }
}

const mockVscode = {
  TreeItem,
  ThemeIcon,
  MarkdownString,
  EventEmitter,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    createTreeView: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue?: any) => defaultValue),
      update: vi.fn()
    })),
    onDidChangeConfiguration: vi.fn()
  },
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn()
  },
  Uri: {
    parse: vi.fn((s: string) => ({ toString: () => s }))
  },
  env: {
    clipboard: { writeText: vi.fn() }
  }
};

vi.mock('vscode', () => mockVscode);
