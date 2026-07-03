/**
 * Local text embeddings via transformers.js (mined from huggingface/transformers.js).
 * Foundation for Phase 2D memory: embed facts/preferences once, store the
 * vectors in SQLite, and recall by cosine similarity — fully offline, no API
 * spend, no data leaving the machine.
 *
 * Model: all-MiniLM-L6-v2 (quantized ONNX, ~25MB). Downloaded to the local
 * HF cache on first use, cached forever after. Lazy-loaded so app startup
 * pays zero cost until the first embed() call.
 */

type FeatureExtractionPipeline = (
  text: string | string[],
  opts?: { pooling?: 'mean' | 'cls'; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

// @huggingface/transformers is ESM-only; this main process compiles to CJS.
// Indirect eval keeps tsc from down-compiling import() into require().
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  s: string,
) => Promise<any>;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await dynamicImport('@huggingface/transformers');
      console.log('[Embeddings] Loading all-MiniLM-L6-v2 (first run downloads ~25MB)...');
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[Embeddings] Model ready');
      return extractor as FeatureExtractionPipeline;
    })().catch((err) => {
      pipelinePromise = null; // allow retry on next call
      throw err;
    });
  }
  return pipelinePromise;
}

/** Embed a single string into a 384-dim normalized vector. */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/** Embed many strings in one pass (more efficient than looping embed()). */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const [count, dim] = output.dims.length === 2 ? output.dims : [1, output.dims[0]];
  const vectors: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    vectors.push(new Float32Array(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

/**
 * Cosine similarity between two vectors. With normalized embeddings this is
 * just the dot product, but handle unnormalized inputs defensively.
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Rank candidate strings' vectors against a query vector, best first. */
export function rankBySimilarity(
  queryVec: Float32Array,
  candidates: { id: string; vector: Float32Array }[],
  topK = 5,
): { id: string; score: number }[] {
  return candidates
    .map((c) => ({ id: c.id, score: cosineSimilarity(queryVec, c.vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, topK);
}
