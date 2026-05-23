import * as vscode from 'vscode';
import * as path from 'path';
import dotenv from 'dotenv';
import { SidebarProvider } from './sidebar/SidebarProvider';

const SECRET_KEY = 'anthropicApiKey';

async function getOrSetApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  // Check SecretStorage first (encrypted, OS-level protected)
  let apiKey = await context.secrets.get(SECRET_KEY);
  if (apiKey) { return apiKey; }

  // Migration: if .env has the key, move it to SecretStorage
  dotenv.config({ path: path.join(context.extensionPath, '.env') });
  if (process.env.ANTHROPIC_API_KEY) {
    apiKey = process.env.ANTHROPIC_API_KEY;
    await context.secrets.store(SECRET_KEY, apiKey);
    return apiKey;
  }

  // Prompt user to enter key for the first time
  apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your Anthropic API Key',
    password: true,
    placeHolder: 'sk-ant-...',
    ignoreFocusOut: true
  });
  if (apiKey) {
    await context.secrets.store(SECRET_KEY, apiKey);
  }
  return apiKey;
}

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new SidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tejas-agent.sidebar', sidebarProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tejas-agent.setApiKey', async () => {
      const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API Key',
        password: true,
        placeHolder: 'sk-ant-...',
        ignoreFocusOut: true
      });
      if (apiKey) {
        await context.secrets.store(SECRET_KEY, apiKey);
        sidebarProvider.setApiKey(apiKey);
        vscode.window.showInformationMessage('Tejas AI: API key saved securely.');
      }
    })
  );

  getOrSetApiKey(context).then(apiKey => {
    if (apiKey) {
      sidebarProvider.setApiKey(apiKey);
    } else {
      vscode.window.showWarningMessage('Tejas AI: No API key set.', 'Set API Key').then(choice => {
        if (choice === 'Set API Key') {
          vscode.commands.executeCommand('tejas-agent.setApiKey');
        }
      });
    }
  });
}

export function deactivate() {}
