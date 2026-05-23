import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type Anthropic from '@anthropic-ai/sdk';

const execAsync = promisify(exec);

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the VS Code workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace (creates file if it does not exist)',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        content: { type: 'string', description: 'Content to write to the file' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory of the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace root. Use "." for root.' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_code',
    description: 'Search for text or a pattern across files in the workspace',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        file_glob: { type: 'string', description: 'Optional glob pattern like "**/*.ts". Defaults to all files.' }
      },
      required: ['query']
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace directory and return its output',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute (e.g. "npm install", "git status")' }
      },
      required: ['command']
    }
  }
];

function getWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('No workspace folder is open in VS Code');
  }
  return folders[0].uri.fsPath;
}

function safePath(workspacePath: string, inputPath: string): string {
  const resolved = path.resolve(workspacePath, inputPath);
  const normalized = path.normalize(workspacePath);
  if (resolved !== normalized && !resolved.startsWith(normalized + path.sep)) {
    throw new Error(`Access denied: "${inputPath}" is outside the workspace`);
  }
  return resolved;
}

async function searchInFiles(workspacePath: string, query: string, fileGlob?: string): Promise<string> {
  const include = fileGlob || '**/*';
  const uris = await vscode.workspace.findFiles(include, '**/node_modules/**', 50);
  const results: string[] = [];

  for (const uri of uris) {
    try {
      const content = await fs.readFile(uri.fsPath, 'utf-8');
      const lines = content.split('\n');
      const matches: string[] = [];

      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push(`  Line ${i + 1}: ${line.trimStart()}`);
        }
      });

      if (matches.length > 0) {
        const rel = path.relative(workspacePath, uri.fsPath);
        results.push(`${rel}:\n${matches.slice(0, 5).join('\n')}`);
      }
    } catch {
      // skip unreadable files
    }
  }

  return results.length > 0 ? results.join('\n\n') : 'No matches found.';
}

export async function executeTool(
  name: string,
  input: Record<string, string>,
  onStatus?: (msg: string) => void
): Promise<string> {
  const workspacePath = getWorkspacePath();

  switch (name) {
    case 'read_file': {
      onStatus?.(`Reading: ${input.path}`);
      const content = await fs.readFile(safePath(workspacePath, input.path), 'utf-8');
      return content;
    }

    case 'write_file': {
      onStatus?.(`Writing: ${input.path}`);
      const filePath = safePath(workspacePath, input.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, input.content, 'utf-8');
      return `Successfully wrote ${input.path}`;
    }

    case 'list_files': {
      onStatus?.(`Listing: ${input.path || 'workspace root'}`);
      const dirPath = safePath(workspacePath, input.path || '.');
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`).join('\n');
    }

    case 'search_code': {
      onStatus?.(`Searching: "${input.query}"`);
      return await searchInFiles(workspacePath, input.query, input.file_glob);
    }

    case 'run_command': {
      onStatus?.(`Running: ${input.command}`);
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: workspacePath,
        timeout: 30000
      });
      return stdout || stderr || '(no output)';
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
