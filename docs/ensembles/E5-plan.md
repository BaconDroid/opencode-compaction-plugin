# Plan d'implémentation E5 — Éviction, purge & anti-contamination

> Source : `E5-resultat.md`. Cible : `src/strategies.ts` (`applyPurgeErrors`, `applyDedup`),
> `src/config.ts` (`purgeErrors`, `dedup`), `src/index.ts` (transform),
> `src/degradation-monitor.ts`. **Aucun code de production modifié.**

---

## 1. Objectif

Évincer le contenu nuisible de façon **déterministe, sans entraînement ni store** :
purger un essai échoué **entier** (input + output), **cascader** la purge aux descendants
contaminés, ajouter une **éviction graduée** (`reasoning → bulk → intermediate → épisode`)
qui ne touche jamais les tours `user`, et une **règle d'arrêt judge-free**.

## 2. Sources inspectées (code réutilisable)

| Source | URL | Réutilisable pour E5 |
|---|---|---|
| **pi-cwl** (CWL, référence TS) | https://raw.githubusercontent.com/Kiz8-Team/pi-cwl/main/packages/coding-agent/src/core/context-filter.ts · `.../cwl.ts` | **Cœur direct, TS portable** : `segmentChunks`, `buildReverseDeps`, `isEvictionCandidate` (dépendants évincés d'abord), `stripToolsFromRange` (retire `toolCall` + `toolResult` liés → input+output), `removeRange` (`|| msg.role === "user"`), `mapRangeByAnchors`, `filterContext`. Ordre gradué act : `search_tools → bash_tools → read_tools → entire_chunk` ; expl : `thinking → …`. |
| **CWL** (arXiv) | https://arxiv.org/abs/2606.11213 | Spécification normative : `STRIP_REASONING → STRIP_BULK_OUTPUT → STRIP_INTERMEDIATE → REMOVE_EPISODE` ; « User turns are never evicted » ; prologue protection ; épisodes actifs jamais évincés ; « oldest ACT first ». |
| **CCRM** (arXiv) | https://arxiv.org/abs/2605.08563 | Justification « clean-restart » : repartir propre plutôt que résumer (cascade ε₁/ε₀ = 7.1). Pas de code. |
| **semantic-halting-problem** | https://raw.githubusercontent.com/SahilShrivastava-Dev/semantic-halting-problem/main/backend/shp/halting.py · `.../semantic_entropy.py` | `shp_should_halt(loop_count, distance_history, …, config)` : `all(d < ε for d in history[-k:])` (patience) + `loop_count >= max_rounds` (failsafe) ; `distance = 1 - cosine` (0 sur zéro-norme). Embeddings **locaux** (`bge-small`) → 🔌? pour la variante exacte. |
| **microsoft/memento** | https://github.com/microsoft/memento | ❌ hors périmètre : éviction au niveau **KV cache** (vLLM custom + SFT). |

Extraits clés :
```ts
// pi-cwl/context-filter.ts
export function isEvictionCandidate(seg, evictedNames, reverseDeps): boolean {
  if (!seg.isCompleted) return false;
  if (evictedNames.has(seg.name)) return false;
  const dependents = reverseDeps.get(seg.name);
  if (dependents) for (const dep of dependents) if (!evictedNames.has(dep)) return false;
  return true;
}
export function removeRange(messages, rangeStart, rangeEnd) {
  return messages.filter((msg, idx) => idx < rangeStart || idx > rangeEnd || msg.role === "user");
}
```
```python
# semantic-halting-problem/halting.py
if len(distance_history) >= config.convergence_patience:
    recent = distance_history[-config.convergence_patience:]
    if all(d < config.convergence_threshold for d in recent):
        return HaltDecision(True, REASON_ENTROPY)
```

## 3. Mapping vers le plugin

- `src/strategies.ts` — `findErroredParts` (l.135-154), `applyPurgeErrors` (l.163-191,
  ne purge que `state.input` si > 100 chars, préserve l'output), `applyDedup` (l.78-125).
- `src/config.ts` — `PurgeErrorsConfig{enabled,turns}` (l.44-49), `DedupConfig` (l.37-42),
  `DEFAULT_CONFIG` (l.143-154), `mergeConfig` (l.257-265).
- `src/index.ts` — transform : trim (l.634-659), dedup (l.662-670), purge (l.672-686).
- `src/degradation-monitor.ts` — `countTrailingNoTextAssistant`, `DegradationMonitor`.

## 4. Étapes ordonnées

1. **Purge de l'essai échoué entier (CCRM)** (indépendante). Dans `applyPurgeErrors`,
   au-delà de `purgeErrors.turns`, retirer **l'input et l'output** de l'appel d'outil en
   erreur (les remplacer par un marqueur compact, ex. `[purged failed <tool>: <error head>]`),
   au lieu de ne purger que `state.input`. Conserver un extrait d'erreur (trace).
   Cible : `strategies.ts` + `config.ts` (`purgeErrors.wholeAttempt`, défaut `true`).
2. **Purge en cascade des descendants** (dépend de 1). Nouveau `applyCascadePurge(messages,
   purgedCallIds)` : construire les dépendances (`buildReverseDeps`-like via `callID`/args)
   et purger un message seulement si **tous** ses descendants sont déjà purgés (topologique
   inverse). Cible : `strategies.ts` + `index.ts`.
3. **Éviction graduée LLM-free (CWL)** (dépend de 1). Nouveau `applyEviction(messages,
   config)` : segments `expl`/`act`, `isEvictionCandidate`, niveaux
   `reasoning → bulk output → intermediate → épisode`, **plus vieux `act` d'abord**,
   prologue protégé, **jamais** `role === "user"`, arrêt dès le budget atteint.
   Cible : nouveau `src/eviction.ts` + `strategies.ts` + `index.ts` + `config.ts`.
4. **Ancrage stable des plages** (dépend de 3). Opérer par IDs (pas d'indices) ; `mapRangeByAnchors`
   pour les purges successives. Cible : `eviction.ts` + `blocks.ts` (E3).
5. **Règle d'arrêt judge-free** (dépend de 4, 🔌?). Étendre `DegradationMonitor` avec
   `convergence_threshold`/`convergence_patience` sur une distance entre brouillons
   consécutifs. Variante interne sans embeddings : similarité textuelle (normalisée) ou
   répétition exacte ; variante embeddings (bge-small local) → 🔌?.

## 5. Esquisse technique

```ts
// strategies.ts
export function applyPurgeErrors(messages, config, protectedIndices?): number
// purge input+output des parts errored au-delà de turns, marqueur compact, erreur préservée
export function applyCascadePurge(messages, purgedCallIds: Set<string>, protectedIndices?): number
```
```ts
// src/eviction.ts (nouveau)
export type EvictionLevel = "reasoning" | "bulk_output" | "intermediate" | "episode";
export interface EvictionConfig { enabled: boolean; thresholdTokens: number;
  levels: EvictionLevel[]; protectPrologue: boolean; neverEvictUser: true }
export function applyEviction(messages: Message[], cfg: EvictionConfig): { removed: number; evictedIds: string[] }
```
Config :
```jsonc
"purgeErrors": { "enabled": true, "turns": 4, "wholeAttempt": true, "cascade": true },
"eviction": { "enabled": false, "thresholdTokens": 80000, "protectPrologue": true }
```

## 6. Tests & critères d'acceptation

- `test/strategies.test.ts` : `applyPurgeErrors` retire input **et** output d'un essai échoué
  ancien ; conserve les tours récents (`protectedIndices`) ; `applyCascadePurge` respecte
  l'ordre topologique (pas de purge tant qu'un descendant reste).
- `test/eviction.test.ts` (nouveau) : `applyEviction` ne supprime **jamais** un tour `user` ;
  ordre gradué respecté ; prologue protégé ; arrêt au budget.
- `test/config.test.ts` : nouvelles clés + défauts.
- Critères : (a) un essai échoué ancien n'occupe plus le contexte (input+output) ;
  (b) aucun message `user` supprimé ; (c) les paires `tool_call`/`tool_result` restent
  cohérentes après purge ; (d) budget d'éviction respecté.

## 7. Risques / régressions

- Le comportement actuel **préserve l'output d'erreur** : passer à `wholeAttempt` change la
  sémantique → flag + tests ; conserver un extrait d'erreur pour la traçabilité.
- `applyPurgeErrors` est testé (`strategies.test.ts`) : maintenir la compatibilité de
  signature et le retour (nombre purgé).
- L'éviction graduée peut casser l'indexation des autres stratégies du transform (trim/dedup)
  → opérer par IDs et exécuter l'éviction **en dernier** dans le transform.
- 🔌? : la variante embeddings de la règle d'arrêt ; la version texte reste interne.

## 8. Découpage en PRs

1. `strategies.ts` : `applyPurgeErrors` « essai entier » + config (+ tests).
2. `strategies.ts` + `index.ts` : `applyCascadePurge` (+ tests).
3. `src/eviction.ts` + `strategies.ts` + `config.ts` + `index.ts` : éviction graduée (+ tests).
4. `degradation-monitor.ts` : règle d'arrêt judge-free (+ tests).
