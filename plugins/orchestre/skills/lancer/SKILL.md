---
name: lancer
description: Exécute un plan orchestre (dossier plans/<nom>) phase par phase avec le workflow orchestre:executer-phase. À lancer uniquement quand l'utilisateur tape /orchestre:lancer.
argument-hint: <dossier-plan> [--reprendre]
disable-model-invocation: true
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs *)
  - Bash(claude --version)
  - Bash(node --version)
---
# Lancer un plan

Tu pilotes l'exécution de `$ARGUMENTS`. Tu restes léger : tu ne lis ni les fichiers de tâches ni les transcriptions des agents, seulement les sorties de plan-lint et les rapports du workflow. Messages courts. Toute étape qui lit des données de production ou personnelles réelles (dump de prod, base de prod ou copie) est un geste de l'utilisateur, avec le préfixe `!` : tu ne la lances jamais toi-même.

plan-lint, dans ce plugin : `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs`.

## 1. Pré-vol

Arrête-toi et explique ce qui manque si un point échoue.

1. `claude --version` : 2.1.271 ou plus. `node --version` : 18 ou plus.
2. Plugin : les agents `orchestre:worker`, `orchestre:worker-isole`, `orchestre:verificateur`, `orchestre:evaluateur`, `orchestre:integrateur`, `orchestre:replanificateur`, `orchestre:scribe` et `orchestre:lecteur-plan` figurent parmi les types d'agents disponibles. Sinon : plugin désactivé ou pas rechargé, fais lancer `/reload-plugins`. Si le dépôt contient encore une installation manuelle (`.claude/skills/lancer/`, `.claude/workflows/executer-phase.js`, `.claude/orchestre/`), signale-la et propose `/orchestre:installer` pour la retirer ; ce n'est pas bloquant.
3. Réglages (`.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`) : `worktree.baseRef` vaut `head`, `autoContinueAtUsageLimit` est actif, `git push` est refusé, ainsi que l'outil de déploiement du projet s'il en a un. Sinon, propose `/orchestre:installer`. La règle `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs *)` doit être dans `allow` de `.claude/settings.local.json` : si elle manque (première utilisation ou mise à jour du plugin), propose en une ligne de l'ajouter en retirant les règles plan-lint d'une version précédente, et fais-le après accord.
4. Lis `orchestre.config.json` du plan : branche d'intégration, branche de base (`branche_base`, `main` par défaut), parallélisme, mode par défaut, corrections, escalade, plafond de décisions d'office (`decisions_office_max`, 3 par défaut), plafond de contexte de cette session (`plafond_session_pilote`, 0,65 par défaut).
5. Git : aucune modification non commitée sur les fichiers suivis. Si la branche d'intégration n'existe pas, crée-la depuis la branche de base ; place-toi dessus. Le dossier du plan doit y être commité, sinon les worktrees ne le verront pas. Si le projet a un `.env`, `.worktreeinclude` doit le lister.
6. `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs <plan> --integration <branche>`, plus `--base <branche_base>` si la config en donne une : aucune erreur. Affiche sa ligne d'estimation.
7. Formateur et linter : si les vérifications ou un hook lancent un formateur ou un linter (Prettier, Biome, ESLint…), leurs exclusions (`.prettierignore`, `biome.json`, config ESLint…) doivent couvrir `plans/` et `.claude/`. Sinon, propose de les ajouter et commite sur la branche d'intégration : le scribe écrit dans `plans/`, et une vérification qui lit ces dossiers échouerait sur des fichiers qu'aucune tâche ne possède.

## 2. Choix de l'utilisateur

Avec l'outil de question, demande le mode (autonome, arrêt sur déviation, arrêt par phase ; défaut de la config : `mode_par_defaut`, qui vaut `auto`, `devia` ou `phase`) et le nombre de tâches simultanées (défaut de la config). En mode autonome, précise en une ligne que les points majeurs seront tranchés d'office (option la plus prudente), que tout point humain arrête le run, et que le run s'arrête aussi au-delà de `decisions_office_max` décisions d'office (config, 3 par défaut). Avec `--reprendre`, rappelle d'abord où en est SUIVI.md.

## 3. Boucle des phases

Pour chaque phase, en partant de la première qui a des tâches ni fusionnées ni annulées :

1. Décisions : les entrées `décision` de HANDOFF.md, en une ligne chacune.
2. Lance le workflow `orchestre:executer-phase` (outil Workflow, paramètre `name`) avec `args` : `{ plan, phase, mode, parallelisme, integration, base, decisions, corrections_max, escalade, decisions_office_max, arbitrages, relancer, lint, prefixe_agents }`.
   - `mode` : `auto` (autonome), `devia` (arrêt sur déviation) ou `phase` (arrêt par phase), exactement ; toute autre valeur fait échouer le run.
   - `base` : `branche_base` de la config, seulement si elle en donne une.
   - `lint` : `${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs`, tel quel. `prefixe_agents` : `orchestre:`.
   - `decisions_office_max` : le plafond (config, 3 par défaut) moins les décisions d'office déjà prises depuis le début du run ou depuis le dernier arbitrage de l'utilisateur.
   - `arbitrages` : les options choisies par l'utilisateur depuis le dernier rapport, `[{ tache, titre, option }]`, `option` recopiée telle quelle depuis le rapport ; sinon `[]`. Le workflow les fait écrire par le scribe avant de lire le plan : ne les écris pas toi-même. Ne repasse jamais un arbitrage listé dans `arbitrages_appliques` (même tâche, même titre, même option).
   - `relancer` : les tâches au statut « besoin-humain » que l'utilisateur a décidé de faire repartir, une fois fait ce qui revenait à un humain ; sinon `[]`. Sans cela, une tâche en attente d'un humain ne repart pas.
3. À réception du rapport, ajoute ses `decisions_office` et ses `amendements_ecartes` à la liste du run, puis :
   - `terminé` : en mode autonome ou déviation, passe à la phase suivante sans attendre. En mode par phase, présente un résumé de 5 lignes au plus (tâches, corrections, écarts, découvertes, critères non vérifiables du champ `non_verifiables`, tokens à lire dans `/workflows`), fais trancher les `points_a_trancher`, puis demande de continuer.
   - `à-relancer` : des tâches ont été ajoutées à la phase, ou reportées (`reportees`) parce qu'elles dépendent d'une tâche ajoutée. Relance la même phase sans attendre, deux fois de suite au plus ; au-delà, demande.
   - `arbitrage` : fais trancher le point `arbitrage`, puis les `points_a_trancher`. S'il porte `coupe_circuit`, dis que le plafond de décisions d'office est atteint et liste celles du run. S'il porte `incoherence`, dis que l'option recommandée citait des tâches que rien ne crée, puis fais trancher. S'il porte `humain`, dis précisément ce qu'un humain doit faire ; pour un contrôle post-fusion en échec, propose de réparer ici sur la branche d'intégration (2 passes vertes des vérifications de la tâche) avant de relancer. Relance ensuite la même phase avec les options choisies dans `arbitrages` et, si la décision fait repartir une tâche en attente d'un humain, avec son id dans `relancer` ; sauf si l'utilisateur choisit d'arrêter : va alors à la fin.
   - `partiel` : pour chaque tâche de `en_attente` (statut « besoin-humain »), dis ce qu'un humain doit faire d'après HANDOFF.md ; elle ne repartira que dans `relancer`. Pour chaque tâche bloquée ou en échec, donne la raison exacte (champ `blocage` du rapport, pas le résumé du worker) et, s'il y en a, les refus des essais précédents (champ `refus`), puis propose : corriger ici sur sa branche, relancer la phase, ou arrêter. Après une correction faite ici : 2 passes vertes des vérifications, puis une évaluation par l'agent `orchestre:evaluateur` (définition du fini, diff, résultats des vérifications, rapport de correction), et seulement si elle est OK, fusion `--no-ff` dans la branche d'intégration avec le message « tâche <id> : <titre> », statut « fusionnée » dans SUIVI.md, puis relance de la phase : les tâches restantes partiront seules.
   - `erreur`, ou run interrompu : explique, puis propose de lancer un **nouveau** run de la phase, jamais la reprise du run interrompu. plan-lint et l'historique git sautent les tâches déjà fusionnées.

   Faire trancher un point : outil de question, une option par choix, la recommandée en premier, avec son impact. Un point sans option attend une réponse libre, à passer comme option `{ id: "humain", description: <réponse> }`. Les `points_a_trancher` se tranchent avant le run suivant, quel que soit le statut.

## 4. Fin

Résumé final : tâches fusionnées, branche d'intégration prête pour une PR, entrées majeures de HANDOFF.md, recommandations de contexte. Liste à part, en premier, les décisions prises d'office (tâche, point, option retenue), les amendements non appliqués et les gestes faits à la main hors de la boucle évaluée : ce sont les premiers points à relire dans la PR. Liste ensuite les entrées `ticket` de HANDOFF.md, à ouvrir après la PR. Termine par un tableau par tâche, qui mesure le coût et la qualité de la réalisation : essais, refus des évaluations, corrections, écarts majeurs, décisions d'office, gestes faits à la main ; les tokens de chaque tâche se lisent dans `/workflows`. Tu ne fusionnes jamais dans `main` et tu ne pousses jamais.

## Contexte

Si ton contexte approche le plafond de la config (`plafond_session_pilote`, 0,65 par défaut), termine la phase en cours, puis propose de reprendre dans une session neuve avec `/orchestre:lancer <plan> --reprendre`. L'état est entièrement dans le plan et dans git.
