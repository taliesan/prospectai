// Client-side PDF generation for ProspectAI donor intelligence reports
// Renders markdown content as styled HTML, then converts to PDF
// Uses html2pdf.js (jsPDF + html2canvas) for browser-side generation

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const html2pdf: any;

interface PDFGenerationOptions {
  donorName: string;
  fundraiserName?: string;
  profile: string;
  meetingGuide?: string;
  sources: { url: string; title: string; snippet?: string }[];
}

// Convert markdown to HTML using a simple regex-based approach
// (avoids importing a full markdown parser since html2pdf.js handles HTML)
function markdownToHtml(md: string): string {
  let html = md
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Tables (basic support)
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim()).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
      const tag = 'td';
      return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    })
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br>');

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/((?:<li>.*?<\/li>(?:<br>)?)+)/g, '<ul>$1</ul>');

  // Wrap consecutive <tr> items in <table>
  html = html.replace(/((?:<tr>.*?<\/tr>(?:<br>)?)+)/g, '<table>$1</table>');

  // Clean up stray <br> inside lists and tables
  html = html.replace(/<\/li><br><li>/g, '</li><li>');
  html = html.replace(/<\/tr><br><tr>/g, '</tr><tr>');

  return `<p>${html}</p>`;
}

function buildSourcesHtml(sources: { url: string; title: string; snippet?: string }[]): string {
  if (sources.length === 0) return '<p>No sources available.</p>';

  // Group by domain
  const grouped = new Map<string, typeof sources>();
  sources.forEach(source => {
    try {
      const domain = new URL(source.url).hostname.replace('www.', '');
      if (!grouped.has(domain)) grouped.set(domain, []);
      grouped.get(domain)!.push(source);
    } catch {
      if (!grouped.has('other')) grouped.set('other', []);
      grouped.get('other')!.push(source);
    }
  });

  let html = '';
  Array.from(grouped.entries()).sort().forEach(([domain, domainSources]) => {
    html += `<h3 style="text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: #666; margin-top: 16px; margin-bottom: 8px;">${domain}</h3>`;
    html += '<ul style="margin: 0; padding-left: 16px;">';
    domainSources.forEach(source => {
      html += `<li style="margin-bottom: 6px; font-size: 11px;">`;
      html += `<span style="color: #2563eb;">${source.title || source.url}</span>`;
      if (source.title) {
        html += `<br><span style="color: #999; font-size: 10px; word-break: break-all;">${source.url}</span>`;
      }
      html += '</li>';
    });
    html += '</ul>';
  });

  return html;
}

function buildFullHtml(options: PDFGenerationOptions): string {
  const { donorName, fundraiserName, profile, meetingGuide, sources } = options;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const profileHtml = markdownToHtml(profile);
  const meetingGuideHtml = meetingGuide ? markdownToHtml(meetingGuide) : '';
  const sourcesHtml = buildSourcesHtml(sources);

  return `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #1a1a1a;
        line-height: 1.6;
        font-size: 12px;
      }
      h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; margin-top: 24px; color: #111; }
      h2 { font-size: 17px; font-weight: 700; margin-bottom: 10px; margin-top: 20px; color: #111; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; margin-top: 16px; color: #333; }
      p { margin-bottom: 10px; }
      strong { font-weight: 700; }
      em { font-style: italic; }
      ul { padding-left: 20px; margin-bottom: 10px; }
      li { margin-bottom: 6px; }
      hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
      td, th { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
      tr:nth-child(even) { background: #f9f9f9; }

      .cover-page {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 700px;
        text-align: center;
        page-break-after: always;
      }
      .cover-page .label {
        font-size: 11px;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: #666;
        margin-bottom: 24px;
      }
      .cover-page .donor-name {
        font-size: 36px;
        font-weight: 700;
        color: #111;
        margin-bottom: 16px;
        line-height: 1.2;
      }
      .cover-page .prepared-for {
        font-size: 14px;
        color: #666;
        margin-bottom: 8px;
      }
      .cover-page .date {
        font-size: 13px;
        color: #999;
        margin-bottom: 40px;
      }
      .cover-page .org {
        font-size: 13px;
        font-weight: 600;
        color: #444;
        letter-spacing: 1px;
      }
      .cover-page .confidential {
        font-size: 10px;
        color: #999;
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-top: 40px;
      }

      .section-break {
        page-break-before: always;
      }
      .section-header {
        font-size: 11px;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: #666;
        border-bottom: 2px solid #111;
        padding-bottom: 6px;
        margin-bottom: 24px;
        margin-top: 0;
      }
      .content { padding: 0 8px; }
      .footer {
        font-size: 9px;
        color: #999;
        text-align: center;
        margin-top: 40px;
        padding-top: 12px;
        border-top: 1px solid #eee;
      }
    </style>

    <!-- Cover Page -->
    <div class="cover-page">
      <div class="label">ProspectAI Donor Intelligence</div>
      <div class="donor-name">${donorName}</div>
      ${fundraiserName ? `<div class="prepared-for">Prepared for ${fundraiserName}</div>` : ''}
      <div class="date">${date}</div>
      <div class="org">Democracy Takes Work</div>
      <div class="confidential">Confidential</div>
    </div>

    <!-- Persuasion Profile -->
    <div class="section-break">
      <div class="section-header">Persuasion Profile</div>
      <div class="content">
        ${profileHtml}
      </div>
    </div>

    ${meetingGuideHtml ? `
    <!-- Meeting Guide -->
    <div class="section-break">
      <div class="section-header">Meeting Guide</div>
      <div class="content">
        ${meetingGuideHtml}
      </div>
    </div>
    ` : ''}

    <!-- Research Sources -->
    <div class="section-break">
      <div class="section-header">Research Sources</div>
      <div class="content">
        <p style="color: #666; font-size: 11px; margin-bottom: 16px;">
          ${sources.length} source${sources.length !== 1 ? 's' : ''} collected &middot; Generated ${date}
        </p>
        ${sourcesHtml}
      </div>
    </div>

    <div class="footer">
      CONFIDENTIAL &middot; ProspectAI &middot; Democracy Takes Work &middot; ${date}
    </div>
  `;
}

export async function generatePDF(options: PDFGenerationOptions): Promise<void> {
  console.log('[PDF] generatePDF called with:', {
    donorName: options.donorName,
    profileLength: options.profile?.length ?? 'MISSING',
    meetingGuideLength: options.meetingGuide?.length ?? 'MISSING',
    sourcesCount: options.sources?.length ?? 0,
  });

  // Dynamic import to avoid SSR issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html2pdfModule = await import('html2pdf.js') as any;
  // Handle both ESM default export and CommonJS module.exports
  const html2pdfFn = html2pdfModule.default || html2pdfModule;

  console.log('[PDF] html2pdf loaded:', typeof html2pdfFn, html2pdfFn ? 'ok' : 'MISSING');

  if (typeof html2pdfFn !== 'function') {
    console.error('[PDF] html2pdf is not a function! Module:', html2pdfModule);
    throw new Error('html2pdf.js failed to load properly');
  }

  const html = buildFullHtml(options);
  console.log('[PDF] Generated HTML length:', html.length, 'First 300 chars:', html.slice(0, 300));

  // Create a temporary container
  // Use opacity:0 instead of left:-9999px so html2canvas can render it
  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.width = '210mm'; // A4 width
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.opacity = '0';
  container.style.zIndex = '-1';
  container.style.pointerEvents = 'none';
  document.body.appendChild(container);

  const date = new Date().toISOString().split('T')[0];
  const safeName = options.donorName.replace(/\s+/g, '-');
  const filename = `${safeName}-ProspectAI-${date}.pdf`;

  console.log('[PDF] Container added to DOM, child count:', container.children.length);

  try {
    await html2pdfFn()
      .set({
        margin: [15, 15, 20, 15],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
        },
        pagebreak: { mode: ['css', 'legacy'], before: '.section-break' },
      } as any)
      .from(container)
      .save();
    console.log('[PDF] Save completed');
  } finally {
    document.body.removeChild(container);
  }
}
