import { describe, it, expect } from 'vitest';
import { NAVIGATE_TOOL, normalizeNavigateUrl } from '../../main/tools/navigate-tool';

describe('navigate tool spec', () => {
  it('declares an Anthropic tool named "navigate" with a url string input', () => {
    expect(NAVIGATE_TOOL.name).toBe('navigate');
    expect(NAVIGATE_TOOL.description).toMatch(/url|navigate|browser/i);
    expect(NAVIGATE_TOOL.input_schema.type).toBe('object');
    expect(NAVIGATE_TOOL.input_schema.properties.url.type).toBe('string');
    expect(NAVIGATE_TOOL.input_schema.required).toContain('url');
  });
});

describe('normalizeNavigateUrl', () => {
  it('passes through a full https url', () => {
    expect(normalizeNavigateUrl('https://youtube.com')).toBe('https://youtube.com');
  });
  it('upgrades http to https', () => {
    expect(normalizeNavigateUrl('http://youtube.com')).toBe('https://youtube.com');
  });
  it('adds https:// to a bare domain', () => {
    expect(normalizeNavigateUrl('youtube.com')).toBe('https://youtube.com');
    expect(normalizeNavigateUrl('gmail.com')).toBe('https://gmail.com');
  });
  it('treats a single word with no dot as a google search', () => {
    expect(normalizeNavigateUrl('weather')).toBe('https://www.google.com/search?q=weather');
  });
  it('trims whitespace', () => {
    expect(normalizeNavigateUrl('  youtube.com  ')).toBe('https://youtube.com');
  });
  it('rejects javascript: and file: urls (returns null)', () => {
    expect(normalizeNavigateUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeNavigateUrl('file:///etc/passwd')).toBeNull();
  });
});
