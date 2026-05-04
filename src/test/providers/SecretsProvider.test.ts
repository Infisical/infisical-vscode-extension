import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EnvironmentNode,
  FolderNode,
  InfisicalTreeProvider,
  MessageNode,
  ProjectNode,
  SecretNode
} from '../../providers/SecretsProvider';
import {
  InfisicalApi,
  InfisicalEnvironment,
  InfisicalFolder,
  InfisicalProject,
  InfisicalSecret
} from '../../api/InfisicalApi';

const project: InfisicalProject = { id: 'p1', name: 'Payments', slug: 'payments' };
const env: InfisicalEnvironment = { id: 'e1', name: 'Development', slug: 'dev' };

const folder: InfisicalFolder = { id: 'f1', name: 'auth' };
const secret: InfisicalSecret = {
  id: 's1',
  version: 1,
  workspace: 'p1',
  environment: 'dev',
  secretKey: 'DATABASE_URL',
  secretValue: 'postgres://localhost/app',
  secretComment: '',
  type: 'shared',
  secretPath: '/',
  createdAt: '',
  updatedAt: ''
};

function buildApi(overrides: Partial<InfisicalApi> = {}) {
  return {
    isAuthenticated: vi.fn().mockReturnValue(true),
    getProjects: vi.fn().mockResolvedValue([project]),
    getEnvironments: vi.fn().mockResolvedValue([env]),
    listFolders: vi.fn().mockResolvedValue([]),
    listSecrets: vi.fn().mockResolvedValue([]),
    ...overrides
  } as unknown as InfisicalApi;
}

describe('InfisicalTreeProvider', () => {
  let api: InfisicalApi;
  let provider: InfisicalTreeProvider;

  beforeEach(() => {
    api = buildApi();
    provider = new InfisicalTreeProvider(api);
  });

  it('shows a login prompt when unauthenticated', async () => {
    api = buildApi({ isAuthenticated: vi.fn().mockReturnValue(false) as any });
    provider = new InfisicalTreeProvider(api);

    const children = await provider.getChildren();

    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(MessageNode);
    expect(children[0].label).toBe('Login to Infisical');
  });

  it('lists projects at the root', async () => {
    const children = await provider.getChildren();

    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(ProjectNode);
    expect((children[0] as ProjectNode).project).toEqual(project);
  });

  it('lists environments under a project', async () => {
    const children = await provider.getChildren(new ProjectNode(project));

    expect(api.getEnvironments).toHaveBeenCalledWith('p1');
    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(EnvironmentNode);
  });

  it('lists folders and secrets at the environment root', async () => {
    api = buildApi({
      listFolders: vi.fn().mockResolvedValue([folder]) as any,
      listSecrets: vi.fn().mockResolvedValue([secret]) as any
    });
    provider = new InfisicalTreeProvider(api);

    const children = await provider.getChildren(new EnvironmentNode(project, env));

    expect(api.listFolders).toHaveBeenCalledWith({
      workspaceId: 'p1',
      environment: 'dev',
      secretPath: '/'
    });
    expect(api.listSecrets).toHaveBeenCalledWith({
      workspaceId: 'p1',
      environment: 'dev',
      secretPath: '/'
    });
    expect(children).toHaveLength(2);
    expect(children[0]).toBeInstanceOf(FolderNode);
    expect(children[1]).toBeInstanceOf(SecretNode);
  });

  it('expands nested folders using the joined path', async () => {
    const folderNode = new FolderNode(project, env, '/', folder);
    expect(folderNode.fullPath).toBe('/auth');

    api = buildApi({
      listFolders: vi.fn().mockResolvedValue([]) as any,
      listSecrets: vi.fn().mockResolvedValue([]) as any
    });
    provider = new InfisicalTreeProvider(api);

    await provider.getChildren(folderNode);

    expect(api.listFolders).toHaveBeenCalledWith({
      workspaceId: 'p1',
      environment: 'dev',
      secretPath: '/auth'
    });
  });

  it('joins parent paths correctly for deeply nested folders', () => {
    const inner = new FolderNode(project, env, '/auth', { id: 'f2', name: 'tokens' });
    expect(inner.fullPath).toBe('/auth/tokens');
  });

  it('shows an empty marker when a path has nothing', async () => {
    const children = await provider.getChildren(new EnvironmentNode(project, env));
    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(MessageNode);
    expect(children[0].label).toBe('Empty');
  });

  it('renders an error message when the API throws', async () => {
    api = buildApi({
      getProjects: vi.fn().mockRejectedValue(new Error('Network down')) as any
    });
    provider = new InfisicalTreeProvider(api);

    const children = await provider.getChildren();
    expect(children[0]).toBeInstanceOf(MessageNode);
    expect(children[0].label).toBe('Network down');
  });

  it('builds a SecretNode with a masked description', () => {
    const node = new SecretNode(project, env, '/', secret);
    expect(node.label).toBe('DATABASE_URL');
    expect(node.description).toContain('••••');
    expect(node.command?.command).toBe('infisical.viewSecret');
  });

  it('shows the plain value when SecretNode is constructed as revealed', () => {
    const node = new SecretNode(project, env, '/', secret, true);
    expect(node.description).toBe(secret.secretValue);
  });

  it('flips contextValue when an environment scope is revealed', () => {
    const node = new EnvironmentNode(project, env, true);
    expect(node.contextValue).toBe('infisical.environment.revealed');
  });

  it('flips contextValue when a folder scope is revealed', () => {
    const node = new FolderNode(project, env, '/', folder, true);
    expect(node.contextValue).toBe('infisical.folder.revealed');
  });

  it('reveals secrets at and below a folder scope', async () => {
    api = buildApi({
      listFolders: vi.fn().mockResolvedValue([]) as any,
      listSecrets: vi.fn().mockResolvedValue([secret]) as any
    });
    provider = new InfisicalTreeProvider(api);
    provider.revealScope(project.id, env.slug, '/auth');

    const children = await provider.getChildren(
      new FolderNode(project, env, '/', { id: 'f', name: 'auth' })
    );

    const secretNode = children.find((c) => c instanceof SecretNode) as SecretNode;
    expect(secretNode).toBeDefined();
    expect(secretNode.revealed).toBe(true);
  });

  it('does not reveal secrets at sibling paths', async () => {
    api = buildApi({
      listFolders: vi.fn().mockResolvedValue([]) as any,
      listSecrets: vi.fn().mockResolvedValue([secret]) as any
    });
    provider = new InfisicalTreeProvider(api);
    provider.revealScope(project.id, env.slug, '/auth');

    const children = await provider.getChildren(
      new FolderNode(project, env, '/', { id: 'f', name: 'authy' })
    );

    const secretNode = children.find((c) => c instanceof SecretNode) as SecretNode;
    expect(secretNode.revealed).toBe(false);
  });

  it('marks folder children as revealed when their own scope is on', async () => {
    api = buildApi({
      listFolders: vi.fn().mockResolvedValue([{ id: 'f', name: 'auth' }]) as any,
      listSecrets: vi.fn().mockResolvedValue([]) as any
    });
    provider = new InfisicalTreeProvider(api);
    provider.revealScope(project.id, env.slug, '/auth');

    const children = await provider.getChildren(new EnvironmentNode(project, env));

    const folderNode = children.find((c) => c instanceof FolderNode) as FolderNode;
    expect(folderNode.contextValue).toBe('infisical.folder.revealed');
  });
});
