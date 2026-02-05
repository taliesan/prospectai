// Conversation-mode pipeline for donor profiling
// Two-step architecture: sources → dossier → profile
// Both steps governed by the Geoffrey Block

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
  dossier: string;
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

// Dossier prompt - embedded here as specified
const DOSSIER_PROMPT = `You are writing a long-form behavioral dossier for donor profiling.

REGISTER RULES (non-negotiable):
- Write from inside the subject's behavioral logic, not about it from outside.
- Biography becomes behavioral force: not "she co-founded Recode" but "she exits institutions before they soften her edge."
- Traits become pressure-read results: not "she's direct" but "she tests for posture misalignment in the first 10 minutes."
- Values become posture in the room: not "she appreciates dialogue" but "she'll say 'interesting' and never take the meeting again."
- Psychological interpretation becomes pattern exposure: not "she gets frustrated" but "when someone uses her platform without matching her literacy, she switches to interview mode and doesn't come back."
- Every claim must be grounded in specific evidence from the sources — quotes, decisions, actions, patterns across appearances.

Use these 17 behavioral dimensions as your analytical lens (not as output structure — write prose, not fields):

1. Decision-Making Patterns
2. Trust Calibration
3. Influence Susceptibility
4. Communication Style
5. Learning Style
6. Time Orientation
7. Identity & Self-Concept
8. Values Hierarchy
9. Status & Recognition
10. Boundary Conditions
11. Emotional Triggers
12. Relationship Patterns
13. Risk Tolerance
14. Resource Philosophy
15. Commitment Patterns
16. Knowledge Areas
17. Contradiction Patterns — MOST IMPORTANT. Contradictions reveal where persuasion has maximum leverage.

OUTPUT: Long-form behavioral prose. Not structured data. Not bullet points. Organize by behavioral theme, not by source. Cross-reference across sources. Surface every signal, every quote, every contradiction, every conspicuous silence. Be expansive — more is more. The profile step handles compression. The dossier step handles coverage and voice.`;

/**
 * Build Step 1 prompt: Geoffrey Block + sources + dossier instruction
 */
function buildDossierPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  geoffreyBlock: string
): string {
  const sourcesText = sources.map((s, i) =>
    `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}${s.content ? `\nContent: ${s.content}` : ''}`
  ).join('\n\n');

  return `${geoffreyBlock}

---

Here are ${sources.length} research sources about ${donorName}:

${sourcesText}

---

${DOSSIER_PROMPT}

Write a comprehensive behavioral dossier for ${donorName}.`;
}

/**
 * Build Step 2 prompt: Geoffrey Block + exemplars + dossier + instruction
 */
function buildProfilePrompt(
  donorName: string,
  dossier: string,
  geoffreyBlock: string,
  exemplars: string
): string {
  return `${geoffreyBlock}

---

${exemplars}

---

Here is the behavioral dossier for ${donorName}:

${dossier}

---

Write a complete 7-section donor persuasion profile for ${donorName}. Compress the dossier into the profile format demonstrated by the exemplars. Every sentence must pass the register rules in the Geoffrey Block. Every section must be load-bearing.`;
}

/**
 * Main conversation pipeline - two-step architecture
 * Step 1: sources → dossier
 * Step 2: dossier → profile
 */
export async function runConversationPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  onProgress: (message: string, stage?: string) => void
): Promise<ConversationResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE (Two-Step): Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  // Step 1: Research (reuse existing)
  onProgress('Starting research...', 'research');
  const research = await conductResearch(donorName, seedUrls, searchFunction);
  onProgress(`✓ Research complete: ${research.sources.length} sources`, 'research');
  console.log(`[Conversation] Research complete: ${research.sources.length} sources`);

  // Load canon documents
  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();
  console.log(`[Conversation] Loaded Geoffrey Block (${geoffreyBlock.length} chars) and exemplars (${exemplars.length} chars)`);

  // Prepare sources with token budget management for Step 1
  const rankedSources = rankAndSortSources(research.sources);
  const MAX_TOKENS = 180000;

  // Build dossier prompt to estimate tokens
  let dossierPrompt = buildDossierPrompt(donorName, rankedSources, geoffreyBlock);
  let estimatedTokens = estimateTokens(dossierPrompt);

  console.log(`[Conversation] Dossier prompt token estimate: ${estimatedTokens} (max: ${MAX_TOKENS})`);

  // Truncate sources if needed
  let sourcesToUse = rankedSources;
  if (estimatedTokens > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources...`);

    // Progressively remove sources until under budget
    while (estimatedTokens > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      dossierPrompt = buildDossierPrompt(donorName, sourcesToUse, geoffreyBlock);
      estimatedTokens = estimateTokens(dossierPrompt);
    }

    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${estimatedTokens} tokens`);
    onProgress(`Using top ${sourcesToUse.length} sources (token budget)`, 'research');
  }

  // Step 2: Generate dossier (sources → behavioral prose)
  onProgress('Writing behavioral dossier...', 'dossier');
  console.log('[Conversation] Step 1: Generating dossier...');

  const dossierMessages: Message[] = [{ role: 'user', content: dossierPrompt }];
  const dossier = await conversationTurn(dossierMessages, { maxTokens: 16000 });

  onProgress(`✓ Dossier complete: ${dossier.length} chars`, 'dossier');
  console.log(`[Conversation] Dossier complete: ${dossier.length} chars`);

  // Step 3: Generate profile (dossier → 7-section profile)
  onProgress('Generating profile...', 'profile');
  console.log('[Conversation] Step 2: Generating profile from dossier...');

  const profilePrompt = buildProfilePrompt(donorName, dossier, geoffreyBlock, exemplars);
  const profileTokenEstimate = estimateTokens(profilePrompt);
  console.log(`[Conversation] Profile prompt token estimate: ${profileTokenEstimate}`);

  const profileMessages: Message[] = [{ role: 'user', content: profilePrompt }];
  const profile = await conversationTurn(profileMessages, { maxTokens: 16000 });

  onProgress('✓ Profile complete', 'profile');
  console.log(`[Conversation] Profile complete: ${profile.length} chars`);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE (Two-Step): Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    profile,
    dossier,
    draft: dossier,  // For backward compatibility, draft = dossier
    critique: ''     // No critique in two-step architecture
  };
}
