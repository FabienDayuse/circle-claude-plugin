---
name: installer
description: Prépare le dépôt courant pour le plugin orchestre (réglages Claude Code du projet, .worktreeinclude, exclusions du formateur, retrait d'une installation manuelle). À lancer une fois par dépôt, quand l'utilisateur tape /orchestre:installer.
argument-hint: "[--equipe]"
disable-model-invocation: true
allowed-tools:
  - Bash(claude --version)
  - Bash(node --version)
  - Bash(git rev-parse *)
  - Bash(git status *)
  - Bash(git ls-files *)
  - Bash(git check-ignore *)
---
# Installer orchestre dans ce dépôt

Tu prépares le dépôt courant pour `/orchestre:lancer`. Tu ne touches à aucun code applicatif. Avant chaque écriture, montre en quelques lignes ce qui va changer et attends l'accord de l'utilisateur ; même règle pour chaque commit. Tu ne lis jamais le contenu d'un `.env`. Messages courts.

## 1. Vérifier

Arrête-toi et explique ce qui manque si un point échoue.

1. `git rev-parse --show-toplevel` : tu es à la racine d'un dépôt git.
2. `claude --version` : 2.1.271 ou plus. `node --version` : 18 ou plus (plan-lint en a besoin).
3. Les workflows dynamiques sont disponibles : plan payant ; sur Pro, ligne Dynamic workflows de `/config`.

## 2. Réglages Claude Code du projet

Un plugin ne peut pas fixer ces réglages lui-même : ils vont dans `.claude/settings.local.json`, personnel et non versionné.

1. Prépare la fusion, dans ce fichier, du contenu de `${CLAUDE_SKILL_DIR}/settings.local.modele.json`, sans rien retirer de l'existant ni créer de doublon, avec les ajouts des points 2 à 4 ; montre le résultat, puis écris-le après accord :
   - `worktree.baseRef: "head"` : les worktrees des tâches parallèles partent de la branche d'intégration du plan, pas de `main` ;
   - `autoContinueAtUsageLimit: true` : un run en pause sur une limite d'usage repart seul ;
   - `allow` : le workflow, les commandes git des agents, `date`, `test -e` ;
   - `deny` : `git push` et la lecture de `.env`.
2. Ajoute dans `allow` la règle de plan-lint pour cette version du plugin : `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-lint.mjs *)`. Retire les règles plan-lint d'une version précédente du plugin (même règle, autre numéro de version dans le chemin).
3. Outil de déploiement : repère celui du projet (fichiers de config, scripts de `package.json`, CI : railway, vercel, fly, heroku, netlify, kubectl, terraform…) et fais confirmer par l'utilisateur. Ajoute-le dans `deny` (`Bash(<outil> *)`) : le déploiement reste un geste humain.
4. Commandes du projet : repère les commandes d'installation, de test, de lint, de typecheck et de build (`package.json`, `Makefile`, `composer.json`, `pyproject.toml`, CI…) et, s'il existe déjà des plans, les commandes de `verification` de `plans/*/taches/*.md`. Propose de les autoriser, pour que les agents ne s'arrêtent pas sur une demande de permission : une règle précise par commande (`Bash(pnpm test *)`), jamais `Bash(*)` ni un gestionnaire entier (`Bash(npm *)`). Ajoute celles que l'utilisateur accepte.
5. `git check-ignore -q .claude/settings.local.json` : si le fichier n'est pas ignoré, propose de l'ajouter à `.gitignore`.

Conseil à donner en une ligne : le pilote a tourné en mode de permission auto ; en mode manuel, toute commande non autorisée suspend le run jusqu'à la réponse de l'utilisateur.

## 3. Worktrees

Les tâches qui tournent en parallèle travaillent dans des worktrees. Si les tests ont besoin de fichiers non versionnés (`.env`, `.env.local`, `.env.test`…), crée ou complète `.worktreeinclude` à la racine, un chemin par ligne, avec ceux qui existent : Claude Code les copie dans chaque worktree. Liste seulement les noms, sans lire les fichiers.

## 4. Formateur et linter

Si le projet a un formateur ou un linter (Prettier, Biome, ESLint, Ruff, PHP-CS-Fixer…), fais exclure `plans/` et `.claude/` : le scribe écrit dans `plans/`, et une vérification qui lirait ces dossiers échouerait sur des fichiers qu'aucune tâche ne possède. Montre le changement, puis commite-le seulement si l'utilisateur l'accepte, sur la branche courante, avec le message `chore: exclure plans/ et .claude/ du formateur et du linter`.

## 5. Ancienne installation manuelle

Avant le plugin, l'orchestrateur se copiait dans `.claude/`. Cherche :

- `.claude/skills/lancer/`, `.claude/workflows/executer-phase.js`, `.claude/orchestre/` ;
- dans `.claude/agents/` : `evaluateur.md`, `integrateur.md`, `lecteur-plan.md`, `replanificateur.md`, `scribe.md`, `verificateur.md`, `worker.md`, `worker-isole.md`.

Ne retiens un fichier que si c'est bien l'orchestrateur : sa description (pour `skills/lancer/`, son `SKILL.md`) parle d'un « plan orchestre » ou du workflow `executer-phase`.

S'il y en a : explique qu'ils doublonnent le plugin (la commande `/lancer` du projet lancerait l'ancienne version), liste-les, et propose de les retirer. Avec l'accord explicite de l'utilisateur : `git rm -r` pour les fichiers suivis (`git ls-files`), suppression simple pour les autres, puis commit sur la branche courante avec le message `chore: retirer l'installation manuelle de l'orchestrateur (remplacée par le plugin orchestre)`. Retire aussi de `.claude/settings.local.json` les règles de l'ancienne installation : `Workflow(executer-phase)` et `Bash(node .claude/orchestre/plan-lint.mjs:*)`. Ne touche à rien d'autre dans `.claude/`. Un plan en cours, entre deux runs, n'empêche pas ce retrait : les plans restent dans `plans/`. Jamais pendant un run : fais confirmer par l'utilisateur qu'aucun run de l'orchestrateur n'est actif (`/workflows`), sinon arrête-toi.

## 6. Partage avec l'équipe (seulement avec `--equipe`)

Pour que les personnes qui ouvrent ce dépôt se voient proposer le plugin, ajoute dans `.claude/settings.json` (versionné) :

```json
{
  "extraKnownMarketplaces": {
    "circle": { "source": { "source": "github", "repo": "FabienDayuse/circle-claude-plugin" } }
  },
  "enabledPlugins": { "orchestre@circle": true }
}
```

Fusionne sans rien retirer, montre le résultat, commite avec l'accord de l'utilisateur. Préviens que chacun doit avoir accès en lecture au dépôt GitHub privé, et lancer `/orchestre:installer` pour ses propres réglages.

## 7. Bilan

Résume en quelques lignes ce qui a été écrit et ce qui reste à faire (commit, `.gitignore`). Puis la suite : ouvrir une session neuve pour que les réglages s'appliquent, `/orchestre:preparer` pour écrire ou convertir un plan, `/orchestre:pret plans/<nom>` la veille pour vérifier que tout est prêt, `/orchestre:lancer plans/<nom>` pour l'exécuter.
