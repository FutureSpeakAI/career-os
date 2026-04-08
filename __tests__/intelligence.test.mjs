import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProofPoints,
  summarizeConversationHistory,
  parseTitleFilter,
  matchesTitleFilter,
} from '../lib/intelligence.mjs';

// ---------------------------------------------------------------------------
// extractProofPoints
// ---------------------------------------------------------------------------

describe('extractProofPoints', () => {
  it('should extract lines with percentage metrics', () => {
    const cv = `# My CV
- Led migration that reduced costs by 40%
- Responsible for team management
- Grew organic traffic 300% over 18 months at Raw Story`;
    const points = extractProofPoints(cv, 5);
    assert.ok(points.length >= 2, `Expected at least 2 points, got ${points.length}`);
    assert.ok(points.some(p => p.includes('40%')), 'Should include 40% metric');
    assert.ok(points.some(p => p.includes('300%')), 'Should include 300% metric');
  });

  it('should extract lines with dollar amounts', () => {
    const cv = `- Generated $5M in pipeline revenue through outbound strategy
- Managed budget allocation effectively`;
    const points = extractProofPoints(cv, 5);
    assert.ok(points.some(p => p.includes('$5M')), 'Should include $5M metric');
  });

  it('should extract lines with multipliers', () => {
    const cv = `- Scaled readership from 50K to 5M readers (10x growth over 4 years)
- Good team player`;
    const points = extractProofPoints(cv, 5);
    assert.ok(points.some(p => p.includes('10x')), 'Should include 10x metric');
  });

  it('should skip headings', () => {
    const cv = `# 300% Growth Section
- Actually drove 300% growth in traffic`;
    const points = extractProofPoints(cv, 5);
    // Should only return the bullet point, not the heading
    assert.ok(points.every(p => !p.startsWith('#')), 'Should not include headings');
  });

  it('should skip very short lines', () => {
    const cv = `- 50% done
- Built and launched an enterprise ML platform serving 200+ models in production across 15 teams`;
    const points = extractProofPoints(cv, 5);
    assert.ok(!points.some(p => p === '50% done'), 'Should skip lines under 20 chars');
  });

  it('should return empty array for content with no metrics', () => {
    const cv = `I am a hardworking professional with great communication skills.
I enjoy teamwork and collaboration.`;
    const points = extractProofPoints(cv, 5);
    assert.equal(points.length, 0, 'Should return empty for no metrics');
  });

  it('should respect maxCount parameter', () => {
    const cv = `- Grew traffic 300%
- Saved $2M in infrastructure costs annually
- Managed team of 50 engineers across 5 offices
- Built platform serving 10M requests per day
- Reduced latency by 80% through caching optimization
- Launched 20 products in 3 years generating $50M revenue`;
    const points = extractProofPoints(cv, 3);
    assert.ok(points.length <= 3, `Should return at most 3, got ${points.length}`);
  });

  it('should prioritize lines with more metric types', () => {
    const cv = `- Built and scaled the platform from $0 to $5M ARR, grew team 3x in 12 months
- Reduced costs by 10%`;
    const points = extractProofPoints(cv, 5);
    // The first line has dollar amount + multiplier + action word = higher score
    assert.ok(points[0].includes('$5M') || points[0].includes('3x'), 'First point should be the densest');
  });
});

// ---------------------------------------------------------------------------
// summarizeConversationHistory
// ---------------------------------------------------------------------------

describe('summarizeConversationHistory', () => {
  it('should return empty string for empty input', () => {
    assert.equal(summarizeConversationHistory([]), '');
    assert.equal(summarizeConversationHistory(null), '');
  });

  it('should detect interview preparation topic', () => {
    const messages = [
      { role: 'user', text: 'Can you help me practice for an interview?' },
      { role: 'assistant', text: 'Sure, let me roleplay as the interviewer.' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('interview preparation'), 'Should detect interview topic');
  });

  it('should detect multiple topics', () => {
    const messages = [
      { role: 'user', text: 'I need to update my resume for Google' },
      { role: 'assistant', text: 'I can help with application materials.' },
      { role: 'user', text: 'Also scan for new jobs' },
      { role: 'assistant', text: 'Scanning the pipeline now.' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('application materials'), 'Should detect materials topic');
    assert.ok(summary.includes('job discovery'), 'Should detect discovery topic');
  });

  it('should extract company mentions', () => {
    const messages = [
      { role: 'user', text: 'I want to apply to Anthropic and Google' },
      { role: 'assistant', text: 'Both are great choices.' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('Anthropic'), 'Should extract Anthropic');
    assert.ok(summary.includes('Google'), 'Should extract Google');
  });

  it('should include message count', () => {
    const messages = [
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi there' },
      { role: 'user', text: 'Help with resume' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('3 earlier messages'), 'Should include message count');
  });

  it('should capture decisions from assistant messages', () => {
    const messages = [
      { role: 'user', text: 'Save that I prefer remote roles' },
      { role: 'assistant', text: 'Done, I have saved your preference for remote roles.' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('Key outcomes'), 'Should capture decision');
  });
});

// ---------------------------------------------------------------------------
// parseTitleFilter
// ---------------------------------------------------------------------------

describe('parseTitleFilter', () => {
  const samplePortals = `title_filter:
  positive:
    - "AI"
    - "ML"
    - "Product Manager"
  negative:
    - "Junior"
    - "Intern"
    - ".NET"
  seniority_boost:
    - "Senior"
    - "Staff"

search_queries:
  - name: Test
    query: 'test query'`;

  it('should parse positive keywords', () => {
    const filter = parseTitleFilter(samplePortals);
    assert.ok(filter.positive.includes('ai'), 'Should include AI (lowercased)');
    assert.ok(filter.positive.includes('ml'), 'Should include ML');
    assert.ok(filter.positive.includes('product manager'), 'Should include Product Manager');
    assert.equal(filter.positive.length, 3);
  });

  it('should parse negative keywords', () => {
    const filter = parseTitleFilter(samplePortals);
    assert.ok(filter.negative.includes('junior'), 'Should include Junior');
    assert.ok(filter.negative.includes('intern'), 'Should include Intern');
    assert.ok(filter.negative.includes('.net'), 'Should include .NET');
    assert.equal(filter.negative.length, 3);
  });

  it('should parse seniority boost keywords', () => {
    const filter = parseTitleFilter(samplePortals);
    assert.ok(filter.seniorityBoost.includes('senior'), 'Should include Senior');
    assert.ok(filter.seniorityBoost.includes('staff'), 'Should include Staff');
  });

  it('should stop parsing at next top-level key', () => {
    const filter = parseTitleFilter(samplePortals);
    // search_queries items should NOT appear in any filter list
    assert.ok(!filter.positive.includes('test'), 'Should not include search query content');
  });

  it('should return empty arrays for content without title_filter', () => {
    const filter = parseTitleFilter('tracked_companies:\n  - name: Google\n');
    assert.equal(filter.positive.length, 0);
    assert.equal(filter.negative.length, 0);
    assert.equal(filter.seniorityBoost.length, 0);
  });

  it('should strip quotes from keyword values', () => {
    const content = `title_filter:
  positive:
    - "Quoted Value"
    - 'Single Quoted'
    - Unquoted`;
    const filter = parseTitleFilter(content);
    assert.ok(filter.positive.includes('quoted value'));
    assert.ok(filter.positive.includes('single quoted'));
    assert.ok(filter.positive.includes('unquoted'));
  });
});

// ---------------------------------------------------------------------------
// matchesTitleFilter
// ---------------------------------------------------------------------------

describe('matchesTitleFilter', () => {
  const filter = {
    positive: ['ai', 'ml', 'product manager'],
    negative: ['junior', 'intern', '.net'],
    seniorityBoost: ['senior'],
  };

  it('should match titles containing positive keywords', () => {
    assert.ok(matchesTitleFilter('senior ai engineer', filter));
    assert.ok(matchesTitleFilter('ml platform lead', filter));
    assert.ok(matchesTitleFilter('product manager - ai', filter));
  });

  it('should reject titles containing negative keywords', () => {
    assert.ok(!matchesTitleFilter('junior ai engineer', filter));
    assert.ok(!matchesTitleFilter('ai intern', filter));
    assert.ok(!matchesTitleFilter('.net developer with ml experience', filter));
  });

  it('should reject titles with no positive keyword match', () => {
    assert.ok(!matchesTitleFilter('backend engineer', filter));
    assert.ok(!matchesTitleFilter('data analyst', filter));
    assert.ok(!matchesTitleFilter('project coordinator', filter));
  });

  it('should prioritize negative over positive', () => {
    // Has "AI" (positive) but also "Junior" (negative) -- should reject
    assert.ok(!matchesTitleFilter('junior ai developer', filter));
  });

  it('should pass everything when no filter is configured', () => {
    const emptyFilter = { positive: [], negative: [], seniorityBoost: [] };
    assert.ok(matchesTitleFilter('anything goes here', emptyFilter));
    assert.ok(matchesTitleFilter('junior intern .net', emptyFilter));
  });

  it('should apply only negative filter when positive list is empty', () => {
    const negOnly = { positive: [], negative: ['intern'], seniorityBoost: [] };
    assert.ok(matchesTitleFilter('senior engineer', negOnly));
    assert.ok(!matchesTitleFilter('summer intern', negOnly));
  });

  it('should be case-insensitive (input should be pre-lowercased)', () => {
    // The function expects titleLower to be already lowercased
    assert.ok(matchesTitleFilter('ai solutions architect', filter));
  });
});

// ---------------------------------------------------------------------------
// Additional edge case tests for v2.0.0
// ---------------------------------------------------------------------------

describe('extractProofPoints edge cases', () => {
  it('should handle empty input', () => {
    assert.deepEqual(extractProofPoints('', 5), []);
  });

  it('should handle input with only headings', () => {
    const cv = `# Section 1\n## Section 2\n### Section 3`;
    assert.deepEqual(extractProofPoints(cv, 5), []);
  });

  it('should extract lines with large number shorthand', () => {
    const cv = `- Managed a portfolio of 50K+ monthly active users across 3 product lines`;
    const points = extractProofPoints(cv, 5);
    assert.ok(points.length >= 1, 'Should extract 50K metric');
  });

  it('should extract lines with action verbs even without numbers', () => {
    const cv = `- Led the complete redesign of the company platform architecture from monolith to microservices`;
    const points = extractProofPoints(cv, 5);
    assert.ok(points.length >= 1, 'Should extract line with "Led" action verb');
  });
});

describe('summarizeConversationHistory edge cases', () => {
  it('should handle messages with empty text', () => {
    const messages = [
      { role: 'user', text: '' },
      { role: 'assistant', text: '' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('2 earlier messages'), 'Should count empty messages');
  });

  it('should handle messages with content field instead of text', () => {
    const messages = [
      { role: 'user', content: 'Help with interview prep' },
      { role: 'assistant', content: 'Let me help you prepare.' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('interview preparation'), 'Should detect topic from content field');
  });

  it('should detect compensation/negotiation topic', () => {
    const messages = [
      { role: 'user', text: 'What salary should I ask for?' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('compensation/negotiation'), 'Should detect salary topic');
  });

  it('should detect STAR stories topic', () => {
    const messages = [
      { role: 'user', text: 'Help me write a STAR story about my leadership experience' },
    ];
    const summary = summarizeConversationHistory(messages);
    assert.ok(summary.includes('STAR stories'), 'Should detect STAR topic');
  });
});

describe('parseTitleFilter edge cases', () => {
  it('should handle empty input', () => {
    const filter = parseTitleFilter('');
    assert.equal(filter.positive.length, 0);
    assert.equal(filter.negative.length, 0);
  });

  it('should handle title_filter with only negative keywords', () => {
    const content = `title_filter:
  negative:
    - "intern"
    - "junior"`;
    const filter = parseTitleFilter(content);
    assert.equal(filter.positive.length, 0);
    assert.equal(filter.negative.length, 2);
  });
});
