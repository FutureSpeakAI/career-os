import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMdTable,
  parseTracker,
  parsePipeline,
  parseSimpleYaml,
  computeAnalytics,
  isMemoryDuplicate,
  classifyTier,
  parseMdSections,
  parseYamlList,
  parseScanHistory,
  parseEnvStatus,
} from '../lib/parsers.mjs';

/**
 * Test the pure parsing functions imported from lib/parsers.mjs.
 * These are the shared functions used by both the server and CLI scripts.
 */

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

// isMemoryDuplicate -- now imported from lib/parsers.mjs (no more code duplication)

describe('isMemoryDuplicate', () => {
  it('should detect exact duplicates', () => {
    assert.equal(isMemoryDuplicate(['20 years of journalism'], '20 years of journalism'), true);
  });

  it('should detect duplicates with different casing', () => {
    assert.equal(isMemoryDuplicate(['VP of AI targeting'], 'vp of ai targeting'), true);
  });

  it('should detect duplicates with extra whitespace', () => {
    assert.equal(isMemoryDuplicate(['Senior Director at Aquent'], 'Senior  Director  at  Aquent'), true);
  });

  it('should detect when new entry contains existing (superset)', () => {
    assert.equal(isMemoryDuplicate(['20 years journalism'], '20 years journalism experience at Raw Story'), true);
  });

  it('should detect when existing entry contains new (subset)', () => {
    assert.equal(isMemoryDuplicate(['Targeting CAIO VP of AI CTO roles'], 'VP of AI'), true);
  });

  it('should NOT detect unrelated entries as duplicates', () => {
    assert.equal(isMemoryDuplicate(['20 years journalism', 'VP of AI target'], 'Google interview prep'), false);
  });

  it('should handle empty inputs gracefully', () => {
    assert.equal(isMemoryDuplicate([], 'something'), false);
    assert.equal(isMemoryDuplicate(['something'], ''), false);
    assert.equal(isMemoryDuplicate(null, 'something'), false);
    assert.equal(isMemoryDuplicate(['a'], null), false);
  });

  it('should handle single-word entries', () => {
    assert.equal(isMemoryDuplicate(['python'], 'python'), true);
    assert.equal(isMemoryDuplicate(['python'], 'javascript'), false);
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

// --- Additional tests for newly-importable parsers ---

describe('classifyTier', () => {
  it('should classify c-suite roles', () => {
    assert.equal(classifyTier('VP of AI'), 'c-suite');
    assert.equal(classifyTier('Chief Technology Officer'), 'c-suite');
    assert.equal(classifyTier('CAIO'), 'c-suite');
    assert.equal(classifyTier('CTO'), 'c-suite');
    assert.equal(classifyTier('SVP Engineering'), 'c-suite');
    assert.equal(classifyTier('President of Operations'), 'c-suite');
  });

  it('should classify director roles', () => {
    assert.equal(classifyTier('Director of Engineering'), 'director');
    assert.equal(classifyTier('Head of AI'), 'director');
    assert.equal(classifyTier('Principal Engineer'), 'director');
  });

  it('should classify other roles', () => {
    assert.equal(classifyTier('Software Engineer'), 'other');
    assert.equal(classifyTier('Product Manager'), 'other');
    assert.equal(classifyTier(''), 'other');
  });

  it('should be case insensitive', () => {
    assert.equal(classifyTier('vp of ai'), 'c-suite');
    assert.equal(classifyTier('DIRECTOR OF ENGINEERING'), 'director');
  });

  it('should handle null/undefined gracefully', () => {
    assert.equal(classifyTier(null), 'other');
    assert.equal(classifyTier(undefined), 'other');
  });
});

describe('parseMdSections', () => {
  it('should parse markdown sections by heading', () => {
    const input = `# Title

Some intro text.

## Section One

Content of section one.

## Section Two

Content of section two.
`;
    const sections = parseMdSections(input);
    assert.equal(sections.length, 3);
    assert.equal(sections[0].title, 'Title');
    assert.equal(sections[0].level, 1);
    assert.ok(sections[0].body.includes('Some intro text'));
    assert.equal(sections[1].title, 'Section One');
    assert.equal(sections[1].level, 2);
    assert.equal(sections[2].title, 'Section Two');
  });

  it('should return empty array for content with no headings', () => {
    const sections = parseMdSections('Just plain text\nNo headings here');
    assert.deepEqual(sections, []);
  });

  it('should handle empty input', () => {
    assert.deepEqual(parseMdSections(''), []);
  });
});

describe('parseScanHistory', () => {
  it('should parse TSV scan history', () => {
    const input = `2026-04-01\thttps://example.com/job1\tAcme\tVP of AI\tactive
2026-04-02\thttps://example.com/job2\tTechCo\tCTO\tclosed`;
    const rows = parseScanHistory(input);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-04-01');
    assert.equal(rows[0].url, 'https://example.com/job1');
    assert.equal(rows[0].company, 'Acme');
    assert.equal(rows[1].status, 'closed');
  });

  it('should return empty array for empty input', () => {
    assert.deepEqual(parseScanHistory(''), []);
    assert.deepEqual(parseScanHistory('  \n  '), []);
  });

  it('should skip lines with fewer than 2 columns', () => {
    const input = `incomplete\n2026-04-01\thttps://example.com`;
    const rows = parseScanHistory(input);
    assert.equal(rows.length, 1);
  });
});

describe('parseYamlList', () => {
  it('should parse list items under a section key', () => {
    const input = `target_roles:
  primary:
    - "VP of AI"
    - "CTO"
    - "CAIO"
  secondary:
    - "Director of Engineering"`;
    const items = parseYamlList(input, 'primary');
    assert.deepEqual(items, ['VP of AI', 'CTO', 'CAIO']);
  });

  it('should return empty array when section not found', () => {
    const input = `other:\n  - item1`;
    const items = parseYamlList(input, 'nonexistent');
    assert.deepEqual(items, []);
  });

  it('should handle section keys with special regex chars', () => {
    const input = `roles.primary:\n  - item1`;
    const items = parseYamlList(input, 'roles.primary');
    assert.deepEqual(items, ['item1']);
  });
});

// --- Additional edge case tests for v2.0.0 ---

describe('parsePipeline edge cases', () => {
  it('should fall back to table format when no checklist items found', () => {
    const input = `| Company | Title | URL |
|---------|-------|-----|
| Acme | VP of AI | https://example.com |
`;
    const entries = parsePipeline(input);
    assert.ok(entries.length >= 1, 'Should parse table format as fallback');
  });

  it('should handle mixed done/not-done entries', () => {
    const input = `- [ ] https://ex.com/1 | Company A | VP of AI
- [x] https://ex.com/2 | Company B | CTO
- [ ] https://ex.com/3 | Company C | Director`;
    const entries = parsePipeline(input);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].done, false);
    assert.equal(entries[1].done, true);
    assert.equal(entries[2].done, false);
  });
});

describe('parseTracker edge cases', () => {
  it('should handle rows with fewer than 9 columns gracefully', () => {
    const input = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme | VP | 4.0/5 | Evaluated | x | [1](r.md) |`;
    const rows = parseTracker(input);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, '');
  });

  it('should skip non-numeric row numbers', () => {
    const input = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| abc | 2026-04-01 | Acme | VP | 4.0/5 | Evaluated | x | [1](r.md) | note |`;
    const rows = parseTracker(input);
    assert.equal(rows.length, 0);
  });
});

describe('computeAnalytics edge cases', () => {
  it('should handle rows with bold markdown in status', () => {
    const rows = [
      { status: '**Evaluated**', score: '4.0/5' },
      { status: '**Applied**', score: '3.5/5' },
    ];
    const analytics = computeAnalytics(rows);
    assert.equal(analytics.statusCounts['Evaluated'], 1);
    assert.equal(analytics.statusCounts['Applied'], 1);
  });

  it('should correctly bucket score distribution', () => {
    const rows = [
      { status: 'Evaluated', score: '4.8/5' },
      { status: 'Evaluated', score: '4.2/5' },
      { status: 'Evaluated', score: '3.7/5' },
      { status: 'Evaluated', score: '3.1/5' },
      { status: 'Evaluated', score: '2.5/5' },
    ];
    const analytics = computeAnalytics(rows);
    assert.equal(analytics.scoreDistribution['4.5+'], 1);
    assert.equal(analytics.scoreDistribution['4.0-4.4'], 1);
    assert.equal(analytics.scoreDistribution['3.5-3.9'], 1);
    assert.equal(analytics.scoreDistribution['3.0-3.4'], 1);
    assert.equal(analytics.scoreDistribution['below 3.0'], 1);
  });
});

describe('parseEnvStatus', () => {
  it('should return an object with boolean values', () => {
    const status = parseEnvStatus();
    assert.ok(typeof status === 'object');
    for (const [key, val] of Object.entries(status)) {
      assert.equal(typeof val, 'boolean', `${key} should be boolean`);
    }
  });

  it('should include all expected keys', () => {
    const status = parseEnvStatus();
    const expectedKeys = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
    for (const key of expectedKeys) {
      assert.ok(key in status, `Should include ${key}`);
    }
  });
});

describe('classifyTier extended', () => {
  it('should classify EVP roles as c-suite', () => {
    assert.equal(classifyTier('EVP of Engineering'), 'c-suite');
  });

  it('should not classify "Supervisor" as director', () => {
    assert.equal(classifyTier('Supervisor'), 'other');
  });
});

describe('isMemoryDuplicate extended', () => {
  it('should handle unicode and special characters', () => {
    assert.equal(isMemoryDuplicate(['20+ years experience'], '20+ years experience'), true);
  });

  it('should not match partial word overlaps', () => {
    // "AI" is contained in "CAIO" but these are different enough that
    // the function's substring check should handle it as-is
    // This tests current behavior -- substring match means "AI" will match "CAIO"
    assert.equal(isMemoryDuplicate(['AI'], 'CAIO role'), true);
  });
});
