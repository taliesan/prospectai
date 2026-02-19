// Stage 4.5 — Relevance Filter (v5 Pipeline)
//
// Defense in depth behind Stage 3 screening. Runs after content fetch/dedup
// and before dimension scoring. Checks each source against the target's
// career timeline and seed URL context.
//
// Critical design: institutional sources from the target's tenure are RELEVANT
// even if the target is never named. This filter checks org+timeframe match
// against career history, NOT name presence.
//
// Input:  deduped sources with full content
// Output: sources that pass relevance check (same type, smaller array)

import { complete } from '../anthropic';
import type { ResearchSource } from './screening';

// ── Types ─────────────────────────────────────────────────────────

export interface RelevanceFilterResult {
  passed: ResearchSource[];
  failed: Array<{
    url: string;
    title: string;
    reason: string;
  }>;
  stats: {
    totalReceived: number;
    passed: number;
    failed: number;
    failOpenCount: number;
  };
}

// ── Batch size for LLM calls ──────────────────────────────────────

const RELEVANCE_BATCH_SIZE = 20;

// ── Build career timeline text from LinkedIn data ─────────────────

function formatCareerTimeline(linkedinData?: any, identity?: any): string {
  const lines: string[] = [];

  if (linkedinData) {
    if (linkedinData.currentTitle && linkedinData.currentEmployer) {
      lines.push(`Current: ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}`);
    }
    if (linkedinData.careerHistory?.length) {
      lines.push('Career history:');
      for (const job of linkedinData.careerHistory) {
        lines.push(`  - ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`);
      }
    }
    if (linkedinData.boards?.length) {
      lines.push(`Board/advisory roles: ${linkedinData.boards.join(', ')}`);
    }
    if (linkedinData.education?.length) {
      lines.push('Education:');
      for (const edu of linkedinData.education) {
        lines.push(`  - ${edu.institution}${edu.degree ? `: ${edu.degree}` : ''}${edu.years ? ` (${edu.years})` : ''}`);
      }
    }
  } else if (identity) {
    if (identity.currentRole) lines.push(`Current: ${identity.currentRole} at ${identity.currentOrg || 'unknown'}`);
    if (identity.pastRoles?.length) {
      lines.push('Past roles:');
      for (const r of identity.pastRoles) {
        lines.push(`  - ${r.role} at ${r.org}${r.years ? ` (${r.years})` : ''}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No career timeline available.';
}

// ── Extract head/tail of content ──────────────────────────────────

function headTail(content: string, headChars: number, tailChars: number): string {
  const trimmed = content.trim();
  if (trimmed.length <= headChars + tailChars + 50) {
    return trimmed;
  }
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);
  return `${head}\n\n[... ${trimmed.length - headChars - tailChars} chars omitted ...]\n\n${tail}`;
}

// ── Build the relevance filter prompt ─────────────────────────────

function buildRelevancePrompt(
  sources: ResearchSource[],
  subjectName: string,
  seedUrlContent: string,
  careerTimeline: string,
): string {
  const sourceEntries = sources.map((s, i) => {
    const content = s.content || s.snippet || '';
    return `[${i}] URL: ${s.url}
Title: ${s.title || 'Untitled'}
Attribution tag: ${s.attribution || 'none'}
${s.institutionalContext ? `Institutional context: ${s.institutionalContext}\n` : ''}Content excerpt:
${headTail(content, 500, 500)}`;
  }).join('\n\n---\n\n');

  return `You are a relevance filter for a behavioral profiling research system. Your job is to determine whether each source is relevant to the research subject.

SUBJECT: ${subjectName}

CAREER TIMELINE:
${careerTimeline}

SEED URL CONTEXT (first 1000 chars):
${seedUrlContent.slice(0, 1000)}

## Relevance criteria

A source is RELEVANT if ANY of the following are true:
(a) It is about the subject — mentions them, quotes them, describes their actions
(b) It is authored by the subject — their blog, their op-ed, their LinkedIn post
(c) It is about an organization, program, initiative, or policy that the subject was involved with during their tenure there — check the career timeline above for org names and dates. The subject does NOT need to be named for this criterion. If the article is about Mozilla's advocacy campaigns and the subject was VP Engagement at Mozilla Foundation 2012-2016, that article is RELEVANT.

A source is NOT RELEVANT if:
- It is about a different person with a similar name
- It is about an organization the subject was never affiliated with
- It is about an organization the subject was affiliated with, but covers a time period OUTSIDE their tenure dates
- It is a generic industry article that doesn't connect to the subject's work, organizations, or programs
- It was authored by someone other than the subject and does not relate to any organization in their career timeline

IMPORTANT: Many of the most valuable sources for behavioral profiling are institutional sources that don't mention the subject by name. An article about what an organization did during the subject's tenure, within their area of responsibility, is rich signal. Do NOT reject sources simply because the subject's name is absent. Check the career timeline.

## Sources to evaluate

${sourceEntries}

## Output

Return JSON:
{
  "results": [
    { "index": 0, "relevant": true, "reason": "About subject's work at Mozilla during their tenure as VP Engagement" },
    { "index": 1, "relevant": false, "reason": "About a different organization not in subject's career timeline" }
  ]
}

Every source must appear in results. For each, give a brief reason.`;
}

// ── Run the relevance filter ──────────────────────────────────────

export async function runRelevanceFilter(
  sources: ResearchSource[],
  subjectName: string,
  seedUrlContent: string,
  linkedinData?: any,
  identity?: any,
): Promise<RelevanceFilterResult> {
  console.log(`[Stage 4.5] Starting relevance filter on ${sources.length} sources`);

  const careerTimeline = formatCareerTimeline(linkedinData, identity);
  const passed: ResearchSource[] = [];
  const failed: RelevanceFilterResult['failed'] = [];
  let failOpenCount = 0;

  // Sources that bypassed screening also bypass relevance filter
  // (blog crawl, user-supplied — already verified as relevant)
  const bypassSources = sources.filter(s => s.bypassScreening);
  const needsFilter = sources.filter(s => !s.bypassScreening);

  for (const s of bypassSources) {
    passed.push(s);
  }

  // Process in batches
  for (let i = 0; i < needsFilter.length; i += RELEVANCE_BATCH_SIZE) {
    const batch = needsFilter.slice(i, i + RELEVANCE_BATCH_SIZE);

    try {
      const prompt = buildRelevancePrompt(batch, subjectName, seedUrlContent, careerTimeline);
      const response = await complete(
        'You are filtering research sources for relevance. Return JSON only.',
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

          if (r.relevant) {
            passed.push(batch[r.index]);
          } else {
            failed.push({
              url: batch[r.index].url,
              title: batch[r.index].title,
              reason: r.reason || 'Not relevant to subject',
            });
          }
        }

        // Fail open: unhandled sources pass through
        for (let j = 0; j < batch.length; j++) {
          if (!handledIndices.has(j)) {
            console.warn(`[Stage 4.5] Source ${i + j} not in LLM response — passed through (fail-open)`);
            passed.push(batch[j]);
            failOpenCount++;
          }
        }
      } else {
        // JSON parse failure — fail open
        console.warn(`[Stage 4.5] Batch ${Math.floor(i / RELEVANCE_BATCH_SIZE) + 1}: no JSON found — ${batch.length} sources passed through (fail-open)`);
        for (const s of batch) {
          passed.push(s);
          failOpenCount++;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Stage 4.5] Batch ${Math.floor(i / RELEVANCE_BATCH_SIZE) + 1} failed: ${errMsg} — ${batch.length} sources passed through (fail-open)`);
      for (const s of batch) {
        passed.push(s);
        failOpenCount++;
      }
    }
  }

  console.log(`[Stage 4.5] Relevance filter complete: ${passed.length} passed, ${failed.length} failed, ${failOpenCount} fail-open`);

  return {
    passed,
    failed,
    stats: {
      totalReceived: sources.length,
      passed: passed.length,
      failed: failed.length,
      failOpenCount,
    },
  };
}
