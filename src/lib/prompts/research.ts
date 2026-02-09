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

export const QUERY_GENERATION_PROMPT = `You are a profiler researching a donor for a high-stakes meeting. Your queries will feed into a system that builds a behavioral profile — how this person thinks, decides, and operates under pressure.

Generate 20-30 search queries in two tiers:

## TIER 1 — STANDARD (10-15 queries)

The basics that work for anyone. Use their name + organization + specifics from the identity signals to disambiguate from other people with similar names.

Cover these areas:
- Interviews, podcasts, video Q&As
- Personal writing (Substack, Medium, op-eds, personal blog)
- Speeches, keynotes, conference panels
- News profiles and feature articles
- Recent coverage (last 12 months — use "2024" or "2025")
- Controversy, criticism, conflicts, or public disputes

Keep queries concise (4-8 words). Use quotes around full name when helpful.

## TIER 2 — TAILORED (10-15 queries)

Now think like a PI. Based on who this person is and what role they hold, get creative:

**Where does someone in THIS role leave traces?**
- Foundation officer → grants, program reports, grantee announcements, RFP documents
- CEO/founder → earnings calls, investor letters, company announcements, employee reviews on Glassdoor
- Board member → proxy statements, nonprofit 990s, organizational decisions during their tenure
- Investor/VC → portfolio company announcements, investment thesis posts, founder testimonials
- Low-profile donor → the organizations they fund, boards they sit on, causes they back

**What has their organization done during their tenure?**
- Decisions, grants, investments, or public positions attributed to them or their program
- Strategic shifts that happened while they were in charge
- "[Organization] [program area] grants [year]" or "[Organization] annual report [year]"

**Who are their collaborators, grantees, critics, or opponents?**
- What have those people said publicly?
- "[Collaborator name] AND [organization]" or "[Grantee org] AND [funder org]"

**What controversies touched their domain?**
- How did they respond — or conspicuously NOT respond?
- Industry or sector debates where they would have had to take a position

**What would a journalist investigating this person look for?**
- Public records, filings, disclosed conflicts of interest
- Patterns across their career moves or funding decisions

Generate queries a lazy researcher would miss. The goal is behavioral signal — how they think, what they value, how they handle pressure — not just biography.

## OUTPUT FORMAT

Return a JSON array:
[
  {
    "query": "search query text",
    "tier": "STANDARD" or "TAILORED",
    "rationale": "brief note on what this might reveal"
  }
]

Generate 20-30 queries total. Tier 1 and Tier 2 should each have 10-15 queries.`;

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

export function generateResearchQueries(donorName: string, identity: any): string {
  const orgContext = identity.currentOrg ? ` at ${identity.currentOrg}` : '';
  const roleContext = identity.currentRole ? ` (${identity.currentRole})` : '';
  const locationContext = identity.locations?.length ? ` in ${identity.locations[0]}` : '';

  return `Generate search queries for researching this donor:

Name: ${donorName}${roleContext}${orgContext}${locationContext}

IDENTITY SIGNALS (use these to make queries specific):
- Current Organization: ${identity.currentOrg || 'Unknown'}
- Current Role: ${identity.currentRole || 'Unknown'}
- Past Roles: ${identity.pastRoles?.map((r: any) => `${r.role} at ${r.org}`).join(', ') || 'Unknown'}
- Locations: ${identity.locations?.join(', ') || 'Unknown'}
- Education: ${identity.education?.map((e: any) => e.school).join(', ') || 'Unknown'}
- Affiliations: ${identity.affiliations?.join(', ') || 'Unknown'}
- Unique Identifiers: ${identity.uniqueIdentifiers?.join(', ') || 'None'}

${QUERY_GENERATION_PROMPT}`;
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
