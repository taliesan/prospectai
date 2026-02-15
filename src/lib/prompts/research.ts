// Stage 1 — Query Generation (v5 Pipeline)
//
// Sonnet reads LinkedIn JSON + seed URL content and generates 40-80 targeted
// search queries across three categories (A/B/C) with 25-dimension awareness.

import { formatDimensionsForPrompt } from '../dimensions';

export const IDENTITY_EXTRACTION_PROMPT = `You are extracting identity information from a webpage about a person.

Given the page content, extract these identity signals:

1. Full name (and any variations, maiden names, nicknames)
2. Current role/title and organization
3. Past roles and organizations (with approximate dates if available)
4. Geographic locations (where they live, work, grew up)
5. Education (schools, degrees, years)
6. Key affiliations (boards, foundations, associations)
7. Unique identifiers (specific achievements, rare combinations of facts)

Be precise. Only include information explicitly stated in the content.

Output as JSON:
{
  "fullName": "Their full name as stated",
  "currentRole": "Current title",
  "currentOrg": "Current organization",
  "pastRoles": [
    { "role": "Title", "org": "Organization", "years": "Date range if known" }
  ],
  "locations": ["City, State/Country"],
  "education": [
    { "school": "Name", "degree": "If known", "year": "If known" }
  ],
  "affiliations": ["Board/foundation/association names"],
  "uniqueIdentifiers": ["Specific facts that distinguish this person"]
}`;

export const QUERY_GENERATION_PROMPT = `You are a research strategist preparing search queries for a behavioral profiling system. You will receive a subject's LinkedIn profile and seed URL content. Your job is to generate 40-80 targeted search queries that will surface behavioral evidence across 25 dimensions.

## Your Task

Generate search queries in three categories:

### Category A — Direct Name Queries
Search for the subject by name combined with:
- Each organization they worked at (from LinkedIn)
- Known campaigns, initiatives, or projects (from seed URL and LinkedIn)
- Media appearances: podcast, interview, conference, panel, keynote, video
- Crisis/controversy: criticized, controversy, backlash, resigned, fired
- Failure/setback: failure, mistake, setback, apology, lessons learned
- Writing: op-ed, essay, blog, newsletter, book, chapter

### Category B — Institutional Actions During Tenure
For each LinkedIn role lasting 2+ years:
1. Identify the subject's area of responsibility from their title
2. Generate queries about what the ORGANIZATION did in that area
   during the subject's tenure dates
3. DO NOT generate queries about organizational functions outside
   the subject's role

Example: If subject was "VP of Fundraising" at Org X from 2015-2019:
  YES: "Org X fundraising strategy 2015 2016 2017 2018 2019"
  YES: "Org X major donors partnerships 2016 2017"
  YES: "Org X largest donation gift 2015 2016 2017 2018 2019"
  NO:  "Org X engineering team hiring 2017" (outside their role)
  NO:  "Org X product launch 2018" (outside their role)

### Category C — Network & Affiliations
- Board and advisory roles (from LinkedIn)
- Co-authors, co-signers, coalition partners (from seed URL)
- Political giving, campaign finance (if applicable)
- Foundation 990 filings naming the subject or their org during tenure

## Dimension Targeting

Each query should target 1-3 of these behavioral dimensions.
Annotate each query with its target dimensions.

${formatDimensionsForPrompt()}

Dimensions 16-25 (LOW INVESTMENT tier) are the hardest to find and the most tactically
valuable. Generate at least 5 queries specifically targeting these.

## Output Format

Return a JSON object:
{
  "queries": [
    {
      "query": "\\"Jane Smith\\" Mozilla net neutrality",
      "category": "A",
      "target_dimensions": [1, 8, 15],
      "source_from": "LinkedIn: VP Engagement, Mozilla Foundation 2012-2016",
      "rationale": "Net neutrality was a major campaign during her Mozilla tenure"
    },
    {
      "query": "Mozilla Foundation advocacy campaign 2014 2015 net neutrality",
      "category": "B",
      "target_dimensions": [1, 13, 14],
      "source_from": "LinkedIn: VP Engagement, Mozilla Foundation 2012-2016",
      "rationale": "Institutional action in her area of responsibility"
    }
  ],
  "coverage_intent": {
    "1_DECISION_MAKING": 8,
    "2_TRUST_CALIBRATION": 6,
    "25_POWER_ANALYSIS": 6
  }
}

## Rules
- Every query must trace to a specific fact in the LinkedIn or seed URL.
  If you can't cite where it came from, don't generate it.
- Assess the subject's public profile before setting category mix:
  * HIGH-PROFILE (frequently named in press, many interviews):
    Category A 60%, B 15%, C 25%. Direct searches will be productive.
  * MODERATE-PROFILE (named in some press, few interviews):
    Category A 45%, B 30%, C 25%. Standard mix.
  * LOW-PROFILE (behind-the-scenes, rarely named in press):
    Category A 25%, B 50%, C 25%. Institutional queries are primary.
- At minimum, generate one Category B query per LinkedIn role lasting
  2+ years regardless of profile type.
- Minimum 5 queries targeting dimensions 17-25.
- No generic queries like "[name] bio" or "[name] Wikipedia."
- Use quoted name format for Category A: "First Last"
- Include year ranges for Category B to constrain to tenure period.`;

// ── Build the full Stage 1 prompt ───────────────────────────────────

export function generateResearchQueries(
  donorName: string,
  identity: any,
  seedUrlExcerpt?: string,
  linkedinJson?: any,
): string {
  const formatIdentity = () => {
    const lines: string[] = [];
    lines.push(`Name: ${identity.fullName || donorName}`);
    lines.push(`Current Role: ${identity.currentRole || 'Unknown'}`);
    lines.push(`Current Organization: ${identity.currentOrg || 'Unknown'}`);

    if (identity.pastRoles?.length) {
      lines.push('Past Roles:');
      for (const r of identity.pastRoles) {
        lines.push(`  - ${r.role} at ${r.org}${r.years ? ` (${r.years})` : ''}`);
      }
    }

    if (identity.locations?.length) {
      lines.push(`Locations: ${identity.locations.join(', ')}`);
    }
    if (identity.education?.length) {
      lines.push(`Education: ${identity.education.map((e: any) => `${e.school}${e.degree ? ` (${e.degree})` : ''}`).join(', ')}`);
    }
    if (identity.affiliations?.length) {
      lines.push(`Affiliations: ${identity.affiliations.join(', ')}`);
    }
    if (identity.uniqueIdentifiers?.length) {
      lines.push(`Unique Identifiers: ${identity.uniqueIdentifiers.join(', ')}`);
    }

    return lines.join('\n');
  };

  let linkedinSection = '';
  if (linkedinJson) {
    linkedinSection = `## LinkedIn JSON\n\`\`\`json\n${JSON.stringify(linkedinJson, null, 2)}\n\`\`\`\n\n`;
  }

  return `SUBJECT: ${donorName}

## Subject Information

${formatIdentity()}

${linkedinSection}${seedUrlExcerpt ? `## Seed URL Content (excerpt)\n${seedUrlExcerpt.slice(0, 15000)}\n\n` : ''}${QUERY_GENERATION_PROMPT}`;
}

// ── Supplementary query prompt (for retry when <30 URLs) ────────────

export function generateSupplementaryQueryPrompt(
  donorName: string,
  identity: any,
  initialUrlCount: number,
  gapDimensions: string[],
): string {
  return `The initial search for ${donorName} returned only ${initialUrlCount} unique URLs.
Generate 15-20 additional queries targeting the following gap dimensions:
${gapDimensions.map(d => `- ${d}`).join('\n')}

Focus on Category B (institutional) and Category C (network) queries — direct
name searches are likely exhausted.

Subject: ${identity.fullName || donorName}
Current Role: ${identity.currentRole || 'Unknown'} at ${identity.currentOrg || 'Unknown'}
${identity.pastRoles?.length ? `Past Roles:\n${identity.pastRoles.map((r: any) => `  - ${r.role} at ${r.org}${r.years ? ` (${r.years})` : ''}`).join('\n')}` : ''}

Output as JSON array:
[
  {
    "query": "...",
    "category": "B",
    "target_dimensions": [17, 25],
    "rationale": "..."
  }
]`;
}

// ── Query interface ─────────────────────────────────────────────────

export interface CategorizedQuery {
  category: 'A' | 'B' | 'C';
  query: string;
  rationale: string;
  targetDimensions?: number[];
  sourceFrom?: string;
}

export function parseQueryGenerationResponse(response: string): CategorizedQuery[] {
  try {
    // Try object format first: { "queries": [...] }
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.queries && Array.isArray(parsed.queries)) {
        return parsed.queries.map((q: any) => ({
          category: q.category || 'A',
          query: q.query,
          rationale: q.rationale || q.hypothesis || '',
          targetDimensions: q.target_dimensions,
          sourceFrom: q.source_from,
        }));
      }
    }

    // Try array format as fallback
    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]);
      return parsed.map((q: any) => ({
        category: q.category || 'A',
        query: q.query,
        rationale: q.rationale || q.hypothesis || '',
        targetDimensions: q.target_dimensions,
        sourceFrom: q.source_from,
      }));
    }

    return [];
  } catch {
    return [];
  }
}

// Backward compat: old parseAnalyticalQueries maps to new interface
export const parseAnalyticalQueries = parseQueryGenerationResponse;

// SOURCE_CLASSIFICATION_PROMPT archived to _archived/prompts-research-legacy.ts
