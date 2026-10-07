# Research kickoff — run the compaction literature sweep

Copy-paste prompt to bootstrap a **fresh OpenCode session**: it first reads this
repo to understand `opencode-live-compaction`, then executes
[`research-prompt.md`](./research-prompt.md) (the actual sweep) **as-is**.

Both files live in `docs/` on the `master` branch (this file:
`docs/research-kickoff.md`; instructions: `docs/research-prompt.md`).

Use it when you want a clean, independent run of the sweep without carrying the
current session's context. Nothing is modified in code; the only edits allowed
are docs the operator explicitly asks for.

```text
Tu vas mener une recherche documentaire pour améliorer le plugin OpenCode
« opencode-live-compaction ». Contrainte absolue : NE MODIFIE AUCUN CODE.
Recherche uniquement (les docs du repo peuvent être lues ; n'édite rien sans
demande explicite).

# Étape 0 — situer le repo
Tu es dans le repo `opencode-live-compaction` (ou clone-le :
https://github.com/BaconDroid/opencode-live-compaction). Annonce le chemin
absolu et la branche/commit courants.

# Étape 1 — comprendre le plugin AVANT toute recherche
Lis, dans cet ordre :
1. README.md (vue d'ensemble, features, config, hooks)
2. src/index.ts (hooks : tool.execute.after,
   experimental.session.compacting, experimental.chat.messages.transform,
   experimental.compaction.autocontinue, config, event, tool)
3. src/core/*.ts (prompt, compress, strategies, trim, blocks, expand, eviction,
   preemption, previous-summary, todo-preserver, degradation-monitor,
   files-touched, glob) et src/config/*.ts
4. docs/omo-compaction.md ET docs/context-compaction-research.md — ce qui a
   déjà été fait ou écarté (pour NE PAS reproposer l'existant).
Puis écris un résumé de 5 à 10 lignes : ce que fait le plugin, ses hooks, ses
limites/frontières actuelles. Ne propose rien à ce stade.

# Étape 2 — lire les consignes de recherche
Les consignes vivent dans le repo, branche `master` :
- `docs/research-prompt.md` — les consignes à appliquer.
- `docs/research-kickoff.md` — ce prompt de démarrage.
Si tu n'es pas déjà dans le repo, clone-le :
  https://github.com/BaconDroid/opencode-live-compaction
puis lis `docs/research-prompt.md`. À défaut d'accès local, récupère-le sur la
branche master :
  https://raw.githubusercontent.com/BaconDroid/opencode-live-compaction/master/docs/research-prompt.md
Applique-le TEL QUEL, sans l'adoucir :
- Portée PHASE 1 : liens arXiv seulement (arxiv.org / www.arxiv.org).
- Gate thématique jugé sur le contexte citant + le titre/sous-titres (h1→h4) de
  la page hôte.
- Test d'utilité plugin (implémentable sans entraînement) ; en cas de doute →
  écarter.
- Classement 🟢 direct / 🟡 indirect / ⚪ écarté.
- Profondeur 4, budget ~64 pages.
- Les liens sortants non-arXiv (git, docs, outils) sont réservés à la PHASE 2 :
  ne pas les suivre ici.
- Anti-doublon : ne pas reproposer ce qui est déjà dans
  docs/context-compaction-research.md.

# Étape 3 — recherche
Démarre à :
https://nazmi.tech/blog/context-compaction-llm-agents-fundamentals
Descends récursivement uniquement dans les liens arXiv pertinents (compaction /
gestion du contexte / mémoire d'agent), en appliquant le gate + le test
d'utilité plugin.
Aux limites (profondeur 4 OU ~64 pages) : fais un POINT DE CONTRÔLE (où tu en es,
profondeur atteinte, pages consommées, nœuds retenus non explorés, candidats du
niveau suivant) puis DEMANDE-MOI si je veux continuer (et jusqu'où : +N niveaux /
+N pages).

# Étape 4 — restitution
- L'INDEX arborescent + tableau récapitulatif, comme spécifié dans
  `docs/research-prompt.md` (titre + sous-titres, URL + ID arXiv VÉRIFIÉ,
  statut, raison = courte citation du contexte citant, enfants indentés).
- Pour chaque entrée 🟢 direct : une phrase « comment ça pourrait améliorer le
  plugin », mappée à un fichier/hook précis.
- Les entrées 🟡 indirect : ce qu'on pourrait en tirer éventuellement.
- Optionnel (si je le demande) : consolider l'INDEX dans
  `docs/context-compaction-research.md` (document de référence unique,
  toutes les passes fusionnées) plutôt que de créer un fichier par passe.

# Contraintes
- N'invente jamais un titre/auteur/ID/URL ; si non récupérable →
  « ⚠️ inaccessible » + raison.
- Cite le contexte qui motive chaque décision de pertinence (contexte citant,
  et/ou titre/sous-titre).
- Sépare ce que tu as LU de ce que tu déduis.
- Ne propose PAS de code à ce stade ; attends ma décision avant toute
  modification.

Commence par l'Étape 0 et l'Étape 1, puis montre-moi le résumé et demande-moi
de confirmer AVANT de lancer la recherche.
```
