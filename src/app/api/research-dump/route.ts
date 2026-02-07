import { NextRequest } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';

/**
 * GET /api/research-dump?name=<donorName>
 *
 * Returns the most recent full research JSON for the given donor.
 * Files are stored in /tmp/prospectai-outputs/ during generation.
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');

  if (!name) {
    return new Response(
      JSON.stringify({ error: 'Missing "name" query parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const outputDir = '/tmp/prospectai-outputs';
  if (!existsSync(outputDir)) {
    return new Response(
      JSON.stringify({ error: 'No research data found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Find matching research files — match by sanitized donor name
  const safeName = name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const files = readdirSync(outputDir)
    .filter(f => f.includes(safeName) && f.endsWith('-research-full.json'))
    .sort()
    .reverse(); // most recent first (timestamp prefix)

  if (files.length === 0) {
    return new Response(
      JSON.stringify({ error: `No research data found for "${name}"` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const latestFile = files[0];
  const content = readFileSync(`${outputDir}/${latestFile}`, 'utf-8');

  return new Response(content, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${latestFile}"`,
    },
  });
}
