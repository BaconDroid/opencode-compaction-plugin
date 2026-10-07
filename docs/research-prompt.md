# Research prompt — context compaction & context management

A reusable prompt to reproduce the literature sweep behind this plugin: start
from the Nazmi context-compaction series, then descend recursively into the
**arXiv** links whose **citing context** (plus the host page's title and
headings) shows they are about context compaction, context management, or agent
memory — and that are actually portable into a TypeScript OpenCode plugin.

Two filters bound the recursion:

1. **Relevance gate** — judged from the citing context and the host page's
   title/subheadings, never from the URL alone. Off-topic links are dropped,
   not followed.
2. **Plugin-utility test** — the mechanism inferred from the citing context must
   be implementable without model training (decide when to compact, choose what
   to keep/evict/summarize, make compaction reversible, preserve
   constraints/state, or evaluate compaction). In doubt → discard.

Scope is **arXiv-only** for the primary pass; outgoing links to repos/docs/tools
found inside retained articles are deferred to a second phase.

To bootstrap a fresh session that reads this repo first and then runs the sweep,
use [`research-kickoff.md`](./research-kickoff.md).

```text
# Mission
Construis un INDEX hiérarchique des travaux **arXiv** portant sur la compaction de
contexte et la gestion/rétention du contexte des agents LLM, **réellement
implémentables** dans le plugin OpenCode `opencode-live-compaction` (TypeScript,
sans entraînement de modèle), en partant de :
https://nazmi.tech/blog/context-compaction-llm-agents-fundamentals
et de ses suites (Part 2/3/4). Ces 4 URLs sont les seules racines autorisées.

# Portée & phasage
- PHASE 1 (cette recherche) : ne suivre QUE les liens `arxiv.org` /
  `www.arxiv.org` (abs, html, pdf). Tout descendant non-arXiv (blog, docs,
  GitHub, Medium, ACL, site produit) est IGNORÉ : ni listé comme nœud, ni suivi.
- PHASE 2 (différée, hors de cette passe) : les liens sortants des articles
  retenus (git/repos, docs, outils) seront examinés plus tard, uniquement pour
  vérifier leur pertinence. Ils ne servent PAS à décider la traversée en Phase 1.
- [Interrupteur] Suivre les pages ACL (aclanthology.org) : OFF par défaut.

# Test d'utilité plugin (décisif, en plus du gate thématique)
Un lien n'est RETENU (🟢/🟡) que si le CONTEXTE QUI LE CITE permet d'inférer un
mécanisme implémentable SANS entraînement, dans un plugin TS OpenCode. Le
mécanisme doit concerner au moins un de ces axes :
  décider QUAND compacter ; choisir QUOI garder/évincer/résumer ; rendre la
  compaction RÉVERSIBLE ; PRÉSERVER contraintes/état/tâche ; ÉVALUER la compaction.
Exclusions fermes → ne pas lister, ne pas suivre :
  - entraînement / RL / fine-tuning seuls ;
  - internes KV-cache (éviction, quantization, sparsité attention) ;
  - architecture / état récurrent / SSM ; latent / gist / distillation ;
  - multimodal ;
  - sécurité mémoire hors compaction ;
  - benchmarks sans mécanisme transposable ;
  - frameworks/harnais génériques ; blogs, docs produit, profils d'auteur.
En cas de doute → ÉCARTER.

# Règle de pertinence (gate thématique)
Pour CHAQUE lien extrait, juge à partir :
  (a) du CONTEXTE QUI LE CITE (1–2 phrases autour du lien), ET
  (b) du TITRE de l'article hôte + de ses SOUS-TITRES (h1→h4).
Jamais de l'URL seule.
PERTINENT (sujet) = compaction de contexte, gestion/rétention de contexte,
long-contexte, résumé, pruning, mémoire d'agent, consolidation cross-session,
déclenchement/évaluation de compaction, contraintes liées au contexte.
HORS-SUJET = sans rapport avec la compaction/contexte.
Un lien pertinent doit EN PLUS passer le test d'utilité plugin ci-dessus.

# Classement
  🟢 direct   — mécanisme directement exploitable par le plugin
  🟡 indirect — inspirant (à expliciter : « ce qu'on pourrait en tirer »)
  ⚪ écarté   — hors-sujet OU utile non portable (contexte citant requis)
Pour chaque 🟢 : une phrase « comment ça améliorerait le plugin » mappée à un
fichier/hook précis de `opencode-live-compaction`.

# Traversée
1. Fetch la page. Relève ses titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant (1–2 phrases).
3. Applique portée arXiv → gate (contexte + titre/sous-titres) → test d'utilité plugin.
4. Déduplique les URLs déjà vues (visited set).
5. Journalise brièvement le motif d'exclusion des liens écartés.
Ne suis AUCUN lien sortant non-arXiv en Phase 1 (réservés à la Phase 2).

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

## Expected shape

- Level 0 — the Nazmi article (the only non-arXiv root, with Part 2/3/4).
- Level 1 — the four compaction families + the follow-ups; the arXiv links
  cited there (semantic compression, LongLLMLingua, Provence, recursive
  summarization, DTCRS, …).
- Level 2 — cited arXiv preprints portable to the plugin (SelfCompact, ACON,
  Governance Decay, the rate-distortion survey, …).
- Level 3 — their references, mostly 🟡 (KV cache / architecture / RL) → discard
  or mark non-portable.
- Level 4 — references of the level-3 papers that stay within the plugin-utility
  test; stop at ~64 pages.

Outgoing non-arXiv links (repos, docs, tools) are **not** followed here; they are
left for a second phase.

See `context-compaction-research.md` — the consolidated reference document
(both sweep passes merged into a single catalog).
