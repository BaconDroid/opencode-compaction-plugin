# Prompt — Analyse des composants externes (🔌) par ensemble (E1–E6)

> Prompt réutilisable. À exécuter dans une session fraîche, à la racine du repo
> `opencode-live-compaction`. Objectif : recenser, pour **chaque** ensemble E1–E6,
> les composants externes (`🔌`) **non implémentés**, et déterminer s'ils peuvent
> être rendus **optionnels / configurables** — activables à la demande, jamais
> obligatoires.

## Rôle

Ingénieur logiciel senior sur le plugin OpenCode `opencode-live-compaction`
(TypeScript, chargé par Bun, hooks `experimental.*`). Tu produis une **analyse**
(recherche + conception d'options), **pas du code**.

## Entrées

- Recherche/plans : `docs/ensembles/E1-resultat.md` … `E6-resultat.md` (si présents),
  `E1-plan.md` … `E6-plan.md`, `docs/ensembles/SYNTHESE.md`,
  `docs/context-compaction-research.md` (tableau §4 et statuts `🔌`/`🔌?`).
- Code local : `src/core/*.ts`, `src/config/config.ts`, `src/opencode/tools.ts`,
  `src/index.ts`.
- Cadres (ne pas modifier) : `docs/ensembles/*.md`.

## Objectif

Pour **CHAQUE** ensemble E1–E6 :

1. Lister les items marqués `🔌` (composant externe requis) et `🔌?` (dépendance
   optionnelle, version interne dégradée possible).
2. Pour chacun, décrire **ce qu'il exige** : store/vecteurs, juge LLM, modèle de
   scoring/perplexité, embeddings locaux, service externe, entraînement…
3. Indiquer le **statut interne** : déjà couvert (version déterministe), partiel, ou absent.
4. Évaluer la faisabilité d'une **intégration optionnelle** : activable par config,
   **désactivée par défaut**, **sans dépendance obligatoire** (le plugin doit
   continuer à fonctionner à l'identique sans le composant).
5. Proposer : **clé(s) de config**, **contrat d'interface (adapter)**, **mode dégradé
   si absent**, **effort/risque**.

## Règles

- **Aucun code de production modifié** ; analyse/plan uniquement.
- **Rien d'obligatoire** : toute intégration externe est **opt-in, off par défaut**.
  Aucune nouvelle dépendance runtime requise par défaut.
- **Ne jamais inventer** une API, une URL ou un ID : vérifier au fetch, sinon
  « ⚠️ inaccessible » + raison.
- Séparer ce qui est **fait et vérifié** de ce qui est **supposé**.

## Méthode (par ensemble, E1 → E6)

1. Lire `E<n>-resultat.md` + la section E<n> du doc consolidé.
2. Extraire les lignes `🔌` / `🔌?` et leur justification.
3. Classer chaque item :
   - **(a) déjà couvert en interne** (version déterministe) → le noter, ne rien ajouter ;
   - **(b) interne dégradé possible** → décrire la version déterministe restante ;
   - **(c) réellement externe** → concevoir l'option.
4. Pour (b)/(c) : proposer la clé de config, le contrat d'interface, et le
   comportement **sans** le composant.
5. Vérifier la **non-régression** : le plugin sans composant doit rester identique.

## Sortie attendue

Un fichier `docs/ensembles/EXTERNAL-OPTIONS.md` contenant :

- **Un tableau par ensemble** :
  `🔌 item | exigence externe | version interne (statut) | intégration optionnelle | clés de config | effort/risque`.
- **Une section transversale « adaptateurs optionnels »** : comment rendre un
  composant externe **branchable sans le bundler** — ex. :
  - embeddings/vecteurs : interface `Embedder`/`VectorIndex` + config d'un endpoint
    HTTP/MCP ou d'un provider local ;
  - juge LLM : interface `Judge` + config d'un modèle/serveur ;
  - scoring perplexité : interface `Scorer` + provider ;
  - store/graphe : interface `MemoryStore` + endpoint.
  Décrire la **résolution** (si non configuré → fonctionnalité désactivée, log),
  le **fail-open**, et la **gestion d'erreur**.
- **Une recommandation** : quoi rendre configurable en priorité, quoi laisser hors
  périmètre, et pourquoi.

## Contraintes de vérité

- N'invente jamais un résultat, un chemin ou une API : **exécute/`webfetch` et cite**
  la source.
- Distingue explicitement **fait+vérifié**, **supposé**, **inaccessible**.
- À la fin, ne propose pas de code : attends la décision de l'opérateur.
