# opencode-live-compaction — Recherche compaction & contexte (document de référence)

> **Document de référence unique** : consolide et remplace les deux passes de recherche
> précédentes (ancienne passe 1 et passe 2), dont la redondance a été supprimée.
>
> - Racine autorisée : `https://nazmi.tech/blog/context-compaction-llm-agents-fundamentals`
>   + suites Part 2/3/4.
> - Passe 1 = crawl large (profondeur 0→2). Passe 2 = crawl arXiv ciblé (profondeur 0→4,
>   ~86/96 pages). Provenance indiquée par `[P1]` / `[P2]`.
> - Consolidé le 2026-10-07.

---

## 1. Méthode

- **Gate thématique** : jugé sur le **contexte citant** + le **titre/sous-titres** de la page
  (jamais l'URL seule).
- **Test d'utilité plugin** (décisif) : mécanisme implémentable **sans entraînement**, sur au
  moins un axe — *quand* compacter ; *quoi* garder/évincer/résumer ; rendre la compaction
  *réversible* ; *préserver* contraintes/état/tâche ; *évaluer* la compaction. Doute → écarté.
- **Exclusions fermes** : entraînement/RL/fine-tuning, internes KV-cache, architecture/SSM,
  latent/gist/distillation, multimodal, benchmarks sans mécanisme transposable, frameworks.
- **Classement** : 🟢 direct · 🟡 indirect · ⚪ écarté.
- **Statut de lecture** : ✅ lu · 📄 via résumé · 🧩 cité non ouvert · ⚠️ inaccessible.
- **Portée** : arXiv pour le crawl principal ; liens non-arXiv (GitHub/docs/outils) réservés
  à une phase 2.

---

## 2. État du plugin (baseline courant, après E1–E5)

Hooks actifs (`src/index.ts`) : `tool.execute.after` (suivi fichiers + capture
`compress`/`squash`/`expand`/`recall`), `experimental.session.compacting` (prompt 11 sections,
`replace`/`augment`, `<previous-summary>` glissant, `<task-state>`, `<latest-user-ask>`),
`experimental.chat.messages.transform` (compressions, squash, expand, trim, dedup,
purge + cascade, éviction graduée), `experimental.compaction.autocontinue`, `config`, `event`,
`dispose`.

Modules : `prompt.ts` · `compress.ts` (tools `compress`/`squash`, span déterministe) ·
`blocks.ts` (ids durables) · `expand.ts` (sidecar réversible) · `strategies.ts`
(dedup/purge/cascade) · `eviction.ts` (éviction graduée) · `glob.ts` · `files-touched.ts` ·
`todo-preserver.ts` · `preemptive-compaction.ts` (seuil hybride + gates) ·
`degradation-monitor.ts` (diagnostic + arrêt judge-free) · `previous-summary.ts` (état glissant).

Limites traitées par E1–E5 : tool `compress` fragile (indices non observables) → span
déterministe + labels `[bN]` ; réversibilité → `expand`/`recall` (sidecar mémoire) ; purge
d'erreur → essai entier + cascade ; éviction → graduée sans modèle ; déclenchement → seuil
hybride + gates déterministes.
Restent hors périmètre : mémoire inter-sessions, embeddings/retrieval (E4/E6+), rubric
« quand compacter » par modèle.

---

## 3. Index arborescent (niveaux 0 → 4)

> Statut + raison = courte citation du contexte citant (ou titre/sous-titre). `[P1]`/`[P2]` = provenance.

### Niveau 0 — Racines (non arXiv)
- **Context Compaction in LLM Agents: Part 1 — The Fundamentals** — `nazmi.tech/blog/context-compaction-llm-agents-fundamentals` — ✅
- **Part 2 — Learning to Compact** — `.../learning-to-compact` — ✅
- **Part 3 — Post-Hoc Compilation** — `.../post-hoc-compilation` — ✅
- **Part 4 — Theory and Safety** — `.../theory-and-safety` — ✅
- (annexe) **Lerim** — `github.com/nablo-io/lerim` — 📄 `[P1]` (outil, phase 2)

### Niveau 1 — papiers cités directement par les racines
- arXiv:**2304.12512** LLM semantic compression — ⚪ `[P1]` — « encode a long passage … in a shorter representation »
- arXiv:**2310.06839** LongLLMLingua — ⚪ `[P1]` — « prompt compression and budget control »
- arXiv:**2310.06201** Perplexity-based prompt compression — ⚪ `[P1]`
- arXiv:**2501.16214** Provence — ⚪ `[P1]` — pruner entraîné
- arXiv:**2308.15022** Recursive dialogue summarization — 🟡 `[P1]`
- arXiv:**2606.23525** Self-Compacting Language Model Agents (SelfCompact) — 🟢 `[P1+P2]` — « compaction tool + task-specific rubric »
- arXiv:**2607.05378** CompactionRL — ⚪ `[P1+P2]` (RL)
- arXiv:**2510.00615** ACON — 🟡 `[P1+P2]`
- arXiv:**2504.19413** Mem0 — ⚪ `[P1+P2]`
- arXiv:**2502.12110** A-Mem — ⚪ `[P1+P2]`
- arXiv:**2607.08032** Rate–Distortion survey — 🟡 `[P1+P2]` — « seven-axis taxonomy »
- arXiv:**2606.22528** Governance Decay — 🟢 `[P1+P2]` — « Constraint Pinning … no violations »
- aclanthology 2025.acl-long.536 DTCRS — 📄 `[P1]` ; aclanthology 2024.findings-acl.306 code semantic compression — 📄 `[P1]`
- LangChain short-term memory docs · LangMem SummarizationNode — 📄 `[P1]` (docs, phase 2)

### Niveau 2 — références (passe 2, nouvelles)
- arXiv:**2509.13313** **ReSum: Unlocking Long-Horizon Search Intelligence via Context Summarization** — 🟢 `[P2]`
  - ↳ arXiv:**2509.25140** ReasoningBank — 🟡 ; arXiv:**2507.03724** MemOS — 🟡
- arXiv:**2510.24699** **AgentFold: Long-Horizon Web Agents with Proactive Context Management** — 🟢 `[P2]`
  - ↳ arXiv:**2509.13309** WebResearcher — 🟡 ; arXiv:**2505.22101** MemOS — 🟡
- arXiv:**2602.02486** **RE-TRAC: REcursive TRAjectory Compression for Deep Search Agents** — 🟢 `[P2]`
  - ↳ arXiv:**2511.07327** IterResearch — 🟢
- arXiv:**2604.03679** **LightThinker++: From Reasoning Compression to Memory Management** — 🟢 `[P2]`
  - ↳ arXiv:**2602.12108** Pensieve — 🟢 ; arXiv:**2602.08030** Free() — ⚪
- arXiv:**2602.04288** **Contextual Drag: How Errors in the Context Affect LLM Reasoning** — 🟢 `[P2]`
  - ↳ arXiv:**2601.07226** Lost in the Noise — 🟡
- arXiv:**2602.03249** Accordion-Thinking — 🟡 `[P2]`
- arXiv:**2502.15589** LightThinker — 🟡 `[P2]`
- arXiv:**2510.11967** Scaling Long-Horizon LLM Agent via Context-Folding — 🟡 `[P2]` (cœur RL)
- arXiv:**2512.22733** FoldAct — 🟡 `[P2]` (cœur RL)
- arXiv:**2507.13334** A Survey of Context Engineering for Large Language Models — 🟡 `[P2]`
- arXiv:**2510.13797** Breadcrumbs Reasoning — ⚪ `[P2]` (KV + entraînement)

### Niveau 2 — références (passe 1)
- arXiv:**2605.08580** Slipstream (validation post-compaction) — 🟡 `[P1]`
- arXiv:**2606.11213** Beyond Compaction: Structured Context Eviction (CWL) — 🟡 `[P1]`
- arXiv:**2604.20911** Omission Constraints Decay (SRD) — 🟡 `[P1]`
- arXiv:**2605.12535** Ghost in the Context / ControlCapsule — 🟢 `[P1]`
- arXiv:**2310.08560** MemGPT — ⚪/🟡 `[P1]`
- arXiv:**2401.18059** RAPTOR — 🟡 `[P1]`
- arXiv:**2304.03442** Generative Agents — 🟡 `[P1]`
- arXiv:**2305.10250** MemoryBank (Ebbinghaus decay) — 🟡 `[P1]`
- arXiv:**2403.14720** Spotlighting — 🟡 `[P1]`
- arXiv:**2605.06445** Constraint Decay in backend code gen — 🧩 `[P1]`
- arXiv:**2605.23296** Parallel Context Compaction — 🧩 `[P1]`
- arXiv:**2512.02445** When Refusals Fail — 🧩 `[P1]`
- Context Rot (Chroma, Hong et al.) · Lost in the Middle (Liu et al.) — 🧩 `[P1]` (non arXiv)

### Niveaux 2 → 3 (passe 2)
- arXiv:**2511.07327** **IterResearch: Rethinking Long-Horizon Agents with Interaction Scaling** — 🟢 `[P2]`
  - ↳ arXiv:**2508.16629** Learn-to-memorize — 🟡 ; arXiv:**2505.00675** Rethinking Memory in LLM-based Agents — 🟡 ; arXiv:**2407.01178** Memory3 — ⚪ (architecture)
- arXiv:**2602.12108** **The Pensieve Paradigm: Stateful Language Models Mastering Their Own Context** — 🟢 `[P2]`
- arXiv:**2408.09559** **HiAgent: Hierarchical Working Memory Management…** — 🟢 `[P2]`
  - ↳ arXiv:**2402.11975** Compress to Impress — ⚪ ; arXiv:**2305.14788** Adapting LMs to Compress Contexts — ⚪ ; arXiv:**2311.08719** Think-in-Memory — 🟢 ; arXiv:**2402.03610** RAP — 🟡 ; arXiv:**2404.13501** Survey Memory Mechanism — 🟡
- arXiv:**2503.06692** **InftyThink: Breaking the Length Limits of Long-Context Reasoning** — 🟢 `[P2]`
- arXiv:**2412.18547** **Token-Budget-Aware LLM Reasoning (TALE)** — 🟢 `[P2]`
- arXiv:**2510.08790** COMPASS — 🟡 `[P2]`
- arXiv:**2505.22101** MemOS (MAG) — 🟡 `[P2]` ; arXiv:**2507.03724** MemOS: A Memory OS — 🟡 `[P2]`
- arXiv:**2407.09450** EM-LLM — ⚪ `[P2]` (KV/attention) — ↳ arXiv:**2403.11901** Larimar — ⚪
- arXiv:**2602.08030** Free() — ⚪ `[P2]`

### Niveau 4 (passe 2)
- arXiv:**2503.11951** **SagaLLM: Context Management, Validation, and Transaction Guarantees…** — 🟢 `[P2]`
- arXiv:**2308.01542** **Memory Sandbox: Transparent and Interactive Memory Management** — 🟢 `[P2]`
- arXiv:**2304.13343** **SCM: Enhancing LLM with Self-Controlled Memory Framework** — 🟢 `[P2]`
- arXiv:**2311.08719** **Think-in-Memory: Recalling and Post-thinking…** — 🟢 `[P2]`
- arXiv:**2501.13956** **Zep: A Temporal Knowledge Graph Architecture for Agent Memory** — 🟢 `[P2]`
- arXiv:**2310.05029** **Walking Down the Memory Maze (MemWalker)** — 🟢 `[P2]`
- arXiv:**2505.16067** **How Memory Management Impacts LLM Agents** — 🟢 `[P2]`
- arXiv:**2305.14322** RET-LLM — 🟡 `[P2]`
- arXiv:**2402.03610** RAP — 🟡 `[P2]`
- arXiv:**2505.00675** Rethinking Memory in LLM-based Agents — 🟡 `[P2]`
- arXiv:**2404.13501** A Survey on the Memory Mechanism of LLM-based Agents — 🟡 `[P2]`
- arXiv:**2504.15965** From Human Memory to AI Memory — 🟡 `[P2]`
- arXiv:**2409.05591** MemoRAG — ⚪/🟡 `[P2]`
- arXiv:**2312.17259** Empowering Working Memory for LLM Agents — ⚪ ⚠️ `[P2]`
- arXiv:**2211.05110** LLMs with Controllable Working Memory — ⚪ `[P2]`
- arXiv:**2403.11901** Larimar — ⚪ `[P2]`

---

## 4. Ensembles implémentables (batches ~12 pages)

> Chaque **ensemble (E)** = un lot d'analyse/implémentation d'environ **12 pages** (~7–10 liens).
> Objectif : décider « qu'est-ce qu'on en fait pour le plugin », avec un fichier/hook cible.
> Un lot peut être **plus petit** si ses pages contiennent des **liens sortants non explorés**
> (marge d'extension). Les statuts renvoient au §5.
>
> **Flag 🔌** = le lot/l'item semble nécessiter un **composant externe** (autre plugin, MCP,
> store/vecteurs/graphe, service, modèle de scoring ou UI). Ce n'est alors **pas** un ajout
> direct à `live-compaction` mais plutôt un **plugin/MCP séparé**.
> `🔌?` = dépendance externe **optionnelle** (une version interne dégradée reste possible).

### Synthèse des ensembles

| Ens. | Thème | Liens | ~pages | Extension | Ext. |
|---|---|---|---|---|---|
| E1 | Déclenchement & rythme de compaction | 8 | ~12 | moyenne | — |
| E2 | Résumé structuré & continuité d'état | 6 | ~9 | forte (survey) | — |
| E3 | Folding & compression multi-échelle | 7 | ~10 | moyenne | — |
| E4 | Réversibilité, inspection & retrieval | 7 | ~9 | moyenne | 🔌? (index de retrieval) |
| E5 | Éviction, purge & anti-contamination | 7 | ~9 | moyenne | — |
| E6 | Contraintes, gouvernance & validation | 7 | ~7 | forte (cités non ouverts) | 🔌? (juge LLM) |
| E7 | Store mémoire, graphe & read/write | 6 | ~10 | forte (MemOS) | 🔌 (store/graphe) |
| E8 | Mémoire d'expérience & cross-session | 10 | ~13 | forte (benchmarks) | 🔌 (store/vecteurs) |
| E9 | Compression sémantique / pruning (P1) | 7 | ~6 | faible | 🔌? (modèle de scoring) |
| E10 | Théorie, taxonomie & évaluation | 9 | ~11 | forte (surveys) | 🔌? (juge/benchmark) |

> Recherche ciblée par ensemble (prompts approfondis durcis + index dédié) :
> voir [`ensembles/`](./ensembles/) — E1, E2, E3, E5 (les lots internes, sans dépendance
> externe requise).

### E1 — Déclenchement & rythme de compaction (~12)
- 🟢 SelfCompact **2606.23525** `[P1+P2]` · ReSum **2509.13313** · InftyThink **2503.06692** ·
  TALE **2412.18547** · SCM **2304.13343** · Governance Decay **2606.22528** `[P1+P2]`
- 🟡 LightThinker **2502.15589** · Rate–Distortion **2607.08032** `[P1+P2]`
- **Cible** : `src/preemptive-compaction.ts`, `src/config.ts` (`preemptiveCompaction.threshold`).
- **À analyser** : substituer un déclencheur structurel (unité close/sous-tâche) au seuil token.
- **Extension** : RAPTOR/Ada-KV (arrêt), surveys.

### E2 — Résumé structuré & continuité d'état (~9)
- 🟢 RE-TRAC **2602.02486** · IterResearch **2511.07327** · Rolling summary (LangMem) `[P1]`
- 🟡 WebResearcher **2509.13309** · COMPASS **2510.08790** · Survey Context Engineering **2507.13334**
- **Cible** : `src/prompt.ts` (11 sections), `src/previous-summary.ts`.
- **À analyser** : « Task Continuity » = rapport reconstruit + facettes (provenance, incertitudes,
  échecs, pistes écartées).
- **Extension** : forte — `2507.13334` (~1400 réf.) non déroulée.

### E3 — Folding & compression multi-échelle (~10)
- 🟢 AgentFold **2510.24699** · LightThinker++ **2604.03679** · SelfCompact **2606.23525** `[P1+P2]`
- 🟡 Context-Folding **2510.11967** · FoldAct **2512.22733** · Accordion-Thinking **2602.03249** ·
  CWL **2606.11213** `[P1]`
- **Cible** : `src/compress.ts` (`start/end/summary`), `src/index.ts` (transform).
- **À analyser** : échelle granular/deep + granularité par pas.
- **Extension** : moyenne (réf. CoT-compression RL).

### E4 — Réversibilité, inspection & retrieval des évincés (~9)
- 🟢 Memory Sandbox **2308.01542** · SagaLLM **2503.11951** · MemWalker **2310.05029** ·
  HiAgent **2408.09559** · Pensieve **2602.12108** · LightThinker++ **2604.03679** ·
  Pruning réversible (sidecar) `[P1]`
- 🟡 CWL **2606.11213** `[P1]`
- **Cible** : `src/compress.ts` (`<compressed-block>`), sidecar d'originaux + tool de retrieval.
- **À analyser** : ré-injection/`expand` + retrieval des évincés.
- **Extension** : moyenne.
- **Externe** : 🔌? — le retrieval des évincés peut exiger un index/vecteurs ; un sidecar local reste possible.

### E5 — Éviction, purge & anti-contamination (~9)
- 🟢 Contextual Drag **2602.04288** · How Memory Management Impacts **2505.16067**
- 🟡 Lost in the Noise **2601.07226** · Survey Memory Mechanism **2404.13501** ·
  Rethinking Memory **2505.00675** · ACON **2510.00615** `[P1+P2]`
- ⚪ Free() **2602.08030**
- **Cible** : `src/strategies.ts` (`applyPurgeErrors`, dedup), `src/config.ts` (`purgeErrors.turns`).
- **À analyser** : purge des brouillons erronés ; filtrage des distracteurs proches.
- **Extension** : moyenne (benchmarks de distracteurs).

### E6 — Contraintes, gouvernance & validation post-compaction (~7)
- 🟢 Governance Decay **2606.22528** `[P1+P2]` · Ghost/ControlCapsule **2605.12535** `[P1]`
- 🟡 SRD **2604.20911** · Slipstream **2605.08580** · Spotlighting **2403.14720** ·
  Constraint Decay **2605.06445** · When Refusals Fail **2512.02445**
- **Cible** : `src/prompt.ts` (section Constraints) + buffer épinglé + intégrité post-compaction.
- **À analyser** : buffer épinglé réinjecté + vérification d'intégrité.
- **Extension** : forte — plusieurs réf. citées non ouvertes (`2605.06445`, `2512.02445`).
- **Externe** : 🔌? — la validation type Slipstream requiert un juge LLM (appel modèle séparé) ; le pinning reste interne.

### E7 — Store mémoire, graphe & read/write (~10)
- 🟢 Zep **2501.13956** · Think-in-Memory **2311.08719** · SCM **2304.13343**
- 🟡 RET-LLM **2305.14322** · MemOS **2505.22101** / **2507.03724**
- **Cible** : store de faits + tool de retrieval ; invalidation temporelle.
- **À analyser** : mémoire structurée read/write, lifecycle/provenance.
- **Extension** : forte (MemOS cite d'autres systèmes).
- **Externe** : 🔌 — store/graphe persistant (Zep, MemOS…) → MCP/plugin dédié.

### E8 — Mémoire d'expérience & cross-session (~13)
- 🟡 MemWalker **2310.05029** · RAP **2402.03610** · Learn-to-memorize **2508.16629** ·
  RAPTOR **2401.18059** `[P1]` · Generative Agents **2304.03442** `[P1]` ·
  MemoryBank **2305.10250** `[P1]` · MemoRAG **2409.05591**
- ⚪ Mem0 **2504.19413** · A-Mem **2502.12110** · MemGPT **2310.08560**
- **Cible** : mémoire cross-session + scoring importance/pertinence/récence + oubli.
- **À analyser** : retrieval d'expériences, oubli, paging.
- **Extension** : forte (benchmarks/rapports).
- **Externe** : 🔌 — mémoire cross-session et vecteurs → MCP/plugin dédié.

### E9 — Compression sémantique / pruning (P1) (~6)
- 📄 LLM semantic compression **2304.12512** · LongLLMLingua **2310.06839** ·
  Perplexity pruning **2310.06201** · Provence **2501.16214** · Recursive dialogue **2308.15022** ·
  DTCRS (ACL) · Code compression (ACL)
- **Statut** : traité en P1 (sous-jacent à query-aware #8, head+tail #4/#17, scoring #11).
- **Extension** : faible.
- **Externe** : 🔌? — le pruning par perplexité (LongLLMLingua) exige un modèle de scoring ; les heuristiques texte restent internes.

### E10 — Théorie, taxonomie & évaluation (~11)
- 🟢 How Memory Management Impacts **2505.16067**
- 🟡 Rate–Distortion **2607.08032** `[P1+P2]` · Survey Context Engineering **2507.13334** ·
  Rethinking Memory **2505.00675** · Survey Memory Mechanism **2404.13501** ·
  From Human Memory to AI Memory **2504.15965** · LightThinker **2502.15589** ·
  Lost in the Noise **2601.07226** · Slipstream **2605.08580** `[P1]`
- **Cible** : évaluateur de compaction du plugin.
- **À analyser** : métriques + signaux de dérive (entropie, distracteurs, transitions).
- **Extension** : forte (surveys).
- **Externe** : 🔌? — l'évaluateur/juge peut être interne (appel modèle) mais un harnais d'évaluation externe est souvent requis.

---

## 5. Classement détaillé & mapping plugin

### 🟢 Directs — « comment ça pourrait améliorer le plugin »
- **ReSum (2509.13313)** → `src/preemptive-compaction.ts` (déclencheur budget) + `src/prompt.ts`/`src/compress.ts` (spec de résumé certain, continuation `(question, résumé)`).
- **AgentFold (2510.24699)** → `src/compress.ts` (échelle granular/deep sur `{range, summary}`) ; `src/index.ts` (transform).
- **RE-TRAC (2602.02486)** → `src/prompt.ts` + `src/previous-summary.ts` (facettes d'état + provenance + « free-use »).
- **LightThinker++ (2604.03679)** → `src/compress.ts` (`commit/expand/fold` réversibles) ; `src/strategies.ts` (invariants anti-jitter).
- **Contextual Drag (2602.04288)** → `src/strategies.ts` (étendre la purge aux brouillons erronés).
- **IterResearch (2511.07327)** → `src/prompt.ts` (Task Continuity = rapport reconstruit) ; `src/todo-preserver.ts`.
- **Pensieve (2602.12108)** → `src/compress.ts` (stubs `deleteContext` + notes + `readChunk`).
- **HiAgent (2408.09559)** → `src/prompt.ts`/`src/compress.ts` (chunking par sous-buts + retrieval).
- **InftyThink (2503.06692)** → `src/preemptive-compaction.ts` (summarize-and-continue + arrêt sur conclusion).
- **TALE (2412.18547)** → `src/preemptive-compaction.ts`/`src/config.ts` (budget minimum / token elasticity).
- **SagaLLM (2503.11951)** → store d'état + `src/todo-preserver.ts` (checkpoint/restore + compensation).
- **Memory Sandbox (2308.01542)** → `src/compress.ts` (objets mémoire inspectables/réversibles).
- **SCM (2304.13343)** → `src/preemptive-compaction.ts`/`src/strategies.ts` (contrôleur « mémoire nécessaire ? » + rang).
- **Think-in-Memory (2311.08719)** → `src/prompt.ts`/`src/compress.ts` (conclusions évoluées + insert/forget/merge).
- **Zep (2501.13956)** → `src/previous-summary.ts` + store de faits (invalidation temporelle + retrieval hybride).
- **MemWalker (2310.05029)** → `src/compress.ts` + tool de retrieval (arbre de résumés navigable).
- **How Memory Management Impacts (2505.16067)** → `src/strategies.ts` (gate d'écriture + suppression par utilité).
- **Pruning réversible (sidecar)** `[P1]` → `src/index.ts` + store.
- **Constraint Pinning / ControlCapsule** `[P1]` → `src/prompt.ts` + buffer épinglé.
- **Rolling summary** `[P1]` → `src/previous-summary.ts`.
- **Rubric SelfCompact** `[P1]` → `src/compress.ts`.

### 🟡 Indirects — « ce qu'on pourrait en tirer »
- **Survey Context Engineering (2507.13334)** : vocabulaire des opérations + axe d'évaluation.
- **FoldAct (2512.22733)** : résumés typés (`think` vs `information`).
- **LightThinker (2502.15589)** : métrique **Dependency** ; frontière de pensée comme déclencheur.
- **Context-Folding (2510.11967)** : structure branch→fold→résumé (cœur RL).
- **Accordion-Thinking (2602.03249)** : plancher de résumé, bornes de pas.
- **COMPASS (2510.08790)** : détection boucles/dérive → refresh.
- **WebResearcher (2509.13309)** : rapport réécrit.
- **MemOS (2505.22101 / 2507.03724)** : lifecycle/provenance/TTL/rollback.
- **RET-LLM (2305.14322)** : triplet + API `[MEM_WRITE]/[MEM_READ]`.
- **RAP (2402.03610)** : restitution d'expériences par score pondéré.
- **Rethinking Memory / Survey Memory Mechanism / From Human Memory to AI Memory** : taxonomies + éval.
- **Lost in the Noise (2601.07226)** : hard-negatives ; entropie comme signal.
- **Learning-to-memorize (2508.16629)** : mémoire adaptative.
- **MemoRAG (2409.05591)** : surrogate « indice » guidant le retrieval.
- **Slipstream (2605.08580)** : validation post-compaction ; **SRD (2604.20911)** : omissions ; **CWL (2606.11213)** : éviction structurée ; **Spotlighting (2403.14720)** : provenance.
- **RAPTOR / Generative Agents / MemoryBank** : hiérarchie / scoring / oubli.

### ⚪ Écartés
- KV-cache : StreamingLLM, SnapKV, PyramidKV, H2O, TOVA, Keydiff, EpiCache, Breadcrumbs **2510.13797**, activation beacon.
- Architecture/SSM : Markovian Thinker **2510.06557**, Memory3 **2407.01178**, Larimar **2403.11901**, RMT, Mamba, Titans.
- RL/entraînement : CompactionRL **2607.05378**, MEM1 **2506.15841**, MemAgent **2507.02259**, Memory-R1 **2508.19828**, FoldAct **2512.22733**, Context-Folding **2510.11967**, Accordion **2602.03249** (politique), LightThinker/++ **2502.15589**/**2604.03679**, Free() **2602.08030**, MemoRAG **2409.05591**, LLMLingua-2, TACO-RL, Adapting LMs to Compress Contexts **2305.14788**, Compress to Impress **2402.11975**.
- Latent/gist : ICAE **2307.06945**, gisting, AutoCompressor, Cartridges **2506.06266**.
- Multimodal : JARVIS-1 **2311.05997**, RAP (vision), OSWorld **2404.06654**.
- Controllable Working Memory **2211.05110** (KAFT) ; Empowering Working Memory **2312.17259** ⚠️ (HTML indisponible).
- Benchmarks/rapports : BrowseComp **2504.12516**, BrowseComp-Plus **2508.06600**, LongMemEval **2410.10813**, RULER **2404.06654**, NoLiMa **2502.05167**, YaRN **2309.00071**, MiMo-v2 **2601.02780**, GLM-4.5 **2508.06471**, MiroThinker **2511.11793**, Kimi-K2 **2507.20534**.

---

## 6. Backlog unifié

> Barème : **Score = 3×Impact + 2×Effort + 1×Perf** (Impact 5 majeur → 1 ; Effort 5 trivial → 1 ;
> Perf 5 gratuit → 1). Items `[P1]` = ancienne liste ; items `[P2]` = nouveaux (scores = inférence).

| # | Implémentation | Ens. | Imp. | Eff. | Perf | Score | Orig. | Ext. |
|---|---|---|---|---|---|---|---|---|
| 1 | Rubric SelfCompact dans le tool `compress` (+ nudge) | E1 | 4 | 5 | 5 | 27 | P1 | — |
| 2 | Constraint Pinning / ControlCapsule (buffer épinglé, intégrité) | E6 | 5 | 3 | 5 | 26 | P1 | — |
| 3 | Rolling summary (`RunningSummary` + `<previous-summary>`) | E2 | 5 | 3 | 4 | 25 | P1 | — |
| 4 | Trim tête+queue (StreamingLLM) | E9 | 3 | 5 | 5 | 24 | P1 | — |
| 5 | Brancher `purgeErrors.turns` (config inutilisée) | E5 | 3 | 5 | 5 | 24 | P1 | — |
| 6 | Provenance/spotlighting des tool-outputs avant summarizer | E6 | 3 | 4 | 5 | 22 | P1 | — |
| 7 | Pruning réversible (sidecar originaux + tool de retrieval) | E4 | 4 | 3 | 3 | 21 | P1 | 🔌? |
| 8 | Rétention query-aware (scoring lexical vs msg/focus) | E9 | 4 | 3 | 2 | 20 | P1 | 🔌 |
| 9 | Éviction structurée (épisodes typés, LLM-free) | E5 | 4 | 2 | 4 | 20 | P1 | — |
| 10 | Fiabiliser le tool `compress` (indices non visibles) | E3 | 3 | 3 | 5 | 20 | P1 | — |
| 11 | Scoring importance+pertinence+récence + oubli | E8/E10 | 3 | 3 | 3 | 18 | P1 | 🔌 |
| 12 | Export post-hoc `trajectory-v1` JSONL | E8 | 3 | 2 | 5 | 18 | P1 | — |
| 13 | Validation post-compaction (juge vs intent/facts) | E10 | 4 | 2 | 1 | 17 | P1 | 🔌? |
| 14 | ACON (observations vs historique + guidelines) | E5 | 3 | 2 | 2 | 15 | P1 | — |
| 15 | Règle d'arrêt par borne d'erreur | E5 | 2 | 2 | 4 | 14 | P1 | — |
| 16 | Paging MemGPT (mémoire à étages) | E8 | 3 | 1 | 2 | 13 | P1 | 🔌 |
| 17 | Mémoire cross-session Mem0/A-Mem | E8 | 3 | 1 | 2 | 13 | P1 | 🔌 |
| 18 | Arbre récursif RAPTOR/DTCRS | E2/E8 | 3 | 1 | 1 | 12 | P1 | 🔌 |
| 19 | Échelle de fold granular/deep dans `compress` (AgentFold) | E3 | 4 | 4 | 4 | 24 | P2 | — |
| 20 | Éviction des brouillons erronés (Contextual Drag) | E5 | 4 | 4 | 5 | 25 | P2 | — |
| 21 | Facettes d'état + provenance dans le prompt (RE-TRAC) | E2 | 4 | 4 | 4 | 24 | P2 | — |
| 22 | Déclencheur structurel multi-échelle (ReSum/InftyThink) | E1 | 4 | 3 | 4 | 22 | P2 | — |
| 23 | Gate d'écriture mémoire + suppression utilité (2505.16067) | E5/E8 | 4 | 3 | 3 | 21 | P2 | 🔌? |
| 24 | `commit/expand/fold` + expand réversible (LightThinker++) | E3/E4 | 4 | 3 | 3 | 21 | P2 | — |
| 25 | Arbre de résumés navigable (MemWalker) | E2/E4 | 3 | 2 | 4 | 20 | P2 | 🔌? |
| 26 | Checkpoint/restore + compensation (SagaLLM) | E4 | 4 | 2 | 3 | 19 | P2 | — |
| 27 | Invalidation temporelle des faits (Zep) | E7 | 3 | 2 | 4 | 19 | P2 | 🔌 |
| 28 | Objets mémoire inspectables/réversibles (Memory Sandbox) | E4 | 3 | 3 | 4 | 19 | P2 | 🔌 |
| 29 | Contrôleur de mémoire + seuils (SCM) | E1/E7 | 3 | 3 | 4 | 19 | P2 | — |
| 30 | Résumés typés think/information (FoldAct) | E5 | 3 | 3 | 5 | 19 | P2 | — |
| 31 | Budget minimum de raisonnement (TALE) | E1 | 3 | 3 | 4 | 19 | P2 | — |
| 32 | Retrieval de chunks à la demande (HiAgent) | E4 | 3 | 2 | 4 | 19 | P2 | — |
| 33 | Mémoire triplet read/write (RET-LLM) | E7 | 2 | 3 | 4 | 17 | P2 | 🔌 |
| 34 | Rapport évolutif reconstruit (IterResearch) | E2 | 3 | 2 | 4 | 17 | P2 | — |
| 35 | Pensées évoluées + insert/forget/merge (TiM) | E7 | 3 | 2 | 3 | 17 | P2 | 🔌? |
| 36 | Évaluateur de compaction (surveys) | E10 | 3 | 2 | 2 | 15 | P2 | 🔌? |

### Lecture
- **Quick wins** (effort 5) : #1, #4, #5.
- **Meilleur ratio impact/effort** : #2, #3, puis #20.
- **Hot path** : #8, #11 → cacher.
- **Coûteux en tokens** : #13, #18.
- **Gros chantiers** : #16, #17, #18.

### Ordre d'exécution recommandé
1. **Lot 0** : #1, #4, #5, #10.
2. **Lot 1 (sécurité)** : #2, #6.
3. **Lot 2 (continuité)** : #3, #21, #34, #13.
4. **Lot 3 (efficacité contexte)** : #7, #8, #9, #19, #20.
5. **Lot 4 (mémoire/réversibilité)** : #22→#32, puis #23, #26, #27, #28.
6. **Lot 5 (long terme)** : #11, #12, #16, #17, #18, #36.

### Dépendances externes (🔌) — « plutôt un autre plugin/MCP »

- **🔌 requis** (hors périmètre direct de `live-compaction`) : **E7** (store/graphe : Zep,
  MemOS) · **E8** (mémoire cross-session + vecteurs : Mem0, A-Mem, MemGPT, RAPTOR, RAP) ·
  items #8, #11, #16, #17, #18, #27, #28, #33.
- **🔌? optionnel** (une version interne dégradée reste possible) : **E4** (index de
  retrieval) · **E6** (juge LLM de validation) · **E9** (modèle de scoring perplexité) ·
  **E10** (juge/benchmark) · items #7, #13, #23, #25, #35, #36.
- **Internes** (aucune dépendance externe) : **E1, E2, E3, E5** et les items sans flag.

---

## 7. Non portable (substrat différent)

- **KV-cache** : éviction/quantization/sparsité d'attention, StreamingLLM, SnapKV, PyramidKV,
  H2O, TOVA, Keydiff, EpiCache, Breadcrumbs, activation beacon.
- **Architecture / récurrent / SSM** : RMT, Mamba, Titans, Infini-attn, DMC, Markovian Thinker,
  Memory3, Larimar.
- **Sparsité apprise** : NSA, MoBA, MInference, DuoAttention.
- **Latent / gist / distillation** : gisting, ICAE, xRAG, AutoCompressor, Cartridges, KV-Distill.
- **Multimodal** : ToMe, LOOK-M, JARVIS-1, RAP (vision), OSWorld.
- **RL / entraîné** : CompactionRL, MEM1, TACO-RL, LLMLingua-2, FoldAct, Context-Folding,
  Accordion, LightThinker/++, Free(), MemoRAG.
- **Systèmes** : PagedAttention, InfiniGen.
- **Sécurité mémoire hors compaction** : spotlighting, injection worms, GuardAgent.

> Source : croisement Appendix A du survey `2607.08032` + jugements de la passe 2.

---

## 8. Vérification, corrections, incertitudes

- **LU** : titres/auteurs/dates/IDs/abstracts/textes intégraux ; **DÉDUIT** : verdicts de
  portabilité et mappings plugin.
- **Titres réels ≠ titre cité** (corrigés) : `2511.07327` *IterResearch: Rethinking Long-Horizon
  Agents with Interaction Scaling* · `2505.00675` *Rethinking Memory in LLM based Agents* ·
  `2404.13501` *A Survey on the Memory Mechanism of Large Language Model based Agents* ·
  `2409.05591` *MemoRAG: Boosting Long Context Processing…* · `2407.09450` *Human-inspired
  Episodic Memory…* · `2509.13309` *WebResearcher: Unleashing unbounded reasoning…*.
- **⚠️ inaccessible** : `2312.17259` (HTML indisponible, abstract seul) ; `2510.11967`
  (HTML 404, portabilité jugée sur abstract).
- **Incertitudes** : API `experimental.session.compacting` (exposition du résumé généré) ;
  extraction des contraintes ; coût du juge ; surcoût hot path ; IDs de niveau 4 non tous
  revérifiés indépendamment.

### Prochaines étapes
Traiter **E1 (déclenchement/rythme)** et **E4 (réversibilité/retrieval)** en premier,
puis **E2 (résumé/état)** et **E5 (éviction)**, en s'appuyant sur le backlog §6.
