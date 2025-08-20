import * as vscode from 'vscode';

export interface TelemetryEvent {
  eventName: string;
  properties?: { [key: string]: string | number | boolean };
  timestamp: string;
}

export class TelemetryService implements vscode.Disposable {
  private enabled: boolean;
  private events: TelemetryEvent[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    enabled: boolean = false
  ) {
    this.enabled = enabled;
    
    vscode.workspace.onDidChangeConfiguration(this.onConfigurationChanged, this);
  }

  private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('infisicalAi.telemetryEnabled')) {
      const config = vscode.workspace.getConfiguration('infisicalAi');
      this.enabled = config.get<boolean>('telemetryEnabled', false);
    }
  }

  track(eventName: string, properties?: { [key: string]: string | number | boolean }): void {
    if (!this.enabled) {
      return;
    }

    const event: TelemetryEvent = {
      eventName,
      properties,
      timestamp: new Date().toISOString()
    };

    this.events.push(event);
    
    console.log(`[Telemetry] ${eventName}`, properties);

    if (this.events.length > 100) {
      this.events = this.events.slice(-50);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const config = vscode.workspace.getConfiguration('infisicalAi');
    config.update('telemetryEnabled', enabled, vscode.ConfigurationTarget.Global);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }

  dispose(): void {
    if (this.enabled && this.events.length > 0) {
      console.log(`[Telemetry] Extension deactivated with ${this.events.length} events collected`);
    }
    this.clearEvents();
  }
}