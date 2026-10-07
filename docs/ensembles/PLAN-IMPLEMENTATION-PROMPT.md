# Prompt — Plan d'implémentation par ensemble (E1, E2, E3, E5)

> Prompt réutilisable. À exécuter dans une session fraîche, à la racine du repo
> `opencode-live-compaction`. Il transforme les recherches `E*-resultat.md` en **plans
> d'implémentation** concrets, un ensemble à la fois, **sans écrire de code de production**.

---

## Rôle

Tu es ingénieur logiciel senior sur le plugin OpenCode `opencode-live-compaction`
(TypeScript, chargé par Bun, hooks `experimental.*`). Tu transformes une recherche
documentaire en plans d'implémentation directement exploitables.

## Entrées à lire

- Recherches ciblées : `docs/ensembles/E1-resultat.md`, `E2-resultat.md`, `E3-resultat.md`,
  `E5-resultat.md`.
- Doc consolidé : `docs/context-compaction-research.md`.
- Cadres d'ensemble : `docs/ensembles/E1-declenchement-rythme.md`, `E2-resume-continuite.md`,
  `E3-folding-multi-echelle.md`, `E5-eviction-purge.md`.
- Code local : `src/index.ts`, `src/compress.ts`, `src/strategies.ts`, `src/config.ts`,
  `src/prompt.ts`, `src/previous-summary.ts`, `src/todo-preserver.ts`,
  `src/preemptive-compaction.ts`, `src/degradation-monitor.ts`, `src/files-touched.ts`.
- Code/exemples externes : les URLs citées dans chaque `E*-resultat.md` (repos GitHub,
  fichiers `.ts`/`.py`, templates, notebooks, docs produit).

## Boucle — pour CHAQUE ensemble, un à un, dans l'ordre E1 → E2 → E3 → E5

1. **Lire la recherche** : `E<n>-resultat.md` + `docs/context-compaction-research.md` (§4 E<n>)
   + le cadre `E<n>-*.md`.
2. **Lire le code local** concerné et tracer le chemin d'exécution exact (hooks, fonctions,
   lignes) que le plan modifiera.
3. **Inspecter le code/exemples externes** cités : `webfetch` des sources réelles (fichiers
   de repo, `raw.githubusercontent.com`, jsDelivr, HTML arXiv). Repère les **patterns
   réutilisables / réimplémentables** avec noms de fonctions, structures de données, seuils,
   et citations verbatim.
4. **Trier** : réutilisable tel quel (sans entraînement, sans composant externe) vs `🔌`
   (composant externe / modèle entraîné) — ne retenir par défaut que le premier.
5. **Écrire le plan** dans `docs/ensembles/E<n>-plan.md`.

## Contenu imposé de chaque plan

- **Objectif** et valeur pour le plugin (1–3 phrases).
- **Sources inspectées** : liens exacts + ce qui est réutilisable (citation courte).
- **Mapping** vers les fichiers/hooks du plugin (chemins + fonctions/lignes).
- **Étapes ordonnées** d'implémentation (avec dépendances entre étapes).
- **Esquisse technique** : signatures, structures de config, pseudo-code / diff décrit
  (pas de code final).
- **Tests** : unitaires + intégration (frameworks existants : `bun test` / vitest) et
  **critères d'acceptation** mesurables.
- **Risques / régressions** connus et flags `🔌`.
- **Découpage en PRs** minimales et ordonnées.

## Contraintes

- **Ne modifie AUCUN code de production** : tu n'écris que les fichiers de plan.
- **N'invente jamais** un chemin, une API, un ID ou un lien : vérifie au fetch ; si
  irrécupérable → « ⚠️ inaccessible ».
- **Continue sans poser de question** pour tous les ensembles du groupe.
- À la fin : écrire `docs/ensembles/PLAN-SYNTHESE.md` (comment ça s'est passé, recoupements
  entre ensembles, dépendances, questions ouvertes pour la suite).
