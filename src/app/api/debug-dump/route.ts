import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

/**
 * GET /api/debug-dump?file=<key>
 *
 * Available files:
 *   ?file=research-package      — Research agent output (24-dim behavioral evidence)
 *   ?file=research-conversation — Full agent conversation log (JSON, for debugging)
 *   ?file=extraction-prompt     — Legacy: Stage 2 input (extraction prompt)
 *   ?file=extraction            — Legacy: Stage 2 output (behavioral evidence)
 *   ?file=prompt                — Profile generation input (profile prompt)
 *   ?file=first-draft           — Profile generation output (first draft)
 *   ?file=critique-prompt       — Critique/redraft input (if enabled)
 *   ?file=final                 — Critique/redraft output (final profile, if enabled)
 *   ?file=meeting-guide-prompt  — Meeting guide input
 *   ?file=meeting-guide         — Meeting guide output (markdown)
 *   ?file=meeting-guide-html    — Meeting guide output (styled HTML)
 *   ?file=linkedin              — Parsed LinkedIn data (JSON)
 */
export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');

  const files: Record<string, string> = {
    'research-package': '/tmp/prospectai-outputs/DEBUG-research-package.txt',
    'research-conversation': '/tmp/prospectai-outputs/DEBUG-research-conversation.json',
    extraction: '/tmp/prospectai-outputs/DEBUG-extraction.txt',
    'extraction-prompt': '/tmp/prospectai-outputs/DEBUG-extraction-prompt.txt',
    prompt: '/tmp/prospectai-outputs/DEBUG-prompt.txt',
    'first-draft': '/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt',
    'critique-prompt': '/tmp/prospectai-outputs/DEBUG-critique-prompt.txt',
    'final': '/tmp/prospectai-outputs/DEBUG-profile-final.txt',
    'meeting-guide-prompt': '/tmp/prospectai-outputs/DEBUG-meeting-guide-prompt.txt',
    'meeting-guide': '/tmp/prospectai-outputs/DEBUG-meeting-guide.md',
    'meeting-guide-html': '/tmp/prospectai-outputs/DEBUG-meeting-guide.html',
    linkedin: '/tmp/prospectai-outputs/DEBUG-linkedin-data.json',
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
  const jsonFiles = ['linkedin', 'research-conversation'];
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
