# INDEX E2 — Résumé structuré & continuité d'état

> Ensemble E2 · « QUOI garder et COMMENT représenter l'état ». Cible : `src/prompt.ts`
> (11 sections), `src/previous-summary.ts` (résumé glissant `<previous-summary>`),
> `src/todo-preserver.ts` (état de tâche), `src/index.ts` (`experimental.session.compacting`).
> Aucune dépendance externe requise.
>
> **Méthode** : index seed §1 + liens non-arXiv §2, puis descente (profondeur ≤ 3). Statuts
> `déjà listé` = index seed / doc consolidé §4 E2. Les liens ⚠️ sont signalés.
> **Vérification** : les 3 nouvelles sources structurantes (pi-live-compaction, ACE,
> OpenHands Condenser) ont été **ré-ouvertes et confirmées** par le main agent (voir Addendum).

---

## INDEX E2 — Résumé structuré & continuité

### Arborescence

- **pi-live-compaction** (ascendant réel de `prompt.ts`) — miroir https://cdn.jsdelivr.net/npm/pi-live-compaction@0.1.7/README.md — ✅ lu — « **11 continuity sections** instead of 5 — intent trail, dead ends, task state, file manifests, mandatory reading »
  - Blocs de contexte (`previous_summary`, `discarded`, `kept_tail`, `task_state`, `files_touched`, `focus`, `last_user_message`) — même source — ✅ — table « Context blocks »
  - `examples/09-task-continuity` — même source — ✅ (mentionné) — « Task-state snapshot and continuity guidance »
  - `pi-grounded-compaction` (prototype cité) — https://github.com/marcfargas/pi-grounded-compaction — ⚠️ non ouverte (profondeur 2)
- **LangChain `DEFAULT_SUMMARY_PROMPT`** — https://raw.githubusercontent.com/langchain-ai/langchain/master/libs/langchain_v1/langchain/agents/middleware/summarization.py — ✅ lu — « You should structure your summary using the following sections. » ; sections `## SESSION INTENT`, `## SUMMARY`, `## ARTIFACTS`, `## NEXT STEPS`
- **Deep Agents — middleware de compaction** — https://raw.githubusercontent.com/langchain-ai/deepagents/537ed6cf153f9f6e50546c9d8674c32587540942/libs/deepagents/deepagents/middleware/summarization.py — ✅ lu — « Previous summary messages are filtered out to avoid redundant storage during chained summarization events. »
  - `_summarization_event = {cutoff_index, summary_message, file_path}` — même source
  - Blog « Context Management for Deep Agents » — https://blog.langchain.com/context-management-for-deepagents/ — ✅ lu — « added dedicated fields for the session intent and next steps »
- **OpenHands — Condenser (architecture)** — https://docs.openhands.dev/sdk/arch/condenser — ✅ lu — `Condensation{forgotten_event_ids, summary, summary_offset}` ; `LLMSummarizingCondenser(max_size=120, keep_first=4)`
  - Guide `LLMSummarizingCondenser` — https://docs.openhands.dev/sdk/guides/context-condenser — ✅ lu
  - Blog condensation — https://openhands.dev/blog/openhands-context-condensensation-for-more-efficient-ai-agents — ⚠️ non ouverte directement (URL réelle identifiée)
- **Anthropic — Effective context engineering** — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — ✅ lu — « The model preserves architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs or messages. »
- **Manus — Context Engineering (Lessons from Building Manus)** — https://manus.im/en/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus — ✅ lu — « it tends to create a todo.md file—and update it step-by-step as the task progresses, checking off completed items »
- **RE-TRAC** — https://arxiv.org/abs/2602.02486 — ✅ lu (seed) — « a structured state representation … summarize evidence, uncertainties, failures, and future plans »
  - 3 facettes : conclusions+answers / evidence+source verification / uncertainties+exploration trace
- **IterResearch** — https://arxiv.org/abs/2511.07327 — ✅ lu (seed) — « maintaining an evolving report as memory and periodically synthesizing insights »
  - Report Evolution Mechanism / templates d'instruction (App. C.1/E)
- **WebResearcher** — https://arxiv.org/abs/2509.13309 — ✅ lu (seed) — « each round keeps only question + evolving synthesized report + last tool response »
- **ReSum** — https://arxiv.org/abs/2509.13313 — ✅ lu (seed) — « periodically invoking an external tool to condense interaction histories into compact summaries »
- **Agentic Context Engineering (ACE)** — https://arxiv.org/abs/2510.04618 — ✅ lu — « context collapse, where iterative rewriting erodes details over time » ; « structured, incremental updates that preserve detailed knowledge »
- **COMPASS** — https://arxiv.org/abs/2510.08790 — ✅ lu (seed) — « Context Manager synthesizes concise, stage-relevant briefs from persistent structured notes »
- **A Survey of Context Engineering** — https://arxiv.org/abs/2507.13334 — ✅ lu (seed) — taxonomie context processing / context management
- **LangMem Short Term API** — https://langchain-ai.github.io/langmem/reference/short_term/ — ✅ lu — `RunningSummary{summary, summarized_ids, last_id}` + 3 prompts de résumé
  - Guide summarization — https://langchain-ai.github.io/langmem/guides/summarization/ — ✅ lu — « Pass running summary, if any … avoid re-summarizing the same messages »
- **LangChain Short-term memory** — https://docs.langchain.com/oss/python/langchain/short-term-memory — ✅ lu — `SummarizationMiddleware`
- **LangChain — Autonomous context compression** — https://www.langchain.com/blog/autonomous-context-compression — ✅ lu — « retain recent messages (10% of available context) and summarize what comes before »
- **SelfCompact (code, prompts)** — https://github.com/tianjianl/selfcompact (+ `prompts.py`) — ✅ lu — `SUMMARIZE_PROMPT` (bloc `<summary>`/Essential Information), `SELFCHECK_PROMPT` (C1–C3/N1)
- **MemAgent** — https://arxiv.org/abs/2507.02259 — ✅ lu (écarté) — « updates memory through an overwrite strategy … further extend the DAPO algorithm to directly optimize memory ability »

### Table

| Titre | URL/ID | Type | Niveau | Statut | Facette d'état | Fit E2 |
|---|---|---|---|---|---|---|
| pi-live-compaction (11 sections + blocs) | jsdelivr.net/npm/pi-live-compaction@0.1.7/README.md | repo/prompt | 0 | 🟢 nouveau | structure du résumé + `previous_summary` + `task_state` + `files_touched` | 🟢 très précis |
| LangChain `DEFAULT_SUMMARY_PROMPT` | raw.githubusercontent.com/langchain-ai/langchain/…/summarization.py | prompt | 1 | 🟢 nouveau | 4 sections (intent / summary / artifacts / next) | 🟢 |
| Deep Agents summarization middleware | raw.githubusercontent.com/langchain-ai/deepagents/…@537ed6cf/… | code/schema | 1 | 🟢 nouveau | `_summarization_event`, filtre des résumés chaînés | 🟢 |
| Blog Context Management for Deep Agents | blog.langchain.com/context-management-for-deepagents/ | blog | 1 | 🟢 nouveau | intent + next steps ; goal drift | 🟡 |
| OpenHands Condenser (arch) | docs.openhands.dev/sdk/arch/condenser | doc/schema | 1 | 🟢 nouveau | `Condensation{forgotten_event_ids, summary, summary_offset}` | 🟢 |
| OpenHands Condenser (guide) | docs.openhands.dev/sdk/guides/context-condenser | doc/API | 1 | 🟢 nouveau | `LLMSummarizingCondenser(max_size, keep_first)` | 🟡 |
| OpenHands blog condensation | openhands.dev/blog/openhands-context-condensensation-… | blog | 1 | 🟡 (⚠️ non ouverte) | goals / progress / à-faire | 🟡 |
| Anthropic — Effective context engineering | anthropic.com/engineering/effective-context-engineering-for-ai-agents | blog | 0 | 🟢 nouveau | compaction + note-taking (todo) | 🟢 |
| Manus — Context Engineering | manus.im/en/blog/Context-Engineering-for-AI-Agents-… | blog | 0 | 🟢 nouveau | `todo.md` recitation ; schéma de résumé | 🟢 |
| RE-TRAC | arXiv:2602.02486 | arXiv | 0 | 🟢 déjà listé | Structured State Representation (3 facettes) | 🟢 |
| IterResearch | arXiv:2511.07327 | arXiv | 0 | 🟢 déjà listé | evolving report / report-as-memory | 🟢 |
| WebResearcher | arXiv:2509.13309 | arXiv | 0 | 🟢 déjà listé | Think / Report / Action | 🟢 |
| ReSum | arXiv:2509.13313 | arXiv | 1 | 🟢 déjà listé | compact reasoning states | 🟢/🟡 |
| ACE | arXiv:2510.04618 | arXiv | 1 | 🟢 nouveau | playbook, delta incrémental, anti context collapse | 🟢 (🔌 dédup embeddings) |
| COMPASS | arXiv:2510.08790 | arXiv | 0 | 🟡 déjà listé | progress briefs par phase | 🟡 |
| Survey of Context Engineering | arXiv:2507.13334 | arXiv | 0 | 🟡 déjà listé | taxonomie | 🟡 |
| LangMem Short Term API | langchain-ai.github.io/langmem/reference/short_term/ | doc/API | 0 | 🟢 déjà listé | `RunningSummary` + 3 prompts | 🟢 |
| LangMem summarization guide | langchain-ai.github.io/langmem/guides/summarization/ | doc | 1 | 🟡 nouveau | propagation du running summary | 🟡 |
| LangChain Short-term memory | docs.langchain.com/oss/python/langchain/short-term-memory | doc | 0 | 🟢 déjà listé | `SummarizationMiddleware` | 🟢 |
| LangChain — Autonomous context compression | langchain.com/blog/autonomous-context-compression | blog | 0 | 🟡 déjà listé | 10% récent + résumé du reste | 🟡 |
| SelfCompact (prompts) | github.com/tianjianl/selfcompact | repo | 0 | 🟢 déjà listé | `SUMMARIZE_PROMPT`, `SELFCHECK_PROMPT` | 🟢 |
| MemAgent | arXiv:2507.02259 | arXiv | 1 | ⚪ | overwrite RL | ⚪ |

### 🟢 → plugin

- **pi-live-compaction (11 sections)** → `src/prompt.ts` : le README décrit le même jeu « 11 continuity sections » (Brief, User Intent Trail, Constraints, Errors/Dead Ends, Key Decisions, Status, Task Continuity, Open Issues, Next Steps, Mandatory Reading, Files Touched) que `buildCompactionPrompt` reproduit ; c'est la source d'inspiration revendiquée par le plugin — sert de référence pour auditer/aligner les intitulés et l'ordre des sections.
- **pi-live-compaction (blocs de contexte)** → `src/previous-summary.ts` + `src/todo-preserver.ts` : blocs `previous_summary` (« Prior compaction summary (if any) ») et `task_state` (« Live task-tracking snapshot at compaction time ») — équivalents directs de `<previous-summary>` et du snapshot de `TodoPreserver`.
- **LangChain `DEFAULT_SUMMARY_PROMPT`** → `src/prompt.ts` : checklist explicite `SESSION INTENT` / `SUMMARY` / `ARTIFACTS` / `NEXT STEPS` avec consigne « populate it … or explicitly state "None" » (identique au `(none)` du plugin) — utile pour resserrer les sections et garantir les champs non vides.
- **Deep Agents middleware** → `src/previous-summary.ts` : compaction chaînée en **filtrant les messages-résumé précédents** (`lc_source='summarization'`) et en ne ré-injectant que `summary_message + preserved` — schéma réutilisable pour éviter que `extractPreviousSummary` ne ré-ingère un résumé de résumé.
- **OpenHands Condenser** → `src/previous-summary.ts` : schéma de traçabilité `Condensation{forgotten_event_ids, summary, summary_offset}` + `RollingCondenser(start_size/keep_first/max_size)` — modèle concret pour un résumé glissant qui conserve tête (système) + queue (récent) et référence ce qui a été absorbé.
- **Anthropic — compaction + note-taking** → `src/prompt.ts` + `src/todo-preserver.ts` : « preserves architectural decisions, unresolved bugs, and implementation details » mappe Key Decisions / Errors / Open Issues ; « Claude Code creating a to-do list … track progress » justifie la préservation/restauration des todos et la section Status.
- **Manus** → `src/todo-preserver.ts` + `src/prompt.ts` : le motif `todo.md` réécrit pas-à-pas = exactement `TodoPreserver` ; « schema to define the summary fields (files modified, user goals, current state) » alimente Mandatory Reading / Brief / Status.
- **RE-TRAC** → `src/prompt.ts` : les 3 facettes (réponses/conclusions, preuves/source, incertitudes/échecs) recouvrent Status / Errors & Dead Ends / Open Issues / Next Steps.
- **IterResearch** → `src/prompt.ts` + `src/previous-summary.ts` : « evolving report as memory » = Brief/Status qui se mettent à jour à chaque compaction (même rôle que `<previous-summary>`).
- **WebResearcher** → `src/prompt.ts` : triplet Think/Report/Action → Status + Task Continuity + Next Steps.
- **ReSum** → `src/previous-summary.ts` : « compact reasoning states … maintains awareness of prior discoveries » = ancrage du résumé glissant.
- **ACE** → `src/previous-summary.ts` : « structured, incremental updates » contre le « context collapse » = consigne exacte du plugin (« preserving still-true details, removing stale details, merging in new facts ») ; pattern grow-and-refine à imiter. 🔌 l'étape de dédup d'ACE (comparaison par embeddings) est **hors périmètre**.
- **LangMem `RunningSummary`** → `src/previous-summary.ts` : structure `{summary, summarized_ids, last_id}` = état explicite « ne pas re-résumer les messages déjà couverts » (garde anti-recalcul).

### 🟡 → à tirer

- **COMPASS (2510.08790)** : « Context Manager … concise, stage-relevant briefs » → variante de Status par phase (section dynamique).
- **Survey of Context Engineering (2507.13334)** : taxonomie context processing / management → normalisation du vocabulaire des 11 sections.
- **LangChain — Autonomous context compression** : prompt système du tool (quand compacter) et règle « 10% récent » — utile surtout à E1, mais confirme le découpage « résumé + fenêtre récente ».
- **Blog Deep Agents** : preuve A/B que les champs « session intent » + « next steps » améliorent la continuité → argument pour garder Brief + Next Steps.
- **OpenHands guide** : paramétrage `LLMSummarizingCondenser(max_size, keep_first)` → garder les 1ers événements verbatim.
- **OpenHands blog** (URL réelle) : « encoding the user's goals, the progress … and what still has to be done » + « preserves technical details like critical files and failing tests ».
- **LangMem summarization guide** : « avoid re-summarizing the same messages » → logique anti-recalcul du `<previous-summary>`.

### ⚪ écartés

- **MemAgent (arXiv:2507.02259)** — mémoire à longueur fixe par *overwrite* optimisée par RL end-to-end (Multi-Conv DAPO) : entraînement + modification d'architecture → hors E2.
- **Sous-parties « tool-result clearing » / purge** (Anthropic compaction, Manus) — relèvent du folding/purge (E3/E5), pas du contenu du résumé.

### ⚠️ inaccessibles

- **https://github.com/victor-software-house/pi-live-compaction** — `webfetch` **404** ; contenu confirmé via le miroir jsDelivr (README v0.1.7).
- **https://raw.githubusercontent.com/victor-software-house/pi-live-compaction/main/README.md** — **404** ; README obtenu via jsDelivr.
- **https://www.npmjs.com/package/pi-live-compaction** — **403** (anti-bot).
- **https://www.openhands.dev/blog/openhands-context-condensensation-for-more-efficient-ai-agents** — non ouverte directement (URL citée par la doc OpenHands) ; le domaine canonique est `openhands.dev/blog/...`.

### Déjà listé

- **RE-TRAC (2602.02486)**, **IterResearch (2511.07327)**, **WebResearcher (2509.13309)**, **COMPASS (2510.08790)**, **Survey Context Engineering (2507.13334)**, **LangChain short-term memory**, **LangMem `short_term`**, **LangChain blog autonomous compression**, **OpenHands blog condensation**, **selfcompact** — présents dans l'index seed §1 ; seules les déclinaisons concrètes (schéma, prompt, API) sont développées ici.
- **ReSum (2509.13313)** — aussi seed E1 ; ici retenu pour l'ancrage du résumé glissant.

---

## Addendum d'exploration (profondeur / budget)

- **Profondeur atteinte** : 2 (seed → blogs/docs → sources de code). Aucun nœud retenu de profondeur 4.
- **Liens ouverts (E2)** : ~20 (11 seed + 9 nouveaux/sortants).
- **Ré-vérification main agent** (les 3 sources structurantes nouvelles) :
  - `pi-live-compaction@0.1.7` README → **confirmé** : « 11 continuity sections », blocs `previous_summary`/`task_state`/`files_touched`, exemple `09-task-continuity`.
  - `arXiv:2510.04618 (ACE)` → **confirmé** : context collapse + « structured, incremental updates », ICLR 2026.
  - `docs.openhands.dev/sdk/arch/condenser` → **confirmé** : `Condensation{forgotten_event_ids, summary, summary_offset}`, `max_size=120`, `keep_first=4`.
- **Candidats suivants** (non ouverts) : `pi-grounded-compaction` (github.com/marcfargas/pi-grounded-compaction), blog OpenHands condensation, `examples/AGENTS.md` de pi-live-compaction.
- **Budget** : ~20 pages, **sous ~40** ; pas de point de contrôle requis.
