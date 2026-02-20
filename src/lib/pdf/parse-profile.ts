/**
 * Parse profile markdown into structured JSON for PDF generation.
 *
 * The AI outputs markdown for both the Persuasion Profile and Meeting Guide.
 * This parser converts that markdown into the structured format expected by
 * the Python PDF generator (generator.py).
 *
 * Content-agnostic: handles whatever sections the AI produces.
 */

interface Source {
  url: string;
  title: string;
}

interface ProfileSection {
  title: string;
  paragraphs: { type: 'text' | 'insight' | 'bold'; content: string }[];
}

interface MeetingGuideData {
  // v3 format (Setup/Arc/Tripwires/One Line)
  format: 'v3' | 'legacy';
  donorName: string;
  setupGroups: { heading: string; bullets: string[] }[];
  beats: {
    number: string;
    title: string;
    goal: string;
    start: string;
    stay: string;
    stallingText: string;
    continue: string;
  }[];
  tripwires: { name: string; tell: string; recovery: string }[];
  oneLine: string;
  // Legacy format fields (kept for backwards compatibility)
  donorRead: { posture: string; body: string[] };
  lightsUp: { title: string; body: string }[];
  shutsDown: string[];
  alignmentMap: {
    primary: { title: string; body: string } | null;
    secondary: { title: string; body: string }[];
    fightOrBuild: string;
    handsOnWheel: string;
    fiveMinCollapse: string;
  };
  meetingArc: {
    intro: string;
    moves: { number: string; title: string; moveText: string; readText: string }[];
  };
  readingRoom: { working: string[]; stalling: string[] };
  resetMoves: string[];
}

export interface PDFProfileData {
  donorName: string;
  preparedFor: string;
  date: string;
  sourceCount: number;
  persuasionProfile: {
    sections: ProfileSection[];
  };
  meetingGuide: MeetingGuideData | null;
  sources: Source[];
}

/**
 * Parse the full profile data into PDF-ready JSON.
 */
export function parseProfileForPDF(
  donorName: string,
  preparedFor: string,
  profileMarkdown: string,
  meetingGuideMarkdown: string | undefined,
  sources: Source[]
): PDFProfileData {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    donorName,
    preparedFor,
    date,
    sourceCount: sources.length,
    persuasionProfile: {
      sections: parsePersuasionProfile(profileMarkdown),
    },
    meetingGuide: meetingGuideMarkdown ? parseMeetingGuide(meetingGuideMarkdown) : null,
    sources,
  };
}

/**
 * Parse persuasion profile markdown into sections.
 * Splits on ## headings, each becoming a section with paragraphs.
 */
function parsePersuasionProfile(markdown: string): ProfileSection[] {
  if (!markdown) return [];

  const sections: ProfileSection[] = [];
  const lines = markdown.split('\n');
  let currentSection: ProfileSection | null = null;
  let currentParagraph = '';

  const flushParagraph = () => {
    if (currentParagraph.trim() && currentSection) {
      const trimmed = currentParagraph.trim();
      // Detect insight/blockquote paragraphs
      if (trimmed.startsWith('>')) {
        const content = trimmed.replace(/^>\s*/gm, '');
        currentSection.paragraphs.push({ type: 'insight', content });
      } else {
        currentSection.paragraphs.push({ type: 'text', content: trimmed });
      }
    }
    currentParagraph = '';
  };

  for (const line of lines) {
    // Skip the title line (# Name — Persuasion Profile)
    if (line.match(/^#\s+/) && !line.match(/^##/)) {
      continue;
    }

    // New section on ## heading
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      flushParagraph();
      if (currentSection) {
        sections.push(currentSection);
      }
      // Clean up heading — remove numbering like "1. " or "17. "
      let title = h2Match[1].trim();
      title = title.replace(/^\d+\.\s*/, '');
      // Remove trailing emphasis markers
      title = title.replace(/\*+/g, '').trim();
      // Remove " — MOST IMPORTANT" suffix
      title = title.replace(/\s*—\s*MOST IMPORTANT\.?/i, '');

      currentSection = { title, paragraphs: [] };
      continue;
    }

    // Subheadings become bold paragraphs
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match && currentSection) {
      flushParagraph();
      currentSection.paragraphs.push({
        type: 'bold',
        content: h3Match[1].trim(),
      });
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    // Accumulate text
    currentParagraph += (currentParagraph ? ' ' : '') + line;
  }

  flushParagraph();
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Detect if markdown uses v3 format (### SETUP / ### THE ARC / ### TRIPWIRES / ### ONE LINE)
 */
function isV3MeetingGuide(markdown: string): boolean {
  return /^###\s+SETUP$/im.test(markdown) && /^###\s+THE ARC$/im.test(markdown);
}

/**
 * Parse v3 meeting guide markdown (Setup/Arc/Tripwires/One Line) into structured data.
 */
function parseMeetingGuideV3(markdown: string): MeetingGuideData {
  const result: MeetingGuideData = {
    format: 'v3',
    donorName: '',
    setupGroups: [],
    beats: [],
    tripwires: [],
    oneLine: '',
    // Legacy fields (empty)
    donorRead: { posture: '', body: [] },
    lightsUp: [],
    shutsDown: [],
    alignmentMap: { primary: null, secondary: [], fightOrBuild: '', handsOnWheel: '', fiveMinCollapse: '' },
    meetingArc: { intro: '', moves: [] },
    readingRoom: { working: [], stalling: [] },
    resetMoves: [],
  };

  // Extract donor name from header
  const headerMatch = markdown.match(/^#{1,3}\s+MEETING GUIDE\s*[—–-]+\s*(.+)$/im);
  if (headerMatch) result.donorName = headerMatch[1].trim();

  // Split by ### sections
  const sections = splitByHeadings(markdown, 3);

  for (const section of sections) {
    const heading = section.heading.toUpperCase().trim();

    if (heading === 'SETUP') {
      // Parse **Heading.** followed by - bullets
      const lines = section.body.split('\n');
      let currentGroup: { heading: string; bullets: string[] } | null = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '---') continue;

        const headingMatch = trimmed.match(/^\*\*(.+?)\.?\*\*\s*$/);
        if (headingMatch) {
          if (currentGroup) result.setupGroups.push(currentGroup);
          currentGroup = { heading: headingMatch[1], bullets: [] };
          continue;
        }

        if (trimmed.startsWith('- ') && currentGroup) {
          currentGroup.bullets.push(trimmed.slice(2));
        }
      }
      if (currentGroup) result.setupGroups.push(currentGroup);

    } else if (heading === 'THE ARC') {
      // Parse beats: **Beat N: Title** with START/STAY/CONTINUE phases
      const beatRegex = /\*\*Beat\s+(\d+)[:\s·–-]+\s*(.+?)\.*\*\*/gi;
      const beatPositions: { index: number; number: string; title: string }[] = [];
      let match;
      while ((match = beatRegex.exec(section.body)) !== null) {
        beatPositions.push({ index: match.index, number: match[1], title: match[2].trim() });
      }

      for (let i = 0; i < beatPositions.length; i++) {
        const start = beatPositions[i].index;
        const end = i + 1 < beatPositions.length ? beatPositions[i + 1].index : section.body.length;
        const beatContent = section.body.slice(start, end);

        // Extract goal (italic line)
        const goalMatch = beatContent.match(/^\*([^*].+?)\*\s*$/m);

        // Extract phases
        const startMatch = beatContent.match(/\*\*START\.\*\*\s*([\s\S]*?)(?=\*\*STAY\.\*\*|$)/);
        const stayMatch = beatContent.match(/\*\*STAY\.\*\*\s*([\s\S]*?)(?=\*\*CONTINUE\.\*\*|$)/);
        const continueMatch = beatContent.match(/\*\*CONTINUE\.\*\*\s*([\s\S]*?)(?=\*\*Beat\s+\d|---\s*$|$)/);

        // Detect stalling text within STAY
        let stayText = stayMatch ? stayMatch[1].trim() : '';
        let stallingText = '';
        const stallingMatch = stayText.match(/(?:When it's stalling|When it\u2019s stalling)[:\s]*(.*?)$/im);
        if (stallingMatch) {
          stallingText = stallingMatch[0].trim();
          stayText = stayText.slice(0, stayText.indexOf(stallingMatch[0])).trim();
        }

        result.beats.push({
          number: beatPositions[i].number,
          title: beatPositions[i].title,
          goal: goalMatch ? goalMatch[1] : '',
          start: startMatch ? startMatch[1].trim().replace(/\n/g, ' ') : '',
          stay: stayText.replace(/\n{2,}/g, '\n\n'),
          stallingText,
          continue: continueMatch ? continueMatch[1].trim().replace(/\n/g, ' ') : '',
        });
      }

    } else if (heading === 'TRIPWIRES') {
      // Parse tripwires: **Name.** *Tell:* ... *Recovery:* ...
      const lines = section.body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        // Single-line tripwire
        const tripMatch = trimmed.match(/^\*\*(.+?)\.?\*\*\s*\*Tell:\*\s*(.+?)\s*\*Recovery:\*\s*(.+)$/);
        if (tripMatch) {
          result.tripwires.push({
            name: tripMatch[1].trim(),
            tell: tripMatch[2].trim(),
            recovery: tripMatch[3].trim(),
          });
          continue;
        }
        // Multi-line: name on one line, tell/recovery on following lines
        const nameMatch = trimmed.match(/^\*\*(.+?)\.?\*\*\s*$/);
        if (nameMatch) {
          let tell = '', recovery = '';
          for (let j = i + 1; j < lines.length && j < i + 5; j++) {
            const tl = lines[j].trim();
            if (tl.startsWith('**') || tl.startsWith('### ')) break;
            const tellM = tl.match(/^\*Tell:\*\s*(.+)$/);
            if (tellM) { tell = tellM[1].trim(); continue; }
            const recM = tl.match(/^\*Recovery:\*\s*(.+)$/);
            if (recM) { recovery = recM[1].trim(); continue; }
          }
          if (tell || recovery) {
            result.tripwires.push({ name: nameMatch[1].trim(), tell, recovery });
          }
        }
      }

    } else if (heading === 'ONE LINE') {
      const lines = section.body.split('\n').filter(l => l.trim());
      if (lines.length > 0) result.oneLine = lines[0].trim();
    }
  }

  return result;
}

/**
 * Parse meeting guide markdown into structured data.
 * Supports both v3 format (Setup/Arc/Tripwires/One Line) and legacy format.
 */
function parseMeetingGuide(markdown: string): MeetingGuideData {
  // Detect and use v3 parser if appropriate
  if (isV3MeetingGuide(markdown)) {
    return parseMeetingGuideV3(markdown);
  }

  // Legacy parser
  const result: MeetingGuideData = {
    format: 'legacy',
    donorName: '',
    setupGroups: [],
    beats: [],
    tripwires: [],
    oneLine: '',
    donorRead: { posture: '', body: [] },
    lightsUp: [],
    shutsDown: [],
    alignmentMap: {
      primary: null,
      secondary: [],
      fightOrBuild: '',
      handsOnWheel: '',
      fiveMinCollapse: '',
    },
    meetingArc: { intro: '', moves: [] },
    readingRoom: { working: [], stalling: [] },
    resetMoves: [],
  };

  // Split into top-level sections by ## headings
  const sectionBlocks = splitByHeadings(markdown, 2);

  for (const block of sectionBlocks) {
    const headingLower = block.heading.toLowerCase();

    if (headingLower.includes('donor read') || headingLower.includes('the read')) {
      const paras = extractParagraphs(block.body);
      if (paras.length > 0) {
        result.donorRead.posture = paras[0];
        result.donorRead.body = paras.slice(1);
      }
    } else if (headingLower.includes('lights up') || headingLower.includes('what lights')) {
      const subSections = splitByHeadings(block.body, 3);
      for (const sub of subSections) {
        if (sub.heading) {
          result.lightsUp.push({
            title: sub.heading,
            body: extractParagraphs(sub.body).join(' '),
          });
        }
      }
      // If no subsections, extract as bullet points
      if (result.lightsUp.length === 0) {
        const bullets = extractBullets(block.body);
        for (const b of bullets) {
          const parts = b.split(/[:\u2014\u2013]\s*/);
          result.lightsUp.push({
            title: parts[0]?.trim() || '',
            body: parts.slice(1).join(': ').trim(),
          });
        }
      }
    } else if (headingLower.includes('shuts down') || headingLower.includes('shut')) {
      result.shutsDown = extractBullets(block.body);
      if (result.shutsDown.length === 0) {
        result.shutsDown = extractParagraphs(block.body);
      }
    } else if (headingLower.includes('alignment map') || headingLower.includes('alignment')) {
      const subSections = splitByHeadings(block.body, 3);
      for (const sub of subSections) {
        const subLower = sub.heading.toLowerCase();
        if (subLower.includes('5 min') || subLower.includes('five min') || subLower.includes('collapse')) {
          result.alignmentMap.fiveMinCollapse = extractParagraphs(sub.body).join(' ');
        } else if (subLower.includes('fight') || subLower.includes('build')) {
          result.alignmentMap.fightOrBuild = extractParagraphs(sub.body).join(' ');
        } else if (subLower.includes('hands') || subLower.includes('wheel')) {
          result.alignmentMap.handsOnWheel = extractParagraphs(sub.body).join(' ');
        } else if (!result.alignmentMap.primary) {
          result.alignmentMap.primary = {
            title: sub.heading,
            body: extractParagraphs(sub.body).join(' '),
          };
        } else {
          result.alignmentMap.secondary.push({
            title: sub.heading,
            body: extractParagraphs(sub.body).join(' '),
          });
        }
      }
      // Fallback: parse body paragraphs as primary
      if (!result.alignmentMap.primary && subSections.length === 0) {
        const paras = extractParagraphs(block.body);
        if (paras.length > 0) {
          result.alignmentMap.primary = {
            title: 'Primary Alignment',
            body: paras.join(' '),
          };
        }
      }
    } else if (headingLower.includes('meeting arc') || headingLower.includes('arc')) {
      result.meetingArc = parseMeetingArc(block.body);
    } else if (headingLower.includes('reading the room') || headingLower.includes('reading room')) {
      result.readingRoom = parseReadingRoom(block.body);
    } else if (headingLower.includes('reset') || headingLower.includes('recovery')) {
      result.resetMoves = extractBullets(block.body);
      if (result.resetMoves.length === 0) {
        result.resetMoves = extractParagraphs(block.body);
      }
    }
  }

  return result;
}

/**
 * Parse the meeting arc section into numbered moves.
 */
function parseMeetingArc(body: string): { intro: string; moves: { number: string; title: string; moveText: string; readText: string }[] } {
  const result = { intro: '', moves: [] as any[] };
  const subSections = splitByHeadings(body, 3);

  if (subSections.length === 0) {
    // Try to parse numbered moves from the body directly
    const moveRegex = /(?:^|\n)(?:###?\s*)?(?:Move\s+)?(\d+)[.:]\s*(.+?)(?:\n|$)/gi;
    let match;
    const bodyText = body;

    while ((match = moveRegex.exec(bodyText)) !== null) {
      result.moves.push({
        number: match[1],
        title: match[2].trim().replace(/\*+/g, ''),
        moveText: '',
        readText: '',
      });
    }
    return result;
  }

  // Check if first block has no heading (intro text)
  for (const sub of subSections) {
    if (!sub.heading && !result.intro) {
      result.intro = extractParagraphs(sub.body).join(' ');
      continue;
    }

    // Parse move number from heading
    const moveMatch = sub.heading.match(/(?:Move\s+)?(\d+)[.:]?\s*(.*)/i);
    if (moveMatch) {
      const paras = extractParagraphs(sub.body);
      // Look for "THE READ" section
      const readIdx = sub.body.toLowerCase().indexOf('the read');
      let moveText = '';
      let readText = '';

      if (readIdx >= 0) {
        const beforeRead = sub.body.slice(0, readIdx);
        const afterRead = sub.body.slice(readIdx);
        moveText = extractParagraphs(beforeRead).join(' ');
        readText = extractParagraphs(afterRead.replace(/^the\s+read[:\s]*/i, '')).join(' ');
      } else {
        moveText = paras.join(' ');
      }

      result.moves.push({
        number: moveMatch[1],
        title: moveMatch[2].trim().replace(/\*+/g, ''),
        moveText,
        readText,
      });
    }
  }

  return result;
}

/**
 * Parse the reading room section into working/stalling columns.
 */
function parseReadingRoom(body: string): { working: string[]; stalling: string[] } {
  const result = { working: [] as string[], stalling: [] as string[] };
  const subSections = splitByHeadings(body, 3);

  for (const sub of subSections) {
    const lower = sub.heading.toLowerCase();
    if (lower.includes('working') || lower.includes('engaged') || lower.includes('positive')) {
      result.working = extractBullets(sub.body);
    } else if (lower.includes('stalling') || lower.includes('disengag') || lower.includes('negative') || lower.includes('losing')) {
      result.stalling = extractBullets(sub.body);
    }
  }

  // Fallback: split bullets into two halves
  if (result.working.length === 0 && result.stalling.length === 0) {
    const bullets = extractBullets(body);
    const mid = Math.ceil(bullets.length / 2);
    result.working = bullets.slice(0, mid);
    result.stalling = bullets.slice(mid);
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface HeadingBlock {
  heading: string;
  body: string;
}

function splitByHeadings(text: string, level: number): HeadingBlock[] {
  const prefix = '#'.repeat(level);
  const regex = new RegExp(`^${prefix}\\s+(.+)$`, 'gm');
  const blocks: HeadingBlock[] = [];

  let lastMatch: { heading: string; index: number } | null = null;
  let match;

  // Check for text before the first heading
  const firstHeadingMatch = regex.exec(text);
  if (firstHeadingMatch && firstHeadingMatch.index > 0) {
    const preText = text.slice(0, firstHeadingMatch.index).trim();
    if (preText) {
      blocks.push({ heading: '', body: preText });
    }
  }

  // Reset regex
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (lastMatch) {
      blocks.push({
        heading: lastMatch.heading,
        body: text.slice(lastMatch.index + lastMatch.heading.length + level + 1, match.index).trim(),
      });
    }
    lastMatch = { heading: match[1].trim(), index: match.index };
  }

  if (lastMatch) {
    blocks.push({
      heading: lastMatch.heading,
      body: text.slice(lastMatch.index + lastMatch.heading.length + level + 1).trim(),
    });
  }

  return blocks;
}

function extractParagraphs(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p && !p.match(/^#{1,4}\s/))  // Skip headings
    .map(p => p.replace(/\n/g, ' '));  // Join wrapped lines
}

function extractBullets(text: string): string[] {
  if (!text) return [];
  const bullets: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)/);
    if (match) {
      bullets.push(match[1].trim());
    }
  }
  return bullets;
}
