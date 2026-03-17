import { NextRequest } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runResearchStages } from '@/lib/pipeline';
import { sanitizeForClaude } from '@/lib/sanitize';
import { withProgressCallback, ProgressEvent, STATUS } from '@/lib/progress';
import { createJob, addProgress, completeJob, failJob, getAbortSignal, linkJobToProfile } from '@/lib/job-store';
import { ConversationManager } from '@/lib/conversation';
import {
  loadGeoffreyBlock,
  loadPromptV2,
  loadMeetingGuideBlockV3,
  loadMeetingGuideOutputTemplate,
  loadStage0OrgIntakePrompt,
  loadTidebreakStrategicFrame,
  loadMeetingGuideInes,
  loadMeetingGuideLuma,
  loadMeetingGuideYmmra,
  loadProfessorCanon,
  loadBriefingNotesPrompt,
  loadBriefingNotesProfessorPrompt,
  type ProjectLayerInput,
} from '@/lib/canon/loader';
import { formatDimensionsForPrompt } from '@/lib/dimensions';
import { formatSourcesForDeepResearch } from '@/lib/prompts/source-scoring';
import { runProfessorReview } from '@/lib/professor';
import Anthropic from '@anthropic-ai/sdk';

// Tavily API for web search (same as /api/generate)
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

interface TavilySearchResponse {
  results: { url: string; title: string; content: string; score: number }[];
}
interface TavilyExtractResponse {
  results: { url: string; raw_content: string }[];
}

async function webSearch(query: string): Promise<{ url: string; title: string; snippet: string; content?: string }[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const searchResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'advanced', include_answer: false, max_results: 10 }),
    });
    if (!searchResponse.ok) return [];
    const searchData: TavilySearchResponse = await searchResponse.json();
    const topResults = searchData.results.sort((a, b) => b.score - a.score).slice(0, 3);
    let extractedContent: Record<string, string> = {};
    if (topResults.length > 0) {
      try {
        const extractResponse = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: TAVILY_API_KEY, urls: topResults.map(r => r.url) }),
        });
        if (extractResponse.ok) {
          const extractData: TavilyExtractResponse = await extractResponse.json();
          extractedContent = extractData.results.reduce((acc, item) => {
            acc[item.url] = sanitizeForClaude(item.raw_content);
            return acc;
          }, {} as Record<string, string>);
        }
      } catch { /* continue with snippets */ }
    }
    return searchData.results.map(result => ({
      url: result.url,
      title: result.title,
      snippet: result.content,
      fullContent: extractedContent[result.url],
    }));
  } catch { return []; }
}

const OUTPUT_DIR = '/tmp/prospectai-outputs';

function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
}

function debugWrite(filename: string, content: string) {
  try {
    ensureOutputDir();
    writeFileSync(`${OUTPUT_DIR}/${filename}`, content);
    console.log(`[V5] Wrote ${OUTPUT_DIR}/${filename} (${content.length} chars)`);
  } catch (e) { /* ignore */ }
}

// ── Extract prompt-v2.txt sections for conversation mode ──────────
function getTaskSection(): string {
  const promptV2 = loadPromptV2();
  const lines = promptV2.split('\n');
  // Lines 460-552 (1-indexed) → array index 459-551
  return lines.slice(459).join('\n');
}

function getExemplarSection(): string {
  const promptV2 = loadPromptV2();
  const lines = promptV2.split('\n');
  // Lines 135-444 (1-indexed) → array index 134-443
  return lines.slice(134, 444).join('\n');
}

// ── Build source packet for conversation mode ─────────────────────
function buildSourcePacket(selectedSources: any[]): string {
  return formatSourcesForDeepResearch(selectedSources);
}

// ── Build LinkedIn summary ────────────────────────────────────────
function formatLinkedInData(linkedinData: any): string {
  if (!linkedinData) return 'No LinkedIn data available.';
  return JSON.stringify({
    currentTitle: linkedinData.currentTitle,
    currentEmployer: linkedinData.currentEmployer,
    linkedinSlug: linkedinData.linkedinSlug,
    websites: linkedinData.websites,
    careerHistory: linkedinData.careerHistory,
    education: linkedinData.education,
    boards: linkedinData.boards,
  }, null, 2);
}

// ── BN Professor — standalone side-call for Briefing Note review ─────
async function runBnProfessorReview(
  finalProfile: string,
  briefingNoteDraft: string,
): Promise<{ feedback: string; promptForDebug: string }> {
  const client = new Anthropic();
  const { system, userTemplate } = loadBriefingNotesProfessorPrompt();

  const userMessage = userTemplate
    .replace('[PIPELINE INJECTS FINAL PROFILE HERE]', finalProfile)
    .replace('[PIPELINE INJECTS BRIEFING NOTE DRAFT HERE]', briefingNoteDraft);

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  const promptForDebug = `=== BN PROFESSOR SYSTEM PROMPT ===\n${system.slice(0, 500)}...\n\n[TRUNCATED — full ${system.length} chars sent to API]\n\n=== BN PROFESSOR USER MESSAGE ===\n[Profile: ${finalProfile.length} chars]\n[BN Draft: ${briefingNoteDraft.length} chars]\n[Total user message: ${userMessage.length} chars]\n\n${userMessage}`;

  return { feedback: text, promptForDebug };
}

// ══════════════════════════════════════════════════════════════════════
// POST handler — fire-and-poll, same pattern as /api/generate
// ══════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const body = await request.json();
  const { donorName, fundraiserName = '', seedUrls = [], linkedinPdf, relationshipContext, projectContextId, specificAsk } = body;

  if (!donorName || typeof donorName !== 'string') {
    return Response.json({ error: 'Donor name is required' }, { status: 400 });
  }

  const job = await createJob(donorName, userId);
  console.log(`[V5] Created job ${job.id} for: ${donorName} (conversation mode)`);

  runV5PipelineInBackground(job.id, donorName, fundraiserName, seedUrls, linkedinPdf, userId, relationshipContext, projectContextId, specificAsk).catch((err) => {
    console.error(`[V5] Unhandled error in background pipeline for job ${job.id}:`, err);
    failJob(job.id, err instanceof Error ? err.message : 'Unknown error');
  });

  return Response.json({ jobId: job.id });
}

// ══════════════════════════════════════════════════════════════════════
// V5 Conversation Mode Pipeline
// ══════════════════════════════════════════════════════════════════════

async function runV5PipelineInBackground(
  jobId: string,
  donorName: string,
  fundraiserName: string,
  seedUrls: string[],
  linkedinPdf?: string,
  userId?: string,
  relationshipContext?: string,
  projectContextId?: string,
  specificAsk?: string,
) {
  const sendEvent = (event: ProgressEvent) => {
    addProgress(jobId, event);
    if (event.message) {
      const prefix = event.phase ? `[${event.phase.toUpperCase()}]` : '[V5]';
      console.log(`[Job ${jobId}] ${prefix} ${event.message}`);
    }
  };

  try {
    await withProgressCallback(sendEvent, async () => {
      try {
        STATUS.pipelineStarted(donorName);
        sendEvent({ type: 'status', message: '[V5] Conversation mode active' });

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const safeName = donorName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

        // Load project context from database (retry once on failure)
        let projectContextData: ProjectLayerInput | undefined;
        if (projectContextId && userId) {
          const loadProjectContext = async () => {
            const pc = await prisma.projectContext.findFirst({
              where: { id: projectContextId, userId },
            });
            if (pc) {
              return {
                name: pc.name,
                processedBrief: pc.processedBrief,
                issueAreas: pc.issueAreas || undefined,
                defaultAsk: pc.defaultAsk || undefined,
                specificAsk: specificAsk || undefined,
                fundraiserName: fundraiserName || undefined,
                strategicFrame: pc.strategicFrame || undefined,
              } as ProjectLayerInput;
            }
            return undefined;
          };

          try {
            projectContextData = await loadProjectContext();
          } catch (firstErr) {
            console.warn(`[V5] Failed to load project context (attempt 1):`, firstErr);
            try {
              await new Promise(resolve => setTimeout(resolve, 1000));
              projectContextData = await loadProjectContext();
              console.log(`[V5] Project context loaded on retry`);
            } catch (retryErr) {
              console.error(`[V5] Failed to load project context after retry:`, retryErr);
              sendEvent({ type: 'status', phase: 'writing', message: `[V5] Warning: Could not load org context — meeting guide will be skipped` });
            }
          }

          if (projectContextData) {
            console.log(`[V5] Loaded project context: ${projectContextData.name}`);
          } else {
            console.warn(`[V5] projectContextId "${projectContextId}" provided but no matching record found for user ${userId}`);
            sendEvent({ type: 'status', phase: 'writing', message: `[V5] Warning: Org context not found — meeting guide will be skipped` });
          }
        }

        const abortSignal = getAbortSignal(jobId);

        const fetchUrl = async (url: string): Promise<string> => {
          if (!TAVILY_API_KEY) {
            const res = await fetch(url);
            return sanitizeForClaude(await res.text());
          }
          try {
            const extractResponse = await fetch('https://api.tavily.com/extract', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: TAVILY_API_KEY, urls: [url] }),
            });
            if (extractResponse.ok) {
              const extractData: TavilyExtractResponse = await extractResponse.json();
              if (extractData.results.length > 0) {
                return sanitizeForClaude(extractData.results[0].raw_content);
              }
            }
          } catch { /* fallback */ }
          const res = await fetch(url);
          return sanitizeForClaude(await res.text());
        };

        // ═══════════════════════════════════════════════════════════
        // STAGES 1-5: Identical research pipeline
        // ═══════════════════════════════════════════════════════════

        const TOTAL_STEPS = 41;

        const stageResult = await runResearchStages(
          donorName,
          seedUrls,
          webSearch,
          (message: string, phase?: string, step?: number, totalSteps?: number) => {
            if (phase && !message) {
              sendEvent({ type: 'phase', message: '', phase: phase as any });
            } else {
              sendEvent({ type: 'status', phase: phase as any, message, step, totalSteps });
            }
          },
          linkedinPdf,
          fetchUrl,
          abortSignal,
          undefined, // onActivity — no DR in V5
          undefined, // onClearActivity
          projectContextData,
          TOTAL_STEPS,
        );

        const { selectedSources, coverageGapReport, confidenceResult, linkedinData, identity, research } = stageResult;

        const sourceChars = selectedSources.reduce((sum, s) => sum + (s.content?.length || 0), 0);
        console.log(`[V5] Stages 1-5 complete: ${selectedSources.length} sources selected, ${sourceChars} chars`);
        sendEvent({ type: 'status', message: `[V5] Stages 1-5 complete: ${selectedSources.length} sources selected, ${sourceChars} chars` });

        // ═══════════════════════════════════════════════════════════
        // CONVERSATION 1: Research Package + Profile
        // ═══════════════════════════════════════════════════════════

        sendEvent({ type: 'status', phase: 'analysis', message: '[V5] Starting conversation mode — research & profile' });

        // Build system prompt for Conversation 1 (voice spec only — persists across all turns)
        const geoffreyBlock = loadGeoffreyBlock();
        const taskSection = getTaskSection();
        const dimensionDefs = formatDimensionsForPrompt();

        const conv1SystemPrompt = geoffreyBlock;

        console.log(`[V5] Conversation 1 starting — system prompt: ${conv1SystemPrompt.length} chars`);
        debugWrite('V5-conversation-1-system-prompt.txt', conv1SystemPrompt);

        const conv1 = new ConversationManager(conv1SystemPrompt);

        // ── Turn 1: Research Package ──────────────────────────────
        sendEvent({ type: 'status', phase: 'analysis', message: '[V5] Turn 1: Producing research package...',  step: 18, totalSteps: TOTAL_STEPS });

        const sourcePacket = buildSourcePacket(selectedSources);
        const linkedinJson = formatLinkedInData(linkedinData);

        const totalCandidates = stageResult.stage5Result.stats.totalScored;
        const turn1Msg = `# PROFILE TASK

${taskSection}

# BEHAVIORAL DIMENSIONS

${dimensionDefs}

---

Here are the ${selectedSources.length} pre-screened, scored sources for ${donorName}. They were selected from ${totalCandidates} candidates by a research pipeline that searched ${stageResult.categorizedQueries.length} queries and scored each source against 25 behavioral dimensions.

Your job: read every source completely and carefully. Do not skim. Do not skip sources that look biographical or institutional.

PHASE 1 — READ FOR SIGNIFICANCE

For each source, ask: what does this reveal about how this person actually operates? Look for:
- Decisions they made and what those decisions cost them
- Specific dollar amounts attached to specific actions — these are behavioral evidence, not resume items
- Sequences where small commitments escalated to large ones, or large commitments were suddenly cut
- Moments where their stated values were tested and what they actually did
- Their own words about why they did something — the explanation reveals the operating system
- Patterns across sources — the same behavior showing up in different contexts
- Contradictions between what they say and what they do
- What they refused to do, and what that refusal cost
- How other people describe interacting with them
- Silences — topics they redirect away from, questions they won't answer

PHASE 2 — ORGANIZE BY DIMENSION

Take everything significant you found and organize it into the 25 behavioral dimensions below. For each dimension:
- Extract direct quotes with source URL attribution
- Note observed behavioral patterns with specific examples
- Write a brief analysis of what the evidence reveals

Some evidence will fit multiple dimensions. Include it in the most important one and cross-reference the others. Some evidence won't fit any dimension cleanly — include it under the closest match and note why it matters.

When a dimension is thin, say so plainly rather than filling it with inference. But before marking a dimension as thin, re-read the sources — significant evidence often hides in articles that look like they're about something else.

Prioritize the target's own voice. First-person quotes are your primary evidence. Third-party descriptions are supporting.

COVERAGE GAPS FROM SCORING:
${coverageGapReport}

CONFIDENCE FLOORS:
${confidenceResult ? confidenceResult.sections.map(s => `Section ${s.section} (${s.sectionName}): floor=${s.floor}`).join('\n') : 'Not available'}

CANONICAL BIOGRAPHICAL DATA:
${linkedinJson}

---

SOURCES:
${sourcePacket}

---

EVIDENCE QUALITY RULES:
When a specific number appears in only one source, mark it [SINGLE-SOURCE] in your package. When a figure is described with words like "estimated," "approximately," or "could," mark it [ESTIMATE] and preserve the qualifier. When you calculate or infer a number that no source states directly, mark it [INFERRED] and show your calculation. When two sources give different numbers for the same thing, note both and mark [CONFLICTING].

These markers must appear inline next to every specific number in your research package. The profile writer will use them to decide what needs qualifiers.`;

        console.log(`[V5] Turn 1 (RESEARCH): sending ${turn1Msg.length} chars, source packet: ${selectedSources.length} sources`);
        debugWrite('V5-turn-1-research-user.txt', turn1Msg);

        const turn1Result = await conv1.turn(turn1Msg, 'RESEARCH', (text) => {
          // Stream callback — periodic progress updates
        }, abortSignal);

        console.log(`[V5] Turn 1 (RESEARCH): response received, ${turn1Result.text.length} chars, ${turn1Result.inputTokens} input tokens, ${turn1Result.outputTokens} output tokens`);
        debugWrite('V5-turn-1-research-response.txt', turn1Result.text);
        sendEvent({ type: 'status', phase: 'analysis', message: `[V5] Turn 1 complete — research package: ${turn1Result.text.length} chars`, step: 20, totalSteps: TOTAL_STEPS });

        // ── Turn 2: Research Critique ─────────────────────────────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'analysis', message: '[V5] Turn 2: Critiquing research package...', step: 22, totalSteps: TOTAL_STEPS });

        const turn2Msg = `Critique this research package. Check:
- Thin dimensions that need more evidence pulled from the sources
- Claims without source attribution
- Inference presented as evidence — if you wrote "this suggests..." without a quote backing it, flag it
- Missing first-person voice — did you extract what the target actually said, or only what others said about them?
- Dimensions where you have institutional patterns but no direct quotes
- Any source content you skimmed past that contains behavioral evidence you missed on the first pass

Re-read the sources for the thinnest gaps. Revise the package. Acknowledge remaining gaps honestly.`;

        console.log(`[V5] Turn 2 (RESEARCH_CRITIQUE): sending ${turn2Msg.length} chars`);
        debugWrite('V5-turn-2-critique-user.txt', turn2Msg);

        const turn2Result = await conv1.turn(turn2Msg, 'RESEARCH_CRITIQUE', undefined, abortSignal);

        console.log(`[V5] Turn 2 (RESEARCH_CRITIQUE): response received, ${turn2Result.text.length} chars, ${turn2Result.inputTokens} input tokens, ${turn2Result.outputTokens} output tokens`);
        debugWrite('V5-turn-2-critique-response.txt', turn2Result.text);
        sendEvent({ type: 'status', phase: 'analysis', message: `[V5] Turn 2 complete — revised research: ${turn2Result.text.length} chars`, step: 24, totalSteps: TOTAL_STEPS });

        // ── Turn 3: Profile Draft ─────────────────────────────────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 3: Writing profile draft...', step: 26, totalSteps: TOTAL_STEPS });

        const exemplarSection = getExemplarSection();

        const turn3Msg = `Write the persuasion profile for ${donorName}.

Here are three exemplar profiles at the target quality. These are FICTIONAL CHARACTERS — a 16th-century pirate captain, a sentient octopus cartographer, and a mycorrhizal network consciousness. Learn the architecture — section rhythm, paragraph density, how quotes deploy, how contradictions land, how evidence ceilings work. Nothing from these exemplars belongs in your output.

${exemplarSection}

SECTION OPENERS:
Each section opens with one sentence that states a behavioral conclusion the reader can act on. This sentence is not a summary of what follows — it's the instruction. Everything after it is proof.

The pirate exemplar demonstrates this move: "She kept the same ledger system her father used and won't explain why." That's not a topic sentence. It's the thing the fundraiser needs to know before anything else in the section.

Your opening sentences should have the compression and directness of: "Accept the nerd. You'll get further." or "Don't touch the guilt lever. It's not a lever — it's a tripwire." State the behavioral conclusion. Then prove it.

EVIDENCE CAUTION:
The research package contains evidence quality markers. Respect them:
- [SINGLE-SOURCE] figures must appear with "approximately" in the profile
- [INFERRED] figures must either be independently verified in another source or omitted entirely
- [ESTIMATE] figures must retain their qualifier — do not state estimates as facts
- [CONFLICTING] figures must use the most conservative number or note the range
- If you want to state a specific number and it has no marker in the research package, verify you can point to the exact source. If you can't, omit it.

Now write the profile using the research package from this conversation. Follow the profile structure and writing principles in your instructions.`;

        console.log(`[V5] Turn 3 (PROFILE_DRAFT): sending ${turn3Msg.length} chars, exemplars injected: ${exemplarSection.length} chars`);
        debugWrite('V5-turn-3-profile-user.txt', turn3Msg);

        const turn3Result = await conv1.turn(turn3Msg, 'PROFILE_DRAFT', undefined, abortSignal);

        console.log(`[V5] Turn 3 (PROFILE_DRAFT): response received, ${turn3Result.text.length} chars, ${turn3Result.inputTokens} input tokens, ${turn3Result.outputTokens} output tokens`);
        debugWrite('V5-turn-3-profile-response.txt', turn3Result.text);
        sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 3 complete — profile draft: ${turn3Result.text.length} chars`, step: 28, totalSteps: TOTAL_STEPS });

        // ── Professor Review (separate context window) ────────────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'writing', message: '[V5] Professor reviewing draft against canon...', step: 29, totalSteps: TOTAL_STEPS });

        const professorCanon = loadProfessorCanon();
        console.log(`[V5] Running professor review — canon: ${professorCanon.length} chars, research: ${turn2Result.text.length} chars, draft: ${turn3Result.text.length} chars, total: ${professorCanon.length + turn2Result.text.length + turn3Result.text.length} chars`);

        const professorResult = await runProfessorReview(
          turn3Result.text,
          turn2Result.text,
          professorCanon,
          donorName,
        );
        const professorFeedback = professorResult.feedback;

        debugWrite('V5-professor-prompt.txt', professorResult.promptForDebug);
        debugWrite('V5-professor-feedback.txt', professorFeedback);
        console.log(`[V5] Professor review complete: ${professorFeedback.length} chars feedback`);

        // ── Turn 4: Profile Revision (professor + editorial) ─────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 4: Applying professor and editorial review...', step: 30, totalSteps: TOTAL_STEPS });

        const turn4Msg = `Your draft has been reviewed by two lenses. Apply both.

---

PART 1: ANALYTICAL REVIEW

An independent reviewer with deep expertise in donor persuasion methodology has critiqued your draft against the full profiling canon. Their feedback identifies where the analysis is wrong, incomplete, or insufficiently grounded. Apply every correction they identify.

${professorFeedback}

---

PART 2: EDITORIAL REVIEW

Now apply these voice and craft checks to every sentence:

- Name-swap test: swap in a different donor's name. Does the sentence still work? If yes, it's too generic. Sharpen it with evidence specific to this person.
- Performative insight: sounds impressive but tells the reader nothing actionable. "The limitation became the superpower" — what does the reader DO with that? If nothing, cut it.
- Repeated deployment: the same insight re-derived across multiple sections. Find where it first deploys with full treatment. That stays. Every other appearance becomes a one-sentence reference or gets cut.
- Literary construction: mirrored parallelism ("He's not X. He's Y."), compressed aphorisms, matched sentence pairs. Just say the thing.
- Methodology vocabulary in the output: "trust calibration," "substrate reconstruction," "compartmentalized," "subroutine." These are internal terms. If one appears, rewrite in plain behavioral language.
- Quotes deployed as decoration rather than proof. A quote appears because the analysis that follows unpacks it. If the insight stands without the quote, cut the quote.
- Every factual claim must trace to the research package. If you can't point to where in the evidence a claim comes from, delete the claim.
- Section length proportional to evidence density. If you have one paragraph of evidence, don't write three paragraphs of analysis.
- Section openers must be instructions, not descriptions. If the first sentence of a section describes the donor without telling the reader what to do, rewrite it.

Apply all corrections from both reviews. Produce the final profile with no commentary, no edit log, no explanation of changes.`;

        console.log(`[V5] Turn 4 (PROFILE_FINAL): sending ${turn4Msg.length} chars (includes professor feedback: ${professorFeedback.length} chars)`);
        debugWrite('V5-turn-4-critique-user.txt', turn4Msg);

        const turn4Result = await conv1.turn(turn4Msg, 'PROFILE_FINAL', undefined, abortSignal);

        console.log(`[V5] Turn 4 (PROFILE_FINAL): response received, ${turn4Result.text.length} chars, ${turn4Result.inputTokens} input tokens, ${turn4Result.outputTokens} output tokens`);
        debugWrite('V5-turn-4-critique-response.txt', turn4Result.text);

        sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 4 complete — final profile: ${turn4Result.text.length} chars`, step: 32, totalSteps: TOTAL_STEPS });

        const finalProfile = turn4Result.text;

        // ═══════════════════════════════════════════════════════════
        // TURNS 5-6: Briefing Note (still in Conversation 1)
        // ═══════════════════════════════════════════════════════════

        // ── Turn 5: Briefing Note Draft ──────────────────────────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 5: Writing Briefing Note...', step: 33, totalSteps: TOTAL_STEPS });

        const briefingNotesPrompt = loadBriefingNotesPrompt();

        console.log(`[V5] Turn 5 (BRIEFING_NOTE_DRAFT): sending ${briefingNotesPrompt.length} chars`);
        debugWrite('V5-turn-5-bn-user.txt', briefingNotesPrompt);

        const turn5Result = await conv1.turn(briefingNotesPrompt, 'BRIEFING_NOTE_DRAFT', undefined, abortSignal);

        console.log(`[V5] Turn 5 (BRIEFING_NOTE_DRAFT): response received, ${turn5Result.text.length} chars, ${turn5Result.inputTokens} input tokens, ${turn5Result.outputTokens} output tokens`);
        debugWrite('V5-turn-5-bn-response.txt', turn5Result.text);
        sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 5 complete — Briefing Note draft: ${turn5Result.text.length} chars`, step: 33, totalSteps: TOTAL_STEPS });

        // ── BN Professor Review (separate context window) ────────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'writing', message: '[V5] Reviewing Briefing Note...', step: 34, totalSteps: TOTAL_STEPS });

        console.log(`[V5] Running BN professor review — profile: ${finalProfile.length} chars, BN draft: ${turn5Result.text.length} chars`);

        const bnProfessorResult = await runBnProfessorReview(finalProfile, turn5Result.text);
        const bnProfessorFeedback = bnProfessorResult.feedback;

        debugWrite('V5-bn-professor-prompt.txt', bnProfessorResult.promptForDebug);
        debugWrite('V5-bn-professor-feedback.txt', bnProfessorFeedback);
        console.log(`[V5] BN professor review complete: ${bnProfessorFeedback.length} chars feedback`);

        // ── Turn 6: Briefing Note Final ──────────────────────────
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 6: Finalizing Briefing Note...', step: 35, totalSteps: TOTAL_STEPS });

        const turn6Msg = `Your Briefing Note draft has been reviewed. Apply all corrections.

---

PROFESSOR REVIEW:

${bnProfessorFeedback}

---

EDITORIAL CHECKS:

Apply all corrections from the review above. Specifically:

- If load-bearing truths are missing, add them by reducing lower-priority material.
- If any bullet overclaims beyond the full profile, pull back to what the profile actually says.
- If any bullet drifted into meeting guide territory, rewrite as donor behavior description.
- If any bullet is too generic to pass the name-swap test, sharpen with donor-specific detail from the full profile.
- If any section is doing another section's job, move the content.
- If any repeated insight appears, keep the strongest placement and cut the other.
- Preserve evidence ceilings from the full profile. Do not add false confidence.
- Do not exceed 500 words. Do not go below 320 unless the evidence is genuinely thin.

Produce the final Briefing Note with no commentary.`;

        console.log(`[V5] Turn 6 (BRIEFING_NOTE_FINAL): sending ${turn6Msg.length} chars (includes BN professor feedback: ${bnProfessorFeedback.length} chars)`);
        debugWrite('V5-turn-6-bn-critique-user.txt', turn6Msg);

        const turn6Result = await conv1.turn(turn6Msg, 'BRIEFING_NOTE_FINAL', undefined, abortSignal);

        console.log(`[V5] Turn 6 (BRIEFING_NOTE_FINAL): response received, ${turn6Result.text.length} chars, ${turn6Result.inputTokens} input tokens, ${turn6Result.outputTokens} output tokens`);
        debugWrite('V5-turn-6-bn-critique-response.txt', turn6Result.text);
        sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 6 complete — final Briefing Note: ${turn6Result.text.length} chars`, step: 35, totalSteps: TOTAL_STEPS });

        const finalBriefingNote = turn6Result.text;

        const conv1Usage = conv1.getUsage();
        console.log(`[V5] Conversation 1 complete — total: ${conv1Usage.inputTokens} input, ${conv1Usage.outputTokens} output tokens`);

        // ═══════════════════════════════════════════════════════════
        // CONVERSATION 2: Meeting Guide (only if org context provided)
        // ═══════════════════════════════════════════════════════════

        let meetingGuide = '';

        if (projectContextData) {
          sendEvent({ type: 'status', phase: 'writing', message: '[V5] Starting conversation 2 — meeting guide' });

          const conv2SystemPrompt = [
            loadMeetingGuideBlockV3(),
            '---',
            loadMeetingGuideOutputTemplate(),
            '---',
            loadStage0OrgIntakePrompt(),
            '---',
            '# EXEMPLAR ORG FRAME\n\nThe following is a complete strategic frame at the target quality and register.\n\n' + loadTidebreakStrategicFrame(),
          ].join('\n\n');

          console.log(`[V5] Conversation 2 starting — system prompt: ${conv2SystemPrompt.length} chars`);
          debugWrite('V5-conversation-2-system-prompt.txt', conv2SystemPrompt);

          const conv2 = new ConversationManager(conv2SystemPrompt);

          // ── Turn 7: Org Frame ─────────────────────────────────
          let orgFrame = '';

          if (projectContextData.strategicFrame) {
            // Strategic frame already exists — skip Turn 7
            orgFrame = projectContextData.strategicFrame;
            console.log(`[V5] Turn 7 (ORG_FRAME): SKIPPED — using existing frame (${orgFrame.length} chars)`);
            debugWrite('V5-turn-7-org-user.txt', 'SKIPPED — used existing frame');
            debugWrite('V5-turn-7-org-response.txt', orgFrame);

            // Still need to add to conversation history for context
            const skipMsg = `The organization's strategic frame has already been prepared. Here it is:\n\n${orgFrame}`;
            await conv2.turn(skipMsg, 'ORG_FRAME_EXISTING', undefined, abortSignal);
            sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 7: Using existing org frame (${orgFrame.length} chars)`, step: 36, totalSteps: TOTAL_STEPS });
          } else {
            if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
            sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 7: Processing org materials...', step: 36, totalSteps: TOTAL_STEPS });

            const turn7OrgMsg = `Process the following org materials into an Org Strategic Frame.

Organization: ${projectContextData.name}

Description: ${projectContextData.processedBrief}

Issue areas: ${projectContextData.issueAreas || 'Not specified'}

The ask: ${specificAsk || projectContextData.defaultAsk || 'Not specified'}`;

            console.log(`[V5] Turn 7 (ORG_FRAME): sending ${turn7OrgMsg.length} chars`);
            debugWrite('V5-turn-7-org-user.txt', turn7OrgMsg);

            const turn7OrgResult = await conv2.turn(turn7OrgMsg, 'ORG_FRAME', undefined, abortSignal);
            orgFrame = turn7OrgResult.text;

            console.log(`[V5] Turn 7 (ORG_FRAME): response received, ${turn7OrgResult.text.length} chars, ${turn7OrgResult.inputTokens} input tokens, ${turn7OrgResult.outputTokens} output tokens`);
            debugWrite('V5-turn-7-org-response.txt', turn7OrgResult.text);
            sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 7 complete — org frame: ${orgFrame.length} chars`, step: 37, totalSteps: TOTAL_STEPS });
          }

          // ── Turn 8: Meeting Guide Draft ────────────────────────
          if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
          sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 8: Writing meeting guide...', step: 38, totalSteps: TOTAL_STEPS });

          const inesExemplar = loadMeetingGuideInes();
          const lumaExemplar = loadMeetingGuideLuma();
          const ymmraExemplar = loadMeetingGuideYmmra();

          const turn8GuideMsg = `Write the meeting guide for ${donorName} at ${projectContextData.name}.

# DONOR PROFILE

${finalProfile}

# ORG STRATEGIC FRAME

${orgFrame}

# EXEMPLAR GUIDES

The following three guides were all written for the same organization (Tidebreak). Study how the same org context produces different tactical approaches depending on who's across the table.

## EXEMPLAR GUIDE 1
${inesExemplar}

---

## EXEMPLAR GUIDE 2
${lumaExemplar}

---

## EXEMPLAR GUIDE 3
${ymmraExemplar}

Now write the meeting guide following the template and voice spec in your instructions.`;

          console.log(`[V5] Turn 8 (MEETING_GUIDE_DRAFT): sending ${turn8GuideMsg.length} chars, profile: ${finalProfile.length} chars, frame: ${orgFrame.length} chars, exemplars: ${inesExemplar.length + lumaExemplar.length + ymmraExemplar.length} chars`);
          debugWrite('V5-turn-8-guide-user.txt', turn8GuideMsg);

          const turn8GuideResult = await conv2.turn(turn8GuideMsg, 'MEETING_GUIDE_DRAFT', undefined, abortSignal);

          console.log(`[V5] Turn 8 (MEETING_GUIDE_DRAFT): response received, ${turn8GuideResult.text.length} chars, ${turn8GuideResult.inputTokens} input tokens, ${turn8GuideResult.outputTokens} output tokens`);
          debugWrite('V5-turn-8-guide-response.txt', turn8GuideResult.text);
          sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 8 complete — meeting guide draft: ${turn8GuideResult.text.length} chars`, step: 39, totalSteps: TOTAL_STEPS });

          // ── Turn 9: Meeting Guide Critique & Final ─────────────
          if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
          sendEvent({ type: 'status', phase: 'writing', message: '[V5] Turn 9: Critiquing meeting guide...', step: 40, totalSteps: TOTAL_STEPS });

          const turn9CritiqueMsg = `Critique this meeting guide against the voice spec and the exemplars. Check:

- Beat titles and goals must be verbatim from the template — do not modify them
- Every bulleted section has exactly 3 or 5 bullets — never 2, 4, or 6+
- STAY sections include at least one stalling indicator with a recovery move
- Where to Focus references the organization's actual strategic components by name
- Logistics rationales are tied to this donor's psychology, not generic meeting advice
- At least one tripwire is about the fundraiser's likely mistake, not the donor's behavior
- CONTINUE signals are observable states, not internal feelings
- One Line contains a tension or paradox specific to this donor
- No content from the fictional exemplars (Tidebreak, Inés, Orekh, Ymmra, pirate, octopus, reef, substrate, mycorrhizal) appears in the output

Apply all corrections. Produce the final meeting guide with no commentary.`;

          console.log(`[V5] Turn 9 (MEETING_GUIDE_FINAL): sending ${turn9CritiqueMsg.length} chars`);
          debugWrite('V5-turn-9-critique-user.txt', turn9CritiqueMsg);

          const turn9CritiqueResult = await conv2.turn(turn9CritiqueMsg, 'MEETING_GUIDE_FINAL', undefined, abortSignal);

          console.log(`[V5] Turn 9 (MEETING_GUIDE_FINAL): response received, ${turn9CritiqueResult.text.length} chars, ${turn9CritiqueResult.inputTokens} input tokens, ${turn9CritiqueResult.outputTokens} output tokens`);
          debugWrite('V5-turn-9-critique-response.txt', turn9CritiqueResult.text);

          meetingGuide = turn9CritiqueResult.text;

          const conv2Usage = conv2.getUsage();
          console.log(`[V5] Conversation 2 complete — total: ${conv2Usage.inputTokens} input, ${conv2Usage.outputTokens} output tokens`);
          sendEvent({ type: 'status', phase: 'writing', message: `[V5] Turn 9 complete — final meeting guide: ${meetingGuide.length} chars`, step: 41, totalSteps: TOTAL_STEPS });

          // Write token usage for both conversations
          const tokenUsage = {
            conversation1: conv1Usage,
            conversation2: conv2Usage,
            totals: {
              inputTokens: conv1Usage.inputTokens + conv2Usage.inputTokens,
              outputTokens: conv1Usage.outputTokens + conv2Usage.outputTokens,
            },
          };
          debugWrite('V5-token-usage.json', JSON.stringify(tokenUsage, null, 2));

          // Estimate cost (Opus 4.6 rates: $5/M input, $25/M output)
          const costEstimate = (tokenUsage.totals.inputTokens / 1_000_000) * 5 + (tokenUsage.totals.outputTokens / 1_000_000) * 25;
          console.log(`[V5] Total cost estimate: $${costEstimate.toFixed(2)} (${tokenUsage.totals.inputTokens} input + ${tokenUsage.totals.outputTokens} output tokens at Opus rates)`);
        } else {
          // No org context — write token usage for conversation 1 only
          const tokenUsage = {
            conversation1: conv1.getUsage(),
            conversation2: null,
            totals: conv1.getUsage(),
          };
          debugWrite('V5-token-usage.json', JSON.stringify(tokenUsage, null, 2));
          const costEstimate = (tokenUsage.totals.inputTokens / 1_000_000) * 5 + (tokenUsage.totals.outputTokens / 1_000_000) * 25;
          console.log(`[V5] Total cost estimate: $${costEstimate.toFixed(2)} (${tokenUsage.totals.inputTokens} input + ${tokenUsage.totals.outputTokens} output tokens at Opus rates)`);
          console.log(`[V5] No org context provided — skipping meeting guide`);
        }

        // ═══════════════════════════════════════════════════════════
        // Save outputs
        // ═══════════════════════════════════════════════════════════

        // Save debug output files
        ensureOutputDir();
        writeFileSync(`${OUTPUT_DIR}/${requestId}-${safeName}-profile.md`, finalProfile);
        writeFileSync(`${OUTPUT_DIR}/${requestId}-${safeName}-briefing-note.md`, finalBriefingNote);
        if (meetingGuide) {
          writeFileSync(`${OUTPUT_DIR}/${requestId}-${safeName}-meeting-guide.md`, meetingGuide);
        }

        // Format result for frontend compatibility
        const result: any = {
          research: {
            ...research,
            rawMarkdown: `[V5 conversation mode — no research package, see debug files]`,
            sources: research.sources || [],
          },
          researchProfile: { rawMarkdown: finalProfile },
          profile: {
            donorName,
            profile: finalProfile,
            validationPasses: 0,
            status: 'complete',
          },
          briefingNote: finalBriefingNote,
          meetingGuide,
          fundraiserName,
        };

        STATUS.pipelineComplete();
        console.log(`[V5] Pipeline complete, storing result`);

        // Save to Postgres
        let profileId: string | undefined;
        if (userId) {
          try {
            const dbProfile = await prisma.profile.create({
              data: {
                userId,
                donorName,
                profileMarkdown: finalProfile,
                briefingNoteMarkdown: finalBriefingNote || null,
                meetingGuideMarkdown: meetingGuide || null,
                researchPackageJson: null,
                linkedinDataJson: linkedinData ? JSON.stringify(linkedinData) : null,
                seedUrlsJson: seedUrls.length > 0 ? JSON.stringify(seedUrls) : null,
                confidenceScores: confidenceResult ? JSON.stringify(confidenceResult.sections) : null,
                dimensionCoverage: null,
                sourceCount: selectedSources.length,
                projectContextId: projectContextId || null,
                relationshipContext: relationshipContext || null,
                fundraiserName: fundraiserName || null,
                specificAsk: specificAsk || null,
                pipelineVersion: 'v5-conversation',
                status: 'complete',
              },
            });
            profileId = dbProfile.id;
            console.log(`[V5] Saved profile to database: ${dbProfile.id}`);
            await linkJobToProfile(jobId, dbProfile.id);
          } catch (dbErr) {
            console.error(`[V5] Failed to save profile to database:`, dbErr);
          }
        }

        result.profileId = profileId;
        completeJob(jobId, result);

      } catch (error) {
        const isAbort = error instanceof Error && (
          error.name === 'AbortError' ||
          error.message === 'Pipeline aborted by client'
        );
        if (isAbort) {
          console.log(`[V5] Pipeline cancelled by user`);
          return;
        }
        console.error(`[V5] Pipeline error:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        STATUS.pipelineError(errorMessage);
        failJob(jobId, errorMessage);
      }
    });
  } catch (outerError) {
    console.error(`[V5] Outer pipeline error:`, outerError);
    failJob(jobId, outerError instanceof Error ? outerError.message : 'Unknown error');
  }
}
