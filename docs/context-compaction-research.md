# opencode-live-compaction — Recherche Context Compaction & Backlog

> Notes de recherche compilées à partir de la série « Context Compaction in LLM Agents »
> (Nazmi, 4 parties) et de ses références, filtrées par pertinence pour le plugin
> `opencode-live-compaction` (fork `BaconDroid/opencode-live-compaction`).
>
> Date : 2026-10-06

---

## 1. Périmètre & méthode

- **Objectif** : identifier ce qui, dans la littérature référencée, est réellement
  implémentable dans un plugin OpenCode en TypeScript (sans entraînement de modèle).
- **Filtrage** : crawl large mais **ciblé sur la pertinence** — on ne suit une
  référence que si le contexte qui la cite indique un mécanisme portable.
- **Profondeur** : articles (niveau 0) → papiers cités (niveau 1) → références des
  papiers les plus riches (niveau 2). Au-delà, le substrat devient spécifique
  (KV-cache, quantization, architecture) et non transposable.

### Statut de vérification
- ✅ **Lu directement** (texte complet ou abstract ouvert).
- 📄 **Via le résumé de l'article** uniquement (non ouvert individuellement).
- 🧩 **Cité dans une liste de références** d'un papier lu, non ouvert.

---

## 2. État actuel du plugin (baseline)

Hooks utilisés (`src/index.ts`) :
- `tool.execute.after` — tracking des fichiers + capture des appels `compress`.
- `experimental.session.compacting` — remplace le prompt par un template 11 sections.
- `experimental.chat.messages.transform` — compressions en attente, **trim** des
  sorties d'outils, **dedup**, **purge** des inputs en erreur.
- `command.execute.before` — `/compact`, `/compact:focus <directive>`.
- `experimental.compaction.autocontinue`, `event`, `dispose`, `config`.

Fichiers :
- `src/index.ts` (481 l.) — hooks, trim, turn protection, protected patterns.
- `src/prompt.ts` (88 l.) — template 11 sections (attend `<previous-summary>` mais
  **jamais injecté**).
- `src/compress.ts` (175 l.) — tool `compress` **index-based** (0-based, non fiable).
- `src/strategies.ts` (179 l.) — dedup + purge erreurs.
- `src/glob.ts` (115 l.) — matcher glob + chemins protégés.
- `src/files-touched.ts` (164 l.) — tracker d'opérations fichiers.
- `src/config.ts` (258 l.) — config + défauts.

### Faiblesses identifiées dans le code actuel
1. **Trim destructif et aveugle** : `output.slice(-limit)` garde uniquement la fin
   (`index.ts:135-147`), par type d'outil, sans égard à la requête. Irréversible.
2. **`<previous-summary>` jamais injecté** : pas de résumé glissant entre compactions
   (`prompt.ts:27` vs `index.ts`).
3. **Aucune garantie de survie des contraintes** : section « Constraints » dans le
   prompt mais rien ne protège les règles de gouvernance de l'éviction.
4. **`purgeErrors.turns` inutilisé** : la config existe (`config.ts:46,178`), la purge
   est immédiate (`index.ts:377`, `strategies.ts:158`).
5. **Tool `compress` fragile** : le modèle doit deviner des indices de messages
   qu'il ne voit pas (`compress.ts:145-175`).
6. **Aucune rubric** pour décider *quand* compacter (SelfCompact : tool seul
   insuffisant).
7. **`focusDirectives` diffusé à toutes les sessions** au `/compact:focus`
   (`index.ts:401-403`).

---

## 3. Références collectées

### 3.1 Articles sources
| Réf | ID/URL | Statut |
|---|---|---|
| Part 1 — The Fundamentals | nazmi.tech/blog/context-compaction-llm-agents-fundamentals | ✅ |
| Part 2 — Learning to Compact | .../context-compaction-llm-agents-learning-to-compact | ✅ |
| Part 3 — Post-Hoc Compilation | .../context-compaction-llm-agents-post-hoc-compilation | ✅ |
| Part 4 — Theory and Safety | .../context-compaction-llm-agents-theory-and-safety | ✅ |
| Lerim (README) | github.com/nablo-io/lerim | ✅ |

### 3.2 Niveau 1 — papiers cités (ouverts)
| Réf | ID | Statut |
|---|---|---|
| Rate–Distortion survey (What to Keep, What to Forget) | arXiv 2607.08032 | ✅ (corps + Appendix A) |
| Governance Decay | arXiv 2606.22528 | ✅ (texte complet) |
| Self-Compact (SelfCompact) | arXiv 2606.23525 | ✅ |
| CompactionRL | arXiv 2607.05378 | ✅ |
| ACON | arXiv 2510.00615 | ✅ |
| Mem0 | arXiv 2504.19413 | ✅ |
| A-Mem | arXiv 2502.12110 | ✅ |
| DTCRS | aclanthology 2025.acl-long.536 | ✅ |
| Code semantic compression | aclanthology 2024.findings-acl.306 | ✅ |
| LangChain short-term memory docs | docs.langchain.com/oss/python/langchain/short-term-memory | ✅ |
| LangMem SummarizationNode | langchain-ai.github.io/langmem/reference/short_term/ | ✅ |

### 3.3 Niveau 2 — références des papiers (ouverts)
| Réf | ID | Statut |
|---|---|---|
| Slipstream (Trajectory-Grounded Compaction Validation) | arXiv 2605.08580 | ✅ |
| Beyond Compaction: Structured Context Eviction (CWL) | arXiv 2606.11213 | ✅ |
| Omission Constraints Decay (SRD) | arXiv 2604.20911 | ✅ |
| Ghost in the Context / ControlCapsule | arXiv 2605.12535 | ✅ |
| MemGPT | arXiv 2310.08560 | ✅ |
| RAPTOR | arXiv 2401.18059 | ✅ |
| Generative Agents | arXiv 2304.03442 | ✅ |
| MemoryBank (Ebbinghaus decay) | arXiv 2305.10250 | ✅ |

### 3.4 Niveau 1 — via résumé d'article (non ouverts)
| Réf | ID | Statut |
|---|---|---|
| LLM semantic compression | arXiv 2304.12512 | 📄 |
| LongLLMLingua | arXiv 2310.06839 | 📄 |
| Perplexity-based prompt compression | arXiv 2310.06201 | 📄 |
| Provence | arXiv 2501.16214 | 📄 |
| Recursive dialogue summarization | arXiv 2308.15022 | 📄 |
| llmlingua.com (impl.) | llmlingua.com/llmlingua.html | 📄 |

### 3.5 Niveau 2 — cités, non ouverts (contexte suffisant)
| Réf | Source citante | Statut |
|---|---|---|
| Spotlighting | Governance Decay | 🧩 |
| Constraint Decay in Backend Code Gen (`2605.06445`) | Governance Decay | 🧩 |
| Parallel Context Compaction (`2605.23296`) | Governance Decay | 🧩 |
| When Refusals Fail (`2512.02445`) | Governance Decay | 🧩 |
| Context Rot (Chroma, Hong et al. 2025) | Governance Decay | 🧩 |
| Lost in the Middle (Liu et al. 2024a) | Governance Decay | 🧩 |
| Quest, H2O, SnapKV, StreamingLLM, Ada-KV, PyramidKV, KIVI, Palu, MLA, CaM, RMT, Mamba, Titans, gisting, ICAE, xRAG, Cartridges, NSA, MoBA, ToMe, PagedAttention, InfiniGen… | Survey Appendix A | 🧩 |

> ⚠️ Le catalogue « non portable » (§6) provient de l'**Appendix A du survey**
> (table méthode-par-axe), pas d'une lecture individuelle.

---

## 4. Catalogue des mécanismes portables (mapping plugin)

| # | Mécanisme | Référence | Mapping |
|---|---|---|---|
| 1 | Constraint Pinning : buffer épinglé, réinjecté + intégrité après compaction | Governance Decay 2606.22528 | nouveau `src/pinned.ts`, hook compacting |
| 2 | ControlCapsule : provenance typée, budget de contrôle isolé, preflight, fail-closed | Ghost in the Context 2605.12535 | idem #1 |
| 3 | Omission constraints (prohibitions) décayent plus → priorité d'épinglage | SRD 2604.20911 | politique du buffer |
| 4 | Validation post-compaction (juge vs intent/facts/constraints, asynchrone) | Slipstream 2605.08580 | étape après résumé |
| 5 | Rolling summary `RunningSummary{summary, summarizedIds, lastId}` | LangMem docs + 2308.15022 | `src/summary-state.ts`, `<previous-summary>` |
| 6 | Éviction structurée : épisodes typés + dépendances, politique LLM-free, garde user turns + raisonnement actif | CWL 2606.11213 | remplace trim plat `index.ts:339` |
| 7 | Query-aware retention (perplexité contrastive / info mutuelle / sequence labeling) | LongLLMLingua 2310.06839, QUITO-X, Provence 2501.16214 | scoring des lignes de tool-output |
| 8 | Réversibilité keep-all + retrieve (P-rev) | Quest (survey), survey 2607.08032 | sidecar store + tool de retrieval |
| 9 | Rubric SelfCompact (quand compacter / supprimer) | SelfCompact 2606.23525 | description `compress.ts:145` |
| 10 | Scoring importance+pertinence+récence | Generative Agents 2304.03442 | fonction de sélection |
| 11 | Courbe d'oubli d'Ebbinghaus | MemoryBank 2305.10250 | politique de rétention |
| 12 | Arbre récursif + retrieve | RAPTOR 2401.18059, DTCRS 2025.acl-long.536 | résumés hiérarchiques |
| 13 | Paging / virtual context (tiers) | MemGPT 2310.08560 | mémoire à étages |
| 14 | Observations vs historique séparés + guidelines affinées par analyse d'échecs | ACON 2510.00615 | `prompt.ts`, `strategies.ts` |
| 15 | Memory add/update/delete cross-session | Mem0 2504.19413, A-Mem 2502.12110 | mémoire inter-sessions |
| 16 | Règle d'arrêt par borne d'erreur | Ada-KV (survey) | arrêt de summarization |
| 17 | Head+tail / attention sinks | StreamingLLM (survey) + reco Governance Decay | trim tête+queue |
| 18 | Provenance / spotlighting des données ingérées | Spotlighting 2403.14720 | avant le summarizer |
| 19 | Post-hoc compile vers JSONL `trajectory-v1` | Lerim (README) | export de session |

---

## 5. Liste implémentable ordonnée

Barème (1–5) :
- **Impact** = bénéfice tâche/sécurité (5 majeur → 1 mineur)
- **Effort** = coût d'implémentation (5 trivial → 1 lourd)
- **Perf** = coût runtime/tokens ajouté (5 gratuit → 1 cher)
- **Score = 3×Impact + 2×Effort + 1×Perf** (impact dominant, puis effort, puis perf)

| # | Implémentation | Impact | Effort | Perf | Score | Points d'accroche |
|---|---|---|---|---|---|---|
| 1 | Rubric SelfCompact dans le tool `compress` (+ nudge périodique) | 4 | 5 | 5 | 27 | `compress.ts:145`, `index.ts` transform |
| 2 | Constraint Pinning / ControlCapsule (buffer épinglé, réinjecté + intégrité, omission-first) | 5 | 3 | 5 | 26 | nouveau `src/pinned.ts`, `index.ts:274`, `prompt.ts:40` |
| 3 | Rolling summary (`RunningSummary` + `<previous-summary>`) ⚠️ API | 5 | 3 | 4 | 25 | `index.ts:274`, `prompt.ts:27` |
| 4 | Trim tête+queue (StreamingLLM) | 3 | 5 | 5 | 24 | `index.ts:135` |
| 5 | Brancher `purgeErrors.turns` (config inutilisée) | 3 | 5 | 5 | 24 | `index.ts:377`, `config.ts:178` |
| 6 | Provenance/spotlighting des tool-outputs avant summarizer | 3 | 4 | 5 | 22 | `index.ts` transform |
| 7 | Pruning réversible (sidecar des originaux + tool de retrieval) | 4 | 3 | 3 | 21 | `index.ts:357` + store |
| 8 | Rétention query-aware (scoring lexical vs msg user/focus) | 4 | 3 | 2 | 20 | `index.ts:339` |
| 9 | Éviction structurée (épisodes typés, politique LLM-free) | 4 | 2 | 4 | 20 | `index.ts` transform + modèle d'épisodes |
| 10 | Fiabiliser le tool `compress` (indices de messages non visibles) | 3 | 3 | 5 | 20 | `compress.ts:145`, `index.ts:247` |
| 11 | Scoring importance+pertinence+récence + courbe d'oubli | 3 | 3 | 3 | 18 | `index.ts` sélection |
| 12 | Export post-hoc `trajectory-v1` JSONL (pont Lerim) | 3 | 2 | 5 | 18 | `event`/`dispose` |
| 13 | Validation post-compaction (juge vs intent/facts) | 4 | 2 | 1 | 17 | `index.ts:274` + appel juge |
| 14 | ACON (observations vs historique + guidelines par échecs) | 3 | 2 | 2 | 15 | `prompt.ts`, `strategies.ts` |
| 15 | Règle d'arrêt Ada-KV (borne d'erreur) | 2 | 2 | 4 | 14 | `index.ts:135` |
| 16 | Paging MemGPT (mémoire à étages) | 3 | 1 | 2 | 13 | nouveau module |
| 17 | Mémoire cross-session Mem0/A-Mem | 3 | 1 | 2 | 13 | nouveau module |
| 18 | Arbre récursif RAPTOR/DTCRS (embeddings/clustering) | 3 | 1 | 1 | 12 | nouveau module |

### Lecture
- **Quick wins** (effort 5) : #1, #4, #5 — quasi gratuits.
- **Meilleur ratio impact/effort** : #2 (pinning), #3 (rolling summary).
  - ⚠️ #3 dépend de l'API : le hook `experimental.session.compacting` ne renvoie que
    `output.prompt`/`context` ; vérifier qu'OpenCode expose le résumé généré avant
    de s'engager.
- **Hot path** : #8 et #11 coûtent O(longueur totale) à chaque `messages.transform`
  → cacher.
- **Coûteux en tokens** : #13 (appel juge), #18 (embeddings).
- **Gros chantiers** : #16, #17, #18.

### Ordre d'exécution recommandé
1. **Lot 0 (≈1 jour)** : #1, #4, #5, #10.
2. **Lot 1 (sécurité)** : #2 (+ #6).
3. **Lot 2 (continuité)** : #3 (après validation API), puis #13.
4. **Lot 3 (efficacité contexte)** : #7, #8, #9.
5. **Lot 4 (long terme)** : #11, #12, puis #16/#17/#18.

---

## 6. Non portable (substrat différent, à écarter)

- **KV-cache** : KIVI, KVQuant, Palu, MLA, H2O, SnapKV, PyramidKV, Ada-KV (interne),
  CaM, xKV, MiniCache, StreamingLLM (mécanique).
- **Architectural** : RMT, Mamba, Titans, Infini-attn, DMC.
- **Sparsité apprise** : NSA, MoBA, MInference, DuoAttention.
- **Latent / gist** : gisting, ICAE, xRAG, 500xCompressor, Cartridges,
  AutoCompressor, KV-Distill.
- **Multimodal** : ToMe, LOOK-M.
- **RL / entraîné** : CompactionRL (2607.05378), MEM1, TACO-RL, LLMLingua-2.
- **Systèmes** : PagedAttention, InfiniGen.

> Source : Appendix A du survey 2607.08032 (table méthode-par-axe).

---

## 7. Incertitudes & prochaines étapes

1. **API OpenCode** : le hook `experimental.session.compacting` expose-t-il le résumé
   généré (nécessaire pour #3 et #13) ? À vérifier.
2. **Extraction des contraintes** (#2) : partir d'AGENTS.md + `permission` + directives
   utilisateur explicites ; les contraintes implicites sont hors périmètre
   (limitation reconnue par Governance Decay).
3. **Coût du juge** (#13) : appel LLM supplémentaire → mesurer l'impact.
4. **Hot path** : valider le surcoût de #8/#11 sur de grands contextes.

### Prochaine action proposée
Transformer le **Lot 0** (#1, #4, #5, #10) en tickets ou l'implémenter directement.
