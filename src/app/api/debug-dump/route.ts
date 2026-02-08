import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

/**
 * GET /api/debug-dump?file=extraction|prompt
 *
 * Returns the debug files saved during pipeline execution.
 * Temporary endpoint — remove after testing.
 */
export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');

  const files: Record<string, string> = {
    extraction: '/tmp/prospectai-outputs/DEBUG-extraction.txt',
    prompt: '/tmp/prospectai-outputs/DEBUG-prompt.txt',
    linkedin: '/tmp/prospectai-outputs/DEBUG-linkedin-data.json',
  };

  if (!file || !files[file]) {
    return new Response(
      JSON.stringify({ error: 'Use ?file=extraction or ?file=prompt or ?file=linkedin' }),
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
  const contentType = file === 'linkedin' ? 'application/json' : 'text/plain; charset=utf-8';
  const ext = file === 'linkedin' ? 'json' : 'txt';

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="DEBUG-${file}.${ext}"`,
    },
  });
}
