# Changelog — plugin orchestre

Chaque version vient du pilote SPACE-Platform (plan `acces-par-metier`, 15 tâches, 4 phases), sauf la 0.6, qui change l'empaquetage.

## 0.6.1 — 29/09/2026 : prêt à lancer

Tout ce qu'un humain doit décider ou faire est repéré à la planification, écrit dans le plan et contrôlé par plan-lint avant chaque phase. Au premier run réel (mr-review-recall), quatre décisions ouvertes du plan source n'avaient été posées ni à la conversion ni au lancement.

- `PREREQUIS.md` dans le plan : une ligne par prérequis (décision, geste humain ou environnement), avec son statut (`ouvert`, `fait`, `abandonné`) et sa preuve. Chaque tâche cite les siens dans `prerequis:`.
- plan-lint : refuse un prérequis inconnu, en double, pris par une tâche, de type ou de statut inconnu ; une décision au statut `fait` qu'aucune entrée de HANDOFF.md commençant par `décision ·` ne cite ; une décision ouverte qu'aucune tâche restante ne cite ; un PREREQUIS.md sans tableau reconnu ou avec une ligne ignorée. Il signale un geste ou un environnement ouvert que rien ne cite, et compte une tâche « besoin-humain » comme en attente. Le JSON donne `prerequis_ouverts` par tâche, `prerequis` (avec les tâches bloquées) et `pret` par phase. La sortie texte affiche un bloc « Prêt à lancer ». Un `\|` est permis dans une cellule de tableau.
- Workflow : une tâche dont un prérequis est ouvert ne part pas, même relancée ; les tâches de sa phase qui en dépendent attendent avec elle, et le reste tourne. Nouveau champ de rapport : `en_attente_prerequis`.
- `/orchestre:preparer` : le plafond de 3 questions disparaît. Il pose toutes les décisions ouvertes, par lots de 4, avec une option « Reporter », inventorie gestes et environnement dans PREREQUIS.md, et conclut phase par phase si le plan est prêt à lancer.
- Nouvelle commande `/orchestre:pret` : environnement, prérequis (décisions tranchées sur-le-champ, gestes à faire), répétition à blanc des vérifications sûres, verdict par phase. Pour un plan écrit avant la 0.6.1, elle construit d'abord PREREQUIS.md.
- `/orchestre:lancer` : contrôle des prérequis au pré-vol et avant chaque phase, preuve des prérequis d'environnement rejouée ; en arrêt par phase, le résumé de la phase va dans le texte même de la question de fin de phase, si bien que le pilote ne peut plus le sauter. Une phase `partiel` avec des tâches ajoutées ou reportées est relancée d'elle-même.
- Le replanificateur lit PREREQUIS.md : un point sur un prérequis ouvert est humain, et une tâche ajoutée cite ses prérequis. Le lecteur du plan doit rendre `prerequis_ouverts` pour chaque tâche.
- Répétition à blanc : un échec n'est classé « déjà présent » que si aucune tâche n'est fusionnée ou s'il se reproduit sur la branche de base ; l'état git est comparé avant et après.
- Tests : 52 scénarios (5 nouveaux), 13 cas plan-lint (4 nouveaux), 13 mutations détectées, une par garde-fou nouveau.

## 0.6.0 — 29/09/2026 : plugin

L'orchestrateur devient un plugin installable depuis la marketplace `circle`, au lieu d'une copie dans le `.claude/` de chaque projet. La logique d'orchestration est celle de la v0.5, avec les corrections listées plus bas.

- Commandes namespacées : `/orchestre:lancer` (ex-`/lancer`), workflow `orchestre:executer-phase`, agents `orchestre:<agent>`.
- Nouvelle commande `/orchestre:installer` : réglages du projet (`worktree.baseRef`, `autoContinueAtUsageLimit`, autorisations et refus), `.worktreeinclude`, exclusions du formateur, retrait d'une installation manuelle, partage avec l'équipe (`--equipe`).
- Nouvelle commande `/orchestre:preparer` : convertit un plan déjà écrit ou en rédige un nouveau, au format de l'orchestrateur, puis le valide avec plan-lint. Elle reprend le modèle de brief de planification de la v0.5.
- Workflow : nouveaux `args`, passés par `/orchestre:lancer` : `lint` (chemin de plan-lint dans le plugin ; sans lui, l'ancien `.claude/orchestre/plan-lint.mjs`), `prefixe_agents` (`orchestre:` par défaut ; `''` pour une installation manuelle) et `base` (branche de base, lue par plan-lint). `horodatage`, que rien ne lisait, disparaît.
- plan-lint : `--base` (sinon `main`, sinon `master`) ; refuse une branche qui commence par `-` (git l'aurait lue comme une option : `--output=…` écrivait un fichier) et un dossier sans `taches/`.

Corrections issues de la relecture de la v0.6, dont plusieurs valaient déjà pour la v0.5 :

- **Mode** : il vaut `auto`, `devia` ou `phase`, et toute autre valeur arrête le run. Avant, une valeur inconnue retombait sans bruit en arrêt par phase : « arrêt sur déviation » ne marchait que si le pilote devinait `devia`. `/orchestre:lancer` passe maintenant les codes exacts.
- **Fusions d'un plan précédent** : plan-lint ne compte plus que les commits « tâche <id> : » de la branche d'intégration absents de la branche de base. Avant, dès le deuxième plan d'un dépôt, les fusions du premier, déjà dans `main`, faisaient passer pour fusionnées les tâches de même identifiant. Nouveau champ de config : `branche_base`.
- **Amendement d'une tâche déjà fusionnée** : il est écarté et consigné en angle mort, et le run continue. C'est le cas d'un arbitrage tranché après que sa tâche a tourné, ou, en autonome, d'une tâche d'une autre phase. Avant, le scribe le refusait et le run s'arrêtait.
- **Reprise d'une tâche** : une seule règle, dans le checkout principal comme en worktree. Le worker reprend la branche la plus récente, ou en crée une nouvelle `tache/<id>-r<n>` si un worktree la tient encore, et rend son nom exact. Avant, une reprise dans le checkout principal échouait sur une branche tenue par un worktree.
- **Parallélisme de 1** : plus de worktree, donc plus de réinstallation des dépendances pour rien.
- **Erreur du workflow pendant une tâche** : sa raison arrive dans `blocage`.
- **`arbitrages_appliques`** : des objets `{ tache, titre, option }` au lieu de `tache/option`, ambigu ; un arbitrage appliqué avec des refus s'annonce « appliqué en partie ».
- **plan-lint** : une virgule entre guillemets ne coupe plus un élément de liste courte ; « 1 tâche » au singulier.
- **Skills** :
  - `/orchestre:installer` écrit les réglages après accord, ne retire jamais l'ancienne installation pendant un run, et reconnaît tous ses fichiers ;
  - `/orchestre:preparer` n'ouvre ni `.env` ni dump, et ne lance les tests que s'ils ne touchent ni base partagée ni données réelles.
- **Tests** : 47 scénarios simulés, dont 10 nouveaux pour le plugin et les corrections ; 9 cas de plan-lint versionnés (`tests/plan-lint.test.mjs`) ; 11 mutations, une par correction, toutes détectées ; un dépôt jouet pour un essai réel (`tests/depot-jouet.sh`).
- Vérifié : `claude plugin validate` du plugin et de la marketplace, installation depuis la marketplace, inventaire (3 skills, 8 agents) ; sur un plugin de test, workflow de plugin appelé par son nom, agent du plugin résolu depuis `agent({ agentType: '<plugin>:<agent>' })`, `${CLAUDE_PLUGIN_ROOT}` substitué dans le corps d'un agent et d'une skill. Pas encore de run complet sous forme de plugin.

## 0.5.0 — 29/09/2026 : après la phase 4

- Écarts sensibles (données, base, prod, secret) majeurs d'office ; sans point de décision, arrêt pour un humain.
- Cohérence des décisions d'office : une option qui cite une tâche que rien ne crée n'est pas appliquée et le run s'arrête ; le scribe vérifie les fichiers cités. plan-lint rend `tous` et `phase_max`.
- Statut `besoin-humain` : une tâche en attente d'un humain ne repart qu'avec `args.relancer`.
- Données réelles : aucun agent n'ouvre, ne restaure ni ne copie de données de production ou personnelles réelles ; un test ne modifie pas une base partagée.
- Textes vrais : l'évaluateur vérifie commentaires, DECISIONS et procédures.
- Convergence : en dernière phase, les points qui ne protègent pas le déploiement deviennent des tickets.
- Qualité d'abord : évaluateur et replanificateur sur opus, vérificateur et scribe sur sonnet.
- 37 scénarios simulés, 25 mutations détectées.

## 0.4.0 — 28/09/2026 : après la phase 2

- Points à trancher avec options et actions prêtes à appliquer ; en mode autonome, l'option recommandée est prise d'office.
- Garde-fous : point humain, coupe-circuit (`decisions_office_max`), compte rendu obligatoire du scribe, plan-lint après chaque création ou amendement.
- Arbitrages de l'utilisateur appliqués par le scribe (`args.arbitrages`), statut `à-relancer`.
- worker-isole installe les dépendances dans son worktree.

## 0.3.0 — 28/09/2026 : après les évaluations de T00

- Le vérificateur rend code de sortie et extrait de chaque commande, que l'évaluateur reçoit comme preuves ; le rapport du worker est un livrable, pas une preuve.
- Refus consignés (`refus · mineur`) ; critères non vérifiables notés en angle mort au lieu d'un KO.

## 0.2.0 — 28/09/2026 : après la phase 1

- Relance tolérée des tests instables, raison exacte des blocages, reprise de la branche d'une tâche relancée, retour du scribe sur la branche d'intégration, correction d'une tâche bloquée depuis la session pilote.

## 0.1.0 — 27/09/2026

- Premier workflow `executer-phase` : un run par phase, worktrees pour les tâches parallèles, `effort` transmis, plan-lint `--integration`.
