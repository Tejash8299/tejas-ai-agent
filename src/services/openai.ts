import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool } from '../tools';

const SYSTEM_PROMPT = `You are Tejas AI Agent, a powerful coding assistant running inside VS Code.
You have tools to read, write, search, list files, and run shell commands in the user's workspace.
When the user asks you to do something with their code, use your tools to actually do it.
Be concise. After completing a task, briefly summarize what you did.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function runAgentLoop(
  userMessage: string,
  history: Anthropic.MessageParam[],
  activeFile: string | null,
  onStatus: (msg: string) => void,
  onChunk: (text: string) => void
): Promise<{ response: string; updatedHistory: Anthropic.MessageParam[] }> {
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage }
  ];

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
          onStatus(`${block.name}: ${JSON.stringify(block.input).slice(0, 60)}...`);
          try {
            const result = await executeTool(
              block.name,
              block.input as Record<string, string>,
              onStatus
            );
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
