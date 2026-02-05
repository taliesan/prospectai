// Conversation-mode pipeline for donor profiling
// Single API call: Geoffrey Block + exemplars + sources → profile

import { conversationTurn, Message } from './anthropic';
import { conductResearch } from './pipeline';
import { loadExemplars, loadGeoffreyBlock } from './canon/loader';

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
 * Build the prompt with Geoffrey Block first, then exemplars, then sources.
 * Context window order:
 * 1. Geoffrey Block (voice and standards)
 * 2. Exemplar profiles (target quality)
 * 3. Research sources (raw material)
 * 4. One closing sentence
 */
function buildPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  geoffreyBlock: string,
  exemplars: string
): string {
  const sourcesText = sources.map((s, i) =>
    `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}${s.content ? `\nContent: ${s.content}` : ''}`
  ).join('\n\n');

  return `${geoffreyBlock}

---

${exemplars}

---

Here are ${sources.length} raw research sources about ${donorName}:

${sourcesText}

---

Write a complete 7-section donor persuasion profile for ${donorName} at the quality level of the exemplars above.`;
}

/**
 * Main conversation pipeline - single API call
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
  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();
  console.log(`[Conversation] Loaded Geoffrey Block (${geoffreyBlock.length} chars) and exemplars (${exemplars.length} chars)`);

  // Step 3: Prepare sources with token budget management
  const rankedSources = rankAndSortSources(research.sources);

  // Build prompt to estimate tokens
  let prompt = buildPrompt(donorName, rankedSources, geoffreyBlock, exemplars);
  let estimatedTokens = estimateTokens(prompt);
  const MAX_TOKENS = 180000;

  console.log(`[Conversation] Initial token estimate: ${estimatedTokens} (max: ${MAX_TOKENS})`);

  // Truncate sources if needed
  let sourcesToUse = rankedSources;
  if (estimatedTokens > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources...`);

    // Progressively remove sources until under budget
    while (estimatedTokens > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      prompt = buildPrompt(donorName, sourcesToUse, geoffreyBlock, exemplars);
      estimatedTokens = estimateTokens(prompt);
    }

    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${estimatedTokens} tokens`);
    onProgress(`Using top ${sourcesToUse.length} sources (token budget)`, 'research');
  }

  // Single API call
  onProgress('Generating profile...', 'profile');
  console.log('[Conversation] Generating profile...');

  const messages: Message[] = [{ role: 'user', content: prompt }];
  const profile = await conversationTurn(messages, { maxTokens: 16000 });

  onProgress('✓ Profile complete', 'profile');
  console.log(`[Conversation] Profile complete: ${profile.length} chars`);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    profile,
    draft: profile,
    critique: ''
  };
}
