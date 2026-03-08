import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

/**
 * GET /api/debug-dump?file=<key>
 *
 * Available files:
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
  const jsonFiles = ['linkedin', 'research-conversation', 'phase1-conversation', 'phase2-conversation', 'phase3-conversation', 'fact-check'];
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
