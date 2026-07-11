import { describe, it, expect } from 'vitest';
import { normalizeEmail } from '../validate';

describe('normalizeEmail', () => {
  it('accepts and lowercases a valid email', () => {
    expect(normalizeEmail('  Foo.Bar@Example.COM ')).toBe('foo.bar@example.com');
  });
  it('rejects garbage', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('a b@c.com')).toBeNull();
  });
  it('rejects overlong input', () => {
    expect(normalizeEmail('a'.repeat(250) + '@x.com')).toBeNull();
  });
});
