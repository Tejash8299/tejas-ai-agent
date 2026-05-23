import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentLoop, setApiKey, ImageInput } from '../services/openai';

interface DisplayMessage {
  role: 'user' | 'assistant' | 'tool';
  text: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {

  public static readonly viewType = 'tejas-agent.sidebar';

  private agentHistory: Anthropic.MessageParam[] = [];
  private displayHistory: DisplayMessage[] = [];
  private pendingConfirms = new Map<string, (allowed: boolean) => void>();

  constructor(private readonly context: vscode.ExtensionContext) {
    const savedAgent = context.workspaceState.get<string>('agentHistory');
    const savedDisplay = context.workspaceState.get<string>('displayHistory');
    if (savedAgent) { try { this.agentHistory = JSON.parse(savedAgent); } catch {} }
    if (savedDisplay) { try { this.displayHistory = JSON.parse(savedDisplay); } catch {} }
  }

  public setApiKey(key: string) {
    setApiKey(key);
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

      if (message.type === 'get_files') {
        const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 200);
        const files = uris.map(u => vscode.workspace.asRelativePath(u)).sort();
        webviewView.webview.postMessage({ type: 'files_list', files });
        return;
      }

      if (message.type === 'tool_response') {
        const resolver = this.pendingConfirms.get(message.id);
        if (resolver) {
          resolver(message.allowed);
          this.pendingConfirms.delete(message.id);
        }
        return;
      }

      if (message.type === 'prompt') {
        const activeEditor = vscode.window.activeTextEditor;
        const activeFile = activeEditor
          ? vscode.workspace.asRelativePath(activeEditor.document.uri)
          : null;

        // Read @mentioned files and append their content
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        let finalMessage: string = message.value;

        if (workspacePath) {
          const mentionRegex = /@([\w./\\-]+)/g;
          let match;
          const extras: string[] = [];
          while ((match = mentionRegex.exec(message.value)) !== null) {
            try {
              const content = await fs.readFile(path.join(workspacePath, match[1]), 'utf-8');
              extras.push(`\n\n[Content of @${match[1]}]:\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``);
            } catch {}
          }
          if (extras.length > 0) {
            finalMessage = message.value + extras.join('');
          }
        }

        const images: ImageInput[] = message.images || [];

        const requestApproval = (toolName: string, info: string): Promise<boolean> => {
          const id = Date.now().toString() + Math.random().toString(36).slice(2);
          return new Promise(resolve => {
            this.pendingConfirms.set(id, resolve);
            webviewView.webview.postMessage({ type: 'confirm_tool', id, tool: toolName, info });
          });
        };

        try {
          const { response, updatedHistory } = await runAgentLoop(
            finalMessage,
            this.agentHistory,
            activeFile,
            images,
            (status) => webviewView.webview.postMessage({ type: 'status', value: status }),
            (chunk) => webviewView.webview.postMessage({ type: 'chunk', value: chunk }),
            (activity) => {
              webviewView.webview.postMessage({ type: 'tool_activity', value: activity });
              this.displayHistory.push({ role: 'tool', text: activity });
            },
            requestApproval
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
  #chat { flex: 1; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
  .msg { padding: 8px 12px; border-radius: 8px; max-width: 90%; font-size: 13px; line-height: 1.5; }
  .user { background: #0e639c; color: white; align-self: flex-end; white-space: pre-wrap; word-break: break-word; }
  .assistant { background: #2d2d2d; color: #ddd; align-self: flex-start; word-break: break-word; }
  .error { background: #5a1d1d; color: #f48771; align-self: flex-start; white-space: pre-wrap; }
  .thinking { color: #888; font-style: italic; font-size: 12px; align-self: flex-start; padding: 6px 10px; background: #252525; border-radius: 6px; border-left: 2px solid #0e639c; }
  .tool-log { color: #9cdcfe; font-size: 11px; align-self: flex-start; padding: 3px 8px; background: #1a2634; border-radius: 4px; border-left: 2px solid #569cd6; font-family: monospace; max-width: 95%; }
  .assistant pre { background: #1a1a1a; border: 1px solid #444; border-radius: 4px; padding: 8px; overflow-x: auto; margin: 6px 0; font-size: 12px; font-family: monospace; white-space: pre; }
  .assistant code { background: #1a1a1a; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-family: monospace; }
  .assistant pre code { background: none; padding: 0; }
  .assistant h1, .assistant h2, .assistant h3 { color: #e0e0e0; margin: 6px 0 3px; }
  .assistant h1 { font-size: 15px; } .assistant h2 { font-size: 14px; } .assistant h3 { font-size: 13px; }
  .assistant li { margin-left: 16px; list-style-type: disc; margin-bottom: 2px; }
  .assistant strong { color: #e0e0e0; } .assistant em { font-style: italic; }
  #input-area { display: flex; flex-direction: column; gap: 0; position: relative; }
  #input-box { background: #2d2d2d; border: 1px solid #555; border-radius: 8px; overflow: hidden; transition: border-color 0.15s; }
  #input-box:focus-within { border-color: #0e639c; }
  #image-preview { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 0; }
  #image-preview:empty { display: none; }
  .img-thumb { position: relative; display: inline-block; }
  .img-thumb img { max-height: 64px; max-width: 90px; border-radius: 6px; object-fit: cover; display: block; }
  .img-thumb .rm { position: absolute; top: -5px; right: -5px; background: #c00; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; cursor: pointer; font-size: 11px; line-height: 18px; text-align: center; padding: 0; }
  textarea { width: 100%; min-height: 80px; max-height: 180px; background: transparent; color: #e0e0e0; border: none; padding: 10px 12px; resize: none; font-family: sans-serif; font-size: 13px; outline: none; line-height: 1.5; }
  textarea::placeholder { color: #666; }
  #input-actions { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-top: 1px solid #3a3a3a; }
  #imgBtn { background: none; border: none; color: #777; cursor: pointer; font-size: 18px; padding: 4px 6px; border-radius: 4px; line-height: 1; display: flex; align-items: center; }
  #imgBtn:hover { color: #ccc; background: #3a3a3a; }
  button#sendBtn { padding: 6px 18px; cursor: pointer; background: #0e639c; color: white; border: none; border-radius: 5px; font-size: 13px; font-weight: 500; }
  button#sendBtn:hover:not(:disabled) { background: #1177bb; }
  button#sendBtn:disabled { opacity: 0.4; cursor: not-allowed; }
  #mention-dropdown { position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; background: #252526; border: 1px solid #555; border-radius: 6px; max-height: 180px; overflow-y: auto; display: none; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .mention-item { padding: 6px 12px; cursor: pointer; font-size: 12px; font-family: monospace; color: #ccc; }
  .mention-item:hover, .mention-item.selected { background: #094771; color: white; }
  .tool-confirm { align-self: flex-start; background: #1e1a0e; border: 1px solid #6b5000; border-radius: 8px; padding: 10px 12px; max-width: 92%; }
  .confirm-header { color: #f0c040; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  .confirm-tool { color: #9cdcfe; font-family: monospace; font-size: 12px; margin-bottom: 2px; }
  .confirm-info { color: #aaa; font-family: monospace; font-size: 11px; margin-bottom: 8px; word-break: break-all; }
  .confirm-btns { display: flex; gap: 8px; }
  .allow-btn { background: #1a5c2a; color: #7ec87e; border: 1px solid #2a7a3a; padding: 4px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .allow-btn:hover { background: #2a7a3a; color: white; }
  .deny-btn { background: #3a1a1a; color: #c87e7e; border: 1px solid #5a2a2a; padding: 4px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .deny-btn:hover { background: #5a2a2a; color: white; }
</style>
</head>
<body>
  <div class="header">
    <h2 class="title">Tejas AI Agent</h2>
    <button id="clearBtn" onclick="clearChat()">Clear</button>
  </div>
  <div id="chat"></div>
  <div id="input-area">
    <div id="mention-dropdown"></div>
    <div id="input-box">
      <div id="image-preview"></div>
      <textarea id="prompt" placeholder="Ask anything... use @filename to include a file (Shift+Enter for newline, Enter to send)"></textarea>
      <div id="input-actions">
        <label id="imgBtn" title="Attach image">📎<input type="file" id="imgInput" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none"></label>
        <button id="sendBtn" onclick="sendPrompt()">Send</button>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('sendBtn');
    const promptEl = document.getElementById('prompt');
    const dropdown = document.getElementById('mention-dropdown');
    let currentBubble = null, currentRawText = '';
    let pendingImages = [];
    let filesCache = [];
    let mentionStart = -1, selectedIdx = 0;

    // Image upload
    document.getElementById('imgInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        const base64 = dataUrl.split(',')[1];
        const idx = pendingImages.push({ mediaType: file.type, data: base64 }) - 1;
        const wrap = document.createElement('div');
        wrap.className = 'img-thumb';
        wrap.id = 'thumb-' + idx;
        const img = document.createElement('img');
        img.src = dataUrl;
        const rm = document.createElement('button');
        rm.className = 'rm';
        rm.textContent = '×';
        rm.onclick = () => { pendingImages[idx] = null; wrap.remove(); };
        wrap.appendChild(img);
        wrap.appendChild(rm);
        document.getElementById('image-preview').appendChild(wrap);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // @mention autocomplete
    promptEl.addEventListener('input', () => {
      const text = promptEl.value;
      const cursor = promptEl.selectionStart;
      const before = text.slice(0, cursor);
      const m = before.match(/@([\\w./\\\\-]*)$/);
      if (m) {
        mentionStart = cursor - m[0].length;
        if (filesCache.length === 0) {
          vscode.postMessage({ type: 'get_files' });
        } else {
          showDropdown(m[1].toLowerCase());
        }
      } else {
        hideDropdown();
      }
    });

    promptEl.addEventListener('keydown', e => {
      if (dropdown.style.display !== 'none') {
        const items = dropdown.querySelectorAll('.mention-item');
        if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); updateSelected(items); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); updateSelected(items); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (items[selectedIdx]) items[selectedIdx].click(); return; }
        if (e.key === 'Escape') { hideDropdown(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    });

    function updateSelected(items) {
      items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
    }

    function showDropdown(query) {
      const filtered = filesCache.filter(f => f.toLowerCase().includes(query)).slice(0, 10);
      if (!filtered.length) { hideDropdown(); return; }
      dropdown.innerHTML = '';
      selectedIdx = 0;
      filtered.forEach((file, i) => {
        const item = document.createElement('div');
        item.className = 'mention-item' + (i === 0 ? ' selected' : '');
        item.textContent = file;
        item.onclick = () => insertMention(file);
        dropdown.appendChild(item);
      });
      dropdown.style.display = 'block';
    }

    function hideDropdown() { dropdown.style.display = 'none'; }

    function insertMention(file) {
      const text = promptEl.value;
      const cursor = promptEl.selectionStart;
      const after = text.slice(cursor);
      promptEl.value = text.slice(0, mentionStart) + '@' + file + ' ' + after;
      const pos = mentionStart + file.length + 2;
      promptEl.setSelectionRange(pos, pos);
      promptEl.focus();
      hideDropdown();
    }

    document.addEventListener('click', e => {
      if (!e.target.closest('#mention-dropdown') && !e.target.closest('#prompt')) hideDropdown();
    });

    function sendPrompt() {
      const value = promptEl.value.trim();
      if (!value || sendBtn.disabled) return;
      const images = pendingImages.filter(Boolean);
      appendMsg('user', value, false);
      promptEl.value = '';
      sendBtn.disabled = true;
      currentBubble = null;
      currentRawText = '';
      pendingImages = [];
      document.getElementById('image-preview').innerHTML = '';
      appendMsg('thinking', 'Thinking...', false);
      vscode.postMessage({ type: 'prompt', value, images });
    }

    function clearChat() {
      chat.innerHTML = '';
      currentBubble = null;
      currentRawText = '';
      pendingImages = [];
      document.getElementById('image-preview').innerHTML = '';
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

    function respondTool(id, allowed) {
      const card = document.getElementById('confirm-' + id);
      if (card) {
        const status = document.createElement('div');
        status.style.cssText = 'font-size:12px;color:' + (allowed ? '#7ec87e' : '#f48771');
        status.textContent = allowed ? '✓ Allowed' : '✗ Denied';
        card.innerHTML = '';
        card.appendChild(status);
      }
      vscode.postMessage({ type: 'tool_response', id, allowed });
    }

    window.addEventListener('message', event => {
      const msg = event.data;

      if (msg.type === 'confirm_tool') {
        const card = document.createElement('div');
        card.className = 'msg tool-confirm';
        card.id = 'confirm-' + msg.id;
        const header = document.createElement('div');
        header.className = 'confirm-header';
        header.textContent = '⚠️ Allow this action?';
        const tool = document.createElement('div');
        tool.className = 'confirm-tool';
        tool.textContent = msg.tool.replace(/_/g, ' ');
        const info = document.createElement('div');
        info.className = 'confirm-info';
        info.textContent = msg.info;
        const btns = document.createElement('div');
        btns.className = 'confirm-btns';
        const allowBtn = document.createElement('button');
        allowBtn.className = 'allow-btn';
        allowBtn.textContent = '✓ Allow';
        allowBtn.onclick = () => respondTool(msg.id, true);
        const denyBtn = document.createElement('button');
        denyBtn.className = 'deny-btn';
        denyBtn.textContent = '✗ Deny';
        denyBtn.onclick = () => respondTool(msg.id, false);
        btns.appendChild(allowBtn);
        btns.appendChild(denyBtn);
        card.appendChild(header);
        card.appendChild(tool);
        card.appendChild(info);
        card.appendChild(btns);
        const thinking = chat.querySelector('.thinking');
        if (thinking) thinking.before(card);
        else chat.appendChild(card);
        chat.scrollTop = chat.scrollHeight;
        return;
      }

      if (msg.type === 'history') {
        msg.messages.forEach(m => appendMsg(m.role, m.text, m.role === 'assistant'));
        return;
      }
      if (msg.type === 'files_list') {
        filesCache = msg.files;
        const text = promptEl.value;
        const before = text.slice(0, promptEl.selectionStart);
        const m = before.match(/@([\\w./\\\\-]*)$/);
        if (m) showDropdown(m[1].toLowerCase());
        return;
      }
      if (msg.type === 'tool_activity') {
        const div = document.createElement('div');
        div.className = 'msg tool-log';
        div.textContent = msg.value;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
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
