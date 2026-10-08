# Circle — plugins Claude Code

Marketplace privée de plugins [Claude Code](https://code.claude.com/docs/en/plugins). Elle contient deux plugins :

| Plugin | Version | Rôle |
| :- | :- | :- |
| `orchestre` | 0.8.1 | Exécute un plan de dev découpé en tâches (`plans/<nom>/`, un fichier par tâche) depuis une session Claude Code pilote. Chaque phase du plan est un run du workflow `orchestre:executer-phase` : réalisation par des subagents, vérification, évaluation, corrections, fusion dans une branche d'intégration, suivi. |
| `orchestre-suivi` | 0.1.0 | Mod de suivi d'un run `orchestre` dans la session pilote, en lecture seule sur `plans/<nom>/suivi.json` : bandeau au-dessus du prompt pendant un run, suffixe du spinner, `/suivi` (panneau Tâches, À relire, Journal, Bilan, ou `/suivi texte`), notifications, brouillon de PR dans le prompt. Facultatif : `orchestre` ne dépend pas de lui. |

La logique d'orchestration a été mise au point sur un pilote de 15 tâches en 4 phases (SPACE-Platform, plan `acces-par-metier`). Historique des versions : [CHANGELOG.md](CHANGELOG.md).

## Prérequis

- Claude Code 2.1.271 ou plus, avec les workflows dynamiques : plans payants ; sur Pro, ligne *Dynamic workflows* de `/config`.
- `git` et Node.js 18 ou plus sur la machine : le contrôle des plans (`plan-lint`) est un script Node sans dépendance.
- Un accès en lecture à ce dépôt GitHub privé, utilisable sans invite, car Claude Code clone avec le `git` de la machine :
  - soit une clé SSH GitHub chargée dans `ssh-agent` ;
  - soit `gh auth login` puis `gh auth setup-git`, et `export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` pour cloner en HTTPS.

## Installer (une fois par machine)

Dans une session Claude Code :

```
/plugin marketplace add FabienDayuse/circle-claude-plugin
/plugin install orchestre@circle
/plugin install orchestre-suivi@circle
/reload-plugins
```

`orchestre-suivi` est un mod (des hooks de fonctions) : il faut Claude Code 2.1.287 ou plus (`claude --version`), version à partir de laquelle les mods sont actifs par défaut ([doc des mods](https://code.claude.com/docs/en/plugins/mods/overview)). Il dessine dans le terminal et dans l'onglet Code de l'app de bureau ; dans le panneau de l'extension VS Code, sous `claude -p` et dans une session cloud, rien ne se dessine. `/plugin` dit s'il est chargé : la ligne sous les onglets nomme les mods actifs. Sur une version plus ancienne, seul ce plugin est concerné.

Ou depuis un terminal :

```sh
claude plugin marketplace add FabienDayuse/circle-claude-plugin
claude plugin install orchestre@circle
```

Vérifier : `claude plugin list` affiche `orchestre@circle` activé, et `/orchestre:` propose `installer`, `preparer`, `pret` et `lancer`.

## Utiliser

Quatre commandes, dans l'ordre, et une cinquième pour suivre l'avancement :

### 1. `/orchestre:installer` : préparer le dépôt

Une fois par dépôt, à sa racine. Un plugin ne peut pas fixer les réglages dont l'orchestrateur a besoin : la commande les écrit dans le projet, en montrant chaque changement avant de le faire.

- `.claude/settings.local.json` (personnel, non versionné) : `worktree.baseRef: "head"` (les worktrees partent de la branche d'intégration), `autoContinueAtUsageLimit` (un run en pause sur limite d'usage repart seul), autorisations du workflow, des scripts du plugin (plan-lint, suivi, nettoyage des worktrees), des commandes git des agents et, sur proposition, des commandes de test et de build du projet ; refus de `git push`, de l'outil de déploiement du projet et de la lecture des `.env` et `.env.*`, à toutes les profondeurs, sauf les modèles versionnés (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`), que les agents lisent et modifient. Sur un projet installé avant la 0.6.2, la commande propose d'ajouter ces exceptions.
- `.worktreeinclude` : les fichiers non versionnés (`.env`…) à copier dans les worktrees des tâches parallèles.
- Exclusion de `plans/` et `.claude/` par le formateur et le linter du projet.
- Si les outils du projet (node, pnpm, php…) sont introuvables dans le shell des agents, une clé `env` (PATH) dans `.claude/settings.local.json` : sans elle, les agents préfixeraient leurs commandes par `export PATH=…`, ce que la garde d'isolement des worktrees refuse.
- Retrait d'une ancienne installation manuelle de l'orchestrateur (voir [Migrer](#migrer-depuis-linstallation-manuelle-v05-et-avant)).

Le pilote a tourné en mode de permission auto. En mode manuel, toute commande non autorisée suspend le run jusqu'à la réponse.

### 2. `/orchestre:preparer` : écrire ou convertir un plan

- `/orchestre:preparer docs/mon-plan.md` : convertit un plan déjà écrit (fichier ou dossier). Découpage, vocabulaire et décisions du plan source sont conservés ; ce qui manque (fichiers possédés, commandes de vérification, définition du fini) vient d'une exploration du dépôt. Le bilan donne une table de correspondance plan source → tâches.
- `/orchestre:preparer ajouter l'export CSV des réservations` : explore le dépôt, découpe et écrit un nouveau plan.

Dans les deux cas, toutes les décisions ouvertes te sont posées, par lots de 4, sans plafond ; seules celles que tu choisis de reporter restent ouvertes. Ce qu'un agent ne fera jamais (accès, secret, compte payant, données réelles) et l'environnement dont les vérifications ont besoin vont dans `PREREQUIS.md`, et chaque tâche cite ce qu'elle attend. Le plan est validé par plan-lint, relu par un subagent sceptique, puis commité sur la branche `plan/<nom>` après accord. Le format est décrit dans [`plugins/orchestre/skills/preparer/format.md`](plugins/orchestre/skills/preparer/format.md).

### 3. `/orchestre:pret plans/<nom>` : vérifier que tout est prêt

La veille du lancement, sans exécuter aucune tâche :

- l'environnement : réglages, outils, git, formateur, dossiers non suivis, autorisations des commandes de vérification ;
- les prérequis : les décisions encore ouvertes, à trancher sur-le-champ, et les gestes qui te reviennent, avec la marche à suivre. Pour un plan écrit avant la 0.6.1, la commande construit d'abord `PREREQUIS.md` ;
- une répétition à blanc des commandes de vérification sûres (sans base partagée, données réelles, appel payant ni déploiement), qui révèle les outils ou autorisations manquants et les échecs déjà présents ;
- la préparation de l'environnement, dans `orchestre.config.json` : `preparation` (dépendances, code généré : lancée par chaque worker sur sa branche et par l'intégrateur après chaque fusion, avant le contrôle) et `preparation_partagee` (service commun comme une base de test, par ressource déclarée). La commande la propose d'après le dépôt si elle manque ;
- les commandes de vérification composées, que plan-lint signale : un agent isolé dans un worktree se les verrait refuser.

Elle rend un verdict par phase, par exemple « phases 1 à 3 prêtes ; phase 4 : T12 attend D5 ». Pendant le run, une tâche dont un prérequis reste ouvert ne part pas, et le reste de la phase tourne. `--sans-repetition` saute la répétition.

### 4. `/orchestre:lancer plans/<nom>` : exécuter

Dans une session neuve. Pré-vol (version, réglages, git, nettoyage des worktrees laissés par les essais précédents, plan-lint et prérequis de la phase, formateur, suivi), choix du mode et du nombre de tâches simultanées, puis un run du workflow par phase :

- **arrêt par phase** : points à trancher, puis résumé de la phase dans la question « on continue ? » (conseillé pour un premier plan) ;
- **arrêt sur déviation** : le run s'arrête sur tout écart majeur pour un arbitrage ;
- **autonome** : l'option la plus prudente de chaque point majeur est prise d'office ; tout point humain arrête le run, et le run s'arrête aussi au-delà de 3 décisions d'office.

Pendant un run, la session pilote ne touche pas au checkout principal, où travaillent les agents : une demande sur le dépôt attend la fin du run. Un fichier que les agents n'ont pas le droit de lire ou d'écrire (réglages du projet ou de l'organisation), ou une commande qu'ils n'ont pas le droit de lancer, n'arrête pas le run : il devient une relecture, à faire toi-même avant la PR, avec la commande donnée à la fin.

Suivre un run : `/suivi` si `orchestre-suivi` est installé (bandeau, panneau, notifications, sans tour de Claude), ou `/orchestre:etat`, ci-dessous, pour le plan ; `/workflows` pour l'étape de chaque agent. Depuis la 0.8.0, l'état du plan et des runs est aussi tenu dans `plans/<nom>/suivi.json` (hors git), que seul `scripts/suivi.mjs` écrit. Reprendre dans une session neuve : `/orchestre:lancer plans/<nom> --reprendre` (l'état est dans le plan et dans git). À la fin, la branche d'intégration est prête pour une PR : la fusion dans `main` et le déploiement restent des gestes humains.

### 5. `/orchestre:etat [plans/<nom>]` : voir où en est le plan

À tout moment, y compris dans la session pilote pendant un run : la commande ne fait que lire, sans switch, sans écriture ni verrou git. Sans argument, elle prend le seul plan de `plans/`. Un script calcule le tableau à partir de plan-lint et de git, et Claude le recopie tel quel :

```text
## mr-review-recall — 12/37 tâches · 32 %
`███████░░░░░░░░░░░░░░░░░` phase 3 en cours · dernière fusion T09 il y a 12 min

| Phase | Avancement | Tâches |
| :-- | :-- | :-- |
| ✓ 1 | `██████████` 100 % | 1/1 |
| ✓ 2 | `██████████` 100 % | 7/7 |
| ● 3 | `████░░░░░░` 40 % | 4/10 |
| ○ 4 | `░░░░░░░░░░` 0 % | 0/19 |

**En cours** : T12 (checkout, dernier commit il y a 3 min) · T13 (worktree, démarrée)

**À toi** : D5 (décision) bloque T15 · 2 relectures avant la PR · 1 ticket après la PR
```

✓ phase finie, ● commencée, ⚠ une tâche y attend un humain, est bloquée ou en échec, ○ pas commencée. Une tâche est « en cours » quand sa branche `tache/<id>` existe ; l'étape exacte de chaque agent se lit dans `/workflows`. Les relectures comptées sont toutes les entrées `relecture` de HANDOFF.md. L'exemple ci-dessus est illustratif.

### Premier essai conseillé

Un dépôt jouet d'une tâche, pour vérifier l'installation de bout en bout en quelques minutes :

```sh
git clone git@github.com:FabienDayuse/circle-claude-plugin.git && cd circle-claude-plugin
sh tests/depot-jouet.sh ~/tmp/orchestre-jouet
cd ~/tmp/orchestre-jouet && claude
```

Puis `/orchestre:installer`, une session neuve, `/orchestre:pret plans/demo` et `/orchestre:lancer plans/demo`.

### Voir le mod sans lancer de run

Une démo joue deux runs d'un plan de 5 tâches avec le vrai `suivi.mjs`, sans agent ni modèle, et affiche après chaque pas ce que le mod doit montrer (bandeau, spinner, notifications, bilan) :

```sh
node tests/demo-suivi.mjs ~/tmp/orchestre-demo
```

Elle indique la session à ouvrir dans le dépôt créé (`claude --plugin-dir <clone>/plugins/orchestre-suivi`, ou `claude` si le mod est installé), puis attend Entrée avant chaque run. Un pas toutes les 4 s (`--pas <ms>` pour changer). Ce qui diffère dans la session vient du chargement ou du dessin du mod, pas des données.

## Mettre à jour

Entre deux runs, jamais pendant :

```
/plugin marketplace update circle
/reload-plugins
```

Ou depuis un terminal : `claude plugin update orchestre@circle`, puis une session neuve.

- Une mise à jour n'arrive que si la version de `plugins/orchestre/.claude-plugin/plugin.json` a changé : sinon, la commande répond que le plugin est déjà à jour.
- Mise à jour automatique : `/plugin` → *Marketplaces* → `circle` → *Enable auto-update*. Pour un dépôt privé, elle a besoin d'un identifiant git déjà enregistré (clé SSH dans `ssh-agent`, ou `gh auth setup-git`) ; sinon elle échoue sans bruit et garde la version en place.
- Le chemin des scripts du plugin contient le numéro de version : après une mise à jour, `/orchestre:lancer` propose de remplacer les règles d'autorisation correspondantes.
- Depuis la 0.6.3 vers la 0.8.0 : relancer `/orchestre:installer` dans chaque dépôt (règles des scripts `suivi.mjs` et `worktrees.mjs`, `git merge-base`, clé `env` si besoin), puis `/orchestre:pret plans/<nom>` pour la préparation de l'environnement. Les plans en cours reprennent tels quels ; au premier lancement, `/orchestre:lancer` régénère le tableau de SUIVI.md et propose de le commiter.
- Version installée : `claude plugin list`.

## Partager avec l'équipe d'un dépôt

`/orchestre:installer --equipe` déclare la marketplace et le plugin dans `.claude/settings.json` (versionné). Les personnes qui ouvrent le dépôt se voient proposer le plugin après avoir accepté la confiance du dossier. Chacune doit avoir accès en lecture à ce dépôt GitHub, puis lancer `/orchestre:installer` pour ses propres réglages.

## Migrer depuis l'installation manuelle (v0.5 et avant)

Jusqu'à la v0.5, l'orchestrateur se copiait dans le `.claude/` du projet (`agents/`, `skills/lancer/`, `workflows/executer-phase.js`, `orchestre/plan-lint.mjs`).

1. Installer le plugin (ci-dessus).
2. Dans le dépôt : `/orchestre:installer`. La commande repère les anciennes copies et propose de les retirer, sinon `/lancer` lancerait l'ancienne version. Elle remplace aussi leurs règles d'autorisation : `Workflow(executer-phase)` par `Workflow(orchestre:executer-phase)`, et celle de plan-lint par le chemin du plugin.
3. Lancer avec `/orchestre:lancer`.

Les plans en cours (`plans/<nom>/`, SUIVI, HANDOFF, branche d'intégration) ne changent pas de format : ils reprennent avec `/orchestre:lancer plans/<nom> --reprendre`.

## Ce que fait un run

Un run égale une phase. Pour chaque tâche prête (dépendances fusionnées, prérequis faits, ressources libres) :

| Étape | Agent | Modèle | Rôle |
| :- | :- | :- | :- |
| Lecture | `lecteur-plan` | haiku | plan-lint en JSON : tâches de la phase, statuts, dépendances |
| Réalisation | `worker`, ou `worker-isole` en worktree si des tâches tournent en parallèle | modèle de la tâche | réalise la tâche sur `tache/<id>`, lance ses vérifications, rend un rapport |
| Vérification | `verificateur` | sonnet | rejoue les commandes de vérification : code de sortie et extrait de chacune |
| Évaluation | `evaluateur` | opus | juge chaque critère du fini sur preuves (diff, résultats du vérificateur) |
| Corrections | `worker` | sonnet puis opus | 2 essais au plus sur les manques relevés |
| Fusion | `integrateur` | sonnet | `--no-ff` dans `plan/<nom>`, puis contrôle post-fusion |
| Replanification | `replanificateur` | opus | classe les écarts, prépare les points à trancher avec leurs options |
| Suivi | `scribe` | sonnet | seul à écrire HANDOFF, DISCOVERY et les tâches créées ou amendées ; clôt la tâche par `suivi.mjs`, qui régénère SUIVI.md |
| Fin de run | `greffier` | haiku | clôt le run par `suivi.mjs fin-run`, commite SUIVI.md s'il a changé, retire les worktrees propres des tâches (`worktrees.mjs`) |

Suivi (0.8.0) : `plans/<nom>/suivi.json`, hors git, tient l'état du plan et de ses runs ; seul `scripts/suivi.mjs` l'écrit, avec la vue SUIVI.md (contrat `orchestre-suivi/1`). Le workflow ne lance rien : chaque agent lance d'abord la commande d'étape que porte sa consigne, le premier agent du run l'ouvre, le scribe clôt la tâche, le greffier clôt le run. Sans `args.suivi`, le workflow garde le suivi de la 0.6.3.

Garde-fous : aucun agent ne pousse, ne fusionne dans `main` ni ne déploie ; aucun agent n'ouvre, ne restaure ni ne copie de données de production ou personnelles réelles (ces gestes reviennent à l'humain) ; un écart qui touche des données, une base, la prod ou un secret est toujours majeur ; aucun agent ne contourne une interdiction de lecture ou d'écriture, et le fichier concerné va en relecture humaine avant la PR ; aucun agent ne réécrit l'historique (rebase, reset) : une branche reprise reçoit la branche d'intégration par une fusion ; un worktree qui contient du travail non commité n'est jamais retiré ; un run interrompu ne se reprend pas, on en relance un nouveau, et les tâches déjà fusionnées sont sautées.

## Contenu du dépôt

```
.claude-plugin/marketplace.json      catalogue de la marketplace « circle »
plugins/orchestre/
├── .claude-plugin/plugin.json       manifeste (nom, version)
├── skills/installer/                /orchestre:installer, modèle de réglages
├── skills/preparer/                 /orchestre:preparer, format d'un plan
├── skills/pret/                     /orchestre:pret
├── skills/lancer/                   /orchestre:lancer
├── skills/etat/                     /orchestre:etat
├── agents/                          les 9 agents du workflow
├── workflows/executer-phase.js      le workflow, un run par phase
└── scripts/                         plan-lint.mjs (validation et compilation d'un plan), etat.mjs (/orchestre:etat), suivi.mjs (suivi.json et SUIVI.md), worktrees.mjs (nettoyage des worktrees)
plugins/orchestre-suivi/
├── .claude-plugin/plugin.json       manifeste ; types/index.d.ts, contrat de son état ($.state)
├── hooks/register.tsx               le mod : fichiers, minuteur, dessin, /suivi
├── hooks/modele.mjs                 lecture de suivi.json et mise en forme, sans moteur
└── tests/suivi.test.tsx             tests sous le moteur (claude plugin test)
tests/
├── orchestre-suivi.test.mjs         modèle du mod sur des suivi.json écrits par suivi.mjs
├── scenarios.mjs                    scénarios simulés du workflow
├── plan-lint.test.mjs               plan-lint sur des plans jouets
├── etat.test.mjs                    /orchestre:etat sur un dépôt jouet
├── suivi.test.mjs                   suivi.mjs dans des dépôts temporaires
├── worktrees.test.mjs               worktrees.mjs dans des dépôts temporaires
├── modele.test.mjs                  modèle de réglages de l'installer
├── depot-jouet.sh                   dépôt jouet pour un essai réel
└── demo-suivi.mjs                   démo du mod : deux runs joués par suivi.mjs
```

## Développer

- Essayer une modification sans l'installer : `claude --plugin-dir plugins/orchestre`, puis `/reload-plugins` après chaque changement.
- Tests : `npm test` : 87 scénarios du workflow, avec des agents simulés, dont 5 qui lancent les vrais `suivi.mjs` et `worktrees.mjs` dans un dépôt temporaire ; 17 cas de plan-lint, 7 de `/orchestre:etat`, 19 de `suivi.mjs` et 4 de `worktrees.mjs` dans des dépôts git temporaires ; le modèle de réglages de l'installer ; 12 cas du modèle du mod sur des `suivi.json` écrits par `suivi.mjs`, dont la démo jouée sans pause. Les 4 tests du mod sous le moteur passent par `npm run validate`.
- Validation : `npm run validate` (`claude plugin validate` sur les deux plugins et sur la marketplace, puis `claude plugin test` du mod).
- Essayer le mod sans l'installer : `claude --plugin-dir plugins/orchestre-suivi` dans le dépôt d'un plan qui a un `suivi.json`, par exemple celui de `tests/demo-suivi.mjs`.
- Le script du workflow n'a pas accès aux fichiers et ne peut rien importer ; `Date.now()`, `Math.random()` et `new Date()` y sont interdits. Avant de le modifier, charger la référence `/workflow-authoring`.
- Publier une version :
  1. monter `version` dans `plugins/<plugin>/.claude-plugin/plugin.json` du plugin modifié : sans cela, personne ne reçoit la mise à jour ;
  2. ajouter l'entrée dans son changelog (`CHANGELOG.md` pour `orchestre`, `plugins/orchestre-suivi/CHANGELOG.md` pour le mod) et mettre à jour la version dans le tableau en tête de ce README ;
  3. `npm test && npm run validate` ;
  4. commiter et pousser sur `main` ;
  5. sur chaque machine : `/plugin marketplace update circle`.

## Limites connues

- Le plugin a tourné en réel pour la première fois le 29/09, sur un plan de 37 tâches : les phases 1 et 2 ont tourné en 0.6.0. Les prérequis et `/orchestre:pret` (0.6.1), les relectures (0.6.2) n'ont pas encore tourné en réel.
- Les relectures ne sont relues par aucun agent : sans toi avant la PR, un fichier interdit aux agents part sans relecture.
- Une interdiction que le worker remonte comme un écart ordinaire n'est reclassée en relecture que si sa description ne cite ni base, ni prod, ni secret (`DATABASE_URL`, `JWT_SECRET`…) : sinon le run s'arrête pour un humain.
- `/orchestre:pret` repère les commandes « sûres » sur la foi de la configuration et de DISCOVERY.md : dans le doute, il demande de les lancer soi-même avec `!`.
- Les réglages (worktree, reprise sur limite d'usage, permissions) ne peuvent pas venir d'un plugin : `/orchestre:installer` les écrit dans chaque projet.
- Les tokens réels ne sont pas relevés automatiquement : lecture dans `/workflows`, tâche par tâche. Sur le pilote, le réel a été de 3 à 8 fois l'estimation.
- En mode autonome, les décisions d'office ne sont relues qu'à la PR ; le coupe-circuit borne leur nombre, pas leur qualité.
- Les écarts sensibles sont repérés par mots-clés (données, base, prod, secret…) : le filtre attrape large, mais ne voit pas un risque formulé autrement.
- Deux tâches qui partagent une base ou un port tournent l'une après l'autre.
- Claude Code peut signaler au démarrage les règles d'autorisation `Bash(git -C * diff *)` et `Bash(git -C * log *)` (joker avant la sous-commande) : elles servent à l'évaluateur, qui lit le diff d'un worktree.
