// Meeting Guide HTML Formatter — v3
// Converts intermediate markdown format (Setup/Arc/Tripwires/One Line)
// to styled HTML matching meeting-guide-newmark.html reference

interface SetupGroup {
  heading: string;
  bullets: string[];
}

interface Beat {
  number: number;
  title: string;
  goal: string;
  start: string;
  stayParagraphs: string[];
  stayScenarios: Array<{ label: string; text: string }>;
  stallingText: string;
  continue: string;
}

interface Tripwire {
  name: string;
  tell: string;
  recovery: string;
}

interface ParsedGuide {
  donorName: string;
  setupGroups: SetupGroup[];
  beats: Beat[];
  tripwires: Tripwire[];
  oneLine: string;
}

// ── PARSER ──────────────────────────────────────────────────────────

function parseMarkdown(markdown: string): ParsedGuide {
  const lines = markdown.split('\n');

  const guide: ParsedGuide = {
    donorName: '',
    setupGroups: [],
    beats: [],
    tripwires: [],
    oneLine: '',
  };

  let i = 0;

  // Helper: advance past blank lines
  function skipBlanks(): void {
    while (i < lines.length && lines[i].trim() === '') i++;
  }

  // Helper: read lines until next section marker or EOF
  function collectUntil(stopPattern: RegExp): string[] {
    const collected: string[] = [];
    while (i < lines.length && !stopPattern.test(lines[i].trim())) {
      collected.push(lines[i]);
      i++;
    }
    return collected;
  }

  // ── Extract donor name from header ──
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const headerMatch = trimmed.match(/^#{1,3}\s+MEETING GUIDE\s*[—–-]+\s*(.+)$/i);
    if (headerMatch) {
      guide.donorName = headerMatch[1].trim();
      i++;
      break;
    }
  }

  // ── Parse SETUP ──
  // Find ### SETUP
  for (; i < lines.length; i++) {
    if (lines[i].trim().match(/^###\s+SETUP$/i)) {
      i++;
      break;
    }
  }

  // Parse setup groups: **Heading.** followed by - bullets
  while (i < lines.length) {
    skipBlanks();
    if (i >= lines.length) break;
    const trimmed = lines[i].trim();

    // Stop at next ### section
    if (trimmed.startsWith('### ')) break;
    // Skip horizontal rules
    if (trimmed === '---') { i++; continue; }

    // Look for **Heading.**
    const headingMatch = trimmed.match(/^\*\*(.+?)\.?\*\*\s*$/);
    if (headingMatch) {
      const heading = headingMatch[1];
      i++;
      const bullets: string[] = [];

      // Collect bullets
      while (i < lines.length) {
        const bLine = lines[i].trim();
        if (bLine.startsWith('- ')) {
          bullets.push(bLine.slice(2));
          i++;
        } else if (bLine === '') {
          i++;
          // Check if next non-blank line is still a bullet
          skipBlanks();
          if (i < lines.length && lines[i].trim().startsWith('- ')) {
            continue;
          }
          break;
        } else {
          break;
        }
      }

      guide.setupGroups.push({ heading, bullets });
      continue;
    }

    i++;
  }

  // ── Parse THE ARC ──
  // Find ### THE ARC
  for (; i < lines.length; i++) {
    if (lines[i].trim().match(/^###\s+THE ARC$/i)) {
      i++;
      break;
    }
  }

  // Parse beats: **Beat N: Title** or **Beat N · Title**
  while (i < lines.length) {
    skipBlanks();
    if (i >= lines.length) break;
    const trimmed = lines[i].trim();

    // Stop at next ### section
    if (trimmed.startsWith('### ') && !trimmed.match(/^###\s+THE ARC/i)) break;
    if (trimmed === '---') { i++; continue; }

    // Beat header
    const beatMatch = trimmed.match(/^\*\*Beat\s+(\d+)[:\s·–-]+\s*(.+?)\.*\*\*\s*$/i);
    if (beatMatch) {
      const beat: Beat = {
        number: parseInt(beatMatch[1]),
        title: beatMatch[2].trim(),
        goal: '',
        start: '',
        stayParagraphs: [],
        stayScenarios: [],
        stallingText: '',
        continue: '',
      };
      i++;
      skipBlanks();

      // Goal line (italic)
      if (i < lines.length) {
        const goalLine = lines[i].trim();
        const goalMatch = goalLine.match(/^\*([^*].+?)\*\s*$/);
        if (goalMatch) {
          beat.goal = goalMatch[1];
          i++;
        }
      }

      // Parse START, STAY, CONTINUE phases
      while (i < lines.length) {
        skipBlanks();
        if (i >= lines.length) break;
        const pLine = lines[i].trim();

        // Next beat or section
        if (pLine.match(/^\*\*Beat\s+\d+/i) || pLine.startsWith('### ') || pLine === '---') break;

        // START
        if (pLine.startsWith('**START.**')) {
          const startText = pLine.replace('**START.**', '').trim();
          const startLines = [startText];
          i++;
          while (i < lines.length) {
            const sLine = lines[i].trim();
            if (sLine.startsWith('**STAY.**') || sLine.startsWith('**CONTINUE.**') ||
                sLine.match(/^\*\*Beat\s+\d+/i) || sLine.startsWith('### ') || sLine === '---') break;
            if (sLine) startLines.push(sLine);
            i++;
          }
          beat.start = startLines.filter(Boolean).join(' ');
          continue;
        }

        // STAY
        if (pLine.startsWith('**STAY.**')) {
          const stayFirstLine = pLine.replace('**STAY.**', '').trim();
          i++;

          const stayContent: string[] = [];
          if (stayFirstLine) stayContent.push(stayFirstLine);

          while (i < lines.length) {
            const sLine = lines[i].trim();
            if (sLine.startsWith('**CONTINUE.**') || sLine.match(/^\*\*Beat\s+\d+/i) ||
                sLine.startsWith('### ') || sLine === '---') break;
            stayContent.push(lines[i]);
            i++;
          }

          // Process STAY content: separate paragraphs, scenarios, and stalling
          parseStayContent(stayContent, beat);
          continue;
        }

        // CONTINUE
        if (pLine.startsWith('**CONTINUE.**')) {
          const contText = pLine.replace('**CONTINUE.**', '').trim();
          const contLines = [contText];
          i++;
          while (i < lines.length) {
            const cLine = lines[i].trim();
            if (cLine.match(/^\*\*Beat\s+\d+/i) || cLine.startsWith('### ') ||
                cLine === '---' || cLine.startsWith('**START.**') || cLine.startsWith('**STAY.**')) break;
            if (cLine) contLines.push(cLine);
            i++;
          }
          beat.continue = contLines.filter(Boolean).join(' ');
          continue;
        }

        i++;
      }

      guide.beats.push(beat);
      continue;
    }

    i++;
  }

  // ── Parse TRIPWIRES ──
  for (; i < lines.length; i++) {
    if (lines[i].trim().match(/^###\s+TRIPWIRES$/i)) {
      i++;
      break;
    }
  }

  while (i < lines.length) {
    skipBlanks();
    if (i >= lines.length) break;
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('### ') || trimmed === '---') {
      if (trimmed === '---') { i++; continue; }
      break;
    }

    // Tripwire: **Label.** *Tell:* ... *Recovery:* ... (single-line)
    const tripMatch = trimmed.match(/^\*\*(.+?)\.?\*\*\s*\*Tell:\*\s*(.+?)\s*\*Recovery:\*\s*(.+)$/);
    if (tripMatch) {
      guide.tripwires.push({
        name: tripMatch[1].trim(),
        tell: tripMatch[2].trim(),
        recovery: tripMatch[3].trim(),
      });
      i++;
      continue;
    }

    // Multi-line tripwire: **Label.** on one line, Tell/Recovery on next lines
    const nameMatch = trimmed.match(/^\*\*(.+?)\.?\*\*\s*$/);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      let tell = '';
      let recovery = '';
      i++;

      // Look for Tell and Recovery (tolerate blank lines between them)
      while (i < lines.length) {
        const tLine = lines[i].trim();
        if (tLine.startsWith('**') || tLine.startsWith('### ') || tLine === '---') break;
        if (tLine === '') { i++; continue; }
        const tellMatch = tLine.match(/^\*Tell:\*\s*(.+)$/);
        if (tellMatch) {
          tell = tellMatch[1].trim();
          i++;
          continue;
        }
        const recMatch = tLine.match(/^\*Recovery:\*\s*(.+)$/);
        if (recMatch) {
          recovery = recMatch[1].trim();
          i++;
          continue;
        }
        i++;
      }

      if (tell || recovery) {
        guide.tripwires.push({ name, tell, recovery });
      }
      continue;
    }

    i++;
  }

  // ── Parse ONE LINE ──
  for (; i < lines.length; i++) {
    if (lines[i].trim().match(/^###\s+ONE LINE$/i)) {
      i++;
      break;
    }
  }

  skipBlanks();
  if (i < lines.length) {
    guide.oneLine = lines[i].trim();
  }

  // Defensive logging — surface silent parse failures
  if (!guide.donorName) console.warn('[Meeting Guide HTML] WARNING: donor name not parsed from markdown');
  if (guide.setupGroups.length === 0) console.warn('[Meeting Guide HTML] WARNING: no setup groups parsed');
  if (guide.beats.length === 0) console.warn('[Meeting Guide HTML] WARNING: no beats parsed');
  if (guide.tripwires.length === 0) console.warn('[Meeting Guide HTML] WARNING: no tripwires parsed');
  if (!guide.oneLine) console.warn('[Meeting Guide HTML] WARNING: no ONE LINE parsed');

  return guide;
}

/**
 * Parse the content within a STAY section into paragraphs, scenarios, and stalling indicator.
 */
function parseStayContent(contentLines: string[], beat: Beat): void {
  // Join into text blocks separated by blank lines
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of contentLines) {
    if (line.trim() === '') {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    } else {
      currentBlock.push(line.trim());
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  // Process each block
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const firstLine = block[0];

    // Check for stalling indicator patterns
    const isStalling = isLastContentBlock(blocks, b) && looksLikeStalling(block);

    if (isStalling) {
      beat.stallingText = block.join(' ');
      continue;
    }

    // Check for scenario bullets: lines starting with - **
    const scenarioLines = block.filter(l => l.startsWith('- **'));
    const nonScenarioLines = block.filter(l => !l.startsWith('- **'));

    if (scenarioLines.length > 0) {
      // Add any prose before the scenarios
      if (nonScenarioLines.length > 0) {
        beat.stayParagraphs.push(nonScenarioLines.join(' '));
      }

      // Parse scenario bullets
      for (const sLine of scenarioLines) {
        const sMatch = sLine.match(/^- \*\*(.+?)\*\*\s*[—–-]?\s*(.*)$/);
        if (sMatch) {
          beat.stayScenarios.push({ label: sMatch[1], text: sMatch[2] });
        }
      }
    } else {
      // Plain prose paragraph
      beat.stayParagraphs.push(block.join(' '));
    }
  }
}

/** Check if this is the last non-empty block */
function isLastContentBlock(blocks: string[][], index: number): boolean {
  for (let j = index + 1; j < blocks.length; j++) {
    if (blocks[j].some(l => l.trim())) return false;
  }
  return true;
}

/** Heuristic: does this block look like a stalling indicator? */
function looksLikeStalling(block: string[]): boolean {
  const text = block.join(' ').toLowerCase();
  return (
    text.startsWith('when it\'s stalling') ||
    text.startsWith('when it\'s stalling') ||
    text.startsWith('if he\'s ') ||
    text.startsWith('if she\'s ') ||
    text.startsWith('if he treats') ||
    text.startsWith('if she treats') ||
    text.startsWith('if he stays') ||
    text.startsWith('if she stays') ||
    text.startsWith('if he doesn\'t') ||
    text.startsWith('if she doesn\'t') ||
    text.startsWith('if he retreats') ||
    text.startsWith('if she retreats') ||
    text.includes('stalling:') ||
    text.includes('hasn\'t asked a single') ||
    text.includes('pleasant but') ||
    text.includes('energy is fading') ||
    text.includes('she\'s evaluating your organization')
  );
}

// ── HTML RENDERING ──────────────────────────────────────────────────

/** Escape HTML entities and convert markdown bold to <strong> */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function getCSS(): string {
  return `:root {
  --ink: #1c1917;
  --ink-secondary: #78716c;
  --ink-tertiary: #a8a29e;
  --paper: #fafaf9;
  --surface: #ffffff;
  --rule: #e7e5e4;
  --rule-strong: #d6d3d1;
  --accent: #b45309;
  --accent-light: #fef3c7;
  --beat-bg: #f5f5f4;
  --start-color: #0f766e;
  --start-bg: #f0fdfa;
  --stay-color: #1e40af;
  --stay-bg: #eff6ff;
  --continue-color: #7e22ce;
  --continue-bg: #faf5ff;
  --trip-color: #991b1b;
  --trip-bg: #fef2f2;
  --trip-border: #fecaca;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Instrument Sans', sans-serif;
  background: var(--paper);
  color: var(--ink);
  line-height: 1.6;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}

.page {
  max-width: 820px;
  margin: 0 auto;
  padding: 48px 40px 80px;
}

/* HEADER */
.header {
  margin-bottom: 48px;
  position: relative;
}
.header::after {
  content: '';
  display: block;
  margin-top: 20px;
  height: 2px;
  background: var(--ink);
}
.header-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  margin-bottom: 6px;
}
.header h1 {
  font-family: 'Source Serif 4', serif;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

/* SECTION LABELS */
.section-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  margin-bottom: 20px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--rule-strong);
}

/* SETUP */
.setup {
  margin-bottom: 56px;
}
.setup-group {
  margin-bottom: 28px;
}
.setup-group:last-child {
  margin-bottom: 0;
}
.setup-heading {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  margin-bottom: 10px;
}
.setup-bullets {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.setup-bullets li {
  font-size: 13.5px;
  line-height: 1.65;
  padding-left: 16px;
  position: relative;
}
.setup-bullets li::before {
  content: '\\2014';
  position: absolute;
  left: 0;
  color: var(--ink-tertiary);
  font-weight: 500;
}
.setup-bullets li strong {
  font-weight: 600;
}

/* THE ARC */
.arc {
  margin-bottom: 56px;
}

.beat {
  margin-bottom: 28px;
  position: relative;
}
.beat:last-child {
  margin-bottom: 0;
}

.beat-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
  padding: 16px 0;
}
.beat-number {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Source Serif 4', serif;
  font-size: 22px;
  font-weight: 700;
  flex-shrink: 0;
}
.beat-title-block {
  flex: 1;
}
.beat-title {
  font-family: 'Source Serif 4', serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}
.beat-goal {
  font-size: 13px;
  color: var(--ink-secondary);
  font-style: italic;
  line-height: 1.5;
  margin-top: 2px;
}

.beat-connector {
  width: 2px;
  height: 20px;
  background: var(--rule-strong);
  margin-left: 23px;
}

.beat-body {
  margin-left: 64px;
  margin-bottom: 8px;
}

.phase {
  margin-bottom: 16px;
  border-radius: 6px;
  overflow: hidden;
}
.phase:last-child {
  margin-bottom: 0;
}

.phase-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 6px 14px;
  display: inline-block;
}
.phase-content {
  padding: 14px 18px;
  font-size: 13.5px;
  line-height: 1.7;
  border: 1px solid;
  border-top: none;
  border-radius: 0 0 6px 6px;
}

/* START */
.phase.start .phase-label {
  background: var(--start-color);
  color: white;
  border-radius: 6px 6px 0 0;
}
.phase.start .phase-content {
  background: var(--start-bg);
  border-color: #99f6e4;
}

/* STAY */
.phase.stay .phase-label {
  background: var(--stay-color);
  color: white;
  border-radius: 6px 6px 0 0;
}
.phase.stay .phase-content {
  background: var(--stay-bg);
  border-color: #bfdbfe;
}
.phase.stay .phase-content p {
  margin-bottom: 12px;
}
.phase.stay .phase-content p:last-child {
  margin-bottom: 0;
}

.stay-scenarios {
  list-style: none;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stay-scenarios li {
  padding-left: 16px;
  position: relative;
  line-height: 1.65;
}
.stay-scenarios li::before {
  content: '\\25B8';
  position: absolute;
  left: 0;
  color: var(--stay-color);
  font-size: 12px;
  top: 2px;
}
.stay-scenarios li strong {
  font-weight: 600;
  color: var(--stay-color);
}

.stalling {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #93c5fd;
  font-size: 13px;
  color: var(--ink);
}
.stalling-label {
  font-weight: 600;
  color: var(--accent);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* CONTINUE */
.phase.continue .phase-label {
  background: var(--continue-color);
  color: white;
  border-radius: 6px 6px 0 0;
}
.phase.continue .phase-content {
  background: var(--continue-bg);
  border-color: #d8b4fe;
}

/* TRIPWIRES */
.tripwires {
  margin-bottom: 56px;
}
.tripwire-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tripwire {
  background: var(--trip-bg);
  border: 1px solid var(--trip-border);
  border-left: 4px solid var(--trip-color);
  border-radius: 0 6px 6px 0;
  padding: 16px 20px;
}
.tripwire-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--trip-color);
  margin-bottom: 6px;
}
.tripwire-row {
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 4px;
}
.tripwire-row:last-child {
  margin-bottom: 0;
}
.tripwire-row em {
  font-style: italic;
  color: var(--ink-secondary);
}
.tripwire-tag {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--trip-color);
  margin-right: 4px;
}

/* ONE LINE */
.one-line {
  margin-bottom: 0;
}
.one-line-box {
  background: var(--ink);
  color: var(--paper);
  padding: 28px 32px;
  border-radius: 8px;
  text-align: center;
}
.one-line-box p {
  font-family: 'Source Serif 4', serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
  font-style: italic;
  letter-spacing: -0.005em;
}

/* PRINT */
@media print {
  body { background: white; font-size: 12px; }
  .page { padding: 24px; max-width: none; }
  .beat { page-break-before: auto; page-break-inside: avoid; }
  .beat-number { width: 40px; height: 40px; font-size: 18px; }
  .phase { break-inside: avoid; }
  .tripwire { break-inside: avoid; }
  .one-line-box { background: var(--ink) !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

/** Compact overrides for embeddable version — moderate spacing for in-page rendering */
function getCompactCSS(): string {
  return `
body { font-size: 13px; }
.page { padding: 36px 32px 56px; }
.setup { margin-bottom: 40px; }
.arc { margin-bottom: 40px; }
.tripwires { margin-bottom: 40px; }
.beat { margin-bottom: 24px; }
.beat-header { padding: 12px 0; margin-bottom: 10px; }
.beat-number { width: 40px; height: 40px; font-size: 18px; }
.setup-bullets { gap: 8px; }
.setup-group { margin-bottom: 24px; }
.phase { margin-bottom: 14px; }
.phase-content { padding: 12px 16px; }
`;
}

/** Scope CSS by prefixing selectors with `.mg-root` */
function scopeCSS(css: string): string {
  return css
    .replace(/^(\.[a-z])/gm, '.mg-root $1')
    .replace(/^(\s+)(\.[a-z])/gm, '$1.mg-root $2')
    .replace(/:root/g, '.mg-root')
    .replace(/^body\s*\{/gm, '.mg-root {')
    .replace(/^\*\s*\{/gm, '.mg-root * {')
    .replace(/^(\s+)body\s*\{/gm, '$1.mg-root {');
}

// ── BODY RENDERING ──────────────────────────────────────────────────

function renderBeat(beat: Beat, isLast: boolean): string {
  // START phase
  const startHtml = `      <div class="phase start">
        <div class="phase-label">Start</div>
        <div class="phase-content">
          ${escapeHtml(beat.start)}
        </div>
      </div>`;

  // STAY phase
  let stayInner = '';

  // Prose paragraphs
  for (const p of beat.stayParagraphs) {
    stayInner += `          <p>${escapeHtml(p)}</p>\n`;
  }

  // Scenario bullets
  if (beat.stayScenarios.length > 0) {
    stayInner += `          <ul class="stay-scenarios">\n`;
    for (const s of beat.stayScenarios) {
      stayInner += `            <li><strong>${escapeHtml(s.label)}</strong> — ${escapeHtml(s.text)}</li>\n`;
    }
    stayInner += `          </ul>\n`;
  }

  // Stalling indicator
  if (beat.stallingText) {
    stayInner += `          <div class="stalling">
            <span class="stalling-label">Stalling:</span> ${escapeHtml(beat.stallingText)}
          </div>\n`;
  }

  const stayHtml = `      <div class="phase stay">
        <div class="phase-label">Stay</div>
        <div class="phase-content">
${stayInner}        </div>
      </div>`;

  // CONTINUE phase
  const continueHtml = `      <div class="phase continue">
        <div class="phase-label">Continue</div>
        <div class="phase-content">
          ${escapeHtml(beat.continue)}
        </div>
      </div>`;

  const connector = isLast ? '' : '\n\n  <div class="beat-connector"></div>';

  return `  <div class="beat">
    <div class="beat-header">
      <div class="beat-number">${beat.number}</div>
      <div class="beat-title-block">
        <div class="beat-title">${escapeHtml(beat.title)}</div>
        <div class="beat-goal">${escapeHtml(beat.goal)}</div>
      </div>
    </div>
    <div class="beat-body">
${startHtml}
${stayHtml}
${continueHtml}
    </div>
  </div>${connector}`;
}

function renderBodyContent(guide: ParsedGuide): string {
  // Header
  let html = `<div class="header">
  <div class="header-label">Meeting Guide</div>
  <h1>${escapeHtml(guide.donorName)}</h1>
</div>

`;

  // Setup
  html += `<div class="setup">
  <div class="section-label">Setup</div>

`;
  for (let g = 0; g < guide.setupGroups.length; g++) {
    const group = guide.setupGroups[g];
    html += `  <div class="setup-group">
    <div class="setup-heading">${escapeHtml(group.heading)}</div>
    <ul class="setup-bullets">
`;
    for (const bullet of group.bullets) {
      html += `      <li>${escapeHtml(bullet)}</li>\n`;
    }
    html += `    </ul>
  </div>\n`;
    if (g < guide.setupGroups.length - 1) html += '\n';
  }
  html += `</div>

`;

  // The Arc
  html += `<div class="arc">
  <div class="section-label">The Arc</div>

`;
  for (let b = 0; b < guide.beats.length; b++) {
    html += renderBeat(guide.beats[b], b === guide.beats.length - 1);
    html += '\n';
  }
  html += `</div>

`;

  // Tripwires
  html += `<div class="tripwires">
  <div class="section-label">Tripwires</div>
  <div class="tripwire-list">
`;
  for (const tw of guide.tripwires) {
    html += `    <div class="tripwire">
      <div class="tripwire-name">${escapeHtml(tw.name)}.</div>
      <div class="tripwire-row"><span class="tripwire-tag">Tell:</span> <em>${escapeHtml(tw.tell)}</em></div>
      <div class="tripwire-row"><span class="tripwire-tag">Recovery:</span> ${escapeHtml(tw.recovery)}</div>
    </div>\n`;
  }
  html += `  </div>
</div>

`;

  // One Line
  html += `<div class="one-line">
  <div class="section-label">One Line</div>
  <div class="one-line-box">
    <p>${escapeHtml(guide.oneLine)}</p>
  </div>
</div>`;

  return html;
}

// ── PUBLIC API ───────────────────────────────────────────────────────

/**
 * Convert meeting guide markdown to self-contained HTML document
 */
export function formatMeetingGuide(markdown: string): string {
  const parsed = parseMarkdown(markdown);
  const css = getCSS();
  const body = renderBodyContent(parsed);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Meeting Guide &mdash; ${escapeHtml(parsed.donorName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div class="page">

${body}

</div>
</body>
</html>`;
}

/** Font overrides: match website fonts (DM Sans + Instrument Serif) instead of standalone fonts */
function getWebsiteFontCSS(): string {
  return `
body { font-family: 'DM Sans', system-ui, sans-serif; }
.header h1 { font-family: 'Instrument Serif', serif; }
.beat-number { font-family: 'Instrument Serif', serif; }
.beat-title { font-family: 'Instrument Serif', serif; }
.one-line-box p { font-family: 'Instrument Serif', serif; }
.header-label { font-family: 'DM Sans', system-ui, sans-serif; font-weight: 600; }
.section-label { font-family: 'DM Sans', system-ui, sans-serif; font-weight: 600; }
.phase-label { font-family: 'DM Sans', system-ui, sans-serif; font-weight: 700; }
.tripwire-tag { font-family: 'DM Sans', system-ui, sans-serif; font-weight: 700; }
`;
}

/**
 * Embeddable version: returns a <div> with scoped CSS, no <html>/<body> wrapper.
 * Safe to inject via dangerouslySetInnerHTML without iframe.
 * Uses website-matching fonts (DM Sans + Instrument Serif).
 */
export function formatMeetingGuideEmbeddable(markdown: string): string {
  const parsed = parseMarkdown(markdown);
  const css = scopeCSS(getCSS() + getCompactCSS() + getWebsiteFontCSS());
  const body = renderBodyContent(parsed);

  return `<style>${css}</style>
<div class="mg-root">
<div class="page">
${body}
</div>
</div>`;
}

/**
 * Generate filename from donor name
 */
export function getMeetingGuideFilename(donorName: string): string {
  const lastName = donorName.split(' ').pop() || donorName;
  return `meeting_guide_${lastName.toLowerCase().replace(/[^a-z]/g, '_')}.html`;
}
