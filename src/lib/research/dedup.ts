// Stage 4 — Content Deduplication (v5 Pipeline)
//
// After fetching full content, check for overlap:
//   1. LinkedIn JSON overlap: if fetched URL content duplicates LinkedIn post content
//   2. URL normalization: strip tracking params, normalize protocol/www
//   3. Content fingerprinting: >80% identical text = duplicate

import type { ResearchSource } from './screening';

// ── URL normalization ───────────────────────────────────────────────

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Normalize protocol
    parsed.protocol = 'https:';

    // Remove www prefix
    parsed.hostname = parsed.hostname.replace(/^www\./, '');

    // Remove tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref', 'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
      'source', 'trk', 'trkInfo',
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }

    // Remove trailing slash
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    // Remove hash
    parsed.hash = '';

    return parsed.toString();
  } catch {
    return url;
  }
}

// ── Content fingerprinting ──────────────────────────────────────────

/**
 * Generate a set of content shingles (overlapping word n-grams)
 * for Jaccard similarity comparison.
 */
function generateShingles(text: string, shingleSize: number = 5): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const shingles = new Set<string>();

  for (let i = 0; i <= words.length - shingleSize; i++) {
    shingles.add(words.slice(i, i + shingleSize).join(' '));
  }

  return shingles;
}

/**
 * Calculate Jaccard similarity between two texts.
 * Returns 0.0-1.0 (1.0 = identical).
 */
function contentSimilarity(text1: string, text2: string): number {
  const shingles1 = generateShingles(text1);
  const shingles2 = generateShingles(text2);

  if (shingles1.size === 0 || shingles2.size === 0) return 0;

  let intersection = 0;
  shingles1.forEach(s => {
    if (shingles2.has(s)) intersection++;
  });

  const union = shingles1.size + shingles2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── LinkedIn overlap detection ──────────────────────────────────────

/**
 * Check if a fetched URL's content duplicates content from LinkedIn JSON.
 * LinkedIn posts are canonical when they appear in both the JSON and as
 * fetched URLs.
 */
function isLinkedInDuplicate(
  source: ResearchSource,
  linkedinPostContents: string[],
): boolean {
  if (!source.content || source.content.length < 100) return false;

  // Check against each LinkedIn post
  for (const linkedinContent of linkedinPostContents) {
    if (linkedinContent.length < 50) continue;

    const similarity = contentSimilarity(source.content, linkedinContent);
    if (similarity > 0.6) {
      return true;
    }
  }

  return false;
}

// ── Main dedup function ─────────────────────────────────────────────

export interface DedupResult {
  deduplicated: ResearchSource[];
  removed: Array<{ url: string; reason: string }>;
}

export function deduplicateSources(
  sources: ResearchSource[],
  linkedinPostContents?: string[],
): DedupResult {
  const removed: Array<{ url: string; reason: string }> = [];

  // Step 1: URL normalization dedup
  const normalizedMap = new Map<string, ResearchSource>();
  const afterUrlDedup: ResearchSource[] = [];

  for (const source of sources) {
    const normalized = normalizeUrl(source.url);

    if (normalizedMap.has(normalized)) {
      const existing = normalizedMap.get(normalized)!;
      // Keep the one with more content
      if ((source.content?.length || 0) > (existing.content?.length || 0)) {
        // Replace existing
        const existingIdx = afterUrlDedup.indexOf(existing);
        if (existingIdx >= 0) afterUrlDedup[existingIdx] = source;
        normalizedMap.set(normalized, source);
        removed.push({ url: existing.url, reason: `URL duplicate of ${source.url}` });
      } else {
        removed.push({ url: source.url, reason: `URL duplicate of ${existing.url}` });
      }
    } else {
      normalizedMap.set(normalized, source);
      afterUrlDedup.push(source);
    }
  }

  // Step 2: LinkedIn overlap check
  let afterLinkedInDedup = afterUrlDedup;
  if (linkedinPostContents && linkedinPostContents.length > 0) {
    afterLinkedInDedup = [];
    for (const source of afterUrlDedup) {
      if (isLinkedInDuplicate(source, linkedinPostContents)) {
        removed.push({ url: source.url, reason: 'Content duplicates LinkedIn JSON post' });
      } else {
        afterLinkedInDedup.push(source);
      }
    }
  }

  // Step 3: Content fingerprinting (>80% identical text)
  const deduplicated: ResearchSource[] = [];
  const contentChecked = new Set<number>();

  for (let i = 0; i < afterLinkedInDedup.length; i++) {
    if (contentChecked.has(i)) continue;

    const source = afterLinkedInDedup[i];
    const sourceContent = source.content || source.snippet || '';

    // Only fingerprint substantial content
    if (sourceContent.length < 200) {
      deduplicated.push(source);
      continue;
    }

    let isDuplicate = false;
    for (let j = 0; j < deduplicated.length; j++) {
      const existing = deduplicated[j];
      const existingContent = existing.content || existing.snippet || '';

      if (existingContent.length < 200) continue;

      const similarity = contentSimilarity(sourceContent, existingContent);
      if (similarity > 0.8) {
        // Keep the higher-tier source (lower attribution rank = better)
        const sourceRank = attributionRank(source.attribution);
        const existingRank = attributionRank(existing.attribution);

        if (sourceRank < existingRank) {
          // New source is better — replace
          deduplicated[j] = source;
          removed.push({ url: existing.url, reason: `Content >80% similar to ${source.url}` });
        } else {
          removed.push({ url: source.url, reason: `Content >80% similar to ${existing.url}` });
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      deduplicated.push(source);
    }
  }

  console.log(`[Stage 4 Dedup] ${sources.length} → ${deduplicated.length} (${removed.length} removed)`);
  for (const r of removed) {
    console.log(`[Stage 4 Dedup]   - ${r.url}: ${r.reason}`);
  }

  return { deduplicated, removed };
}

function attributionRank(attribution?: string): number {
  switch (attribution) {
    case 'target_authored': return 1;
    case 'target_coverage': return 2;
    case 'target_reshare': return 3;
    case 'institutional_inference': return 4;
    default: return 5;
  }
}
