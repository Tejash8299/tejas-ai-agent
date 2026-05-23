import * as vscode from 'vscode';
import * as path from 'path';
import dotenv from 'dotenv';
import { SidebarProvider } from './sidebar/SidebarProvider';

export function activate(context: vscode.ExtensionContext) {

    dotenv.config({ path: path.join(context.extensionPath, '.env') });

    const sidebarProvider = new SidebarProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'tejas-agent.sidebar',
            sidebarProvider
        )
    );
}

export function deactivate() {}
