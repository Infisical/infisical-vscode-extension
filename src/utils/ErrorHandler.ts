import * as vscode from 'vscode';

export class ErrorHandler {
  static handle(error: unknown, context: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullMessage = `${context}: ${errorMessage}`;
    
    console.error(fullMessage, error);
    
    if (error instanceof Error && error.message.includes('401')) {
      vscode.window.showErrorMessage(
        'Authentication failed. Please check your credentials and try again.',
        'Login'
      ).then(selection => {
        if (selection === 'Login') {
          vscode.commands.executeCommand('infisicalAi.login');
        }
      });
    } else if (error instanceof Error && error.message.includes('network')) {
      vscode.window.showErrorMessage(
        'Network error. Please check your connection and try again.',
        'Retry'
      );
    } else {
      vscode.window.showErrorMessage(fullMessage);
    }
  }

  static async handleAsync(error: unknown, context: string): Promise<void> {
    this.handle(error, context);
  }
}