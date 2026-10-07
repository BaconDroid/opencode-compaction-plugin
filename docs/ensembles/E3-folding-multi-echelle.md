# Ensemble E3 — Folding & compression multi-échelle

> Lot d'analyse **isolé**. Objectif : décider **comment** découper et compresser le
> contexte en blocs multi-échelles (folding), dans les limites de
> `opencode-live-compaction` (sans composant externe requis).

---

## 0. Cadre

- **Thème** : découpage en blocs/segments, fusion multi-niveaux (granular vs deep),
  compression de pas de raisonnement, directive de fold `{range, summary}`, résumés typés,
  réversibilité `expand` minimale liée au fold.
- **Cible plugin** : `src/compress.ts` (tool `compress`, args `start/end/summary`,
  `<compressed-block>`), `src/index.ts` (`experimental.chat.messages.transform`).
- **Externe** : — (aucune dépendance requise).
- **À NE PAS inclure** : déclenchement (E1), contenu/template du résumé (E2), purge/éviction
  (E5), store/retrieval externe (E7/E8).

---

## 1. Index seed (issu de l'analyse consolidée)

| Réf | ID/URL | Type | Statut | Pertinence (contexte citant) |
|---|---|---|---|---|
| AgentFold | arXiv:2510.24699 | arXiv | 🟢 déjà listé | « folding operation at multiple scales … granular condensation / deep consolidation » |
| LightThinker++ | arXiv:2604.03679 | arXiv | 🟢 déjà listé | « dual-form entities (R/Z) … commit/expand/fold » |
| SelfCompact | arXiv:2606.23525 | arXiv | 🟢 déjà listé | summarize-and-replace sur unités de raisonnement closes |
| Context-Folding | arXiv:2510.11967 | arXiv | 🟡 déjà listé | « branch into a sub-trajectory … fold it on completion » (cœur RL) |
| FoldAct | arXiv:2512.22733 | arXiv | 🟡 déjà listé | « typed summaries : `<think_summary>` vs `<information_summary>` » |
| Accordion-Thinking | arXiv:2602.03249 | arXiv | 🟡 déjà listé | « alternate detailed steps with compact `<step>` summaries … fold » |
| CWL (structured eviction) | arXiv:2606.11213 | arXiv | 🟡 déjà listé | épisodes typés + dépendances |

**Backlog E3** : #10 fiabiliser le tool `compress` · #19 échelle fold granular/deep ·
#24 `commit/expand/fold` + expand réversible · #9 éviction structurée.

---

## 2. Liens non-arXiv à explorer

| Réf | URL | Type | À quoi ça sert ici |
|---|---|---|---|
| SelfCompact (code) | https://github.com/tianjianl/selfcompact | GitHub | implémentation du summarize-and-replace |
| LangChain — Autonomous context compression | https://www.langchain.com/blog/autonomous-context-compression | blog | tool de compression piloté par le modèle |
| Cursor — Self-summarization | https://cursor.com/blog/self-summarization | blog | stratégie de compression de segments |
| Microsoft Memento | https://github.com/microsoft/memento | GitHub | gestion de contexte apprise (comparer à l'approche prompt/tool) |
| OpenCode — tool `compress` + transform | `src/compress.ts`, `src/index.ts` (local) | code local | API réelle : indices `start/end`, `<compressed-block>` |
| Claude Code — Automatic context compaction (cookbook) | https://platform.claude.com/cookbook/tool-use-automatic-context-compaction | docs | granularité du bloc compacté |

> Vérifier chaque URL au fetch ; ne pas présumer d'un contenu.

---

## 3. Critères durcis (spécifiques E3)

1. **Gate de périmètre** : le lien doit porter sur **la découpe/la fusion de blocs de
   contexte** (folding, niveaux, granularité, résumés typés), pas sur le déclenchement ni la
   purge.
2. **Fit implémentable** : le mécanisme doit pouvoir s'exprimer comme une **directive**
   (`{range, summary, scale}`) traitée par `src/compress.ts` / le transform, **sans
   entraînement** (une politique apprise seule → ⚪ ou 🟡).
3. **Indices fiables** : le mécanisme ne doit pas dépendre d'indices de messages non
   observables (problème connu #10) ; privilégier les blocs ancrés sur des messages/outils
   identifiables.
4. En cas de doute → **écarter**.

---

## 4. Prompt approfondi (à exécuter tel quel, un E à la fois)

```text
# Mission
Produis un INDEX hiérarchique des travaux et implémentations portant EXACTEMENT sur
« le folding / la compression de contexte multi-échelle en blocs » et directement
implémentables dans le plugin OpenCode `opencode-live-compaction` (TypeScript, sans
entraînement, sans composant externe requis). On veut savoir COMMENT découper et fusionner.

# Périmètre (durci, tous types de liens)
- Sources autorisées : TOUT type — arXiv, GitHub (repos/articles/PR/issues), docs
  produit/officielles, blogs, specs, READMEs, prompts d'implémentation publiés.
- Partir de l'index seed et de la liste non-arXiv de ce fichier, puis descendre.
- N'inclure un lien QUE s'il satisfait LES DEUX conditions :
  (a) GATE DE PÉRIMÈTRE — le contexte citant ET le titre/sous-titres portent sur la DÉCOUPE/
      FUSION de blocs de contexte (folding, multi-échelle, granularité, résumés typés).
      Pas sur le déclenchement (E1), le template du résumé (E2), la purge (E5), le store
      externe (E7/E8).
  (b) TEST D'IMPLÉMENTABILITÉ-IMMÉDIATE — le mécanisme s'exprime au niveau du harness
      (directive `{range, summary, scale}` / transform) SANS entraînement ni service externe.
      Une politique nécessitant RL/fine-tuning → ⚪ (ou 🟡 si l'idée de structure est
      réutilisable). Un index/embeddings → flag 🔌.
- Interdits : RL/fine-tuning, KV-cache, architecture/SSM, latent/gist/distillation,
  multimodal, benchmarks sans mécanisme de découpe transposable.

# Anti-doublon
Le contenu de l'index seed ci-dessus et du doc `docs/context-compaction-research.md` (§4 E3)
n'est PAS nouveau : le marquer « déjà listé » et ne développer QUE ce qui est nouveau,
plus précis, ou une implémentation concrète (schéma de directive, prompt, code).

# Traversée
1. Fetch chaque page ; titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant (1–2 phrases).
3. Applique le gate de périmètre, puis le test d'implémentabilité.
4. Visited set (dédup) ; journalise le motif d'exclusion.
5. Profondeur max 4 ; budget ~40 pages. À la limite : POINT DE CONTRÔLE puis demande.

# Classement
🟢 direct — s'exprime comme directive/transform dans `compress.ts`/`index.ts`
🟡 indirect — inspiration (structure réutilisable, politique apprise)
⚪ écarté — hors périmètre OU non portable (contexte citant requis)
🔌 — nécessite un composant externe

# Sortie : INDEX (Markdown) pour CET ensemble
- Arborescent : Titre + sous-titres ; URL + ID vérifié ; statut ; raison = citation citante.
- Tableau plat : Titre | URL | Type | Niveau | Statut | Échelle/unité de fold | Fit E3.
- Pour chaque 🟢 : « comment ça améliore le plugin » + fichier/hook cible.
- Pour chaque 🟡 : « ce qu'on pourrait en tirer ».
- Sections « Inaccessible ⚠️ » et « Déjà listé ».

# Contraintes
- N'invente jamais titre/auteur/ID/URL ; non récupérable → « ⚠️ inaccessible » + raison.
- Cite le contexte. Sépare LU de DÉDUIT. NE MODIFIE AUCUN CODE.
```

---

## 5. Template de sortie (INDEX E3)

```
## INDEX E3 — Folding multi-échelle
### Arborescence
- <Titre> — <URL + ID> — <statut> — « <citation citante> »
  - <enfant> …

### Table
| Titre | URL/ID | Type | Niveau | Statut | Échelle | Fit E3 |
|---|---|---|---|---|---|---|

### 🟢 → plugin
- <Réf> → <fichier/hook> : <phrase>

### 🟡 → à tirer
- <Réf> : <phrase>

### ⚪ écartés / ⚠️ inaccessibles / Déjà listé
- …
```

**Fichier de sortie** : section « Résultat » en fin de ce fichier (ou `E3-resultat.md`).
