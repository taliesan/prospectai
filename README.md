# ProspectAI

Premium donor profiling system that generates behavioral intelligence for fundraising meetings.

## What This Does

ProspectAI takes a donor name and produces three outputs:

1. **Raw Research** — Comprehensive search results from multiple queries, fully traceable
2. **Behavioral Dossier** — 17-dimension analysis of behavioral patterns, contradictions, and meeting dynamics
3. **Persuasion Profile** — 7-section tactical guide for your meeting

The key differentiator is **behavioral focus** — not "who they are" but "how they'll behave in your meeting."

## Architecture

```
User Input (donor name)
    ↓
Step 1: Research
    - Identity resolution
    - Query generation (15-25 targeted searches)
    - Source collection and classification
    ↓
Step 2: Behavioral Dossier
    - Per-source evidence extraction (17 dimensions)
    - Pattern synthesis across sources
    - Cross-cutting analysis (contradiction, dangerous truth, substrate)
    ↓
Step 3: Profile Generation
    - Canon-guided generation
    - Validation loop (generator + validator)
    - Up to 3 refinement passes
    ↓
Output: Research + Dossier + Profile
```

## Setup

### Prerequisites

- Node.js 18+
- Anthropic API key

### Installation

```bash
# Clone or download the project
cd prospectai

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY

# Run development server
npm run dev
```

### Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

Recommended deployment platforms:
- Vercel (easiest for Next.js)
- Railway
- Fly.io

## Configuration

### Canon Documents

The system quality depends on loading the canon documents. Place these in `src/lib/canon/`:

- `memos.ts` — The 13 Memos
- `fieldguide.ts` — Field Guide for Profilers  
- `cognition.ts` — Cognition Manual
- `exemplars.ts` — A+++ Canonical Profiles

### Search API

The system needs web search capability. Options:

1. **Tavily API** (recommended) — Set `TAVILY_API_KEY`
2. **Custom search** — Implement `searchFunction` in pipeline.ts

## Key Files

```
src/
├── app/
│   ├── page.tsx              # Input form
│   ├── profile/[name]/       # Profile display
│   └── api/generate/         # Main API endpoint
├── lib/
│   ├── pipeline.ts           # Core orchestration
│   ├── anthropic.ts          # Claude client
│   ├── prompts/
│   │   ├── research.ts       # Step 1 prompts
│   │   ├── extraction.ts     # Step 2 prompts
│   │   ├── profile.ts        # Step 3 prompts
│   │   └── validation.ts     # Validator prompts
│   ├── canon/
│   │   └── loader.ts         # Canon document loading
│   └── types.ts              # TypeScript interfaces
```

## The Validation Loop

The system includes a self-correction mechanism:

1. Generator produces draft profile
2. Validator evaluates against A+++ standard
3. If validation fails, critique is fed back to generator
4. Generator produces revised draft
5. Loop continues until PASS or max 3 attempts

This replicates the human correction process that produces A+++ quality.

## Quality Standard

A valid profile must:

- ✓ Be behavioral (describe how they move, not who they are)
- ✓ Be specific (fail the name-swap test)
- ✓ Have conditional logic (when X, they do Y)
- ✓ Surface contradictions (tension between stated and revealed)
- ✓ Make retreat patterns explicit
- ✓ Be fully grounded in dossier evidence
- ✓ Match exemplar quality

## Specifications

Full system specifications are in:

- `MASTER_SYSTEM_SPECIFICATION.md` — Complete system design
- `DOSSIER_SPECIFICATION.md` — 17-dimension extraction methodology

## License

Proprietary. For internal use only.
