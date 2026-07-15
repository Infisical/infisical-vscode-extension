import * as http from "http";
import * as net from "net";
import * as vscode from "vscode";
import {
  InfisicalApi,
  InfisicalEnvironment,
  InfisicalProject,
} from "./api/InfisicalApi";
import { TokenStore } from "./utils/TokenStore";
import {
  EnvironmentNode,
  FolderNode,
  InfisicalTreeProvider,
  ProjectNode,
  SecretNode,
} from "./providers/SecretsProvider";
import { PanelContext, SecretsPanel } from "./panels/SecretsPanel";
import { extractErrorMessage } from "./utils/errors";

let api: InfisicalApi;
let tree: InfisicalTreeProvider;
const log = vscode.window.createOutputChannel("Infisical");
log.show(true);

export async function activate(context: vscode.ExtensionContext) {
  const tokenStore = new TokenStore(context.globalState, context.secrets);
  const config = vscode.workspace.getConfiguration("infisical");
  const baseUrl = config.get<string>("baseUrl", "https://us.infisical.com");

  api = new InfisicalApi(baseUrl, tokenStore, () => {
    vscode.commands.executeCommand('setContext', 'infisical.authenticated', false);
    tree.clearScopes();
    tree.refresh();
    vscode.window.showWarningMessage('Infisical session expired. Please log in again.');
  });
  tree = new InfisicalTreeProvider(api);

  if (api.isAuthenticated()) {
    try {
      await api.checkAuth();
    } catch {
      await api.logout();
    }
  }

  await vscode.commands.executeCommand(
    "setContext",
    "infisical.authenticated",
    api.isAuthenticated(),
  );

  const view = vscode.window.createTreeView("infisicalSecrets", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    view,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("infisical.baseUrl")) {
        const newBase = vscode.workspace
          .getConfiguration("infisical")
          .get<string>("baseUrl", "https://us.infisical.com");
        api.setBaseUrl(newBase);
        tree.refresh();
      }
    }),
    vscode.commands.registerCommand("infisical.login", () => login()),
    vscode.commands.registerCommand("infisical.logout", () => logout()),
    vscode.commands.registerCommand("infisical.refresh", () => {
      tree.refresh();
      SecretsPanel.current()?.refresh();
    }),
    vscode.commands.registerCommand(
      "infisical.openSecretsPanel",
      (context: PanelContext) => {
        if (!context) return;
        SecretsPanel.show(api, context, () => tree.refresh());
      },
    ),
    vscode.commands.registerCommand(
      "infisical.revealValues",
      (node: EnvironmentNode | FolderNode) => toggleScopeReveal(node, true),
    ),
    vscode.commands.registerCommand(
      "infisical.hideValues",
      (node: EnvironmentNode | FolderNode) => toggleScopeReveal(node, false),
    ),
    vscode.commands.registerCommand("infisical.createSecret", (node) =>
      createSecret(node),
    ),
    vscode.commands.registerCommand(
      "infisical.updateSecret",
      (node: SecretNode) => updateSecret(node),
    ),
    vscode.commands.registerCommand(
      "infisical.deleteSecret",
      (node: SecretNode) => deleteSecret(node),
    ),
    vscode.commands.registerCommand(
      "infisical.viewSecret",
      (node: SecretNode) => viewSecret(node),
    ),
    vscode.commands.registerCommand(
      "infisical.copySecretValue",
      (node: SecretNode) => copySecretValue(node),
    ),
  );
}

export function deactivate() {}

const US_URL = "https://us.infisical.com";
const EU_URL = "https://eu.infisical.com";

async function login() {
  // Only surface the user/global-scoped setting as a one-click option. The
  // merged value can include workspace settings (.vscode/settings.json), which
  // a malicious repo could point at an internal host — we don't want to
  // pre-select that. The login flow itself always writes to Global scope.
  const inspected = vscode.workspace
    .getConfiguration("infisical")
    .inspect<string>("baseUrl");
  const currentBaseUrl = inspected?.globalValue;

  const isCurrentCustom =
    !!currentBaseUrl && currentBaseUrl !== US_URL && currentBaseUrl !== EU_URL;

  const regions: { label: string; value: string; description?: string }[] = [];

  if (isCurrentCustom) {
    regions.push({
      // Show the full URL (not just the host) so the user can scrutinise it
      // before selecting.
      label: `Self-hosted (${currentBaseUrl})`,
      value: currentBaseUrl,
      description: "Currently configured",
    });
  }

  regions.push(
    { label: "US Region (us.infisical.com)", value: US_URL },
    { label: "EU Region (eu.infisical.com)", value: EU_URL },
    {
      label: isCurrentCustom
        ? "Self-hosted (different URL)"
        : "Self-hosted (custom URL)",
      value: "CUSTOM",
    },
  );

  const selected = await vscode.window.showQuickPick(regions, {
    placeHolder: "Select your Infisical region",
  });
  if (!selected) return;

  let baseUrl = selected.value;
  if (baseUrl === "CUSTOM") {
    const custom = await vscode.window.showInputBox({
      prompt: "Enter your self-hosted Infisical URL",
      placeHolder: "https://your-infisical-instance.com",
      value: isCurrentCustom ? currentBaseUrl : undefined,
      ignoreFocusOut: true,
      validateInput: (v) => {
        if (!v) return "URL is required";
        try {
          new URL(v.startsWith("http") ? v : `https://${v}`);
          return null;
        } catch {
          return "Invalid URL";
        }
      },
    });
    if (!custom) return;
    baseUrl = custom.endsWith("/") ? custom.slice(0, -1) : custom;
    if (!baseUrl.startsWith("http")) baseUrl = `https://${baseUrl}`;
  }

  try {
    api.setBaseUrl(baseUrl);
    await vscode.workspace
      .getConfiguration("infisical")
      .update("baseUrl", baseUrl, vscode.ConfigurationTarget.Global);

    const token = await openBrowserLogin(baseUrl);
    await api.setUserToken(token);
    await vscode.commands.executeCommand(
      "setContext",
      "infisical.authenticated",
      true,
    );
    tree.refresh();
    vscode.window.showInformationMessage("Logged in to Infisical");
  } catch (error) {
    showError(error, "Login failed");
  }
}

function openBrowserLogin(baseUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer();

    const finish = (tokenOrErr: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (typeof tokenOrErr === "string") resolve(tokenOrErr);
      else reject(tokenOrErr);
    };

    server.on("error", (err) => finish(err));

    let timer: NodeJS.Timeout;

    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address() as net.AddressInfo;

      timer = setTimeout(() => {
        finish(new Error("Login timed out. Please try again."));
      }, 120_000);

      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      };

      server.on("request", (req, res) => {
        log.appendLine(`[login] ${req.method} ${req.url}`);

        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString();

          let token: string | undefined;
          try {
            const body = JSON.parse(rawBody);
            log.appendLine(
              `[login] parsed keys: ${Object.keys(body).join(", ")}`,
            );
            token = body.JTWToken;
          } catch (e) {
            log.appendLine(`[login] JSON parse error: ${e}`);
          }

          res.writeHead(200, {
            ...corsHeaders,
            "Content-Type": "text/html; charset=utf-8",
          });
          res.end(
            token
              ? '<html><body style="font-family:system-ui;padding:40px;text-align:center"><h2>Login successful</h2><p>You can close this tab and return to VS Code.</p></body></html>'
              : '<html><body style="font-family:system-ui;padding:40px;text-align:center"><h2>Login failed</h2><p>No token received.</p></body></html>',
          );

          if (token) {
            finish(token);
            log.appendLine("Successfully logged into Infisical");
          } else {
            finish(new Error("No token received from Infisical"));
          }
        });
      });

      await vscode.env.openExternal(
        vscode.Uri.parse(`${baseUrl}/login?callback_port=${port}`),
      );

      void offerManualTokenPaste(finish, () => settled);
    });
  });
}

async function offerManualTokenPaste(
  finish: (tokenOrErr: string | Error) => void,
  isSettled: () => boolean,
) {
  // Loop so the flow can be re-triggered after an accidental dismissal or an
  // invalid paste, until the login settles some other way (HTTP callback or
  // timeout) or the user opts out.
  while (!isSettled()) {
    const action = await vscode.window.showInformationMessage(
      'Completing login in browser. If you see "Unable to reach CLI", copy the token and paste it here.',
      "Paste Token",
    );
    if (isSettled()) return;
    if (action !== "Paste Token") return;

    const raw = await vscode.window.showInputBox({
      prompt: 'Paste the token from the "Unable to reach CLI" page',
      password: true,
      ignoreFocusOut: true,
    });
    if (isSettled()) return;
    if (!raw) continue;

    const token = decodeCliToken(raw);
    if (token) {
      finish(token);
      return;
    }

    const retry = await vscode.window.showErrorMessage(
      "Could not extract a valid token. Please copy the full value from the browser.",
      "Try Again",
    );
    if (retry !== "Try Again") return;
  }
}

function decodeCliToken(raw: string): string | undefined {
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString());
    if (typeof decoded.JTWToken === "string" && decoded.JTWToken) {
      return decoded.JTWToken;
    }
  } catch {
    // not base64-encoded JSON
  }

  // Fall back to a bare JWT: three non-empty dot-separated segments.
  const trimmed = raw.trim();
  const parts = trimmed.split(".");
  if (parts.length === 3 && parts.every((p) => p.length > 0)) {
    return trimmed;
  }

  return undefined;
}

async function logout() {
  await api.logout();
  await vscode.commands.executeCommand(
    "setContext",
    "infisical.authenticated",
    false,
  );
  tree.clearScopes();
  tree.refresh();
  vscode.window.showInformationMessage("Logged out of Infisical");
}

async function createSecret(
  node: EnvironmentNode | FolderNode | ProjectNode | undefined,
) {
  const target = await resolveCreateTarget(node);
  if (!target) return;

  const secretKey = await vscode.window.showInputBox({
    prompt: "Secret name",
    placeHolder: "API_KEY",
    ignoreFocusOut: true,
    validateInput: (v) => (v && v.trim() ? null : "Name is required"),
  });
  if (!secretKey) return;

  const secretValue = await vscode.window.showInputBox({
    prompt: `Value for ${secretKey}`,
    password: true,
    ignoreFocusOut: true,
  });
  if (secretValue === undefined) return;

  try {
    await api.createSecret({
      workspaceId: target.project.id,
      environment: target.environment.slug,
      secretKey: secretKey.trim(),
      secretValue,
      secretPath: target.path,
    });
    tree.refresh();
    SecretsPanel.current()?.refresh();
    vscode.window.showInformationMessage(`Created ${secretKey}`);
  } catch (error) {
    showError(error, "Failed to create secret");
  }
}

async function updateSecret(node: SecretNode) {
  if (!node) return;
  const value = await vscode.window.showInputBox({
    prompt: `New value for ${node.secret.secretKey}`,
    value: node.secret.secretValue,
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;

  try {
    await api.updateSecret({
      workspaceId: node.project.id,
      environment: node.environment.slug,
      secretKey: node.secret.secretKey,
      secretValue: value,
      secretPath: node.secretPath,
    });
    tree.refresh();
    SecretsPanel.current()?.refresh();
    vscode.window.showInformationMessage(`Updated ${node.secret.secretKey}`);
  } catch (error) {
    showError(error, "Failed to update secret");
  }
}

async function deleteSecret(node: SecretNode) {
  if (!node) return;
  const confirm = await vscode.window.showWarningMessage(
    `Delete secret "${node.secret.secretKey}"?`,
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") return;

  try {
    await api.deleteSecret({
      workspaceId: node.project.id,
      environment: node.environment.slug,
      secretKey: node.secret.secretKey,
      secretPath: node.secretPath,
    });
    tree.refresh();
    SecretsPanel.current()?.refresh();
    vscode.window.showInformationMessage(`Deleted ${node.secret.secretKey}`);
  } catch (error) {
    showError(error, "Failed to delete secret");
  }
}

async function viewSecret(node: SecretNode) {
  if (!node) return;
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(eye) Reveal value", value: "reveal" },
      { label: "$(copy) Copy value", value: "copy" },
      { label: "$(edit) Edit value", value: "edit" },
      { label: "$(trash) Delete secret", value: "delete" },
    ],
    { placeHolder: node.secret.secretKey },
  );
  if (!action) return;

  switch (action.value) {
    case "reveal":
      await vscode.window.showInformationMessage(
        `${node.secret.secretKey} = ${node.secret.secretValue}`,
        { modal: true },
      );
      break;
    case "copy":
      await copySecretValue(node);
      break;
    case "edit":
      await updateSecret(node);
      break;
    case "delete":
      await deleteSecret(node);
      break;
  }
}

function toggleScopeReveal(
  node: EnvironmentNode | FolderNode,
  reveal: boolean,
) {
  if (!node) return;
  const path = node instanceof FolderNode ? node.fullPath : "/";
  if (reveal) {
    tree.revealScope(node.project.id, node.environment.slug, path);
  } else {
    tree.hideScope(node.project.id, node.environment.slug, path);
  }
}

async function copySecretValue(node: SecretNode) {
  if (!node) return;
  await vscode.env.clipboard.writeText(node.secret.secretValue);
  vscode.window.showInformationMessage(`Copied ${node.secret.secretKey}`);
}

interface CreateTarget {
  project: InfisicalProject;
  environment: InfisicalEnvironment;
  path: string;
}

async function resolveCreateTarget(
  node: EnvironmentNode | FolderNode | ProjectNode | undefined,
): Promise<CreateTarget | undefined> {
  if (node instanceof FolderNode) {
    return {
      project: node.project,
      environment: node.environment,
      path: node.fullPath,
    };
  }
  if (node instanceof EnvironmentNode) {
    return { project: node.project, environment: node.environment, path: "/" };
  }

  const projects = await api.getProjects();
  if (projects.length === 0) {
    vscode.window.showWarningMessage("No projects available");
    return undefined;
  }
  const projectPick = await vscode.window.showQuickPick(
    projects.map((p) => ({ label: p.name, description: p.slug, project: p })),
    { placeHolder: "Select a project" },
  );
  if (!projectPick) return undefined;

  const environments = await api.getEnvironments(projectPick.project.id);
  if (environments.length === 0) {
    vscode.window.showWarningMessage("No environments in project");
    return undefined;
  }
  const envPick = await vscode.window.showQuickPick(
    environments.map((e) => ({ label: e.name, description: e.slug, env: e })),
    { placeHolder: "Select an environment" },
  );
  if (!envPick) return undefined;

  return { project: projectPick.project, environment: envPick.env, path: "/" };
}

function showError(error: unknown, context: string) {
  console.error(context, error);
  vscode.window.showErrorMessage(`${context}: ${extractErrorMessage(error)}`);
}
