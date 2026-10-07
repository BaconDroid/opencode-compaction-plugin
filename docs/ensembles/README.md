# Ensembles implémentables — recherche ciblée (un E à la fois)

Ce dossier découpe la recherche consolidée ([`../context-compaction-research.md`](../context-compaction-research.md))
en **ensembles implémentables** et fournit, pour chacun, un **prompt approfondi durci**
à exécuter **isolément** (une passe = un ensemble).

## Pourquoi
Un lot = un thème **directement implémentable dans `opencode-live-compaction`** (sans
composant externe requis). On durcit les critères : on ne garde que ce qui **est lié au
thème** et **fit dans l'ensemble**, et on inclut **tous les types de liens** (arXiv,
GitHub, docs, blogs, issues), pas seulement arXiv.

## Ensembles (périmètre interne uniquement)
| Ens. | Thème | Cible plugin | Externe | Fichier |
|---|---|---|---|---|
| E1 | Déclenchement & rythme de compaction | `preemptive-compaction.ts`, `config.ts` | — | [E1-declenchement-rythme.md](./E1-declenchement-rythme.md) |
| E2 | Résumé structuré & continuité d'état | `prompt.ts`, `previous-summary.ts`, `todo-preserver.ts` | — | [E2-resume-continuite.md](./E2-resume-continuite.md) |
| E3 | Folding & compression multi-échelle | `compress.ts`, `index.ts` (transform) | — | [E3-folding-multi-echelle.md](./E3-folding-multi-echelle.md) |
| E5 | Éviction, purge & anti-contamination | `strategies.ts`, `config.ts` | — | [E5-eviction-purge.md](./E5-eviction-purge.md) |

> E4 (réversibilité), E6–E10 sont volontairement hors de ce dossier : ils touchent une
> dépendance externe (🔌) ou un autre périmètre (voir la colonne `Ext.` du doc consolidé).

## Comment exécuter
1. Ouvrir **un seul** fichier d'ensemble.
2. Copier le bloc **« Prompt approfondi »** (§4) tel quel dans une session fraîche.
3. La session produit l'**INDEX de l'ensemble** selon le template (§5) et l'écrit dans le
   fichier indiqué (par défaut : section « Résultat » du même fichier, ou un fichier
   `E<n>-resultat.md`).
4. Ne pas modifier de code.

## Légende des statuts
- 🟢 direct (implémentable tel quel) · 🟡 indirect (inspiration) · ⚪ écarté
- 🔌 composant externe requis (hors périmètre direct)
- `déjà listé` = présent dans l'index seed / le doc consolidé

## Règles communes (durcies)
- **Gate de périmètre** : le contexte citant + titre/sous-titres traitent **exactement** du
  thème de l'ensemble ; pas de dérive vers un thème voisin.
- **Test d'implémentabilité** : sans entraînement **et** sans dépendance externe requise
  (sinon 🔌). En cas de doute → écarter.
- **Anti-doublon** : ne pas reproposer ce qui est déjà dans le doc consolidé ni dans l'index
  seed ; le signaler comme « déjà listé ».
- **Vérification** : ne jamais inventer titre/auteur/ID/URL ; non récupérable → ⚠️ inaccessible.
- **Pas de code** : recherche uniquement.
