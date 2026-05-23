import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool } from '../tools';

export interface ImageInput {
  mediaType: string;
  data: string;
}

const SYSTEM_PROMPT = `You are Tejas AI Agent, a powerful coding assistant running inside VS Code.
You have tools to read, write, search, list files, and run shell commands in the user's workspace.
When the user asks you to do something with their code, use your tools to actually do it.
Be concise. After completing a task, briefly summarize what you did.`;

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  write_file: '✏️',
  list_files: '📂',
  search_code: '🔍',
  run_command: '⚡'
};

const DANGEROUS_TOOLS = ['write_file', 'run_command'];

function formatToolActivity(name: string, input: Record<string, string>): string {
  const icon = TOOL_ICONS[name] || '🔧';
  const info = input.path || input.query || input.command || '';
  return `${icon} ${name.replace(/_/g, ' ')}: ${info}`;
}

function getConfirmInfo(name: string, input: Record<string, string>): string {
  if (name === 'write_file') { return `File: ${input.path}`; }
  if (name === 'run_command') { return `Command: ${input.command}`; }
  return JSON.stringify(input).slice(0, 100);
}

let _client: Anthropic | null = null;
let _apiKey = '';

export function setApiKey(key: string) {
  if (key !== _apiKey) {
    _apiKey = key;
    _client = null;
  }
}

function getClient(): Anthropic {
  if (!_apiKey) { throw new Error('API key not set. Use "Tejas AI: Set API Key" command.'); }
  if (!_client) { _client = new Anthropic({ apiKey: _apiKey }); }
  return _client;
}

export async function runAgentLoop(
  userMessage: string,
  history: Anthropic.MessageParam[],
  activeFile: string | null,
  images: ImageInput[],
  onStatus: (msg: string) => void,
  onChunk: (text: string) => void,
  onToolActivity: (msg: string) => void,
  onConfirm: (toolName: string, info: string) => Promise<boolean>
): Promise<{ response: string; updatedHistory: Anthropic.MessageParam[] }> {
  const messages: Anthropic.MessageParam[] = [...history];

  if (images.length > 0) {
    messages.push({
      role: 'user',
      content: [
        ...images.map(img => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: img.data
          }
        })),
        { type: 'text' as const, text: userMessage }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  const system = activeFile
    ? `${SYSTEM_PROMPT}\n\nThe user currently has "${activeFile}" open in their editor.`
    : SYSTEM_PROMPT;

  let fullResponse = '';

  while (true) {
    onStatus('Thinking...');

    const stream = getClient().messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system,
      tools: toolDefinitions,
      messages
    });

    stream.on('text', (text) => {
      fullResponse += text;
      onChunk(text);
    });

    const response = await stream.finalMessage();
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      return { response: fullResponse, updatedHistory: messages };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const input = block.input as Record<string, string>;

          if (DANGEROUS_TOOLS.includes(block.name)) {
            const info = getConfirmInfo(block.name, input);
            const allowed = await onConfirm(block.name, info);
            if (!allowed) {
              onToolActivity(`🚫 Denied: ${block.name.replace(/_/g, ' ')}`);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: 'User denied this action.',
                is_error: true
              });
              continue;
            }
          }

          onToolActivity(formatToolActivity(block.name, input));

          try {
            const result = await executeTool(block.name, input, onStatus);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          } catch (err: any) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
          }
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}
