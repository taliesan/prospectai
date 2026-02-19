# ProspectAI — Comprehensive System Audit

**Generated: 2026-02-14**
**Purpose: Spec compliance review — documents exactly how every system currently works**

---

## TABLE OF CONTENTS

1. [Architecture Overview](#1-architecture-overview)
2. [Two Pipeline Paths](#2-two-pipeline-paths)
3. [LLM Helper Functions (anthropic.ts)](#3-llm-helper-functions)
4. [Pipeline A: Coded Pipeline (pipeline.ts)](#4-pipeline-a-coded-pipeline)
5. [Pipeline B: Conversation Pipeline (conversation-pipeline.ts)](#5-pipeline-b-conversation-pipeline)
6. [Research Subsystem](#6-research-subsystem)
7. [Prompt Files](#7-prompt-files)
8. [Dimensions & Source Scoring](#8-dimensions--source-scoring)
9. [Canon Document System](#9-canon-document-system)
10. [Content Sanitization](#10-content-sanitization)
11. [API & Frontend Architecture](#11-api--frontend-architecture)
12. [Meeting Guide Formatter](#12-meeting-guide-formatter)
13. [Complete LLM Call Inventory](#13-complete-llm-call-inventory)
14. [Dead Code & Legacy Artifacts](#14-dead-code--legacy-artifacts)
15. [Critical Model Mismatch Issues](#15-critical-model-mismatch-issues)

---

## 1. ARCHITECTURE OVERVIEW

ProspectAI generates donor "Persuasion Profiles" and "Meeting Guides" from web research. The system:

1. Parses a LinkedIn PDF for biographical data
2. Conducts web research (via Tavily search API and/or OpenAI deep research)
3. Screens, tiers, and deduplicates sources
4. Extracts behavioral evidence across 25 dimensions
5. Generates an 18-section Persuasion Profile
6. Applies an editorial critique/redraft pass
7. Generates a tactical Meeting Guide
8. Formats the Meeting Guide as styled HTML

**There are two completely separate pipeline paths**, selected by environment variable or API route:

| Pipeline | File | Entry Point | Research Method | Extraction Model |
|----------|------|-------------|-----------------|-----------------|
| **Coded Pipeline** | `pipeline.ts` | `runFullPipeline()` | Tavily search + coded orchestration (or OpenAI deep research if `RESEARCH_PROVIDER=openai`) | Opus (streaming) or o3-deep-research |
| **Conversation Pipeline** | `conversation-pipeline.ts` | `runConversationPipeline()` | Agentic Sonnet/Opus sessions with tool use + coded bulk fetch + single Opus extraction | Opus (single call) |

---

## 2. TWO PIPELINE PATHS

### 2.1 Which Path Runs?

Currently, only the **Coded Pipeline** (`pipeline.ts`) is wired to the API route (`src/app/api/generate/route.ts:263`). The Conversation Pipeline exists but is **not invoked by any API route**. It would need to be explicitly imported and called.

The Coded Pipeline itself has an internal branch at line 1200:
```
RESEARCH_PROVIDER=openai    → v5 hybrid pipeline (Tavily breadth + Deep Research synthesis)
RESEARCH_PROVIDER=anthropic → Legacy Tavily pipeline (coded extraction)
```
Default is `openai`.

### 2.2 Shared Components

Both pipelines share:
- LinkedIn PDF parsing (via `unpdf` + LLM extraction)
- Canon document loading (`canon/loader.ts`)
- Profile prompt building (`profile-prompt.ts`)
- Critique/redraft prompt (`critique-redraft-prompt.ts`)
- Meeting guide prompt (`meeting-guide.ts`)
- Meeting guide HTML formatter
- The `conversationTurn()` function for profile generation, editorial pass, and meeting guide

---

## 3. LLM HELPER FUNCTIONS (anthropic.ts)

**File:** `src/lib/anthropic.ts` (145 lines)

Four exported functions. **Every function defaults to Sonnet** unless overridden:

### 3.1 `complete(systemPrompt, userPrompt, options?)`
- **Default model:** `claude-sonnet-4-20250514` (line 24)
- **Default max_tokens:** 8192
- **Default temperature:** 0.7
- **Model overridable:** YES via `options.model`
- **Used by:** Identity extraction, query generation, screening, source scoring, legacy extraction batches, legacy synthesis, legacy cross-cutting

### 3.2 `completeWithHistory(systemPrompt, messages, options?)`
- **Default model:** `claude-sonnet-4-20250514` (line 58)
- **Default max_tokens:** 8192
- **Default temperature:** 0.7
- **Model overridable:** YES via `options.model`
- **Used by:** Not currently called by any pipeline code (dead code?)

### 3.3 `completeExtended(systemPrompt, userPrompt, options?)`
- **Default model:** `claude-sonnet-4-20250514` (line 93) — **HARDCODED, NOT OVERRIDABLE**
- **Default max_tokens:** 16000
- **No temperature parameter** (uses API default)
- **Model NOT overridable** — no `model` in options destructure
- **Used by:** Legacy pipeline's synthesis step, legacy profile generation, legacy profile regeneration

### 3.4 `conversationTurn(messages, options?)`
- **Default model:** `claude-sonnet-4-20250514` (line 127) — **HARDCODED, NOT OVERRIDABLE**
- **Default max_tokens:** 16000
- **System prompt:** `'You are writing a donor persuasion profile.'` (hardcoded, line 129)
- **Model NOT overridable** — no `model` in options destructure
- **Supports abortSignal:** YES
- **Used by:** LinkedIn parsing (conversation-pipeline), profile generation (conversation-pipeline), editorial pass (BOTH pipelines), meeting guide generation (BOTH pipelines)

---

## 4. PIPELINE A: CODED PIPELINE (pipeline.ts)

**File:** `src/lib/pipeline.ts` (1697 lines)
**Entry point:** `runFullPipeline()` (line 1104)
**Total steps:** 38

### 4.0 LinkedIn PDF Parsing (lines 1122-1195)
- **Input:** Base64-encoded PDF
- **PDF extraction:** `unpdf` library's `extractText()`
- **Coded regex extraction:** `extractLinkedInCodedFields()` for LinkedIn slug and personal websites
- **LLM call:** `complete('You are a data extraction assistant.', parsePrompt, { maxTokens: 4000 })`
  - **Model:** Sonnet (via `complete()` default)
  - **Purpose:** Extract career history, education, boards from PDF text
- **Merge:** Coded regex results override LLM results for slug and websites (more reliable)
- **Output:** `LinkedInData` object

### Branch Point: RESEARCH_PROVIDER (line 1200)

---

### 4.A v5 HYBRID PIPELINE (RESEARCH_PROVIDER=openai, default)

#### Stage 0: Identity Extraction (lines 1234-1266)
- **LLM call:** `complete('You are a research assistant.', identityPrompt)`
  - **Model:** Sonnet
  - **Purpose:** Extract identity from seed URL
- **LinkedIn enrichment:** Merges LinkedIn data as authoritative for career facts

#### Stage 1: Query Generation (lines 1268-1282)
- **LLM call:** `complete('You are a research strategist...', queryPrompt)`
  - **Model:** Sonnet
  - **Purpose:** Generate 40-80 targeted search queries in categories A/B/C
- **Prompt builder:** `generateResearchQueries()` from `prompts/research.ts`
- **Output:** `CategorizedQuery[]` parsed from JSON response

#### Stage 2: Search Execution (lines 1284-1346)
- **NO LLM calls** — pure Tavily API
- **Concurrency:** 3 parallel search requests
- **Dedup:** Cross-query URL deduplication via `Set`
- **Blog crawl:** `crawlSubjectPublishing()` adds tier 1 sources
- **Output:** Combined `ResearchSource[]` (blog + Tavily)

#### Stage 3: Screening & Attribution (lines 1348-1357)
- **Function:** `runScreeningPipeline()` from `research/screening.ts`
- **LLM calls:** `complete()` in batches of 25 sources
  - **Model:** Sonnet
  - **Purpose:** Person disambiguation + attribution classification
- **Auto pre-filter:** Junk URL patterns, name check (no LLM)
- **Fail-open policy:** On LLM error, all sources accepted
- **Output:** Sources with attribution tags (`target_authored`, `target_coverage`, `institutional_inference`, `target_reshare`)

#### Stage 4: Content Fetch + Dedup (lines 1359-1401)
- **NO LLM calls** — coded orchestration
- **Fetch:** `executeFetchPage()` via Tavily Extract API (fallback: direct HTTP)
- **Concurrency:** 8 parallel fetches
- **Dedup:** `deduplicateSources()` from `research/dedup.ts`
  - URL normalization (strip tracking params, normalize protocol/www)
  - LinkedIn overlap (Jaccard similarity > 0.6 against LinkedIn post contents)
  - Content fingerprinting (shingle-based Jaccard > 0.8 = duplicate)
  - Attribution rank tiebreaking (target_authored > target_coverage > etc.)

#### Stage 5: Dimension Scoring & Selection (lines 1403-1414)
- **Function:** `runDimensionScoring()` from `prompts/source-scoring.ts`
- **Stage 5a — Scoring:** `scoreBatch()` calls `complete()` in batches of 18
  - **Model:** Sonnet (via `complete()` default, no model override)
  - **max_tokens:** 8192
  - **Purpose:** Score each source on 25 dimensions (depth 0-3)
  - **Parallel:** All batches run concurrently via `Promise.all`
  - **Retry:** One retry on failure, then all-zeros
- **Stage 5b — Selection:** `selectSources()` — **NO LLM, pure algorithm**
  - Iterative greedy selection with scarcity-weighted scoring
  - Formula: `Σ(depth × tier_weight × scarcity) × diversity_bonus / char_count × 1000`
  - Scarcity = `min(target / max(coverage, 0.5), SCARCITY_CAP=6.0)`
  - Content budget: 100,000 chars
  - Diversity bonuses: [1.3, 1.15, 1.05, 1.0] for 0/1/2/3+ sources of same tier
- **Output:** Selected sources + coverage gap report

#### Stage 6: Research Synthesis via Deep Research (lines 1416-1457)
- **Function:** `runDeepResearchV5()` from `research/deep-research.ts`
- **Model:** `o3-deep-research-2025-06-26` (OpenAI)
- **max_output_tokens:** 100,000
- **max_tool_calls:** 20
- **reasoning.effort:** `'medium'`
- **background mode:** true (fire and poll)
- **Poll interval:** 10 seconds
- **Max poll duration:** 45 minutes
- **Developer message:** 6-section structured instruction (A-F):
  - A: Task definition + bounded synthesis rules
  - B: 25 behavioral dimensions
  - C: Coverage gap report from Stage 5
  - D: Search behavior constraints (read first, then gap-fill)
  - E: Source attribution guidance
  - F: LinkedIn biographical data
- **User message:** Pre-fetched sources formatted with dimension scores
- **Output:** Research dossier (30,000-60,000 chars target)

---

### Step 3: Profile Generation (lines 1531-1576) — SHARED BY BOTH BRANCHES
- **Direct Anthropic SDK streaming** (NOT via helper functions)
- **Model:** `claude-opus-4-20250514` (line 1554, hardcoded in stream call)
- **max_tokens:** 16,000
- **System prompt:** `'You are writing a donor persuasion profile.'`
- **Prompt builder:** `buildProfilePrompt()` — 5-layer architecture:
  1. Geoffrey Block (voice specification)
  2. Exemplar profiles
  3. Canonical biographical data (LinkedIn)
  4. Behavioral evidence (research package)
  5. Output instructions (18-section structure, evidence class A/B)
- **Evidence class detection:** Counts first-person quotes in extraction output; ≥5 = Class A, <5 = Class B
- **Streaming:** Accumulates text, reports progress every 30 seconds

### Step 3b: Editorial Pass (lines 1578-1606) — SHARED
- **Function:** `conversationTurn()` from `anthropic.ts`
- **Model:** `claude-sonnet-4-20250514` (hardcoded in conversationTurn, line 127)
- **max_tokens:** 16,000
- **Prompt builder:** `buildCritiqueRedraftPrompt()` — 6-layer architecture:
  1. Geoffrey Block
  2. Exemplar profiles
  3. Canonical biographical data
  4. Behavioral evidence
  5. First draft profile
  6. Editorial instructions (raise sophistication, compress restatement, deduplicate quotes)

> **CRITICAL FINDING:** The pipeline comments say "Step 3b: Editorial Pass (Opus)" and "Step 3b: Editorial pass (Sonnet)" — contradictory labels. The actual model used is **Sonnet** because `conversationTurn()` is hardcoded to Sonnet at anthropic.ts:127. The pipeline log says `[Pipeline] Step 3b: Editorial pass (Sonnet)` — **this is correct**.

### Step 4: Meeting Guide (lines 1608-1643) — SHARED
- **Function:** `conversationTurn()` from `anthropic.ts`
- **Model:** `claude-sonnet-4-20250514` (hardcoded in conversationTurn)
- **max_tokens:** 8,000
- **Prompt builder:** `buildMeetingGuidePrompt()` — 5-layer architecture:
  1. Meeting Guide Block (voice specification)
  2. Meeting Guide exemplars
  3. DTW Organization Layer (org reference data)
  4. Input material (Persuasion Profile with transformation framing)
  5. Output format instructions
- **HTML formatting:** `formatMeetingGuideEmbeddable()` (for frontend) + `formatMeetingGuide()` (full standalone)

---

### 4.B LEGACY TAVILY PIPELINE (RESEARCH_PROVIDER=anthropic)

#### Research Phase (lines 1462-1479)
- **Function:** `conductResearch()` (line 100)
- Calls `crawlSubjectPublishing()` for blog posts
- Generates queries via `complete()` (Sonnet)
- Executes Tavily searches (3 concurrent)
- Screens via `runScreeningPipeline()` (Sonnet in batches)
- Tiers via `tierSources()` + `enforceTargets()` (coded, no LLM)
- **Tier targets:** T1: 8-15, T2: 8-12, T3: 3-5, Total: 20-30

#### Fat Extraction (lines 1481-1528)
- **Direct Anthropic SDK streaming** (NOT via helper functions)
- **Model:** `claude-opus-4-20250514` (line 1502, hardcoded)
- **max_tokens:** 32,000
- **Prompt builder:** `buildExtractionPrompt()` — assembles all source texts
  - Max source chars: 520,000 (~130K tokens)
  - Max single source: 50,000 chars
  - Sources sorted by tier (T1 first)
  - Sources dropped lowest-tier-first when exceeding budget
- **Output:** 25,000-30,000 token research package organized by 25 dimensions

Then flows into shared Step 3 (Profile), Step 3b (Editorial), Step 4 (Meeting Guide).

---

### 4.C DEAD LEGACY CODE IN pipeline.ts

#### `extractEvidence()` (line 756)
- **Status:** DEAD CODE — not called by `runFullPipeline()`
- Uses batch extraction (10 sources/batch) → synthesis → cross-cutting analysis
- All calls via `complete()` or `completeExtended()` (both Sonnet)
- Would produce a very different output structure than the current fat extraction

#### `generateProfile()` (line 984)
- **Status:** DEAD CODE — not called by `runFullPipeline()`
- Uses `createProfilePrompt()` from `prompts/profile.ts` (different from `buildProfilePrompt()` from `profile-prompt.ts`)
- Includes a (disabled) validation loop (maxAttempts hardcoded to 1)
- Uses `completeExtended()` (Sonnet, NOT Opus)

#### `screenSourcesForRelevance()` (line 476)
- **Status:** DEAD CODE — replaced by `runScreeningPipeline()` from `research/screening.ts`
- Kept for "backward compat" per comment

#### `rankSourceByBehavioralValue()` (line 657)
- **Status:** Only used by `extractEvidence()` which is dead code

---

## 5. PIPELINE B: CONVERSATION PIPELINE (conversation-pipeline.ts)

**File:** `src/lib/conversation-pipeline.ts` (489 lines)
**Entry point:** `runConversationPipeline()` (line 188)
**Architecture comment:** "v8 — Single-Call Extraction"
**Cost estimate in comments:** ~$9-10 per profile

### Feature Flag
```typescript
const ENABLE_CRITIQUE_REDRAFT = true;  // line 48
```

### Stage 1: Phased Research (line 244)
- **Function:** `runPhasedResearch()` from `research/agent.ts`
- See Section 6.1 for details
- **Output:** Research package (25-30K token evidence extraction)

### Stage 2: Profile Generation (lines 281-328)
- **Function:** `conversationTurn()` from `anthropic.ts`
- **Model:** `claude-sonnet-4-20250514` (hardcoded in conversationTurn)
- **max_tokens:** 16,000
- **Prompt:** `buildProfilePrompt()` — same 5-layer architecture as pipeline.ts

> **CRITICAL FINDING:** The conversation pipeline's cost comment says "Profile generation (Opus): ~$2.00" but the actual model used is **Sonnet** via `conversationTurn()` which is hardcoded to `claude-sonnet-4-20250514`. The cost estimate is wrong.

### Stage 2b: Critique & Redraft (lines 330-382)
- **Gated by:** `ENABLE_CRITIQUE_REDRAFT` flag (default: true)
- **Function:** `conversationTurn()` from `anthropic.ts`
- **Model:** `claude-sonnet-4-20250514` (hardcoded in conversationTurn)
- **max_tokens:** 16,000
- **Prompt:** `buildCritiqueRedraftPrompt()` — same as pipeline.ts

> **Same issue:** Comment says "Editorial pass (Opus): ~$2.00" — actually runs on **Sonnet**.

### Stage 3: Meeting Guide (lines 384-466)
- **Function:** `conversationTurn()` from `anthropic.ts`
- **Model:** `claude-sonnet-4-20250514` (hardcoded)
- **max_tokens:** 8,000
- **HTML formatting:** Same as pipeline.ts

### Return Value Quirk (line 482)
```typescript
researchPackage: finalProfile,  // Frontend reads this for display
```
The `researchPackage` field in the return object is actually set to `finalProfile`, NOT the research package. The actual research package is stored in the `draft` field. This is intentional for frontend display compatibility.

---

## 6. RESEARCH SUBSYSTEM

### 6.1 Phased Research Agent (research/agent.ts)

**File:** `src/lib/research/agent.ts`
**Used by:** Conversation pipeline only

#### Pre-Phase: Blog Crawl
- **Function:** `crawlSubjectPublishing()` from `blog-crawler.ts`
- **No LLM calls** — coded URL discovery + Tavily fetch

#### Phase 1: Own Voice (Agentic Session)
- **Function:** `runAgentSession()` (line 85)
- **Model:** `claude-opus-4-20250514` (line 89, default parameter)
- **max_tokens:** 16,000 per turn
- **System prompt:** `PHASE_1_SYSTEM_PROMPT` from `phase-1-prompt.ts`
- **Tools:** `web_search` (Tavily) + `fetch_page` (Tavily Extract)
- **Max loops:** 100
- **Purpose:** Find everything the subject has written or said publicly
- **Output:** Numbered source list with URLs and annotations

#### Phase 2: Pressure & Context (Agentic Session)
- **Function:** `runAgentSession()` — same runner as Phase 1
- **Model:** `claude-opus-4-20250514` (same default)
- **System prompt:** `PHASE_2_SYSTEM_PROMPT` from `phase-2-prompt.ts`
- **Tools:** Same as Phase 1
- **Purpose:** Find external evidence — coverage of transitions, controversies, peer accounts
- **Input includes:** Phase 1 source list (so Phase 2 doesn't re-search)
- **Output:** Additional numbered source list

#### Bulk Fetch (Coded)
- Parses URLs from Phase 1+2 text output via regex (`parseUrlsFromPhaseOutput()`)
- Fetches all pages via `executeFetchPage()` (Tavily Extract, fallback: direct HTTP)
- **Concurrency:** 8 parallel fetches
- **Page content truncated to:** 40,000 chars per page (in agent session tool results)

#### Screen + Tier (Coded + LLM)
- `runScreeningPipeline()` — same as pipeline.ts Stage 3
- `tierSources()` + `enforceTargets()` — same as pipeline.ts

#### Extraction: Single Opus Call
- **Direct Anthropic SDK** (not via helper functions)
- **Model:** `claude-opus-4-20250514` (hardcoded in agent.ts)
- **max_tokens:** 32,000
- **Prompt builder:** `buildExtractionPrompt()` from `extraction-prompt.ts`
- **Output:** 25,000-30,000 token research package

### 6.2 Screening (research/screening.ts)

**Two-pass filter on search results:**

**Auto pre-filter (no LLM):**
- Junk URL patterns (17 patterns: whitepages, spokeo, beenverified, etc.)
- Name variant check (skipped for Category B institutional queries)
- `bypassScreening` flag for blog crawl and user-supplied sources

**LLM screening (batches of 25):**
- **Function:** `complete()` — Sonnet
- **max_tokens:** 4,096
- **Pass 1:** Person disambiguation (right person?)
- **Pass 2:** Attribution classification (KEEP with type or KILL with reason)
- **Fail-open policy:** On LLM error or parse failure, all sources accepted

**Attribution types assigned:**
- `target_authored` — Subject wrote this
- `target_coverage` — Third party wrote about subject
- `institutional_inference` — Org action during subject's tenure
- `target_reshare` — Subject reshared with substantive commentary

**Kill reasons:**
- `passive_interaction` — Mere like/reshare
- `directory_listing` — Staff page, board list
- `wrong_attribution` — Content by someone else
- `wrong_person` — Different person

### 6.3 Tiering (research/tiering.ts)

**3-tier classification system (NOT 5-tier — see note below):**

| Tier | Label | Signals |
|------|-------|---------|
| 1 | Subject's own voice | Blog posts, interviews with high first-person pronouns, LinkedIn posts (author slug verified), personal domain, Substack, Medium, podcast/video with first-person content |
| 2 | Third-party with quotes | Direct quotes from subject, behavioral description patterns, in-depth profiles, major publication coverage, speeches/keynotes |
| 3 | Institutional/background | Team/about pages, bios, annual reports, press releases, Wikipedia, Crunchbase, LinkedIn profile pages, brief mentions (<1500 chars) |

> **NOTE:** `dimensions.ts` defines a 5-tier SourceTier type (`1|2|3|4|5`), and `source-scoring.ts` Stage 5a uses 5 tiers for scoring. But `tiering.ts` only classifies into 3 tiers. The 5-tier system is used by the v5 pipeline's dimension scoring; the 3-tier system is used by the legacy pipeline's `enforceTargets()`.

**Tier targets (enforceTargets):**
- T1: min 8, max 15
- T2: min 8, max 12
- T3: min 3, max 5
- Total: min 20, max 30
- Overflow drops T3 first, then T2

**LinkedIn author slug verification:**
- Extracts slug from `/posts/authorslug_activityid` pattern
- Compares against subject's LinkedIn slug from profile
- Match → Tier 1; no match → Tier 2

### 6.4 Deduplication (research/dedup.ts)

Three-step deduplication:

1. **URL normalization** — Strips tracking params (utm_*, fbclid, gclid, etc.), normalizes protocol to HTTPS, removes www prefix, trailing slash, hash. Keeps source with more content.
2. **LinkedIn overlap** — Jaccard similarity > 0.6 between fetched URL content and LinkedIn post contents. Removes the non-LinkedIn duplicate.
3. **Content fingerprinting** — 5-word shingle Jaccard similarity > 0.8. Keeps higher-attribution-rank source. Only applied to content > 200 chars.

**Attribution rank for tiebreaking:** target_authored(1) > target_coverage(2) > target_reshare(3) > institutional_inference(4) > unknown(5)

### 6.5 Blog Crawler (research/blog-crawler.ts)

Discovers and fetches the subject's personal publishing:
- Searches for personal website/blog via Tavily
- Crawls blog archive pages for individual post URLs
- Fetches each post via Tavily Extract
- Tags sources with `source: 'blog_crawl'` and `bypassScreening: true`

### 6.6 Research Tools (research/tools.ts)

**Two tools provided to agentic sessions:**

1. **`web_search`** — Tavily Search API
   - `search_depth: 'advanced'`, `max_results: 10`
   - Returns: `{ title, url, snippet }[]`

2. **`fetch_page`** — Tavily Extract API (fallback: direct HTTP)
   - Content sanitized via `sanitizeForClaude()`
   - Returns: cleaned text string

### 6.7 Deep Research (research/deep-research.ts)

**OpenAI o3-deep-research integration:**

- **Model:** `o3-deep-research-2025-06-26`
- **API:** OpenAI Responses API with `background: true`
- **Tools:** `web_search_preview` (OpenAI's built-in)
- **max_output_tokens:** 100,000
- **max_tool_calls:** 20
- **reasoning.effort:** `'medium'`
- **Polling:** Every 10 seconds, max 45 minutes
- **Retry:** 3 attempts for `responses.retrieve()` with exponential backoff (2s, 4s, 8s)
- **Activity tracking:** Reports searches, page visits, reasoning steps to job store
- **Output validation:** `validateResearchPackage()` checks length and citation density

**Developer message structure (6 sections):**
- A: Task definition — 3 layers (extraction, pattern identification, gap reporting)
- B: 25 behavioral dimensions with investment tiers
- C: Coverage gap report from Stage 5
- D: Search behavior — read first, then gap-fill (max 15-20 searches)
- E: Source attribution guidance
- F: LinkedIn biographical data JSON

**Legacy entry points (backward compat):**
- `runDeepResearchPipeline()` — standalone deep research without pre-fetched sources
- `runDeepResearchV5()` — v5 pipeline entry point with pre-fetched sources

---

## 7. PROMPT FILES

### 7.1 research.ts (prompts/research.ts)

**Exports:**
- `IDENTITY_EXTRACTION_PROMPT` — Extracts identity signals (name, role, org, education, affiliations) from seed URL content. Returns JSON.
- `QUERY_GENERATION_PROMPT` — Generates 40-80 search queries in 3 categories (A: direct name, B: institutional actions during tenure, C: network/affiliations). Includes 25-dimension targeting. Profile-type adaptive mix (HIGH/MODERATE/LOW profile).
- `generateResearchQueries()` — Builds the full Stage 1 prompt with identity + LinkedIn JSON + seed URL content
- `generateSupplementaryQueryPrompt()` — For retry when initial search yields <30 URLs
- `parseQueryGenerationResponse()` — Parses JSON query response
- `SOURCE_CLASSIFICATION_PROMPT` — Legacy prompt for source classification (kept for backward compat)
- `CategorizedQuery` interface

### 7.2 extraction-prompt.ts (prompts/extraction-prompt.ts)

**The main extraction prompt for the "fat extraction" approach.**

- `EXTRACTION_PROMPT` — 243-line instruction for producing a 25,000-30,000 token behavioral evidence package
  - ENTRY FORMAT: Long quotes with source, shape, and surrounding context
  - DIMENSION BUDGET: HIGH (1,500-2,000 tokens, 6-8 entries), MEDIUM (1,000-1,200, 4-6), LOW (400-800, 1-3)
  - Lists all 25 dimensions with descriptions
  - Tier labels: 1-5 (vs tiering.ts's 1-3)

- `buildExtractionPrompt()` — Assembles source texts with tier labels, LinkedIn data, and extraction instructions
  - **Token budget:** 520,000 chars (~130K tokens) for sources
  - **Single source cap:** 50,000 chars
  - Sorts by tier (T1 first), drops lowest-tier first

- `LinkedInData` interface — canonical type for parsed LinkedIn data

### 7.3 extraction.ts (prompts/extraction.ts)

**Legacy batch extraction prompts (used by dead `extractEvidence()` function):**
- `createBatchExtractionPrompt()` — Batch of sources → JSON evidence extraction
- `SYNTHESIS_PROMPT` — Dimension-by-dimension synthesis
- `CROSS_CUTTING_PROMPT` — Cross-cutting analysis (core contradiction, dangerous truth, substrate architecture)
- **Status:** Dead code — not used by active pipeline

### 7.4 profile-prompt.ts (prompts/profile-prompt.ts)

**Active profile prompt builder (5-layer architecture):**

- `buildProfilePrompt()` — Assembles:
  1. Geoffrey Block (full, unmodified voice specification)
  2. Exemplar profiles (all 3, unselected)
  3. Canonical biographical data (from LinkedIn, if available)
  4. Behavioral evidence (research package with preamble)
  5. Output instructions:
     - 18-section structure (exact headings, exact order)
     - Evidence class A (rich public record) or B (institutional channels)
     - Writing principles (earn space once, section length follows evidence, evidence ceiling brackets)
     - Section 4 must name a usable contradiction
     - Section 5 must flag most important sentence
     - Section 6 must follow three-stage structure (entry condition, permission logic, behavioral commitment)

- **Evidence class detection:** Counts `"..."` patterns containing first-person pronouns. ≥5 = Class A, <5 = Class B.

### 7.5 profile.ts (prompts/profile.ts)

**Legacy profile prompts (used by dead `generateProfile()` function):**
- `createProfilePrompt()` — Older prompt format
- `createRegenerationPrompt()` — For validation-loop regeneration
- **Status:** Dead code

### 7.6 critique-redraft-prompt.ts

**Editorial pass prompt (6-layer architecture):**

- `buildCritiqueRedraftPrompt()` — Assembles:
  1. Geoffrey Block
  2. Exemplar profiles
  3. Canonical biographical data
  4. Behavioral evidence
  5. First draft profile
  6. Editorial instructions:
     - Raise sophistication (behavioral inference over description)
     - Compress restatement (insight appears once with full treatment)
     - Deduplicate quotes
     - Earn every paragraph
     - Add evidence ceiling brackets
     - Do not invent, do not soften
     - Structural requirements (18 sections, contradiction in S4, most-important sentence in S5, three-stage in S6)

### 7.7 meeting-guide.ts

**Meeting guide prompt (5-layer architecture):**

- `buildMeetingGuidePrompt()` — Assembles:
  1. Meeting Guide Block (voice specification)
  2. Meeting Guide exemplars (3 canonical guides)
  3. Organization reference data (DTW org layer)
  4. Input material (Persuasion Profile with transformation framing)
  5. Output format instructions:
     - Document header with donor name, org, date
     - 5 major sections: THE DONOR READ, THE ALIGNMENT MAP, THE MEETING ARC, READING THE ROOM, RESET MOVES
     - 5 beats in THE MEETING ARC with MOVE + SIGNALS (ADVANCE/HOLD/ADJUST)
     - Specific formatting requirements for each section

### 7.8 source-scoring.ts (prompts/source-scoring.ts)

See Section 8 below.

### 7.9 phase-1-prompt.ts

**Phase 1 system prompt for agentic research (Own Voice):**
- Find everything the subject has written, said, or been quoted at length
- Priority: personal blog → LinkedIn posts → podcast appearances → interviews → conference talks → op-eds → org publications
- NOT looking for: institutional bios, press releases, brief mentions
- Search strategy: personal website archive → name + content types → name + employers → LinkedIn articles/Medium/Substack
- Output: numbered source list with URL, type, content summary, read status

### 7.10 phase-2-prompt.ts

**Phase 2 system prompt for agentic research (Pressure & Context):**
- Find external evidence about behavior — not self-reported
- What to find: career transition coverage, org controversies, peer testimonials, org performance, awards, legal filings, social media discussions, reviews
- Search strategy: name + controversy/praised/left/resigned → employer + name → industry publications → colleagues' perspectives
- Output: same format as Phase 1, plus note on what wasn't found

### 7.11 research-agent-prompt.ts

- `buildResearchBrief()` — Builds the research brief user message for phased research. Includes LinkedIn data, seed URL content, and assignment description.

---

## 8. DIMENSIONS & SOURCE SCORING

### 8.1 Dimensions (dimensions.ts)

**25 canonical behavioral dimensions, single source of truth:**

| ID | Key | Tier | Target |
|----|-----|------|--------|
| 1 | DECISION_MAKING | HIGH | 6-8 |
| 2 | TRUST_CALIBRATION | HIGH | 6-8 |
| 3 | INFLUENCE_SUSCEPTIBILITY | MEDIUM | 4-6 |
| 4 | COMMUNICATION_STYLE | HIGH | 6-8 |
| 5 | LEARNING_STYLE | LOW | 1-3 |
| 6 | TIME_ORIENTATION | MEDIUM | 4-6 |
| 7 | IDENTITY_SELF_CONCEPT | HIGH | 6-8 |
| 8 | VALUES_HIERARCHY | HIGH | 6-8 |
| 9 | STATUS_RECOGNITION | LOW | 1-3 |
| 10 | BOUNDARY_CONDITIONS | MEDIUM | 4-6 |
| 11 | EMOTIONAL_TRIGGERS | MEDIUM | 4-6 |
| 12 | RELATIONSHIP_PATTERNS | MEDIUM | 4-6 |
| 13 | RISK_TOLERANCE | MEDIUM | 4-6 |
| 14 | RESOURCE_PHILOSOPHY | MEDIUM | 4-6 |
| 15 | COMMITMENT_PATTERNS | MEDIUM | 4-6 |
| 16 | KNOWLEDGE_AREAS | LOW | 1-3 |
| 17 | CONTRADICTION_PATTERNS | HIGH | 6-8 |
| 18 | RETREAT_PATTERNS | LOW | 1-3 |
| 19 | SHAME_DEFENSE_TRIGGERS | LOW | 1-3 |
| 20 | REAL_TIME_INTERPERSONAL_TELLS | LOW | 1-3 |
| 21 | TEMPO_MANAGEMENT | LOW | 1-3 |
| 22 | HIDDEN_FRAGILITIES | LOW | 1-3 |
| 23 | RECOVERY_PATHS | LOW | 1-3 |
| 24 | CONDITIONAL_BEHAVIORAL_FORKS | LOW | 1-3 |
| 25 | POWER_ANALYSIS | HIGH | 6-8 |

**Summary:** 7 HIGH, 8 MEDIUM, 10 LOW

**Source tier types (5-tier, used by scoring):**
1. Podcast/interview/video — unscripted voice
2. Press profile, journalist coverage, third-party analysis
3. Self-authored (op-eds, LinkedIn posts, blog)
4. Institutional evidence during tenure (inferential)
5. Structural records (990s, filings, lobbying registries)

**Attribution types:** `target_authored`, `target_coverage`, `institutional_inference`, `target_reshare`
**Kill reasons:** `passive_interaction`, `directory_listing`, `wrong_attribution`, `wrong_person`

### 8.2 Source Scoring (prompts/source-scoring.ts)

**Stage 5a — Depth Scoring:**
- Sonnet scores sources in parallel batches of 18
- Integer depth scores 0-3 per dimension per source
- Also classifies source tier (1-5)
- Returns `ScoredSource[]`

**Stage 5b — Source Selection (no LLM):**
- Iterative greedy algorithm
- Score = `Σ(depth × TIER_WEIGHTS[dim] × min(target/max(coverage, 0.5), SCARCITY_CAP)) × DIVERSITY_BONUSES[tier_count] / char_count × 1000`
- **TIER_WEIGHTS:** HIGH dims ×3, MEDIUM dims ×2, LOW dims ×1
- **INVESTMENT_TARGETS:** HIGH=7, MEDIUM=5, LOW=2
- **SCARCITY_CAP:** 6.0
- **DIVERSITY_BONUSES:** [1.3, 1.15, 1.05, 1.0]
- **CONTENT_BUDGET_CHARS:** 100,000
- **SCORING_BATCH_SIZE:** 18

**Gap report statuses:** SUFFICIENT, GAP, CRITICAL_GAP, ZERO_COVERAGE
- ZERO_COVERAGE: 0 sources
- CRITICAL_GAP: < 50% of target
- GAP: < 100% of target
- SUFFICIENT: ≥ target

**Backward compat exports:** `SOURCE_SCORING_PROMPT`, `buildScoringPromptCompat`, `calculateWeightedScore`, `selectTopSources`

---

## 9. CANON DOCUMENT SYSTEM

### 9.1 Canon Loader (canon/loader.ts)

All files loaded **eagerly at module init** (read-only, cached):

| File | Export Function | Purpose |
|------|----------------|---------|
| `exemplars.md` | `loadExemplars()` | 3 exemplar Persuasion Profiles |
| `geoffrey-block.md` | `loadGeoffreyBlock()` | Voice specification for profile writing |
| `meeting-guide-block.md` | `loadMeetingGuideBlock()` | Voice specification for meeting guides |
| `meeting-guide-exemplars.md` | `loadMeetingGuideExemplars()` | 3 exemplar Meeting Guides |
| `dtw-org-layer.md` | `loadDTWOrgLayer()` | Democracy Takes Work organization reference data |

`selectExemplars()` is a no-op — returns all exemplars unselected (line 32: "No selection logic - the model needs to see the full range").

---

## 10. CONTENT SANITIZATION (sanitize.ts)

**`sanitizeForClaude(content, url?)`** — Main sanitization function:

1. **`stripImages()`** — Removes:
   - Markdown images `![alt](url)`
   - HTML `<img>`, `<picture>`, `<figure>`, `<source>`, `<svg>` tags
   - Base64 data URLs
   - Cleans up resulting triple+ newlines

2. **`stripLinkedInBoilerplate()`** — Only for LinkedIn URLs. Removes:
   - "More Relevant Posts" / "Relevant posts" section and everything after
   - "Recommended by LinkedIn" section
   - Sign-in prompts
   - "You might also like" section
   - LinkedIn navigation chrome
   - Cookie/privacy banners
   - Engagement UI (likes, comments, reposts)

---

## 11. API & FRONTEND ARCHITECTURE

### 11.1 API Route: POST /api/generate (route.ts)

**Architecture:** Fire-and-poll (not SSE streaming)

1. **POST `/api/generate`** — Creates job, starts pipeline in background, returns `{ jobId }`
2. **GET `/api/generate/status/[jobId]`** — Polls job status
3. **GET `/api/generate/cancel/[jobId]`** — Cancels running job

**Request body:**
```json
{
  "donorName": "string (required)",
  "fundraiserName": "string (optional, default '')",
  "seedUrls": "string[] (optional, default [])",
  "linkedinPdf": "string (optional, base64)"
}
```

**Pipeline invoked:** `runFullPipeline()` from `pipeline.ts`
- The conversation pipeline is NOT wired to any API route

**Output files saved to `/tmp/prospectai-outputs/`:**
- `{requestId}-{name}-research.md`
- `{requestId}-{name}-profile.md`
- `{requestId}-{name}-research-package.md`
- `{requestId}-{name}-meeting-guide.md`
- `{requestId}-{name}-research-full.json`

### 11.2 Job Store (job-store.ts)

**In-memory `Map<string, Job>`** — relies on Railway's persistent container model.

**Job states:** `running`, `complete`, `failed`, `cancelled`

**Job TTL:** 30 minutes (cleanup interval: 5 minutes)

**AbortController per job** — for user-initiated cancellation. Signal propagated to pipeline.

**Activity tracking:** Deep research reports progress (searches, page visits, reasoning steps) via `updateActivity()`.

### 11.3 Progress System (progress.ts)

**`ProgressEvent` type** with:
- `type`: `'phase' | 'status' | 'error' | 'complete'`
- `phase`: `'research' | 'analysis' | 'writing'`
- `message`, `step`, `totalSteps`

**`STATUS` object** — convenience methods for common progress events (e.g., `pipelineStarted()`, `researchComplete()`, `profileComplete()`).

---

## 12. MEETING GUIDE FORMATTER (formatters/meeting-guide-formatter.ts)

**Parses intermediate markdown format into structured data, then renders to styled HTML.**

**Parsed structure (`ParsedGuide`):**
- `donorName`, `subtitle`
- `posture` (2-3 paragraphs)
- `lightsUp` / `shutsDown` (4-5 bulleted items each)
- `walkInExpecting` (short paragraph)
- `innerTruth` (2-3 paragraphs)
- `primaryTerritory`, `secondaryTerritories[]`
- `setting`, `energy`
- `beats[]` (5 beats, each with `moveParagraphs[]` and `signals[]`)
- `working[]` / `stalling[]` (6 items each, middle-dot separated)
- `resetMoves[]` (3-4 items, each with condition + move + why)

**Two output modes:**
- `formatMeetingGuide()` — Full standalone HTML document with `<html>`, `<head>`, styles
- `formatMeetingGuideEmbeddable()` — Fragment for embedding in frontend (no `<html>` wrapper)

---

## 13. COMPLETE LLM CALL INVENTORY

### Active v5 Hybrid Pipeline (RESEARCH_PROVIDER=openai)

| Step | Function | Model | max_tokens | Purpose |
|------|----------|-------|------------|---------|
| LinkedIn parse | `complete()` | Sonnet | 4,000 | Extract career/education from PDF |
| Identity extraction | `complete()` | Sonnet | 8,192 | Extract identity from seed URL |
| Query generation | `complete()` | Sonnet | 8,192 | Design 40-80 search queries |
| Screening (×N batches) | `complete()` | Sonnet | 4,096 | Person disambiguation + attribution |
| Dimension scoring (×N batches) | `complete()` | Sonnet | 8,192 | Score sources on 25 dimensions |
| Deep research synthesis | OpenAI API | o3-deep-research | 100,000 | Bounded synthesis with gap-fill |
| Profile generation | `anthropic.messages.stream()` | **Opus** | 16,000 | Write 18-section Persuasion Profile |
| Editorial pass | `conversationTurn()` | **Sonnet** | 16,000 | Critique and redraft |
| Meeting guide | `conversationTurn()` | **Sonnet** | 8,000 | Write tactical meeting guide |

### Active Legacy Tavily Pipeline (RESEARCH_PROVIDER=anthropic)

| Step | Function | Model | max_tokens | Purpose |
|------|----------|-------|------------|---------|
| LinkedIn parse | `complete()` | Sonnet | 4,000 | Extract career/education from PDF |
| Identity extraction | `complete()` | Sonnet | 8,192 | Extract identity from seed URL |
| Query generation | `complete()` | Sonnet | 8,192 | Design search queries |
| Screening (×N batches) | `complete()` | Sonnet | 4,096 | Source screening |
| Fat extraction | `anthropic.messages.stream()` | **Opus** | 32,000 | Read all sources, produce evidence package |
| Profile generation | `anthropic.messages.stream()` | **Opus** | 16,000 | Write Persuasion Profile |
| Editorial pass | `conversationTurn()` | **Sonnet** | 16,000 | Critique and redraft |
| Meeting guide | `conversationTurn()` | **Sonnet** | 8,000 | Write meeting guide |

### Conversation Pipeline (not currently wired to API)

| Step | Function | Model | max_tokens | Purpose |
|------|----------|-------|------------|---------|
| LinkedIn parse | `conversationTurn()` | **Sonnet** | 4,000 | Extract career/education from PDF |
| Phase 1 agentic session (×N loops) | `anthropic.messages.create()` | **Opus** | 16,000 | Own Voice source discovery |
| Phase 2 agentic session (×N loops) | `anthropic.messages.create()` | **Opus** | 16,000 | Pressure & Context discovery |
| Screening (×N batches) | `complete()` | Sonnet | 4,096 | Source screening |
| Fat extraction | `anthropic.messages.stream()` | **Opus** | 32,000 | Single-call evidence extraction |
| Profile generation | `conversationTurn()` | **Sonnet** | 16,000 | Write Persuasion Profile |
| Editorial pass | `conversationTurn()` | **Sonnet** | 16,000 | Critique and redraft |
| Meeting guide | `conversationTurn()` | **Sonnet** | 8,000 | Write meeting guide |

---

## 14. DEAD CODE & LEGACY ARTIFACTS

| Item | Location | Status |
|------|----------|--------|
| `extractEvidence()` | pipeline.ts:756 | Dead — not called by any active path |
| `generateProfile()` | pipeline.ts:984 | Dead — not called by any active path |
| `screenSourcesForRelevance()` | pipeline.ts:476 | Dead — replaced by `runScreeningPipeline()` |
| `rankSourceByBehavioralValue()` | pipeline.ts:657 | Dead — only used by dead `extractEvidence()` |
| `rankAndSortSources()` | pipeline.ts:735 | Dead — only used by dead `extractEvidence()` |
| `completeWithHistory()` | anthropic.ts:46 | Dead — not called anywhere |
| `createBatchExtractionPrompt()` | prompts/extraction.ts | Dead — used by dead `extractEvidence()` |
| `SYNTHESIS_PROMPT` | prompts/extraction.ts | Dead |
| `CROSS_CUTTING_PROMPT` | prompts/extraction.ts | Dead |
| `createProfilePrompt()` | prompts/profile.ts | Dead — used by dead `generateProfile()` |
| `createRegenerationPrompt()` | prompts/profile.ts | Dead |
| `SOURCE_SCORING_PROMPT` | source-scoring.ts | Dead — deprecated string |
| `buildScoringPromptCompat()` | source-scoring.ts | Dead — backward compat |
| `calculateWeightedScore()` | source-scoring.ts | Dead — legacy scoring |
| `selectTopSources()` | source-scoring.ts | Dead — legacy selection |
| `SOURCE_CLASSIFICATION_PROMPT` | prompts/research.ts | Dead — legacy classification |
| `OLD_DIM_RENAMES` / `OLD_DIM_FOLDINS` | dimensions.ts | Migration artifacts |
| Entire conversation pipeline | conversation-pipeline.ts | Not wired to API — orphaned |
| `runDeepResearchPipeline()` | deep-research.ts | Legacy standalone entry point |

---

## 15. CRITICAL MODEL MISMATCH ISSUES

### 15.1 conversationTurn() is Hardcoded to Sonnet

**Impact:** Every call to `conversationTurn()` uses **Sonnet**, not Opus, regardless of what the caller expects.

**Affected steps:**
- **Profile generation** (conversation-pipeline.ts) — comment says "Opus ~$2.00", actually runs Sonnet
- **Editorial pass** (both pipelines) — comment in pipeline.ts says "Step 3b: Editorial Pass (Opus)" at line 1578, but uses `conversationTurn()` which is Sonnet
- **Meeting guide** (both pipelines) — uses `conversationTurn()` = Sonnet
- **LinkedIn parsing** (conversation-pipeline only) — uses `conversationTurn()` = Sonnet

### 15.2 completeExtended() is Hardcoded to Sonnet

**Impact:** The dead `extractEvidence()` pathway would use Sonnet for synthesis and cross-cutting analysis. Not currently active.

### 15.3 Profile Generation Model Differs Between Pipelines

- **pipeline.ts Step 3:** Uses `anthropic.messages.stream()` with **Opus** (hardcoded at line 1554)
- **conversation-pipeline.ts Stage 2:** Uses `conversationTurn()` with **Sonnet** (hardcoded at anthropic.ts:127)

These produce the same output type (Persuasion Profile) with the same prompt, but different model quality.

### 15.4 Cost Estimates in conversation-pipeline.ts are Wrong

The header comment says:
```
Cost per profile: ~$9-10
  - Extraction (Opus, single call): ~$4.50
  - Profile generation (Opus): ~$2.00
  - Editorial pass (Opus): ~$2.00
```

Actual models used:
- Extraction: Opus (correct — agent.ts hardcodes Opus for streaming)
- Profile generation: **Sonnet** (via conversationTurn)
- Editorial pass: **Sonnet** (via conversationTurn)

The real cost would be significantly lower than $9-10 since Sonnet is cheaper than Opus.

### 15.5 Editorial Pass Comment vs Reality in pipeline.ts

Line 1578: `emit('Scoring first draft against production standard...', ...)`
Line 1579: `console.log('[Pipeline] Step 3b: Editorial pass (Sonnet)');` — **correct**
But the emit message and section header both call it an "Opus" pass in nearby comments. The console log is accurate.

---

*End of audit. Every model assignment, function signature, data flow path, and feature flag documented above reflects the actual codebase as of 2026-02-14.*
