# Changelog — plugin orchestre-suivi

## 0.1.0 — 08/10/2026 : premier mod de suivi

Le mod suit un run du plugin `orchestre` (0.8 ou plus) dans la session pilote, sous Claude Code 2.1.287 ou plus (version à partir de laquelle les mods sont actifs par défaut, d'après la doc des mods), d'après les maquettes validées (bandeau, panneau, relectures, bilan). Il lit `plans/<nom>/suivi.json` au format `orchestre-suivi/1`, écrit par `scripts/suivi.mjs` d'orchestre, et n'écrit rien dans le dépôt.

- Plan suivi : celui de `/suivi plans/<nom>`, sinon le `suivi.json` écrit en dernier dans `plans/` (`/suivi auto` y revient). Le dossier `plans/` est cherché dans le dossier de la session et ses parents. Relecture toutes les 2 s, seulement si le fichier a changé.
- Bandeau au-dessus du prompt pendant un run : phase, barre d'avancement, tâches en cours, relectures, tâches qui attendent, durée du run ; à la fin du run, son statut, jusqu'à « Masquer » ou au run suivant.
- Spinner : la tâche et l'étape en cours, et le nombre de tâches qui tournent.
- `/suivi` répond même pendant un tour : un panneau à quatre onglets (Tâches, À relire, Journal, Bilan ; touches t, r, j, b), ou le même état en texte avec `/suivi texte` ou là où un panneau ne se place pas. Le Bilan propose « Préparer la PR dans le prompt » (touche p) : un brouillon avec les relectures, les décisions d'office et ce qui attend, jamais envoyé.
- Notifications : run lancé ou arrêté, phase terminée, tâche qui attend un humain, bloquée ou en échec, nouvelle relecture, point d'arrêt.
- Choix faits faute de donnée dans suivi.json : pas de titre de phase (« Phase N ») ; les « écarts conservés » des maquettes deviennent le nombre d'entrées majeures de HANDOFF.md par type ; les heures sont des âges (« il y a 12 min »), le fuseau du mod n'étant pas vérifié.
- Suivi des sessions : une session interactive, ou hébergée par l'app de bureau (lecture au `session.attach` quand elle démarre sans surface) ; un `claude -p` ne lit rien.
- Pendant un run, le bandeau se redessine toutes les 30 s même sans nouvelle écriture de `suivi.json` : la durée avance. Un run resté « en-cours » sans écriture depuis 45 min est montré « ◌ sans nouvelles depuis … » (session fermée en plein run), sans tâche en cours ni suffixe au spinner.
- Une notification par tâche pour ses relectures (« ⚑ T02 : 2 relectures avant la PR ») ; le point d'arrêt noté par le scribe à la clôture est signalé quand la fin du run en fait un arrêt ; une phase dont toutes les tâches sont annulées n'est plus comptée ; le brouillon de PR s'ajoute à ce qui est déjà tapé dans le prompt.
- Relu par un agent avant livraison : ces neuf défauts relevés, tous corrigés.
- Trouvés en jouant la démo (`tests/demo-suivi.mjs`), corrigés : un run en mode auto montrait encore sa phase de départ en phase 2 (le bandeau suit maintenant la plus haute phase des tâches que le run a démarrées ou closes, et la fin de run dit « phases 1 à 2 ») ; la durée d'une phase ne comptait que les runs partis de cette phase (elle va maintenant, dans chaque run, du premier démarrage au dernier achèvement de ses tâches) ; une tâche dont le run venait de trancher le point, ou qu'il avait relancée, restait « à toi ».
- Démo : `node tests/demo-suivi.mjs <dossier>` crée un dépôt jouet et y joue deux runs avec le vrai `suivi.mjs`, sans agent ni modèle ; après chaque pas, elle affiche ce que le mod doit montrer, calculé par son modèle.
- Tests : 12 cas du modèle sur des `suivi.json` écrits par le vrai `suivi.mjs`, dont la démo jouée sans pause (`npm test`) ; 4 tests sous le moteur (`claude plugin test`), sur le terminal et le bureau ; 27 mutations du modèle et des hooks, toutes détectées.

### Pas encore vérifié en réel

- Le chargement du mod sur le Mac (Claude Code 2.1.287 ou plus attendu ; `/plugin` doit le nommer parmi les mods actifs).
- Le dessin réel du bandeau, du spinner et du panneau (le kit de test valide les arbres, pas le rendu) : la démo sert à le vérifier.
- Le coût d'une relecture toutes les 2 s sur un gros `suivi.json` (au-delà de 4 Mio, `$.fs.read` refuse et l'affichage garde la lecture précédente).
