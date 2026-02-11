/**
 * Phased Research Agent — Three sequential agentic sessions.
 *
 * Phase 1: Own Voice — find everything the subject has written or said
 * Phase 2: Pressure & Context — find external evidence, transitions, peer accounts
 * Phase 3: Extraction & Gap-Fill — read all sources, extract 24-dim evidence, fill gaps
 *
 * Each phase is a separate API conversation with its own system prompt.
 * The same agent loop runner handles all three.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LinkedInData } from '../prompts/extraction-prompt';
import { PHASE_3_SYSTEM_PROMPT, buildResearchBrief } from '../prompts/research-agent-prompt';
import { PHASE_1_SYSTEM_PROMPT } from '../prompts/phase-1-prompt';
import { PHASE_2_SYSTEM_PROMPT } from '../prompts/phase-2-prompt';
import { RESEARCH_TOOLS, executeWebSearch, executeFetchPage } from './tools';

const anthropic = new Anthropic();

// ── Types ───────────────────────────────────────────────────────────

export interface AgentSessionResult {
  output: string;
  toolCallCount: number;
  searchCount: number;
  fetchCount: number;
  conversationLog: any[];
}

export interface PhasedResearchResult {
  researchPackage: string;
  phase1Sources: string;
  phase2Sources: string;
  phase1: AgentSessionResult;
  phase2: AgentSessionResult;
  phase3: AgentSessionResult;
  totalSearchCount: number;
  totalFetchCount: number;
  totalToolCallCount: number;
}

// Backward-compatible type alias
export interface ResearchAgentResult {
  researchPackage: string;
  toolCallCount: number;
  searchCount: number;
  fetchCount: number;
  conversationLog: any[];
}

type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Generic Agent Session Runner ────────────────────────────────────

const MAX_LOOPS = 100;

async function runAgentSession(
  systemPrompt: string,
  userMessage: string,
  onProgress?: (loopCount: number, searchCount: number, fetchCount: number) => void,
  model: string = 'claude-opus-4-20250514',
): Promise<AgentSessionResult> {
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let toolCallCount = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let loopCount = 0;

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    if (onProgress && loopCount % 3 === 0) {
      onProgress(loopCount, searchCount, fetchCount);
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      tools: RESEARCH_TOOLS as any,
      messages,
    });

    // Done — text response with end_turn
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(
        (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
      );
      return {
        output: textBlock?.text || '',
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
      const textBlock = response.content.find(
        (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
      );
      if (textBlock) {
        return {
          output: textBlock.text,
          toolCallCount,
          searchCount,
          fetchCount,
          conversationLog: messages,
        };
      }
      break;
    }

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

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // Hit loop limit
  return {
    output: `[Agent reached ${MAX_LOOPS} iteration limit. Partial results may be available in the conversation log.]`,
    toolCallCount,
    searchCount,
    fetchCount,
    conversationLog: messages,
  };
}

// ── Phased Research Orchestration ───────────────────────────────────

export async function runPhasedResearch(
  linkedinData: LinkedInData | null,
  subjectName: string,
  onProgress?: ProgressCallback,
): Promise<PhasedResearchResult> {
  const emit = onProgress || (() => {});
  const TOTAL_STEPS = 38;

  console.log(`[Research] Starting phased research for: ${subjectName}`);
  emit('Research starting — Phase 1: discovering subject\'s own voice...', 'research', 3, TOTAL_STEPS);

  const briefBase = buildResearchBrief(linkedinData, subjectName);

  // ── Phase 1: Own Voice (Sonnet — source discovery, not extraction) ─
  console.log(`[Research] Phase 1: Own Voice (Sonnet)`);

  const phase1 = await runAgentSession(
    PHASE_1_SYSTEM_PROMPT,
    briefBase + '\n\nBegin your research.',
    (loop, searches, fetches) => {
      emit(
        `Phase 1 (own voice): ${searches} searches, ${fetches} pages...`,
        'research',
        Math.min(3 + Math.floor(loop / 3), 7),
        TOTAL_STEPS,
      );
    },
    'claude-sonnet-4-20250514',
  );

  console.log(`[Research] Phase 1 complete: ${phase1.searchCount} searches, ${phase1.fetchCount} fetches, ${phase1.output.length} chars`);
  emit(
    `Phase 1 complete — ${phase1.searchCount} searches, ${phase1.fetchCount} pages. Starting Phase 2...`,
    'research', 8, TOTAL_STEPS,
  );

  // ── Phase 2: Pressure & Context (Sonnet — source discovery) ────
  console.log(`[Research] Phase 2: Pressure & Context (Sonnet)`);

  const phase2 = await runAgentSession(
    PHASE_2_SYSTEM_PROMPT,
    briefBase +
      '\n\n## Sources Already Found (Phase 1)\n\n' + phase1.output +
      '\n\nBegin your research.',
    (loop, searches, fetches) => {
      emit(
        `Phase 2 (external evidence): ${searches} searches, ${fetches} pages...`,
        'research',
        Math.min(8 + Math.floor(loop / 3), 11),
        TOTAL_STEPS,
      );
    },
    'claude-sonnet-4-20250514',
  );

  console.log(`[Research] Phase 2 complete: ${phase2.searchCount} searches, ${phase2.fetchCount} fetches, ${phase2.output.length} chars`);
  emit(
    `Phase 2 complete — ${phase2.searchCount} searches, ${phase2.fetchCount} pages. Starting Phase 3...`,
    'research', 12, TOTAL_STEPS,
  );

  // ── Phase 3: Extraction & Gap-Fill (Opus — behavioral judgment) ─
  console.log(`[Research] Phase 3: Extraction & Gap-Fill (Opus)`);

  const phase3 = await runAgentSession(
    PHASE_3_SYSTEM_PROMPT,
    briefBase +
      '\n\n## Sources Found (Phase 1 — Subject\'s Own Voice)\n\n' + phase1.output +
      '\n\n## Sources Found (Phase 2 — External Evidence)\n\n' + phase2.output +
      '\n\nBegin your extraction.',
    (loop, searches, fetches) => {
      emit(
        `Phase 3 (extraction): reading sources, ${searches} gap-fill searches...`,
        'research',
        Math.min(12 + Math.floor(loop / 3), 14),
        TOTAL_STEPS,
      );
    },
    'claude-opus-4-20250514',
  );

  const totalSearches = phase1.searchCount + phase2.searchCount + phase3.searchCount;
  const totalFetches = phase1.fetchCount + phase2.fetchCount + phase3.fetchCount;
  const totalTools = phase1.toolCallCount + phase2.toolCallCount + phase3.toolCallCount;

  console.log(`[Research] Phase 3 complete: ${phase3.searchCount} searches, ${phase3.fetchCount} fetches`);
  console.log(`[Research] All phases complete: ${totalSearches} total searches, ${totalFetches} total fetches, ${totalTools} total tool calls`);
  console.log(`[Research] Research package: ${phase3.output.length} chars`);

  emit(
    `Research complete — ${totalSearches} searches, ${totalFetches} pages across 3 phases`,
    'research', 15, TOTAL_STEPS,
  );

  return {
    researchPackage: phase3.output,
    phase1Sources: phase1.output,
    phase2Sources: phase2.output,
    phase1,
    phase2,
    phase3,
    totalSearchCount: totalSearches,
    totalFetchCount: totalFetches,
    totalToolCallCount: totalTools,
  };
}

// ── Backward-compatible wrapper ─────────────────────────────────────

/**
 * @deprecated Use runPhasedResearch() instead. This wrapper exists for
 * backward compatibility during migration.
 */
export async function runResearchAgent(
  linkedinData: LinkedInData | null,
  subjectName: string,
  onProgress?: ProgressCallback,
): Promise<ResearchAgentResult> {
  const result = await runPhasedResearch(linkedinData, subjectName, onProgress);
  return {
    researchPackage: result.researchPackage,
    toolCallCount: result.totalToolCallCount,
    searchCount: result.totalSearchCount,
    fetchCount: result.totalFetchCount,
    conversationLog: result.phase3.conversationLog,
  };
}
