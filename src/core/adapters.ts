/**
 * Optional external adapters (🔌): pure contracts shared by the domain and the
 * provider implementations.
 *
 * Nothing here talks to the network or spawns processes — the provider side
 * lives in `../opencode/adapters.ts`. When no adapter is configured the plugin
 * keeps its deterministic internal behaviour, and any adapter error is caught
 * by the caller and falls back to it (fail-open).
 */

/** Embedding provider: returns one vector per input text, in order. */
export interface Embedder {
	embed(texts: string[]): Promise<number[][]>;
}

/** A ranked retrieval hit (highest score first). */
export interface VectorHit {
	/** Durable id of the matching stored block. */
	id: string;
	/** Similarity score (cosine, typically in [-1, 1]). */
	score: number;
}

/** Semantic retrieval over a caller-supplied corpus. */
export interface VectorIndex {
	search(query: string, k: number, sessionID?: string): Promise<VectorHit[]>;
}

/**
 * Optional model judge: returns the model's answer to a prompt. The caller owns
 * the prompt and the interpretation; the provider only transports it.
 */
export interface Judge {
	ask(prompt: string): Promise<string>;
}

/**
 * Optional residual/perplexity scorer: returns an estimated residual token
 * count for a text (higher = more load-bearing). Used to refine the eviction
 * budget estimate; absent → the heuristic `estimateTokens`.
 */
export interface Scorer {
	score(text: string): Promise<number>;
}

/** A corpus entry fed to an in-memory vector index. */
export interface CorpusItem {
	id: string;
	text: string;
}

/** Cosine similarity between two vectors (0 when either has zero norm). */
export function cosineSimilarity(a: number[], b: number[]): number {
	const length = Math.min(a.length, b.length);
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * In-memory vector index over a dynamic corpus. Embeddings are cached per
 * corpus id; only new (or changed) entries are embedded on each search. The
 * corpus accessor is re-read on every call so records added after the first
 * search are picked up without rebuilding the index.
 */
export class EmbeddingVectorIndex implements VectorIndex {
	private cache = new Map<string, { text: string; vector: number[] }>();

	constructor(
		private readonly embedder: Embedder,
		private readonly corpus: (sessionID?: string) => CorpusItem[],
		/** Hits below this cosine score are dropped (default: 0). */
		private readonly minScore = 0,
	) {}

	async search(
		query: string,
		k: number,
		sessionID?: string,
	): Promise<VectorHit[]> {
		const needle = query.trim();
		if (!needle || k <= 0) return [];

		const items = this.corpus(sessionID);
		if (items.length === 0) return [];

		const missing = items.filter(
			(item) => this.cache.get(item.id)?.text !== item.text,
		);
		if (missing.length > 0) {
			const vectors = await this.embedder.embed(missing.map((i) => i.text));
			if (vectors.length !== missing.length) {
				throw new Error(
					`embedder returned ${vectors.length} vectors for ${missing.length} texts`,
				);
			}
			missing.forEach((item, index) => {
				this.cache.set(item.id, { text: item.text, vector: vectors[index] });
			});
		}

		const [queryVector] = await this.embedder.embed([needle]);
		if (!Array.isArray(queryVector)) {
			throw new Error("embedder returned no query vector");
		}

		const scored: VectorHit[] = [];
		for (const item of items) {
			const cached = this.cache.get(item.id);
			if (!cached) continue;
			const score = cosineSimilarity(queryVector, cached.vector);
			if (Number.isFinite(score) && score >= this.minScore) {
				scored.push({ id: item.id, score });
			}
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, k);
	}

	/** Drop the embedding cache (the next search re-embeds the corpus). */
	clear(): void {
		this.cache.clear();
	}
}
