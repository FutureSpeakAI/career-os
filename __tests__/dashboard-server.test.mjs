import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test the pure parsing functions from dashboard-server.mjs.
 * Since the server is a monolith, we replicate the function signatures here
 * to test their logic independently. When the server is refactored into modules,
 * these tests can import directly.
 */

// --- Replicated parsing functions (must match dashboard-server.mjs) ---

function parseMdTable(content) {
  const lines = content.split('\n');
  const result = { headers: [], rows: [] };

  let headerLine = -1;
  let separatorLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('|') && !trimmed.match(/^\|\s*-/)) {
      if (headerLine === -1) {
        headerLine = i;
      }
    }
    if (trimmed.startsWith('|') && trimmed.match(/^\|\s*-/)) {
      separatorLine = i;
      break;
    }
  }

  if (headerLine === -1 || separatorLine === -1) return result;

  result.headers = lines[headerLine]
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);

  for (let i = separatorLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length === 0) continue;
    if (cells.every(c => c === '')) continue;

    const row = {};
    result.headers.forEach((header, idx) => {
      row[header] = cells[idx] || '';
    });
    result.rows.push(row);
  }

  return result;
}

function parseTracker(content) {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  const rows = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---') || line.match(/\|\s*#\s*\|/)) continue;

    const cells = line.split('|').map(s => s.trim());
    const parts = cells.filter(Boolean);
    if (parts.length < 8) continue;

    const num = parseInt(parts[0]);
    if (isNaN(num)) continue;

    rows.push({
      num,
      date: parts[1] || '',
      company: parts[2] || '',
      role: parts[3] || '',
      score: parts[4] || '',
      status: parts[5] || '',
      pdf: parts[6] || '',
      report: parts[7] || '',
      notes: parts[8] || '',
    });
  }

  return rows;
}

function parsePipeline(content) {
  if (!content.trim()) return [];
  const entries = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^- \[[ x]\]\s+(\S+)\s+\|\s+(.+?)\s+\|\s+(.+)$/);
    if (m) {
      const title = m[3].trim();
      const tier = /\b(VP|Vice President|Chief|CAIO|CTO)\b/i.test(title) ? 'c-suite'
        : /\b(Director|Head)\b/i.test(title) ? 'director' : 'other';
      entries.push({ url: m[1], company: m[2].trim(), title, tier, done: line.includes('[x]') });
    }
  }
  if (entries.length === 0) {
    const table = parseMdTable(content);
    return table.rows;
  }
  return entries;
}

function parseSimpleYaml(content) {
  const result = {};
  let currentParent = '';
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    const kvMatch = line.match(/^(\s*)(\w[\w_]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const [, spaces, key, rawValue] = kvMatch;
    const indentLevel = spaces.length;

    let value = rawValue.trim();

    if (indentLevel === 0) {
      if (value === '' || value === '|' || value === '>') {
        currentParent = key;
        continue;
      }
      value = value.replace(/^["']|["']$/g, '');
      result[key] = value;
    } else {
      value = value.replace(/^["']|["']$/g, '');
      const fullKey = currentParent ? `${currentParent}.${key}` : key;
      result[fullKey] = value;
    }
  }

  return result;
}

function computeAnalytics(trackerRows) {
  const statusCounts = {};
  const scores = [];

  for (const row of trackerRows) {
    const status = row.status.replace(/\*\*/g, '').trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const scoreMatch = row.score.replace(/\*\*/g, '').match(/([\d.]+)\/5/);
    if (scoreMatch) {
      scores.push(parseFloat(scoreMatch[1]));
    }
  }

  const avgScore = scores.length > 0
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
    : null;

  return {
    total: trackerRows.length,
    statusCounts,
    avgScore,
  };
}

// --- Tests ---

describe('parseMdTable', () => {
  it('should parse a simple markdown table', () => {
    const input = `# Header

| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |
`;
    const result = parseMdTable(input);
    assert.deepEqual(result.headers, ['Name', 'Age', 'City']);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].Name, 'Alice');
    assert.equal(result.rows[1].City, 'LA');
  });

  it('should return empty result for non-table content', () => {
    const result = parseMdTable('Just some text\nNo tables here');
    assert.deepEqual(result.headers, []);
    assert.deepEqual(result.rows, []);
  });

  it('should handle empty cells', () => {
    const input = `| A | B |
|---|---|
| x |  |
`;
    const result = parseMdTable(input);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].A, 'x');
  });
});

describe('parseTracker', () => {
  it('should parse applications.md format', () => {
    const input = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | VP of AI | 4.2/5 | Evaluated | x | [1](reports/001-acme-2026-04-01.md) | Good fit |
| 2 | 2026-04-02 | TechCo | CTO | 3.8/5 | Applied | x | [2](reports/002-techco-2026-04-02.md) | Needs follow-up |
`;
    const rows = parseTracker(input);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].num, 1);
    assert.equal(rows[0].company, 'Acme Corp');
    assert.equal(rows[0].score, '4.2/5');
    assert.equal(rows[0].status, 'Evaluated');
    assert.equal(rows[1].num, 2);
    assert.equal(rows[1].status, 'Applied');
  });

  it('should return empty array for empty input', () => {
    assert.deepEqual(parseTracker(''), []);
    assert.deepEqual(parseTracker('  \n  '), []);
  });

  it('should skip header and separator rows', () => {
    const input = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;
    const rows = parseTracker(input);
    assert.equal(rows.length, 0);
  });
});

describe('parsePipeline', () => {
  it('should parse checklist-style pipeline', () => {
    const input = `# Pipeline

- [ ] https://example.com/job1 | Acme | VP of AI
- [x] https://example.com/job2 | TechCo | Director of Engineering
- [ ] https://example.com/job3 | StartupX | Software Engineer
`;
    const entries = parsePipeline(input);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].tier, 'c-suite');
    assert.equal(entries[0].done, false);
    assert.equal(entries[1].tier, 'director');
    assert.equal(entries[1].done, true);
    assert.equal(entries[2].tier, 'other');
  });

  it('should return empty array for empty input', () => {
    assert.deepEqual(parsePipeline(''), []);
    assert.deepEqual(parsePipeline('  '), []);
  });

  it('should detect C-suite roles correctly', () => {
    const input = `- [ ] https://ex.com/1 | A | Chief AI Officer
- [ ] https://ex.com/2 | B | CTO
- [ ] https://ex.com/3 | C | CAIO
`;
    const entries = parsePipeline(input);
    assert.equal(entries[0].tier, 'c-suite');
    assert.equal(entries[1].tier, 'c-suite');
    assert.equal(entries[2].tier, 'c-suite');
  });
});

describe('parseSimpleYaml', () => {
  it('should parse flat key-value pairs', () => {
    const input = `name: "John Doe"
email: john@example.com
age: 30
`;
    const result = parseSimpleYaml(input);
    assert.equal(result.name, 'John Doe');
    assert.equal(result.email, 'john@example.com');
    assert.equal(result.age, '30');
  });

  it('should parse nested keys', () => {
    const input = `candidate:
  full_name: "Jane Smith"
  email: jane@example.com
compensation:
  target_range: "$200K-$300K"
`;
    const result = parseSimpleYaml(input);
    assert.equal(result['candidate.full_name'], 'Jane Smith');
    assert.equal(result['candidate.email'], 'jane@example.com');
    assert.equal(result['compensation.target_range'], '$200K-$300K');
  });

  it('should skip comments and empty lines', () => {
    const input = `# This is a comment
name: Alice

# Another comment
role: Engineer
`;
    const result = parseSimpleYaml(input);
    assert.equal(result.name, 'Alice');
    assert.equal(result.role, 'Engineer');
  });
});

describe('computeAnalytics', () => {
  it('should compute status counts and average score', () => {
    const rows = [
      { status: 'Evaluated', score: '4.2/5' },
      { status: 'Evaluated', score: '3.8/5' },
      { status: 'Applied', score: '4.0/5' },
      { status: 'Rejected', score: '2.5/5' },
    ];
    const analytics = computeAnalytics(rows);
    assert.equal(analytics.total, 4);
    assert.equal(analytics.statusCounts['Evaluated'], 2);
    assert.equal(analytics.statusCounts['Applied'], 1);
    assert.equal(analytics.statusCounts['Rejected'], 1);
    assert.equal(analytics.avgScore, '3.63');
  });

  it('should handle empty input', () => {
    const analytics = computeAnalytics([]);
    assert.equal(analytics.total, 0);
    assert.equal(analytics.avgScore, null);
  });

  it('should handle rows without scores', () => {
    const rows = [
      { status: 'Evaluated', score: '--' },
      { status: 'Applied', score: '' },
    ];
    const analytics = computeAnalytics(rows);
    assert.equal(analytics.total, 2);
    assert.equal(analytics.avgScore, null);
  });
});

describe('security: regex escaping', () => {
  it('should not allow regex injection in company names', () => {
    // This tests the pattern used in update_application_status tool
    const maliciousCompany = '.*';
    const escapedCompany = maliciousCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^\\|\\s*(\\d+)\\s*\\|[^|]*\\|\\s*${escapedCompany}`, 'mi');

    const tracker = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | VP | 4.0/5 | Evaluated | x | [1](r.md) | note |
`;

    // The escaped pattern should NOT match "Acme Corp" since we're searching for literal ".*"
    const match = tracker.match(regex);
    assert.equal(match, null, 'Escaped regex should not match arbitrary strings');
  });

  it('should match exact company names correctly', () => {
    const company = 'Acme Corp';
    const escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^\\|\\s*(\\d+)\\s*\\|[^|]*\\|\\s*${escapedCompany}`, 'mi');

    const tracker = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | VP | 4.0/5 | Evaluated | x | [1](r.md) | note |
`;

    const match = tracker.match(regex);
    assert.ok(match, 'Should match exact company name');
    assert.equal(match[1], '1');
  });
});
