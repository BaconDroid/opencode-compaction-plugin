# Plan d'implémentation E3 — Folding & compression multi-échelle

> Source : `E3-resultat.md`. Cible : `src/compress.ts` (tool `compress`,
> `<compressed-block>`), `src/index.ts` (`experimental.chat.messages.transform`).
> **Aucun code de production modifié.** Statut : recherche + inspection code faites.

---

## 1. Objectif

Rendre la compression **fiable et multi-échelle** : sélection de plage **déterministe**
(fin du problème #10 des indices non observables), blocs identifiés par IDs durables,
**expand réversible**, et **fusion (`squash`)** de blocs — sans entraînement ni composant
externe.

## 2. Sources inspectées (code réutilisable)

| Source | URL | Réutilisable pour E3 |
|---|---|---|
| **opencode-context-compress** (plugin OpenCode, même écosystème) | https://raw.githubusercontent.com/AidenGeunGeun/opencode-context-compress/main/index.ts · `.../lib/tools/compress.ts` · `.../lib/messages/context-map.ts` · `.../lib/messages/blocks.ts` | **Direct** : `selectDeterministicCompressionSpan(rawHistory, state, protectedTurns)` (span = queue après le dernier bloc, tail protégé recalculé) ; `deriveProtectedTailMessageIds` (compte `step-start`) ; `orderCompressBlocks` + labels `[bN]` ; tools `compress`/`squash` ; persistance atomique `candidateState → saveSessionState → commitDurableSessionState`. |
| **context-fold** (Middlewatch) `src/core/` | https://raw.githubusercontent.com/Middlewatch/context-fold/main/src/core/policy/fold-ladder.ts · `.../digest.ts` · `.../block.ts` · `.../apply.ts` · `.../adapters/pi/unfold-tool.ts` | Cœur **pur, sans I/O** : IDs durables (`u:<ts>`, `a:<respId>:p<j>`, `r:<callId>`, `isDurableId`), `foldCode` (FNV-1a base36), tag `{#code FOLDED}`, `applyPlan` (substitution de contenu, **jamais** de suppression, préserve `callId`), `unfold` sticky / `recall_folded`, ladder `foldAt=0.45`/`foldStep=0.12`/`coldFoldAt=0.25`. |
| **ACE Elasticizer** (arXiv) | https://arxiv.org/abs/2606.31564 | Modèle 3-états réversible par étape `raw | abstract | drop` + « maintenance layer » lossless (raw + abstract). |
| **selfcompact** `agent.py` | https://raw.githubusercontent.com/tianjianl/selfcompact/main/agent.py | politique de déclenchement multi-gate + reset de liste (à combiner avec E1). |

Extraits clés :
```ts
// context-map.ts — sélection déterministe (résout #10)
const candidates = transformed.slice(newestBlockIndex + 1)
  .filter(m => !syntheticMap.has(m.info.id) && !existingBlockMessageIds.has(m.info.id))
const protectedMessageIds = deriveProtectedTailMessageIds(candidates, protectedTurns)
```
```ts
// blocks.ts — labels stables
ordered.sort((l, r) => l.anchorIndex - r.anchorIndex)
return ordered.map((block, index) => ({ ...block, label: `b${index}` }))
```
```ts
// context-fold/apply.ts — substitution, jamais suppression
const safeOps = (ops ?? []).filter(o => isDurableId(o.id) && typeof o.digestText === "string" && o.digestText)
```

## 3. Mapping vers le plugin

- `src/compress.ts` — `CompressRequest{topic,start,end,summary,timestamp,callID}` (l.22-35),
  `CompressionStore` (l.45-74), `selectCompressions` (l.101-124), `applyCompressions`
  (l.132-171, `messages.splice(start, count, summaryMessage)`), `buildCompressToolDef`
  (l.189-217, args `topic/start/end/summary`).
- `src/index.ts` — transform (l.584-687) : drain/select/apply (l.592-626) ; capture du tool
  `compress` (l.481-503).
- `src/config.ts` — pas de section `compress` aujourd'hui (à ajouter).

## 4. Étapes ordonnées

1. **IDs durables + sélection déterministe** (indépendante). Nouveau module `src/blocks.ts` :
   `blockId(message, partIndex)`, `isDurableId(id)`, `selectDeterministicSpan(messages,
   {existingBlockIds, protectedTurns})`. Remplacer le calcul `{start,end}` par ce span.
   Cible : `compress.ts` + `index.ts`.
2. **Signature du tool `compress`** (dépend de 1). Passer de `{topic,start,end,summary}` à
   `{topic,summary}` (+ `scale?`), le plugin sélectionnant le span ; conserver une
   compatibilité de lecture des anciens blocs `range="s-e"`.
3. **Labels `[bN]` + `orderCompressBlocks`** (dépend de 1). Trier par ancre, renuméroter
   `b0,b1…`, rendre `[bN]\n\n<summary>` (dans `<compressed-block>`). Cible : `blocks.ts` +
   `compress.ts`.
4. **`squash` (fusion deep)** (dépend de 3). Nouveau tool `squash({from,to,summary,topic})`
   qui remplace ≥ 2 blocs contigus par un bloc unique ; refuser les cas ambigus (fail-closed).
   Cible : `compress.ts` + `index.ts`.
5. **Expand réversible** (dépend de 1). Conserver les originaux (sidecar en mémoire keyed by
   `blockId`) et exposer un tag `{#code}` + tool `expand`/`recall` (sticky vs one-shot).
   Cible : `blocks.ts` + nouveau `src/expand.ts` + `index.ts`. *(Chevauche E4 — implémenter
   la version minimale interne, sans index/vecteurs.)*
6. **Échelle** (dépend de 2). Champ `scale?: "granular" | "deep"` ; `granular` = 1 message,
   `deep` = plage. Extension optionnelle ACE `raw|abstract|drop` (garder `abstract` en
   mémoire pour ré-expansion).

## 5. Esquisse technique

```ts
// src/blocks.ts
export type Scale = "granular" | "deep";
export interface CompressionRequest { topic: string; summary: string; scale?: Scale; callID?: string }
export function selectDeterministicSpan(messages: Message[], opts: {
  existingBlockIds: Set<string>; protectedTurns: number;
}): { start: number; end: number } | undefined
export function blockId(message: Message, partIndex: number): string // "r:<callID>" | "a:<respId>:p<j>" | "u:<ts>"
```
```ts
// compress.ts — nouveau tool
args: { topic: string; summary: string; scale?: "granular" | "deep" }
// squash.ts (dans compress.ts)
args: { from: number; to: number; summary: string; topic: string } // indices de BLOCS [bN], pas de messages
```
Config :
```jsonc
"compress": { "protectedTurns": 3, "reversible": true, "maxBlocksPerSquash": 8 }
```

## 6. Tests & critères d'acceptation

- `test/compress.test.ts` : sélection déterministe (nouveau bloc après le dernier ; tail
  protégé exclu) ; `blockId` durable et stable ; `orderCompressBlocks`/labels ; `squash`
  (≥ 2 blocs, refus des cas ambigus) ; `expand` restitue l'original ; idempotence
  (un span déjà compressé n'est pas recompressé).
- Critères : (a) le modèle n'a **plus** à fournir d'indices ; (b) deux compressions
  successives ne se chevauchent pas ; (c) `expand` restitue le contenu exact ; (d) les paires
  `tool_call`/`tool_result` ne sont jamais orphelines (substitution, pas suppression).

## 7. Risques / régressions

- **Changement de signature du tool** : `test/compress.test.ts` et les appelants existants
  attendent `start/end` → prévoir une transition (accepter les deux, déprécier).
- Le format `<compressed-block>` actuel (`range="s-e"`) est lu par `selectCompressions` :
  conserver la lecture des blocs legacy.
- Réversibilité = mémoire supplémentaire ; borner le sidecar (TTL/taille) et le nettoyer
  sur `session.deleted`.
- 🔌 : `unfold` par index/vecteurs renvoie à E4 ; ici, sidecar local uniquement.

## 8. Découpage en PRs

1. `src/blocks.ts` : IDs durables + `selectDeterministicSpan` (+ tests).
2. `compress.ts` : tool `{topic,summary,scale}` + compat legacy (+ tests).
3. `compress.ts` : `[bN]` + `orderCompressBlocks` + `squash` (+ tests).
4. `src/expand.ts` + `index.ts` : sidecar + `expand`/`recall` (+ tests).
