/**
 * Optional external adapters (🔌): the pure contract shared by the domain and
 * the provider implementations.
 *
 * Nothing here talks to the network or spawns processes — the provider side
 * lives in `../opencode/adapters.ts`. When no adapter is configured the plugin
 * keeps its deterministic internal behaviour, and any adapter error is caught
 * by the caller and falls back to it (fail-open).
 */

/**
 * Optional residual/perplexity scorer: returns an estimated residual token
 * count for a text (higher = more load-bearing). Used to refine the eviction
 * budget estimate; absent → the heuristic `estimateTokens`.
 */
export interface Scorer {
	score(text: string): Promise<number>;
	/**
	 * Optional batch form. When present it is preferred over repeated `score`
	 * calls (one round-trip), which a model-backed scorer relies on.
	 */
	scoreMany?(texts: string[]): Promise<number[]>;
}
