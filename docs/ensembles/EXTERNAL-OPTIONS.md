# Composants externes (🔌) par ensemble — options configurables

> Résultat de l'exécution de `EXTERNAL-OPTIONS-PROMPT.md`. **Aucun code modifié.**
> But : recenser les composants externes **non implémentés** (E1–E6) et dire s'ils
> peuvent être rendus **optionnels / configurables** (opt-in, off par défaut, jamais
> obligatoires).

Sources : `docs/context-compaction-research.md` §4 et §6, `docs/ensembles/SYNTHESE.md`,
plans/resultats E1–E5, et le code (`src/core/*`, `src/config/config.ts`).

Légende statut interne : **✅ fait** · **◐ partiel** · **✗ absent**.

---

## E1 — Déclenchement & rythme

| 🔌 item | Exigence externe | Version interne (statut) | Intégration optionnelle | Clés de config | Effort/risque |
|---|---|---|---|---|---|
| SelfCompact rubric (verdict « faut-il compacter ? ») | Appel modèle (juge) | ✅ gates déterministes + seuil hybride | Adapter `Judge` : pose une question au modèle avant de compacter ; sinon déterministe | `adapters.judge.*` | Moyen / coût modèle |
| Compaction server-side Anthropic | Service Anthropic | ✗ (hors plugin) | Non branchable côté plugin (dépend du provider) | — | Hors périmètre |

## E2 — Résumé structuré & continuité

| 🔌 item | Exigence externe | Version interne (statut) | Intégration optionnelle | Clés de config | Effort/risque |
|---|---|---|---|---|---|
| Dédup par embeddings d'ACE | Embeddings | ◐ dedup par clé `(tool+args)` | Adapter `Embedder` : dédup sémantique des faits du résumé au-delà d'un seuil | `adapters.embeddings.*` | Moyen / faux positifs |

Le reste du format (11 sections, `<task-state>`, `<previous-summary>`, `<latest-user-ask>`) est **interne** ✅.

## E3 — Folding & compression multi-échelle

| 🔌 item | Exigence externe | Version interne (statut) | Intégration optionnelle | Clés de config | Effort/risque |
|---|---|---|---|---|---|
| Memento | vLLM modifié + SFT | ✗ | Non (nécessite un runtime/KV) | — | Hors périmètre |
| selfcompact (corpus FAISS/BM25) | Index/vecteurs | ◐ sidecar + `search` par mot-clé | Adapter `VectorIndex` : retrieval sémantique dans le corpus/les blocs | `adapters.embeddings.*` | Moyen |
| `unfold` par index/vecteurs | Index | ✅ `expand`/`recall` (sidecar) ; retrieval déterministe | cf. E4 (Embedder/VectorIndex) | `adapters.embeddings.*` | Faible (réutilise E4) |

## E4 — Réversibilité, inspection & retrieval

| 🔌 item | Exigence externe | Version interne (statut) | Intégration optionnelle | Clés de config | Effort/risque |
|---|---|---|---|---|---|
| Index de retrieval des évincés | Vecteurs | ✅ sidecar + `inspect`/`search` (mot-clé, sans embeddings) | Adapter `Embedder`/`VectorIndex` : `search` sémantique en plus du mot-clé | `adapters.embeddings.*` | Faible / moyen |

La **réversibilité** est faite ✅ (sidecar + `expand`/`recall`). Seul le retrieval *sémantique* est externe.

## E5 — Éviction, purge & anti-contamination

| 🔌 item | Exigence externe | Version interne (statut) | Intégration optionnelle | Clés de config | Effort/risque |
|---|---|---|---|---|---|
| TokenPilot (résiduel model-based) | Modèle estimateur | ◐ éviction par `estimateTokens` (heuristique) | Adapter `Scorer` : estimateur de résiduel ; sinon heuristique | `adapters.scorer.*` | Moyen |
| Contextual Drag (dénoising jugé) | Juge modèle | ◐ purge déterministe (essai entier + cascade) | Adapter `Judge` : décide si un contenu est « bruit » | `adapters.judge.*` | Moyen / coût modèle |
| selfcompact (rubrique LLM) | Juge modèle | ◐ gates déterministes | Adapter `Judge` | `adapters.judge.*` | Moyen |
| microsoft/acon | Distillation/entraînement | ✗ | Non (entraînement) | — | Hors périmètre |
| Classifieurs/scoreurs entraînés (LRE, AgeMem, Free(), IntentKV) | Modèle entraîné | ✗ | Non (entraînement) | — | Hors périmètre |

## E6 — Contraintes, gouvernance & validation

| 🔌 item | Exigence externe | Version interne (statut) | Intégration optionnelle | Clés de config | Effort/risque |
|---|---|---|---|---|---|
| Slipstream (validation post-compaction) | Juge LLM | ✅ pinning + vérif d'intégrité déterministe (substring) | Adapter `Judge` : vérifie *sémantiquement* que le résumé respecte les contraintes épinglées | `adapters.judge.*` | Moyen / coût modèle |

Le **pinning** et la **vérification déterministe** sont faits ✅. Seule la validation *sémantique* est externe.

---

## Adaptateurs optionnels (transversal)

Principe : **interfaces dans `core/`**, aucune dépendance runtime obligatoire ; un
composant externe est **branché par config** (HTTP/MCP/commande), jamais bundlé.
Sans configuration → fonctionnalité **désactivée**, version interne conservée.

| Adapter | Sert à (ensembles) | Contrat (esquisse) | Résolution / mode dégradé |
|---|---|---|---|
| `Embedder` / `VectorIndex` | E2 (dédup sémantique), E3/E4 (retrieval sémantique) | `embed(texts): number[][]` · `search(query, k): Hit[]` | Absent → `search` mot-clé (E4) et dédup par clé (E2) |
| `Judge` | E1 (rubric), E5 (dénoising), E6 (validation) | `ask(prompt): string` (ou `verdict(...): boolean`) | Absent → gates/purge/intégrité **déterministes** |
| `Scorer` | E5 (résiduel), E9 (perplexité) | `score(text): number` | Absent → `estimateTokens` (heuristique) |
| `MemoryStore` | E7/E8 (**hors E1–E6**) | `read/write/forget` | Absent → pas de mémoire cross-session |

Config proposée (toute optionnelle) :
```jsonc
"adapters": {
  "embeddings": { "provider": "http" | "command" | "mcp", "url": "…", "model": "…" },
  "judge":      { "provider": "http" | "command" | "mcp", "model": "…" },
  "scorer":     { "provider": "http" | "command" | "mcp", "model": "…" }
}
```
Règles : **opt-in** (off si absent) ; **fail-open** (toute erreur d'adapter → fallback
interne, jamais de rupture du transform/compaction) ; **aucune dépendance ajoutée**
(les adapters parlent à un endpoint/commande existants).

---

## Recommandation

1. **Priorité 1 — `Embedder`/`VectorIndex` pour E4** : prolonge directement le `search`
   mot-clé déjà fait ; gain immédiat, risque faible, config unique réutilisée par E2/E3.
2. **Priorité 2 — `Judge` pour E6** : prolonge la vérification d'intégrité déterministe
   (validation sémantique des contraintes épinglées).
3. **Optionnel — `Scorer` (E5/E9)** et **`Judge` pour E1/E5** : niches ; à garder comme
   adapters si on veut la variante « intelligente », sinon la version interne suffit.
4. **Hors périmètre** : E7/E8 (store/graphe/cross-session), Memento, ACON, compaction
   server-side Anthropic, scoreurs entraînés — dépendances lourdes (runtime/KV/entraînement).

> Le plugin reste **entièrement fonctionnel sans aucun adapter** : les versions internes
> déterministes (E1–E6) sont déjà en place. Les adapters n'ajoutent que les variantes
> « sémantiques/jugées ».
