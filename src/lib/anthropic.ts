import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
// API key should be set in environment variable ANTHROPIC_API_KEY
const anthropic = new Anthropic();

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export async function complete(
  systemPrompt: string,
  userPrompt: string,
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
    messages: [
      { role: 'user', content: userPrompt }
    ],
    temperature,
  });

  // Extract text from response
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in response');
  }
  
  return textContent.text;
}

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

// For longer generation tasks
export async function completeExtended(
  systemPrompt: string,
  userPrompt: string,
  options: {
    maxTokens?: number;
  } = {}
): Promise<string> {
  const {
    maxTokens = 16000,
  } = options;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt }
    ],
  });

  // Extract text from response
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in response');
  }

  return textContent.text;
}

/**
 * Multi-turn conversation for the conversation-mode pipeline.
 * Uses a minimal system prompt - the Geoffrey Block handles voice and standards.
 */
export async function conversationTurn(
  messages: Message[],
  options: {
    maxTokens?: number;
    abortSignal?: AbortSignal;
  } = {}
): Promise<string> {
  const {
    maxTokens = 16000,
    abortSignal,
  } = options;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: 'You are writing a donor persuasion profile.',
    messages: messages.map(m => ({
      role: m.role,
      content: m.content
    })),
  }, abortSignal ? { signal: abortSignal } : undefined);

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in response');
  }

  return textContent.text;
}

export default anthropic;
