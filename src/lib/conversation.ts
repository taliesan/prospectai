// Multi-turn conversation manager for V5 conversation mode.
// Manages accumulated message history and streams responses via Claude Opus.

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export interface TurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  turns: { label: string; inputTokens: number; outputTokens: number }[];
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class ConversationManager {
  private systemPrompt: string;
  private messages: ConversationMessage[] = [];
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, turns: [] };

  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  /**
   * Execute a conversation turn: add user message, call Opus, stream response,
   * add assistant response to history, return result.
   */
  async turn(
    userMessage: string,
    turnLabel: string,
    streamCallback?: (text: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<TurnResult> {
    // Add user message to history
    this.messages.push({ role: 'user', content: userMessage });

    try {
      const stream = anthropic.messages.stream(
        {
          model: 'claude-opus-4-20250514',
          max_tokens: 16000,
          system: this.systemPrompt,
          messages: this.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        },
        abortSignal ? { signal: abortSignal } : undefined,
      );

      // Accumulate response text from stream
      let responseText = '';
      stream.on('text', (text) => {
        responseText += text;
        if (streamCallback) {
          streamCallback(text);
        }
      });

      const finalMessage = await stream.finalMessage();

      // Extract all text blocks from response (skip tool_use blocks)
      const textBlocks = finalMessage.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text);
      const fullText = textBlocks.join('\n');

      // Use the concatenated text blocks as the canonical response
      const assistantText = fullText || responseText;

      // Track token usage
      const inputTokens = finalMessage.usage.input_tokens;
      const outputTokens = finalMessage.usage.output_tokens;
      this.usage.inputTokens += inputTokens;
      this.usage.outputTokens += outputTokens;
      this.usage.turns.push({ label: turnLabel, inputTokens, outputTokens });

      // Add assistant response to message history
      this.messages.push({ role: 'assistant', content: assistantText });

      return { text: assistantText, inputTokens, outputTokens };
    } catch (error) {
      // On error, remove the failed user message
      this.messages.pop();
      throw error;
    }
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  getMessageCount(): number {
    return this.messages.length;
  }
}
