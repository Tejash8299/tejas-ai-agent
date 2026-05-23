import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentLoop } from '../services/openai';

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'tejas-agent.sidebar';

  private agentHistory: Anthropic.MessageParam[] = [];
  private displayHistory: DisplayMessage[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    const savedAgent = context.workspaceState.get<string>('agentHistory');
    const savedDisplay = context.workspaceState.get<string>('displayHistory');
    if (savedAgent) { try { this.agentHistory = JSON.parse(savedAgent); } catch {} }
    if (savedDisplay) { try { this.displayHistory = JSON.parse(savedDisplay); } catch {} }
  }

  private saveHistory() {
    this.context.workspaceState.update('agentHistory', JSON.stringify(this.agentHistory));
    this.context.workspaceState.update('displayHistory', JSON.stringify(this.displayHistory));
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        if (this.displayHistory.length > 0) {
          webviewView.webview.postMessage({ type: 'history', messages: this.displayHistory });
        }
        return;
      }

      if (message.type === 'prompt') {
        const activeEditor = vscode.window.activeTextEditor;
        const activeFile = activeEditor
          ? vscode.workspace.asRelativePath(activeEditor.document.uri)
          : null;

        try {
          const { response, updatedHistory } = await runAgentLoop(
            message.value,
            this.agentHistory,
            activeFile,
            (status) => webviewView.webview.postMessage({ type: 'status', value: status }),
            (chunk) => webviewView.webview.postMessage({ type: 'chunk', value: chunk })
          );
          this.agentHistory = updatedHistory;
          this.displayHistory.push({ role: 'user', text: message.value });
          if (response) {
            this.displayHistory.push({ role: 'assistant', text: response });
          }
          this.saveHistory();
          webviewView.webview.postMessage({ type: 'response_done' });
        } catch (error: any) {
          webviewView.webview.postMessage({ type: 'error', value: error.message });
        }
      }

      if (message.type === 'clear') {
        this.agentHistory = [];
        this.displayHistory = [];
        this.saveHistory();
      }
    });
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { padding: 10px; color: #ccc; background: #1e1e1e; font-family: sans-serif; display: flex; flex-direction: column; height: 100vh; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  h2.title { color: white; font-size: 14px; }
  #clearBtn { background: none; border: 1px solid #555; color: #888; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  #clearBtn:hover { border-color: #888; color: #ccc; }
  #chat { flex: 1; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
  .msg { padding: 8px 12px; border-radius: 8px; max-width: 90%; font-size: 13px; line-height: 1.5; }
  .user { background: #0e639c; color: white; align-self: flex-end; white-space: pre-wrap; word-break: break-word; }
  .assistant { background: #2d2d2d; color: #ddd; align-self: flex-start; word-break: break-word; }
  .error { background: #5a1d1d; color: #f48771; align-self: flex-start; white-space: pre-wrap; }
  .thinking { color: #888; font-style: italic; font-size: 12px; align-self: flex-start; padding: 6px 10px; background: #252525; border-radius: 6px; border-left: 2px solid #0e639c; }
  .assistant pre { background: #1a1a1a; border: 1px solid #444; border-radius: 4px; padding: 8px; overflow-x: auto; margin: 6px 0; font-size: 12px; font-family: monospace; white-space: pre; }
  .assistant code { background: #1a1a1a; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-family: monospace; }
  .assistant pre code { background: none; padding: 0; }
  .assistant h1, .assistant h2, .assistant h3 { color: #e0e0e0; margin: 6px 0 3px; }
  .assistant h1 { font-size: 15px; } .assistant h2 { font-size: 14px; } .assistant h3 { font-size: 13px; }
  .assistant li { margin-left: 16px; list-style-type: disc; margin-bottom: 2px; }
  .assistant strong { color: #e0e0e0; } .assistant em { font-style: italic; }
  #input-area { display: flex; flex-direction: column; gap: 6px; }
  textarea { width: 100%; height: 80px; background: #2d2d2d; color: white; border: 1px solid #555; padding: 8px; resize: none; font-family: sans-serif; font-size: 13px; border-radius: 4px; outline: none; }
  textarea:focus { border-color: #0e639c; }
  button#sendBtn { padding: 8px; cursor: pointer; background: #0e639c; color: white; border: none; border-radius: 4px; font-size: 13px; }
  button#sendBtn:hover:not(:disabled) { background: #1177bb; }
  button#sendBtn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
  <div class="header">
    <h2 class="title">Tejas AI Agent</h2>
    <button id="clearBtn" onclick="clearChat()">Clear</button>
  </div>
  <div id="chat"></div>
  <div id="input-area">
    <textarea id="prompt" placeholder="Ask anything... read files, write code, search (Shift+Enter for newline, Enter to send)"></textarea>
    <button id="sendBtn" onclick="sendPrompt()">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('sendBtn');
    const promptEl = document.getElementById('prompt');
    let currentBubble = null, currentRawText = '';

    promptEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    });

    function sendPrompt() {
      const value = promptEl.value.trim();
      if (!value || sendBtn.disabled) return;
      appendMsg('user', value, false);
      promptEl.value = '';
      sendBtn.disabled = true;
      currentBubble = null;
      currentRawText = '';
      appendMsg('thinking', 'Thinking...', false);
      vscode.postMessage({ type: 'prompt', value });
    }

    function clearChat() {
      chat.innerHTML = '';
      currentBubble = null;
      currentRawText = '';
      vscode.postMessage({ type: 'clear' });
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function inline(text) {
      text = escapeHtml(text);
      const parts = text.split('\`');
      return parts.map((p, i) => {
        if (i % 2 === 1) return '<code>' + p + '</code>';
        return p
          .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
          .replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      }).join('');
    }

    function processLine(line) {
      if (line.startsWith('### ')) return '<h3>' + inline(line.slice(4)) + '</h3>';
      if (line.startsWith('## ')) return '<h2>' + inline(line.slice(3)) + '</h2>';
      if (line.startsWith('# ')) return '<h1>' + inline(line.slice(2)) + '</h1>';
      if (line.startsWith('- ')) return '<li>' + inline(line.slice(2)) + '</li>';
      if (line.trim() === '') return '<br>';
      return inline(line) + '<br>';
    }

    function renderMarkdown(raw) {
      const lines = raw.split('\\n');
      const out = [];
      let inCode = false, codeLines = [];
      for (const line of lines) {
        if (line.startsWith('\`\`\`') && !inCode) { inCode = true; codeLines = []; continue; }
        if (line.startsWith('\`\`\`') && inCode) {
          out.push('<pre><code>' + escapeHtml(codeLines.join('\\n')) + '</code></pre>');
          inCode = false; continue;
        }
        if (inCode) { codeLines.push(line); continue; }
        out.push(processLine(line));
      }
      if (inCode) out.push('<pre><code>' + escapeHtml(codeLines.join('\\n')) + '</code></pre>');
      return out.join('');
    }

    let msgIdx = 0;
    function appendMsg(role, text, asMarkdown) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.id = 'msg-' + (++msgIdx);
      if (asMarkdown && role === 'assistant') {
        div.innerHTML = renderMarkdown(text);
      } else {
        div.textContent = text;
      }
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
      return div;
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'history') {
        msg.messages.forEach(m => appendMsg(m.role, m.text, true));
        return;
      }
      if (msg.type === 'status') {
        const t = chat.querySelector('.thinking');
        if (t) t.textContent = msg.value;
        return;
      }
      if (msg.type === 'chunk') {
        if (!currentBubble) {
          const t = chat.querySelector('.thinking');
          if (t) t.remove();
          currentBubble = appendMsg('assistant', '', false);
          currentRawText = '';
        }
        currentRawText += msg.value;
        currentBubble.textContent = currentRawText;
        chat.scrollTop = chat.scrollHeight;
        return;
      }
      if (msg.type === 'response_done') {
        sendBtn.disabled = false;
        if (currentBubble && currentRawText) {
          currentBubble.innerHTML = renderMarkdown(currentRawText);
        } else {
          const t = chat.querySelector('.thinking');
          if (t) t.remove();
        }
        currentBubble = null;
        currentRawText = '';
        chat.scrollTop = chat.scrollHeight;
        return;
      }
      if (msg.type === 'error') {
        const t = chat.querySelector('.thinking');
        if (t) t.remove();
        sendBtn.disabled = false;
        appendMsg('error', 'Error: ' + msg.value, false);
        chat.scrollTop = chat.scrollHeight;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
