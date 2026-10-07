# INDEX E3 — Folding & compression multi-échelle

> Ensemble E3 · « COMMENT découper et fusionner des blocs ». Cible : `src/compress.ts`
> (tool `compress`, args `start/end/summary`, `<compressed-block>`), `src/index.ts`
> (`experimental.chat.messages.transform`). Aucune dépendance externe requise.
>
> **Méthode** : index seed §1 + liens non-arXiv §2, puis descente (profondeur ≤ 3). Statuts
> `déjà listé` = index seed / doc consolidé §4 E3.
> **Vérification** : 5 sources structurantes 🟢 ont été **ré-ouvertes et confirmées** par le
> main agent (context-fold, opencode-context-compress, ACE 2606.31564, Focus 2601.07190,
> opencode-context-compactor). Les autres sont issues du crawl subagent et signalées.

---

## INDEX E3 — Folding multi-échelle

### Arborescence

- **Folding à directive / multi-échelle (arXiv)**
  - **AgentFold: Long-Horizon Web Agents with Proactive Context Management** — https://arxiv.org/abs/2510.24699 — 🟡 déjà listé (politique RL/SFT) — « it can perform granular condensations to preserve vital, fine-grained details, or deep consolidations to abstract away entire multi-step sub-tasks »
    - directive (full-text) : `ft = { "range" : [k,t-1], "summary" : "σt" }` ; `k = t−1` = Granular Condensation, `k < t−1` = Deep Consolidation
  - **Scaling Long-Horizon LLM Agent via Context-Folding** — https://arxiv.org/abs/2510.11967 — 🟡 déjà listé (cœur RL) — « branch into a sub-trajectory to handle a subtask and then fold it upon completion »
  - **U-Fold: Dynamic Intent-Aware Context Folding for User-Centric Agents** — https://arxiv.org/abs/2601.18285 — 🟡 (non revérifié) — « uses two core components to produce an intent-aware, evolving dialogue summary and a compact, task-relevant tool log »
  - **Accordion-Thinking: Self-Regulated Step Summaries…** — https://arxiv.org/abs/2602.03249 — 🟡 déjà listé (RL) — « self-regulate the granularity of the reasoning steps through dynamic summarization … a Fold inference mode »
  - **FoldAct: Efficient and Stable Context Folding for Long-Horizon Search Agents** — https://arxiv.org/abs/2512.22733 — ⚪ (RL ; seed 🟡) — « typed summaries : `<think_summary>` vs `<information_summary>` »
  - **LightThinker++: From Reasoning Compression to Memory Management** — https://arxiv.org/abs/2604.03679 — ⚪ (entraînement ; seed 🟢) — « Explicit Adaptive Memory Management … explicit memory primitives »
  - **Recursive Models for Long-Horizon Reasoning** — https://arxiv.org/abs/2603.02112 — ⚪ (fine-tuning, non revérifié) — « the model can recursively invoke itself to solve subtasks in isolated contexts »
- **Compression en blocs / élastique / repli réversible**
  - **ACE: Pluggable Adaptive Context Elasticizer across Agents** — https://arxiv.org/abs/2606.31564 — 🟢 — « elastically orchestrates historical step information … assigns each step an elastic type as raw, abstract, or drop … This reversible design ensures that the main LLM always receives a compact yet information-rich context. »
  - **Active Context Compression: Autonomous Memory Management in LLM Agents (Focus)** — https://arxiv.org/abs/2601.07190 — 🟢 — « The Focus Agent autonomously decides when to consolidate key learnings into a persistent "Knowledge" block and actively withdraws (prunes) the raw interaction history. »
  - **context-fold (Middlewatch)** — https://github.com/Middlewatch/context-fold — 🟢 — « Every fold is reversible, indexed, and computed without a model call. »
    - « a fold event masks stale `tool_result`/`thinking` blocks … to their deterministic digests » ; `recall_folded` / `unfold` (sticky re-expansion) ; ladder ~12 %
  - **opencode-context-compress** — https://github.com/AidenGeunGeun/opencode-context-compress — 🟢 — « Public tools are `compress({ summary, topic })` for deterministic uncompressed-history folding and `squash({ from, to, summary, topic })` for explicit existing-block maintenance. »
  - **opencode-context-compactor (oazabir)** — https://github.com/oazabir/opencode-context-compactor — 🟡 — « hybrid (recommended): Use concatenation for short histories, summarize for long ones. »
  - **Context as a Tool (CAT)** — https://arxiv.org/abs/2512.22087 — 🟡 (non revérifié) — « structured context workspace consisting of stable task semantics, condensed long-term memory, and high-fidelity short-term interactions »
  - **ContextWeaver** — https://arxiv.org/abs/2604.23069 — 🟡 (non revérifié) — « compact dependency summarization that condenses root-to-step reasoning paths into reusable units »
- **Cadres de compaction par groupes**
  - **Compaction | Microsoft Agent Framework** — https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/compaction — 🟡 (non revérifié) — « Collapses older tool-call groups into compact summary messages, preserving a readable trace without the full message overhead. »
    - `MessageGroupKind` = System / User / AssistantText / ToolCall / Summary ; `PipelineCompactionStrategy` (du plus doux au plus agressif)
  - **Beyond Compaction: Structured Context Eviction (CWL)** — https://arxiv.org/abs/2606.11213 — ⚪ (éviction → E5 ; seed 🟡) — « a deterministic, LLM-free policy evicts content in priority order »
  - **Memento (Microsoft)** — https://github.com/microsoft/memento — ⚪ (composant externe) — « After each reasoning block, the model generates a short summary, then the block content is evicted from the KV cache. »
- **Implémentations / blogs (déjà listés)**
  - **SelfCompact** — https://arxiv.org/abs/2606.23525 — ⚪ (déclenchement → E1) — compaction tool + rubric
  - **selfcompact (code)** — https://github.com/tianjianl/selfcompact — ⚪ (E1 + 🔌 FAISS/BM25)
  - **Autonomous context compression (LangChain)** — https://www.langchain.com/blog/autonomous-context-compression — ⚪ (E1/E2)
  - **Training Composer (Cursor)** — https://cursor.com/blog/self-summarization — ⚪ (entraînement/E1)
  - **Automatic context compaction (Claude Cookbook)** — https://platform.claude.com/cookbook/tool-use-automatic-context-compaction — ⚪ (E1/E2)
  - **smolagents #901** — https://github.com/huggingface/smolagents/issues/901 — 🟡 (non revérifié) — « summarizing the context every few steps or remembering only a limited history »

### Table

| Titre | URL/ID | Type | Niveau | Statut | Échelle/unité de fold | Fit E3 |
|---|---|---|---|---|---|---|
| AgentFold | arXiv:2510.24699 | papier+SFT | 0 | 🟡 déjà listé | plage `[k,t-1]`, granular vs deep selon k | ★★★ directive ≡ `{start,end,summary}` |
| Context-Folding | arXiv:2510.11967 | papier+RL | 0 | 🟡 déjà listé | branche/retour de sous-tâche | ★★ |
| U-Fold | arXiv:2601.18285 | papier | 1 | 🟡 (non revérifié) | résumé évolutif + log d'outils | ★★ |
| Accordion-Thinking | arXiv:2602.03249 | papier+RL | 0 | 🟡 déjà listé | granularité Fold/Unfold | ★★ |
| FoldAct | arXiv:2512.22733 | papier+RL | 0 | ⚪ (seed 🟡) | segments typés think/info | ★ |
| LightThinker++ | arXiv:2604.03679 | papier+SFT | 0 | ⚪ (seed 🟢) | thought→primitives mémoire | ★ |
| Recursive Models | arXiv:2603.02112 | papier+FT | 1 | ⚪ (non revérifié) | sous-contextes isolés | ★ |
| **ACE (Elasticizer)** | arXiv:2606.31564 | papier, 0 entraînement | 1 | 🟢 nouveau | 1 étape = raw/abstract/drop, réversible | ★★★ |
| **Focus** | arXiv:2601.07190 | papier, 0 entraînement | 1 | 🟢 nouveau | checkpoint→Knowledge block | ★★★ (#10) |
| **context-fold** | github.com/Middlewatch/context-fold | plugin TS (Pi) | 1 | 🟢 nouveau | blocs tool_result/thinking, ladder ~12 % | ★★★ (#10, expand) |
| **opencode-context-compress** | github.com/AidenGeunGeun/opencode-context-compress | plugin OpenCode | 1 | 🟢 nouveau | span déterministe `[bN]` + `squash` | ★★★ (direct) |
| opencode-context-compactor | github.com/oazabir/opencode-context-compactor | plugin OpenCode | 1 | 🟡 nouveau | concaténation vs summarize | ★★ |
| CAT | arXiv:2512.22087 | papier+FT | 2 | 🟡 (non revérifié) | 3 segments (semantics/mémoire/travail) | ★★ |
| ContextWeaver | arXiv:2604.23069 | papier, graphe | 2 | 🟡 (non revérifié) | chemins root→step réutilisables | ★★ |
| MS Agent Framework | learn.microsoft.com/.../compaction | doc+SDK | 2 | 🟡 (non revérifié) | groupes atomiques + pipeline | ★★ |
| smolagents #901 | github.com/huggingface/smolagents/issues/901 | issue | 2 | 🟡 (non revérifié) | step / gap de plan | ★★ (#10) |
| CWL | arXiv:2606.11213 | papier | 0 | ⚪ (E5 ; seed 🟡) | épisodes typés/dépendants | E5 |
| Memento | github.com/microsoft/memento | code+overlay | 1 | ⚪ | tokens de bloc, KV | composant externe |
| SelfCompact | arXiv:2606.23525 | papier | 0 | ⚪ (E1) | échelle unique | E1 |
| selfcompact | github.com/tianjianl/selfcompact | code | 0 | ⚪ (E1 + 🔌) | échelle unique | E1 |
| LangChain blog | langchain.com/blog/autonomous-context-compression | blog | 0 | ⚪ (E1/E2) | échelle unique | E1/E2 |
| Cursor blog | cursor.com/blog/self-summarization | blog | 0 | ⚪ (entraînement) | échelle unique | ⚪ |
| Claude Cookbook | platform.claude.com/cookbook/… | notebook | 0 | ⚪ (E1/E2) | échelle unique | E1/E2 |

### 🟢 → plugin

- **opencode-context-compress (AidenGeunGeun, npm `@skybluejacket/opencode-context-compress`)** → `src/compress.ts` (directive/échelle) : adopter un `compress({ summary, topic })` **sans indices** (le plugin choisit le span déterministe : « every eligible uncompressed message after the newest existing `[bN]` block, excluding the newest configured execution steps (`protectedTurns`) ») et ajouter un `squash({ from, to, summary, topic })` pour la **fusion deep** d'au moins deux blocs `[bN]`. **Solution directe au problème #10** (indices de messages non observables) ; c'est un plugin OpenCode du même écosystème.
- **context-fold (Middlewatch)** → `src/compress.ts` + `src/index.ts` : ancrage des blocs par **identité + digest** (sha256 des octets) plutôt que par indices ; « fold ladder » (un fold doit gagner ≥ ~12 % de fenêtre, hors queue protégée) ; `unfold` = **expand réversible** (sticky). Dans `src/index.ts`, conserver un ledger brut et permettre la ré-expansion — le plugin actuel ne stocke que `{start,end}` et ne peut pas déplier. (Note : projet marqué « peut être retiré », mais le design est réutilisable.)
- **Focus (2601.07190)** → `src/compress.ts` (directive/échelle) : remplacer `{start,end}` par un couple `start_focus` / `complete_focus(summary)` déclaré par le modèle ; le checkpoint est créé par le tool (« System creates checkpoint at current message index »), donc le modèle n'a plus à connaître les indices → **résout #10** ; les acquis s'accumulent dans un bloc « Knowledge » (ancre de fusion).
- **ACE — Adaptive Context Elasticizer (2606.31564)** → `src/index.ts` (transform) + `src/compress.ts` : couche de maintenance **sans perte** conservant brut + abstraction par étape, puis choix `raw | abstract | drop` par étape ; ajouter un champ `mode` (échelle) distinct du `summary`. « without training or architectural modifications » → implémentable directement.

### 🟡 → à tirer

- **AgentFold** : schéma exact `{range:[k,t-1], summary}` ↔ `{start,end,summary}` ; `scale` implicite = granular (`k=t-1`) vs deep (`k<t-1`) — préciser l'API du plugin.
- **Context-Folding** : outils `branch(description,prompt)` / `return(message)` comme ancres structurelles (alternative aux indices) ; objectif de multi-layer folding.
- **Accordion-Thinking / U-Fold / CAT** : granularité auto-réglée, double résumé (dialogue + log d'outils), workspace à 3 segments — réutilisables structurellement, politiques apprises.
- **ContextWeaver** : « dependency summary » (root→step) comme unité de fusion réutilisable, sans embeddings explicites.
- **MS Agent Framework** : regrouper tool-call+result en unité atomique et ordonner les stratégies du plus doux au plus agressif (granular→deep).
- **opencode-context-compactor** : modes `concatenate` vs `summarize` comme premier gradient de granularité (très proche de `compress`).
- **smolagents #901** : deux couches (résumé par step + consolidation aux frontières de plan) ; l'ancre est `step_number` (identifiable, #10).

### ⚪ écartés

- **LightThinker++ (2604.03679)**, **FoldAct (2512.22733)**, **Recursive Models (2603.02112)** — nécessitent RL / fine-tuning (politique apprise) ; structure éventuellement 🟡.
- **SelfCompact (2606.23525) + repo** — portent sur le **déclenchement** (E1), pas la découpe multi-échelle ; repo 🔌 (FAISS/BM25).
- **CWL (2606.11213)** — éviction structurée (E5), pas folding/résumé typé de plage.
- **LangChain blog / Claude Cookbook** — déclenchement à seuil + template (E1/E2), échelle unique.
- **Cursor blog** — self-summarization apprise, échelle unique.
- **Memento** — structure bloc/summary réutilisable mais nécessite vLLM modifié + pipeline SFT (composant externe).

### ⚠️ inaccessibles

- **https://github.com/snapetech/hermes-agent-evolved/blob/main/docs/context-compaction.md** — 404 (dépôt/chemin introuvable) ; le contenu « compaction_search/compaction_expand » n'a pu être confirmé.

### Déjà listé

- **arXiv:2510.24699, 2604.03679, 2606.23525, 2510.11967, 2512.22733, 2602.03249, 2606.11213** — sources de départ arXiv.
- **github.com/tianjianl/selfcompact, langchain.com/blog/autonomous-context-compression, cursor.com/blog/self-summarization, github.com/microsoft/memento, platform.claude.com/cookbook/…** — sources de départ non-arXiv.
- **`src/compress.ts` / `src/index.ts`** — lecture locale (`{start,end,summary}` → `<compressed-block>` dans `experimental.chat.messages.transform`).

---

## Addendum d'exploration (profondeur / budget)

- **Profondeur atteinte** : 2. Aucun nœud retenu de profondeur 4.
- **Liens ouverts (E3)** : ~22 (13 seed + 9 nouveaux/sortants).
- **Ré-vérification main agent** (5 sources 🟢/🟡 structurantes) :
  - `github.com/Middlewatch/context-fold` → **confirmé** : « Deterministic, reversible context compaction for the Pi coding agent », ladder ~12 %, `recall_folded`/`unfold`, digest sha256.
  - `github.com/AidenGeunGeun/opencode-context-compress` → **confirmé** : `compress({summary,topic})` + `squash({from,to,...})`, span déterministe, `protectedTurns` (défaut 3), npm `@skybluejacket/opencode-context-compress`.
  - `arXiv:2606.31564` (ACE Elasticizer) → **confirmé** : raw/abstract/drop, « without training or architectural modifications ». (À ne pas confondre avec l'ACE « Agentic Context Engineering » `2510.04618` d'E2.)
  - `arXiv:2601.07190` (Focus) → **confirmé** : Knowledge block, pruning autonome, 22,7 % de réduction de tokens.
  - `github.com/oazabir/opencode-context-compactor` → **confirmé** : modes `concatenate`/`summarize`/`hybrid`, `keep_messages=10`.
- **Non revérifiés par le main agent** (crawl subagent uniquement) : U-Fold `2601.18285`, Recursive Models `2603.02112`, CAT `2512.22087`, ContextWeaver `2604.23069`, page MS Agent Framework, smolagents #901 — à revalider avant tout usage.
- **Problème #10 (indices non observables)** : 3 alternatives vérifiées — (a) **opencode-context-compress** supprime les indices et laisse le plugin sélectionner le span déterministe + `squash` ; (b) **context-fold** ancre par digest et offre `unfold` ; (c) **Focus** ancre sur `start_focus`/`complete_focus`. AgentFold ajoute une échelle **relative** (`k=t-1` vs `k<t-1`).
- **Budget** : ~22 pages, **sous ~40** ; pas de point de contrôle requis.
