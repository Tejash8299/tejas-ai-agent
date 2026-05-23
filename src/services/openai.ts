import Anthropic from '@anthropic-ai/sdk';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function askAI(messages: Message[]): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages
  });

  const block = response.content[0];
  if (block.type === 'text') {
    return block.text;
  }
  return '';
}
