import { NextRequest } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';

const FILE_DESCRIPTIONS: Record<string, { path: string; label: string; group: string }> = {
  // V5 conversation mode
  'v5-conv1-system':  { path: '/tmp/prospectai-outputs/V5-conversation-1-system-prompt.txt', label: 'Conv 1 system prompt', group: 'V5 Conversation — Research & Profile' },
  'v5-turn1-user':    { path: '/tmp/prospectai-outputs/V5-turn-1-research-user.txt', label: 'Turn 1 user (Research)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn1-response':{ path: '/tmp/prospectai-outputs/V5-turn-1-research-response.txt', label: 'Turn 1 response (Research)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn2-user':    { path: '/tmp/prospectai-outputs/V5-turn-2-critique-user.txt', label: 'Turn 2 user (Research Critique)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn2-response':{ path: '/tmp/prospectai-outputs/V5-turn-2-critique-response.txt', label: 'Turn 2 response (Revised Research)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn3-user':    { path: '/tmp/prospectai-outputs/V5-turn-3-profile-user.txt', label: 'Turn 3 user (Profile Draft)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn3-response':{ path: '/tmp/prospectai-outputs/V5-turn-3-profile-response.txt', label: 'Turn 3 response (Profile Draft)', group: 'V5 Conversation — Research & Profile' },
  'v5-professor-prompt':  { path: '/tmp/prospectai-outputs/V5-professor-prompt.txt', label: 'Professor prompt (canon + draft)', group: 'V5 Conversation — Research & Profile' },
  'v5-professor-feedback':{ path: '/tmp/prospectai-outputs/V5-professor-feedback.txt', label: 'Professor feedback (analytical critique)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn4-user':    { path: '/tmp/prospectai-outputs/V5-turn-4-critique-user.txt', label: 'Turn 4 user (Professor + Editorial)', group: 'V5 Conversation — Research & Profile' },
  'v5-turn4-response':{ path: '/tmp/prospectai-outputs/V5-turn-4-critique-response.txt', label: 'Turn 4 response (Final Profile)', group: 'V5 Conversation — Research & Profile' },
  'v5-conv2-system':  { path: '/tmp/prospectai-outputs/V5-conversation-2-system-prompt.txt', label: 'Conv 2 system prompt', group: 'V5 Conversation — Meeting Guide' },
  'v5-turn5-user':    { path: '/tmp/prospectai-outputs/V5-turn-5-org-user.txt', label: 'Turn 5 user (Org Frame)', group: 'V5 Conversation — Meeting Guide' },
  'v5-turn5-response':{ path: '/tmp/prospectai-outputs/V5-turn-5-org-response.txt', label: 'Turn 5 response (Org Frame)', group: 'V5 Conversation — Meeting Guide' },
  'v5-turn6-user':    { path: '/tmp/prospectai-outputs/V5-turn-6-guide-user.txt', label: 'Turn 6 user (Guide Draft)', group: 'V5 Conversation — Meeting Guide' },
  'v5-turn6-response':{ path: '/tmp/prospectai-outputs/V5-turn-6-guide-response.txt', label: 'Turn 6 response (Guide Draft)', group: 'V5 Conversation — Meeting Guide' },
  'v5-turn7-user':    { path: '/tmp/prospectai-outputs/V5-turn-7-critique-user.txt', label: 'Turn 7 user (Guide Critique)', group: 'V5 Conversation — Meeting Guide' },
  'v5-turn7-response':{ path: '/tmp/prospectai-outputs/V5-turn-7-critique-response.txt', label: 'Turn 7 response (Final Guide)', group: 'V5 Conversation — Meeting Guide' },
  'v5-token-usage':   { path: '/tmp/prospectai-outputs/V5-token-usage.json', label: 'Token usage', group: 'V5 Conversation — Meeting Guide' },
  // Pipeline stages
  'linkedin':                 { path: '/tmp/prospectai-outputs/DEBUG-linkedin-data.json', label: 'LinkedIn data', group: 'Pipeline Stages' },
  'screening-audit':          { path: '/tmp/prospectai-outputs/DEBUG-screening-audit.txt', label: 'Screening audit', group: 'Pipeline Stages' },
  'source-selection':         { path: '/tmp/prospectai-outputs/DEBUG-source-selection.txt', label: 'Source selection', group: 'Pipeline Stages' },
  'source-packet-manifest':   { path: '/tmp/prospectai-outputs/DEBUG-source-packet-manifest.txt', label: 'Source packet manifest', group: 'Pipeline Stages' },
  'fact-check':               { path: '/tmp/prospectai-outputs/DEBUG-fact-check.json', label: 'Fact check', group: 'Pipeline Stages' },
  'research-package':         { path: '/tmp/prospectai-outputs/DEBUG-research-package.txt', label: 'Research package', group: 'Pipeline Stages' },
  // Profile & meeting guide (non-conversation mode)
  'prompt':                   { path: '/tmp/prospectai-outputs/DEBUG-prompt.txt', label: 'Profile prompt', group: 'Profile & Meeting Guide (Legacy)' },
  'first-draft':              { path: '/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt', label: 'Profile first draft', group: 'Profile & Meeting Guide (Legacy)' },
  'critique-prompt':          { path: '/tmp/prospectai-outputs/DEBUG-critique-prompt.txt', label: 'Critique prompt', group: 'Profile & Meeting Guide (Legacy)' },
  'final':                    { path: '/tmp/prospectai-outputs/DEBUG-profile-final.txt', label: 'Final profile', group: 'Profile & Meeting Guide (Legacy)' },
  'meeting-guide-prompt':     { path: '/tmp/prospectai-outputs/DEBUG-meeting-guide-prompt.txt', label: 'Meeting guide prompt', group: 'Profile & Meeting Guide (Legacy)' },
  'meeting-guide':            { path: '/tmp/prospectai-outputs/DEBUG-meeting-guide.md', label: 'Meeting guide (markdown)', group: 'Profile & Meeting Guide (Legacy)' },
  'meeting-guide-html':       { path: '/tmp/prospectai-outputs/DEBUG-meeting-guide.html', label: 'Meeting guide (HTML)', group: 'Profile & Meeting Guide (Legacy)' },
  'deep-research-developer-msg': { path: '/tmp/prospectai-outputs/DEBUG-deep-research-developer-msg.txt', label: 'Deep research developer msg', group: 'Profile & Meeting Guide (Legacy)' },
  'deep-research-user-msg':   { path: '/tmp/prospectai-outputs/DEBUG-deep-research-user-msg.txt', label: 'Deep research user msg', group: 'Profile & Meeting Guide (Legacy)' },
  // Multi-phase conversation
  'phase1-sources':           { path: '/tmp/prospectai-outputs/DEBUG-phase1-sources.txt', label: 'Phase 1 sources', group: 'Multi-Phase Conversation (Legacy)' },
  'phase1-conversation':      { path: '/tmp/prospectai-outputs/DEBUG-phase1-conversation.json', label: 'Phase 1 conversation', group: 'Multi-Phase Conversation (Legacy)' },
  'phase2-sources':           { path: '/tmp/prospectai-outputs/DEBUG-phase2-sources.txt', label: 'Phase 2 sources', group: 'Multi-Phase Conversation (Legacy)' },
  'phase2-conversation':      { path: '/tmp/prospectai-outputs/DEBUG-phase2-conversation.json', label: 'Phase 2 conversation', group: 'Multi-Phase Conversation (Legacy)' },
  'phase3-research-package':  { path: '/tmp/prospectai-outputs/DEBUG-phase3-research-package.txt', label: 'Phase 3 research package', group: 'Multi-Phase Conversation (Legacy)' },
  'phase3-conversation':      { path: '/tmp/prospectai-outputs/DEBUG-phase3-conversation.json', label: 'Phase 3 conversation', group: 'Multi-Phase Conversation (Legacy)' },
  'research-conversation':    { path: '/tmp/prospectai-outputs/DEBUG-research-conversation.json', label: 'Research conversation', group: 'Multi-Phase Conversation (Legacy)' },
  // Legacy
  'extraction':               { path: '/tmp/prospectai-outputs/DEBUG-extraction.txt', label: 'Extraction', group: 'Legacy' },
  'extraction-prompt':        { path: '/tmp/prospectai-outputs/DEBUG-extraction-prompt.txt', label: 'Extraction prompt', group: 'Legacy' },
};

const JSON_KEYS = new Set(['linkedin', 'research-conversation', 'phase1-conversation', 'phase2-conversation', 'phase3-conversation', 'fact-check', 'v5-token-usage']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildIndexHtml(baseUrl: string): string {
  const groups: Record<string, { key: string; label: string; exists: boolean; size: string }[]> = {};

  for (const [key, info] of Object.entries(FILE_DESCRIPTIONS)) {
    if (!groups[info.group]) groups[info.group] = [];
    const exists = existsSync(info.path);
    let size = '';
    if (exists) {
      try { size = formatBytes(statSync(info.path).size); } catch { /* ignore */ }
    }
    groups[info.group].push({ key, label: info.label, exists, size });
  }

  const totalFiles = Object.keys(FILE_DESCRIPTIONS).length;
  const availableFiles = Object.values(FILE_DESCRIPTIONS).filter(f => existsSync(f.path)).length;

  let html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>ProspectAI Debug Dump</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #0f1117; color: #e1e4e8; }
  h1 { color: #f0f3f6; font-size: 1.4em; margin-bottom: 4px; }
  .subtitle { color: #7d8590; font-size: 0.9em; margin-bottom: 24px; }
  .group { margin-bottom: 24px; }
  .group-title { color: #8b949e; font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; border-bottom: 1px solid #21262d; padding-bottom: 4px; }
  .file-row { display: flex; align-items: center; padding: 6px 0; font-size: 0.9em; }
  .file-row + .file-row { border-top: 1px solid #161b22; }
  .dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 10px; flex-shrink: 0; }
  .dot-green { background: #3fb950; }
  .dot-red { background: #484f58; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .missing { color: #484f58; }
  .size { color: #7d8590; font-size: 0.8em; margin-left: auto; padding-left: 12px; white-space: nowrap; }
  .banner { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; font-size: 0.85em; color: #8b949e; }
  .banner strong { color: #e1e4e8; }
  .count { color: #3fb950; font-weight: 600; }
  .count-zero { color: #f85149; font-weight: 600; }
  .download-all { display: inline-block; margin-top: 10px; padding: 8px 16px; background: #238636; color: #fff; border-radius: 6px; text-decoration: none; font-size: 0.85em; font-weight: 600; }
  .download-all:hover { background: #2ea043; text-decoration: none; }
</style>
</head><body>
<h1>Debug Dump</h1>
<p class="subtitle">Intermediate pipeline artifacts from the most recent profile generation</p>
<div class="banner">
  <strong>Status:</strong> <span class="${availableFiles > 0 ? 'count' : 'count-zero'}">${availableFiles}</span> of ${totalFiles} files available.
  ${availableFiles === 0 ? ' No debug files found — run a profile first, then access this page <em>before</em> the next deploy (files are stored in /tmp).' : ''}
  ${availableFiles > 0 ? `<br><a class="download-all" href="${baseUrl}?file=all">Download All (${availableFiles} files)</a>` : ''}
</div>
`;

  for (const [groupName, files] of Object.entries(groups)) {
    html += `<div class="group"><div class="group-title">${groupName}</div>\n`;
    for (const f of files) {
      if (f.exists) {
        html += `<div class="file-row"><span class="dot dot-green"></span><a href="${baseUrl}?file=${f.key}">${f.label}</a><span class="size">${f.size}</span></div>\n`;
      } else {
        html += `<div class="file-row"><span class="dot dot-red"></span><span class="missing">${f.label}</span></div>\n`;
      }
    }
    html += `</div>\n`;
  }

  html += `</body></html>`;
  return html;
}

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');

  // No file param — show index page
  if (!file) {
    const baseUrl = request.nextUrl.pathname;
    return new Response(buildIndexHtml(baseUrl), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Download all available files as a single concatenated text file
  if (file === 'all') {
    const sections: string[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const [key, info] of Object.entries(FILE_DESCRIPTIONS)) {
      if (!existsSync(info.path)) continue;
      try {
        const content = readFileSync(info.path, 'utf-8');
        sections.push(`${'═'.repeat(72)}\n${info.group} — ${info.label}\nFile: ${key}\n${'═'.repeat(72)}\n\n${content}`);
      } catch { /* skip unreadable */ }
    }
    if (sections.length === 0) {
      return new Response(JSON.stringify({ error: 'No debug files available' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const bundle = `ProspectAI Debug Dump — ${timestamp}\n${sections.length} files\n\n${sections.join('\n\n\n')}`;
    return new Response(bundle, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="debug-dump-${timestamp}.txt"`,
      },
    });
  }

  const info = FILE_DESCRIPTIONS[file];
  if (!info) {
    return new Response(
      JSON.stringify({ error: 'Unknown file key', available: Object.keys(FILE_DESCRIPTIONS) }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!existsSync(info.path)) {
    return new Response(
      JSON.stringify({ error: `File not found: ${info.label}. Run a profile first — debug files live in /tmp and are cleared on each deploy.` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const content = readFileSync(info.path, 'utf-8');
  const isJson = JSON_KEYS.has(file);
  const contentType = isJson ? 'application/json'
    : file === 'meeting-guide-html' ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
  const ext = isJson ? 'json'
    : file === 'meeting-guide-html' ? 'html'
    : file === 'meeting-guide' ? 'md'
    : 'txt';

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${file}.${ext}"`,
    },
  });
}
