# Plan — Triage des features : ajustements & retraits

> Source de vérité pour une session d'implémentation. Chaque phase est une PR
> indépendante sur une branche dédiée. **Ne pas modifier `docs/ensembles/*.md`**
> (cadres).

## Contexte

Le plugin a accumulé des features de valeur inégale. Ce plan classe les
ajustements par ratio valeur/risque et fixe l'ordre d'exécution. Objectifs :
réduire la surface de code fragile (~400–500 lignes), la consommation permanente
(descriptions d'outils) et le coût par transform, sans perdre de capacité utile.

## Principes (invariants)

- **Une phase = une PR** sur une branche dédiée (`feat/triage-<n>`), jamais
  `master` en direct.
- **Ordre par ratio valeur/risque** ; chaque phase doit être **verte**
  (typecheck + tests + coverage) avant la suivante.
- **Fail-open / opt-in** préservés ; ne jamais affaiblir une assertion pour verdir.
- **Changement de comportement assumé et documenté** (README + message de commit
  + note de migration si breaking) ; mise à jour des tests autorisée quand le
  comportement change.
- **Boucle** : valider → commiter → pousser → PR → merger → nettoyer la branche.
- **STOP + rapport** si une phase ne peut pas être verte ou qu'un choix de
  conception n'est pas tranché.

## Phases

### Phase 0 — Préparation

- Branche dédiée. `bun install`.
- Baseline verte : `bun run typecheck`, `bun test`, `bun run test:coverage`.

### Phase 1 — Cascade purge en opt-in (défaut `false`)

- **But** : retirer du chemin par défaut le code le plus fragile
  (`strategies.applyCascadePurge`, O(P²), heuristique callID) tout en le gardant
  disponible.
- **Fichiers** :
  - `src/config/config.ts` : `purgeErrors.cascade` défaut `true → false`.
  - `src/core/transform.ts` : `config.purgeErrors.cascade ?? true → ?? false`.
  - `README.md` : défaut + description.
  - Tests : vérifier `test/index.test.ts` (intégration supposant cascade actif) ;
    `test/strategies.test.ts` teste `applyCascadePurge` directement (inchangé).
- **Risque** : perte de la cascade pour qui s'y fiait → documenter.
- **Validation** : `bun test test/strategies.test.ts test/index.test.ts`, puis suite.

### Phase 2 — Consolidation des outils : `recall` → `expand`

- **But** : passer de 6 à 5 outils ; réduire les descriptions d'outils envoyées
  à chaque tour (conso permanente).
- **Fichiers** :
  - `src/opencode/tools.ts` : `buildExpandToolDef` gagne un arg
    `mode: "sticky" | "once"` (défaut `sticky`) ; supprimer `buildRecallToolDef`.
  - `src/index.ts` : `PLUGIN_TOOL_NAMES` (retirer `recall`), map `tool`, branche
    `tool.execute.after` (dériver `mode` depuis `args.mode`).
  - `test/compat.test.ts` : liste d'outils attendue.
  - `README.md` : section outils + permissions (`recall` retiré).
- **Variante optionnelle (phase séparée)** : fusionner `inspect` → `search`
  (requête vide ⇒ listing). À ne faire que si cette phase est verte et que la
  portée est claire.
- **Validation** : tests `expand`, `compat`, `index`, puis suite.

### Phase 3 — Retrait de `squash`

- **But** : supprimer ~120 lignes + cas limites (contiguïté, labels, orphelins
  réversibles) pour un outil rarement utilisé.
- **Fichiers** :
  - `src/opencode/tools.ts` : `buildSquashToolDef`.
  - `src/index.ts` : `PLUGIN_TOOL_NAMES`, map, capture `squash`.
  - `src/core/compress.ts` : `SquashRequest`, `SquashStore`, `applySquash`,
    `ApplySquashOptions`.
  - `src/core/requests.ts` : store/deps/branche squash.
  - `src/config/config.ts` : `compress.maxBlocksPerSquash`.
  - `README.md`, tests (`compress.test.ts`, `index.test.ts`, `compat.test.ts`,
    `config.test.ts`).
- **Attention** : `orderCompressBlocks` reste utilisé par `parseCompressBlocks`
  et `expand` → **ne pas** le retirer.
- **Risque** : breaking pour les utilisateurs de `squash` → note de migration.
- **Validation** : suite complète + coverage.

### Phase 4 — Éviction : coût O(n) et niveaux par défaut

- **But (a)** : supprimer le re-scan complet après chaque éviction. Faire
  retourner à chaque `evict*` le **delta de tokens** et maintenir un total
  courant dans `applyEviction`, au lieu d'appeler `estimate(messages)` à chaque
  changement. Le delta doit refléter le **même** calcul que `estimateTokens`
  (y compris le resolver du Scorer).
- **But (b)** : retirer `bulk_output` des `eviction.levels` par défaut
  (redondant avec `trim`), ou documenter la redondance.
- **Fichiers** : `src/core/eviction.ts`, `src/config/config.ts`,
  `test/eviction.test.ts`, `README.md`.
- **Risque** : (a) doit être **exactement** équivalent (sinon sur/sous-éviction)
  → tests comparatifs pass0/pass1.
- **Validation** : `test/eviction.test.ts` (idempotence + seuils), suite.

### Phase 5 — Préemption : simplifier les gates

- **But** : garder **un** gate (tokens) + cooldown ; retirer
  `minMessagesSinceLast` et `tailGuard`.
- **Fichiers** :
  - `src/core/preemption.ts` : pure `shouldTriggerPreemptiveCompaction`,
    compteurs `messagesSince` / `toolCallsSince`.
  - `src/config/config.ts` : `PreemptiveCompactionConfig`, `TailGuardConfig`.
  - `src/index.ts` : appels `recordMessage` / `recordToolCall`.
  - Tests `preemption.test.ts`, `config.test.ts`, `index.test.ts`, `README.md`.
- **Risque** : breaking config → note de migration.
- **Validation** : tests préemption + config + intégration.

### Phase 6 — Files-touched : cadrer le shell

- **But** : limiter l'extraction `bash` (heuristiques fragiles) ; garder les
  outils structurés fiables (`read/write/edit/delete`). Soit retirer le parsing
  shell, soit le documenter best-effort et plafonner le manifest.
- **Fichiers** : `src/core/files-touched.ts`, tests, `README.md`.
- **Validation** : `test/files-touched.test.ts`, suite.

### Phase 7 — Nettoyage

- Retirer `SlidingState.cutoffIndex` (champ mort) + branche + test associé.
- Vérifier README / structure de fichiers.
- **Validation** : `test/previous-summary.test.ts`, suite.

## Garde-fous transverses

- Après **chaque** phase : `bun run typecheck` + `bun test` +
  `bun run test:coverage` (exit 0).
- PR : titre `feat(triage-N): …`, corps avec fichiers, comportement, risques,
  résultats réels.
- Merger via l'API GitHub (`GITHUB_TOKEN`), supprimer la branche.
- **STOP + rapport** si : un test échoue sans progression, un choix de conception
  non tranché (ex. portée exacte de la fusion `inspect`/`search`), ou un retrait
  casse un contrat non documenté.

## Estimation

- Phases sûres/réversibles : 1, 2, 5, 7.
- Phases breaking/à risque : 3 (retrait `squash`), 4 (éviction delta) — à faire
  en dernier, avec tests comparatifs.
