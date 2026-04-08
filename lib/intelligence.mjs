/**
 * lib/intelligence.mjs -- AI intelligence helpers for Career-OS.
 *
 * Pure functions for: CV proof point extraction, conversation summarization,
 * portal title filtering, and other analysis that doesn't require I/O.
 *
 * Extracted so both the server and tests can import the same code.
 */

// ---------------------------------------------------------------------------
// Proof Point Extraction
// ---------------------------------------------------------------------------

/**
 * Extract top N proof points from CV content.
 * Looks for lines containing quantified metrics (percentages, dollar amounts,
 * multipliers, large numbers) which represent concrete achievements.
 * Returns an array of cleaned proof-point strings.
 */
export function extractProofPoints(cvContent, maxCount = 5) {
  const lines = cvContent.split('\n');
  const scored = [];

  // Pattern matches lines with quantified achievements
  const metricPatterns = [
    /\d+[xX]\b/,                          // multipliers: 10x, 5X
    /\$[\d,.]+[KMBkmb]?/,                 // dollar amounts: $200K, $5M
    /\d+%/,                                // percentages: 50%, 300%
    /\b\d{1,3}(?:,\d{3})+\b/,            // large numbers: 5,000,000
    /\b\d+[KMBkmb]\+?\b/,                // shorthand: 50K, 5M
    /\b(?:grew|scaled|increased|reduced|saved|generated|managed|led|built|launched|drove)\b/i,
  ];

  for (const line of lines) {
    const trimmed = line.replace(/^[\s\-*>#]+/, '').trim();
    if (trimmed.length < 20 || trimmed.length > 300) continue;
    // Skip headings, links-only lines, empty structural lines
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^\[.*\]\(.*\)$/.test(trimmed)) continue;

    let score = 0;
    for (const pattern of metricPatterns) {
      if (pattern.test(trimmed)) score++;
    }
    if (score > 0) {
      scored.push({ text: trimmed, score });
    }
  }

  // Sort by metric density (more patterns matched = stronger proof point)
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map(s => s.text);
}

// ---------------------------------------------------------------------------
// Conversation Summarization
// ---------------------------------------------------------------------------

/**
 * Summarize older conversation messages into a compact context block.
 * Groups messages into topic clusters and extracts key points, decisions,
 * and action items so the chat model retains context without full history.
 * This is a local (non-LLM) summarization to avoid extra API calls.
 */
export function summarizeConversationHistory(messages) {
  if (!messages || messages.length === 0) return '';

  const topics = new Set();
  const actions = [];
  const decisions = [];
  const companies = new Set();

  for (const msg of messages) {
    const text = (msg.text || msg.content || '').toLowerCase();

    // Extract company mentions (capitalized words near job-related terms)
    const companyMatches = (msg.text || msg.content || '').match(/\b[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]+)?\b/g);
    if (companyMatches) companyMatches.forEach(c => companies.add(c));

    // Detect topics discussed
    if (/\b(?:interview|prep|practice|roleplay)\b/.test(text)) topics.add('interview preparation');
    if (/\b(?:resume|cv|cover letter|materials)\b/.test(text)) topics.add('application materials');
    if (/\b(?:scan|pipeline|new jobs|opportunities)\b/.test(text)) topics.add('job discovery');
    if (/\b(?:negotiate|salary|comp|offer)\b/.test(text)) topics.add('compensation/negotiation');
    if (/\b(?:follow.up|check in|status)\b/.test(text)) topics.add('follow-ups');
    if (/\b(?:research|company|culture)\b/.test(text)) topics.add('company research');
    if (/\b(?:story|star|behavioral)\b/.test(text)) topics.add('STAR stories');
    if (/\b(?:evaluate|score|assess)\b/.test(text)) topics.add('job evaluation');

    // Detect decisions/conclusions
    if (msg.role === 'assistant' && /\b(?:done|completed|saved|updated|generated|applied|skipping)\b/.test(text)) {
      const snippet = (msg.text || msg.content || '').substring(0, 120).trim();
      if (snippet) decisions.push(snippet);
    }

    // Detect action items mentioned
    if (/\b(?:should|need to|TODO|action item|next step)\b/i.test(text)) {
      const snippet = (msg.text || msg.content || '').substring(0, 100).trim();
      if (snippet && msg.role === 'assistant') actions.push(snippet);
    }
  }

  let summary = '';
  if (topics.size > 0) {
    summary += `Topics discussed: ${[...topics].join(', ')}. `;
  }
  if (companies.size > 0) {
    const topCompanies = [...companies].slice(0, 10);
    summary += `Companies mentioned: ${topCompanies.join(', ')}. `;
  }
  if (decisions.length > 0) {
    summary += `Key outcomes: ${decisions.slice(-5).join(' | ')}. `;
  }
  if (actions.length > 0) {
    summary += `Noted actions: ${actions.slice(-3).join(' | ')}.`;
  }
  summary += ` (${messages.length} earlier messages summarized)`;

  return summary.trim();
}

// ---------------------------------------------------------------------------
// Portal Title Filtering
// ---------------------------------------------------------------------------

/**
 * Parse the global title_filter section from portals.yml content.
 * Returns { positive: string[], negative: string[], seniorityBoost: string[] }
 * where positive/negative are lowercased keywords.
 */
export function parseTitleFilter(portalsContent) {
  const filter = { positive: [], negative: [], seniorityBoost: [] };
  const lines = portalsContent.split('\n');
  let section = null; // 'positive' | 'negative' | 'seniority_boost' | null

  for (const line of lines) {
    // Detect section headers within title_filter block
    if (/^\s*positive:\s*$/.test(line)) { section = 'positive'; continue; }
    if (/^\s*negative:\s*$/.test(line)) { section = 'negative'; continue; }
    if (/^\s*seniority_boost:\s*$/.test(line)) { section = 'seniority_boost'; continue; }

    // Exit title_filter block when we hit a new top-level key
    if (/^[a-z_]+:/.test(line) && !line.startsWith(' ')) { section = null; continue; }

    // Collect list items within current section
    if (section && /^\s+-\s+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, '').trim().toLowerCase();
      if (!value) continue;
      if (section === 'positive') filter.positive.push(value);
      else if (section === 'negative') filter.negative.push(value);
      else if (section === 'seniority_boost') filter.seniorityBoost.push(value);
    }
  }

  return filter;
}

/**
 * Check if a job title matches the global title_filter rules:
 * - If positive keywords exist, at least one must appear in the title.
 * - If any negative keyword appears in the title, the job is rejected.
 * Returns true if the title passes the filter.
 */
export function matchesTitleFilter(titleLower, filter) {
  // If no global filter is configured, allow everything
  if (filter.positive.length === 0 && filter.negative.length === 0) return true;

  // Negative check: reject if ANY negative keyword matches
  if (filter.negative.length > 0) {
    for (const neg of filter.negative) {
      if (titleLower.includes(neg)) return false;
    }
  }

  // Positive check: at least one positive keyword must match
  if (filter.positive.length > 0) {
    return filter.positive.some(pos => titleLower.includes(pos));
  }

  return true;
}
