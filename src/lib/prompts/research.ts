// Prompts for Step 1: Research

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

export const QUERY_GENERATION_PROMPT = `You are a research analyst designing search queries to find the richest behavioral evidence about a specific person.

## Your Task

Design search queries in five categories. Each query should have a specific research hypothesis — what kind of source you expect to find and why it would contain behavioral evidence.

Do NOT generate generic "[name] interview" queries when you have enough information to search for specific interviews, projects, or publications by name.

### Category A — The Subject's Known Outputs (8-12 queries)
Search for things the subject has CREATED: workshops they facilitated, podcasts they hosted or guested on, books they wrote, talks they gave, tools or frameworks they launched.

Look at their LinkedIn/identity for:
- Named projects, initiatives, or programs they led
- Publications or media appearances mentioned
- Self-descriptions that suggest a methodology or approach
- Workshop, course, or training facilitation

For each, search by the specific name, not generic terms.

### Category B — Behavioral Pressure Points (5-8 queries)
Search for moments that reveal values under stress: career transitions, departures, controversies, public positions, organizational crises during their tenure.

Look for:
- Gaps or short tenures that might indicate conflict or pivot
- Departures from long tenures (5+ years)
- Sector transitions (nonprofit → corporate, etc.)
- Roles at organizations with known public controversies

### Category C — Professional Community (5-8 queries)
Search for the subject within their field's discourse: panel appearances, peer citations, industry commentary, co-authored work.

Look for:
- Their field/industry terminology
- Named collaborators or co-authors
- Professional associations or communities
- Conference speaking

### Category D — Organizational Context During Tenure (6-10 queries)
For subjects who work behind the scenes, their organization's actions are a proxy for their decisions. Search for what their employers DID while they were there.

Focus on 2-3 most significant roles. For each:
- Search for the org's major actions during that date range
- Search for the org's public positions, campaigns, or pivots
- Search for coverage of programs or initiatives they led

Even if the subject isn't named in results, organizational actions during their tenure reveal their environment and likely contributions.

### Category E — Gap-Filling (only if A-D produce < 20 quality sources)
Generic queries for breadth: alternate name spellings, conference speaker lists, academic citations.

## Output Format

For each query, provide:
- Category (A/B/C/D/E)
- Query text
- Hypothesis: What source you expect to find and why it would contain behavioral evidence

Format as JSON:
{
  "queries": [
    {
      "category": "A",
      "query": "\\"Jane Smith\\" \\"leadership laboratory\\" workshop",
      "hypothesis": "Workshop participants often write testimonials describing teaching style and methodology"
    }
  ]
}

Generate 25-35 queries total across categories A-D. Only add Category E if needed.`;

export const SOURCE_RELEVANCE_PROMPT = `You are screening search results to verify they are about the correct person.

Given:
- The target person's identity signals (from their seed URL)
- A search result (URL, title, snippet)

Determine if this search result is about the SAME person or a DIFFERENT person with the same/similar name.

Check for:
- Does the organization match?
- Does the role/title match?
- Does the location match?
- Do any unique identifiers match?
- Are there contradicting facts (different org, different field, different location)?

Output as JSON:
{
  "isMatch": true|false,
  "confidence": "high"|"medium"|"low",
  "matchingSignals": ["List of signals that match"],
  "conflictingSignals": ["List of signals that conflict"],
  "reason": "Brief explanation"
}`;

export function generateResearchQueries(donorName: string, identity: any, seedUrlExcerpt?: string): string {
  const formatLinkedIn = () => {
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

  return `## Subject Information

${formatLinkedIn()}

${seedUrlExcerpt ? `Seed URL Content (excerpt):\n${seedUrlExcerpt.slice(0, 3000)}\n` : ''}

${QUERY_GENERATION_PROMPT}`;
}

// Categorized query interface for the new pipeline
export interface CategorizedQuery {
  category: 'A' | 'B' | 'C' | 'D' | 'E';
  query: string;
  hypothesis: string;
}

export function parseAnalyticalQueries(response: string): CategorizedQuery[] {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Try array format as fallback
      const arrayMatch = response.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        return parsed.map((q: any) => ({
          category: q.category || 'E',
          query: q.query,
          hypothesis: q.hypothesis || '',
        }));
      }
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.queries && Array.isArray(parsed.queries)) {
      return parsed.queries.map((q: any) => ({
        category: q.category || 'E',
        query: q.query,
        hypothesis: q.hypothesis || '',
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// Keep SOURCE_CLASSIFICATION_PROMPT for backward compatibility if used elsewhere
export const SOURCE_CLASSIFICATION_PROMPT = `You are classifying a source for donor research quality.

Given the URL, title, and snippet, classify:

1. SOURCE_TYPE:
   - PERSONAL: Personal blog, Substack, Medium, personal website
   - INTERVIEW: Podcast, video interview, Q&A, long-form conversation
   - PROFILE: In-depth media profile, feature article about them
   - EMPLOYER: Company bio, org website, foundation page
   - NEWS: News article, brief mention
   - SOCIAL: LinkedIn, Twitter, public social media
   - DIRECTORY: Wikipedia, Crunchbase, people-finder sites

2. IDENTITY_MATCH:
   - HIGH: Clearly this specific person (multiple details match)
   - MEDIUM: Likely this person (some details match)
   - LOW: Uncertain or likely wrong person

3. EVIDENCE_QUALITY:
   - HIGH: Direct quotes, in-depth content, first-person perspective
   - MEDIUM: Third-party description, some quotes or details
   - LOW: Brief mention, directory listing, minimal content

4. BEHAVIORAL_POTENTIAL:
   - HIGH: Likely contains behavioral evidence (interviews, personal writing)
   - MEDIUM: May contain behavioral evidence
   - LOW: Unlikely to contain behavioral evidence (directories, brief news)

Output as JSON:
{
  "sourceType": "TYPE",
  "identityMatch": "HIGH|MEDIUM|LOW",
  "evidenceQuality": "HIGH|MEDIUM|LOW",
  "behavioralPotential": "HIGH|MEDIUM|LOW",
  "shouldFetch": true|false,
  "reason": "Brief explanation"
}`;
