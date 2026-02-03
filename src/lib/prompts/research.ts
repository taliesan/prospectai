// Prompts for Step 1: Research

export const IDENTITY_RESOLUTION_PROMPT = `You are resolving the identity of a donor for research purposes.

Given the donor name and any seed URLs, establish:
1. Full name and any known aliases
2. Current and past organizations (with roles)
3. Geographic locations associated with them
4. Domain keywords (e.g., "tech policy", "climate philanthropy", "labor organizing")
5. Disambiguation signals (what distinguishes this person from others with the same name)

Be conservative. Only include information you're confident about. Mark uncertainty where it exists.

Output as JSON:
{
  "name": "Full Name",
  "aliases": ["Alternative names"],
  "organizations": [
    { "name": "Org Name", "role": "Their role", "confidence": "high|medium|low" }
  ],
  "locations": ["City, State"],
  "domainKeywords": ["keyword1", "keyword2"],
  "disambiguationSignals": ["Unique identifiers"]
}`;

export const QUERY_GENERATION_PROMPT = `You are generating search queries to research a donor comprehensively.

Generate 15-25 targeted queries across these categories:
1. BIOGRAPHY (2-3 queries): Background, education, early career
2. INTERVIEWS (3-4 queries): Podcasts, video interviews, Q&As
3. PERSONAL_WRITING (2-3 queries): Substack, Medium, blog, published articles
4. PHILANTHROPY (2-3 queries): Giving history, foundation work, causes supported
5. SPEECHES (2 queries): Talks, keynotes, panel appearances
6. NEWS (2-3 queries): Recent coverage, profiles, mentions
7. BOARDS (1-2 queries): Board positions, advisory roles
8. CONTROVERSY (1-2 queries): Criticism, controversial positions, conflicts
9. PERSONAL (1-2 queries): Family, hobbies, personal details (if publicly shared)
10. RECENT (2-3 queries): Activity in last 12 months

For each query, keep it concise (3-7 words typically work best).
Use quotes around the full name: "[Name]"
Combine name with organizations, roles, and topic keywords.

Output as JSON array:
[
  { "query": "search query text", "category": "CATEGORY_NAME" }
]`;

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

export function generateResearchQueries(donorName: string, identity: any): string {
  return `Generate search queries for researching this donor:

Name: ${donorName}
Organizations: ${identity.organizations?.map((o: any) => `${o.name} (${o.role})`).join(', ') || 'Unknown'}
Domain Keywords: ${identity.domainKeywords?.join(', ') || 'Unknown'}
Locations: ${identity.locations?.join(', ') || 'Unknown'}

${QUERY_GENERATION_PROMPT}`;
}
