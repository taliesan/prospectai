// ──────────────────────────────────────────────────────────────────────
// ARCHIVED: V1 canon loading path
// These functions were the V1 exemplar loading functions used for
// the original pipeline that loaded real-person exemplar profiles
// (Newmark, Bahat, McGlinchey) from exemplars.md.
// Archived as part of V1 pipeline retirement — V2 uses fictional
// exemplars from prompt-v2.txt instead.
// ──────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

function loadCanonFile(filename: string): string {
  try {
    const filePath = path.join(process.cwd(), 'src/lib/canon', filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`[Canon] Loaded ${filename}: ${content.length} characters`);
    return content;
  } catch (error) {
    console.error(`[Canon] Failed to load ${filename}:`, error);
    return '';
  }
}

const exemplarsCache = loadCanonFile('exemplars.md');

export function loadExemplars(): string {
  return exemplarsCache;
}

/**
 * Returns all exemplars. No selection logic - the model needs to see the full range.
 */
export function selectExemplars(_researchPackage: string, allExemplars: string): string {
  return allExemplars;
}

/**
 * Returns the three exemplar profiles as separate strings for fact-checking.
 * Each profile is extracted by splitting on the "# PERSUASION PROFILE —" heading.
 */
export function loadExemplarProfilesSeparate(): {
  bahat: string;
  newmark: string;
  mcglinchey: string;
} {
  const full = exemplarsCache;
  // Split on the profile headings, keeping the heading with its content
  const profileStarts = [
    { name: 'newmark' as const, marker: '# PERSUASION PROFILE — CRAIG NEWMARK' },
    { name: 'bahat' as const, marker: '# PERSUASION PROFILE — ROY BAHAT' },
    { name: 'mcglinchey' as const, marker: '# PERSUASION PROFILE — LORI McGLINCHEY' },
  ];

  const result: Record<string, string> = { bahat: '', newmark: '', mcglinchey: '' };

  for (let i = 0; i < profileStarts.length; i++) {
    const startIdx = full.indexOf(profileStarts[i].marker);
    if (startIdx === -1) continue;
    const nextStart = i + 1 < profileStarts.length
      ? full.indexOf(profileStarts[i + 1].marker)
      : full.length;
    result[profileStarts[i].name] = full.slice(startIdx, nextStart !== -1 ? nextStart : full.length).trim();
  }

  return result as { bahat: string; newmark: string; mcglinchey: string };
}
