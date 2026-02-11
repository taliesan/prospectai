/**
 * Research Agent — Agentic loop that replaces the entire research-through-extraction pipeline.
 *
 * Sends a system prompt + research brief to Claude Opus with web_search and fetch_page tools.
 * The agent reads, reasons, searches, and produces the 24-dimension behavioral evidence
 * extraction directly. When it responds with text (not a tool call), that text is the
 * research package.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LinkedInData } from '../prompts/extraction-prompt';
import { RESEARCH_AGENT_SYSTEM_PROMPT, buildResearchBrief } from '../prompts/research-agent-prompt';
import { RESEARCH_TOOLS, executeWebSearch, executeFetchPage } from './tools';

const anthropic = new Anthropic();

// ── Types ───────────────────────────────────────────────────────────

export interface ResearchAgentResult {
  researchPackage: string;
  toolCallCount: number;
  searchCount: number;
  fetchCount: number;
  conversationLog: any[];  // Full message history for debug output
}

type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Agent loop ──────────────────────────────────────────────────────

export async function runResearchAgent(
  linkedinData: LinkedInData | null,
  subjectName: string,
  onProgress?: ProgressCallback,
): Promise<ResearchAgentResult> {
  const emit = onProgress || (() => {});
  const TOTAL_STEPS = 38;

  console.log(`[Research Agent] Starting for: ${subjectName}`);
  emit('Research agent starting...', 'research', 3, TOTAL_STEPS);

  const brief = buildResearchBrief(linkedinData, subjectName);

  // Build message history — system prompt is separate, user message starts the conversation
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: brief },
  ];

  let toolCallCount = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let loopCount = 0;

  // Safety limit — prevent infinite loops
  const MAX_LOOPS = 100;

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    // Periodic progress updates
    if (loopCount % 3 === 0) {
      emit(
        `Research agent: ${searchCount} searches, ${fetchCount} pages read...`,
        'research',
        Math.min(3 + Math.floor(loopCount / 3), 14),
        TOTAL_STEPS,
      );
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 16000,
      system: RESEARCH_AGENT_SYSTEM_PROMPT,
      tools: RESEARCH_TOOLS as any,
      messages,
    });

    // Check if we're done — text response with end_turn means the agent is finished
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(
        (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
      );

      const researchPackage = textBlock?.text || '';

      console.log(`[Research Agent] Complete: ${loopCount} loops, ${toolCallCount} tool calls (${searchCount} searches, ${fetchCount} fetches)`);
      console.log(`[Research Agent] Research package: ${researchPackage.length} chars`);

      emit(
        `Research complete: ${searchCount} searches, ${fetchCount} pages read`,
        'research',
        15,
        TOTAL_STEPS,
      );

      return {
        researchPackage,
        toolCallCount,
        searchCount,
        fetchCount,
        conversationLog: messages,
      };
    }

    // Execute tool calls
    const toolUseBlocks = response.content.filter(
      (c: any): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls and not end_turn — extract any text and return
      const textBlock = response.content.find(
        (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
      );
      if (textBlock) {
        console.log(`[Research Agent] Stopped without end_turn, using text response`);
        return {
          researchPackage: textBlock.text,
          toolCallCount,
          searchCount,
          fetchCount,
          conversationLog: messages,
        };
      }
      // No text and no tools — something went wrong
      console.error('[Research Agent] No text and no tool calls in response');
      break;
    }

    // Execute each tool call and collect results
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      toolCallCount++;
      const input = toolUse.input as any;

      if (toolUse.name === 'web_search') {
        searchCount++;
        try {
          const results = await executeWebSearch(input.query);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(results),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      } else if (toolUse.name === 'fetch_page') {
        fetchCount++;
        try {
          const content = await executeFetchPage(input.url);
          // Truncate very long pages to avoid context window pressure
          const maxChars = 40000;
          const truncated =
            content.length > maxChars
              ? content.slice(0, maxChars) + '\n\n[Content truncated — page was very long]'
              : content;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: truncated,
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Unknown tool: ${toolUse.name}`,
          is_error: true,
        });
      }
    }

    // Append assistant response + tool results to conversation
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    console.log(
      `[Research Agent] Loop ${loopCount}: ${toolUseBlocks.length} tool calls (total: ${searchCount} searches, ${fetchCount} fetches)`,
    );
  }

  // If we hit the loop limit, return whatever we have
  console.warn(`[Research Agent] Hit max loop limit (${MAX_LOOPS})`);
  emit('Research agent reached iteration limit', 'research', 15, TOTAL_STEPS);

  return {
    researchPackage: `[Research agent reached ${MAX_LOOPS} iteration limit. Partial results may be available in the conversation log.]`,
    toolCallCount,
    searchCount,
    fetchCount,
    conversationLog: messages,
  };
}
