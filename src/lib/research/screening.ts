// Stage 3 — Screening & Attribution Filter (v5 Pipeline)
//
// Two-pass filter on Tavily results:
//   Pass 1: Person disambiguation (is this the right person?)
//   Pass 2: Attribution classification (is the content attributable?)
//
// Input:  50-150 URLs with snippets from Stage 2
// Output: 40-60 surviving URLs with attribution tags

import { complete } from '../anthropic';
import type { AttributionType, KillReason } from '../dimensions';

// ── Source type used across the pipeline ─────────────────────────────

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  query?: string;
  queryCategory?: 'A' | 'B' | 'C';
  queryHypothesis?: string;
  targetDimensions?: number[];
  source?: string; // provenance tag: 'blog_crawl', 'linkedin_post', 'tavily', 'user_supplied'
  bypassScreening?: boolean;
  // v5 attribution fields (set by Stage 3)
  attribution?: AttributionType;
  institutionalContext?: string; // e.g. "VP Engagement, Mozilla Foundation, 2012-2016"
}

export interface ScreeningResult {
  survivingUrls: ResearchSource[];
  killedUrls: Array<{
    url: string;
    killReason: string;
    pass: 1 | 2;
  }>;
  stats: ScreeningStats;
}

export interface ScreeningStats {
  totalReceived: number;
  pass1Killed: number;
  pass2Killed: number;
  autoRejected: number;
  surviving: number;
}

// ── Junk URL patterns (auto-reject, no LLM needed) ─────────────────

const JUNK_URL_PATTERNS = [
  /whitepages\.com/i,
  /spokeo\.com/i,
  /beenverified\.com/i,
  /fastpeoplesearch/i,
  /zoominfo\.com\/p\//i,
  /linkedin\.com\/pub\/dir/i,
  /signalhire\.com/i,
  /rocketreach\.co/i,
  /contactout\.com/i,
  /lusha\.com/i,
  /apollo\.io\/contacts/i,
  /peoplefinders\.com/i,
  /intelius\.com/i,
  /truepeoplesearch\.com/i,
  /thatsthem\.com/i,
  /radaris\.com/i,
  /pipl\.com/i,
  /instantcheckmate\.com/i,
];

// ── Name variant generation ─────────────────────────────────────────

function getNameVariants(subjectName: string): string[] {
  const variants: string[] = [subjectName];
  const parts = subjectName.trim().split(/\s+/);

  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];

    variants.push(`${first[0]}. ${last}`);
    variants.push(`${last}, ${first}`);

    if (parts.length >= 3) {
      variants.push(`${first} ${last}`);
      const middleInitials = parts.slice(1, -1).map(p => `${p[0]}.`).join('');
      variants.push(`${first[0]}.${middleInitials} ${last}`);
    }
  }

  return variants;
}

// ── Automatic pre-filter (no LLM) ──────────────────────────────────

function automaticPreFilter(
  sources: ResearchSource[],
  subjectName: string,
): { passed: ResearchSource[]; killed: Array<{ url: string; killReason: string; pass: 1 | 2 }> } {
  const passed: ResearchSource[] = [];
  const killed: Array<{ url: string; killReason: string; pass: 1 | 2 }> = [];

  for (const source of sources) {
    // Sources that bypass screening (blog crawl, user-supplied, etc.)
    if (source.bypassScreening) {
      passed.push(source);
      continue;
    }

    // Junk URL patterns
    if (JUNK_URL_PATTERNS.some(p => p.test(source.url))) {
      killed.push({ url: source.url, killReason: 'directory_listing — people-search/directory page', pass: 2 });
      continue;
    }

    // Category B queries (institutional) don't need name check
    if (source.queryCategory === 'B') {
      passed.push(source);
      continue;
    }

    // Name check for non-institutional queries
    const nameVariants = getNameVariants(subjectName);
    const searchText = `${source.snippet || ''} ${source.title || ''}`.toLowerCase();
    const hasName = nameVariants.some(v => searchText.includes(v.toLowerCase()));
    if (!hasName) {
      killed.push({ url: source.url, killReason: 'wrong_person — subject name not found in snippet/title', pass: 1 });
      continue;
    }

    passed.push(source);
  }

  return { passed, killed };
}

// ── Build the Stage 3 screening prompt ──────────────────────────────

function buildScreeningPrompt(
  sources: ResearchSource[],
  subjectName: string,
  linkedinReference: string,
): string {
  return `You are a research screener evaluating search results for a behavioral profiling system. You will receive a list of URLs with titles and snippets from a Tavily search. Your job is to filter by person and classify by attribution type.

SUBJECT: ${subjectName}
LINKEDIN REFERENCE: ${linkedinReference}

## URLs to Screen
${sources.map((s, i) => `[${i}] URL: ${s.url}
Title: ${s.title || 'Untitled'}
Snippet: ${s.snippet.slice(0, 400)}
Query Category: ${s.queryCategory || 'A'}
`).join('\n')}

## Two-Pass Filter

### Pass 1 — Person Disambiguation
Is this about ${subjectName}? Check against LinkedIn data.
- Right name + right organization = KEEP
- Right name + wrong context but plausibly same person = KEEP with flag
- Different person entirely = KILL
- Ambiguous = KILL unless strong signal

### Pass 2 — Attribution Filter
Classify each surviving URL:

KEEP categories:
- "target_authored" — Subject wrote this (byline matches, their blog, their LinkedIn post with original text)
- "target_coverage" — Third party wrote about the subject (profile, interview, press mention with quotes or described actions)
- "institutional_inference" — Describes what an organization did during the subject's tenure, within their area of responsibility. Subject need not be named. Tag with the LinkedIn role that makes this relevant.
- "target_reshare" — Subject reshared someone else's content with 2+ sentences of their own original commentary

KILL categories:
- "passive_interaction" — Subject merely liked, reacted to, or reshared without substantive commentary
- "directory_listing" — Staff page or board list with no behavioral content
- "wrong_attribution" — Content written by someone else that appears in results because subject interacted with it

KILL signals in snippets:
- "Liked by [subject name]"
- "Reposted by [subject name]"
- Subject name only in tagged/mentioned context
- LinkedIn activity URL where post body is by someone else
- Org page where subject appears only in a list

For institutional_inference, verify:
- The action falls within the subject's area of responsibility (per LinkedIn role title)
- The action occurred during the subject's tenure dates
- Tag: "Institutional inference: [Role] at [Org], [dates]"

## Output Format

Return JSON:
{
  "results": [
    {
      "index": 0,
      "decision": "KEEP",
      "attribution": "target_authored",
      "notes": "Op-ed by subject on digital privacy"
    },
    {
      "index": 1,
      "decision": "KEEP",
      "attribution": "institutional_inference",
      "institutional_context": "VP Engagement, Mozilla Foundation, 2012-2016",
      "notes": "Mozilla advocacy campaign during subject's tenure"
    },
    {
      "index": 2,
      "decision": "KILL",
      "kill_reason": "passive_interaction",
      "pass": 2,
      "notes": "Subject liked post by another user"
    },
    {
      "index": 3,
      "decision": "KILL",
      "kill_reason": "wrong_person",
      "pass": 1,
      "notes": "Different person at different organization"
    }
  ]
}`;
}

// ── Format LinkedIn reference for screening prompt ──────────────────

function formatLinkedInReference(identity: any, linkedinData?: any): string {
  const lines: string[] = [];
  const name = linkedinData?.currentTitle
    ? `${identity.fullName || identity.name}`
    : identity.fullName || identity.name;

  lines.push(`Name: ${name}`);

  if (linkedinData) {
    lines.push(`Current: ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}`);
    if (linkedinData.careerHistory?.length) {
      lines.push('Career:');
      for (const job of linkedinData.careerHistory.slice(0, 6)) {
        lines.push(`  - ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`);
      }
    }
  } else {
    lines.push(`Current Role: ${identity.currentRole || 'Unknown'}`);
    lines.push(`Current Org: ${identity.currentOrg || 'Unknown'}`);
    if (identity.pastRoles?.length) {
      for (const r of identity.pastRoles.slice(0, 6)) {
        lines.push(`  - ${r.role} at ${r.org}${r.years ? ` (${r.years})` : ''}`);
      }
    }
  }

  if (identity.affiliations?.length) {
    lines.push(`Affiliations: ${identity.affiliations.join(', ')}`);
  }

  return lines.join('\n');
}

// ── Run Stage 3 screening pipeline ──────────────────────────────────

export async function runScreeningPipeline(
  sources: ResearchSource[],
  subjectName: string,
  identity: any,
  linkedinData?: any,
): Promise<ScreeningResult> {
  console.log(`[Stage 3] Starting screening of ${sources.length} sources`);

  const stats: ScreeningStats = {
    totalReceived: sources.length,
    pass1Killed: 0,
    pass2Killed: 0,
    autoRejected: 0,
    surviving: 0,
  };

  // Step 1: Automatic pre-filter (junk URLs, name check)
  const { passed: autoSurvived, killed: autoKilled } = automaticPreFilter(sources, subjectName);
  stats.autoRejected = autoKilled.length;

  console.log(`[Stage 3] Auto pre-filter: ${autoKilled.length} killed, ${autoSurvived.length} passed`);

  // Step 2: LLM screening in batches (Pass 1 + Pass 2)
  const BATCH_SIZE = 25;
  const allSurviving: ResearchSource[] = [];
  const allKilled = [...autoKilled];

  // Sources that bypassed screening go straight through
  const bypassedSources = autoSurvived.filter(s => s.bypassScreening);
  const needsScreening = autoSurvived.filter(s => !s.bypassScreening);

  // Set attribution for bypassed sources
  for (const s of bypassedSources) {
    if (s.source === 'blog_crawl') s.attribution = 'target_authored';
    else if (s.source === 'linkedin_post') s.attribution = 'target_authored';
    else if (s.source === 'user_supplied') s.attribution = 'target_coverage';
    else s.attribution = 'target_coverage';
    allSurviving.push(s);
  }

  const linkedinReference = formatLinkedInReference(identity, linkedinData);

  for (let i = 0; i < needsScreening.length; i += BATCH_SIZE) {
    const batch = needsScreening.slice(i, i + BATCH_SIZE);

    try {
      const prompt = buildScreeningPrompt(batch, subjectName, linkedinReference);
      const response = await complete(
        'You are screening search results for a donor profiling system. Return JSON only.',
        prompt,
        { maxTokens: 4096 },
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const results = parsed.results || [];
        const handledIndices = new Set<number>();

        for (const r of results) {
          if (typeof r.index !== 'number' || r.index < 0 || r.index >= batch.length) continue;
          handledIndices.add(r.index);

          if (r.decision === 'KEEP') {
            const source = batch[r.index];
            source.attribution = r.attribution as AttributionType;
            if (r.institutional_context) {
              source.institutionalContext = r.institutional_context;
            }
            allSurviving.push(source);
          } else {
            allKilled.push({
              url: batch[r.index].url,
              killReason: `${r.kill_reason || 'unknown'} — ${r.notes || ''}`,
              pass: r.pass || 2,
            });
            if (r.pass === 1) stats.pass1Killed++;
            else stats.pass2Killed++;
          }
        }

        // Fail open: sources not in response get accepted with default attribution
        for (let j = 0; j < batch.length; j++) {
          if (!handledIndices.has(j)) {
            batch[j].attribution = 'target_coverage';
            allSurviving.push(batch[j]);
          }
        }
      } else {
        // Parse failure — fail open
        for (const s of batch) {
          s.attribution = 'target_coverage';
          allSurviving.push(s);
        }
      }
    } catch (err) {
      console.error('[Stage 3] LLM screening batch failed:', err);
      // On error, accept all (fail open)
      for (const s of batch) {
        s.attribution = 'target_coverage';
        allSurviving.push(s);
      }
    }
  }

  stats.surviving = allSurviving.length;

  console.log(`[Stage 3] Screening complete: ${allSurviving.length} surviving, ${allKilled.length} killed`);
  console.log(`[Stage 3]   Pass 1 (disambiguation): ${stats.pass1Killed} killed`);
  console.log(`[Stage 3]   Pass 2 (attribution): ${stats.pass2Killed} killed`);
  console.log(`[Stage 3]   Auto-rejected: ${stats.autoRejected}`);

  // Log attribution distribution
  const attrCounts: Record<string, number> = {};
  for (const s of allSurviving) {
    attrCounts[s.attribution || 'unknown'] = (attrCounts[s.attribution || 'unknown'] || 0) + 1;
  }
  for (const [attr, count] of Object.entries(attrCounts)) {
    console.log(`[Stage 3]   ${attr}: ${count}`);
  }

  return {
    survivingUrls: allSurviving,
    killedUrls: allKilled,
    stats,
  };
}

// ── Backward compatibility exports ──────────────────────────────────
// Old modules may import these names

export function automaticScreen(
  source: ResearchSource,
  subjectName: string,
  isOrgContextQuery: boolean,
): { accepted: boolean; rejectionReason?: string; needsLLMScreen: boolean } {
  if (source.bypassScreening) {
    return { accepted: true, needsLLMScreen: false };
  }

  if (!isOrgContextQuery) {
    const nameVariants = getNameVariants(subjectName);
    const searchText = `${source.content || ''} ${source.snippet || ''} ${source.title || ''}`.toLowerCase();
    const hasName = nameVariants.some(v => searchText.includes(v.toLowerCase()));
    if (!hasName) {
      return { accepted: false, rejectionReason: 'Subject name not found in content', needsLLMScreen: false };
    }
  }

  if (JUNK_URL_PATTERNS.some(p => p.test(source.url))) {
    return { accepted: false, rejectionReason: 'Directory/people-search page', needsLLMScreen: false };
  }

  return { accepted: true, needsLLMScreen: true };
}
