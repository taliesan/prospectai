// Source Tiering — Classify, format, and enforce tier-based source selection
// Tier 1: Subject's own voice (blogs, interviews, podcasts, social posts)
// Tier 2: Third-party with quotes or behavioral descriptions
// Tier 3: Institutional/background (team pages, bios, press releases, filings)

import { ResearchSource } from './screening';

export type SourceTier = 1 | 2 | 3;

export interface TieredSource extends ResearchSource {
  tier: SourceTier;
  tierReason: string;
}

// ── First-person pronoun density check ──────────────────────────────

function countFirstPersonPronouns(content: string, subjectName: string): number {
  // Count first-person statements that could be from the subject
  const firstPersonPatterns = /\b(I think|I believe|I've|I'm|I was|I had|I decided|I learned|I wanted|I felt|I realized|I knew|my view|my approach|my philosophy|in my experience|for me|I chose|I left|I started|I built)\b/gi;
  const matches = content.match(firstPersonPatterns);
  return matches ? matches.length : 0;
}

// ── Quote extraction helper ─────────────────────────────────────────

function hasDirectQuotesFrom(content: string, subjectName: string): boolean {
  const parts = subjectName.trim().split(/\s+/);
  const lastName = parts[parts.length - 1];

  // Check for attribution patterns near quotes
  const quotePatterns = [
    new RegExp(`${lastName}\\s+(?:said|says|told|explains|explained|noted|added|wrote|stated|argued|recalled)`, 'i'),
    new RegExp(`(?:said|says|told|explains|explained|noted|added|wrote|stated|argued|recalled)\\s+${lastName}`, 'i'),
    new RegExp(`according to\\s+(?:\\w+\\s+)?${lastName}`, 'i'),
    new RegExp(`"[^"]{10,}"[^"]*${lastName}`, 'i'),
    new RegExp(`${lastName}[^"]*"[^"]{10,}"`, 'i'),
  ];

  return quotePatterns.some(p => p.test(content));
}

// ── Escape regex helper ─────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Tier classification ─────────────────────────────────────────────

export function classifyTier(source: ResearchSource, subjectName: string): { tier: SourceTier; reason: string } {
  const content = source.content || source.snippet || '';
  const url = source.url || '';
  const title = source.title || '';

  // ── Tier 1: Subject's own voice ───────────────────────────────

  // Already flagged as blog crawl or LinkedIn post
  if (source.source === 'blog_crawl') {
    return { tier: 1, reason: 'Blog post by subject' };
  }
  if (source.source === 'linkedin_post') {
    return { tier: 1, reason: 'LinkedIn post by subject' };
  }

  // Personal blog platforms
  if (/substack\.com/i.test(url)) {
    return { tier: 1, reason: 'Substack post (personal publishing)' };
  }
  if (/medium\.com\/@/i.test(url)) {
    return { tier: 1, reason: 'Medium post (personal publishing)' };
  }

  // Authored by subject
  const namePattern = new RegExp(`by\\s+${escapeRegex(subjectName)}`, 'i');
  if (namePattern.test(title) || namePattern.test(content.slice(0, 1000))) {
    return { tier: 1, reason: 'Authored by subject' };
  }

  // LinkedIn posts
  if (/linkedin\.com\/posts\/|linkedin\.com\/pulse\//i.test(url)) {
    return { tier: 1, reason: 'LinkedIn post by subject' };
  }

  // Interview/podcast format with high first-person density
  const hasQAStructure = /^Q:|^Q\.|Interviewer:|Host:|^Q:/m.test(content);
  const firstPersonCount = countFirstPersonPronouns(content, subjectName);
  if (hasQAStructure && firstPersonCount > 10) {
    return { tier: 1, reason: 'Interview with substantial first-person content' };
  }

  // Podcasts and video interviews (substantial first-person)
  if (/youtube\.com|youtu\.be|podcast|\.mp3|spotify|apple.*podcast/i.test(url)) {
    if (firstPersonCount > 5) {
      return { tier: 1, reason: 'Podcast/video with first-person content' };
    }
  }

  // Check for "interview" in title with first-person content
  if (/\binterview\b/i.test(title) && firstPersonCount > 5) {
    return { tier: 1, reason: 'Interview with first-person content' };
  }

  // ── Tier 2: Third-party with quotes or behavioral detail ──────

  const hasQuotes = hasDirectQuotesFrom(content, subjectName);
  if (hasQuotes) {
    return { tier: 2, reason: 'Contains direct quotes from subject' };
  }

  // Behavioral description patterns
  const behavioralPatterns = /\b(decided|chose|responded|reacted|confronted|pivoted|insisted|refused|pushed for|fought for|championed|resigned|launched|built|transformed)\b/i;
  if (behavioralPatterns.test(content)) {
    const combined = `${url} ${title}`.toLowerCase();
    // In-depth profiles
    if (/profile|feature|portrait|longform|deep.?dive/i.test(combined)) {
      return { tier: 2, reason: 'In-depth profile with behavioral descriptions' };
    }
    // News with behavioral detail
    if (content.length > 2000) {
      return { tier: 2, reason: 'Substantive coverage with behavioral descriptions' };
    }
  }

  // Speeches and keynotes (third-party coverage)
  if (/\bspeech\b|\bkeynote\b|\bremarks\b|\btalk at\b/i.test(`${url} ${title}`)) {
    return { tier: 2, reason: 'Speech or keynote coverage' };
  }

  // Major publication coverage
  if (/newyorker\.com|theatlantic\.com|wired\.com|vanityfair\.com/i.test(url)) {
    return { tier: 2, reason: 'Major publication coverage' };
  }

  // ── Tier 3: Institutional/background ──────────────────────────

  const tier3Patterns: { pattern: RegExp; reason: string }[] = [
    { pattern: /\/about\/?$|\/team\/?$|\/leadership\/?$|\/board\/?$/i, reason: 'Team/about page' },
    { pattern: /\/bio\b/i, reason: 'Bio page' },
    { pattern: /\.pdf.*annual.*report|form.*990/i, reason: 'Annual report or tax filing' },
    { pattern: /press[_-]?release|news[_-]?release/i, reason: 'Press release' },
    { pattern: /wikipedia\.org/i, reason: 'Wikipedia article' },
    { pattern: /crunchbase\.com/i, reason: 'Crunchbase profile' },
    { pattern: /bloomberg\.com\/profile|forbes\.com\/profile/i, reason: 'Directory profile' },
    { pattern: /linkedin\.com\/in\//i, reason: 'LinkedIn profile page' },
  ];

  const combined = `${url} ${title}`;
  for (const { pattern, reason } of tier3Patterns) {
    if (pattern.test(combined)) {
      return { tier: 3, reason };
    }
  }

  // Short news mentions default to tier 3
  if (content.length < 1500 && !/interview|podcast|blog|personal/i.test(`${url} ${title}`)) {
    return { tier: 3, reason: 'Brief mention (short content)' };
  }

  // Default to Tier 2 if unclear
  return { tier: 2, reason: 'Third-party coverage (default)' };
}

// ── Batch tier classification ───────────────────────────────────────

export function tierSources(sources: ResearchSource[], subjectName: string): TieredSource[] {
  return sources.map(source => {
    const { tier, reason } = classifyTier(source, subjectName);
    return { ...source, tier, tierReason: reason };
  });
}

// ── Source Count Targets by Tier ────────────────────────────────────

export const TIER_TARGETS = {
  tier1: { min: 8, max: 15, label: "Subject's own voice" },
  tier2: { min: 8, max: 12, label: 'Third-party with quotes' },
  tier3: { min: 3, max: 5, label: 'Institutional/background' },
  total: { min: 20, max: 30 },
};

export function enforceTargets(sources: TieredSource[]): {
  selected: TieredSource[];
  warnings: string[];
} {
  const warnings: string[] = [];

  const byTier: Record<SourceTier, TieredSource[]> = {
    1: sources.filter(s => s.tier === 1),
    2: sources.filter(s => s.tier === 2),
    3: sources.filter(s => s.tier === 3),
  };

  // Check for shortfalls
  if (byTier[1].length < TIER_TARGETS.tier1.min) {
    warnings.push(
      `[Evidence Gap] Only ${byTier[1].length} Tier 1 sources (target: ${TIER_TARGETS.tier1.min}+). Profile may lack the subject's own voice.`
    );
  }
  if (byTier[2].length < TIER_TARGETS.tier2.min) {
    warnings.push(
      `[Evidence Gap] Only ${byTier[2].length} Tier 2 sources (target: ${TIER_TARGETS.tier2.min}+). Limited third-party behavioral evidence.`
    );
  }

  // Select up to max for each tier, prioritizing by content length (more content = more evidence)
  const sortByContentLength = (a: TieredSource, b: TieredSource) =>
    (b.content?.length || 0) - (a.content?.length || 0);

  let selected: TieredSource[] = [
    ...byTier[1].sort(sortByContentLength).slice(0, TIER_TARGETS.tier1.max),
    ...byTier[2].sort(sortByContentLength).slice(0, TIER_TARGETS.tier2.max),
    ...byTier[3].sort(sortByContentLength).slice(0, TIER_TARGETS.tier3.max),
  ];

  // Enforce total cap — drop Tier 3 first, then Tier 2
  if (selected.length > TIER_TARGETS.total.max) {
    const tier1Selected = selected.filter(s => s.tier === 1);
    const tier2Selected = selected.filter(s => s.tier === 2);
    const tier3Selected = selected.filter(s => s.tier === 3);

    let remaining = TIER_TARGETS.total.max;

    // Keep all Tier 1
    const kept1 = tier1Selected.slice(0, remaining);
    remaining -= kept1.length;

    // Then Tier 2
    const kept2 = tier2Selected.slice(0, remaining);
    remaining -= kept2.length;

    // Then Tier 3
    const kept3 = tier3Selected.slice(0, remaining);

    selected = [...kept1, ...kept2, ...kept3];
  }

  // If total is below minimum and we have more sources available, backfill
  if (selected.length < TIER_TARGETS.total.min) {
    const selectedUrls = new Set(selected.map(s => s.url));
    const unused = sources.filter(s => !selectedUrls.has(s.url));

    // Backfill from unused sources, preferring lower tiers
    for (const s of unused.sort((a, b) => a.tier - b.tier)) {
      if (selected.length >= TIER_TARGETS.total.min) break;
      selected.push(s);
    }
  }

  const finalTier1 = selected.filter(s => s.tier === 1).length;
  const finalTier2 = selected.filter(s => s.tier === 2).length;
  const finalTier3 = selected.filter(s => s.tier === 3).length;

  console.log(`[Targets] Final selection: ${finalTier1} T1, ${finalTier2} T2, ${finalTier3} T3 (total: ${selected.length})`);

  return { selected, warnings };
}

// ── Tier-aware formatting for extraction ────────────────────────────

export const TIER_PREAMBLE = `
## Source Tiering

Sources are labeled Tier 1, 2, or 3:

- **Tier 1** (Subject's own voice): Blog posts, interviews, podcasts, essays, social media posts where the subject speaks in first person. These reveal how they think, what they value, and how they make decisions. Weight heavily.

- **Tier 2** (Third-party with quotes): Press coverage, profiles, event recaps that include direct quotes or behavioral descriptions. Secondary evidence. Weight moderately.

- **Tier 3** (Institutional/background): Team pages, bios, press releases, tax filings. Confirms biographical facts but rarely contains behavioral evidence. Weight minimally.

When making behavioral inferences, prioritize Tier 1 evidence. A quote from the subject's own blog post is stronger evidence than a paraphrase in a press release.
`;

export function formatSourcesForExtraction(sources: TieredSource[]): string {
  // Sort by tier (1 first, then 2, then 3)
  const sorted = [...sources].sort((a, b) => a.tier - b.tier);

  return sorted.map((source, i) => `
---
SOURCE ${i + 1} [TIER ${source.tier}]
URL: ${source.url}
Title: ${source.title || 'Untitled'}
Tier reason: ${source.tierReason}

${source.content || source.snippet || ''}
---
`).join('\n');
}

export function formatSourcesForDossier(sources: TieredSource[]): string {
  // Sort by tier for the dossier prompt
  const sorted = [...sources].sort((a, b) => a.tier - b.tier);

  return sorted.map((s, i) =>
    `### Source ${i + 1} [TIER ${s.tier}]: ${s.title || 'Untitled'}\nURL: ${s.url}\nTier: ${s.tierReason}\nSnippet: ${s.snippet}${s.content ? `\nContent: ${s.content}` : ''}`
  ).join('\n\n');
}

// ── Tier-aware token budget truncation ──────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokenBudget(sources: TieredSource[], maxTokens: number): TieredSource[] {
  // Sort by tier (keep Tier 1 first, then 2, drop 3 first)
  const byTier = [...sources].sort((a, b) => a.tier - b.tier);

  let totalTokens = 0;
  const kept: TieredSource[] = [];

  for (const source of byTier) {
    const sourceContent = source.content || source.snippet || '';
    const sourceTokens = estimateTokens(sourceContent);

    if (totalTokens + sourceTokens <= maxTokens) {
      kept.push(source);
      totalTokens += sourceTokens;
    } else if (source.tier === 1) {
      // Always try to keep Tier 1, even if we need to truncate content
      const remainingBudget = maxTokens - totalTokens;
      if (remainingBudget > 500) { // Only worth keeping if >500 tokens
        const truncatedContent = sourceContent.slice(0, remainingBudget * 4);
        kept.push({ ...source, content: truncatedContent });
        totalTokens += estimateTokens(truncatedContent);
      }
    }
    // Skip Tier 2/3 if we're over budget
  }

  return kept;
}

// ── Evidence gap warnings for profile ───────────────────────────────

export function buildEvidenceGapBlock(warnings: string[]): string {
  if (warnings.length === 0) return '';

  return `
## Evidence Gaps

The following evidence gaps were detected during source collection:
${warnings.map(w => `- ${w}`).join('\n')}

When writing sections that would benefit from the subject's own voice, use evidence ceiling brackets to flag the limitation. For example: [Evidence ceiling: no first-person sources available for this dimension].
`;
}
