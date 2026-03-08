// ARCHIVED: Legacy anthropic helper removed from anthropic.ts
// Date: February 2026
// Reason: Not called by any active code path per system audit
// Original location: anthropic.ts ~line 46

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export type Message = { role: 'user' | 'assistant'; content: string };

export async function completeWithHistory(
  systemPrompt: string,
  messages: Message[],
  options: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  } = {}
): Promise<string> {
  const {
    maxTokens = 8192,
    temperature = 0.7,
    model = 'claude-sonnet-4-20250514'
  } = options;

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content
    })),
    temperature,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in response');
  }

  return textContent.text;
}
