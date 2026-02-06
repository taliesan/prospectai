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

export const QUERY_GENERATION_PROMPT = `You are generating search queries to research a donor comprehensively.

Given the identity signals extracted from their seed URL, generate 15-25 targeted queries.

CRITICAL: Every query must include enough specificity to find THIS person, not someone else with the same name. Combine name with:
- Current organization
- Current role
- Location
- Unique identifiers

Categories to cover:
1. INTERVIEWS (4-5 queries): Podcasts, video interviews, Q&As — use name + org + "interview" or "podcast"
2. PERSONAL_WRITING (2-3 queries): Substack, Medium, blog, op-eds — use name + org + platform names
3. SPEECHES (2-3 queries): Talks, keynotes, panels — use name + org + "keynote" or "speech" or conference names
4. PHILANTHROPY (2-3 queries): Giving, foundation work, causes — use name + "philanthropy" or "foundation" or "donor"
5. NEWS_PROFILES (3-4 queries): In-depth coverage — use name + org + publication names (NYT, WSJ, etc.)
6. CONTROVERSY (1-2 queries): Criticism, conflicts — use name + org + "controversy" or "criticism"
7. RECENT (2-3 queries): Last 12 months — use name + org + "2024" or "2025"

Keep queries concise (4-8 words). Use quotes around full name.

Output as JSON array:
[
  { "query": "search query text", "category": "CATEGORY_NAME" }
]`;

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
