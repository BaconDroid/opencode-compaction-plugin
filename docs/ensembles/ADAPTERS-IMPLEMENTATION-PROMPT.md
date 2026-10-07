# Prompt — Implémentation des adapters optionnels (composants externes 🔌)

> Prompt réutilisable. À exécuter dans une session fraîche, à la racine du repo
> `opencode-live-compaction`. Il implémente les **adapters optionnels** décrits dans
> `docs/ensembles/EXTERNAL-OPTIONS.md`, **un à la fois**, en opt-in (off par défaut,
> fallback déterministe, aucune dépendance obligatoire).

## Rôle

Ingénieur logiciel senior sur le plugin OpenCode `opencode-live-compaction`
(TypeScript, chargé par Bun, hooks `experimental.*`). Tu implémentes des adapters
optionnels, **un adapter à la fois**, avec PR + validation.

## Entrées

- `docs/ensembles/EXTERNAL-OPTIONS.md` — design des adapters, priorités, clés de config.
- `docs/ensembles/EXTERNAL-OPTIONS-PROMPT.md`, `docs/context-compaction-research.md`.
- Code : `src/core/*.ts`, `src/config/config.ts`, `src/opencode/tools.ts`, `src/index.ts`.
- Cadres (ne pas modifier) : `docs/ensembles/*.md`.

## Préconditions

- Se placer sur une branche dédiée (ex. `feat/adapters`), **pas** `master`.
- `bun install`.

## Objectif

Implémenter les adapters **un à un**, dans l'ordre de priorité de `EXTERNAL-OPTIONS.md` :

1. **`Embedder` / `VectorIndex`** — retrieval sémantique (E4 en premier, puis E2/E3).
2. **`Judge`** — validation sémantique (E6 en premier, puis E1/E5).
3. **`Scorer`** — estimateur de résiduel/perplexité (E5/E9).

Chaque adapter : **opt-in** (off par défaut), **fallback déterministe** si absent ou en
erreur, **aucune dépendance runtime ajoutée** (provider `http` / `command` / `mcp`),
avec tests et doc.

## Boucle — pour CHAQUE adapter, un à un

1. Charger la section correspondante de `EXTERNAL-OPTIONS.md` et la convertir en task list.
2. Relire le code cible ; adapter au code réel, **ne pas inventer**.
3. Implémenter par petits incréments (interface → config → résolution → intégration → tests) ;
   après **chaque** incrément : validation ciblée.
4. Fin d'adapter : suite complète + typecheck + coverage.
5. Ne passer à l'adapter suivant que si l'adapter courant est **vert** ; sinon STOP + rapport.

## Commandes de validation

```bash
bun run typecheck        # tsc --noEmit (strict)
bun run test             # bun test
bun run test:coverage    # seuils 70% (par fichier)
# ciblé :
bun test test/<file>.test.ts
```

## Règles de conception (impératives)

- **Rien d'obligatoire** : sans config, comportement **identique** à aujourd'hui (fallback interne).
- **Fail-open** : toute erreur/timeout d'adapter est loggée et retombe sur la version
  déterministe ; **jamais** de rupture du transform/compaction.
- **Aucune dépendance ajoutée** par défaut : les adapters parlent à un endpoint/commande
  existants (HTTP/MCP/command) ; pas de SDK lourd ni de modèle bundlé.
- **Interfaces pures** dans `src/core/adapters.ts` (types) ; implémentations providers
  dans `src/opencode/` (frontière SDK).
- **Sécurité** : jamais de secret en clair, loggé ou commité ; URL/commande fournies par l'utilisateur.
- Plus petit changement correct ; réutiliser l'existant ; préserver les tests ;
  **ne jamais** affaiblir/sauter une assertion pour verdir.
- Un adapter à la fois ; ne pas anticiper.

## STOP + rapport (ne pas forcer)

- Un test échoue sans progression ; une décision de conception non tranchée ;
  le composant requis n'est pas un simple endpoint/commande (runtime, entraînement) ;
  limite de contexte.

## Sortie attendue

- Par adapter : incréments réalisés, fichiers touchés, commandes + **résultats réels**,
  écarts au design, risques.
- Final : rapport transversal (ce qui est vert, ce qui reste, prochaine étape).

## Contraintes de vérité

- N'invente jamais un résultat de test, un chemin ou une API : exécute et cite la sortie.
- Sépare **fait + vérifié** de **supposé**.
