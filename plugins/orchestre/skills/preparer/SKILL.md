---
name: preparer
description: Écrit un plan exécutable par /orchestre:lancer (dossier plans/<nom>/) — convertit un plan déjà écrit ou en rédige un nouveau à partir d'un objectif — puis le valide avec plan-lint. À utiliser quand l'utilisateur tape /orchestre:preparer ou demande de préparer, d'écrire ou de convertir un plan pour l'orchestrateur.
argument-hint: "<plan existant (fichier ou dossier) | objectif du plan>"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs *)
  - Bash(git status *)
  - Bash(git rev-parse *)
---
# Préparer un plan orchestre

Rôle : planificateur. Tu ne modifies aucun code applicatif. Tu n'ouvres jamais un `.env`, un dump ni une copie de données réelles : tu les repères par leur nom. Tu produis `plans/<nom>/` au format décrit dans `${CLAUDE_SKILL_DIR}/format.md` : lis-le en entier avant d'écrire quoi que ce soit.

plan-lint, dans ce plugin : `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs`.

Entrée : `$ARGUMENTS`. Un chemin qui existe (fichier ou dossier) : **conversion** de ce plan. Sinon : **objectif** d'un nouveau plan. Rien : demande lequel des deux.

## 0. Préalables

- Dépôt git sur sa branche de base (`main`, sauf si l'utilisateur en indique une autre) à jour, sans modification non commitée : sinon, arrête-toi et dis-le.
- Nom du plan : court, en kebab-case, à faire confirmer. Si `plans/<nom>/` existe déjà, arrête-toi et demande.

## 1. Explorer, sans modifier le dépôt

Délègue l'exploration à des subagents et garde seulement leurs conclusions :

- contexte existant : `CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, skills du projet ou de l'organisation, README, manifestes et CI ;
- zones du code que l'objectif touche, modèle de données et migrations ;
- ce que les tests partagent (base locale, port, service) et les données réelles présentes sur la machine (dumps, copies de prod), repérés par la configuration et les noms de fichiers : aucune tâche n'y touchera ;
- commandes d'installation, de lint, de build et de test.

Puis la référence des tests : lance-les une fois et note les échecs déjà présents, seulement s'ils n'écrivent dans aucune base partagée (comme la base de dev) et ne lisent aucune donnée réelle. Sinon, ne les lance pas : demande à l'utilisateur de les lancer lui-même avec `!` et d'en coller le bilan.

Résume en une page au plus : ce résumé amorce DISCOVERY.md.

## 2a. Conversion d'un plan existant

Lis le plan source en entier. Garde son découpage, son vocabulaire et ses décisions : tu le traduis, tu ne le réécris pas.

- Une tâche source donne une tâche orchestre. Découpe-la seulement si elle dépasse la moitié d'un contexte ; fusionne une micro-tâche avec sa voisine. Chaque changement de découpage va dans le bilan.
- `phase` et `depend_de` viennent de l'ordre et des liens du plan source. Ce qu'il ne dit pas, tire-le de l'exploration : `fichiers_possedes`, `ressources`, `verification` (commandes réelles, vérifiées à l'étape 1), `definition_du_fini` (critères démontrables par le diff ou par une commande), `modele` et `effort` selon la difficulté.
- Le texte de la tâche source va dans « Détail de réalisation », ses exclusions dans « Hors périmètre ».
- Les décisions déjà prises dans le plan source deviennent des entrées `décision · majeur · …` dans HANDOFF.md, sous un titre `## plan source`.
- Ce qui manque et change le plan (choix produit, périmètre, accès, secret) : n'invente rien, pose la question (au plus 3, avec l'outil de question) ou garde-la dans les questions ouvertes du bilan.

## 2b. Nouveau plan

Si l'exploration fait apparaître des questions qui changent le plan, poses-en au plus 3 avec l'outil de question, puis attends. Sinon, enchaîne. Découpe selon les règles de `format.md`.

## 3. Écrire

Écris `plans/<nom>/` : les tâches dans `taches/`, `SUIVI.md` (toutes les tâches à « à-faire »), `HANDOFF.md`, `DISCOVERY.md` amorcé avec l'étape 1, `orchestre.config.json` avec `branche_integration: "plan/<nom>"` et la branche de base dans `branche_base`. Termine le plan par une tâche de revue globale sur opus, en lecture seule.

## 4. Valider

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs plans/<nom>` : corrige jusqu'à « plan valide ».
2. Relecture critique par un subagent sceptique : dépendances manquantes, tâches trop grosses ou trop petites, fini flou ou indémontrable, lots parallèles qui se marchent dessus (fichiers ou ressources), ressources oubliées, vérification qui toucherait des données réelles ou une base partagée. Corrige, puis relance plan-lint.
3. Avec l'accord de l'utilisateur : crée la branche `plan/<nom>` depuis la branche de base et commite uniquement `plans/<nom>/`, avec le message `plan(<nom>) : plan initial`. Relance plan-lint avec `--integration plan/<nom>` (et `--base <branche>` si la base n'est pas `main`).

## 5. Bilan

Rends le tableau de SUIVI.md, la ligne d'estimation de plan-lint et les questions restées ouvertes. Pour une conversion, ajoute la table de correspondance (tâche ou section du plan source → tâche orchestre) et ce qui a été découpé, fusionné ou ajouté (revue globale comprise). Suite : `/orchestre:installer` si le dépôt n'est pas encore préparé, puis, dans une session neuve, `/orchestre:lancer plans/<nom>`, avec un premier run en mode « arrêt par phase ».
