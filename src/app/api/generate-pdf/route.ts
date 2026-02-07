import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { profileData } = body;

  if (!profileData || !profileData.donorName) {
    return new Response(
      JSON.stringify({ error: 'Profile data with donorName is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeName = profileData.donorName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const tmpInput = `/tmp/prospectai-pdf-${requestId}.json`;
  const tmpOutput = `/tmp/prospectai-pdf-${requestId}.pdf`;

  try {
    // Write profile data as JSON for Python to read
    await writeFile(tmpInput, JSON.stringify(profileData));

    // Run Python PDF generator
    const generatorPath = path.join(process.cwd(), 'src/lib/pdf/generator.py');
    console.log(`[PDF] Generating PDF for ${profileData.donorName}...`);

    const { stdout, stderr } = await execAsync(
      `python3 "${generatorPath}" "${tmpInput}" "${tmpOutput}"`,
      { timeout: 30000 }
    );

    if (stdout) console.log(`[PDF] stdout: ${stdout}`);
    if (stderr) console.error(`[PDF] stderr: ${stderr}`);

    // Read and return PDF
    const pdfBuffer = await readFile(tmpOutput);
    console.log(`[PDF] Generated ${pdfBuffer.length} bytes for ${profileData.donorName}`);

    // Cleanup temp files
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpOutput).catch(() => {});

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ProspectAI_${safeName}.pdf"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[PDF] Generation failed:', error);

    // Cleanup on error
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpOutput).catch(() => {});

    const message = error instanceof Error ? error.message : 'PDF generation failed';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
