import { randomBytes } from "crypto";
import * as vscode from "vscode";
import {
  InfisicalApi,
  InfisicalEnvironment,
  InfisicalProject,
  InfisicalSecret,
} from "../api/InfisicalApi";
import { extractErrorMessage } from "../utils/errors";

type OnChange = () => void;

export interface PanelContext {
  project: InfisicalProject;
  environment: InfisicalEnvironment;
  path: string;
}

interface InboundMessage {
  type: "ready" | "refresh" | "create" | "update" | "delete" | "copy";
  secretKey?: string;
  newKey?: string;
  value?: string;
}

interface OutboundMessage {
  type: "state";
  context: { projectName: string; environmentName: string; path: string };
  secrets: InfisicalSecret[];
  loading: boolean;
  error?: string;
}

export class SecretsPanel {
  private static instance: SecretsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private context: PanelContext;
  private disposables: vscode.Disposable[] = [];
  private secrets: InfisicalSecret[] = [];
  private loading = false;
  private requestSeq = 0;

  static show(
    api: InfisicalApi,
    context: PanelContext,
    onChange: OnChange,
  ): SecretsPanel {
    if (SecretsPanel.instance) {
      SecretsPanel.instance.onChange = onChange;
      SecretsPanel.instance.update(context);
      SecretsPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
      return SecretsPanel.instance;
    }
    SecretsPanel.instance = new SecretsPanel(api, context, onChange);
    return SecretsPanel.instance;
  }

  static current(): SecretsPanel | undefined {
    return SecretsPanel.instance;
  }

  private constructor(
    private api: InfisicalApi,
    context: PanelContext,
    private onChange: OnChange,
  ) {
    this.context = context;
    this.panel = vscode.window.createWebviewPanel(
      "infisical.secrets",
      this.titleFor(context),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.renderHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  update(context: PanelContext): void {
    this.context = context;
    this.panel.title = this.titleFor(context);
    this.refresh();
  }

  async refresh(): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading = true;
    this.postState();
    try {
      const secrets = await this.api.listSecrets(this.scope());
      if (seq !== this.requestSeq) return;
      this.secrets = secrets;
      this.loading = false;
      this.postState();
    } catch (error) {
      if (seq !== this.requestSeq) return;
      this.loading = false;
      this.postState(extractErrorMessage(error));
    }
  }

  private scope() {
    return {
      workspaceId: this.context.project.id,
      environment: this.context.environment.slug,
      secretPath: this.context.path,
    };
  }

  private dispose() {
    SecretsPanel.instance = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private titleFor(ctx: PanelContext): string {
    const path = ctx.path === "/" ? "" : ` ${ctx.path}`;
    return `${ctx.project.name} / ${ctx.environment.name}${path}`;
  }

  private postState(error?: string) {
    const message: OutboundMessage = {
      type: "state",
      context: {
        projectName: this.context.project.name,
        environmentName: this.context.environment.name,
        path: this.context.path,
      },
      secrets: this.secrets,
      loading: this.loading,
      error,
    };
    this.panel.webview.postMessage(message);
  }

  private async handleMessage(msg: InboundMessage) {
    switch (msg.type) {
      case "ready":
        this.refresh();
        return;
      case "refresh":
        this.refresh();
        return;
      case "create":
        if (!msg.newKey) return;
        await this.runMutation(
          () =>
            this.api.createSecret({
              ...this.scope(),
              secretKey: msg.newKey!,
              secretValue: msg.value ?? "",
            }),
          `Created ${msg.newKey}`,
        );
        return;
      case "update":
        if (!msg.secretKey) return;
        await this.runMutation(
          () =>
            this.api.updateSecret({
              ...this.scope(),
              secretKey: msg.secretKey!,
              secretValue: msg.value ?? "",
            }),
          `Updated ${msg.secretKey}`,
        );
        return;
      case "delete": {
        if (!msg.secretKey) return;
        const confirm = await vscode.window.showWarningMessage(
          `Delete secret "${msg.secretKey}"?`,
          { modal: true },
          "Delete",
        );
        if (confirm !== "Delete") return;
        await this.runMutation(
          () =>
            this.api.deleteSecret({
              ...this.scope(),
              secretKey: msg.secretKey!,
            }),
          `Deleted ${msg.secretKey}`,
        );
        return;
      }
      case "copy": {
        if (!msg.secretKey) return;
        const secret = this.secrets.find((s) => s.secretKey === msg.secretKey);
        if (!secret) return;
        await vscode.env.clipboard.writeText(secret.secretValue);
        vscode.window.showInformationMessage(`Copied ${secret.secretKey}`);
        return;
      }
    }
  }

  private async runMutation(
    fn: () => Promise<unknown>,
    successMessage: string,
  ) {
    try {
      await fn();
      vscode.window.showInformationMessage(successMessage);
      await this.refresh();
      this.onChange();
    } catch (error) {
      const message = extractErrorMessage(error);
      vscode.window.showErrorMessage(message);
      this.postState(message);
    }
  }

  private renderHtml(): string {
    const nonce = generateNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Infisical Secrets</title>
  <style>
    :root {
      color-scheme: var(--vscode-color-scheme);
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      gap: 12px;
    }
    .crumb {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .toolbar {
      display: flex;
      gap: 6px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 10px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-widget-border, transparent);
    }
    button.secondary:hover { background: var(--vscode-toolbar-hoverBackground); }
    button.icon {
      background: transparent;
      color: var(--vscode-foreground);
      padding: 2px 6px;
      opacity: 0.7;
    }
    button.icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    button.danger:hover { color: var(--vscode-errorForeground); }
    input[type=text], input[type=password] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 4px 6px;
      font-family: inherit;
      font-size: inherit;
      box-sizing: border-box;
      width: 100%;
    }
    input:focus { outline: 1px solid var(--vscode-focusBorder); }
    .table {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(200px, 2fr) auto;
      column-gap: 8px;
    }
    #rows {
      display: contents;
    }
    .row {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.07));
    }
    .row.head {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      padding-bottom: 4px;
    }
    .row .actions {
      display: flex;
      gap: 2px;
      justify-content: flex-end;
      visibility: hidden;
    }
    .row:hover .actions { visibility: visible; }
    .add-row {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(200px, 2fr) auto;
      gap: 8px;
      margin-top: 12px;
      align-items: center;
    }
    .empty, .loading, .error {
      grid-column: 1 / -1;
      padding: 24px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .error { color: var(--vscode-errorForeground); }
    .filter {
      margin-bottom: 8px;
    }
    .key-cell {
      font-family: var(--vscode-editor-font-family);
      word-break: break-all;
    }
    .value-cell {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .value-cell input {
      flex: 1;
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  <header>
    <div id="crumb" class="crumb"></div>
    <div class="toolbar">
      <button class="secondary" id="revealAll">Reveal values</button>
      <button class="secondary" id="refresh">Refresh</button>
    </div>
  </header>

  <input class="filter" id="filter" type="text" placeholder="Filter by name..." />

  <div class="table">
    <div class="row head">
      <div>Name</div>
      <div>Value</div>
      <div></div>
    </div>
    <div id="rows"></div>
  </div>

  <div class="add-row">
    <input id="newKey" type="text" placeholder="NEW_SECRET_KEY" />
    <input id="newValue" type="password" placeholder="value" />
    <button id="add">Add</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const rowsEl = document.getElementById('rows');
    const crumbEl = document.getElementById('crumb');
    const filterEl = document.getElementById('filter');
    let state = { secrets: [], loading: true, context: null, error: null };
    let filter = '';
    let revealAll = false;
    const visibleValues = new Set();

    vscode.postMessage({ type: 'ready' });

    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    const revealBtn = document.getElementById('revealAll');
    revealBtn.addEventListener('click', () => {
      revealAll = !revealAll;
      visibleValues.clear();
      revealBtn.textContent = revealAll ? 'Hide values' : 'Reveal values';
      renderRows();
    });

    document.getElementById('add').addEventListener('click', addSecret);
    document.getElementById('newKey').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addSecret();
    });
    document.getElementById('newValue').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addSecret();
    });
    filterEl.addEventListener('input', () => {
      filter = filterEl.value.toLowerCase();
      renderRows();
    });

    function addSecret() {
      const keyEl = document.getElementById('newKey');
      const valueEl = document.getElementById('newValue');
      const newKey = keyEl.value.trim();
      if (!newKey) return;
      vscode.postMessage({ type: 'create', newKey, value: valueEl.value });
      keyEl.value = '';
      valueEl.value = '';
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'state') {
        state = msg;
        crumbEl.textContent = msg.context
          ? msg.context.projectName + ' › ' + msg.context.environmentName + ' › ' + msg.context.path
          : '';
        renderRows();
      }
    });

    function renderRows() {
      rowsEl.innerHTML = '';
      if (state.error) {
        const div = document.createElement('div');
        div.className = 'error';
        div.textContent = state.error;
        rowsEl.appendChild(div);
        return;
      }
      if (state.loading) {
        const div = document.createElement('div');
        div.className = 'loading';
        div.textContent = 'Loading...';
        rowsEl.appendChild(div);
        return;
      }
      const visible = state.secrets.filter((s) =>
        !filter || s.secretKey.toLowerCase().includes(filter)
      );
      if (visible.length === 0) {
        const div = document.createElement('div');
        div.className = 'empty';
        div.textContent = filter ? 'No matches' : 'No secrets at this path. Add one below.';
        rowsEl.appendChild(div);
        return;
      }
      for (const secret of visible) {
        rowsEl.appendChild(renderRow(secret));
      }
    }

    function renderRow(secret) {
      const row = document.createElement('div');
      row.className = 'row';

      const keyCell = document.createElement('div');
      keyCell.className = 'key-cell';
      keyCell.textContent = secret.secretKey;
      row.appendChild(keyCell);

      const valueCell = document.createElement('div');
      valueCell.className = 'value-cell';
      const valueInput = document.createElement('input');
      const isVisible = revealAll || visibleValues.has(secret.secretKey);
      valueInput.type = isVisible ? 'text' : 'password';
      valueInput.value = secret.secretValue;
      valueInput.dataset.original = secret.secretValue;
      valueInput.dataset.key = secret.secretKey;
      valueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitValue(valueInput);
        } else if (e.key === 'Escape') {
          valueInput.value = valueInput.dataset.original;
          valueInput.blur();
        }
      });
      valueInput.addEventListener('blur', () => commitValue(valueInput));
      valueCell.appendChild(valueInput);
      row.appendChild(valueCell);

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(iconButton(isVisible ? 'Hide' : 'Reveal', () => {
        if (isVisible) visibleValues.delete(secret.secretKey);
        else visibleValues.add(secret.secretKey);
        renderRows();
      }));
      actions.appendChild(iconButton('Copy', () => {
        vscode.postMessage({ type: 'copy', secretKey: secret.secretKey });
      }));
      actions.appendChild(iconButton('Delete', () => {
        vscode.postMessage({ type: 'delete', secretKey: secret.secretKey });
      }, 'danger'));
      row.appendChild(actions);

      return row;
    }

    function commitValue(input) {
      const original = input.dataset.original ?? '';
      if (input.value === original) return;
      vscode.postMessage({
        type: 'update',
        secretKey: input.dataset.key,
        value: input.value
      });
    }

    function iconButton(label, onClick, extra) {
      const btn = document.createElement('button');
      btn.className = 'icon' + (extra ? ' ' + extra : '');
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    }
  </script>
</body>
</html>`;
  }
}

function generateNonce(): string {
  return randomBytes(16).toString("base64url");
}
