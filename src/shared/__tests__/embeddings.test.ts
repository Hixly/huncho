import { describe, it, expect } from 'vitest';
import { cosineSimilarity, rankBySimilarity } from '../../main/memory/embeddings';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([0.5, 0.5, 0.7]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for mismatched or empty inputs', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  it('ranks the closest vector first and respects topK', () => {
    const query = new Float32Array([1, 0]);
    const ranked = rankBySimilarity(query, [
      { id: 'opposite', vector: new Float32Array([-1, 0]) },
      { id: 'same', vector: new Float32Array([1, 0]) },
      { id: 'orthogonal', vector: new Float32Array([0, 1]) },
    ], 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe('same');
    expect(ranked[0].score).toBeCloseTo(1, 5);
  });
});
