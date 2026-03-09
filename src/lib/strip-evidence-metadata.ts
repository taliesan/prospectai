/**
 * Strip internal evidence metadata from profile markdown.
 *
 * The AI pipeline emits structured metadata blocks after section headings:
 *   [CONFIDENCE: 8/10 | FLOOR: 8]
 *   [EVIDENCE BASIS: IDENTITY_SELF_CONCEPT, RELATIONSHIP_PATTERNS, ...]
 *   [INFERRED: Nothing substantial - all claims trace to direct quotes...]
 *   [EVIDENCE CEILINGS: None affecting this section]
 *
 * The CONFIDENCE score is used by the UI to render the confidence badge.
 * The other three lines are internal pipeline data and must not render.
 *
 * This function:
 *  1. Converts [CONFIDENCE: X/10 ...] lines into Format A bar-chart style
 *     (appended to the preceding heading) so the badge renderer can parse them.
 *  2. Strips EVIDENCE BASIS, INFERRED, and EVIDENCE CEILINGS lines entirely.
 */
export function stripEvidenceMetadata(markdown: string): string {
  if (!markdown) return markdown;

  // Step 1: Convert Format B metadata blocks (on separate lines after headings)
  // into Format A heading style so the h2 badge renderer works uniformly.
  markdown = markdown.replace(
    /(#{2,3}\s*\d+\.\s*[^\n]*)\n+\[CONFIDENCE:\s*(\d+)\/10[^\]]*\]\s*\n?(?:\[EVIDENCE BASIS:[^\]]*\]\s*\n?)?(?:\[INFERRED:[^\]]*\]\s*\n?)?(?:\[EVIDENCE CEILINGS:[^\]]*\]\s*\n?)?/g,
    (_, header, score) => {
      const s = parseInt(score, 10);
      return `${header} ${'■'.repeat(s)}${'□'.repeat(10 - s)}  ${s}/10\n\n`;
    },
  );

  // Step 2: Strip any remaining standalone metadata lines (in case they
  // appear outside the heading pattern above, e.g. all on one line,
  // or separated by blank lines).
  markdown = markdown.replace(/^\[EVIDENCE BASIS:[^\]]*\]\s*$/gm, '');
  markdown = markdown.replace(/^\[INFERRED:[^\]]*\]\s*$/gm, '');
  markdown = markdown.replace(/^\[EVIDENCE CEILINGS:[^\]]*\]\s*$/gm, '');

  // Step 3: Strip inline metadata that appears within the same line/paragraph
  // as other content (e.g. "[EVIDENCE BASIS: ...] [INFERRED: ...] ...")
  markdown = markdown.replace(/\[EVIDENCE BASIS:[^\]]*\]/g, '');
  markdown = markdown.replace(/\[INFERRED:[^\]]*\]/g, '');
  markdown = markdown.replace(/\[EVIDENCE CEILINGS:[^\]]*\]/g, '');

  // Step 4: Strip standalone [CONFIDENCE: ...] lines that weren't part of
  // a heading (already handled in step 1 for headings, but catch strays)
  markdown = markdown.replace(/^\[CONFIDENCE:[^\]]*\]\s*$/gm, '');

  // Clean up excess blank lines left after stripping
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  return markdown;
}
