/**
 * ProspectAI Document Download
 *
 * Client-side document generation. Two formats:
 *   1. HTML — self-contained, print-optimized document (user opens → Cmd+P → PDF)
 *   2. Markdown — plain text fallback
 *
 * Zero dependencies. No Puppeteer. No heavy libraries. Works offline.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface Source {
  url: string;
  title: string;
  snippet?: string;
}

interface DownloadableProfile {
  donorName: string;
  fundraiserName?: string;
  profile: string;          // Persuasion Profile markdown
  meetingGuide?: string;    // Meeting Guide markdown
  sources: Source[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function fileDate(): string {
  return new Date().toISOString().split('T')[0];
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
}

/**
 * Lightweight markdown → HTML converter.
 * Handles headers, bold/italic, lists, blockquotes, horizontal rules, links.
 */
function markdownToHtml(md: string): string {
  if (!md) return '';

  const lines = md.split('\n');
  const htmlLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const isUnordered = /^[\-\*] /.test(line);
    const isOrdered = /^\d+\. /.test(line);
    if (inList && !isUnordered && !isOrdered) {
      htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
      listType = null;
    }

    if (line.trim() === '') { htmlLines.push(''); continue; }
    if (/^---+$/.test(line.trim())) { htmlLines.push('<hr>'); continue; }

    const h4 = line.match(/^#### (.+)$/);
    if (h4) { htmlLines.push(`<h4>${inlineFormat(escapeHtml(h4[1]))}</h4>`); continue; }
    const h3 = line.match(/^### (.+)$/);
    if (h3) { htmlLines.push(`<h3>${inlineFormat(escapeHtml(h3[1]))}</h3>`); continue; }
    const h2 = line.match(/^## (.+)$/);
    if (h2) { htmlLines.push(`<h2>${inlineFormat(escapeHtml(h2[1]))}</h2>`); continue; }
    const h1 = line.match(/^# (.+)$/);
    if (h1) { htmlLines.push(`<h1>${inlineFormat(escapeHtml(h1[1]))}</h1>`); continue; }

    if (line.startsWith('> ')) {
      htmlLines.push(`<blockquote>${inlineFormat(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }

    if (isUnordered) {
      if (!inList || listType !== 'ul') {
        if (inList) htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        htmlLines.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      htmlLines.push(`<li>${inlineFormat(escapeHtml(line.replace(/^[\-\*] /, '')))}</li>`);
      continue;
    }

    if (isOrdered) {
      if (!inList || listType !== 'ol') {
        if (inList) htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        htmlLines.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      htmlLines.push(`<li>${inlineFormat(escapeHtml(line.replace(/^\d+\. /, '')))}</li>`);
      continue;
    }

    htmlLines.push(`<p>${inlineFormat(escapeHtml(line))}</p>`);
  }

  if (inList) htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
  return htmlLines.join('\n');
}

function inlineFormat(text: string): string {
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

// ─── Sources rendering ───────────────────────────────────────────────────────

function renderSourcesHtml(sources: Source[]): string {
  if (sources.length === 0) return '<p class="muted">No sources available.</p>';

  return `<div class="sources-list">
${sources.map((s, i) => `
    <div class="source-item">
      <span class="source-num">${i + 1}.</span>
      <div class="source-body">
        <div class="source-title">${escapeHtml(s.title || s.url)}</div>
        <div class="source-url">${escapeHtml(s.url)}</div>
      </div>
    </div>`).join('\n')}
  </div>`;
}

function renderSourcesMarkdown(sources: Source[]): string {
  if (sources.length === 0) return '*No sources available.*\n';
  return sources.map((s, i) => {
    return `${i + 1}. **${s.title || s.url}**\n   ${s.url}`;
  }).join('\n\n');
}

// ─── HTML Document ───────────────────────────────────────────────────────────

function buildHtmlDocument(data: DownloadableProfile): string {
  const date = formatDate();
  const profileHtml = markdownToHtml(data.profile);
  const guideHtml = data.meetingGuide ? markdownToHtml(data.meetingGuide) : '';
  const sourcesHtml = renderSourcesHtml(data.sources);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(data.donorName)} — ProspectAI Donor Intelligence</title>
<style>
@page { size: letter; margin: 0.75in 0.9in; }

:root {
  --ink: #1a1a2e; --ink-mid: #3a3a4e; --ink-light: #6a6a7e;
  --accent: #2d5a7b; --accent-pale: #e4eef5;
  --rule: #d4d4de; --bg: #ffffff;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 10.5pt; line-height: 1.65; color: var(--ink); background: var(--bg);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

.print-banner {
  position: sticky; top: 0; z-index: 100; background: var(--accent); color: #fff;
  text-align: center; padding: 10px 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 13px; line-height: 1.5;
}
.print-banner kbd {
  display: inline-block; background: rgba(255,255,255,0.2);
  border-radius: 3px; padding: 1px 6px; font-family: inherit; font-size: 12px;
}
@media print { .print-banner { display: none !important; } }

.cover {
  page-break-after: always; min-height: 92vh;
  display: flex; flex-direction: column; justify-content: center; padding: 0 0.5in;
}
.cover-eyebrow {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 8.5pt; font-weight: 600; letter-spacing: 3.5px;
  text-transform: uppercase; color: var(--accent); margin-bottom: 1.5em;
}
.cover-name { font-size: 30pt; font-weight: 400; line-height: 1.15; color: var(--ink); margin-bottom: 0.15em; }
.cover-subtitle { font-size: 12pt; color: var(--ink-light); font-style: italic; margin-bottom: 3em; }
.cover-rule { width: 50px; height: 2px; background: var(--accent); margin-bottom: 2em; }
.cover-meta {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 9pt; color: var(--ink-light); line-height: 2;
}
.cover-meta strong { color: var(--ink-mid); font-weight: 600; }

.section { page-break-before: always; padding-top: 0; }
.section-header { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 2px solid var(--accent); }
.section-eyebrow {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 8pt; font-weight: 600; letter-spacing: 3px;
  text-transform: uppercase; color: var(--accent); margin-bottom: 0.4em;
}
.section-title { font-size: 20pt; font-weight: 400; color: var(--ink); line-height: 1.2; }

.content h1 { font-size: 16pt; font-weight: 700; color: var(--ink); margin: 1.8em 0 0.6em; line-height: 1.25; }
.content h2 { font-size: 13pt; font-weight: 700; color: var(--ink); margin: 1.5em 0 0.5em; text-transform: uppercase; letter-spacing: 0.5px; }
.content h3 { font-size: 11pt; font-weight: 700; color: var(--ink-mid); margin: 1.3em 0 0.4em; }
.content h4 { font-size: 10.5pt; font-weight: 700; font-style: italic; color: var(--ink-mid); margin: 1em 0 0.3em; }
.content p { margin: 0.6em 0; orphans: 3; widows: 3; }
.content strong { font-weight: 700; color: var(--ink); }
.content em { font-style: italic; }
.content blockquote { margin: 1em 0; padding: 0.6em 1em; border-left: 3px solid var(--accent); background: var(--accent-pale); font-style: italic; color: var(--ink-mid); }
.content hr { border: none; border-top: 1px solid var(--rule); margin: 1.5em 0; }
.content ul, .content ol { margin: 0.6em 0; padding-left: 1.5em; }
.content li { margin: 0.35em 0; }
.content li::marker { color: var(--accent); }
.content a { color: var(--accent); text-decoration: none; }

.sources-list { margin-top: 1em; }
.source-item { display: flex; gap: 0.5em; margin-bottom: 1em; padding-bottom: 0.8em; border-bottom: 1px solid #eee; }
.source-num {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 9pt; font-weight: 600; color: var(--accent); min-width: 1.5em; padding-top: 2px;
}
.source-body { flex: 1; min-width: 0; }
.source-title { font-weight: 600; font-size: 10pt; color: var(--ink); margin-bottom: 2px; }
.source-url {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 8.5pt; color: var(--accent); word-break: break-all;
}
.source-snippet { font-size: 9pt; color: var(--ink-light); margin-top: 3px; font-style: italic; }
.muted { color: var(--ink-light); font-style: italic; }

.doc-footer {
  margin-top: 3em; padding-top: 1em; border-top: 1px solid var(--rule);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 8pt; color: var(--ink-light); text-align: center;
}
</style>
</head>
<body>

<div class="print-banner">
  📄 To save as PDF: press <kbd>⌘P</kbd> and choose "Save as PDF" as the destination.
</div>

<div class="cover">
  <div class="cover-eyebrow">ProspectAI Donor Intelligence</div>
  <div class="cover-name">${escapeHtml(data.donorName)}</div>
  <div class="cover-subtitle">Behavioral Profile &amp; Meeting Strategy</div>
  <div class="cover-rule"></div>
  <div class="cover-meta">
    ${data.fundraiserName ? `<strong>Prepared for</strong> ${escapeHtml(data.fundraiserName)}<br>` : ''}
    <strong>Date</strong> ${date}<br>
    <strong>Classification</strong> Internal Use Only
  </div>
</div>

<div class="section">
  <div class="section-header">
    <div class="section-eyebrow">Section 1</div>
    <div class="section-title">Persuasion Profile</div>
  </div>
  <div class="content">${profileHtml}</div>
</div>

${guideHtml ? `
<div class="section">
  <div class="section-header">
    <div class="section-eyebrow">Section 2</div>
    <div class="section-title">Meeting Guide</div>
  </div>
  <div class="content">${guideHtml}</div>
</div>
` : ''}

<div class="section">
  <div class="section-header">
    <div class="section-eyebrow">Section ${guideHtml ? '3' : '2'}</div>
    <div class="section-title">Research Sources</div>
  </div>
  <div class="content">
    <p>${data.sources.length} source${data.sources.length !== 1 ? 's' : ''} were used in generating this intelligence.</p>
    ${sourcesHtml}
  </div>
</div>

<div class="doc-footer">Generated by ProspectAI · ${date} · Confidential</div>

</body>
</html>`;
}

// ─── Markdown Document ───────────────────────────────────────────────────────

function buildMarkdownDocument(data: DownloadableProfile): string {
  const date = formatDate();
  const divider = '\n\n---\n\n';
  let doc = `# PROSPECTAI DONOR INTELLIGENCE\n\n## ${data.donorName}\n\n**Behavioral Profile & Meeting Strategy**\n\n`;
  if (data.fundraiserName) doc += `Prepared for: ${data.fundraiserName}\n`;
  doc += `Date: ${date}\nClassification: Internal Use Only\n`;
  doc += divider;
  doc += `# SECTION 1: PERSUASION PROFILE\n\n${data.profile}`;
  doc += divider;
  if (data.meetingGuide) {
    doc += `# SECTION 2: MEETING GUIDE\n\n${data.meetingGuide}`;
    doc += divider;
  }
  doc += `# SECTION ${data.meetingGuide ? '3' : '2'}: RESEARCH SOURCES\n\n${renderSourcesMarkdown(data.sources)}`;
  doc += `\n\n---\n\n*Generated by ProspectAI · ${date} · Confidential*\n`;
  return doc;
}

// ─── Download triggers ───────────────────────────────────────────────────────

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadAsHtml(data: DownloadableProfile): void {
  const html = buildHtmlDocument(data);
  const filename = `${sanitizeFilename(data.donorName)}-ProspectAI-${fileDate()}.html`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const newTab = window.open(url, '_blank');
  if (!newTab) triggerDownload(html, filename, 'text/html');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadAsMarkdown(data: DownloadableProfile): void {
  const md = buildMarkdownDocument(data);
  const filename = `${sanitizeFilename(data.donorName)}-ProspectAI-${fileDate()}.md`;
  triggerDownload(md, filename, 'text/markdown');
}

export function downloadProfile(
  data: DownloadableProfile,
  format: 'html' | 'markdown' = 'html'
): void {
  if (format === 'markdown') downloadAsMarkdown(data);
  else downloadAsHtml(data);
}

export type { DownloadableProfile, Source };
