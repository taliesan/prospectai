import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

/**
 * GET /api/debug-dump?file=<key>
 *
 * Available files:
 *   V5 Conversation Mode (7-turn pipeline):
 *   ?file=v5-conv1-system         — Conversation 1 system prompt
 *   ?file=v5-turn1-user           — Turn 1 (Research) user message
 *   ?file=v5-turn1-response       — Turn 1 (Research) response
 *   ?file=v5-turn2-user           — Turn 2 (Research Critique) user message
 *   ?file=v5-turn2-response       — Turn 2 (Research Critique) response
 *   ?file=v5-turn3-user           — Turn 3 (Profile Draft) user message
 *   ?file=v5-turn3-response       — Turn 3 (Profile Draft) response
 *   ?file=v5-turn4-user           — Turn 4 (Profile Final) user message
 *   ?file=v5-turn4-response       — Turn 4 (Profile Final) response
 *   ?file=v5-conv2-system         — Conversation 2 system prompt
 *   ?file=v5-turn5-user           — Turn 5 (Org Frame) user message
 *   ?file=v5-turn5-response       — Turn 5 (Org Frame) response
 *   ?file=v5-turn6-user           — Turn 6 (Meeting Guide Draft) user message
 *   ?file=v5-turn6-response       — Turn 6 (Meeting Guide Draft) response
 *   ?file=v5-turn7-user           — Turn 7 (Meeting Guide Final) user message
 *   ?file=v5-turn7-response       — Turn 7 (Meeting Guide Final) response
 *   ?file=v5-token-usage          — Token usage summary (JSON)
 *
 *   Phase 1 (Own Voice):
 *   ?file=phase1-sources          — Phase 1 source list
 *   ?file=phase1-conversation     — Phase 1 full conversation log (JSON)
 *
 *   Phase 2 (Pressure & Context):
 *   ?file=phase2-sources          — Phase 2 source list
 *   ?file=phase2-conversation     — Phase 2 full conversation log (JSON)
 *
 *   Phase 3 (Extraction & Gap-Fill):
 *   ?file=phase3-research-package — Phase 3 research package (24-dim extraction)
 *   ?file=phase3-conversation     — Phase 3 full conversation log (JSON)
 *
 *   Combined (backward-compatible):
 *   ?file=research-package        — Research package (same as phase3-research-package)
 *   ?file=research-conversation   — Research conversation (same as phase3-conversation)
 *
 *   Profile & Meeting Guide:
 *   ?file=prompt                  — Profile generation input (profile prompt)
 *   ?file=first-draft             — Profile generation output (first draft)
 *   ?file=critique-prompt         — Critique/redraft input (if enabled)
 *   ?file=final                   — Critique/redraft output (final profile, if enabled)
 *   ?file=meeting-guide-prompt    — Meeting guide input
 *   ?file=meeting-guide           — Meeting guide output (markdown)
 *   ?file=meeting-guide-html      — Meeting guide output (styled HTML)
 *   ?file=linkedin                — Parsed LinkedIn data (JSON)
 *
 *   Legacy:
 *   ?file=extraction-prompt       — Legacy: Stage 2 input (extraction prompt)
 *   ?file=extraction              — Legacy: Stage 2 output (behavioral evidence)
 */
export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');

  const files: Record<string, string> = {
    // V5 conversation mode files
    'v5-conv1-system': '/tmp/prospectai-outputs/V5-conversation-1-system-prompt.txt',
    'v5-turn1-user': '/tmp/prospectai-outputs/V5-turn-1-research-user.txt',
    'v5-turn1-response': '/tmp/prospectai-outputs/V5-turn-1-research-response.txt',
    'v5-turn2-user': '/tmp/prospectai-outputs/V5-turn-2-critique-user.txt',
    'v5-turn2-response': '/tmp/prospectai-outputs/V5-turn-2-critique-response.txt',
    'v5-turn3-user': '/tmp/prospectai-outputs/V5-turn-3-profile-user.txt',
    'v5-turn3-response': '/tmp/prospectai-outputs/V5-turn-3-profile-response.txt',
    'v5-turn4-user': '/tmp/prospectai-outputs/V5-turn-4-critique-user.txt',
    'v5-turn4-response': '/tmp/prospectai-outputs/V5-turn-4-critique-response.txt',
    'v5-conv2-system': '/tmp/prospectai-outputs/V5-conversation-2-system-prompt.txt',
    'v5-turn5-user': '/tmp/prospectai-outputs/V5-turn-5-org-user.txt',
    'v5-turn5-response': '/tmp/prospectai-outputs/V5-turn-5-org-response.txt',
    'v5-turn6-user': '/tmp/prospectai-outputs/V5-turn-6-guide-user.txt',
    'v5-turn6-response': '/tmp/prospectai-outputs/V5-turn-6-guide-response.txt',
    'v5-turn7-user': '/tmp/prospectai-outputs/V5-turn-7-critique-user.txt',
    'v5-turn7-response': '/tmp/prospectai-outputs/V5-turn-7-critique-response.txt',
    'v5-token-usage': '/tmp/prospectai-outputs/V5-token-usage.json',
    // Per-phase debug files
    'phase1-sources': '/tmp/prospectai-outputs/DEBUG-phase1-sources.txt',
    'phase1-conversation': '/tmp/prospectai-outputs/DEBUG-phase1-conversation.json',
    'phase2-sources': '/tmp/prospectai-outputs/DEBUG-phase2-sources.txt',
    'phase2-conversation': '/tmp/prospectai-outputs/DEBUG-phase2-conversation.json',
    'phase3-research-package': '/tmp/prospectai-outputs/DEBUG-phase3-research-package.txt',
    'phase3-conversation': '/tmp/prospectai-outputs/DEBUG-phase3-conversation.json',
    // Backward-compatible combined files
    'research-package': '/tmp/prospectai-outputs/DEBUG-research-package.txt',
    'research-conversation': '/tmp/prospectai-outputs/DEBUG-research-conversation.json',
    // Profile & meeting guide
    prompt: '/tmp/prospectai-outputs/DEBUG-prompt.txt',
    'first-draft': '/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt',
    'critique-prompt': '/tmp/prospectai-outputs/DEBUG-critique-prompt.txt',
    'final': '/tmp/prospectai-outputs/DEBUG-profile-final.txt',
    'meeting-guide-prompt': '/tmp/prospectai-outputs/DEBUG-meeting-guide-prompt.txt',
    'meeting-guide': '/tmp/prospectai-outputs/DEBUG-meeting-guide.md',
    'meeting-guide-html': '/tmp/prospectai-outputs/DEBUG-meeting-guide.html',
    linkedin: '/tmp/prospectai-outputs/DEBUG-linkedin-data.json',
    // v5 pipeline diagnostics
    'screening-audit': '/tmp/prospectai-outputs/DEBUG-screening-audit.txt',
    'source-selection': '/tmp/prospectai-outputs/DEBUG-source-selection.txt',
    'source-packet-manifest': '/tmp/prospectai-outputs/DEBUG-source-packet-manifest.txt',
    'deep-research-developer-msg': '/tmp/prospectai-outputs/DEBUG-deep-research-developer-msg.txt',
    'deep-research-user-msg': '/tmp/prospectai-outputs/DEBUG-deep-research-user-msg.txt',
    'fact-check': '/tmp/prospectai-outputs/DEBUG-fact-check.json',
    // Legacy
    extraction: '/tmp/prospectai-outputs/DEBUG-extraction.txt',
    'extraction-prompt': '/tmp/prospectai-outputs/DEBUG-extraction-prompt.txt',
  };

  if (!file || !files[file]) {
    return new Response(
      JSON.stringify({
        error: 'Invalid file parameter',
        available: Object.keys(files),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const path = files[file];
  if (!existsSync(path)) {
    return new Response(
      JSON.stringify({ error: `File not found: ${path}. Run a profile first.` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const content = readFileSync(path, 'utf-8');
  const jsonFiles = ['linkedin', 'research-conversation', 'phase1-conversation', 'phase2-conversation', 'phase3-conversation', 'fact-check', 'v5-token-usage'];
  const contentType = jsonFiles.includes(file) ? 'application/json'
    : file === 'meeting-guide-html' ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
  const ext = jsonFiles.includes(file) ? 'json'
    : file === 'meeting-guide-html' ? 'html'
    : file === 'meeting-guide' ? 'md'
    : 'txt';

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="DEBUG-${file}.${ext}"`,
    },
  });
}
