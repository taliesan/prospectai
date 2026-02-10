// Meeting Guide HTML Formatter
// Converts intermediate markdown format to styled HTML
// Added 2026-02-10

interface ParsedGuide {
  donorName: string;
  subtitle: string;
  posture: string;
  lightsUp: Array<{ boldPhrase: string; body: string }>;
  shutsDown: Array<{ boldPhrase: string; body: string }>;
  walkInExpecting: string;
  walkInExpectingHeader: string;
  innerTruth: string[];
  primaryTerritory: string;
  secondaryTerritories: Array<{ label: string; body: string }>;
  setting: string;
  energy: string;
  beats: Array<{
    number: number;
    title: string;
    moveParagraphs: string[];
    signals: Array<{ type: 'advance' | 'hold' | 'adjust'; see: string; do: string }>;
  }>;
  working: string[];
  stalling: string[];
  resetMoves: Array<{ condition: string; move: string; why: string }>;
}

/**
 * Parse the intermediate markdown format into structured data
 */
function parseMarkdown(markdown: string): ParsedGuide {
  const lines = markdown.split('\n');

  const guide: ParsedGuide = {
    donorName: '',
    subtitle: '',
    posture: '',
    lightsUp: [],
    shutsDown: [],
    walkInExpecting: '',
    walkInExpectingHeader: "THEY'LL WALK IN EXPECTING",
    innerTruth: [],
    primaryTerritory: '',
    secondaryTerritories: [],
    setting: '',
    energy: '',
    beats: [],
    working: [],
    stalling: [],
    resetMoves: []
  };

  let currentSection = '';
  let currentBeat: ParsedGuide['beats'][0] | null = null;
  let collectingMove = false;
  let collectingSignals = false;
  let buffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Document header
    if (trimmed.startsWith('# MEETING GUIDE') && trimmed.includes('—')) {
      guide.donorName = trimmed.replace(/^#\s*MEETING GUIDE\s*—\s*/, '').trim();
      continue;
    }

    // Subtitle (italic line like *Democracy Takes Work · ...*)
    if (/^\*[^*]+\*$/.test(trimmed) && guide.subtitle === '' && guide.donorName !== '') {
      guide.subtitle = trimmed.slice(1, -1);
      continue;
    }

    // Horizontal rule
    if (trimmed === '---') {
      continue;
    }

    // Major section headers (##)
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      // Flush
      if (buffer.length > 0) {
        flushBuffer(guide, currentSection, buffer);
        buffer = [];
      }
      if (currentBeat) {
        guide.beats.push(currentBeat);
        currentBeat = null;
        collectingMove = false;
        collectingSignals = false;
      }
      currentSection = trimmed.replace('## ', '').toUpperCase().trim();
      continue;
    }

    // Subsection headers (###)
    if (trimmed.startsWith('### ')) {
      // Flush buffer for previous subsection
      if (buffer.length > 0) {
        flushBuffer(guide, currentSection, buffer);
        buffer = [];
      }

      const subsection = trimmed.replace('### ', '').trim();

      // Check for beat header
      const beatMatch = subsection.match(/^BEAT\s+(\d+)\s*·\s*(.+)$/i);
      if (beatMatch) {
        if (currentBeat) {
          guide.beats.push(currentBeat);
        }
        currentBeat = {
          number: parseInt(beatMatch[1]),
          title: beatMatch[2].trim(),
          moveParagraphs: [],
          signals: []
        };
        collectingMove = false;
        collectingSignals = false;
        continue;
      }

      // Detect WALK IN EXPECTING with pronoun variants
      const walkMatch = subsection.match(/^((?:THEY|SHE|HE)'LL WALK IN EXPECTING)$/i);
      if (walkMatch) {
        currentSection = 'WALK IN EXPECTING';
        guide.walkInExpectingHeader = walkMatch[1].toUpperCase();
        continue;
      }

      currentSection = subsection.toUpperCase().trim();
      continue;
    }

    // Inside a beat
    if (currentBeat) {
      if (trimmed === '**MOVE:**') {
        collectingMove = true;
        collectingSignals = false;
        continue;
      }
      if (trimmed === '**SIGNALS:**') {
        collectingMove = false;
        collectingSignals = true;
        continue;
      }

      if (collectingMove && trimmed) {
        currentBeat.moveParagraphs.push(trimmed);
      }

      if (collectingSignals) {
        const signalMatch = trimmed.match(/^\[(ADVANCE|HOLD|ADJUST)\]\s*(.+?)\s*\|\s*(.+)$/);
        if (signalMatch) {
          currentBeat.signals.push({
            type: signalMatch[1].toLowerCase() as 'advance' | 'hold' | 'adjust',
            see: signalMatch[2].trim(),
            do: signalMatch[3].trim()
          });
        }
      }
      continue;
    }

    // Reading the Room
    if (trimmed.startsWith('**WORKING:**')) {
      const items = trimmed.replace('**WORKING:**', '').trim();
      guide.working = items.split(' · ').map(s => s.trim()).filter(Boolean);
      continue;
    }
    if (trimmed.startsWith('**STALLING:**')) {
      const items = trimmed.replace('**STALLING:**', '').trim();
      guide.stalling = items.split(' · ').map(s => s.trim()).filter(Boolean);
      continue;
    }

    // Reset moves — bold condition lines (but not WORKING/STALLING/MOVE/SIGNALS)
    if (currentSection === 'RESET MOVES' || currentSection === 'RESET MOVES — WHEN THE FLOW STALLS') {
      const conditionMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
      if (conditionMatch) {
        const moveLines: string[] = [];
        let whyText = '';
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (nextLine === '---' || nextLine.startsWith('## ') || nextLine.startsWith('### ')) break;
          if (/^\*\*.+\*\*$/.test(nextLine) && !nextLine.startsWith('**WORKING') && !nextLine.startsWith('**STALLING')) {
            // Next reset move condition
            break;
          }
          if (nextLine.startsWith('WHY:')) {
            whyText = nextLine.replace('WHY:', '').trim();
            j++;
            while (j < lines.length) {
              const whyLine = lines[j].trim();
              if (!whyLine || whyLine.startsWith('**') || whyLine === '---' || whyLine.startsWith('## ')) break;
              whyText += ' ' + whyLine;
              j++;
            }
            break;
          }
          if (nextLine) {
            moveLines.push(nextLine);
          }
          j++;
        }
        if (moveLines.length > 0 || whyText) {
          guide.resetMoves.push({
            condition: conditionMatch[1],
            move: moveLines.join(' '),
            why: whyText
          });
        }
        i = j - 1;
        continue;
      }
    }

    // Lights Up / Shuts Down bullets
    if (trimmed.startsWith('- **')) {
      const bulletMatch = trimmed.match(/^- \*\*(.+?)\*\*\s*(.*)$/);
      if (bulletMatch) {
        const bullet = { boldPhrase: bulletMatch[1], body: bulletMatch[2] };
        if (currentSection.includes('LIGHTS') || currentSection.includes('LIGHT')) {
          guide.lightsUp.push(bullet);
        } else if (currentSection.includes('SHUTS') || currentSection.includes('SHUT')) {
          guide.shutsDown.push(bullet);
        }
      }
      continue;
    }

    // Collect regular content into buffer
    if (trimmed) {
      buffer.push(trimmed);
    } else if (buffer.length > 0) {
      buffer.push('');
    }
  }

  // Flush final buffer
  if (buffer.length > 0) {
    flushBuffer(guide, currentSection, buffer);
  }

  // Push final beat if exists
  if (currentBeat) {
    guide.beats.push(currentBeat);
  }

  return guide;
}

function flushBuffer(guide: ParsedGuide, section: string, buffer: string[]): void {
  const text = buffer.filter(Boolean).join('\n\n');
  if (!text) return;

  if (section === 'POSTURE') {
    guide.posture = text;
  } else if (section === 'WALK IN EXPECTING') {
    guide.walkInExpecting = text;
  } else if (section === 'THEIR INNER TRUTH') {
    guide.innerTruth = text.split('\n\n').filter(Boolean);
  } else if (section === 'PRIMARY TERRITORY') {
    guide.primaryTerritory = text;
  } else if (section.startsWith('SECONDARY TERRITORY')) {
    const num = section.match(/\d+/)?.[0] || String(guide.secondaryTerritories.length + 1);
    guide.secondaryTerritories.push({ label: `Secondary Territory ${num}`, body: text });
  } else if (section === 'SETTING') {
    guide.setting = text;
  } else if (section === 'ENERGY') {
    guide.energy = text;
  }
}

/** Escape HTML and convert markdown bold to <strong> */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Raw CSS for the meeting guide */
function getCSS(): string {
  return `:root {
  --advance: #1a7a3a;
  --advance-bg: #edf7f0;
  --adjust: #b45309;
  --adjust-bg: #fef3e2;
  --hold: #1e5a8a;
  --hold-bg: #edf4fa;
  --warning: #7c2d36;
  --warning-bg: #fdf2f2;
  --warning-border: #e8cfd1;
  --bg: #fafaf8;
  --surface: #ffffff;
  --text: #1a1a18;
  --text-secondary: #5a5a56;
  --border: #e0dfd8;
  --border-strong: #c8c7c0;
  --beat-line: #d4d3cc;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.55;
  font-size: 14px;
}
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 32px;
}

/* HEADER */
.header {
  margin-bottom: 40px;
  padding-bottom: 24px;
  border-bottom: 2px solid var(--text);
}
.header h1 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.header .subtitle {
  font-size: 13px;
  color: var(--text-secondary);
}

/* SECTION HEADERS */
.section-header {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-strong);
}

/* DONOR READ */
.donor-read { margin-bottom: 40px; }
.posture {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--text);
  padding: 16px 20px;
  margin-bottom: 20px;
  line-height: 1.65;
  font-size: 13.5px;
}
.card-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-weight: 700;
}

/* LIGHTS / SHUTS */
.lights-shuts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.lights-col, .shuts-col {
  border-radius: 6px;
  padding: 16px 18px;
}
.lights-col { background: var(--advance-bg); border: 1px solid #c8e0cf; }
.shuts-col { background: var(--adjust-bg); border: 1px solid #e8d9c0; }
.lights-col h3, .shuts-col h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
  font-weight: 700;
}
.lights-col h3 { color: var(--advance); }
.shuts-col h3 { color: var(--adjust); }
.lights-col ul, .shuts-col ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lights-col li, .shuts-col li {
  font-size: 13px;
  line-height: 1.6;
  padding-left: 14px;
  position: relative;
}
.lights-col li::before, .shuts-col li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.lights-col li::before { background: var(--advance); }
.shuts-col li::before { background: var(--adjust); }

/* PREP CARDS */
.prep-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.prep-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 18px;
}
.prep-card h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 8px;
  font-weight: 700;
}
.prep-card p {
  font-size: 13px;
  line-height: 1.65;
  margin-bottom: 10px;
}
.prep-card p:last-child { margin-bottom: 0; }
.prep-card.warning-card {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
}
.prep-card.warning-card h3 { color: var(--warning); }

/* ALIGNMENT MAP */
.alignment-map { margin-bottom: 40px; }
.primary-territory {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--text);
  padding: 16px 20px;
  margin-bottom: 16px;
  line-height: 1.65;
  font-size: 13.5px;
}
.secondary-territories {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.secondary-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 18px;
}
.secondary-item .sec-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  font-weight: 700;
  margin-bottom: 6px;
}
.secondary-item .sec-body {
  font-size: 13px;
  line-height: 1.6;
}

/* LEGEND */
.legend {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.legend-icon {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}
.legend-icon.advance { background: var(--advance); }
.legend-icon.hold { background: var(--hold); }
.legend-icon.adjust { background: var(--adjust); }

/* ARC PREP ROW */
.arc-prep-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 28px;
}
.arc-prep-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 18px;
}
.arc-prep-card h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 8px;
  font-weight: 700;
}
.arc-prep-card p {
  font-size: 13px;
  line-height: 1.65;
}

/* BEATS */
.flow { position: relative; }
.beat {
  position: relative;
  margin-bottom: 8px;
}
.beat-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.beat-number {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--text);
  color: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}
.beat-title {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.beat-move {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--text);
  padding: 18px 20px;
  margin-bottom: 10px;
  margin-left: 48px;
  line-height: 1.7;
  font-size: 13.5px;
}
.beat-move p {
  margin-bottom: 12px;
}
.beat-move p:last-child {
  margin-bottom: 0;
}

/* SIGNAL ROWS */
.beat-signals {
  margin-left: 48px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.signal {
  display: flex;
  border-radius: 5px;
  border: 1px solid var(--border);
  overflow: hidden;
  background: var(--surface);
  min-height: 40px;
}
.signal-tag {
  width: 6px;
  flex-shrink: 0;
}
.signal-tag.advance { background: var(--advance); }
.signal-tag.hold { background: var(--hold); }
.signal-tag.adjust { background: var(--adjust); }
.signal-content {
  display: flex;
  flex: 1;
  min-width: 0;
}
.signal-see {
  flex: 1;
  padding: 8px 14px;
  font-size: 13px;
  border-right: 1px solid var(--border);
  display: flex;
  align-items: center;
}
.signal-do {
  flex: 1;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
}
.signal.advance .signal-do { color: var(--advance); }
.signal.hold .signal-do { color: var(--hold); }
.signal.adjust .signal-do { color: var(--adjust); }

/* CONNECTOR */
.connector {
  margin-left: 17px;
  width: 2px;
  height: 24px;
  background: var(--beat-line);
  position: relative;
}
.connector::after {
  content: '';
  position: absolute;
  bottom: -3px;
  left: -3px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--beat-line);
  border-top: none;
  border-left: none;
  transform: rotate(45deg);
}

/* READING THE ROOM */
.room-legend {
  margin-top: 40px;
  padding-top: 24px;
  border-top: 1px solid var(--border-strong);
}
.room-legend h2 {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 14px;
}
.room-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
.room-col {
  padding: 14px 18px;
  font-size: 13px;
  line-height: 1.65;
}
.room-col:first-child {
  background: var(--advance-bg);
  border: 1px solid #c8e0cf;
  border-right: none;
  border-radius: 6px 0 0 6px;
}
.room-col:last-child {
  background: var(--adjust-bg);
  border: 1px solid #e8d9c0;
  border-radius: 0 6px 6px 0;
}
.room-col h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
  font-weight: 700;
}
.room-col:first-child h3 { color: var(--advance); }
.room-col:last-child h3 { color: var(--adjust); }
.room-col ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.room-col li {
  padding-left: 14px;
  position: relative;
  font-size: 12.5px;
}
.room-col li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.room-col:first-child li::before { background: var(--advance); }
.room-col:last-child li::before { background: var(--adjust); }

/* RESET MOVES */
.reset-section {
  margin-top: 32px;
  padding-top: 28px;
  border-top: 2px solid var(--warning);
}
.reset-section h2 {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--warning);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.reset-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: var(--warning);
  color: white;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 700;
}
.reset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.reset-card {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: 6px;
  padding: 14px 16px;
}
.reset-condition {
  font-size: 14px;
  font-weight: 700;
  color: var(--warning);
  margin-bottom: 8px;
}
.reset-move {
  font-size: 13px;
  line-height: 1.55;
}
.reset-why {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-top: 8px;
  line-height: 1.5;
}

/* PRINT + RESPONSIVE */
@media print {
  body { font-size: 11px; }
  .page { padding: 20px; }
  .beat { break-inside: avoid; }
  .reset-card { break-inside: avoid; }
}
@media (max-width: 768px) {
  .lights-shuts { grid-template-columns: 1fr; }
  .prep-row { grid-template-columns: 1fr; }
  .arc-prep-row { grid-template-columns: 1fr; }
  .reset-grid { grid-template-columns: 1fr; }
  .room-grid { grid-template-columns: 1fr; }
  .room-col:first-child {
    border-right: 1px solid #c8e0cf;
    border-radius: 6px 6px 0 0;
  }
  .room-col:last-child {
    border-radius: 0 0 6px 6px;
  }
  .signal-content { flex-direction: column; }
  .signal-see {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}`;
}

/** Scope CSS by prefixing every selector with `.mg-root` */
function scopeCSS(css: string): string {
  return css
    // Replace :root with .mg-root
    .replace(/:root/g, '.mg-root')
    // Replace body { with .mg-root {
    .replace(/^body\s*\{/gm, '.mg-root {')
    // Replace * { reset with .mg-root * {
    .replace(/^\*\s*\{/gm, '.mg-root * {')
    // Prefix class selectors at start of line with .mg-root
    .replace(/^(\.[a-z])/gm, '.mg-root $1')
    // Prefix @media inner selectors
    .replace(/^(\s+)(\.[a-z])/gm, '$1.mg-root $2')
    // Prefix @media inner body references
    .replace(/^(\s+)body\s*\{/gm, '$1.mg-root {');
}

/** Generate the body content HTML (no document wrapper) */
function renderBodyContent(guide: ParsedGuide): string {
  return `<div class="header">
  <h1>Meeting Guide &mdash; ${escapeHtml(guide.donorName)}</h1>
  <div class="subtitle">${escapeHtml(guide.subtitle)}</div>
</div>

<div class="donor-read">
  <div class="section-header">The Donor Read</div>

  <div class="posture">
    <span class="card-label">Posture</span>
    ${escapeHtml(guide.posture).split('\n\n').map(p => `<p>${p}</p>`).join('\n    ')}
  </div>

  <div class="lights-shuts">
    <div class="lights-col">
      <h3>What Lights Them Up</h3>
      <ul>
        ${guide.lightsUp.map(item => `<li><strong>${escapeHtml(item.boldPhrase)}</strong> ${escapeHtml(item.body)}</li>`).join('\n        ')}
      </ul>
    </div>
    <div class="shuts-col">
      <h3>What Shuts Them Down</h3>
      <ul>
        ${guide.shutsDown.map(item => `<li><strong>${escapeHtml(item.boldPhrase)}</strong> ${escapeHtml(item.body)}</li>`).join('\n        ')}
      </ul>
    </div>
  </div>

  <div class="prep-row">
    <div class="prep-card warning-card">
      <h3>${escapeHtml(guide.walkInExpectingHeader)}</h3>
      <p>${escapeHtml(guide.walkInExpecting)}</p>
    </div>
    <div class="prep-card">
      <h3>Their Inner Truth</h3>
      ${guide.innerTruth.map(p => `<p>${escapeHtml(p)}</p>`).join('\n      ')}
    </div>
  </div>
</div>

<div class="alignment-map">
  <div class="section-header">The Alignment Map</div>

  <div class="primary-territory">
    <span class="card-label">Primary Territory</span>
    ${escapeHtml(guide.primaryTerritory).split('\n\n').map(p => `<p>${p}</p>`).join('\n    ')}
  </div>

  <div class="secondary-territories">
    ${guide.secondaryTerritories.map(t => `<div class="secondary-item">
      <div class="sec-label">${escapeHtml(t.label)}</div>
      <div class="sec-body">${escapeHtml(t.body)}</div>
    </div>`).join('\n    ')}
  </div>
</div>

<div class="section-header">The Meeting Arc</div>

<div class="legend">
  <div class="legend-item">
    <div class="legend-icon advance">&rarr;</div>
    <span>ADVANCE &mdash; beat worked, move forward</span>
  </div>
  <div class="legend-item">
    <div class="legend-icon hold">&#9642;</div>
    <span>HOLD &mdash; protect what's happening</span>
  </div>
  <div class="legend-item">
    <div class="legend-icon adjust">&#8635;</div>
    <span>ADJUST &mdash; still in this beat, shift approach</span>
  </div>
</div>

<div class="arc-prep-row">
  <div class="arc-prep-card">
    <h3>Setting</h3>
    <p>${escapeHtml(guide.setting)}</p>
  </div>
  <div class="arc-prep-card">
    <h3>Energy</h3>
    <p>${escapeHtml(guide.energy)}</p>
  </div>
</div>

<div class="flow">
${guide.beats.map((beat, idx) => `  <div class="beat">
    <div class="beat-header">
      <div class="beat-number">${beat.number}</div>
      <div class="beat-title">${escapeHtml(beat.title)}</div>
    </div>
    <div class="beat-move">
      ${beat.moveParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n      ')}
    </div>
    <div class="beat-signals">
      ${beat.signals.map(sig => `<div class="signal ${sig.type}">
        <div class="signal-tag ${sig.type}"></div>
        <div class="signal-content">
          <div class="signal-see">${escapeHtml(sig.see)}</div>
          <div class="signal-do">${escapeHtml(sig.do)}</div>
        </div>
      </div>`).join('\n      ')}
    </div>
  </div>
  ${idx < guide.beats.length - 1 ? '<div class="connector"></div>' : ''}`).join('\n')}
</div>

<div class="room-legend">
  <h2>Reading the Room</h2>
  <div class="room-grid">
    <div class="room-col">
      <h3>Working</h3>
      <ul>
        ${guide.working.map(item => `<li>${escapeHtml(item)}</li>`).join('\n        ')}
      </ul>
    </div>
    <div class="room-col">
      <h3>Stalling</h3>
      <ul>
        ${guide.stalling.map(item => `<li>${escapeHtml(item)}</li>`).join('\n        ')}
      </ul>
    </div>
  </div>
</div>

<div class="reset-section">
  <h2>
    <span class="reset-icon">!</span>
    Reset Moves &mdash; When the Flow Stalls
  </h2>
  <div class="reset-grid">
    ${guide.resetMoves.map(rm => `<div class="reset-card">
      <div class="reset-condition">${escapeHtml(rm.condition)}</div>
      <div class="reset-move">${escapeHtml(rm.move)}</div>
      <div class="reset-why">${escapeHtml(rm.why)}</div>
    </div>`).join('\n    ')}
  </div>
</div>

</div>`;
}

/**
 * Convert parsed guide to self-contained HTML document (for file download)
 */
function renderHTML(guide: ParsedGuide): string {
  const css = getCSS();
  const body = renderBodyContent(guide);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Meeting Guide — ${escapeHtml(guide.donorName)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
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

/**
 * Render embeddable HTML fragment with scoped CSS (no document wrapper)
 */
function renderEmbeddable(guide: ParsedGuide): string {
  const css = scopeCSS(getCSS());
  const body = renderBodyContent(guide);
  return `<style>${css}</style>
<div class="mg-root">
<div class="page">
${body}
</div>
</div>`;
}

/**
 * Main export: convert meeting guide markdown to styled, self-contained HTML document
 */
export function formatMeetingGuide(markdown: string): string {
  const parsed = parseMarkdown(markdown);
  return renderHTML(parsed);
}

/**
 * Embeddable version: returns a <div> with scoped CSS, no <html>/<body> wrapper.
 * Safe to inject via dangerouslySetInnerHTML without iframe.
 */
export function formatMeetingGuideEmbeddable(markdown: string): string {
  const parsed = parseMarkdown(markdown);
  return renderEmbeddable(parsed);
}

/**
 * Generate filename from donor name
 */
export function getMeetingGuideFilename(donorName: string): string {
  const lastName = donorName.split(' ').pop() || donorName;
  return `meeting_guide_${lastName.toLowerCase().replace(/[^a-z]/g, '_')}.html`;
}
