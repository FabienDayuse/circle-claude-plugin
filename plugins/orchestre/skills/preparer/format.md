# Format d'un plan orchestre

Un plan est un dossier `plans/<nom>/`, commité sur la branche d'intégration `plan/<nom>`, créée depuis la branche de base (`main` par défaut) :

```
plans/<nom>/
├── taches/T01-<slug>.md …   # une tâche par fichier, gabarit ci-dessous
├── SUIVI.md                 # une ligne par tâche ; seul le scribe l'écrit ensuite
├── HANDOFF.md               # l'en-tête seul à la création (plus les décisions d'un plan converti)
├── DISCOVERY.md             # amorcé avec l'exploration
└── orchestre.config.json
```

plan-lint (`node <plugin>/scripts/plan-lint.mjs plans/<nom>`) lit le frontmatter des tâches et la colonne Statut de SUIVI.md ; avec `--integration`, une tâche dont le commit « tâche <id> : » est sur la branche d'intégration, et pas sur la branche de base, compte comme fusionnée. Il refuse : tâche sans `id`, `phase`, `modele`, `verification` ou `definition_du_fini` ; identifiant en double ; dépendance inconnue, cyclique ou vers une phase ultérieure ; deux tâches d'une même phase, sans dépendance entre elles ni ressource commune, qui possèdent les mêmes fichiers.

## Règles de découpage

- Phase = étape de réalisation (par exemple : modèle et droits, interfaces, recette). Une phase ne démarre que quand toutes les tâches des phases précédentes sont fusionnées ou annulées.
- Des tranches verticales, chacune sous 50 % de contexte. Pas de micro-tâches : chaque tâche coûte un worker, une vérification, une évaluation, une fusion et un suivi.
- L'ordre d'exécution ne vient que de `phase`, `depend_de` et `ressources` : deux tâches d'une même phase, sans dépendance entre elles ni ressource commune, peuvent tourner en même temps, chacune dans un worktree si le parallélisme choisi au lancement le permet. Elles ne doivent alors posséder aucun fichier en commun. Déclare les ressources (base, port, service) au plus juste : deux tâches qui en partagent une tournent l'une après l'autre. `lot_parallele` et la colonne Lot de SUIVI.md sont indicatifs : rien ne les lit.
- Chaque critère de la définition du fini se démontre par le diff ou par une commande de `verification` lancée dans le contexte de la tâche. La première commande de `verification` sert aussi de contrôle après fusion : mets-y la plus représentative.
- Aucune commande de `verification` ne lit des données de production ou personnelles réelles. Une répétition sur données réelles (dump de prod) est une étape de l'humain, écrite dans la procédure de déploiement, avec des commandes vérifiées dans le dépôt.
- Un test n'écrit pas dans une base partagée comme la base de dev : il utilise une base de test dédiée, que le script de test recrée.
- Une dernière tâche de revue globale, sur opus, en lecture seule. Elle vérifie aussi que commentaires, DECISIONS et procédures disent vrai.
- Identifiants : lettres majuscules puis chiffres, suffixe de lettres permis (T01, T02, T02B). Les tâches ajoutées en cours de run prennent un suffixe.
- Estimation de tokens par tâche : 0,5 × max_tours × taille de contexte visée, plus 30 % pour la vérification et l'évaluation. Sur le pilote, le réel a été de 3 à 8 fois plus élevé : c'est un ordre de grandeur, pas un budget.

## Gabarit de tâche

```markdown
---
id: T01
titre: …
phase: 1
modele: sonnet          # haiku | sonnet | opus | fable
effort: high            # low | medium | high | xhigh | max
depend_de: []
lot_parallele: 1A
fichiers_possedes:
  - chemin/**
ressources: []          # base, port… partagés : sérialise les tâches
budget_contexte: 40%
estimation_tokens: 1.0M
max_tours: 60
verification:
  - "<commande réelle, trouvée pendant l'exploration>"
definition_du_fini:
  - "<critère démontrable par le diff ou par une commande de vérification>"
---

## Prompt de lancement
Tu réalises T01 sur la branche tache/T01. Lis d'abord DISCOVERY.md,
puis les fichiers listés dans Contexte utile.
Ne modifie rien hors de fichiers_possedes. Ne pose aucune question :
si tu es bloqué, termine avec le statut blocked et explique pourquoi.
Rends ton rapport au format demandé : statut, fichiers modifiés,
écarts au plan, découvertes utiles aux tâches suivantes.

## Contexte utile
## Détail de réalisation
## Hors périmètre
```

Listes du frontmatter : pour les commandes et les critères, une ligne `  - "…"` par élément, entre guillemets doubles (`\"` pour un guillemet, `\\` pour une barre oblique inverse). La forme courte `[a, b]` convient aux identifiants et aux ressources ; un élément qui y contient une virgule se met entre guillemets.

## SUIVI.md

```markdown
| ID  | Titre | Phase | Lot | Dépend de | Modèle | Statut  | Essais | Branche | Tokens est. / réels |
|-----|-------|-------|-----|-----------|--------|---------|--------|---------|---------------------|
| T01 | …     | 1     | 1A  | —         | sonnet | à-faire | 0      | —       | 1,0 M / —           |

Statuts : à-faire · ajoutée · fusionnée · bloquée · échec · besoin-humain · annulée
```

## HANDOFF.md

```markdown
# HANDOFF — <nom>
Entrées : `écart`, `angle-mort`, `décision`, `dette`, `besoin-humain`, `ticket`, classées `mineur` ou `majeur`.
```

Les entrées se rangent sous un titre `## <id de tâche>`, au format `type · gravité · description`. En cours de run, l'orchestrateur ajoute aussi les types `refus`, `amendement` et `blocage`.

## DISCOVERY.md

```markdown
# DISCOVERY — <nom>
## Contexte existant
## Commandes vérifiées
## Carte rapide
## Conventions constatées
## Pièges et solutions
## Recommandations de contexte (fin de run)
```

Les échecs de tests déjà présents avant le plan vont dans « Commandes vérifiées » : ils ne comptent pas contre les tâches.

## orchestre.config.json

```json
{
  "parallelisme_max": 4,
  "mode_par_defaut": "phase",
  "branche_integration": "plan/<nom>",
  "branche_base": "main",
  "evaluateur": "systematique",
  "corrections_max": 2,
  "escalade": ["sonnet", "opus"],
  "decisions_office_max": 3,
  "plafond_session_pilote": 0.65
}
```

- `mode_par_defaut` : `auto` (autonome), `devia` (arrêt sur déviation) ou `phase` (arrêt par phase).
- `branche_base` : branche d'où part la branche d'intégration ; `main` par défaut, à préciser si le dépôt en utilise une autre.
- `evaluateur` est indicatif : l'évaluation est toujours systématique.
- `plafond_session_pilote` : part du contexte de la session pilote au-delà de laquelle `/orchestre:lancer` propose de reprendre dans une session neuve.
