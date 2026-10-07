# INDEX E5 — Éviction, purge & anti-contamination

> Ensemble E5 · « QUOI retirer et COMMENT le détecter ». Cible : `src/strategies.ts`
> (`applyPurgeErrors`, `applyDedup`), `src/config.ts` (`purgeErrors.turns`, `dedup`),
> `src/index.ts` (`experimental.chat.messages.transform`). Un juge LLM → 🔌? ; un
> classifieur entraîné → ⚪.
>
> **Méthode** : index seed §1 + liens non-arXiv §2, puis descente (profondeur ≤ 3).
> **Vérification** : 5 sources structurantes 🟢 ont été **ré-ouvertes et confirmées** par le
> main agent (CCRM, TokenPilot, Semantic Early-Stopping, Plans Don't Persist, pi-cwl). Les
> autres proviennent du crawl subagent et sont signalées.

---

## INDEX E5 — Éviction, purge & anti-contamination

### Arborescence

- **Why Retrying Fails: Context Contamination in LLM Agent Pipelines (CCRM)** — https://arxiv.org/abs/2605.08563 — 🟢 **nouveau** — « the failed attempt typically remains in its context window — contaminating the next attempt and elevating the per-step error rate beyond the base level »
  - « clean-restart dominance theorem quantifying the exact benefit of context-clearing before retry » ; cascade ratio ε₁/ε₀ = 7.1 (SWE-bench Verified)
- **Beyond Compaction: Structured Context Eviction for Long-Horizon Agents (CWL)** — https://arxiv.org/abs/2606.11213 — 🟢 (seed 🟡) — « a deterministic, LLM-free policy evicts content in priority order within that structure when a token budget is exceeded »
  - Implémentation de référence : https://github.com/Kiz8-Team/pi-cwl — « User turns are never evicted » ; épisodes `expl`/`act` + DAG de dépendances ; niveaux gradués reasoning → bulk output → intermediate → épisode
- **Governance Decay: How Context Compaction Silently Erases Safety Constraints…** — https://arxiv.org/abs/2606.22528 — 🟢 (seed, surtout E6) — « compaction optimizes for task continuity and treats standing policies as low-salience content »
  - *Constraint Pinning* : « a training-free defense that quarantines governance constraints from lossy compaction » ; « treat the summarizer as an untrusted-input sink »
- **Context Repair for LLMs: Pilot v2 (ThoughtDAG)** — https://chenxiachan.github.io/thoughtdag/research/context-repair-pilot-v2/ — 🟢 (non revérifié) — « Deleting just the original bad message repaired 152… Removing the whole contaminated thread repaired 162 of 162 »
  - « Deleting a bad message does not clean the conversation. Anything that quoted it or built on it keeps carrying the error. »
- **TokenPilot: Cache-Efficient Context Management for LLM Agents** — https://arxiv.org/abs/2606.17016 — 🟢 🔌? — « Lifecycle-Aware Eviction monitors the ongoing residual utility of context segments, enforcing a conservative batch-turn schedule »
  - états `active / completed / evictable` + purge par lots ; estimateur résiduel model-based → 🔌?
- **Semantic Early-Stopping for Iterative LLM Agent Loops** — https://arxiv.org/abs/2606.27009 — 🟢 — « the loop halts when consecutive draft embeddings stop changing in meaning (cosine distance with a patience window) »
  - variante *judge-free* : « a judge-free semantic stopper reduces operational tokens by 38% … at parity quality »
- **Contextual Drag: How Errors in the Context Affect LLM Reasoning** — https://arxiv.org/abs/2602.04288 — 🟢 déjà listé — « the presence of failed attempts in the context biases subsequent generations toward structurally similar errors »
  - mitigation test-time dénoising « Revise »/« Filter » → dépend du jugement du modèle (🔌?)
- **How Memory Management Impacts LLM Agents** — https://arxiv.org/abs/2505.16067 — 🟢 déjà listé — « a record will be removed if a) it has been retrieved for at least n times, and b) the average utility … is below a prescribed threshold β »
- **Lost in the Noise: How Reasoning Models Fail with Contextual Distractors** — https://arxiv.org/abs/2601.07226 — 🟡 déjà listé — « hard negatives are the worst offenders » (motivation, pas de mécanisme)
- **A Survey on the Memory Mechanism of LLM-based Agents** — https://arxiv.org/abs/2404.13501 — 🟡 déjà listé — opération **forget** (taxonomie)
- **Rethinking Memory in LLM-based Agents** — https://arxiv.org/abs/2505.00675 — 🟡 déjà listé — opérations **Forgetting / Condensation** (conceptuel)
- **ACON: Optimizing Context Compression for Long-horizon LLM Agents** — https://arxiv.org/abs/2510.00615 — 🟡 déjà listé (🔌) — « distinguish observations vs history ; guidelines »
  - repo https://github.com/microsoft/acon — pipeline de distillation/entraînement → ⚪
- **Free(): Learning to Forget in Malloc-Only Reasoning Models** — https://arxiv.org/abs/2602.08030 — ⚪ (seed) — élagage via adaptateur LoRA entraîné
- **microsoft/memento** — https://github.com/microsoft/memento — ⚪ (seed) — éviction de blocs KV cache (interne)
- **Context Rot** — https://trychroma.com/research/context-rot — 🟡 déjà listé — pourquoi le contenu obsolète nuit (motivation)
- **selfcompact** — https://github.com/tianjianl/selfcompact — 🟡 déjà listé (🔌?/E1) — gate par rubrique LLM (C1–C3, N1)
- **Deterministic Agent Runtime with Context Pruning** — https://zyvop.com/the-harness-is-the-moat-building-a-deterministic-agent-runtime-with-context-pruning-a0rct — 🟡 (non revérifié) — « The failed action and its error log are not appended to the primary active history »
- **Plans Don't Persist: Why Context Management Is Load Bearing for LLM Agents** — https://arxiv.org/abs/2606.22953 — 🟡 **nouveau** — « naive plan eviction cuts ALFWorld success by 34.7pp »

### Table

| Titre | URL/ID | Type | Niveau | Statut | Cible d'éviction | Fit E5 |
|---|---|---|---|---|---|---|
| Why Retrying Fails (CCRM) | arXiv:2605.08563 | papier | 1 | 🟢 nouveau | essai échoué entier (input+output) | purge d'erreurs déterministe |
| Beyond Compaction (CWL) | arXiv:2606.11213 + Kiz8-Team/pi-cwl | papier+repo | 1 | 🟢 (seed 🟡) | épisodes `act` puis `expl`, par niveaux | éviction structurée LLM-free |
| Governance Decay | arXiv:2606.22528 | papier | 1 | 🟢 déjà listé (E6) | contraintes distraites/épinglées | anti-contamination |
| ThoughtDAG Pilot v2 | chenxiachan.github.io/…/context-repair-pilot-v2/ | blog/pilote | 1 | 🟢 (non revérifié) | message fautif + descendants | purge par dépendance |
| TokenPilot | arXiv:2606.17016 | papier (EMNLP Findings) | 1 | 🟢 🔌? | segments par utilité résiduelle | éviction par état + batch tours |
| Semantic Early-Stopping | arXiv:2606.27009 | papier | 1 | 🟢 nouveau | arrêt du loop (dérive de brouillons) | règle d'arrêt sans juge |
| Contextual Drag | arXiv:2602.04288 | papier | 0 | 🟢 déjà listé | brouillons erronés | motivation + dénoising 🔌? |
| How Memory Management | arXiv:2505.16067 | papier (ACL 2026) | 0 | 🟢 déjà listé | enregistrements à faible utilité | règle `retrieved≥n` + β |
| OpenHands Condenser | openhands.dev/blog/… + docs.openhands.dev/sdk/arch/condenser | blog+docs | 1 | 🟡 | événements oubliés (`forgotten_event_ids`) | mécanique d'éviction |
| Lost in the Noise | arXiv:2601.07226 | papier | 0 | 🟡 déjà listé | distracteurs | motivation |
| Memory Survey | arXiv:2404.13501 | survey | 0 | 🟡 déjà listé | — | taxonomie |
| Rethinking Memory | arXiv:2505.00675 | survey | 0 | 🟡 déjà listé | Forgetting/Condensation | taxonomie |
| ACON | arXiv:2510.00615 + microsoft/acon | papier+repo | 0 | 🟡 déjà listé (🔌) | observations vs historique | compression |
| Plans Don't Persist | arXiv:2606.22953 | papier | 1 | 🟡 nouveau | éviction du plan (à éviter) | garde d'éviction |
| Deterministic Runtime | zyvop.com/…context-pruning… | blog | 2 | 🟡 (non revérifié) | erreurs non ajoutées, rollback | purge + arrêt |
| Context Rot | trychroma.com/research/context-rot | rapport | 0 | 🟡 déjà listé | — | motivation |
| selfcompact | github.com/tianjianl/selfcompact | repo | 0 | 🟡 déjà listé (🔌?/E1) | compression auto (rubrique) | E1 |
| Free() | arXiv:2602.08030 | papier | 0 | ⚪ (seed) | chunks (LoRA entraîné) | ⚪ |
| memento | github.com/microsoft/memento | repo | 0 | ⚪ (seed) | blocs KV cache | ⚪ |
| IntentKV / LRE / AgeMem / What Eviction Destroys / Selective Forgetting / FSFM / Auditing Forgetting / Spectral Kill Switches / Doomed from the Start / Deletion Is Not Forgetting | arXiv:2606.09916 / 2606.20954 / ACL 2026.981 / 2609.08279 / 2608.28978 / 2604.20300 / 2607.00605 / 2511.05804 / 2607.06503 / SSRN 7428966 | divers | 2–3 | ⚪ (non revérifiés) | KV / scorer entraîné / store externe / activations | hors périmètre |

### 🟢 → plugin

- **CCRM (2605.08563)** → `src/strategies.ts` (`applyPurgeErrors`) + `src/index.ts:672-686` : évincer **tout l'essai échoué** (input **et** output erroné) au-delà du seuil de tours, et non seulement `state.input` comme aujourd'hui (`strategies.ts:186`). Le théorème « clean-restart dominance » (ratio de cascade 7.1) justifie de ne pas conserver l'échec dans le contexte actif. Critère **déterministe** : statut d'erreur + âge en tours.
- **CWL (2606.11213) + pi-cwl** → nouveau `applyEviction` dans `src/strategies.ts`, appelé dans `src/index.ts` (transform) : niveaux gradués `reasoning → bulk output → intermediate → épisode`, **plus ancien `act` d'abord**, en respectant un DAG de dépendances ; **ne jamais évincer les tours `role === "user"`** (contraste avec le trim actuel qui coupe la queue, `index.ts:177`). Politique **LLM-free**, directement transposable.
- **Governance Decay (2606.22528)** → `src/config.ts` (nouvelles clés `pinnedPatterns`/`invariantIndices`) + `src/index.ts` (`config`/transform) : exclure les contraintes épinglées de `applyDedup`/`applyPurgeErrors` et vérifier qu'elles survivent au transform ; l'attaque « Compaction-Eviction » motive de filtrer le contenu adverse avant purge (déjà repéré en E1/E6).
- **ThoughtDAG Pilot v2** → `applyPurgeErrors`/`applyDedup` (`strategies.ts`) : purge en **cascade** des messages qui citent l'appel purgé (matching `callID`/args), pas seulement la source. Complète le purge « un niveau » actuel.
- **TokenPilot (2606.17016)** → `src/config.ts` (`dedup`/`purgeErrors`) : registre d'états `active/completed/evictable` + `eviction.batchTurns` ; estimateur de résiduel model-based → 🔌? (version dégradée par âge de tour possible).
- **Semantic Early-Stopping (2606.27009)** → `DegradationMonitor` (`src/config.ts:69-76`, `degradation-monitor.ts`) : règle d'arrêt *judge-free* `cosine(draft_t, draft_{t-1}) < ε` sur `k` tours (ε=0.06, k=2) — 38 % de tokens en moins à qualité égale.

### 🟡 → à tirer

- **OpenHands Condenser** : remplacer la sortie dédupliquée par un marqueur adossé à un identifiant d'événement oublié (`forgotten_event_ids`), comme le `[deduped: …]` actuel (`strategies.ts:118`).
- **zyvop « Deterministic Runtime »** : garder seulement les derniers messages bruts, ne pas ajouter les erreurs à l'historique actif, rollback après échecs identiques consécutifs — seuils prêts à porter dans `purgeErrors`/`dedup` (blog, à confirmer).
- **Contextual Drag (déjà listé)** : pipeline dénoising « Filter » (garder seulement les étapes correctes) — efficace mais « relies on the model's own, unreliable judgment » → juge LLM 🔌?.
- **How Memory Management (déjà listé)** : critère `retrieved ≥ n` **et** utilité moyenne < β — précis mais suppose un évaluateur/score, à approximer côté plugin.
- **selfcompact (déjà listé)** : rubrique C1/C2/C3 + N1 ; N1 bloque la compression quand l'agent est coincé → gate LLM 🔌?.
- **Plans Don't Persist** : protéger le plan et les observations récentes ; l'éviction naïve coûte −34,7 pp (garde d'éviction), mais aucune politique déterministe fournie.
- **ACON (déjà listé)** : distinction « observations vs history » exploitable pour **typer** la cible d'éviction, mais le compresseur est optimisé par LLM.

### ⚪ écartés

- **Free() (2602.08030)** — Free-Module = adaptateur LoRA entraîné.
- **microsoft/acon (repo)** — pipeline de distillation/entraînement de compresseur.
- **microsoft/memento (repo)** — masquage de blocs KV cache, hors pipeline de messages.
- **IntentKV (2606.09916)**, **LRE (2606.20954)**, **AgeMem (ACL 2026.981)**, **Spectral Kill Switches (2511.05804)**, **Doomed from the Start (2607.06503)** — KV cache / scorer entraîné / états internes du modèle (non revérifiés).
- **What Eviction Destroys (2609.08279)**, **Selective Forgetting (2608.28978)**, **FSFM (2604.20300)**, **Auditing Forgetting (2607.00605)**, **Deletion Is Not Forgetting (SSRN 7428966)** — store mémoire externe (non revérifiés).
- **Surveys 2404.13501 / 2505.00675, Lost in the Noise, Context Rot** — motivation/taxonomie sans mécanisme d'éviction.

### ⚠️ inaccessibles

- Aucune des 13 sources seed n'a échoué. Note : l'URL seed non canonique de CWL (`exa.ai/library/publication/…`) est remplacée par l'URL réellement citable **https://arxiv.org/abs/2606.11213** (le dépôt `pi-cwl` précise que la soumission arXiv était bloquée puis publiée).

### Déjà listé

- **2602.04288 (Contextual Drag)**, **2505.16067 (+ ACL 2026.27)**, **2601.07226 (Lost in the Noise)**, **2404.13501**, **2505.00675**, **2510.00615 (ACON)**, **2602.08030 (Free())**, **2606.11213 (CWL)**, **microsoft/acon**, **microsoft/memento**, **trychroma context-rot**, **tianjianl/selfcompact** — sources seed.
- Développement autorisé du *plus précis* : le critère de suppression de **2505.16067** (`retrieved ≥ n` **et** `avg utility < β`) et la distinction observations/historique d'**ACON** sont les seuls ajouts de granularité utiles.

---

## Addendum d'exploration (profondeur / budget)

- **Profondeur atteinte** : 3. Aucun nœud retenu de profondeur 4.
- **Liens ouverts (E5)** : ~30 (13 seed + ~17 nouveaux/sortants).
- **Ré-vérification main agent** (5 sources structurantes) :
  - `arXiv:2605.08563` (CCRM) → **confirmé** : clean-restart dominance, cascade ε₁/ε₀ = 7.1.
  - `arXiv:2606.17016` (TokenPilot) → **confirmé** : Lifecycle-Aware Eviction, batch-turn schedule, EMNLP 2026 Findings.
  - `arXiv:2606.27009` (Semantic Early-Stopping) → **confirmé** : stopper judge-free par distance cosinus, −38 % de tokens.
  - `arXiv:2606.22953` (Plans Don't Persist) → **confirmé** : éviction naïve du plan = −34,7 pp sur ALFWorld.
  - `github.com/Kiz8-Team/pi-cwl` → **confirmé** : CWL, épisodes `expl`/`act`, « User turns are never evicted », éviction graduée déterministe.
- **Non revérifiés par le main agent** (crawl subagent uniquement) : ThoughtDAG Pilot v2, zyvop, et les IDs ⚪ (IntentKV, LRE, AgeMem, What Eviction Destroys, Selective Forgetting, FSFM, Auditing Forgetting, Spectral Kill Switches, Doomed from the Start, Deletion Is Not Forgetting) — à revalider avant usage.
- **Backlog #5 (`purgeErrors.turns`)** : **constat LU dans le code** — la clé est **déjà branchée** (`src/index.ts:674-677`, `getRecentTurnIndices(messages, config.purgeErrors.turns ?? 4)`). Le backlog « config inutilisée » du doc consolidé est **périmé** ; le vrai manque (CCRM) est d'évincer l'**essai entier** (input+output) au-delà de N tours, et de **propager** la purge aux descendants contaminés (ThoughtDAG).
- **Budget** : ~30 pages, **sous ~40** ; pas de point de contrôle requis.
