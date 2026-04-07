#!/usr/bin/env node
/**
 * Career-OS Web Dashboard -- Full Command Center
 * FutureSpeak.AI branded | 8-tab interactive dashboard
 * Usage: node dashboard-web.mjs [--no-open]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve('.');
const read = (f) => { try { return readFileSync(join(ROOT, f), 'utf-8'); } catch { return ''; } };

// ═══════════════════════════════════════════
// PARSERS
// ═══════════════════════════════════════════

function parseMdTable(content) {
  const lines = content.split('\n');
  const rows = []; let headers = null;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    if (!headers) { headers = cells; continue; }
    const row = {};
    cells.forEach((c, i) => { if (headers[i]) row[headers[i]] = c; });
    rows.push(row);
  }
  return { headers: headers || [], rows };
}

function parseMdSections(content) {
  const sections = []; let cur = null;
  for (const line of content.split('\n')) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    if (h2 || h3) {
      if (cur) sections.push(cur);
      cur = { title: (h2 || h3)[1], level: h2 ? 2 : 3, body: '' };
    } else if (cur) { cur.body += line + '\n'; }
  }
  if (cur) sections.push(cur);
  return sections;
}

function md(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n{2,}/g, '<br>');
}

function parseEnvStatus() {
  const env = read('.env');
  const status = {};
  for (const line of env.split('\n')) {
    if (line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...v] = line.split('=');
    status[key.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '').length > 0;
  }
  return status;
}

// ═══════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════

// Profile
let P = {};
try {
  const yml = read('config/profile.yml');
  const g = (k) => { const m = yml.match(new RegExp(`${k}:\\s*"?([^"\\n]+)"?`)); return m ? m[1].trim() : ''; };
  P = { name: g('full_name'), email: g('email'), location: g('location'),
    linkedin: g('linkedin'), github: g('github'), portfolio: g('portfolio_url'),
    headline: g('headline'), target: g('target_range'), minimum: g('minimum'), current: g('current') };
} catch {}

// Pipeline
const pendingOffers = [];
for (const line of read('data/pipeline.md').split('\n')) {
  const m = line.match(/^- \[[ x]\]\s+(\S+)\s+\|\s+(.+?)\s+\|\s+(.+)$/);
  if (m) pendingOffers.push({ url: m[1], company: m[2].trim(), title: m[3].trim(), done: line.includes('[x]') });
}
const vpOffers = pendingOffers.filter(o => /\b(VP|Vice President|Chief|CAIO|CTO)\b/i.test(o.title));
const dirOffers = pendingOffers.filter(o => /\b(Director|Head)\b/i.test(o.title) && !vpOffers.includes(o));
const otherOffers = pendingOffers.filter(o => !vpOffers.includes(o) && !dirOffers.includes(o));

// Applications
const appsTable = parseMdTable(read('data/applications.md'));
const apps = appsTable.rows.filter(r => r['#'] && /^\d+$/.test(r['#']));

// Scan
const scanLines = read('data/scan-history.tsv').split('\n').filter(l => l && !l.startsWith('url\t'));
const scanAdded = scanLines.filter(l => l.includes('\tadded')).length;
const scanSkipped = scanLines.filter(l => l.includes('\tskipped')).length;

// Reports
const reportsDir = join(ROOT, 'reports');
const reports = existsSync(reportsDir) ? readdirSync(reportsDir).filter(f => f.endsWith('.md')) : [];

// Status counts
const statusCounts = {};
for (const a of apps) { const s = a['Status'] || ''; statusCounts[s] = (statusCounts[s] || 0) + 1; }
const interviewCount = statusCounts['Interview'] || 0;
const appliedCount = statusCounts['Applied'] || 0;
const respondedCount = statusCounts['Responded'] || 0;
const offerCount = statusCounts['Offer'] || 0;
const responseRate = appliedCount > 0 ? Math.round(((respondedCount + interviewCount + offerCount) / appliedCount) * 100) : 0;

// CRM
const contacts = parseMdTable(read('crm/contacts.md'));
const followUps = parseMdTable(read('crm/follow-up-queue.md'));
const outreachTemplates = parseMdSections(read('crm/outreach-templates.md'));
const crmPipeline = parseMdSections(read('crm/pipeline-status.md'));

// Interview Prep
const storyBank = parseMdTable(read('interview-prep/story-bank.md'));
const prepDir = join(ROOT, 'meetings', 'prep-templates');
const prepTemplates = existsSync(prepDir) ? readdirSync(prepDir).filter(f => f.endsWith('.md')).map(f => {
  const c = readFileSync(join(prepDir, f), 'utf-8');
  const t = (c.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/-/g, ' ').replace('.md', '');
  return { file: f, title: t };
}) : [];

// Comp Lab
const marketData = parseMdSections(read('comp-lab/market-data.md'));
const roleComp = parseMdSections(read('comp-lab/role-comp-summary.md'));
const negPlaybook = parseMdSections(read('comp-lab/negotiation-playbook.md'));

// Brand
const brandPos = parseMdSections(read('brand/brand-positioning.md'));
const contentCal = parseMdSections(read('brand/content-calendar.md'));
const engagement = parseMdSections(read('brand/engagement-tracker.md'));
const articleDigest = parseMdSections(read('article-digest.md'));

// Analytics
const pipelineMetrics = parseMdSections(read('analytics/pipeline-metrics.md'));
const rejectionTracker = parseMdSections(read('analytics/rejection-tracker.md'));
const weeklyReview = parseMdSections(read('analytics/weekly-review-template.md'));

// Score distribution
const scoreDist = [0,0,0,0,0]; // [4.5+, 4.0-4.4, 3.5-3.9, 3.0-3.4, <3.0]
for (const a of apps) {
  const s = parseFloat((a['Score'] || '0').replace('/5', ''));
  if (s >= 4.5) scoreDist[0]++; else if (s >= 4.0) scoreDist[1]++;
  else if (s >= 3.5) scoreDist[2]++; else if (s >= 3.0) scoreDist[3]++; else if (s > 0) scoreDist[4]++;
}
const scoreMax = Math.max(...scoreDist, 1);

// Connectors
const envStatus = parseEnvStatus();
const connectorDocs = parseMdSections(read('docs/CONNECTIVITY.md'));

const NOW = new Date().toISOString().split('T')[0];

// ═══════════════════════════════════════════
// HTML HELPERS
// ═══════════════════════════════════════════

const esc = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

const emptyState = (msg, hint) => `<div class="empty-state"><div class="empty-icon">&#9889;</div><p>${msg}</p>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;

const collapsible = (title, body, open = false) => `
<div class="collapsible ${open ? 'open' : ''}">
  <div class="collapsible-header"><span class="chev">&#9656;</span> ${title}</div>
  <div class="collapsible-body">${body}</div>
</div>`;

const offerRow = (o, i, tier) => `<tr class="offer-row ${o.done?'done':''}" data-company="${esc(o.company.toLowerCase())}" data-title="${esc(o.title.toLowerCase())}" data-tier="${tier}"><td class="col-num">${i+1}</td><td class="col-company">${esc(o.company)}</td><td class="col-title">${esc(o.title)}</td><td><span class="tier-pill tier-${tier}">${tier}</span></td><td class="col-action"><a href="${esc(o.url)}" target="_blank" class="btn-glow">View</a></td></tr>`;

const appRow = (a) => { const st = (a['Status']||'').toLowerCase().replace(/\s+/g,'-'); return `<tr class="app-row status-${st}" data-company="${esc((a['Company']||'').toLowerCase())}" data-status="${st}" data-score="${a['Score']||''}" data-date="${a['Date']||''}"><td class="col-num">${a['#']||''}</td><td>${a['Date']||''}</td><td class="col-company">${esc(a['Company']||'')}</td><td>${esc(a['Role']||'')}</td><td class="col-score">${a['Score']||''}</td><td><span class="status-badge">${a['Status']||''}</span></td><td>${a['PDF']||''}</td><td>${a['Report']||''}</td><td class="col-notes">${esc(a['Notes']||'')}</td></tr>`; };

const sectionCard = (s) => `<div class="md-card"><h4>${esc(s.title)}</h4><div class="md-content">${md(s.body)}</div></div>`;

// ═══════════════════════════════════════════
// TAB CONTENT
// ═══════════════════════════════════════════

// --- Pipeline Tab ---
const allOfferRows = [
  ...vpOffers.map((o,i) => offerRow(o,i,'c-suite')),
  ...dirOffers.map((o,i) => offerRow(o,i,'director')),
  ...otherOffers.map((o,i) => offerRow(o,i,'other'))
].join('');

const pipelineTab = `
<div class="filter-bar">
  <input type="text" class="filter-input" id="pipeline-search" placeholder="Search company or role..." />
  <select class="filter-select" id="pipeline-tier">
    <option value="all">All Tiers</option>
    <option value="c-suite">C-Suite / VP</option>
    <option value="director">Director / Head</option>
    <option value="other">Other</option>
  </select>
  <span class="filter-count" id="pipeline-count">${pendingOffers.length} offers</span>
</div>
${pendingOffers.length ? `
<div class="table-wrap">
  <table id="pipeline-table">
    <thead><tr><th>#</th><th>Company</th><th>Role</th><th>Tier</th><th></th></tr></thead>
    <tbody>${allOfferRows}</tbody>
  </table>
</div>` : emptyState('No offers in pipeline.', 'Run <code>/career-os scan</code> to discover new opportunities.')}
<div class="sub-stats">
  <span class="sub-stat"><b>${scanAdded}</b> discovered</span>
  <span class="sub-stat"><b>${scanSkipped}</b> filtered</span>
  <span class="sub-stat"><b>${scanLines.length}</b> total scanned</span>
  <span class="sub-stat">Last scan: <b>${NOW}</b></span>
</div>`;

// --- Tracker Tab ---
const funnelStatuses = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];
const funnelTotal = Math.max(apps.length, 1);
const funnelBars = funnelStatuses.map(s => {
  const n = statusCounts[s] || 0; const pct = Math.round((n/funnelTotal)*100);
  const cls = s.toLowerCase().replace(/\s+/g,'-');
  return n > 0 ? `<div class="funnel-stage status-${cls}" style="flex:${n}" title="${s}: ${n}"><span>${s} (${n})</span></div>` : '';
}).filter(Boolean).join('');

const trackerTab = `
${apps.length ? `<div class="funnel">${funnelBars}</div>` : ''}
<div class="filter-bar">
  <input type="text" class="filter-input" id="tracker-search" placeholder="Search company or role..." />
  <select class="filter-select" id="tracker-status">
    <option value="all">All Statuses</option>
    ${funnelStatuses.map(s => `<option value="${s.toLowerCase()}">${s}</option>`).join('')}
  </select>
  <span class="filter-count" id="tracker-count">${apps.length} applications</span>
</div>
${apps.length ? `
<div class="table-wrap">
  <table id="tracker-table">
    <thead><tr><th class="sortable" data-col="num">#</th><th class="sortable" data-col="date">Date</th><th>Company</th><th>Role</th><th class="sortable" data-col="score">Score</th><th class="sortable" data-col="status">Status</th><th>PDF</th><th>Report</th><th>Notes</th></tr></thead>
    <tbody>${apps.map(appRow).join('')}</tbody>
  </table>
</div>` : emptyState('No applications tracked yet.', 'Paste a job URL to start evaluating, or run <code>/career-os pipeline</code>.')}`;

// --- Interview Prep Tab ---
const storyHtml = storyBank.rows.length ? `<div class="table-wrap"><table><thead><tr>${storyBank.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${storyBank.rows.map(r=>`<tr>${storyBank.headers.map(h=>`<td>${esc(r[h]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : emptyState('No stories yet.','Stories are added automatically as you evaluate offers.');

const prepCards = prepTemplates.map(t => `<div class="prep-card"><div class="prep-icon">&#128196;</div><div class="prep-title">${esc(t.title)}</div></div>`).join('');

const interviewTab = `
${collapsible('Story Bank (STAR+R)', storyHtml, true)}
${prepTemplates.length ? collapsible('Meeting Prep Briefs', `<div class="prep-grid">${prepCards}</div>`, true) : ''}
${collapsible('Company Prep Template', md(read('interview-prep/company-prep-template.md')))}`;

// --- CRM Tab ---
const contactRows = contacts.rows.length ? `<div class="filter-bar"><input type="text" class="filter-input" id="crm-search" placeholder="Search contacts..." /><span class="filter-count" id="crm-count">${contacts.rows.length} contacts</span></div><div class="table-wrap"><table id="crm-table"><thead><tr>${contacts.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${contacts.rows.map(r=>`<tr data-search="${esc(contacts.headers.map(h=>r[h]||'').join(' ').toLowerCase())}">${contacts.headers.map(h=>`<td>${esc(r[h]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : emptyState('No contacts yet.','Run <code>/career-os outreach</code> to start building your network.');

const followUpHtml = followUps.rows.length ? `<div class="table-wrap"><table><thead><tr>${followUps.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${followUps.rows.map(r=>`<tr>${followUps.headers.map(h=>`<td>${esc(r[h]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : emptyState('No pending follow-ups.');

const templateCards = outreachTemplates.length ? outreachTemplates.map(sectionCard).join('') : emptyState('No outreach templates configured.');

const crmTab = `
${contactRows}
${collapsible('Follow-up Queue', followUpHtml)}
${collapsible('CRM Pipeline', crmPipeline.map(sectionCard).join('') || emptyState('No CRM pipeline data.'))}
${collapsible('Outreach Templates', templateCards)}`;

// --- Comp Lab Tab ---
const compRanges = [
  { role: 'CAIO', min: 250, max: 400, color: 'var(--purple)' },
  { role: 'VP of AI', min: 200, max: 350, color: 'var(--cyan)' },
  { role: 'CTO', min: 200, max: 300, color: 'var(--cyan)' },
  { role: 'Sr. Director', min: 175, max: 250, color: 'var(--text-secondary)' },
];
const currentVal = parseInt((P.current||'0').replace(/[^0-9]/g,''))/1000 || 154;
const targetVal = parseInt((P.target||'0').replace(/[^0-9]/g,''))/1000 || 200;
const minVal = parseInt((P.minimum||'0').replace(/[^0-9]/g,''))/1000 || 175;
const rangeMax = 450;

const rangeBars = compRanges.map(r => `
<div class="range-row">
  <span class="range-label">${r.role}</span>
  <div class="range-track">
    <div class="range-bar" style="left:${(r.min/rangeMax)*100}%;width:${((r.max-r.min)/rangeMax)*100}%;background:${r.color};opacity:0.3"></div>
    <div class="range-marker current" style="left:${(currentVal/rangeMax)*100}%" title="Current $${currentVal}K"></div>
    <div class="range-marker target" style="left:${(targetVal/rangeMax)*100}%" title="Target $${targetVal}K"></div>
  </div>
  <span class="range-vals">$${r.min}K–$${r.max}K+</span>
</div>`).join('');

const compTab = `
<div class="comp-cards">
  <div class="comp-card"><label>Current</label><div class="comp-val">${P.current || '$154,000'}</div><div class="comp-sub">Aquent Studios</div></div>
  <div class="comp-card highlight"><label>Target</label><div class="comp-val">${P.target || '$200,000+'}</div><div class="comp-sub">Base salary</div></div>
  <div class="comp-card"><label>Walk-Away</label><div class="comp-val">${P.minimum || '$175,000'}</div><div class="comp-sub">Minimum</div></div>
</div>
<div class="section-sub-title">Market Ranges by Role</div>
<div class="range-chart">${rangeBars}</div>
${collapsible('Market Data', marketData.map(sectionCard).join('') || emptyState('No market data yet.','Data is enriched as you evaluate offers.'))}
${collapsible('Role Compensation Summary', roleComp.map(sectionCard).join('') || emptyState('No role comp data yet.'))}
${collapsible('Negotiation Playbook', negPlaybook.map(sectionCard).join('') || emptyState('No playbook configured.'))}`;

// --- Brand Tab ---
const articleCards = articleDigest.length ? articleDigest.map(s => `<div class="md-card brand-card"><h4>${esc(s.title)}</h4><div class="md-content">${md(s.body)}</div></div>`).join('') : '';

const brandTab = `
${collapsible('Brand Positioning', brandPos.map(sectionCard).join('') || emptyState('Brand positioning not configured yet.','Ask Career-OS to help build your brand strategy.'), true)}
${collapsible('Content Calendar', contentCal.map(sectionCard).join('') || emptyState('No content calendar yet.'))}
${collapsible('Engagement Metrics', engagement.map(sectionCard).join('') || emptyState('No engagement data yet.'))}
${articleCards ? collapsible('Article Digest & Proof Points', `<div class="card-grid">${articleCards}</div>`, true) : ''}`;

// --- Analytics Tab ---
const scoreLabels = ['4.5+','4.0–4.4','3.5–3.9','3.0–3.4','< 3.0'];
const scoreColors = ['var(--green)','var(--cyan)','var(--purple)','var(--orange)','var(--red)'];
const scoreBars = scoreDist.map((n,i) => `<div class="score-col"><div class="score-bar" style="height:${(n/scoreMax)*100}%;background:${scoreColors[i]}"><span class="score-val">${n}</span></div><span class="score-lbl">${scoreLabels[i]}</span></div>`).join('');

const analyticsTab = `
<div class="analytics-grid">
  <div class="analytics-panel">
    <div class="section-sub-title">Score Distribution</div>
    <div class="score-chart">${apps.length ? scoreBars : '<div class="empty-state"><p>No scores yet.</p></div>'}</div>
  </div>
  <div class="analytics-panel">
    <div class="section-sub-title">Status Funnel</div>
    ${apps.length ? `<div class="funnel vertical">${funnelStatuses.map(s => { const n = statusCounts[s]||0; return n ? `<div class="vfunnel-row"><span class="vf-label">${s}</span><div class="vf-bar status-${s.toLowerCase()}" style="width:${(n/funnelTotal)*100}%"><span>${n}</span></div></div>` : ''; }).filter(Boolean).join('')}</div>` : '<div class="empty-state"><p>No data yet.</p></div>'}
  </div>
</div>
<div class="analytics-grid">
  <div class="analytics-panel">
    <div class="section-sub-title">Velocity</div>
    <div class="mini-stats">
      <div class="mini-stat"><span class="mini-num">${apps.length}</span><span class="mini-lbl">Evaluated</span></div>
      <div class="mini-stat"><span class="mini-num">${appliedCount}</span><span class="mini-lbl">Applied</span></div>
      <div class="mini-stat"><span class="mini-num">${interviewCount}</span><span class="mini-lbl">Interviews</span></div>
      <div class="mini-stat"><span class="mini-num">${responseRate}%</span><span class="mini-lbl">Response Rate</span></div>
    </div>
  </div>
  <div class="analytics-panel">
    <div class="section-sub-title">Reports</div>
    <div class="mini-stats">
      <div class="mini-stat"><span class="mini-num">${reports.length}</span><span class="mini-lbl">Total Reports</span></div>
      <div class="mini-stat"><span class="mini-num">${pendingOffers.length}</span><span class="mini-lbl">In Pipeline</span></div>
    </div>
  </div>
</div>
${collapsible('Pipeline Metrics', pipelineMetrics.map(sectionCard).join('') || emptyState('Evaluate more offers to see patterns.'))}
${collapsible('Rejection Patterns', rejectionTracker.map(sectionCard).join('') || emptyState('No rejection data yet.'))}
${collapsible('Weekly Review Template', weeklyReview.map(sectionCard).join('') || emptyState('No weekly review data.'))}`;

// --- Connectors Tab ---
const mcps = [
  { name: 'Gmail', icon: '&#9993;', desc: 'Monitor employer responses, draft replies', status: 'MCP' },
  { name: 'Google Calendar', icon: '&#128197;', desc: 'Schedule interviews, find free time', status: 'MCP' },
  { name: 'Box', icon: '&#128193;', desc: 'Cloud document storage & sharing', status: 'MCP' },
  { name: 'Canva', icon: '&#127912;', desc: 'Design cover letters, decks, one-pagers', status: 'MCP' },
  { name: 'Figma', icon: '&#9998;', desc: 'Architecture diagrams, design context', status: 'MCP' },
];
const apis = [
  { name: 'Gemini', key: 'GEMINI_API_KEY', desc: 'Voice interview roleplay' },
  { name: 'ElevenLabs', key: 'ELEVENLABS_API_KEY', desc: 'Text-to-speech narration' },
  { name: 'Anthropic', key: 'ANTHROPIC_API_KEY', desc: 'Batch evaluation workers' },
  { name: 'OpenAI', key: 'OPENAI_API_KEY', desc: 'Alternative LLM evaluation' },
  { name: 'OpenRouter', key: 'OPENROUTER_API_KEY', desc: 'Multi-model routing' },
  { name: 'Perplexity', key: 'PERPLEXITY_API_KEY', desc: 'Deep company research' },
  { name: 'Firecrawl', key: 'FIRECRAWL_API_KEY', desc: 'Advanced JD extraction' },
  { name: 'Logo.Dev', key: 'LOGO_DEV_PUBLISHABLE_KEY', desc: 'Company logos' },
];

const mcpCards = mcps.map(m => `<div class="conn-card"><div class="conn-icon">${m.icon}</div><div class="conn-info"><div class="conn-name">${m.name}</div><div class="conn-desc">${m.desc}</div></div><div class="conn-status mcp"><span class="dot mcp-dot"></span>MCP</div></div>`).join('');
const apiCards = apis.map(a => { const ok = envStatus[a.key]; return `<div class="conn-card"><div class="conn-info"><div class="conn-name">${a.name}</div><div class="conn-desc">${a.desc}</div></div><div class="conn-status ${ok?'ok':'no'}"><span class="dot ${ok?'dot-ok':'dot-no'}"></span>${ok?'Configured':'Not Set'}</div></div>`; }).join('');

const connectorsTab = `
<div class="section-sub-title">MCP Services (Claude Code)</div>
<div class="conn-grid">${mcpCards}</div>
<div class="section-sub-title" style="margin-top:24px">API Keys (.env)</div>
<div class="conn-grid">${apiCards}</div>
${connectorDocs.length ? collapsible('Setup Guide', connectorDocs.map(sectionCard).join('')) : ''}`;

// ═══════════════════════════════════════════
// ASSEMBLE HTML
// ═══════════════════════════════════════════

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Career-OS | ${P.name || 'Dashboard'}</title>
<link rel="icon" href="https://futurespeak.ai/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#060B19;--bg2:#0F172A;--glass:rgba(6,11,25,0.6);--glass2:rgba(6,11,25,0.5);--inp:rgba(255,255,255,0.05);--t1:#F8FAFC;--t2:#9CA3AF;--t3:#555;--cy:#00F0FF;--pu:#8A2BE2;--or:#FFA500;--re:#ff5555;--gr:#22c55e;--cyd:rgba(0,240,255,0.1);--cym:rgba(0,240,255,0.2);--pud:rgba(138,43,226,0.15);--grd:rgba(34,197,94,0.12);--ord:rgba(255,165,0,0.12);--red:rgba(255,85,85,0.12);--ws:rgba(255,255,255,0.05);--wb:rgba(255,255,255,0.08);--bd:rgba(0,240,255,0.1);--bdh:rgba(0,240,255,0.25);--r:12px;--bl:12px;--sans:'Inter',sans-serif;--mono:'Fira Code',monospace;--shc:0 0 30px rgba(0,240,255,0.05),inset 0 0 20px rgba(0,240,255,0.02);--shh:0 0 20px rgba(0,240,255,0.2),inset 0 0 20px rgba(0,240,255,0.05);--gbrand:linear-gradient(135deg,#F8FAFC 0%,#00F0FF 50%,#8A2BE2 100%);--gacc:linear-gradient(to right,#00F0FF,#8A2BE2);--gbg:radial-gradient(circle at center,#0F172A 0%,#060B19 100%)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--sans);background:var(--gbg);color:var(--t1);line-height:1.5;min-height:100vh;font-weight:300;font-size:13px}
a{color:var(--cy);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:var(--mono);background:var(--ws);padding:1px 6px;border-radius:4px;font-size:11px;color:var(--cy)}
strong{font-weight:600}
blockquote{border-left:2px solid var(--bd);padding-left:12px;color:var(--t2);margin:8px 0}
ul{padding-left:20px;margin:4px 0}li{margin:2px 0}

@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

.container{max-width:1440px;margin:0 auto;padding:16px 32px 32px}

/* HEADER */
.header{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid var(--bd);margin-bottom:12px;animation:fadeIn .4s ease}
.brand{display:flex;align-items:center;gap:12px}
.brand-mark{width:36px;height:36px;border-radius:8px;background:var(--gacc);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-weight:700;font-size:16px;color:var(--bg);box-shadow:0 0 16px rgba(0,240,255,0.3)}
.brand h1{font-size:22px;font-weight:700;letter-spacing:-.03em;background:var(--gbrand);background-size:200% 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:gradientShift 5s ease infinite}
.brand .tag{font-family:var(--mono);font-size:10px;color:var(--t3);letter-spacing:.04em}
.hdr-links{display:flex;gap:8px}.hdr-links a{font-family:var(--mono);font-size:11px;color:var(--t2);padding:4px 10px;border-radius:6px;border:1px solid transparent;transition:.2s}.hdr-links a:hover{color:var(--cy);border-color:var(--bdh);background:var(--cyd);text-decoration:none}

.accent-line{height:2px;background:var(--gacc);opacity:.35;margin-bottom:12px;border-radius:1px}

/* TARGET BANNER */
.target-banner{background:var(--glass);backdrop-filter:blur(var(--bl));border:1px solid var(--bd);border-radius:var(--r);padding:14px 20px;margin-bottom:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;box-shadow:var(--shc);animation:fadeIn .4s ease .05s both}
.ti label{font-family:var(--mono);font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em}
.ti .tv{font-size:14px;font-weight:600;margin-top:2px}
.ti .tv.hl{color:var(--cy)}

/* STATS */
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.sc{background:var(--glass);backdrop-filter:blur(var(--bl));border:1px solid var(--bd);border-radius:var(--r);padding:14px 16px;position:relative;overflow:hidden;box-shadow:var(--shc);transition:.2s;animation:fadeIn .3s ease calc(.1s + var(--i,0)*.04s) both}
.sc:hover{border-color:var(--bdh);box-shadow:var(--shh);transform:translateY(-1px)}
.sc::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--gacc);opacity:.5}
.sn{font-family:var(--mono);font-size:28px;font-weight:700;line-height:1}
.sc.cy .sn{color:var(--cy)}.sc.pu .sn{color:var(--pu)}.sc.gr .sn{color:var(--gr)}.sc.or .sn{color:var(--or)}
.sl{font-family:var(--mono);color:var(--t3);font-size:10px;margin-top:4px;text-transform:uppercase;letter-spacing:.06em}

/* TABS */
.tab-nav{display:flex;gap:4px;margin-bottom:16px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
.tab-btn{font-family:var(--mono);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;padding:8px 16px;border:1px solid var(--bd);border-radius:8px;background:var(--glass);color:var(--t2);cursor:pointer;transition:.2s;white-space:nowrap;backdrop-filter:blur(8px)}
.tab-btn:hover{color:var(--cy);border-color:var(--bdh);background:var(--cyd)}
.tab-btn.active{color:var(--cy);border-color:var(--cy);background:var(--cyd);box-shadow:0 0 12px rgba(0,240,255,0.15)}
.tab-panel{display:none;animation:fadeIn .3s ease}.tab-panel.active{display:block}

/* FILTER */
.filter-bar{display:flex;gap:10px;align-items:center;margin-bottom:12px}
.filter-input{flex:1;font-family:var(--sans);font-size:12px;padding:8px 14px;background:var(--inp);border:1px solid var(--bd);border-radius:8px;color:var(--t1);outline:none;transition:.2s}
.filter-input:focus{border-color:var(--cy);box-shadow:0 0 8px rgba(0,240,255,0.15)}
.filter-input::placeholder{color:var(--t3)}
.filter-select{font-family:var(--mono);font-size:11px;padding:8px 12px;background:var(--inp);border:1px solid var(--bd);border-radius:8px;color:var(--t2);outline:none;cursor:pointer}
.filter-select:focus{border-color:var(--cy)}
.filter-count{font-family:var(--mono);font-size:11px;color:var(--t3);white-space:nowrap}

/* TABLES */
.table-wrap{background:var(--glass);backdrop-filter:blur(var(--bl));border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;box-shadow:var(--shc);margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 14px;font-family:var(--mono);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);background:var(--glass2);border-bottom:1px solid var(--bd);cursor:default;user-select:none;white-space:nowrap}
th.sortable{cursor:pointer}th.sortable:hover{color:var(--cy)}
th.sort-asc::after{content:' \\25B2';font-size:8px}
th.sort-desc::after{content:' \\25BC';font-size:8px}
td{padding:8px 14px;font-size:12px;border-bottom:1px solid var(--ws)}
tr:last-child td{border-bottom:none}
tr:hover{background:rgba(0,240,255,0.02)}
.col-num{color:var(--t3);width:36px;font-family:var(--mono);font-size:11px}
.col-company{font-weight:600;white-space:nowrap}
.col-title{color:var(--t2)}
.col-action{width:60px;text-align:right}
.col-score{font-family:var(--mono);font-weight:600;color:var(--cy)}
.col-notes{color:var(--t2);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.offer-row.done{opacity:.25}
.offer-row[style*="display: none"]{display:none!important}

/* TIER PILLS */
.tier-pill{font-family:var(--mono);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border-radius:4px}
.tier-c-suite{background:var(--pud);color:var(--pu);border:1px solid rgba(138,43,226,.25)}
.tier-director{background:var(--cyd);color:var(--cy);border:1px solid rgba(0,240,255,.15)}
.tier-other{background:var(--ws);color:var(--t2);border:1px solid var(--wb)}

/* BUTTONS */
.btn-glow{display:inline-block;padding:3px 10px;font-family:var(--mono);font-size:10px;font-weight:500;color:var(--cy);background:var(--cyd);border:1px solid rgba(0,240,255,.15);border-radius:6px;transition:.2s}
.btn-glow:hover{background:rgba(0,240,255,.2);border-color:rgba(0,240,255,.4);box-shadow:0 0 10px rgba(0,240,255,.2);color:#fff;text-decoration:none}

/* STATUS */
.status-badge{display:inline-block;padding:2px 8px;border-radius:12px;font-family:var(--mono);font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.04em}
.status-evaluated .status-badge{background:var(--cyd);color:var(--cy)}
.status-applied .status-badge{background:var(--pud);color:var(--pu)}
.status-responded .status-badge{background:var(--cym);color:var(--cy)}
.status-interview .status-badge{background:var(--ord);color:var(--or)}
.status-offer .status-badge{background:var(--grd);color:var(--gr)}
.status-rejected .status-badge,.status-discarded .status-badge{background:var(--red);color:var(--re)}
.status-skip .status-badge{background:var(--ws);color:var(--t3)}

/* FUNNEL */
.funnel{display:flex;height:28px;border-radius:6px;overflow:hidden;margin-bottom:14px;gap:2px}
.funnel-stage{display:flex;align-items:center;justify-content:center;min-width:40px;transition:.2s}
.funnel-stage span{font-family:var(--mono);font-size:9px;font-weight:500;color:var(--t1);white-space:nowrap;padding:0 6px}
.funnel-stage.status-evaluated{background:rgba(0,240,255,.2)}
.funnel-stage.status-applied{background:rgba(138,43,226,.25)}
.funnel-stage.status-responded{background:rgba(0,240,255,.3)}
.funnel-stage.status-interview{background:rgba(255,165,0,.25)}
.funnel-stage.status-offer{background:rgba(34,197,94,.25)}
.funnel-stage.status-rejected{background:rgba(255,85,85,.2)}
.funnel-stage.status-discarded{background:rgba(255,85,85,.15)}
.funnel-stage.status-skip{background:var(--ws)}

/* VERTICAL FUNNEL */
.funnel.vertical{flex-direction:column;height:auto;gap:6px}
.vfunnel-row{display:flex;align-items:center;gap:10px}
.vf-label{font-family:var(--mono);font-size:10px;color:var(--t2);width:80px;text-align:right;flex-shrink:0}
.vf-bar{height:22px;border-radius:4px;display:flex;align-items:center;padding:0 8px;min-width:30px;transition:.3s}
.vf-bar span{font-family:var(--mono);font-size:10px;color:var(--t1);font-weight:500}
.vf-bar.status-evaluated{background:rgba(0,240,255,.2)}.vf-bar.status-applied{background:rgba(138,43,226,.25)}.vf-bar.status-responded{background:rgba(0,240,255,.3)}.vf-bar.status-interview{background:rgba(255,165,0,.25)}.vf-bar.status-offer{background:rgba(34,197,94,.25)}.vf-bar.status-rejected{background:rgba(255,85,85,.2)}.vf-bar.status-discarded{background:rgba(255,85,85,.15)}.vf-bar.status-skip{background:var(--ws)}

/* COLLAPSIBLE */
.collapsible{margin-bottom:10px}
.collapsible-header{font-family:var(--mono);font-size:12px;font-weight:500;color:var(--t2);padding:10px 14px;background:var(--glass);border:1px solid var(--bd);border-radius:8px;cursor:pointer;transition:.2s;display:flex;align-items:center;gap:8px;user-select:none}
.collapsible-header:hover{color:var(--cy);border-color:var(--bdh)}
.chev{font-size:10px;transition:transform .2s}
.collapsible.open .chev{transform:rotate(90deg)}
.collapsible-body{max-height:0;overflow:hidden;transition:max-height .4s ease,opacity .3s ease;opacity:0;padding:0 14px}
.collapsible.open .collapsible-body{max-height:5000px;opacity:1;padding:12px 14px}

/* EMPTY STATE */
.empty-state{text-align:center;padding:32px 16px;color:var(--t3)}
.empty-icon{font-size:28px;margin-bottom:8px}
.empty-state p{font-size:12px}.hint{margin-top:4px;font-size:11px;color:var(--t3)}

/* SUB STATS */
.sub-stats{display:flex;gap:20px;padding:8px 0;font-family:var(--mono);font-size:11px;color:var(--t3)}
.sub-stat b{color:var(--t2)}

/* MD CARDS */
.md-card{background:var(--glass);border:1px solid var(--bd);border-radius:8px;padding:14px;margin-bottom:8px;transition:.2s}
.md-card:hover{border-color:var(--bdh)}
.md-card h4{font-family:var(--mono);font-size:12px;color:var(--cy);margin-bottom:6px;font-weight:500}
.md-content{font-size:12px;color:var(--t2);line-height:1.6}
.md-content strong{color:var(--t1)}
.card-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}

/* SECTION SUB TITLE */
.section-sub-title{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--t2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}

/* COMP LAB */
.comp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.comp-card{background:var(--glass);border:1px solid var(--bd);border-radius:var(--r);padding:16px;text-align:center;box-shadow:var(--shc)}
.comp-card.highlight{border-color:var(--cy);box-shadow:0 0 20px rgba(0,240,255,.1)}
.comp-card label{font-family:var(--mono);font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em}
.comp-val{font-family:var(--mono);font-size:24px;font-weight:700;color:var(--t1);margin-top:4px}
.comp-card.highlight .comp-val{color:var(--cy)}
.comp-sub{font-size:11px;color:var(--t3);margin-top:2px}

/* RANGE CHART */
.range-chart{margin-bottom:16px}
.range-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.range-label{font-family:var(--mono);font-size:11px;color:var(--t2);width:100px;text-align:right;flex-shrink:0}
.range-track{flex:1;height:20px;background:var(--ws);border-radius:4px;position:relative}
.range-bar{position:absolute;top:2px;height:16px;border-radius:3px}
.range-marker{position:absolute;top:-2px;width:2px;height:24px;border-radius:1px}
.range-marker.current{background:var(--or)}
.range-marker.target{background:var(--cy)}
.range-vals{font-family:var(--mono);font-size:10px;color:var(--t3);width:100px;flex-shrink:0}

/* PREP GRID */
.prep-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.prep-card{background:var(--glass);border:1px solid var(--bd);border-radius:8px;padding:14px;text-align:center;transition:.2s;cursor:default}
.prep-card:hover{border-color:var(--bdh);box-shadow:var(--shh)}
.prep-icon{font-size:20px;margin-bottom:4px}
.prep-title{font-family:var(--mono);font-size:11px;color:var(--t2)}

/* ANALYTICS */
.analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.analytics-panel{background:var(--glass);border:1px solid var(--bd);border-radius:var(--r);padding:16px;box-shadow:var(--shc)}
.score-chart{display:flex;align-items:flex-end;justify-content:center;gap:12px;height:120px;padding-top:8px}
.score-col{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1}
.score-bar{width:100%;border-radius:4px 4px 0 0;min-height:4px;display:flex;align-items:flex-end;justify-content:center;transition:.3s}
.score-val{font-family:var(--mono);font-size:11px;color:var(--t1);font-weight:600;padding-bottom:4px}
.score-lbl{font-family:var(--mono);font-size:9px;color:var(--t3)}
.mini-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.mini-stat{text-align:center;padding:8px}
.mini-num{font-family:var(--mono);font-size:22px;font-weight:700;color:var(--cy);display:block}
.mini-lbl{font-family:var(--mono);font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em}

/* CONNECTORS */
.conn-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px}
.conn-card{display:flex;align-items:center;gap:12px;background:var(--glass);border:1px solid var(--bd);border-radius:8px;padding:12px 16px;transition:.2s}
.conn-card:hover{border-color:var(--bdh)}
.conn-icon{font-size:20px;flex-shrink:0}
.conn-info{flex:1;min-width:0}
.conn-name{font-weight:600;font-size:13px}
.conn-desc{font-size:11px;color:var(--t3)}
.conn-status{font-family:var(--mono);font-size:10px;display:flex;align-items:center;gap:6px;flex-shrink:0}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.mcp-dot{background:var(--cy);animation:pulse 2s infinite}
.dot-ok{background:var(--gr)}
.dot-no{background:var(--t3)}
.conn-status.ok{color:var(--gr)}.conn-status.no{color:var(--t3)}.conn-status.mcp{color:var(--cy)}

/* FOOTER */
.footer{text-align:center;padding:20px;color:var(--t3);font-size:11px;border-top:1px solid var(--bd);margin-top:12px;font-family:var(--mono)}
.footer .bf{background:var(--gbrand);background-size:200% 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:gradientShift 5s ease infinite;font-weight:600}

@media(max-width:1000px){.stats-row{grid-template-columns:repeat(4,1fr)}.target-banner{grid-template-columns:repeat(2,1fr)}.analytics-grid,.card-grid,.conn-grid{grid-template-columns:1fr}.prep-grid{grid-template-columns:repeat(2,1fr)}.comp-cards{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){.stats-row{grid-template-columns:repeat(2,1fr)}.target-banner{grid-template-columns:1fr}.header{flex-direction:column;gap:8px}.prep-grid{grid-template-columns:1fr}.comp-cards{grid-template-columns:1fr}.container{padding:12px 16px}}
</style>
</head>
<body>
<div class="container">

<div class="header">
  <div class="brand">
    <div class="brand-mark">C</div>
    <div><h1>Career-OS</h1><div class="tag">FutureSpeak.AI | Career Advancement OS</div></div>
  </div>
  <div class="hdr-links">
    ${P.linkedin?`<a href="https://${P.linkedin}" target="_blank">LinkedIn</a>`:''}
    ${P.github?`<a href="https://${P.github}" target="_blank">GitHub</a>`:''}
    ${P.portfolio?`<a href="${P.portfolio}" target="_blank">FutureSpeak.AI</a>`:''}
  </div>
</div>
<div class="accent-line"></div>

<div class="target-banner">
  <div class="ti"><label>Operator</label><div class="tv">${P.name||'—'}</div></div>
  <div class="ti"><label>North Star</label><div class="tv hl">CAIO</div></div>
  <div class="ti"><label>Target</label><div class="tv">${P.target||'$200,000+'}</div></div>
  <div class="ti"><label>Location</label><div class="tv">${P.location||'Austin, TX'}</div></div>
</div>

<div class="stats-row">
  <div class="sc cy" style="--i:0"><div class="sn">${pendingOffers.filter(o=>!o.done).length}</div><div class="sl">Pipeline</div></div>
  <div class="sc pu" style="--i:1"><div class="sn">${vpOffers.length}</div><div class="sl">VP / C-Suite</div></div>
  <div class="sc cy" style="--i:2"><div class="sn">${dirOffers.length}</div><div class="sl">Director+</div></div>
  <div class="sc gr" style="--i:3"><div class="sn">${apps.length}</div><div class="sl">Applications</div></div>
  <div class="sc or" style="--i:4"><div class="sn">${reports.length}</div><div class="sl">Reports</div></div>
  <div class="sc or" style="--i:5"><div class="sn">${interviewCount}</div><div class="sl">Interviews</div></div>
  <div class="sc cy" style="--i:6"><div class="sn">${contacts.rows.length}</div><div class="sl">Contacts</div></div>
  <div class="sc pu" style="--i:7"><div class="sn">${responseRate}%</div><div class="sl">Response</div></div>
</div>

<nav class="tab-nav">
  <button class="tab-btn active" data-tab="pipeline">Pipeline</button>
  <button class="tab-btn" data-tab="tracker">Tracker</button>
  <button class="tab-btn" data-tab="interview">Interview Prep</button>
  <button class="tab-btn" data-tab="crm">CRM</button>
  <button class="tab-btn" data-tab="comp">Comp Lab</button>
  <button class="tab-btn" data-tab="brand">Brand</button>
  <button class="tab-btn" data-tab="analytics">Analytics</button>
  <button class="tab-btn" data-tab="connectors">Connectors</button>
</nav>

<div class="tab-panel active" id="tab-pipeline">${pipelineTab}</div>
<div class="tab-panel" id="tab-tracker">${trackerTab}</div>
<div class="tab-panel" id="tab-interview">${interviewTab}</div>
<div class="tab-panel" id="tab-crm">${crmTab}</div>
<div class="tab-panel" id="tab-comp">${compTab}</div>
<div class="tab-panel" id="tab-brand">${brandTab}</div>
<div class="tab-panel" id="tab-analytics">${analyticsTab}</div>
<div class="tab-panel" id="tab-connectors">${connectorsTab}</div>

<div class="footer"><span class="bf">Career-OS</span> | Powered by <a href="https://futurespeak.ai">FutureSpeak.AI</a> | ${NOW}</div>

</div>
<script>
// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    history.replaceState(null,null,'#'+btn.dataset.tab);
  });
});
// Hash routing
if(location.hash){const t=location.hash.slice(1);const btn=document.querySelector('[data-tab="'+t+'"]');if(btn)btn.click();}

// Collapsibles
document.querySelectorAll('.collapsible-header').forEach(h=>{
  h.addEventListener('click',()=>h.parentElement.classList.toggle('open'));
});

// Pipeline filter
const ps=document.getElementById('pipeline-search');
const pt=document.getElementById('pipeline-tier');
const pc=document.getElementById('pipeline-count');
function filterPipeline(){
  if(!ps)return;
  const q=ps.value.toLowerCase();const tier=pt.value;let n=0;
  document.querySelectorAll('#pipeline-table tbody tr').forEach(r=>{
    const co=r.dataset.company||'';const ti=r.dataset.title||'';const t=r.dataset.tier||'';
    const matchText=!q||co.includes(q)||ti.includes(q);
    const matchTier=tier==='all'||t===tier;
    r.style.display=matchText&&matchTier?'':'none';
    if(matchText&&matchTier)n++;
  });
  if(pc)pc.textContent=n+' offers';
}
if(ps){ps.addEventListener('input',filterPipeline);pt.addEventListener('change',filterPipeline);}

// Tracker filter
const ts=document.getElementById('tracker-search');
const tf=document.getElementById('tracker-status');
const tc=document.getElementById('tracker-count');
function filterTracker(){
  if(!ts)return;
  const q=ts.value.toLowerCase();const st=tf.value;let n=0;
  document.querySelectorAll('#tracker-table tbody tr').forEach(r=>{
    const co=(r.dataset.company||'');const s=r.dataset.status||'';
    const matchText=!q||co.includes(q)||r.textContent.toLowerCase().includes(q);
    const matchSt=st==='all'||s===st;
    r.style.display=matchText&&matchSt?'':'none';
    if(matchText&&matchSt)n++;
  });
  if(tc)tc.textContent=n+' applications';
}
if(ts){ts.addEventListener('input',filterTracker);tf.addEventListener('change',filterTracker);}

// CRM filter
const cs=document.getElementById('crm-search');
const cc=document.getElementById('crm-count');
function filterCRM(){
  if(!cs)return;
  const q=cs.value.toLowerCase();let n=0;
  document.querySelectorAll('#crm-table tbody tr').forEach(r=>{
    const s=r.dataset.search||'';
    r.style.display=!q||s.includes(q)?'':'none';
    if(!q||s.includes(q))n++;
  });
  if(cc)cc.textContent=n+' contacts';
}
if(cs)cs.addEventListener('input',filterCRM);

// Sorting
document.querySelectorAll('th.sortable').forEach(th=>{
  th.addEventListener('click',()=>{
    const table=th.closest('table');const tbody=table.querySelector('tbody');
    const col=th.dataset.col;const rows=[...tbody.querySelectorAll('tr')];
    const asc=!th.classList.contains('sort-asc');
    table.querySelectorAll('th').forEach(h=>{h.classList.remove('sort-asc','sort-desc');});
    th.classList.add(asc?'sort-asc':'sort-desc');
    rows.sort((a,b)=>{
      let va,vb;
      if(col==='score'){va=parseFloat((a.dataset.score||'0').replace('/5',''));vb=parseFloat((b.dataset.score||'0').replace('/5',''));}
      else if(col==='date'){va=a.dataset.date||'';vb=b.dataset.date||'';}
      else if(col==='num'){va=parseInt(a.querySelector('.col-num')?.textContent||'0');vb=parseInt(b.querySelector('.col-num')?.textContent||'0');}
      else if(col==='status'){va=a.dataset.status||'';vb=b.dataset.status||'';}
      else{va=a.textContent;vb=b.textContent;}
      if(typeof va==='number')return asc?va-vb:vb-va;
      return asc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));
    });
    rows.forEach(r=>tbody.appendChild(r));
  });
});
</script>
</body>
</html>`;

// ═══════════════════════════════════════════
// WRITE + OPEN
// ═══════════════════════════════════════════
const outPath = join(ROOT, 'output', 'dashboard.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`Dashboard → ${outPath}`);

if (!process.argv.includes('--no-open')) {
  try {
    if (process.platform === 'win32') execSync(`start "" "${outPath}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`open "${outPath}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${outPath}"`, { stdio: 'ignore' });
    console.log('Opened in browser.');
  } catch { console.log(`Open: file:///${outPath.replace(/\\/g, '/')}`); }
}
