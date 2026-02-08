import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

/**
 * GET /api/debug-dump?file=sources|prompt|scoring
 *
 * Returns the debug files saved during pipeline execution.
 * Temporary endpoint — remove after testing.
 */
export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');

  const files: Record<string, string> = {
    sources: '/tmp/prospectai-outputs/DEBUG-selected-sources.txt',
    prompt: '/tmp/prospectai-outputs/DEBUG-profile-prompt.txt',
    scoring: '/tmp/prospectai-outputs/DEBUG-scoring-response.txt',
  };

  if (!file || !files[file]) {
    return new Response(
      JSON.stringify({ error: 'Use ?file=sources or ?file=prompt or ?file=scoring' }),
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

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="DEBUG-${file}.txt"`,
    },
  });
}
