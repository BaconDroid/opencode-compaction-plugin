# Synthèse — plans d'implémentation E1, E2, E3, E5

> Déroulé de l'exécution du prompt `PLAN-IMPLEMENTATION-PROMPT.md` : lecture de la
> recherche, inspection du code local + externe, production d'un plan par ensemble.
> **Aucun code de production modifié** ; seuls des fichiers de plan ont été créés.
> Fichiers produits : `E1-plan.md`, `E2-plan.md`, `E3-plan.md`, `E5-plan.md`, cette synthèse.

---

## 1. Comment ça s'est passé

Pour chaque ensemble, dans l'ordre **E1 → E2 → E3 → E5** :
1. lecture de `E<n>-resultat.md` + doc consolidé + cadre ;
2. lecture du code local (`src/*.ts`) et traçage des hooks/fonctions à modifier ;
3. `webfetch` du code/des exemples externes cités, extraction des fonctions/structures
   réellement réutilisables ;
4. tri réutilisable vs `🔌` ;
5. rédaction du plan (objectif, sources, mapping, étapes, esquisse, tests, risques, PRs).

Résultat : **4 plans prêts à découper en PRs**, chacun adossé à du code externe vérifié.

## 2. Ce qui a été réutilisé, par ensemble

- **E1** → `opencode-context-compress/lib/auto-compression.ts` (**TS natif** : seuil hybride
  `min(contextLimit*ratio, absolute)`, extraction cache-tokens, cooldown/idempotence) +
  gates déterministes de `selfcompact/agent.py` + défauts fraction/keep de `deepagents`.
- **E2** → template + blocs de **pi-live-compaction** (`<previous-summary>`, `<task-state>`,
  marqueurs de statut), snapshot de tâche **OpenHands** (`TASK_TRACKING`, IDs préservés),
  état glissant `deepagents` (`{cutoff_index, summary_message, file_path}`), `DEFAULT_SUMMARY_PROMPT`
  LangChain.
- **E3** → **opencode-context-compress** (`selectDeterministicCompressionSpan`, `[bN]`,
  `squash`, `protectedTurns`) = **solution directe au problème #10** ; `context-fold/src/core/`
  (IDs durables, digest FNV-1a, `applyPlan` par substitution, `unfold` réversible) ;
  ACE `raw|abstract|drop`.
- **E5** → **pi-cwl/context-filter.ts** (segmentation, DAG inverse `isEvictionCandidate`,
  `stripToolsFromRange` input+output, `removeRange` protégeant `user`) = cœur TS portable ;
  niveaux CWL ; `semantic-halting-problem` (patience cosine + failsafe) ; justification CCRM.

## 3. Recoupements et dépendances entre ensembles

- **IDs durables / blocs** : E3 (`src/blocks.ts`) est un **prérequis** pour l'éviction
  graduée de E5 (ancrage stable des plages) → implémenter E3 avant E5-PR3.
- **`task-state` (E2)** et **manifeste `files-touched`** alimentent aussi E6 (pinning) et la
  continuité ; réutiliser le même rendu.
- **Tool `compress`** : E1 (gate d'éligibilité) et E3 (nouvelle signature) touchent le même
  tool → séquencer : E3 (signature) puis E1 (gate) pour éviter deux migrations.
- **Purge vs dedup** : E5 (essai entier + cascade) modifie `strategies.ts`, déjà sollicité par
  le trim (E9) et la dédup ; exécuter l'éviction **en dernier** dans le transform.
- **Pinning / contraintes** : E1/E5 en donnent la justification, la cible reste **E6**.
- **ACE collision de noms** : `2510.04618` (E2) ≠ `2606.31564` (E3) — deux sources distinctes.

## 4. Ordre d'implémentation recommandé (transversal)

1. **E1** (cache-tokens, seuil hybride, gates) — faible risque, tests unitaires purs.
2. **E3** (IDs durables + span déterministe + `[bN]`/`squash`) — résout #10, débloque E5.
3. **E2** (blocs `task-state`, état glissant) — continuité, tests de prompt.
4. **E5** (essai entier, cascade, éviction graduée, arrêt judge-free) — dépend de E3 pour l'ancrage.
5. **E6** (pinning) — réutilise E1/E2/E5.

## 5. Questions ouvertes (à regarder ensemble)

1. **Défaut cache-tokens** : passer `countCacheTokens` à `false` par défaut (recommandé) change
   le comportement actuel du plugin — valider.
2. **Signature du tool `compress`** : migration `{start,end}` → sélection automatique — garder
   une période de compatibilité ou bascule directe ?
3. **Purge « essai entier »** : accepter de perdre l'output d'erreur (garder seulement un
   extrait) ? Impact sur le débogage.
4. **Réversibilité E3** : sidecar en mémoire (volatile) suffisant, ou faut-il persister sur
   disque (rapproche de E4) ?
5. **Règle d'arrêt** : version texte interne vs embeddings locaux (`🔌?`) — quelle précision viser ?
6. **Périmètre E6** : sortir le « Constraint Pinning » de E1/E5 et le traiter dans E6 ?

## 6. Réserves

- Les plans s'appuient sur du code externe **vérifié au fetch** (fonctions/structures citées).
  Les sources marquées « non revérifiées » dans `E*-resultat.md` n'ont pas servi de base aux plans.
- Aucun test n'a été exécuté (plans seulement) ; les commandes de validation restent
  `bun test` / `vitest` selon le fichier.
