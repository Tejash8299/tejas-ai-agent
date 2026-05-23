import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentLoop } from '../services/openai';

export class SidebarProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'tejas-agent.sidebar';

  private agentHistory: Anthropic.MessageParam[] = [];

  constructor() {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (message) => {

      if (message.type === 'prompt') {
        const sendStatus = (msg: string) => {
          webviewView.webview.postMessage({ type: 'status', value: msg });
        };

        try {
          const { response, updatedHistory } = await runAgentLoop(
            message.value,
            this.agentHistory,
            sendStatus
          );
          this.agentHistory = updatedHistory;
          webviewView.webview.postMessage({ type: 'response', value: response });
        } catch (error: any) {
          webviewView.webview.postMessage({ type: 'error', value: error.message });
        }
      }

      if (message.type === 'clear') {
        this.agentHistory = [];
      }
    });
  }

  private getHtmlContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            padding: 10px;
            color: #ccc;
            background: #1e1e1e;
            font-family: sans-serif;
            display: flex;
            flex-direction: column;
            height: 100vh;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
          }
          h2 { color: white; font-size: 14px; }
          #clearBtn {
            background: none;
            border: 1px solid #555;
            color: #888;
            padding: 2px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
          }
          #clearBtn:hover { border-color: #888; color: #ccc; }
          #chat {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .msg {
            padding: 8px 12px;
            border-radius: 8px;
            max-width: 90%;
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.5;
          }
          .user { background: #0e639c; color: white; align-self: flex-end; }
          .assistant { background: #2d2d2d; color: #ddd; align-self: flex-start; }
          .error { background: #5a1d1d; color: #f48771; align-self: flex-start; }
          .thinking {
            color: #888;
            font-style: italic;
            font-size: 12px;
            align-self: flex-start;
            padding: 6px 10px;
            background: #252525;
            border-radius: 6px;
            border-left: 2px solid #0e639c;
          }
          #input-area { display: flex; flex-direction: column; gap: 6px; }
          textarea {
            width: 100%;
            height: 80px;
            background: #2d2d2d;
            color: white;
            border: 1px solid #555;
            padding: 8px;
            resize: none;
            font-family: sans-serif;
            font-size: 13px;
            border-radius: 4px;
            outline: none;
          }
          textarea:focus { border-color: #0e639c; }
          button#sendBtn {
            padding: 8px;
            cursor: pointer;
            background: #0e639c;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 13px;
          }
          button#sendBtn:hover:not(:disabled) { background: #1177bb; }
          button#sendBtn:disabled { opacity: 0.5; cursor: not-allowed; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Tejas AI Agent</h2>
          <button id="clearBtn" onclick="clearChat()">Clear</button>
        </div>
        <div id="chat"></div>
        <div id="input-area">
          <textarea id="prompt" placeholder="Ask anything... read files, write code, search, explain (Shift+Enter for new line, Enter to send)"></textarea>
          <button id="sendBtn" onclick="sendPrompt()">Send</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const chat = document.getElementById('chat');
          const sendBtn = document.getElementById('sendBtn');
          const promptEl = document.getElementById('prompt');

          promptEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendPrompt();
            }
          });

          function sendPrompt() {
            const value = promptEl.value.trim();
            if (!value || sendBtn.disabled) return;

            appendMsg('user', value);
            promptEl.value = '';
            sendBtn.disabled = true;

            appendMsg('thinking', 'Thinking...');
            vscode.postMessage({ type: 'prompt', value });
          }

          function clearChat() {
            chat.innerHTML = '';
            vscode.postMessage({ type: 'clear' });
          }

          let msgCounter = 0;
          function appendMsg(role, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + role;
            div.textContent = text;
            div.id = 'msg-' + (++msgCounter);
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
            return div;
          }

          window.addEventListener('message', (event) => {
            const msg = event.data;

            if (msg.type === 'status') {
              const thinking = chat.querySelector('.thinking');
              if (thinking) thinking.textContent = msg.value;
              return;
            }

            const thinking = chat.querySelector('.thinking');
            if (thinking) thinking.remove();

            sendBtn.disabled = false;

            if (msg.type === 'response') {
              appendMsg('assistant', msg.value);
            } else if (msg.type === 'error') {
              appendMsg('error', 'Error: ' + msg.value);
            }

            chat.scrollTop = chat.scrollHeight;
          });
        </script>
      </body>
      </html>
    `;
  }
}
