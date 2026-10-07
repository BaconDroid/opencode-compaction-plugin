# INDEX E1 — Déclenchement & rythme de compaction

> Ensemble E1 · « QUAND compacter ». Cible : `src/preemptive-compaction.ts`,
> `src/config.ts` (`preemptiveCompaction.*`), signaux `event` / `tool.execute.after`
> (`src/index.ts`). Aucune dépendance externe requise.
>
> **Méthode** : index seed de `E1-declenchement-rythme.md` §1 + liste non-arXiv §2, puis
> descente (profondeur ≤ 4). Chaque lien a été **ouvert** (LU) sauf mention ⚠️. Les
> verdicts de portabilité/mapping sont **DÉDUITS**. `déjà listé` = présent dans l'index seed
> ou dans `docs/context-compaction-research.md` §4 E1.

---

## INDEX E1 — Déclenchement & rythme

### Arborescence

- **Self-Compacting Language Model Agents** (SelfCompact) — https://arxiv.org/abs/2606.23525 — 🟢 déjà listé — « a lightweight rubric specifying when to fire (a sub-task has resolved, or the trajectory is converging) and when to suppress (mid-derivation, or when stuck) »
  - **SelfCompact (code)** — https://github.com/tianjianl/selfcompact — 🟢 **nouveau** — README : « First-principles rubric … C1 Closed-unit … C2 Summarizable … C3 Progress … N1 Not-stuck » + « once cheap gates pass (min round, min tokens, period, per-trajectory cap) »
- **ReSum: Unlocking Long-Horizon Search Intelligence via Context Summarization** — https://arxiv.org/abs/2509.13313 — 🟢 déjà listé — « periodically invoking an external tool to condense interaction histories into compact summaries » (déclencheur budget)
- **InftyThink: Breaking the Length Limits of Long-Context Reasoning in Large Language Models** — https://arxiv.org/abs/2503.06692 — 🟢 déjà listé — « interleaving short reasoning segments with concise progress summaries … sawtooth memory pattern … `max_iters` » (arrêt sur conclusion)
- **Token-Budget-Aware LLM Reasoning (TALE)** — https://arxiv.org/abs/2412.18547 — 🟢 déjà listé — « dynamically adjusts the number of reasoning tokens based on the reasoning complexity » (token elasticity)
- **SCM: Enhancing Large Language Model with Self-Controlled Memory Framework** — https://arxiv.org/abs/2304.13343 — 🟢 déjà listé — « a memory controller updating memories and determining when and how to utilize memories »
- **Governance Decay: How Context Compaction Silently Erases Safety Constraints…** — https://arxiv.org/abs/2606.22528 — 🟢 déjà listé (surtout E6) — pinning déclenché **après** compaction
- **LightThinker: Thinking Step-by-Step Compression** — https://arxiv.org/abs/2502.15589 — 🟡 déjà listé — « compresses verbose thought steps into compact representations » (surtout E3/E10)
- **What to Keep, What to Forget: A Rate–Distortion View of Memory Compaction…** — https://arxiv.org/abs/2607.08032 — 🟡 déjà listé — axe **Timing** (before / during / after)
- **Automatic context compaction** (Claude Cookbook) — https://platform.claude.com/cookbook/tool-use-automatic-context-compaction — 🟢 **nouveau** — « `compaction_control` … `context_token_threshold` (default: 100,000) » ; « Cache tokens accumulate across sampling loops, which can trigger compaction prematurely »
  - **Effective context engineering for AI agents** (Anthropic) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — 🟡 — « too aggressive compaction can result in the loss of subtle but critical context » ; tool-result clearing = lightest compaction
- **Autonomous context compression** (LangChain blog, 2026-03-11) — https://www.langchain.com/blog/autonomous-context-compression — 🟢 **nouveau** — « It is not ideal to compact when you're in the middle of a complex refactor … better … when you are starting a new task »
  - **Context Management for Deep Agents** (LangChain blog, 2026-01-28) — https://blog.langchain.com/context-management-for-deepagents/ — 🟢 **nouveau** — « three main compression techniques, triggered at different frequencies » ; « when we added dedicated fields for the session intent and next steps »
    - **Deep Agents `summarization.py`** (source) — https://raw.githubusercontent.com/langchain-ai/deepagents/537ed6cf153f9f6e50546c9d8674c32587540942/libs/deepagents/deepagents/middleware/summarization.py — 🟢 **nouveau** — « compact tool execution is gated by `_is_eligible_for_compaction`, which requires reported usage to reach about 50% of the configured auto-summarization trigger » ; `trigger=("fraction", 0.85)`, `keep=("fraction", 0.10)`
- **When to Compact: Trigger Policy for Agent Context** (AI Infrastructure KB) — https://ai-infrastructure.net/compaction-trigger-policy/ — 🟢 **nouveau** — « do not compact when fewer than about five calls remain » ; « oracle … the ceiling on trigger quality is 4.6× the value of the summarisation mechanism »
- **Agent-initiated self-compaction** (agentpatterns.ai) — https://agentpatterns.ai/context-engineering/agent-initiated-self-compaction/ — 🟢 **nouveau** — « Where the boundaries are externally observable (a sub-agent return, a passing test), a deterministic trigger the harness fires is auditable »
- **Context Compaction Is a Decision, Not a Threshold** (Blake Crosley, blog) — https://blakecrosley.com/blog/agent-context-compaction — 🟡 — « the right trigger for forgetting is semantic (is the work at a safe boundary?), not numeric (is the buffer full?) »
- **Training Composer for longer horizons** (Cursor blog ; seed « Self-summarization ») — https://cursor.com/blog/self-summarization — ⚪ (RL) — « Composer generates from a prompt until a fixed token-length trigger is reached » ; carries « conversation state (plan state, remaining tasks, number of prior summarizations) »
- **anthropics/claude-code** — https://github.com/anthropics/claude-code — 🟡 — prior art du trigger `/compact` (repo général, pas de spec de seuil sur la page)
- **AutoCompact: Learning When to Compact Context in Long-Horizon Coding Agents** — https://arxiv.org/abs/2610.02163 — ⚪ (SFT+RL) — « trains a coding agent to decide when to compact, what to preserve, and how to continue »
- **StateComp: Learning When to Compress History in Long Horizon Agents** — https://arxiv.org/abs/2609.27298 — ⚪ (router entraîné) — « determines when historical interactions can be safely compressed according to the current agent state » ; « a positive router prediction does not immediately trigger a summary call »
- **LLM Agents Are Latent Context Managers** — https://arxiv.org/abs/2606.30005 — 🟡 (cité non ouvert) — « proprioceptively blind to their own context » (justifie un trigger externe)
- **Evidence for Limited Metacognition in LLMs** — https://arxiv.org/abs/2509.21545 — ⚪ (cité non ouvert) — hors périmètre (métacognition générale)

### Table

| Titre | URL/ID | Type | Niveau | Statut | Signal de déclenchement | Fit E1 |
|---|---|---|---|---|---|---|
| SelfCompact | arXiv:2606.23525 | arXiv | 1 | 🟢 déjà listé | rubric : sous-tâche résolue / convergence ; suppression : mid-derivation / stuck | `preemptive-compaction.ts` |
| SelfCompact (code) | github.com/tianjianl/selfcompact | GitHub | 2 | 🟢 nouveau | gates min-round/min-tokens/period/cap + C1–C4 citables | `preemptive-compaction.ts` + prompt outil |
| ReSum | arXiv:2509.13313 | arXiv | 1 | 🟢 déjà listé | appel périodique d'un outil de condensation | seuil budget |
| InftyThink | arXiv:2503.06692 | arXiv | 1 | 🟢 déjà listé | segments bornés + `max_iters` (arrêt sur conclusion) | borne d'itérations |
| TALE | arXiv:2412.18547 | arXiv | 1 | 🟢 déjà listé | budget dynamique selon complexité (token elasticity) | budget minimum |
| SCM | arXiv:2304.13343 | arXiv | 1 | 🟢 déjà listé | « mémoire > 2000 tokens » + contrôleur | seuil + contrôleur |
| Governance Decay | arXiv:2606.22528 | arXiv | 1 | 🟢 déjà listé (E6) | pinning post-compaction | — (E6) |
| LightThinker | arXiv:2502.15589 | arXiv | 1 | 🟡 déjà listé | frontière de pensée / métrique Dependency | 🟡 |
| Rate–Distortion | arXiv:2607.08032 | arXiv | 1 | 🟡 déjà listé | axe Timing (before/during/after) | taxonomie |
| Claude cookbook (auto compaction) | platform.claude.com/cookbook/… | docs | 2 | 🟢 nouveau | `context_token_threshold` (défaut 100k) ; attention aux cache-tokens | `preemptive-compaction.ts` |
| Anthropic — Effective context engineering | anthropic.com/engineering/… | blog | 2 | 🟡 | compaction = premier levier ; tool-result clearing | indirect |
| LangChain — Autonomous context compression | langchain.com/blog/… | blog | 2 | 🟢 nouveau | catalogue « quand compacter » ; 10% récent conservé | prompt outil / config |
| LangChain — Context Management for Deep Agents | blog.langchain.com/… | blog | 2 | 🟢 nouveau | 3 paliers de fréquence : offload 20k, truncate args 85%, summarize 85% | `preemptive-compaction.ts` |
| Deep Agents `summarization.py` | raw.githubusercontent.com/… | code | 3 | 🟢 nouveau | tool gate à ~50% du trigger ; trigger 0.85 / keep 0.10 | `preemptive-compaction.ts` |
| When to Compact (trigger policy) | ai-infrastructure.net/… | blog | 2 | 🟢 nouveau | garde de queue « < ~5 appels restants » ; append sans substituer (KV) | `preemptive-compaction.ts` |
| Agent-initiated self-compaction | agentpatterns.ai/… | docs | 2 | 🟢 nouveau | trigger déterministe si frontière observable ; sinon rubric | `index.ts` (event/tool) |
| Context Compaction Is a Decision… | blakecrosley.com/blog/… | blog | 2 | 🟡 | trigger sémantique vs numérique | indirect |
| Cursor — Training Composer | cursor.com/blog/self-summarization | blog | 2 | ⚪ (RL) | trigger à longueur fixe ; état conversationnel | ⚪ |
| anthropics/claude-code | github.com/anthropics/claude-code | GitHub | 1 | 🟡 | `/compact` + auto-compaction | indirect |
| AutoCompact | arXiv:2610.02163 | arXiv | 2 | ⚪ (SFT+RL) | trigger appris + correction trigger/état/continuation | ⚪ (structure 🟡) |
| StateComp | arXiv:2609.27298 | arXiv | 2 | ⚪ (router) | KEEP/READY + gates de span/tokens | ⚪ (structure 🟡) |
| LLM Agents Are Latent Context Managers | arXiv:2606.30005 | arXiv | 3 | 🟡 | « proprioceptive blindness » | justification |
| Limited Metacognition in LLMs | arXiv:2509.21545 | arXiv | 2 | ⚪ | métacognition générale | hors sujet |

### 🟢 → plugin

- **SelfCompact (rubric + gates)** → `src/preemptive-compaction.ts` + `src/compress.ts` : remplacer/décorer `shouldTriggerPreemptiveCompaction` par une rubric à gates déterministes d'abord (min-round, min-tokens, période, cap par trajectoire) puis conditions C1 (unité close) / C2 (résumable en 3–5 faits) / C3 (progrès) / N1 (non bloqué) — les gates bon marché évitent d'évaluer la rubric à chaque tour.
- **SelfCompact (code, `SELFCHECK_PROMPT` / `first_principles_verdict`)** → `src/compress.ts` : reprendre la rubric dans la description de l'outil `compress` et dans un nudge système ; c'est exactement le levier « rubric-gated verification » qui, selon l'ablation (Table 5), fait la différence contre un simple intervalle fixe.
- **Claude cookbook — seuil + cache-tokens** → `src/preemptive-compaction.ts` : `totalInputTokens()` (l. 26–28) additionne `input + cache.read` ; le cookbook avertit que « cache tokens … can trigger compaction prematurely ». Décision de design : ne déclencher que sur les tokens non-cache, ou exposer un flag `countCacheTokens` (cible aussi `src/config.ts`).
- **Deep Agents — trigger fraction + gate du tool** → `src/preemptive-compaction.ts` + `src/config.ts` : adopter des seuils **fraction de la fenêtre** (déjà via `threshold`/`contextLimit`) et surtout le **gate d'éligibilité du tool `compress`** (~50% du trigger) pour empêcher une compaction « manuelle » trop précoce (aujourd'hui aucune garde basse dans `compress`).
- **Deep Agents / LangChain — paliers de fréquence** → `src/preemptive-compaction.ts` : distinguer ≥2 paliers (offload/trim à fréquence haute, summarization à fréquence basse) au lieu d'un unique `threshold` ; mappe sur la politique du transform déjà en place.
- **AI Infrastructure KB — garde de queue** → `src/preemptive-compaction.ts` : ajouter une règle « ne pas compacter s'il reste < ~N étapes/appels » (aucun trigger publié ne le fait ; le gain est décrit comme le moins cher disponible). Signal `finish`/nombre d'outils déjà observables.
- **agentpatterns.ai — trigger déterministe sur frontière observable** → `src/index.ts` (`event` `message.updated`, `tool.execute.after`) : quand une frontière est externe (retour de sous-agent, test qui passe, fin de tâche `todos`), déclencher sur l'événement plutôt que sur un compteur ; réserve la rubric aux frontières internes.
- **LangChain — catalogue « quand compacter »** → `src/compress.ts` : injecter les 5 déclencheurs opportuns (nouvelle tâche, après extraction d'un résultat, avant gros contexte, avant processus multi-étapes, décision qui invalide le passé) dans la description de l'outil et/ou un prompt de nudge.

### 🟡 → à tirer

- **Cursor — Training Composer** : porter dans le contexte de reprise les champs d'état « plan state, remaining tasks, number of prior summarizations » (le mécanisme est RL, mais le schéma d'état est transposable au prompt E2).
- **AutoCompact** : sa triple correction (trigger / working-state / continuation) donne un bon **plan d'évaluation** de nos déclenchements, même si l'entraînement est exclu.
- **StateComp** : séparer « potentiel de compression » (prédiction) de « exécution de la réécriture » (coût) — utile pour ne pas résumer des fragments trop petits (cf. `compress` range min).
- **Anthropic — Effective context engineering** : « tool result clearing » comme forme la plus sûre/ légère de compaction, à privilégier avant un summary complet.
- **anthropics/claude-code** : observer le comportement réel d'auto-compaction et `/compact` comme référence de terrain (pas de spec chiffrée sur la page).
- **blakecrosley.com** : argumentaire « décision vs seuil » à citer en justification produit.
- **LLM Agents Are Latent Context Managers** : argument de vente du trigger externe (« proprioceptive blindness »), à citer, non à implanter.

### ⚪ écartés

- **Cursor — Training Composer (self-summarization)** — comportement **entraîné** (RL, compaction-in-the-loop) → non portable sans entraînement.
- **AutoCompact (2610.02163)** — SFT + RL → ⚪ pour l'implantation directe (structure de taxonomie conservée en 🟡).
- **StateComp (2609.27298)** — router entraîné sur représentations cachées → ⚪.
- **CompactionRL / SWE-Compressor / SWE-MeM** (cités par AutoCompact) — méthodes apprises (RL/SFT) ; IDs non vérifiés → ⚪, non retenus.
- **Evidence for Limited Metacognition in LLMs (2509.21545)** — hors périmètre (métacognition générale).

### ⚠️ inaccessibles

- **Codex auto-compaction (critique)** — https://www.reddit.com/r/codex/comments/1qib69i/auto_compaction_is_not_that_helpful/ — le fetch n'a renvoyé que « Reddit » (page non servie au robot / contenu dynamique) → ⚠️ inaccessible ; non exploité.

### Déjà listé

- **SelfCompact (2606.23525)**, **ReSum (2509.13313)**, **InftyThink (2503.06692)**, **TALE (2412.18547)**, **SCM (2304.13343)**, **Governance Decay (2606.22528)**, **LightThinker (2502.15589)**, **Rate–Distortion (2607.08032)** — présents dans l'index seed §1 et le doc consolidé §4 E1 ; seules les déclinaisons **concrètes** (code SelfCompact, gates, ablation Table 5) sont développées ici.

---

## Addendum d'exploration (profondeur / budget)

- **Profondeur atteinte** : 3 (racines non-arXiv → blogs/docs → source Deep Agents). Aucun nœud retenu non exploré de profondeur 4.
- **Pages ouvertes (E1)** : ~18 (8 arXiv seed + 6 non-arXiv + 4 sortants : Deep Agents `summarization.py`, Anthropic context-engineering, LangChain deepagents blog, + recherches).
- **Candidats suivants** (non ouverts, hors budget) : `MiniMaxAI/MiniMax-M2.5` (seuil 30% de fenêtre, carte modèle HuggingFace), pages « context/memory » de ai-infrastructure.net et agentpatterns.ai, doc officielle Cursor `dynamic context discovery`.
- **Budget** : sous ~40 pages ; **pas de point de contrôle requis**.
