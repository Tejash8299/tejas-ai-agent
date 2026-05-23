# Tejas AI Agent

A Claude Code-like AI coding assistant running inside VS Code. It can read, write, and search files, run terminal commands, and chat with vision support — all from a sidebar panel powered by Anthropic's Claude.

---

## Features

- **Agentic tool use** — AI autonomously reads, writes, searches files, and runs terminal commands
- **Streaming responses** — real-time character-by-character output
- **Markdown rendering** — code blocks, bold, headings render properly
- **Active file context** — currently open file is automatically shared with the AI
- **Image / vision support** — attach screenshots or images via the 📎 button
- **@file mention** — type `@filename` for autocomplete; file content is automatically included
- **Tool activity log** — sidebar shows what the AI is doing in real time
- **Permission system** — dangerous actions (file write, terminal commands) require Allow/Deny confirmation
- **Persistent history** — chat history survives VS Code restarts
- **Secure API key storage** — key is stored in OS-level encrypted SecretStorage, no `.env` required

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Tejash8299/tejas-ai-agent.git
cd tejas-ai-agent
```

### 2. Install dependencies

```bash
npm install
```

### 3. Open in VS Code

```bash
code .
```

### 4. Run the extension

Press `F5` — an **Extension Development Host** window will open with the extension loaded.

The **Tejas AI** icon will appear in the Activity Bar on the left.

---

## API Key Setup

The extension requires your own **Anthropic API key** to work.

**Get your API key:**
1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Navigate to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-...`)

> New accounts get free credits to get started. The extension uses Claude Haiku by default which is very cost-efficient.

The key is stored securely in VS Code's encrypted SecretStorage (OS-level protected). It is **never written to disk in plain text** and **never shared**.

There are 3 ways to set the key:

### Option 1 — Auto prompt (first-time users)

If no key exists in SecretStorage and no `.env` file is present, the extension automatically shows an input box on startup:

```
Enter your Anthropic API Key (sk-ant-...)
```

Enter your key and press Enter — it is saved to SecretStorage immediately.

### Option 2 — Command Palette

```
Ctrl+Shift+P → "Tejas AI: Set API Key"
```

Enter your key in the password field. Use this anytime to update or change the key.

### Option 3 — `.env` file (development / migration)

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

On first startup, the extension reads the key from `.env` and **automatically migrates it to SecretStorage**. After migration, the `.env` file is no longer needed.

> **Note:** The `.env` file is listed in `.gitignore` and will never be committed to Git.

---

## How Tools Work

The AI has access to 5 tools. Each tool use is shown as a blue chip in the sidebar.

| Tool | Description | Requires Approval |
|---|---|---|
| `read_file` | Read a file from the workspace | No |
| `list_files` | List files in a directory | No |
| `search_code` | Search for text across workspace files | No |
| `write_file` | Create or overwrite a file | **Yes** |
| `run_command` | Execute a terminal command | **Yes** |

### Dangerous tool approval flow

```
AI wants to use write_file or run_command
              |
              v
Yellow confirmation card appears in sidebar:
"⚠️ Allow this action?"
Shows tool name + file path or command
              |
       -------+-------
       |               |
  [✓ Allow]        [✗ Deny]
       |               |
  Tool executes    AI receives "denied"
                   and suggests an alternative
```

### Workspace boundary protection

The AI can only access files **inside the workspace folder**. Any attempt to read, write, or list files outside the workspace is blocked:

```
Error: Access denied: "../../../etc/hosts" is outside the workspace
```

---

## @File Mention

Type `@` in the chat input to trigger a file autocomplete dropdown. Select a file and its full content will be appended to your message before sending to Claude.

**Example:**
```
Explain what @src/services/openai.ts does
```

---

## Project Structure

```
tejas-agent/
├── src/
│   ├── extension.ts              # Entry point — SecretStorage, key migration, command registration
│   ├── services/
│   │   └── openai.ts             # Anthropic API client, agentic loop, streaming, tool execution
│   ├── sidebar/
│   │   └── SidebarProvider.ts    # Webview UI, chat rendering, history, permission system
│   └── tools/
│       └── index.ts              # Tool definitions, executeTool() dispatcher, safePath()
├── .env                          # Optional — gitignored, auto-migrated to SecretStorage
├── package.json
└── README.md
```

---

## Key Files Explained

### `extension.ts`
- `getOrSetApiKey()` — checks SecretStorage → falls back to `.env` → prompts user if neither exists
- Registers the `tejas-agent.setApiKey` command
- Passes the resolved API key to `SidebarProvider`

### `services/openai.ts`
- `runAgentLoop()` — the main agentic `while` loop
- Streaming via `messages.stream()` and `stream.on('text', ...)`
- Handles `stop_reason === 'tool_use'` — executes tools and feeds results back to Claude
- `DANGEROUS_TOOLS` list — calls `onConfirm()` callback before executing sensitive tools

### `sidebar/SidebarProvider.ts`
- Inline Webview HTML/CSS/JS (no external files)
- `pendingConfirms` Map — Promise-based approval system for dangerous tools
- `workspaceState` — persists `agentHistory` and `displayHistory` across restarts
- `@mention` regex parser — reads mentioned files and injects content into the message

### `tools/index.ts`
- `toolDefinitions` — Anthropic `Tool[]` schema passed to the API
- `executeTool()` — switch-case dispatcher for all 5 tools
- `safePath()` — resolves and validates paths to prevent directory traversal attacks

---

## Release Notes

### 0.0.3
- Secure API key storage via VS Code SecretStorage (auto-migration from `.env`)
- Workspace path traversal prevention (`safePath()`)
- `Tejas AI: Set API Key` command

### 0.0.2
- Image upload and vision support
- Tool activity log
- `@file` mention autocomplete
- Permission system (Allow/Deny for dangerous tools)
- Improved input UI

### 0.0.1
- Initial release
- Agentic tool use (read, write, list, search, run command)
- Streaming responses and markdown rendering
- Active file context and persistent chat history
