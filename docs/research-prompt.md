# Research prompt — context compaction & context management

A reusable prompt to reproduce the literature sweep behind this plugin: start
from the Nazmi context-compaction series, then descend recursively into the
links whose **citing context** shows they are about context compaction, context
management, or agent memory — and build a titled index.

The relevance gate is judged from the surrounding text, not the URL, which is
what keeps the recursion bounded (off-topic links are dropped, not followed).

```text
# Mission
Construis un INDEX hiérarchique de tout ce qui touche à la compaction de
contexte, la gestion du contexte et la mémoire des agents LLM — utile pour
améliorer un plugin OpenCode de compaction — en partant de :
https://nazmi.tech/blog/context-compaction-llm-agents-fundamentals
puis descends récursivement dans les liens qui relèvent de ces sujets.

# Règle de pertinence (gate) — décisive
Pour CHAQUE lien extrait, juge à partir du CONTEXTE QUI LE CITE (1–2 phrases),
jamais de l'URL seule.
PERTINENT = le contexte indique un sujet de : compaction de contexte,
gestion/rétention de contexte, long-contexte, résumé, pruning, mémoire d'agent,
consolidation cross-session, déclenchement/évaluation de compaction, sécurité et
contraintes liées au contexte. → on descend.
HORS-SUJET = sujet sans rapport avec la compaction/contexte (ex. un article sur
un framework d'agents générique, un profil d'auteur, un projet sans lien).
→ on écarte, on ne descend pas.
Classe chaque lien pertinent en :
  🟢 direct   — mécanisme/outil directement exploitable par le plugin
  🟡 indirect — inspirant (KV-cache, architecture, quantization, RL, latent...)
En cas de doute : "à examiner", ne pas descendre.

# Traversée
1. Fetch la page. Relève ses titres/sous-titres (h1→h4).
2. Extrais chaque lien AVEC son contexte citant.
3. Applique le gate : pertinent → descends (fetch, répète) ; hors-sujet → écarte.
4. Déduplique les URLs déjà vues.

# Conditions d'arrêt
- Profondeur max : 3 niveaux sous la racine.
- Budget : ~40–50 pages max.
- Stoppe dès qu'un niveau n'ajoute plus aucun lien pertinent.

# Sortie : INDEX (Markdown)
Arborescent. Pour chaque nœud :
- **Titre** + **sous-titres** (headings) de la page
- URL
- Statut : 🟢/🟡 visité | ⚪ écarté (hors-sujet) | ⚠️ inaccessible
- **Raison** : courte citation du contexte qui a motivé la décision
- Enfants (récursif), indentés par niveau

Termine par un tableau plat : Titre | URL | Niveau | Statut | Pertinence.

# Contraintes
- N'invente jamais un titre, un auteur ou une URL ; si non récupérable →
  "⚠️ inaccessible" + raison.
- Cite le contexte de décision pour chaque lien.
- Sépare ce que tu as LU directement de ce que tu déduis du contexte citant.
- Pour les pages de références (arXiv HTML, ACL), tu peux descendre au niveau
  suivant, toujours via le gate.
```

## Expected shape

- Level 0 — the Nazmi article.
- Level 1 — the four compaction families + the follow-ups (Part 2/3/4).
- Level 2 — cited preprints relevant to the plugin (Governance Decay, the
  rate-distortion survey, SelfCompact, ACON, Mem0, RAPTOR, …).
- Level 3 — deeper references, mostly 🟡 (KV cache / architecture / RL), then
  stop.

See `context-compaction-research.md` for the result of one such sweep.
