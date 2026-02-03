import { NextRequest, NextResponse } from 'next/server';
import { runFullPipeline } from '@/lib/pipeline';

// This would be loaded from files in production
const EXEMPLAR_PROFILES = `
## ⭐ DONOR PERSUASION PROFILE — ROY BAHAT (A+++)
(Gold-standard exemplar)

## 1. Donor Identity & Background
● He uses "messiness" as both shield and signal. When people try to frame his career as elite or linear (Rhodes Scholar → Bloomberg LP → VC), he disrupts the frame by stressing detours, luck, and misfit energy. That maneuver is not humility; it's how he keeps conversations grounded in real mechanism rather than prestige. When the room accepts the reframed identity, he becomes more direct and strategic.

● His cross-sector trajectory — government, media, gaming, academia, venture, labor — shows up behaviorally when he scans for mismatches between institutional logic and human behavior. When someone describes a problem through the lens of one sector alone, he pushes for a wider aperture. That pressure is his way of marking the conversation as under-scoped.

● He reads systems through actors, not abstractions. When he asks about who holds power, who feels exposed, or who decides, he is not gathering color — he is mapping incentives. If a counterpart can articulate the lived dynamics of a system rather than its ideals, he shifts into collaborative co-design.

## 2. Core Motivations, Values & Triggers
● He is motivated by reconciling two forces: the leverage of technology companies and the vulnerability of workers inside those systems. When someone names that tension outright, his attention sharpens and he moves toward designing a remedy. When the tension is glossed over, he reads the frame as unserious and begins withdrawing through procedural language.

● He trusts people who acknowledge randomness in outcomes. When others admit the role of luck, he interprets it as intellectual honesty and disarms. When people present success as fully earned, he becomes cautious; he tests whether they can tolerate counterexamples without becoming brittle.

● His core contradiction is transparency vs. exposure. He prefers to be open, even if it leaves him vulnerable, but expects reciprocity. When someone names their own uncertainty or risk, he engages fully. When someone performs vulnerability without stakes, he shuts the door quietly.

## 3. Ideal Engagement Style
● He responds best to conversations shaped as iterative diagnostics: map the system → surface the brittleness → test a mechanism → update the frame. When someone follows this rhythm, he treats them as a co-architect. When they jump straight to solutions, he slows the tempo and inserts clarifying questions to rebuild foundations.

● He tests for intellectual humility early. If someone says "I don't know" with conviction, he probes with a small contradiction. If they explore, he joins; if they defend, he withdraws. That moment determines the depth of the entire interaction.

## 4. Challenges & Risk Factors
● Casting him as a symbol — "the good VC," "the labor-friendly investor" — triggers distancing behavior. He responds with polite abstraction, shifting to norms, governance, or process instead of the immediate topic. This is his ego-defense against being flattened or misread.

● His shame trigger is unpreparedness from others. When a counterpart lacks clarity about what they want or what problem they are solving, he collapses the meeting via "circle back" language. He will not rescue a disorganized frame; he quietly exits it.

## 5. Strategic Opportunities for Alignment
● He aligns most with work that treats agency as infrastructure. If your strategy redistributes decision rights or changes how workers exert leverage, he recognizes it as part of the future-of-work experimentation portfolio he's building.

● Experimentation is his adoption lever. If you frame your project as one of several tests required to understand a new labor or tech dynamic, he sees how your work can sit inside his broader architecture. This lowers his bar for saying yes.

## 6. Tactical Approach to the Meeting
● Start by naming the tension. Opening with the brittle part of the strategy ("Here's the real bottleneck," "Here's the imbalance we're addressing") signals you aren't selling him a story. It positions him as a peer problem-solver, which he values.

● The closing should offer a bounded experiment, not a grand ask. A small introduction, a 60-day test, or a chance to refine a governance rule gives him space to act without overcommitting.

## 7. Dinner Party Test
What would alienate or bore him?
● Surface-level arguments with no operational stakes.
● Binary thinking that treats labor or tech as monoliths.
● Performative vulnerability or curated self-story arcs.

What would enthrall him?
● Stories where incentives collide and people improvise new rules.
● Honest ignorance ("let's pull this apart") that invites collaborative reasoning.
`;

// Simple search function using web_search
// In production, this would use a proper search API
async function webSearch(query: string): Promise<{ url: string; title: string; snippet: string }[]> {
  // This is a placeholder - in production, would use Tavily or similar
  // For now, return empty results (the pipeline will handle this gracefully)
  console.log(`[Search] Query: ${query}`);
  
  // Simulated delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { donorName, seedUrls = [] } = body;

    if (!donorName || typeof donorName !== 'string') {
      return NextResponse.json(
        { error: 'Donor name is required' },
        { status: 400 }
      );
    }

    console.log(`[API] Starting profile generation for: ${donorName}`);

    const result = await runFullPipeline(
      donorName,
      seedUrls,
      webSearch,
      { exemplars: EXEMPLAR_PROFILES }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json(
      { error: 'Profile generation failed' },
      { status: 500 }
    );
  }
}
