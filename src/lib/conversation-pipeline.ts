// Conversation-mode pipeline for donor profiling
// Uses a 3-turn conversation instead of a multi-stage pipeline

import { conversationTurn, Message } from './anthropic';
import { conductResearch } from './pipeline';
import { loadExemplars, loadGeoffreyCritique } from './canon/loader';

// Types (re-exported from pipeline.ts)
export interface ResearchResult {
  donorName: string;
  identity: any;
  queries: { query: string; category: string }[];
  sources: { url: string; title: string; snippet: string; content?: string }[];
  rawMarkdown: string;
}

export interface ConversationResult {
  research: ResearchResult;
  profile: string;
  draft: string;
  critique: string;
}

// Token estimation (rough: 4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Source ranking for truncation (same logic as pipeline.ts)
function rankSourceByBehavioralValue(source: { url: string; title: string; snippet: string }): number {
  const url = source.url.toLowerCase();
  const title = (source.title || '').toLowerCase();
  const snippet = (source.snippet || '').toLowerCase();
  const combined = `${url} ${title} ${snippet}`;

  // TIER 1: Video/podcast interviews, personal writing
  const tier1Patterns = [
    /youtube\.com/, /youtu\.be/, /podcast/, /\binterview\b/,
    /medium\.com/, /substack/, /\bop-ed\b/, /\bi think\b/,
    /\bmy view\b/, /\bi believe\b/, /personal\s*(essay|blog|writing)/,
  ];
  for (const pattern of tier1Patterns) {
    if (pattern.test(combined)) return 1;
  }

  // TIER 2: Speeches, talks, in-depth profiles
  const tier2Patterns = [
    /\bspeech\b/, /\bkeynote\b/, /\bremarks\b/, /\btalk at\b/,
    /\btalks at\b/, /\bprofile\b/, /\bfeature\b/, /longform/,
    /newyorker\.com/, /theatlantic\.com/, /wired\.com/, /vanityfair\.com/,
  ];
  for (const pattern of tier2Patterns) {
    if (pattern.test(combined)) return 2;
  }

  // TIER 4: Wikipedia, bio pages, LinkedIn
  const tier4Patterns = [
    /wikipedia\.org/, /linkedin\.com/, /crunchbase\.com/,
    /bloomberg\.com\/profile/, /forbes\.com\/profile/, /\/bio\b/, /\/about\b/,
  ];
  for (const pattern of tier4Patterns) {
    if (pattern.test(combined)) return 4;
  }

  // TIER 3: News coverage, press releases (default)
  return 3;
}

function rankAndSortSources(
  sources: { url: string; title: string; snippet: string; content?: string }[]
): { url: string; title: string; snippet: string; content?: string; tier: number }[] {
  const ranked = sources.map(source => ({
    ...source,
    tier: rankSourceByBehavioralValue(source)
  }));

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.content && !b.content) return -1;
    if (!a.content && b.content) return 1;
    return 0;
  });

  return ranked;
}

/**
 * Build the Turn 1 prompt: write the initial profile draft
 */
function buildTurn1Prompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  exemplars: string
): string {
  const sourcesText = sources.map((s, i) =>
    `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}${s.content ? `\nContent: ${s.content}` : ''}`
  ).join('\n\n');

  return `Here are ${sources.length} raw research sources about ${donorName}:

${sourcesText}

---

Here are exemplar profiles that represent the quality standard. Your output must match this quality:

${exemplars}

---

Write a complete 7-section donor persuasion profile for ${donorName}.

The 7 sections are:
1. Donor Identity & Background
2. Core Motivations, Values & Triggers
3. Ideal Engagement Style
4. Challenges & Risk Factors
5. Strategic Opportunities for Alignment
6. Tactical Approach to the Meeting
7. Dinner Party Test

Use ● bullets, 3-6 per section, each 2-5 sentences.
Write directly from the source material. Do not summarize first.
Every bullet must describe behavior, not traits.
Every bullet must contain conditional logic: when X, they do Y.
Surface at least one core contradiction.
Make retreat patterns explicit.`;
}

/**
 * Build the Turn 2 prompt: Geoffrey critique
 */
function buildCritiquePrompt(geoffreyExamples: string): string {
  return `You are now Geoffrey, the person who designed these donor profiles. You have exacting standards. You are reviewing the draft you just wrote.

Here are 50 examples of the kinds of corrections you make. Each shows a bad bullet and what it should become:

${geoffreyExamples}

---

Now critique the profile you just wrote for this donor. Be specific and brutal:

1. Go bullet by bullet through each section
2. For every bullet that is flat, generic, biographical, or could apply to any donor, flag it
3. For each flagged bullet, write what it SHOULD say instead - a specific rewrite
4. If any section is missing contradictions, retreat patterns, or actionable guidance, call it out
5. If any bullet uses language like "cares about", "believes in", "supports", "is passionate about" - flag it and rewrite it

Do NOT give vague feedback like "section 3 needs work." Give exact bullet-level rewrites.`;
}

/**
 * Build the Turn 3 prompt: revision
 */
function buildRevisionPrompt(): string {
  return `Now rewrite the complete profile incorporating all of your critique. Every bullet you flagged should be rewritten. Keep everything you didn't flag. Output the full 7-section profile.

Remember:
- Every bullet must describe BEHAVIOR, not traits
- Every bullet must have conditional logic (when/if/under pressure)
- No bullet could apply to a different donor (name-swap test)
- Make the dangerous truth visible
- Retreat patterns must be explicit`;
}

/**
 * Main conversation pipeline
 */
export async function runConversationPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  onProgress: (message: string, stage?: string) => void
): Promise<ConversationResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  // Step 1: Research (reuse existing)
  onProgress('Starting research...', 'research');
  const research = await conductResearch(donorName, seedUrls, searchFunction);
  onProgress(`✓ Research complete: ${research.sources.length} sources`, 'research');
  console.log(`[Conversation] Research complete: ${research.sources.length} sources`);

  // Step 2: Load canon documents
  const exemplars = loadExemplars();
  const geoffreyExamples = loadGeoffreyCritique();
  console.log(`[Conversation] Loaded exemplars (${exemplars.length} chars) and Geoffrey critique (${geoffreyExamples.length} chars)`);

  // Step 3: Prepare sources with token budget management
  const rankedSources = rankAndSortSources(research.sources);

  // Build initial prompt to estimate tokens
  let turn1Prompt = buildTurn1Prompt(donorName, rankedSources, exemplars);
  let estimatedTokens = estimateTokens(turn1Prompt);
  const MAX_TOKENS = 180000;

  console.log(`[Conversation] Initial token estimate: ${estimatedTokens} (max: ${MAX_TOKENS})`);

  // Truncate sources if needed
  let sourcesToUse = rankedSources;
  if (estimatedTokens > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources...`);

    // Progressively remove sources until under budget
    while (estimatedTokens > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      turn1Prompt = buildTurn1Prompt(donorName, sourcesToUse, exemplars);
      estimatedTokens = estimateTokens(turn1Prompt);
    }

    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${estimatedTokens} tokens`);
    onProgress(`Using top ${sourcesToUse.length} sources (token budget)`, 'research');
  }

  // Initialize conversation
  const messages: Message[] = [];

  // Turn 1: Write the profile
  onProgress('Generating profile from raw sources...', 'profile');
  console.log('[Conversation] Turn 1: Writing initial draft...');

  messages.push({ role: 'user', content: turn1Prompt });
  const draft = await conversationTurn(messages, { maxTokens: 16000 });
  messages.push({ role: 'assistant', content: draft });

  onProgress('✓ First draft complete', 'profile');
  console.log(`[Conversation] Turn 1 complete: ${draft.length} chars`);

  // Turn 2: Geoffrey critique
  onProgress('Geoffrey reviewing draft...', 'critique');
  console.log('[Conversation] Turn 2: Geoffrey critique...');

  const critiquePrompt = buildCritiquePrompt(geoffreyExamples);
  messages.push({ role: 'user', content: critiquePrompt });
  const critique = await conversationTurn(messages, { maxTokens: 8000 });
  messages.push({ role: 'assistant', content: critique });

  onProgress('✓ Critique complete', 'critique');
  console.log(`[Conversation] Turn 2 complete: ${critique.length} chars`);

  // Turn 3: Revise
  onProgress('Revising profile based on critique...', 'revision');
  console.log('[Conversation] Turn 3: Revising...');

  const revisionPrompt = buildRevisionPrompt();
  messages.push({ role: 'user', content: revisionPrompt });
  const finalProfile = await conversationTurn(messages, { maxTokens: 16000 });

  onProgress('✓ Final profile complete', 'revision');
  console.log(`[Conversation] Turn 3 complete: ${finalProfile.length} chars`);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    profile: finalProfile,
    draft,
    critique
  };
}
