import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool } from '../tools';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const SYSTEM_PROMPT = `You are Tejas AI Agent, a powerful coding assistant running inside VS Code.
You have tools to read, write, search, and list files in the user's open workspace.
When the user asks you to do something with their code, use your tools to actually do it — don't just describe what to do.
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
  onStatus: (msg: string) => void
): Promise<{ response: string; updatedHistory: Anthropic.MessageParam[] }> {
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  while (true) {
    onStatus('Thinking...');

    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return {
        response: textBlock?.text ?? '',
        updatedHistory: messages
      };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          onStatus(`Using tool: ${block.name}...`);
          try {
            const result = await executeTool(
              block.name,
              block.input as Record<string, string>,
              onStatus
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result
            });
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${err.message}`,
              is_error: true
            });
          }
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}
