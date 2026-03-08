// ARCHIVED: Legacy SOURCE_CLASSIFICATION_PROMPT removed from prompts/research.ts
// Date: February 2026
// Reason: Not called by any active code path per system audit
// Original location: prompts/research.ts ~line 259

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
