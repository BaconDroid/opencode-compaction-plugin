# Ensemble E2 — Résumé structuré & continuité d'état

> Lot d'analyse **isolé**. Objectif : décider **quoi** conserver dans le résumé de
> compaction et comment préserver l'état/la continuité de tâche, dans les limites de
> `opencode-live-compaction` (sans composant externe requis).

---

## 0. Cadre

- **Thème** : contenu du résumé (facettes d'état, provenance), rapport évolutif, résumé
  glissant (rolling summary), brief/notes de continuité, sections du template 11 sections.
- **Cible plugin** : `src/prompt.ts` (11 sections), `src/previous-summary.ts` (résumé
  glissant `<previous-summary>`), `src/todo-preserver.ts` (état de tâche), `src/index.ts`
  (`experimental.session.compacting`).
- **Externe** : — (aucune dépendance requise).
- **À NE PAS inclure** : déclenchement (E1), mécanique de fold/échelle (E3), purge (E5),
  store/mémoire externe (E7/E8).

---

## 1. Index seed (issu de l'analyse consolidée)

| Réf | ID/URL | Type | Statut | Pertinence (contexte citant) |
|---|---|---|---|---|
| RE-TRAC | arXiv:2602.02486 | arXiv | 🟢 déjà listé | « structured state representation summarizing evidence, uncertainties, failures, and future plans » |
| IterResearch | arXiv:2511.07327 | arXiv | 🟢 déjà listé | « rebuilds the workspace each round … the report is the durable compressed memory » |
| WebResearcher | arXiv:2509.13309 | arXiv | 🟡 déjà listé | « each round keeps only question + evolving synthesized report + last tool response » |
| COMPASS | arXiv:2510.08790 | arXiv | 🟡 déjà listé | « Context Manager synthesizes concise, stage-relevant briefs from persistent structured notes » |
| Survey Context Engineering | arXiv:2507.13334 | arXiv | 🟡 déjà listé | vocabulaire des opérations (consolidation, reflection, summarization…) |
| Rolling summary (LangMem / LangChain) | docs.langchain.com… / langchain-ai.github.io/langmem… | docs | 🟢 déjà listé | `RunningSummary{summary, summarizedIds, lastId}` |

**Backlog E2** : #3 rolling summary · #21 facettes d'état + provenance · #18 arbre récursif ·
#25 arbre de résumés navigable · #34 rapport évolutif reconstruit.

---

## 2. Liens non-arXiv à explorer

| Réf | URL | Type | À quoi ça sert ici |
|---|---|---|---|
| LangChain — Short-term memory | https://docs.langchain.com/oss/python/langchain/short-term-memory | docs | pattern « rolling summary + fenêtre récente » |
| LangMem — SummarizationNode (short-term) | https://langchain-ai.github.io/langmem/reference/short_term/ | docs | API `RunningSummary` concrète |
| LangChain — Autonomous context compression | https://www.langchain.com/blog/autonomous-context-compression | blog | format de résumé piloté par outil |
| OpenHands — Context condensation | https://www.all-hands.dev/blog/ (titre « OpenHands context condensation… ») | blog | spécification de condensation (⚠️ URL partiellement encodée dans la réf. source — vérifier) |
| SelfCompact (annexes : prompts de résumé) | https://github.com/tianjianl/selfcompact | GitHub | prompts de summarizer réels (math/search) |
| OpenCode — extraction `<previous-summary>` | `src/previous-summary.ts` (local) | code local | API réelle de continuité inter-compactions |

> Vérifier chaque URL au fetch ; ne pas présumer d'un contenu.

---

## 3. Critères durcis (spécifiques E2)

1. **Gate de périmètre** : le lien doit porter sur **le contenu/la structure du résumé et
   l'état de tâche**, pas sur le déclenchement, le stockage externe, ni l'éviction.
2. **Fit implémentable** : le mécanisme doit pouvoir modifier les sections de
   `buildCompactionPrompt` (`src/prompt.ts`) ou l'extraction `<previous-summary>`
   (`src/previous-summary.ts`) ou le snapshot de tâche (`src/todo-preserver.ts`), **sans**
   store externe ni embeddings.
3. **Fidélité d'état** : le mécanisme doit améliorer la conservation des faits/contraintes/
   position exacte d'arrêt ; un format de résumé nécessitant un schéma externe → écarter.
4. En cas de doute → **écarter**.

---

## 4. Prompt approfondi (à exécuter tel quel, un E à la fois)

```text
# Mission
Produis un INDEX hiérarchique des travaux et implémentations portant EXACTEMENT sur
« le contenu et la structure du résumé de compaction et la continuité d'état de tâche »
et directement implémentables dans le plugin OpenCode `opencode-live-compaction`
(TypeScript, sans entraînement, sans composant externe requis). On veut savoir QUOI garder
et COMMENT représenter l'état.

# Périmètre (durci, tous types de liens)
- Sources autorisées : TOUT type — arXiv, GitHub (repos/articles/PR/issues), docs
  produit/officielles, blogs, specs, READMEs, prompts d'implémentation publiés.
- Partir de l'index seed et de la liste non-arXiv de ce fichier, puis descendre.
- N'inclure un lien QUE s'il satisfait LES DEUX conditions :
  (a) GATE DE PÉRIMÈTRE — le contexte citant ET le titre/sous-titres portent sur le CONTENU/
      la STRUCTURE du résumé et l'état/continuité de tâche. Pas sur le déclenchement (E1),
      le fold multi-échelle (E3), la purge (E5), le store/mémoire externe (E7/E8).
  (b) TEST D'IMPLÉMENTABILITÉ-IMMÉDIATE — le format/mécanisme est implémentable dans
      `src/prompt.ts` / `src/previous-summary.ts` / `src/todo-preserver.ts` SANS entraînement
      ni store externe. Une facette nécessitant des embeddings/un service → flag 🔌 et ne
      l'inclure que si le bénéfice justifie la dépendance.
- Interdits : RL/fine-tuning, KV-cache, architecture/SSM, latent/gist/distillation,
  multimodal, benchmarks sans format transposable.

# Anti-doublon
Le contenu de l'index seed ci-dessus et du doc `docs/context-compaction-research.md` (§4 E2)
n'est PAS nouveau : le marquer « déjà listé » et ne développer QUE ce qui est nouveau,
plus précis, ou une implémentation concrète (schéma, prompt, API).

# Traversée
1. Fetch chaque page ; titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant (1–2 phrases).
3. Applique le gate de périmètre, puis le test d'implémentabilité.
4. Visited set (dédup) ; journalise le motif d'exclusion.
5. Profondeur max 4 ; budget ~40 pages. À la limite : POINT DE CONTRÔLE puis
   me demander s'il faut continuer.

# Classement
🟢 direct — modifie directement un fichier/hook du plugin (sections de prompt, extraction
            `<previous-summary>`, snapshot de tâche)
🟡 indirect — inspiration, à expliciter
⚪ écarté — hors périmètre OU non portable (contexte citant requis)
🔌 — nécessite un composant externe (signalé séparément)

# Sortie : INDEX (Markdown) pour CET ensemble
- Arborescent : Titre + sous-titres ; URL + ID vérifié ; statut ; raison = citation citante.
- Tableau plat : Titre | URL | Type | Niveau | Statut | Facette d'état | Fit E2.
- Pour chaque 🟢 : « comment ça améliore le plugin » + fichier/hook cible.
- Pour chaque 🟡 : « ce qu'on pourrait en tirer ».
- Sections « Inaccessible ⚠️ » et « Déjà listé ».

# Contraintes
- N'invente jamais titre/auteur/ID/URL ; non récupérable → « ⚠️ inaccessible » + raison.
- Cite le contexte. Sépare LU de DÉDUIT. NE MODIFIE AUCUN CODE.
```

---

## 5. Template de sortie (INDEX E2)

```
## INDEX E2 — Résumé structuré & continuité
### Arborescence
- <Titre> — <URL + ID> — <statut> — « <citation citante> »
  - <enfant> …

### Table
| Titre | URL/ID | Type | Niveau | Statut | Facette | Fit E2 |
|---|---|---|---|---|---|---|

### 🟢 → plugin
- <Réf> → <fichier/hook> : <phrase>

### 🟡 → à tirer
- <Réf> : <phrase>

### ⚪ écartés / ⚠️ inaccessibles / Déjà listé
- …
```

**Fichier de sortie** : section « Résultat » en fin de ce fichier (ou `E2-resultat.md`).
