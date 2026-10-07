# Synthèse transversale — ensembles E1, E2, E3, E5

> Récapitulatif des 4 passes de recherche ciblée (`E1-resultat.md`, `E2-resultat.md`,
> `E3-resultat.md`, `E5-resultat.md`). Aucun code modifié. Recherche uniquement.
> Périmètre : les 4 ensembles **internes** (sans composant externe requis). Les items `🔌`
> sont signalés en fin de document.

---

## 1. Trouvailles les plus actionnables, par ensemble

### E1 — Déclenchement & rythme (`src/preemptive-compaction.ts`, `src/config.ts`, `src/index.ts`)
1. **Garde de queue « ne pas compacter s'il reste < ~5 appels »** (ai-infrastructure.net) → `shouldTriggerPreemptiveCompaction` : garde la moins chère et non implémentée par les triggers publiés.
2. **Cache-tokens et déclenchement** (Claude Cookbook) → `totalInputTokens()` (`preemptive-compaction.ts:26-28`) additionne `input + cache.read` ; le cookbook avertit que les cache-tokens déclenchent prématurément → décider de les exclure du seuil.
3. **Gate d'éligibilité du tool `compress` à ~50 % du trigger + trigger en fraction 85 %** (Deep Agents `summarization.py`) → `compress.ts` + `config.ts` : empêche une compaction manuelle précoce.

### E2 — Résumé & continuité (`src/prompt.ts`, `src/previous-summary.ts`, `src/todo-preserver.ts`)
1. **pi-live-compaction = ancêtre direct de `prompt.ts`** (miroir jsDelivr) → `prompt.ts`/`previous-summary.ts`/`todo-preserver.ts` : blocs `previous_summary`, `task_state`, `files_touched` — sert de référence d'alignement des 11 sections.
2. **OpenHands `Condensation{forgotten_event_ids, summary, summary_offset}` + RollingCondenser(`keep_first`)** → `previous-summary.ts` : schéma de traçabilité et de rétention tête+queue.
3. **Deep Agents : filtrer les messages-résumé précédents lors de la compaction chaînée** → `previous-summary.ts` : évite de ré-ingérer un résumé de résumé (anti « context collapse » ACE `2510.04618`).

### E3 — Folding multi-échelle (`src/compress.ts`, `src/index.ts`)
1. **`opencode-context-compress`** (plugin OpenCode, npm `@skybluejacket/…`) → `compress.ts` : `compress({summary,topic})` **sans indices** + `squash({from,to,…})` ; **solution directe au problème #10** (indices non observables).
2. **`context-fold`** (Middlewatch) → `compress.ts` + `index.ts` : ancrage par digest sha256 + `unfold` réversible + ladder (~12 %).
3. **ACE-Elasticizer (`2606.31564`, sans entraînement)** → `index.ts` (transform) : couche sans perte conservant brut + abstraction, choix `raw | abstract | drop` par étape.

### E5 — Éviction, purge & anti-contamination (`src/strategies.ts`, `src/config.ts`)
1. **CCRM (`2605.08563`)** → `applyPurgeErrors` + `index.ts:672-686` : évincer **tout l'essai échoué** (input **et** output) au-delà de N tours (aujourd'hui seul `state.input` est purgé, `strategies.ts:186`).
2. **CWL / `pi-cwl` (`2606.11213`)** → nouveau `applyEviction` dans `strategies.ts` : éviction graduée `reasoning → bulk output → intermediate → épisode`, plus ancien `act` d'abord, **jamais** les tours `user`, LLM-free.
3. **ThoughtDAG Pilot v2** → `applyPurgeErrors`/`applyDedup` : purge **en cascade** des messages qui citent l'appel purgé (par `callID`/args).

---

## 2. Recoupements et doublons entre ensembles

- **SelfCompact (`2606.23525`)** : présent en E1 (rubric/gates, 🟢), E2 (prompts de résumé), E3 (écarté, échelle unique) → traiter la **rubric** en E1 et le **format de résumé** en E2 ; ne pas dupliquer l'implantation.
- **Governance Decay (`2606.22528`)** : E1 (pinning post-compaction), E5 (anti-contamination), E6 (périmètre principal) → conserver le **pinning** comme cible E6, ne réutiliser en E1/E5 que comme justification.
- **CWL (`2606.11213`)** : listé E3 (⚪, « éviction ») et E5 (🟢) → **une seule** cible, `strategies.ts` (E5). La ligne E3 renvoie à E5.
- **Blogs LangChain (`autonomous-context-compression`, `context-management-for-deepagents`)** : E1 (timing), E2 (résumé/tool), E3 (échelle) → la **mécanique de trigger** va en E1, le **format de résumé** en E2.
- **Claude Cookbook (auto compaction)** : E1 (seuil/cache), E2/E3 (résumé) → la valeur ajoutée est en **E1**.
- **Deep Agents `summarization.py`** : E1 (trigger/gate) et E2 (compaction chaînée) → **deux** usages distincts, non conflictuels.
- **Anthropic « Effective context engineering »** : E1/E2/E5 (compaction, note-taking, tool-result clearing) → source **transversale** de justification.
- **`context-fold` / `opencode-context-compress`** : E3 (folding/échelle) mais leur `unfold`/ledger relève aussi de **E4** (réversibilité) → à coordonner avec E4 si rouvert.
- **ACE — collision de noms** : **ACE « Agentic Context Engineering » `2510.04618`** (E2, anti context collapse) ≠ **ACE « Adaptive Context Elasticizer » `2606.31564`** (E3, raw/abstract/drop). Sources distinctes, ne pas confondre.
- **`How Memory Management Impacts` (`2505.16067`)** : E5 (critère de suppression) et E8 (mémoire cross-session) → retenu en E5 pour le critère `retrieved≥n ∧ utility<β`.
- **Correction de backlog** : **#5 « brancher `purgeErrors.turns` »** est **périmé** — la clé est déjà branchée (`index.ts:674-677`). Le manque réel (E5) est l'éviction de l'essai entier + la purge en cascade.

---

## 3. Items 🔌 (hors périmètre direct de `live-compaction`)

> `🔌` = composant externe requis ; `🔌?` = dépendance optionnelle (version interne dégradée possible).

- **E1** : 🔌? **SelfCompact** (le verdict de rubric nécessite un appel modèle ; une version déterministe à gates reste possible) · 🔌 compaction **server-side** Anthropic (service externe, hors plugin).
- **E2** : 🔌 étape de **dédup par embeddings** d'ACE (`2510.04618`) — le reste du format est interne.
- **E3** : 🔌 **Memento** (vLLM modifié + pipeline SFT) · 🔌? **selfcompact** (FAISS/BM25 pour le corpus) · l'index/retrieval d'`unfold` renvoie à **E4** (sidecar/vecteurs).
- **E5** : 🔌? **TokenPilot** (estimateur de résiduel model-based) · 🔌? **Contextual Drag** (dénoising par jugement du modèle) · 🔌? **selfcompact** (rubrique LLM) · 🔌 **microsoft/acon** (distillation/entraînement) · ⚪ classifieurs/scoreurs entraînés (LRE, AgeMem, Free(), IntentKV).
- **Transversal (déjà hors des 4 E)** : **E4** (index de retrieval des évincés), **E7/E8** (store mémoire / graphe / cross-session), **E6** (juge LLM de validation), **E9** (modèle de scoring perplexité), **E10** (juge/benchmark).

---

## 4. Ordre d'implémentation suggéré (issu du croisement)

1. **Quick wins internes** : E1 (garde de queue ; décision cache-tokens) · E5 (évincer l'essai entier — CCRM) · E3 (fiabiliser `compress` via `opencode-context-compress`, résout #10).
2. **Continuité** : E2 (blocs `previous_summary`/`task_state` alignés sur pi-live-compaction ; filtrage de la compaction chaînée).
3. **Efficacité contexte** : E5 (CWL éviction graduée + purge en cascade) · E3 (ACE-Elasticizer `raw/abstract/drop`).
4. **Sécurité/contraintes** : E1/E5 (pinning Governance Decay) → à basculer vers E6.
5. **Arrêt/dérive** : E5 (Semantic Early-Stopping judge-free sur `DegradationMonitor`).

---

## 5. Statut de vérification

- **Ré-ouverts et confirmés par le main agent** : E1 (8 seeds arXiv + SelfCompact code + LangChain + Claude Cookbook + Anthropic) ; E2 (pi-live-compaction, ACE `2510.04618`, OpenHands Condenser) ; E3 (context-fold, opencode-context-compress, ACE `2606.31564`, Focus `2601.07190`, opencode-context-compactor) ; E5 (CCRM, TokenPilot, Semantic Early-Stopping, Plans Don't Persist, pi-cwl).
- **Non revérifiés indépendamment** (crawl subagent uniquement, signalés dans chaque fichier) : quelques items E3 (U-Fold `2601.18285`, Recursive Models `2603.02112`, CAT `2512.22087`, ContextWeaver `2604.23069`, page MS Agent Framework, smolagents #901), items E5 (ThoughtDAG Pilot v2, zyvop, et les IDs ⚪).
- **Inaccessibles** : E1 — thread Reddit r/codex (page non servie) ; E2 — GitHub direct `pi-live-compaction` (404, contenu obtenu via jsDelivr) ; E3 — `hermes-agent-evolved` (404).
