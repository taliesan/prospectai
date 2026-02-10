import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

/**
 * GET /api/debug-dump?file=<key>
 *
 * Available files:
 *   ?file=extraction-prompt  — Stage 2 input (extraction prompt)
 *   ?file=extraction         — Stage 2 output (behavioral evidence)
 *   ?file=prompt             — Stage 3 input (profile prompt)
 *   ?file=first-draft        — Stage 3 output (first draft profile)
 *   ?file=critique-prompt    — Stage 3b input (critique prompt, if enabled)
 *   ?file=final              — Stage 3b output (final profile, if enabled)
 *   ?file=meeting-guide-prompt — Stage 4 input (meeting guide prompt)
 *   ?file=meeting-guide       — Stage 4 output (meeting guide markdown)
 *   ?file=meeting-guide-html  — Stage 4 output (meeting guide styled HTML)
 *   ?file=linkedin           — Parsed LinkedIn data (JSON)
 */
export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');

  const files: Record<string, string> = {
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
  const contentType = file === 'linkedin' ? 'application/json'
    : file === 'meeting-guide-html' ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
  const ext = file === 'linkedin' ? 'json'
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
