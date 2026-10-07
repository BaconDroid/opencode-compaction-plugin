# Plan d'implémentation E1 — Déclenchement & rythme de compaction

> Source : `E1-resultat.md`. Cible : `src/preemptive-compaction.ts`, `src/config.ts`,
> `src/index.ts` (`event`, `tool.execute.after`, `config`), `src/compress.ts`.
> **Aucun code de production n'est modifié par ce document** (plan seulement).
> Statut : recherche + inspection code faites ; plan prêt à découper en PRs.

---

## 1. Objectif

Rendre le déclencheur de compaction **robuste et déterministe** : seuil hybride
(ratio × plafond absolu), politique explicite sur les cache-tokens, gates bon-marché,
garde de queue, et gate d'éligibilité du tool `compress` — sans aucun appel modèle ni
composant externe.

## 2. Sources inspectées (code réutilisable)

| Source | URL | Réutilisable pour E1 |
|---|---|---|
| `opencode-context-compress` `lib/auto-compression.ts` | https://raw.githubusercontent.com/AidenGeunGeun/opencode-context-compress/main/lib/auto-compression.ts | **Le plus proche** : TS natif. `resolveAutomaticCompressionThreshold(contextTokens, {contextWindowRatio, tokenThreshold}, contextLimit)` → seuil `min(contextLimit*ratio, tokenThreshold)` + `reason` ; extraction cache-tokens `total` sinon `input+output+reasoning+cache.read+cache.write` ; idempotence via `lastAutoTriggeredMessageId` ; cooldown post-compression. |
| `opencode-context-compress` `package.json` | https://raw.githubusercontent.com/AidenGeunGeun/opencode-context-compress/main/package.json | stack : `js-tiktoken` (compteur local déterministe), `@opencode-ai/plugin >=0.13.7`. |
| `selfcompact` `agent.py` | https://raw.githubusercontent.com/tianjianl/selfcompact/main/agent.py | gates **déterministes** avant tout modèle : `round≥min && tokens≥min && count<cap && (iter−last)≥period` (`_decide_compaction`). |
| `deepagents` `summarization.py` | https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/deepagents/deepagents/middleware/summarization.py | `compute_summarization_defaults()` : `trigger=("fraction",0.85)`, `keep=("fraction",0.10)`, double seuil truncate-args/compaction ; `_should_truncate_args()` fraction/tokens/messages. ⚠️ le gate « ~50 % » **n'est pas** dans ce fichier (il est dans `langchain.agents.middleware.summarization`). |
| `selfcompact` `prompts.py` | https://raw.githubusercontent.com/tianjianl/selfcompact/main/prompts.py | `SELFCHECK_PROMPT` (rubric C1/C2/C3/N1) — utile seulement pour une variante non déterministe (🔌?). |

Citations de code clés :
```ts
// opencode-context-compress/lib/auto-compression.ts
const relativeThresholdTokens = contextLimit ? Math.floor(contextLimit * config.contextWindowRatio) : undefined
const thresholdTokens = relativeThresholdTokens ? Math.min(relativeThresholdTokens, config.tokenThreshold) : config.tokenThreshold
```
```python
# selfcompact/agent.py
gate_round = iteration >= self.selfcheck_min_round
gate_tokens = token_count >= self.selfcheck_min_tokens
gate_cap = total_summarizations < self.selfcheck_cap
gate_period = (last_probe_iter is None or (iteration - last_probe_iter) >= self.selfcheck_period)
```

## 3. Mapping vers le plugin

- `src/preemptive-compaction.ts` — `totalInputTokens()` (l.26-28), `shouldTriggerPreemptiveCompaction()` (l.30-48).
- `src/config.ts` — `PreemptiveCompactionConfig` (l.58-67), `DEFAULT_CONFIG.preemptiveCompaction` (l.155-159), `mergeConfig` (l.271-282).
- `src/index.ts` — `maybePreempt()` (l.421-466), `resolveContextLimit()` (l.379-418), `preemptUsage`/`preemptLast`/`preemptInProgress` (l.303-305), `tool.execute.after` capture `compress` (l.481-503), `config` (l.842-853).
- `src/compress.ts` — `buildCompressToolDef()` (l.189-217), description de l'outil.

## 4. Étapes ordonnées

1. **Politique cache-tokens** (indépendante). `totalInputTokens` additionne aujourd'hui
   `input + cache.read` (`preemptive-compaction.ts:27`) ; le cookbook Claude avertit que les
   cache-tokens déclenchent prématurément. Ajouter `countCacheTokens?: boolean` (défaut
   `false`) et une fonction `effectiveInputTokens(tokens, {countCacheTokens})` qui reproduit
   le calcul d'`opencode-context-compress` (`total` sinon somme).
2. **Seuil hybride** (dépend de 1). Étendre la config : `threshold` (ratio, existant),
   `absoluteTokenThreshold?: number`. Calculer `min(contextLimit*threshold, absolute)` dans
   une nouvelle fonction pure `resolveTriggerThreshold(contextLimit, cfg)`.
3. **Gates déterministes** (dépend de 2). Ajouter `minTokensSinceLast?` et
   `minMessagesSinceLast?` à `shouldTriggerPreemptiveCompaction` (composition AND, cf.
   selfcompact). Ne pas ajouter de gate nécessitant un modèle.
4. **Garde de queue** (dépend de 2). Ajouter `tailGuard?: { enabled: boolean; minNewToolCalls: number }` :
   ne pas compacter si moins de `minNewToolCalls` appels d'outil depuis la dernière
   compaction (approximation déterministe de « < ~5 appels restants »). Signal :
   `tool.execute.after`.
5. **Gate d'éligibilité du tool `compress`** (indépendante). Dans `tool.execute.after` /
   la capture `compress`, différer la requête si l'usage rapporté < ~50 % du seuil de
   compaction (déterministe, aucun modèle). Compléter la description de l'outil
   (`compress.ts`) avec le catalogue « quand compacter » (E1-resultat §🟢).
6. **Idempotence** (indépendante). Ajouter `lastTriggeredMessageId` par session pour éviter
   un double déclenchement sur le même message (`message.updated` + `tool.execute.after`).

## 5. Esquisse technique

```ts
// preemptive-compaction.ts
export interface TriggerConfig {
  threshold: number; absoluteTokenThreshold?: number;
  countCacheTokens?: boolean;
  minTokensSinceLast?: number; minMessagesSinceLast?: number;
  cooldownMs: number;
}
export function effectiveInputTokens(t: TokenInfo, countCache: boolean): number {
  const base = (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0);
  const cache = (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
  return countCache ? base + cache : base;
}
export function resolveTriggerThreshold(contextLimit: number, cfg: TriggerConfig): number {
  const rel = Math.floor(contextLimit * cfg.threshold);
  return cfg.absoluteTokenThreshold ? Math.min(rel, cfg.absoluteTokenThreshold) : rel;
}
```
Config ajoutée :
```jsonc
"preemptiveCompaction": {
  "enabled": false, "threshold": 0.78,
  "absoluteTokenThreshold": 330000,
  "countCacheTokens": false,
  "minTokensSinceLast": 20000,
  "minMessagesSinceLast": 6,
  "tailGuard": { "enabled": true, "minNewToolCalls": 3 },
  "cooldownMs": 60000
}
```

## 6. Tests & critères d'acceptation

- `test/preemptive-compaction.test.ts` : `effectiveInputTokens` (avec/sans cache),
  `resolveTriggerThreshold` (ratio vs plafond), gates (min tokens/messages), garde de queue,
  non-déclenchement pendant `inProgress`/cooldown.
- `test/config.test.ts` : merge des nouvelles clés + défauts.
- Critères : (a) aucun déclenchement si `cache.read` seul dépasse le seuil et
  `countCacheTokens=false` ; (b) un message déjà déclencheur ne re-déclenche pas ;
  (c) le tool `compress` est différé sous 50 % du seuil.

## 7. Risques / régressions

- Changer `totalInputTokens` peut modifier le comportement par défaut → conserver le défaut
  actuel sauf décision explicite (recommandé : `countCacheTokens=false`).
- Le ratio par défaut 0.78 diffère du 0.85 des Deep Agents : ne pas changer sans mesure.
- Le gate `compress` ne doit pas bloquer un usage manuel légitime → autoriser un override
  utilisateur (message explicite) comme `opencode-context-compress`.
- 🔌? : la variante « rubric SelfCompact » exige un appel modèle ; hors périmètre par défaut.

## 8. Découpage en PRs

1. `preemptive-compaction` : `effectiveInputTokens` + `countCacheTokens` (+ tests).
2. `config` + `resolveTriggerThreshold` hybride (+ tests).
3. Gates déterministes + garde de queue (+ tests).
4. Gate d'éligibilité `compress` + description de l'outil (+ tests).
