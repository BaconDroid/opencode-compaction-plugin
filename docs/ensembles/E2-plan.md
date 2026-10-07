# Plan d'implémentation E2 — Résumé structuré & continuité d'état

> Source : `E2-resultat.md`. Cible : `src/prompt.ts` (11 sections),
> `src/previous-summary.ts` (résumé glissant), `src/todo-preserver.ts` (état de tâche),
> `src/index.ts` (`experimental.session.compacting`). **Aucun code de production modifié.**
> Statut : recherche + inspection code faites ; plan prêt à découper en PRs.

---

## 1. Objectif

Fiabiliser la continuité : un résumé glissant `<previous-summary>` **sans re-résumé**,
un bloc `<task-state>` structuré (IDs/statuts/dépendances), des sections de contrat
alignées sur l'ancêtre `pi-live-compaction`, et des garde-fous anti-hallucination —
sans store ni embeddings.

## 2. Sources inspectées (code réutilisable)

| Source | URL | Réutilisable pour E2 |
|---|---|---|
| **pi-live-compaction** (template + blocs) | https://cdn.jsdelivr.net/npm/pi-live-compaction@0.1.7/dist/config/prompts.mjs · https://cdn.jsdelivr.net/npm/pi-live-compaction@0.1.7/examples/09-task-continuity/compaction-prompt.md | **Le plus proche** : blocs `<previous-summary>`, `<discarded-conversation>`, `<kept-tail>`, `<task-state>`, `<files-touched>`, `<focus>`, `<latest-user-ask>` ; sections Brief / User intent trail / Constraints & preferences / Errors, fixes, and dead ends / Key decisions / Status (marqueurs `[DONE]/[IN PROGRESS]/[TODO]/[BLOCKED]/[FAILED]/[UNVERIFIED]`) / Task continuity / Open issues & uncertainties / Immediate next steps / Mandatory reading. |
| **OpenHands** `llm_summarizing_condenser.py` | https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py | snapshot de tâche : `TASK_TRACKING` (IDs + statuts **préservés**), `COMPLETED / PENDING / CURRENT_STATE / CODE_STATE / TESTS / CHANGES / DEPS` ; `Condensation(forgotten_event_ids, summary, summary_offset, llm_response_id)` ; `keep_first`. |
| **deepagents** `summarization.py` | https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/deepagents/deepagents/middleware/summarization.py | état machine `SummarizationEvent{cutoff_index, summary_message, file_path}` (clé privée) ; `_filter_summary_messages` (écarte `lc_source=="summarization"`) ; `_build_new_messages_with_path` ; `_compute_state_cutoff`. |
| **LangChain** `summarization.py` | https://raw.githubusercontent.com/langchain-ai/langchain/master/libs/langchain_v1/langchain/agents/middleware/summarization.py | `DEFAULT_SUMMARY_PROMPT` : sections `## SESSION INTENT / ## SUMMARY / ## ARTIFACTS / ## NEXT STEPS` + règle « populate … or explicitly state "None" » ; message de remplacement tagué ; `_find_safe_cutoff_point` (coupe respectant les paires AI/Tool). |
| **selfcompact** `prompts.py` | https://raw.githubusercontent.com/tianjianl/selfcompact/main/prompts.py | `SUMMARIZE_PROMPT` : bloc `<summary>` à champ unique `Essential Information` ; garde-fou anti-hallucination (ne garder que le certain). |

Extraits clés :
```
<previous-summary>{{ previous_summary }}</previous-summary>
<task-state>{{ task_state }}</task-state>
<latest-user-ask>{{ last_user_message | truncate: 800 }}</latest-user-ask>
```
```
TASK_TRACKING: {Active tasks, their IDs and statuses - PRESERVE TASK IDs}
COMPLETED: ... PENDING: ... CURRENT_STATE: ... CODE_STATE: ... TESTS: ... CHANGES: ...
```

## 3. Mapping vers le plugin

- `src/prompt.ts` — `buildCompactionPrompt({filesTouched, previousSummary})` (l.11-83), template 11 sections, bloc `previousBlock` (l.19-21).
- `src/previous-summary.ts` — `extractPreviousSummary(messages)` (l.16-31).
- `src/todo-preserver.ts` — `TodoSnapshot`, `extractTodos`, `TodoPreserver`.
- `src/index.ts` — `experimental.session.compacting` (l.513-578) : capture todos (l.517-525), fetch previous summary (l.529-549), manifeste (l.551-557), `buildCompactionPrompt` (l.560-563).
- `src/files-touched.ts` — `renderManifest()` (déjà branché).

## 4. Étapes ordonnées

1. **Bloc `<task-state>`** (indépendante). Étendre `TodoPreserver`/`TodoSnapshot` en un rendu
   `<task-state>` (IDs, statuts, priorités, dépendances si présentes) et l'injecter dans le
   prompt via un nouveau paramètre `taskState?`. Cible : `todo-preserver.ts` + `prompt.ts` +
   `index.ts` (passer `renderTaskState()`).
2. **Marqueurs de statut + règle « None »** (indépendante). Aligner la section `## Status`
   sur `[DONE]/[IN PROGRESS]/[TODO]/[BLOCKED]/[FAILED]/[UNVERIFIED]` et généraliser le
   placeholder `(none)` à toutes les sections. Cible : `prompt.ts`.
3. **Focus / latest-user-ask** (dépend de 1). Injecter `<focus>` (dérivé du dernier message
   utilisateur, tronqué) ou `<latest-user-ask>` dans le prompt. Cible : `index.ts`
   (compacting) + `prompt.ts`.
4. **État glissant machine** (dépend de 1). Ajouter un état par session
   `{ lastSummaryMessageId?, cutoffIndex? }` pour (a) ne pas re-résumer les messages déjà
   couverts, (b) filtrer les messages-résumé précédents avant ré-injection. Cible :
   `previous-summary.ts` + `index.ts`.
5. **Anti-hallucination** (indépendante). Consigne « ne conserver que l'information certaine
   ou explicitement énoncée » ; option : bloc `Essential Information` pour les faits neufs
   avant fusion dans les sections. Cible : `prompt.ts`.

## 5. Esquisse technique

```ts
// prompt.ts
export function buildCompactionPrompt(input: {
  filesTouched?: string; previousSummary?: string;
  taskState?: string; focus?: string;
}): string
```
```ts
// todo-preserver.ts
export function renderTaskState(todos: TodoSnapshot[]): string
// - [ ] content  (status=TODO, priority=high)
// - [~] content  (status=IN_PROGRESS)
// - [x] content  (status=DONE)
```
```ts
// previous-summary.ts
export interface SlidingState { lastSummaryMessageId?: string; cutoffIndex?: number }
export function extractPreviousSummary(messages: unknown, state?: SlidingState): string | undefined
```

## 6. Tests & critères d'acceptation

- `test/prompt.test.ts` : présence des 11 sections, marqueurs de statut, règle `(none)`,
  injection `taskState`/`focus`/`previousSummary` ; ordre inchangé.
- `test/previous-summary.test.ts` : filtrage des messages-résumé chaînés ; `cutoffIndex`
  respecté ; pas de double résumé.
- `test/todo-preserver.test.ts` : `renderTaskState` (statuts, IDs, vide → `(none)`).
- Critères : (a) un résumé de résumé n'apparaît pas deux fois ; (b) `task-state` reflète
  l'état exact à l'instant de compaction ; (c) le prompt reste valide si `taskState`/`focus`
  absents.

## 7. Risques / régressions

- Le contrat 11 sections est **testé** (`prompt.test.ts`) : toute réorganisation casse des
  tests → garder l'ordre et n'ajouter que des blocs.
- `extractPreviousSummary` est utilisé en mode `replace` : ne pas casser la détection
  `info.summary === true`.
- L'état glissant est en mémoire (pas de store) → réinitialiser sur `session.deleted`
  (déjà géré pour d'autres maps, cf. `index.ts:739-749`).

## 8. Découpage en PRs

1. `prompt.ts` : marqueurs de statut + règle `(none)` + tests.
2. `todo-preserver.ts` + `prompt.ts` : bloc `<task-state>` (+ tests).
3. `previous-summary.ts` + `index.ts` : état glissant + filtrage chaîné (+ tests).
4. `index.ts` + `prompt.ts` : `<focus>`/`<latest-user-ask>` (+ tests).
