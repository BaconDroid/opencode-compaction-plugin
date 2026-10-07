# Ensemble E1 — Déclenchement & rythme de compaction

> Lot d'analyse **isolé**. Objectif : décider **quand** compacter, dans les limites de
> `opencode-live-compaction` (sans composant externe requis).

---

## 0. Cadre

- **Thème** : déclenchement de la compaction — seuil/budget, déclencheur structurel
  (unité close, fin de sous-tâche, convergence), rubric « quand compacter », contrôleur
  adaptatif, boucle segmentée, règle d'arrêt.
- **Cible plugin** : `src/preemptive-compaction.ts`, `src/config.ts`
  (`preemptiveCompaction.threshold`, `cooldownMs`, `contextLimit`), signaux dans
  `src/index.ts` (`event` `message.updated`, `tool.execute.after`).
- **Externe** : — (aucune dépendance requise).
- **À NE PAS inclure** (autres ensembles) : contenu du résumé (E2), mécanique de fold (E3),
  purge/éviction (E5), mémoire long terme (E7/E8).

---

## 1. Index seed (issu de l'analyse consolidée)

| Réf | ID/URL | Type | Statut | Pertinence (contexte citant) |
|---|---|---|---|---|
| SelfCompact | arXiv:2606.23525 | arXiv | 🟢 déjà listé | « compaction tool + task-specific rubric … a subtask has resolved, or the trajectory is converging » |
| ReSum | arXiv:2509.13313 | arXiv | 🟢 déjà listé | « periodically calls an external tool to condense interaction history » (déclencheur budget) |
| InftyThink | arXiv:2503.06692 | arXiv | 🟢 déjà listé | « bounded segments separated by concise summaries » (arrêt sur conclusion, `max_iters`) |
| TALE | arXiv:2412.18547 | arXiv | 🟢 déjà listé | « token elasticity » : un budget trop serré fait **monter** l'usage |
| SCM | arXiv:2304.13343 | arXiv | 🟢 déjà listé | « summarize when activation memory > 2000 tokens » + contrôleur |
| Governance Decay | arXiv:2606.22528 | arXiv | 🟢 déjà listé (surtout E6) | pinning déclenché **après** compaction |
| LightThinker | arXiv:2502.15589 | arXiv | 🟡 déjà listé | « thought-level segmentation preserved accuracy better » vs intervalle fixe |
| Rate–Distortion survey | arXiv:2607.08032 | arXiv | 🟡 déjà listé | axe **Timing** (before / during / after) |

**Backlog E1** : #1 rubric SelfCompact · #22 déclencheur structurel multi-échelle ·
#29 contrôleur de mémoire + seuils · #31 budget minimum (TALE).

---

## 2. Liens non-arXiv à explorer (le durcissement impose de les inclure)

| Réf | URL | Type | À quoi ça sert ici |
|---|---|---|---|
| Claude Code — Automatic context compaction (cookbook) | https://platform.claude.com/cookbook/tool-use-automatic-context-compaction | docs | déclencheur officiel « context length reaches a target threshold » |
| Anthropic Claude Code | https://github.com/anthropics/claude-code | GitHub | prior art du trigger + `/compact` |
| Cursor — Self-summarization | https://cursor.com/blog/self-summarization | blog | déclenchement « composer » / self-summarization |
| LangChain — Autonomous context compression | https://www.langchain.com/blog/autonomous-context-compression | blog | tool de résumé + timing (concurrent direct de SelfCompact) |
| Codex auto-compaction (critique) | https://www.reddit.com/r/codex/comments/1qib69i/auto_compaction_is_not_that_helpful/ | discussion | échecs de timing à éviter |
| SelfCompact (code) | https://github.com/tianjianl/selfcompact | GitHub | implémentation de la rubric de déclenchement |
| OpenCode — hook `experimental.compaction.autocontinue` / `session.summarize` | docs repo local (`README.md`, `src/index.ts`) | code local | API réelle du déclenchement |

> Vérifier chaque URL au fetch ; ne pas présumer d'un contenu.

---

## 3. Critères durcis (spécifiques E1)

1. **Gate de périmètre** : le lien doit porter sur **le moment/la condition** de compaction,
   pas sur son contenu ni sa mécanique de stockage.
2. **Fit implémentable** : le mécanisme doit pouvoir modifier/remplacer
   `shouldTriggerPreemptiveCompaction` (`src/preemptive-compaction.ts`) ou les signaux
   `event`/`tool.execute.after` — sans entraînement ni service externe.
3. **Signal exploitable** : la condition de déclenchement doit être calculable à partir de
   données déjà disponibles (tokens, structure des messages, fin d'outil, `finish`,
   sous-tâche) ; une condition nécessitant un modèle/juge supplémentaire → 🔌?.
4. En cas de doute → **écarter**.

---

## 4. Prompt approfondi (à exécuter tel quel, un E à la fois)

```text
# Mission
Produis un INDEX hiérarchique des travaux et implémentations portant EXACTEMENT sur
« le déclenchement et le rythme de la compaction de contexte » et directement
implémentables dans le plugin OpenCode `opencode-live-compaction` (TypeScript, sans
entraînement, sans composant externe requis). On veut savoir QUAND compacter.

# Périmètre (durci, tous types de liens)
- Sources autorisées : TOUT type — arXiv, GitHub (repos/articles/PR/issues/discussions),
  docs produit/officielles, blogs d'ingénierie, cookbooks, specs, READMEs. PAS seulement arXiv.
- Partir de l'index seed et de la liste non-arXiv de ce fichier, puis descendre.
- N'inclure un lien QUE s'il satisfait LES DEUX conditions :
  (a) GATE DE PÉRIMÈTRE — le contexte citant ET le titre/sous-titres portent sur le
      DÉCLENCHEMENT/rythme de la compaction (seuil, budget, structurel, rubric, contrôleur,
      boucle segmentée, arrêt). Pas sur le contenu du résumé, la mécanique de fold, la purge,
      la mémoire long terme, le KV-cache.
  (b) TEST D'IMPLÉMENTABILITÉ-IMMÉDIATE — le signal de déclenchement est calculable à partir
      de données déjà présentes dans le plugin (tokens, structure des messages, fin d'appel
      d'outil, finish, sous-tâche) OU via un simple appel modèle déjà disponible. Si le
      mécanisme exige un service/modèle/entraînement externe → flag 🔌 et ne l'inclure que
      si le bénéfice justifie la dépendance.
- Interdits : RL/fine-tuning, KV-cache, architecture/SSM, latent/gist/distillation,
  multimodal, benchmarks sans mécanisme de déclenchement transposable.

# Anti-doublon
Le contenu de l'index seed ci-dessus et du doc `docs/context-compaction-research.md` (§4 E1)
n'est PAS nouveau : le marquer « déjà listé » et ne développer QUE ce qui est nouveau, plus
précis, ou une implémentation concrète (repo, API, paramètre).

# Traversée
1. Fetch chaque page. Relève titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant (1–2 phrases).
3. Applique le gate de périmètre, puis le test d'implémentabilité.
4. Visited set (dédup). Journalise brièvement le motif d'exclusion des liens écartés.
5. Profondeur max 4 ; budget ~40 pages. À la limite : POINT DE CONTRÔLE (profondeur atteinte,
   pages, nœuds retenus non explorés, candidats suivants) puis me demander s'il faut continuer.

# Classement
🟢 direct — modifier/remplacer directement `shouldTriggerPreemptiveCompaction` ou les signaux
            `event`/`tool.execute.after` (mappé à un fichier/hook)
🟡 indirect — inspiration, à expliciter
⚪ écarté — hors périmètre OU non portable (contexte citant requis)
🔌 — nécessite un composant externe (signalé séparément)

# Sortie : INDEX (Markdown) pour CET ensemble
- Arborescent : Titre + sous-titres ; URL + ID vérifié ; statut ; raison = citation citante ;
  enfants indentés.
- Tableau plat : Titre | URL | Type (arXiv/GitHub/docs/blog) | Niveau | Statut | Signal de
  déclenchement | Fit E1.
- Pour chaque 🟢 : une phrase « comment ça améliore le plugin » + fichier/hook cible.
- Pour chaque 🟡 : « ce qu'on pourrait en tirer ».
- Section « Inaccessible ⚠️ » avec raison.
- Section « Déjà listé » (références présentes mais non nouvelles).

# Contraintes
- N'invente jamais titre/auteur/ID/URL ; non récupérable → « ⚠️ inaccessible » + raison.
- Cite le contexte qui motive chaque décision. Sépare ce que tu as LU de ce que tu DÉDUIS.
- NE MODIFIE AUCUN CODE. Écris uniquement l'INDEX dans le fichier de sortie demandé.
```

---

## 5. Template de sortie (INDEX E1)

```
## INDEX E1 — Déclenchement & rythme
### Arborescence
- <Titre> — <URL + ID> — <statut> — « <citation citante> »
  - <enfant> …

### Table
| Titre | URL/ID | Type | Niveau | Statut | Signal | Fit E1 |
|---|---|---|---|---|---|---|

### 🟢 → plugin
- <Réf> → <fichier/hook> : <phrase>

### 🟡 → à tirer
- <Réf> : <phrase>

### ⚪ écartés
- <Réf> — <motif>

### ⚠️ inaccessibles
- <Réf> — <raison>

### Déjà listé
- <Réf> — <raison>
```

**Fichier de sortie** : ajouter la section « Résultat » en fin de ce fichier (ou
`E1-resultat.md`).
