# Research prompt — context compaction & context management

A reusable prompt to reproduce the literature sweep behind this plugin. Run the
bootstrap in a fresh session, then apply the sweep block as-is. The sweep block
is the single source of the rules (relevance gate, plugin-utility test,
arXiv-only scope, stop conditions, output shape) — do not restate them
elsewhere.

## How to use

Copy the sweep block below into a **fresh OpenCode session** at the repo root.
Run the bootstrap first, then the sweep. Nothing is modified in code; the only
edits allowed are docs the operator explicitly asks for.

### Bootstrap (read the repo before the sweep)

1. `README.md` — overview, features, config, hooks.
2. `src/index.ts` — the hooks (`tool.execute.after`,
   `experimental.session.compacting`, `experimental.chat.messages.transform`,
   `experimental.compaction.autocontinue`, `config`, `event`, `tool`).
3. `src/core/*.ts` (prompt, compress, strategies, trim, blocks, expand,
   eviction, preemption, previous-summary, todo-preserver, degradation-monitor,
   files-touched, glob) and `src/config/*.ts`.
4. `docs/context-compaction-research.md` — what has already been done or
   discarded, so the sweep does **not** re-propose existing work.

Then write a 5–10 line summary of what the plugin does, its hooks and its
current limits. Propose nothing yet; confirm before launching the sweep.

### Sweep prompt

```text
# Mission
Construis un INDEX hiérarchique des travaux **arXiv** sur la compaction de
contexte et la gestion/rétention du contexte des agents LLM, en partant de :
https://nazmi.tech/blog/context-compaction-llm-agents-fundamentals
et de ses suites (Part 2/3/4). Ces 4 URLs sont les seules racines autorisées.

# Portée & phasage
- PHASE 1 (cette recherche) : ne suivre QUE les liens `arxiv.org` /
  `www.arxiv.org` (abs, html, pdf). Tout descendant non-arXiv (blog, docs,
  GitHub, Medium, ACL, site produit) est IGNORÉ : ni listé comme nœud, ni suivi.
- PHASE 2 (différée) : les liens sortants des articles retenus seront examinés
  plus tard ; ils ne servent PAS à décider la traversée en Phase 1.
- [Interrupteur] Suivre les pages ACL (aclanthology.org) : OFF par défaut.

# Test d'utilité plugin (décisif, en plus du gate thématique)
Un lien n'est RETENU (🟢/🟡) que si le CONTEXTE QUI LE CITE permet d'inférer un
mécanisme implémentable SANS entraînement, dans un plugin TS OpenCode, sur au
moins un axe : décider QUAND compacter ; choisir QUOI garder/évincer/résumer ;
rendre la compaction RÉVERSIBLE ; PRÉSERVER contraintes/état/tâche ; ÉVALUER la
compaction.
Exclusions fermes → ne pas lister, ne pas suivre :
  entraînement / RL / fine-tuning seuls ; internes KV-cache (éviction,
  quantization, sparsité attention) ; architecture / état récurrent / SSM ;
  latent / gist / distillation ; multimodal ; sécurité mémoire hors compaction ;
  benchmarks sans mécanisme transposable ; frameworks/harnais génériques ;
  blogs, docs produit, profils d'auteur.
En cas de doute → ÉCARTER.

# Règle de pertinence (gate thématique)
Pour CHAQUE lien extrait, juge à partir :
  (a) du CONTEXTE QUI LE CITE (1–2 phrases autour du lien), ET
  (b) du TITRE de l'article hôte + de ses SOUS-TITRES (h1→h4).
Jamais de l'URL seule.
PERTINENT = compaction de contexte, gestion/rétention de contexte, long-contexte,
résumé, pruning, mémoire d'agent, consolidation cross-session,
déclenchement/évaluation de compaction, contraintes liées au contexte.
Un lien pertinent doit EN PLUS passer le test d'utilité plugin ci-dessus.

# Classement
  🟢 direct   — mécanisme directement exploitable par le plugin
  🟡 indirect — inspirant (à expliciter : « ce qu'on pourrait en tirer »)
  ⚪ écarté   — hors-sujet OU utile non portable (contexte citant requis)
Pour chaque 🟢 : une phrase « comment ça améliorerait le plugin » mappée à un
fichier/hook précis de `opencode-live-compaction`.

# Traversée
1. Fetch la page ; relève ses titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant (1–2 phrases).
3. Applique portée arXiv → gate → test d'utilité plugin.
4. Déduplique les URLs déjà vues (visited set).
5. Journalise brièvement le motif d'exclusion des liens écartés.

# Conditions d'arrêt et reprise
- Profondeur par défaut : 4 niveaux sous la racine.
- Budget par défaut : ~64 pages.
- À toute limite (profondeur OU budget) : POINT DE CONTRÔLE — niveau atteint,
  pages consommées, nœuds retenus non explorés, candidats du niveau suivant —
  puis DEMANDE-MOI s'il faut continuer (et jusqu'où : +N niveaux / +N pages).
- Stop si plus aucun lien ne passe le gate + le test.

# Sortie : INDEX (Markdown)
Arborescent. Pour chaque nœud RETENU :
- **Titre** + **sous-titres** (headings) de la page
- URL arXiv + **ID arXiv vérifié** (relevé sur la page, jamais supposé)
- Statut : 🟢/🟡 visité | ⚪ écarté | ⚠️ inaccessible
- **Raison** : courte citation du contexte citant qui a motivé la décision
- Enfants (récursif), indentés par niveau
Termine par un tableau plat : Titre | ID/URL arXiv | Niveau | Statut | Pertinence.

# Anti-doublon
Ne repropose pas ce qui est déjà traité dans `docs/context-compaction-research.md`
(backlog). Si un item y figure déjà : le signaler « déjà couvert », sans le
re-développer.

# Contraintes
- N'invente jamais un titre, un auteur, un ID ou une URL. Non récupérable →
  « ⚠️ inaccessible » + raison.
- Cite le contexte de décision pour chaque lien (le cas échéant, le titre/sous-titre
  qui l'explique).
- Sépare ce que tu as LU de ce que tu déduis du contexte citant.
```

The consolidated result of the sweep goes into
`docs/context-compaction-research.md`.
