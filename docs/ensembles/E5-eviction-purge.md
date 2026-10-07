# Ensemble E5 — Éviction, purge & anti-contamination

> Lot d'analyse **isolé**. Objectif : décider **quoi retirer** du contexte (erreurs,
> brouillons, distracteurs, bruit) et **comment** le faire, dans les limites de
> `opencode-live-compaction` (sans composant externe requis).

---

## 0. Cadre

- **Thème** : purge des erreurs/brouillons erronés, filtrage des distracteurs proches,
  gate d'écriture/qualité, éviction structurée (épisodes), règle d'arrêt par borne d'erreur,
  séparation observations vs historique, résumés typés.
- **Cible plugin** : `src/strategies.ts` (`applyPurgeErrors`, `applyDedup`),
  `src/config.ts` (`purgeErrors.turns`, `dedup`), `src/index.ts` (transform).
- **Externe** : — (aucune dépendance requise ; un évaluateur juge serait 🔌?).
- **À NE PAS inclure** : déclenchement (E1), contenu du résumé (E2), mécanique de fold (E3),
  store/mémoire externe (E7/E8).

---

## 1. Index seed (issu de l'analyse consolidée)

| Réf | ID/URL | Type | Statut | Pertinence (contexte citant) |
|---|---|---|---|---|
| Contextual Drag | arXiv:2602.04288 | arXiv | 🟢 déjà listé | « conditioning on incorrect drafts biases later reasoning » → évincer les brouillons erronés |
| How Memory Management Impacts | arXiv:2505.16067 | arXiv | 🟢 déjà listé | « gate writes through a trajectory evaluator … periodical deletion » |
| Lost in the Noise | arXiv:2601.07226 | arXiv | 🟡 déjà listé | « hard negatives are the worst offenders » → prioriser leur éviction |
| Survey Memory Mechanism | arXiv:2404.13501 | arXiv | 🟡 déjà listé | opération **forget** (management) |
| Rethinking Memory | arXiv:2505.00675 | arXiv | 🟡 déjà listé | opération **Forgetting** |
| ACON | arXiv:2510.00615 | arXiv | 🟡 déjà listé | distinguer observations vs historique ; guidelines |
| Free() | arXiv:2602.08030 | arXiv | ⚪ (LoRA) | suppression de spans (cœur entraîné) |

**Backlog E5** : #5 brancher `purgeErrors.turns` · #9 éviction structurée ·
#14 ACON · #15 règle d'arrêt par borne d'erreur · #20 éviction des brouillons erronés ·
#23 gate d'écriture + suppression utilité · #30 résumés typés.

---

## 2. Liens non-arXiv à explorer

| Réf | URL | Type | À quoi ça sert ici |
|---|---|---|---|
| OpenHands — Context condensation | https://www.all-hands.dev/blog/ (titre « OpenHands context condensation… ») | blog | stratégie de condensation/éviction en production (⚠️ URL partiellement encodée dans la réf. source — vérifier) |
| Microsoft ACON | https://github.com/microsoft/acon | GitHub | guidelines de compression par analyse d'échecs |
| Microsoft Memento | https://github.com/microsoft/memento | GitHub | gestion de contexte (comparer) |
| Context Rot (Chroma) | https://trychroma.com/research/context-rot | étude | pourquoi le contenu obsolète nuit → motif d'éviction |
| SelfCompact (code) | https://github.com/tianjianl/selfcompact | GitHub | suppression mid-derivation (anti) |
| OpenCode — purge/dedup existants | `src/strategies.ts`, `src/config.ts` (local) | code local | API réelle : `purgeErrors.turns`, dedup |

> Vérifier chaque URL au fetch ; ne pas présumer d'un contenu.

---

## 3. Critères durcis (spécifiques E5)

1. **Gate de périmètre** : le lien doit porter sur **retirer/éviter du contenu nuisible**
   (erreurs, brouillons, distracteurs, bruit), pas sur le déclenchement ni le résumé.
2. **Fit implémentable** : le mécanisme doit pouvoir modifier `applyPurgeErrors` /
   `applyDedup` ou la politique de sélection du transform, **sans entraînement** et **sans
   store externe** (un évaluateur LLM serait 🔌?).
3. **Pas de dépendance à un signal externe** : la détection (erreur, redondance, distraction)
   doit reposer sur des données présentes (état d'outil, similarité textuelle, rôle) ;
   sinon 🔌.
4. En cas de doute → **écarter**.

---

## 4. Prompt approfondi (à exécuter tel quel, un E à la fois)

```text
# Mission
Produis un INDEX hiérarchique des travaux et implémentations portant EXACTEMENT sur
« l'éviction, la purge et l'anti-contamination du contexte » et directement implémentables
dans le plugin OpenCode `opencode-live-compaction` (TypeScript, sans entraînement, sans
composant externe requis). On veut savoir QUOI retirer et COMMENT le détecter.

# Périmètre (durci, tous types de liens)
- Sources autorisées : TOUT type — arXiv, GitHub (repos/articles/PR/issues/discussions),
  docs produit/officielles, blogs, specs, READMEs, études.
- Partir de l'index seed et de la liste non-arXiv de ce fichier, puis descendre.
- N'inclure un lien QUE s'il satisfait LES DEUX conditions :
  (a) GATE DE PÉRIMÈTRE — le contexte citant ET le titre/sous-titres portent sur le RETRAIT/
      l'ÉVICTION de contenu nuisible (erreurs, brouillons erronés, distracteurs, bruit,
      redondance). Pas sur le déclenchement (E1), le template du résumé (E2), le fold (E3),
      le store externe (E7/E8).
  (b) TEST D'IMPLÉMENTABILITÉ-IMMÉDIATE — la détection repose sur des données présentes
      (état d'outil, rôle, similarité textuelle, comptage de tours) et se branche dans
      `src/strategies.ts` / `src/config.ts` SANS entraînement ni store externe. Un juge LLM
      → flag 🔌? ; un classifieur entraîné → ⚪.
- Interdits : RL/fine-tuning, KV-cache, architecture/SSM, latent/gist/distillation,
  multimodal, benchmarks sans mécanisme d'éviction transposable.

# Anti-doublon
Le contenu de l'index seed ci-dessus et du doc `docs/context-compaction-research.md` (§4 E5)
n'est PAS nouveau : le marquer « déjà listé » et ne développer QUE ce qui est nouveau,
plus précis, ou une implémentation concrète (règle, seuil, API).

# Traversée
1. Fetch chaque page ; titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant (1–2 phrases).
3. Applique le gate de périmètre, puis le test d'implémentabilité.
4. Visited set (dédup) ; journalise le motif d'exclusion.
5. Profondeur max 4 ; budget ~40 pages. À la limite : POINT DE CONTRÔLE puis demande.

# Classement
🟢 direct — modifie directement `applyPurgeErrors` / `applyDedup` / la politique du transform
🟡 indirect — inspiration, à expliciter
⚪ écarté — hors périmètre OU non portable (contexte citant requis)
🔌 — nécessite un composant externe

# Sortie : INDEX (Markdown) pour CET ensemble
- Arborescent : Titre + sous-titres ; URL + ID vérifié ; statut ; raison = citation citante.
- Tableau plat : Titre | URL | Type | Niveau | Statut | Cible d'éviction | Fit E5.
- Pour chaque 🟢 : « comment ça améliore le plugin » + fichier/hook cible.
- Pour chaque 🟡 : « ce qu'on pourrait en tirer ».
- Sections « Inaccessible ⚠️ » et « Déjà listé ».

# Contraintes
- N'invente jamais titre/auteur/ID/URL ; non récupérable → « ⚠️ inaccessible » + raison.
- Cite le contexte. Sépare LU de DÉDUIT. NE MODIFIE AUCUN CODE.
```

---

## 5. Template de sortie (INDEX E5)

```
## INDEX E5 — Éviction, purge & anti-contamination
### Arborescence
- <Titre> — <URL + ID> — <statut> — « <citation citante> »
  - <enfant> …

### Table
| Titre | URL/ID | Type | Niveau | Statut | Cible d'éviction | Fit E5 |
|---|---|---|---|---|---|---|

### 🟢 → plugin
- <Réf> → <fichier/hook> : <phrase>

### 🟡 → à tirer
- <Réf> : <phrase>

### ⚪ écartés / ⚠️ inaccessibles / Déjà listé
- …
```

**Fichier de sortie** : section « Résultat » en fin de ce fichier (ou `E5-resultat.md`).
