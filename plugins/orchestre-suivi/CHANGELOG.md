# Changelog — plugin orchestre-suivi

## 0.2.0 — 09/10/2026 : couleurs, animation et `/suivi demo`

0.1.0 a été publiée sans être vue en réel ; cette version ajoute ce qu'il faut pour la voir dans n'importe quelle session.

- Bandeau au-dessus du prompt pendant un run : phases, barre d'avancement, tâche et étape en cours, relectures, tâches qui attendent, durée du run, dernière nouvelle ; à la fin du run, son statut, jusqu'à « Masquer » (touche 0) ou au run suivant. Il tient dans la largeur de la bande : l'aide, la nouvelle, le détail de l'étape, puis les libellés, la barre, la durée et le numéro du run partent tour à tour.
- En couleurs et animé, d'après la maquette validée le 08/10 (couleurs du thème de la personne) :
  - barre par statut : une ou plusieurs cases par tâche, ou en proportion sur un gros plan, vertes quand elles sont fusionnées, bleues quand elles sont en cours (elles pulsent), ambre quand elles attendent un humain, rouges quand elles sont bloquées ou en échec, grises sinon ; dans le panneau et le Bilan, une case ■ par tâche de chaque phase ;
  - phases en points (● faite, ◉ celle du run, ○ à venir), ou « phase 3/27 » au-delà de 10 phases ;
  - roue qui tourne en tête du bandeau et ◐◓◑◒ pour les tâches en cours, avec leur chrono ; redessin toutes les 150 ms pendant un run actif et tant qu'une nouvelle a moins de 10 s, toutes les 30 s pour un run sans nouvelles, rien sinon ;
  - dernière nouvelle au bout du bandeau (« ✓ T01 fusionnée », « ⚑ T03 attend un humain », « ▶ run 2 lancé ») : la plus importante de la dernière écriture, vive 5 s puis estompée jusqu'à 10 s ; « Dernières nouvelles » au bas de l'onglet Tâches ;
  - pastilles sur fond coloré : « ⚠ à toi » en ambre, l'onglet ouvert, une tâche tout juste fusionnée (« fusionnée » en vert, 5 s) ; une couleur par étape (réalisation, vérification, évaluation, correction, fusion).
- Mode démo : `/suivi demo`, dans n'importe quelle session, joue en mémoire deux runs d'un plan fictif (`site-vitrine`, 5 tâches, 2 phases) en un peu plus d'une minute : bandeau marqué DÉMO, notifications, arrêt sur un arbitrage avec une pause de 12 s, reprise, fin. Rien n'est lu ni écrit dans le dépôt pendant la démo ; le vrai suivi reprend une minute après le dernier pas, ou à `/suivi auto`. Un « Masquer » de la démo ne vaut pas pour les vrais runs ; une démo figée par un rechargement du mod s'efface.
- Les documents de la démo suivent le schéma du contrat (vérifié par `suivi.mjs valider` à chaque pas), et `tests/demo-suivi.mjs` joue le même scénario avec le vrai `suivi.mjs` : les tests vérifient les mêmes notifications et le même journal, entrée pour entrée.
- Le mode démo a remplacé `tests/demo-suivi.mjs` comme façon de voir le mod ; le script reste pour les tests.
- Tests : 18 cas du modèle sur des `suivi.json` écrits par le vrai `suivi.mjs`, dont `/suivi demo` comparée au vrai `suivi.mjs` (`npm test`) ; 12 tests sous le moteur (`claude plugin test`), sur le terminal et le bureau, dont `/clear` simulé par un `$.state` tenu par le test, l'animation sous une horloge simulée et la démo de bout en bout ; 65 mutations du modèle, de la démo et des hooks, rejouées sur le code final, toutes détectées. Vérifié avec le kit de test de Claude Code 2.1.294.

### Pas encore vérifié en réel

- Le chargement du mod sur le Mac (Claude Code 2.1.287 ou plus attendu ; `/plugin` doit le nommer parmi les mods actifs).
- Le dessin réel du bandeau, du spinner et du panneau, couleurs et animation comprises (le kit de test valide les arbres, pas le rendu) : `/suivi demo` sert à le vérifier. Le coût d'un redessin toutes les 150 ms pendant un run est une donnée à collecter.
- Le coût d'une relecture toutes les 2 s sur un gros `suivi.json` (au-delà de 4 Mio, `$.fs.read` refuse et l'affichage garde la lecture précédente).

## 0.1.0 — 08/10/2026 : premier mod de suivi

Le mod suit un run du plugin `orchestre` (0.8 ou plus) dans la session pilote, sous Claude Code 2.1.287 ou plus (version à partir de laquelle les mods sont actifs par défaut, d'après la doc des mods), d'après les maquettes validées (bandeau, panneau, relectures, bilan). Il lit `plans/<nom>/suivi.json` au format `orchestre-suivi/1`, écrit par `scripts/suivi.mjs` d'orchestre, et n'écrit rien dans le dépôt.

- Plan suivi : celui de `/suivi plans/<nom>`, sinon le `suivi.json` écrit en dernier dans `plans/` (`/suivi auto` y revient). Le dossier `plans/` est cherché dans le dossier de la session et ses parents. Relecture toutes les 2 s, seulement si le fichier a changé.
- Bandeau au-dessus du prompt pendant un run : phase, barre d'avancement, tâches en cours, relectures, tâches qui attendent, durée du run ; à la fin du run, son statut, jusqu'à « Masquer » (touche 0) ou au run suivant. Il tient dans la largeur de la bande : l'aide, puis les libellés, la barre, la durée et le numéro du run partent tour à tour.
- Spinner : la tâche et l'étape en cours, et le nombre de tâches qui tournent.
- `/suivi` répond même pendant un tour : un panneau à quatre onglets (Tâches, À relire, Journal, Bilan ; touches t, r, j, b), ou le même état en texte avec `/suivi texte` ou là où un panneau ne se place pas. Le Bilan propose « Préparer la PR dans le prompt » (touche p) : un brouillon avec les relectures, les décisions d'office et ce qui attend, jamais envoyé.
- Notifications : run lancé ou arrêté, phase terminée, tâche qui attend un humain, bloquée ou en échec, nouvelle relecture, point d'arrêt.
- Choix faits faute de donnée dans suivi.json : pas de titre de phase (« Phase N ») ; les « écarts conservés » des maquettes deviennent le nombre d'entrées majeures de HANDOFF.md par type ; les heures sont des âges (« il y a 12 min »), le fuseau du mod n'étant pas vérifié.
- Suivi des sessions : une session interactive, ou hébergée par l'app de bureau (lecture au `session.attach` quand elle démarre sans surface) ; un `claude -p` ne lit rien.
- Pendant un run, le bandeau se redessine toutes les 30 s même sans nouvelle écriture de `suivi.json` : la durée avance. Un run resté « en-cours » sans écriture depuis 45 min est montré « ◌ sans nouvelles depuis … » (session fermée en plein run), sans tâche en cours ni suffixe au spinner.
- Une notification par tâche pour ses relectures (« ⚑ T02 : 2 relectures avant la PR ») ; le point d'arrêt noté par le scribe à la clôture est signalé quand la fin du run en fait un arrêt ; une phase dont toutes les tâches sont annulées n'est plus comptée ; le brouillon de PR s'ajoute à ce qui est déjà tapé dans le prompt.
- Relu par un agent avant livraison : ces neuf défauts relevés, tous corrigés.
- Trouvés en jouant la démo (`tests/demo-suivi.mjs`), corrigés : un run en mode auto montrait encore sa phase de départ en phase 2 (le bandeau suit maintenant la plus haute phase des tâches que le run a démarrées ou closes, et la fin de run dit « phases 1 à 2 ») ; la durée d'une phase ne comptait que les runs partis de cette phase (elle va maintenant, dans chaque run, du premier démarrage au dernier achèvement de ses tâches) ; une tâche dont le run venait de trancher le point, ou qu'il avait relancée, restait « à toi ».
- Aligné sur la doc des mods (code.claude.com/docs/en/plugins/mods, pages interface, référence, API, tests et dépannage), lue en entier :
  - la bande au-dessus du prompt est partagée : ce que les mods suivants y dessinent reste affiché sous le bandeau ;
  - « Masquer » a la touche 0, qui marche aussi tapée seule dans un prompt vide, sans focus sur la bande ;
  - `/suivi` est enregistrée en dernier, dans un try/catch : un nom déjà pris ne bloque plus la lecture ni le bandeau, et une notification le dit ;
  - le bandeau tient dans `bodyColumns`, la place du bouton « Masquer » comprise ;
  - après `/clear`, `/resume` ou `/branch`, qui remettent `$.state` à zéro sans relancer `session.start` : le plan choisi par `/suivi plans/<nom>` et le « Masquer » reviennent, et `suivi.json` est relu tout de suite (`classic.SessionStart`) ;
  - Échap ferme le panneau ; les notifications qui demandent quelqu'un (attend un humain, bloquée, en échec, run arrêté ou en erreur) restent 15 s au lieu de 4.
- Démo : `node tests/demo-suivi.mjs <dossier>` crée un dépôt jouet et y joue deux runs avec le vrai `suivi.mjs`, sans agent ni modèle ; après chaque pas, elle affiche ce que le mod doit montrer, calculé par son modèle.
- Tests : 14 cas du modèle sur des `suivi.json` écrits par le vrai `suivi.mjs`, dont la démo jouée sans pause (`npm test`) ; 7 tests sous le moteur (`claude plugin test`), sur le terminal et le bureau, dont `/clear` simulé par un `$.state` tenu par le test ; 34 mutations du modèle et des hooks, rejouées sur le code final, toutes détectées. Vérifié avec le kit de test de Claude Code 2.1.294.

### Pas encore vérifié en réel

- Le chargement du mod sur le Mac (Claude Code 2.1.287 ou plus attendu ; `/plugin` doit le nommer parmi les mods actifs).
- Le dessin réel du bandeau, du spinner et du panneau (le kit de test valide les arbres, pas le rendu) : la démo sert à le vérifier.
- Le coût d'une relecture toutes les 2 s sur un gros `suivi.json` (au-delà de 4 Mio, `$.fs.read` refuse et l'affichage garde la lecture précédente).
