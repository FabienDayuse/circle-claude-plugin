export const meta = {
  name: 'executer-phase',
  description: "Exécute une phase d'un plan (dossier plans/<nom>) : workers, vérification, évaluation, corrections, fusion et suivi. Lancé par /orchestre:lancer.",
  phases: [{ title: 'Lecture du plan' }, { title: 'Tâches' }, { title: 'Clôture' }],
}

// Orchestrateur v0.6.2 (plugin orchestre)
// args : { plan, phase, mode: 'auto'|'devia'|'phase', parallelisme, integration, base, decisions, corrections_max, escalade, decisions_office_max, arbitrages, relancer, lint, prefixe_agents }
// base : branche d'où part la branche d'intégration (main par défaut, lu par plan-lint)
// arbitrages : options choisies par l'utilisateur depuis le run précédent, [{ tache, titre, option }] ; le scribe les applique avant la lecture du plan
// relancer : ids de tâches « besoin-humain » que l'utilisateur fait repartir, après sa décision
const A = args || {}
const PLAN = A.plan
const PHASE = Number(A.phase)
const MODE = A.mode || 'phase'
const PAR = Math.max(1, Math.min(Number(A.parallelisme) || 4, 8))
const INTEG = A.integration
const MAXFIX = A.corrections_max ?? 2
const ESC = A.escalade || ['sonnet', 'opus']
const DECISIONS = A.decisions || []
const MAXOFFICE = A.decisions_office_max ?? 3
const FAIT = s => s === 'fusionnée' || s === 'annulée'
const ARB = (A.arbitrages || []).filter(a => a && a.option)
const RELANCER = new Set(A.relancer || [])
// Plugin : agents namespacés (« orchestre:worker ») et plan-lint livré avec le plugin ; /orchestre:lancer passe lint et prefixe_agents
// Installation manuelle dans .claude/ (v0.5 et avant) : prefixe_agents '' et lint par défaut
const AG = n => (A.prefixe_agents ?? 'orchestre:') + n
const LINT = A.lint || '.claude/orchestre/plan-lint.mjs'
const LINTCMD = /\s/.test(LINT) ? `node "${LINT}"` : `node ${LINT}`
const BASE = A.base ? ` --base ${A.base}` : ''
// Écart sensible (données, base, prod, secret) : majeur d'office, quel que soit le classement du replanificateur
// Écarts sensibles, repérés par mots-clés ; SENSIBLE_HORS_ENV sert au reclassement d'une interdiction en relecture
const SENSIBLE_HORS_ENV = /base de (données|dev|prod)|\bbdd\b|database|\bdump\b|\bprod\b|production|données (personnelles|réelles|de prod|utilisateur)|personal data|\bpii\b|rgpd|gdpr|secret|mot de passe|password|api[ -]?key|clé (d')?api|credential|pg_restore|pg_dump|database_url/i
const SENSIBLE = new RegExp(SENSIBLE_HORS_ENV.source + '|\\.env\\b', 'i')
if (!PLAN || !PHASE || !INTEG) return { statut: 'erreur', detail: 'args requis : plan, phase, integration' }
if (!['auto', 'devia', 'phase'].includes(MODE)) return { statut: 'erreur', detail: `mode inconnu : ${MODE} (auto, devia ou phase)` }

// Schémas des rapports
const S = (properties, required) => ({ type: 'object', properties, required })
const str = { type: 'string' }, bool = { type: 'boolean' }, strs = { type: 'array', items: str }
const PLAN_S = S({ ok: bool, erreurs: strs, taches: { type: 'array', items: S({ id: str, titre: str, fichier: str, phase: { type: 'integer' }, modele: str, effort: str, depend_de: strs, ressources: strs, statut: str, verification: strs, prerequis_ouverts: strs }, ['id', 'fichier', 'depend_de', 'statut', 'verification', 'prerequis_ouverts']) }, tous: { type: 'array', items: S({ id: str, phase: { type: 'integer' }, statut: str }, ['id']) }, phase_max: { type: 'integer' } }, ['ok', 'taches'])
const RAPPORT_S = S({
  statut: { type: 'string', enum: ['done', 'partial', 'blocked'] }, resume: str, branche: str, commit: str, chemin: str, fichiers_modifies: strs,
  ecarts: { type: 'array', items: S({ type: { type: 'string', enum: ['écart', 'angle-mort', 'décision', 'dette', 'besoin-humain', 'relecture'] }, description: str, taches_impactees: strs }, ['type', 'description']) },
  decouvertes: { type: 'array', items: S({ categorie: str, contenu: str }, ['categorie', 'contenu']) }, blocage: str,
}, ['statut', 'resume', 'branche', 'chemin'])
const RESULTAT_S = S({ commande: str, code: { type: 'integer' }, extrait: str }, ['commande', 'code', 'extrait'])
const VERIF_S = S({ ok: bool, resultats: { type: 'array', items: RESULTAT_S }, echecs: { type: 'array', items: S({ commande: str, extrait: str }, ['commande']) }, instables: strs, interdites: strs }, ['ok', 'resultats'])
const EVAL_S = S({ verdict: { type: 'string', enum: ['ok', 'ko'] }, manques: strs, non_verifiables: strs, illisibles: strs }, ['verdict'])
const INTEG_S = S({ ok: bool, fusionne: bool, controle_ok: bool, conflit: bool, commit: str, detail: str }, ['ok', 'fusionne'])
const SCRIBE_S = S({ ok: bool, commit: str, refuses: { type: 'array', items: S({ id: str, raison: str }, ['id', 'raison']) }, ecartes: { type: 'array', items: S({ id: str, raison: str }, ['id', 'raison']) } }, ['ok'])
const ENTREES_S = { type: 'array', items: S({ type: str, gravite: { type: 'string', enum: ['mineur', 'majeur'] }, description: str }, ['type', 'gravite', 'description']) }
const TACHES_S = { type: 'array', items: S({ id: str, titre: str, phase: { type: 'integer' }, contenu: str }, ['id', 'titre', 'phase', 'contenu']) }
const AMENDS_S = { type: 'array', items: S({ id: str, definition_du_fini: strs, fichiers_possedes: strs, verification: strs, depend_de: strs, raison: str }, ['id', 'raison']) }
const OPTION_S = S({ id: str, description: str, impact: str, recommande: bool, entrees: ENTREES_S, taches_ajoutees: TACHES_S, amendements: AMENDS_S }, ['id', 'description'])
const REPLAN_S = S({
  majeur: bool,
  points: { type: 'array', items: S({ titre: str, contexte: str, humain: bool, options: { type: 'array', items: OPTION_S } }, ['titre', 'options']) },
  entrees: ENTREES_S,
  taches_ajoutees: TACHES_S,
  relectures: { type: 'array', items: S({ relecture: str, ecart: str }, ['relecture']) },
}, ['majeur', 'entrees'])

// Un seul agent à la fois dans le checkout principal (fusions, suivi)
let file = Promise.resolve()
const exclusif = fn => { const p = file.then(fn); file = p.catch(() => null); return p }
const ORDRE = ['haiku', 'sonnet', 'opus', 'fable']
const auMoins = (m, base) => ORDRE[Math.max(ORDRE.indexOf(m), ORDRE.indexOf(base || 'sonnet'))] || m
const liste = xs => (xs || []).map(x => '- ' + x).join('\n')
const effort = t => (t.effort ? { effort: t.effort } : {})
const uniques = xs => [...new Map(xs.map(x => [JSON.stringify(x), x])).values()]
// Un rapport de correction ne répète pas les écarts des essais précédents : on les cumule, pour qu'aucun n'échappe au replanificateur
const cumuler = (avant, apres) => ({ ...apres, ecarts: uniques([...(avant.ecarts || []), ...(apres.ecarts || [])]), decouvertes: apres.decouvertes ?? avant.decouvertes })
// Commande citée par un agent, comparée à celle de la tâche : sans le « cd <dossier de travail> && » qu'ajoute le vérificateur
// (un autre cd de tête fait partie de la commande), sans le echo du code de sortie, espaces réduits
const sansPrefixe = (x, dossier) => { const m = x.match(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/); return m && dossier && m[1].replace(/^["']|["']$/g, '') === dossier ? x.slice(m[0].length) : x }
const normaliser = (c, dossier) => sansPrefixe(String(c || '').trim(), dossier).replace(/\s*;\s*echo\s+["']?code=\$\?["']?\s*$/, '').replace(/\s+/g, ' ').trim()
const memeCommande = (a, b, dossier) => normaliser(a, dossier) === normaliser(b, dossier)
// Une relecture cite un fichier si l'un de ses mots est ce chemin, et non un chemin qui le contient
const chemin = x => x.replace(/^\.\//, '').replace(/\.+$/, '')
const cite = (d, f) => String(d).split(/[\s,;:()«»"'`]+/).some(x => x && chemin(x) === chemin(f))

// Prompts
// Branche d'une tâche : neuve, ou reprise de la plus récente (une branche tenue par un autre worktree ne se reprend pas, on en part)
const pBranche = t => `Branche : si aucune branche \`tache/${t.id}\` n'existe, crée-la avec \`git switch -c tache/${t.id}\`. Sinon (tentative précédente), reprends le travail le plus récent : \`git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads/tache/${t.id} 'refs/heads/tache/${t.id}-r*'\` donne en premier la branche la plus récente ; si aucun worktree ne l'utilise (\`git worktree list\`), place-toi dessus avec \`git switch <branche>\`, sinon crée à partir d'elle \`tache/${t.id}-r<n>\`, avec le premier n libre à partir de 2 (\`git switch -c tache/${t.id}-r<n> <branche>\`). Commite tout ton travail sur la branche où tu es et rends son nom exact dans « branche ».`
const pWorker = (t, isole) => `Tâche ${t.id} du plan ${PLAN}. Lis d'abord ${PLAN}/DISCOVERY.md et les décisions de ${PLAN}/HANDOFF.md, puis ${t.fichier}, et suis son « Prompt de lancement ».
${isole ? 'Tu es dans un worktree isolé.' : `Tu es dans le checkout principal, sur ${INTEG}.`} ${pBranche(t)}
Décisions prises : ${JSON.stringify(decisionsRun())}.
Un fichier que tes permissions t'interdisent de lire ou de modifier (réglages de l'organisation ou du projet) : ne contourne jamais l'interdiction, par aucune commande ni script ; décris la modification attendue dans un écart de type « relecture », l'humain la fera avant la PR.
Lance les commandes de vérification de la tâche avant de rendre la main.
Rapport : statut, résumé, branche, dernier commit, chemin absolu du dossier de travail (pwd), fichiers modifiés, écarts au plan, découvertes utiles aux tâches suivantes.`
const pVerif = (t, r) => `Vérifie la tâche ${t.id}, branche ${r.branche}. Exécute une par une, sans rien modifier, chaque commande ci-dessous, préfixée par \`cd "${r.chemin}" &&\` :
${liste(t.verification)}
Les échecs listés comme préexistants dans ${PLAN}/DISCOVERY.md ne comptent pas. Une commande que tes permissions refusent (réglages de l'organisation ou du projet) : ne la contourne jamais, par aucune autre commande ni script, et ne la compte pas en échec ; cite-la dans « interdites », telle qu'elle figure dans la liste ci-dessus, sans le préfixe \`cd\` ; l'humain la lancera avant la PR. Si une commande de test échoue, relance-la une seule fois : si elle passe, la vérification passe, mais cite chaque test qui a échoué puis réussi dans « instables ». Pour lire un code de sortie, ne pipe pas la commande : ajoute \`; echo "code=$?"\`. Rends ok ; dans « resultats », pour chaque commande, même réussie, la commande, son code de sortie (celui de la relance s'il y en a eu une) et l'extrait qui le prouve (ligne de bilan, 10 lignes au plus) ; dans « echecs », pour chaque échec qui compte, la commande et un extrait utile de sa sortie (30 lignes au plus). Ne lance jamais une commande qui lit des données de production ou personnelles réelles (dump de prod, base de prod ou copie de prod) : compte-la en échec, avec l'extrait « besoin-humain : données réelles, geste réservé à l'humain ».`
const pEval = (t, r, v) => `Évalue la tâche ${t.id}. Lis la définition du fini dans ${t.fichier}, puis le diff \`git -C "${r.chemin}" diff ${INTEG}...${r.branche}\`.
Résultats du vérificateur, relevés sur cette branche juste avant toi ; ils valent preuve d'exécution : ${JSON.stringify((v && v.resultats) || [])}.${v && (v.instables || []).length ? ` Tests passés seulement à la relance, comptés comme passés : ${JSON.stringify(v.instables)}.` : ''}
${(v && (v.interdites || []).length) ? `Commandes refusées aux agents par leurs permissions, que l'humain lancera avant la PR : ${JSON.stringify(v.interdites)}. Un critère que seules elles démontrent n'est ni un manque ni un critère non vérifiable.
` : ''}Rapport du worker ; c'est un livrable, pas une preuve : ses affirmations d'exécution ne démontrent rien. ${JSON.stringify({ resume: r.resume, decouvertes: r.decouvertes || [], ecarts: r.ecarts || [] })}
Pour chaque critère, cherche une preuve : fichier:ligne du diff, test qui le couvre, ou résultat du vérificateur ci-dessus. Un critère qui demande un contenu de rapport est rempli si ce contenu figure dans le rapport du worker. SUIVI.md, HANDOFF.md et DISCOVERY.md ne sont écrits par le scribe qu'en fin de tâche : leur état ne prouve rien, dans un sens comme dans l'autre. Un critère qu'aucune commande de vérification ni le diff ne peut démontrer dans le contexte de cette tâche, quoi que fasse le worker (par exemple un comportement en worktree pour une tâche du checkout principal), n'est pas un manque : cite-le dans « non_verifiables » avec la raison. C'est rare : un critère seulement non prouvé reste un manque. Un fichier du diff que tes permissions t'interdisent de lire (réglages de l'organisation ou du projet) : ne contourne jamais l'interdiction ; ce n'est ni un manque ni un critère non vérifiable : cite-le dans « illisibles », l'humain le relira avant la PR. Un critère qui ne se démontre qu'en lisant un tel fichier suit la même règle. Vérifie aussi que les commentaires, en-têtes, entrées de DECISIONS et procédures ajoutés ou modifiés par le diff disent vrai : ils décrivent ce que le code fait vraiment, et chaque commande d'une procédure destinée à un humain existe dans le dépôt et fait ce que le texte annonce. Un texte faux est un manque. Verdict ko si un seul critère démontrable n'est pas démontré ; liste alors les manques précis. Ne modifie rien.`
const pCorr = (t, r, manques) => `Correction de la tâche ${t.id}. Travaille dans ${r.chemin}, sur la branche ${r.branche} : préfixe chaque commande par \`cd "${r.chemin}" &&\` et édite les fichiers par leur chemin absolu sous ce dossier. Relis ${t.fichier} et ${PLAN}/DISCOVERY.md.
Manques à corriger :
${liste(manques)}
Mêmes règles que la tâche : fichiers possédés seulement, commits sur ${r.branche}, rien dans les fichiers de suivi, ni fusion ni push. Relance les vérifications, puis rends le même format de rapport.${(r.ecarts || []).length ? `
Écarts déjà remontés aux essais précédents, gardés dans le suivi : ${JSON.stringify(r.ecarts)}. Ne les répète pas ; si ta correction en annule un, dis-le dans un écart.` : ''}${(r.decouvertes || []).length ? `
Découvertes des essais précédents : ${JSON.stringify(r.decouvertes)}. Rends dans ton rapport la liste à jour : celles qui tiennent toujours, sans celles que ta correction rend fausses, plus les nouvelles.` : ''}`
const pInteg = (t, r, isole, controle) => `Fusionne la tâche ${t.id} dans le checkout principal : \`git switch ${INTEG}\`, puis \`git merge --no-ff ${r.branche} -m "tâche ${t.id} : ${t.titre}"\`.
En cas de conflit : \`git merge --abort\`, puis rends ok=false, fusionne=false, conflit=true et les fichiers en cause.
Sinon, rends fusionne=true, puis lance sur ${INTEG} cette commande de contrôle, sans pipe (ajoute \`; echo "code=$?"\`) : ${controle}. Rends controle_ok selon son code de sortie, un extrait utile dans detail en cas d'échec, et ok=true seulement si la fusion et le contrôle ont réussi.${isole ? `
Supprime ensuite le worktree : \`git worktree unlock "${r.chemin}"\` (ignore l'erreur), puis \`git worktree remove --force "${r.chemin}"\`. Garde la branche.` : ''}`
const pReplan = (t, r, statut, manques, nonVerif, sensibles = []) => `Replanification après ${t.id} (statut : ${statut}, phase ${PHASE}${DERNIERE ? ', dernière phase du plan' : ''}, mode ${MODE}). Tâche : ${t.fichier} ; son code est sur la branche ${r.branche}${statut === 'fusionnée' ? `, fusionnée dans ${INTEG} (checkout principal)` : `, dans ${r.chemin}`}. Écarts remontés : ${JSON.stringify(r.ecarts || [])}. Manques : ${JSON.stringify(manques)}. Critères non vérifiables dans le contexte de la tâche : ${JSON.stringify(nonVerif || [])}.${sensibles.length ? ` Écarts sensibles (données, base, prod, secret), majeurs d'office : rends un point pour chacun, sauf pour un écart qui ne porte que sur un fichier interdit aux agents (voir plus bas) : ${JSON.stringify(sensibles)}.` : ''}
Lis ${PLAN}/SUIVI.md, les décisions de ${PLAN}/HANDOFF.md, ${PLAN}/PREREQUIS.md s'il existe, et les tâches restantes de ${PLAN}/taches/. Classe chaque écart mineur ou majeur selon ta grille et rends une entrée par écart, sauf pour ceux que tu rends dans « relectures ».
Pour chaque écart majeur et chaque critère non vérifiable, rends un point dans « points » : titre, contexte, 2 ou 3 options dont une seule recommandée. Chaque option porte ses actions : entrées HANDOFF, tâches à ajouter (phase ${PHASE} ou plus, jamais une phase passée ; une tâche ajoutée cite dans « prerequis » les prérequis de PREREQUIS.md dont elle a besoin), amendements de tâches pas encore lancées, autres que ${t.id} (critères, fichiers possédés, commandes de vérification ou dépendances à ajouter, jamais rien à retirer). Pour une tâche déjà fusionnée, propose une tâche à ajouter plutôt qu'un amendement. Une option ne cite que des tâches et des fichiers qui existent déjà ou qu'elle crée elle-même. Aucune option ne fait lire, restaurer ou copier des données de production ou personnelles réelles par un agent : ce geste revient à l'humain. Recommande l'option la plus prudente pour la sécurité et les données : un test ou une garde de plus plutôt qu'un risque accepté.${MODE === 'auto' ? ` Mode autonome : l'option recommandée sera appliquée telle quelle, sans relecture humaine avant la PR.` : ''}${DERNIERE ? ` Dernière phase : ne propose une tâche que pour un point qui protège le déploiement, la sécurité ou les données ; pour les autres, une entrée de type « ticket » (à ouvrir après la PR), sans tâche.` : ''}
Un fichier que les agents n'ont pas le droit de lire ou d'écrire (réglages de l'organisation ou du projet), et qu'il suffit à l'humain de relire ou de modifier avant la PR, n'est jamais un point ni une entrée : rends-le dans « relectures », avec dans « relecture » le fichier et ce que l'humain doit y relire ou modifier, et dans « ecart » la description, recopiée telle quelle, de l'écart remonté qu'elle remplace, s'il ne porte que sur ce fichier et n'est pas de type besoin-humain. Un écart qui porte aussi sur autre chose reste un écart. S'il faut un geste humain avant de pouvoir continuer (un secret manquant pour lancer les tests, par exemple), c'est un besoin humain, pas une relecture. Marque « humain » un point qu'aucun agent ne peut trancher (accès, secret, production, données réelles, choix produit), un point qui porte sur un prérequis ouvert de PREREQUIS.md (décision reportée par l'utilisateur, geste humain), un écart de type besoin-humain, ou un problème d'environnement ou d'outillage dont la cause n'est pas démontrée par une sortie de commande citée ci-dessus. Ne modifie rien.`

// Consignes communes au scribe : tâches créées, amendements, contrôle par plan-lint, compte rendu
const pSuivi = (id, suivi) => `${suivi.taches.length ? `
- Nouvelles tâches : crée-les dans ${PLAN}/taches/ avec le contenu fourni, tel quel, et ajoute leur ligne à SUIVI.md, statut « ajoutée » : ${JSON.stringify(suivi.taches)}` : ''}${suivi.amendements.length ? `
- Amendements, pour des tâches pas encore lancées : dans le frontmatter de chaque tâche visée, ajoute les éléments listés à la fin de la liste correspondante (definition_du_fini, fichiers_possedes, verification, depend_de), sans rien retirer ni reformuler, puis note « amendement · majeur · <id> : <raison> » sous « ## ${id} » dans HANDOFF.md. N'amende pas une tâche absente du plan : rends-la dans « refuses ». Une tâche « fusionnée » ou « annulée » dans SUIVI.md ne s'amende plus : note « angle-mort · majeur · amendement non appliqué à <id> : <raison> » sous « ## ${id} » dans HANDOFF.md et rends-la dans « ecartes », pas dans « refuses ». Amendements : ${JSON.stringify(suivi.amendements)}` : ''}${suivi.ecartes.length ? `
- Amendements non appliqués, car la tâche visée est déjà lancée ou terminée : note chacun sous « ## ${id} » dans HANDOFF.md, en « angle-mort · majeur · amendement non appliqué à <id> : <raison> » : ${JSON.stringify(suivi.ecartes)}` : ''}${(suivi.office || []).length ? `
- Décisions prises d'office dans ce suivi : ${JSON.stringify(suivi.office)}. Pour chaque chemin de fichier qu'elles citent, vérifie qu'il existe dans le dépôt (\`test -e <chemin>\`) ou qu'une tâche créée ici le possède ; sinon, note « besoin-humain · majeur · décision d'office incohérente : <chemin> n'existe pas et aucune tâche ne le crée » sous « ## ${id} » dans HANDOFF.md et rends la décision dans « refuses ».` : ''}${suivi.taches.length || suivi.amendements.length ? `
- Puis lance \`${LINTCMD} ${PLAN} --integration ${INTEG}${BASE}\`. Toute erreur qui vise une tâche créée ou amendée ici : remets cette tâche dans son état d'origine (\`git checkout HEAD -- <fichier>\` pour un fichier amendé ; pour une tâche créée, retire son fichier et sa ligne de SUIVI.md).
- Chaque tâche créée ou amendée que tu n'as pas pu appliquer, ou que tu as remise dans son état d'origine : note « besoin-humain · majeur · <id> non appliquée : <raison> » sous « ## ${id} » dans HANDOFF.md, et rends-la dans « refuses ».` : ''}
Rends ok=true une fois le commit fait, avec son hash, « refuses » (vide si tout est appliqué) et « ecartes » (vide si aucun amendement ne visait une tâche fusionnée ou annulée).`
const pScribe = (t, statut, essais, r, suivi, manques, { instables = [], refus = [], nonVerif = [] } = {}) => `Dans le checkout principal, commence par \`git switch ${INTEG}\`. Mets à jour le suivi du plan ${PLAN}, puis commite ces seuls fichiers, et les tâches créées ou amendées, avec le message « suivi(${t.id}) : ${statut} ».
- SUIVI.md : ligne ${t.id} → statut « ${statut} », essais ${essais}, branche ${r ? r.branche : '—'} ; tokens réels : « voir /workflows ».
- HANDOFF.md : sous « ## ${t.id} », ajoute ces entrées : ${JSON.stringify(suivi.entrees)}${manques.length ? `, et ce blocage : ${JSON.stringify(manques)}` : ''}.${(refus || []).length ? `
- HANDOFF.md, toujours sous « ## ${t.id} » : une entrée « refus · mineur · essai <n>, <par> : <manques séparés par « ; »> » pour chacun de ces essais refusés puis corrigés : ${JSON.stringify(refus)}` : ''}${nonVerif.length ? `
- HANDOFF.md, toujours sous « ## ${t.id} » : une entrée « angle-mort · mineur · critère non vérifiable dans le contexte de la tâche : <critère et raison> » pour chacun de ceux-ci : ${JSON.stringify(nonVerif)}` : ''}
- DISCOVERY.md : intègre ces découvertes sans doublon, dans la bonne section : ${JSON.stringify((r && r.decouvertes) || [])}.${(instables || []).length ? `
- Tests instables (passés à la relance) : ajoute-les dans DISCOVERY.md, section Pièges, et une entrée « dette · mineur » dans HANDOFF.md : ${JSON.stringify(instables)}` : ''}${pSuivi(t.id, suivi)}`
const pArb = (a, suivi) => `Dans le checkout principal, commence par \`git switch ${INTEG}\`. Applique l'arbitrage de l'utilisateur au plan ${PLAN}, puis commite ces seuls fichiers, et les tâches créées ou amendées, avec le message « suivi(${a.tache}) : arbitrage ${a.option.id} ».
- HANDOFF.md : sous « ## ${a.tache} » (crée ce titre s'il manque), ajoute ces entrées : ${JSON.stringify(suivi.entrees)}.${pSuivi(a.tache, suivi)}`

// État du run
let arret = null
const points = [], ajoutees = [], resultats = [], office = [], reportees = [], ecartesRun = [], appliques = []
// Tâches amendées dont le suivi n'est pas encore commité (compteur par tâche) : elles ne démarrent qu'ensuite
const amendees = new Map()
// Le premier point arrête le run ; les suivants vont dans points_a_trancher
const arreter = p => { if (!arret) arret = p; else points.push(p) }
// Une tâche ajoutée ne tourne jamais dans une phase déjà passée
const versPhase = x => { const p = Math.max(Number(x.phase) || PHASE, PHASE); return { ...x, phase: p, contenu: String(x.contenu || '').replace(/^phase:\s*\d+/m, `phase: ${p}`) } }
// Les options gardent leurs actions : l'option choisie revient telle quelle dans args.arbitrages
const pointDe = (t, pt) => ({ tache: t.id, titre: pt.titre, contexte: pt.contexte || '', humain: !!pt.humain, options: pt.options || [] })
const pointHumain = (id, titre, contexte, options = []) => ({ tache: id, titre, contexte, humain: true, options })
const decisionsRun = () => [...DECISIONS, ...ARB.map(a => `${a.titre} : ${a.option.description} (arbitré par l'utilisateur)`), ...office.map(o => `${o.titre} : ${o.description} (prise d'office)`)]

phase('Lecture du plan')
// Arbitrages de l'utilisateur : le scribe écrit la décision et applique les actions de l'option choisie
for (const a of ARB) {
  const o = a.option
  const suivi = { entrees: [{ type: 'décision', gravite: 'majeur', description: `${a.titre} : option ${o.id} arbitrée par l'utilisateur — ${o.description}` }, ...(o.entrees || [])], taches: (o.taches_ajoutees || []).map(versPhase), amendements: o.amendements || [], ecartes: [], office: [] }
  const s = await agent(pArb(a, suivi), { label: `arbitrage ${a.tache} · suivi`, agentType: AG('scribe'), model: 'sonnet', schema: SCRIBE_S })
  if (s && s.ok) appliques.push({ tache: a.tache, titre: a.titre, option: o.id })
  // Amendement d'une tâche fusionnée entre-temps : écarté et consigné, le run continue
  if (s) ecartesRun.push(...(s.ecartes || []).map(e => ({ tache: a.tache, ...e })))
  if (!s || !s.ok || (s.refuses || []).length) return { statut: 'arbitrage', phase: PHASE, mode: MODE, arbitrage: pointHumain(a.tache, `Arbitrage « ${a.titre} » ${s && s.ok ? 'appliqué en partie' : 'non appliqué'}`, s ? JSON.stringify(s.refuses || []) : 'scribe sans réponse'), arbitrages_appliques: appliques, amendements_ecartes: ecartesRun, taches: [], points_a_trancher: [], decisions_office: [] }
}
const plan = await agent(`Exécute \`${LINTCMD} ${PLAN} --json --phase ${PHASE} --integration ${INTEG}${BASE}\` et rends son JSON tel quel.`, { label: 'lecteur-plan', agentType: AG('lecteur-plan'), model: 'haiku', schema: PLAN_S })
if (!plan || !plan.ok) return { statut: 'erreur', phase: PHASE, detail: plan ? plan.erreurs : 'lecteur-plan sans réponse', arbitrages_appliques: appliques }
const T = new Map(plan.taches.map(t => [t.id, t]))
const faites = new Set(plan.taches.filter(t => FAIT(t.statut)).map(t => t.id))
const deps = t => (t.depend_de || []).filter(d => T.has(d))
const ancetres = (id, vu = new Set()) => { for (const d of deps(T.get(id))) if (!vu.has(d)) { vu.add(d); ancetres(d, vu) } return vu }
const partage = (a, b) => (a.ressources || []).some(r => (b.ressources || []).includes(r))
const chevauchable = (a, b) => a.id !== b.id && !ancetres(a.id).has(b.id) && !ancetres(b.id).has(a.id) && !partage(a, b)
// Toutes les tâches du plan (cohérence des décisions d'office) et dernière phase (convergence)
const TOUS = plan.tous && plan.tous.length ? plan.tous : plan.taches
const PREFIXES = [...new Set(TOUS.map(x => (String(x.id).match(/^[A-Z]+/) || [''])[0]).filter(Boolean))]
const RE_ID = new RegExp(`\\b(?:${PREFIXES.join('|') || 'T'})\\d+[A-Z]*\\b`, 'g')
// Tâche d'une autre phase déjà fusionnée ou annulée : elle ne s'amende plus
const faiteAilleurs = id => !T.has(id) && FAIT((TOUS.find(x => x.id === id) || {}).statut)
// Sans phase_max (plan-lint ancien), pas de consigne de convergence
const DERNIERE = plan.phase_max ? PHASE >= Number(plan.phase_max) : false

// Exécution d'une tâche
// Mode autonome : applique l'option recommandée d'un point (décision, entrées, tâches, amendements)
function appliquer(t, pt, suivi) {
  const recos = (pt.options || []).filter(o => o.recommande)
  // Aucune ou plusieurs options recommandées : un humain tranche
  if (recos.length !== 1) return arreter(pointDe(t, pt))
  const reco = recos[0]
  // Cohérence : toute tâche citée existe dans le plan, ou l'option (ou le run) la crée
  const connues = new Set([...TOUS.map(x => x.id), ...ajoutees.map(x => x.id), ...suivi.taches.map(x => x.id), ...(reco.taches_ajoutees || []).map(x => x.id)])
  const texte = [reco.description, ...(reco.entrees || []).map(e => e.description), ...(reco.amendements || []).map(a => a.raison)].join(' ')
  const inconnues = [...new Set([...(texte.match(RE_ID) || []), ...(reco.amendements || []).flatMap(a => [a.id, ...(a.depend_de || [])])])].filter(id => !connues.has(id))
  if (inconnues.length) return arreter({ ...pointDe(t, pt), incoherence: `tâches citées qui n'existent pas et que l'option ne crée pas : ${inconnues.join(', ')}` })
  if (office.length >= MAXOFFICE) return arreter({ ...pointDe(t, pt), coupe_circuit: true })
  office.push({ tache: t.id, titre: pt.titre, option: reco.id, description: reco.description })
  suivi.office.push(`${pt.titre} : ${reco.description}`)
  suivi.entrees.push({ type: 'décision', gravite: 'majeur', description: `${pt.titre} : option ${reco.id} prise d'office (mode autonome) — ${reco.description}` }, ...(reco.entrees || []))
  suivi.taches.push(...(reco.taches_ajoutees || []).map(versPhase))
  const nouvelles = new Set([...ajoutees, ...suivi.taches].map(x => x.id))
  for (const am of reco.amendements || []) {
    if (faites.has(am.id) || faiteAilleurs(am.id) || enCours.has(am.id)) { suivi.ecartes.push(am); ecartesRun.push({ tache: t.id, ...am }); continue }
    suivi.amendements.push(am)
    const c = T.get(am.id)
    if (!c) continue
    amendees.set(am.id, (amendees.get(am.id) || 0) + 1)
    c.verification = [...(c.verification || []), ...(am.verification || [])]
    c.depend_de = [...(c.depend_de || []), ...(am.depend_de || [])]
    // Nouvelle dépendance vers une tâche ajoutée pendant ce run : la tâche attend le prochain run
    if ((am.depend_de || []).some(d => nouvelles.has(d)) && restantes.delete(am.id)) reportees.push(am.id)
  }
}

async function clore(t, statut, essais, r, manques = [], trace = {}) {
  const instables = [...new Set(trace.instables || [])], refus = trace.refus || [], nonVerif = trace.nonVerif || []
  const suivi = { entrees: [...(trace.entrees || [])], taches: [], amendements: [], ecartes: [], office: [] }
  // Fichiers et commandes que les agents n'ont pas le droit de lire, d'écrire ou de lancer : relecture par l'humain avant la PR, sans point ni arrêt
  const relectures = [...((r && r.ecarts) || []).filter(e => e.type === 'relecture').map(e => e.description), ...(trace.interdites || []).map(c => `commande \`${c}\` refusée aux agents : à lancer par l'humain avant la PR`)]
  const ecarts = ((r && r.ecarts) || []).filter(e => e.type !== 'relecture')
  let reclasses = new Set()
  // Écarts sensibles (données, base, prod, secret) : majeurs d'office, quel que soit le classement
  const sensibles = ecarts.filter(e => e.type !== 'besoin-humain' && SENSIBLE.test(e.description || '')).map(e => e.description)
  const majeurSiSensible = e => (SENSIBLE.test(e.description || '') ? { ...e, gravite: 'majeur' } : e)
  let humainVu = false
  if (r && (ecarts.length || statut !== 'fusionnée' || nonVerif.length)) {
    const rp = await agent(pReplan(t, { ...r, ecarts }, statut, manques, nonVerif, sensibles), { label: `${t.id} · replanification`, agentType: AG('replanificateur'), model: 'opus', schema: REPLAN_S })
    if (rp) {
      // Interdiction remontée comme un écart ordinaire : le replanificateur la reclasse en relecture, qui n'est ni un point ni un écart sensible
      reclasses = new Set((rp.relectures || []).map(x => x.ecart).filter(Boolean))
      relectures.push(...(rp.relectures || []).map(x => x.relecture), ...(rp.entrees || []).filter(e => e.type === 'relecture').map(e => e.description))
      suivi.entrees.push(...(rp.entrees || []).filter(e => e.type !== 'relecture').map(majeurSiSensible))
      suivi.taches.push(...(rp.taches_ajoutees || []).map(versPhase))
      // Un point par écart majeur ou critère non vérifiable : humain → arrêt ; sinon selon le mode
      for (const pt of rp.points || []) {
        if (pt.humain) { humainVu = true; arreter(pointDe(t, pt)) }
        else if (MODE === 'auto') appliquer(t, pt, suivi)
        else if (MODE === 'devia') arreter(pointDe(t, pt))
        else points.push(pointDe(t, pt))
      }
      // Un écart sensible sans aucun point de décision : un humain tranche
      // Reclassement refusé pour un écart que d'autres mots que la mention d'un .env rendent sensible : un humain tranche, quels que soient les autres points
      const contestes = sensibles.filter(d => reclasses.has(d) && SENSIBLE_HORS_ENV.test(d))
      if (contestes.length) { humainVu = true; arreter(pointHumain(t.id, `Écart sensible de ${t.id} reclassé en relecture`, contestes.join(' ; '))) }
      const restants = sensibles.filter(d => !reclasses.has(d))
      if (restants.length && !(rp.points || []).length) { humainVu = true; arreter(pointHumain(t.id, `Écart sensible de ${t.id} sans point de décision`, restants.join(' ; '))) }
    } else {
      // Sans classement, rien ne passe en silence : écarts notés majeurs, arrêt pour un humain
      suivi.entrees.push(...ecarts.map(e => ({ type: e.type, gravite: 'majeur', description: `${e.description} (non classé : replanificateur sans réponse)` })))
      humainVu = true
      arreter(pointHumain(t.id, `Replanification de ${t.id} sans réponse`, 'Écarts, manques et critères non vérifiables non classés : les relire dans HANDOFF.md.'))
    }
  }
  // Fichier illisible pour l'évaluateur : une entrée générique, sauf s'il est déjà cité par une relecture
  relectures.push(...(trace.illisibles || []).filter(f => !relectures.some(d => cite(d, f))).map(f => `${f} : illisible par les agents, à relire par l'humain avant la PR`))
  const rels = [...new Set(relectures)]
  suivi.entrees.push(...rels.map(d => ({ type: 'relecture', gravite: 'majeur', description: d })))
  const besoins = ecarts.filter(e => e.type === 'besoin-humain')
  if (besoins.length && !humainVu) arreter(pointHumain(t.id, `Besoin humain signalé par ${t.id}`, besoins.map(e => e.description).join(' ; ')))
  // Tâche non fusionnée qui attend un humain : elle ne repart que sur sa décision (args.relancer)
  const final = statut !== 'fusionnée' && (humainVu || besoins.length) ? 'besoin-humain' : statut
  ajoutees.push(...suivi.taches)
  const s = await exclusif(() => agent(pScribe(t, final, essais, r, suivi, manques, { instables, refus, nonVerif }), { label: `${t.id} · suivi`, agentType: AG('scribe'), model: 'sonnet', schema: SCRIBE_S }))
  for (const am of suivi.amendements) { const n = (amendees.get(am.id) || 1) - 1; if (n > 0) amendees.set(am.id, n); else amendees.delete(am.id) }
  if (s) ecartesRun.push(...(s.ecartes || []).map(e => ({ tache: t.id, ...e })))
  if (!s || !s.ok) arreter(pointHumain(t.id, `Suivi de ${t.id} non commité`, s ? 'Le scribe n’a pas pu commiter.' : 'Scribe sans réponse.'))
  else if ((s.refuses || []).length) arreter(pointHumain(t.id, `Suivi de ${t.id} : tâches, amendements ou décisions refusés`, JSON.stringify(s.refuses)))
  log(`${t.id} : ${final}`)
  return { id: t.id, statut: final, essais, branche: r ? r.branche : null, resume: r ? r.resume : '', ...(final !== 'fusionnée' ? { blocage: manques } : {}), ...(instables.length ? { instables } : {}), ...(refus.length ? { refus } : {}), ...(nonVerif.length ? { non_verifiables: nonVerif } : {}), ...(rels.length ? { relectures: rels } : {}) }
}

async function executer(t, isole) {
  try {
    log(`${t.id} démarre (${isole ? 'worktree' : 'checkout principal'})`)
    let r = await agent(pWorker(t, isole), { label: `${t.id} · worker`, agentType: AG(isole ? 'worker-isole' : 'worker'), model: t.modele || 'sonnet', schema: RAPPORT_S, ...(isole ? { isolation: 'worktree' } : {}), ...effort(t) })
    let essais = 1
    const trace = { instables: [], refus: [], nonVerif: [], illisibles: [], interdites: [] }
    for (;;) {
      if (!r) return await clore(t, 'échec', essais, null, ['worker sans réponse (limite d’usage ou erreur API)'], trace)
      if (r.statut === 'blocked') return await clore(t, 'bloquée', essais, r, [r.blocage || 'bloquée par le worker'], trace)
      let manques = [], par = 'vérification'
      const v = await agent(pVerif(t, r), { label: `${t.id} · vérification`, agentType: AG('verificateur'), model: 'sonnet', schema: VERIF_S })
      if (v && (v.instables || []).length) trace.instables.push(...v.instables)
      // Commandes refusées par les permissions : seules celles de la tâche comptent comme interdites ; une autre est un échec
      const refusees = (v && v.interdites) || []
      const inconnues = refusees.filter(x => !(t.verification || []).some(c => memeCommande(c, x, r.chemin)))
      trace.interdites = [...new Set([...trace.interdites, ...(t.verification || []).filter(c => refusees.some(x => memeCommande(c, x, r.chemin)))])]
      if (!v) manques = ['vérificateur sans réponse']
      else if (!v.ok || inconnues.length) manques = [...(v.echecs || []).map(e => `${e.commande} : ${e.extrait || 'échec'}`), ...inconnues.map(x => `${x} : refusée selon le vérificateur, mais ce n'est pas une commande de vérification de la tâche`)]
      // Aucune commande permise : rien ne prouve la tâche, et une correction n'y changerait rien
      else if ((t.verification || []).length && (t.verification || []).every(c => trace.interdites.includes(c))) return await clore(t, 'bloquée', essais, r, [`aucune commande de vérification permise aux agents : ${trace.interdites.join(' ; ')}`], trace)
      else {
        par = 'évaluation'
        const e = await agent(pEval(t, r, { ...v, interdites: trace.interdites }), { label: `${t.id} · évaluation`, agentType: AG('evaluateur'), model: 'opus', schema: EVAL_S })
        // Un fichier illisible une fois le reste : on cumule d'une évaluation à l'autre
        if (e) { trace.nonVerif = e.non_verifiables || []; trace.illisibles = [...new Set([...trace.illisibles, ...(e.illisibles || [])])] }
        if (!e) manques = ['évaluateur sans réponse']
        else if (e.verdict === 'ko') manques = e.manques && e.manques.length ? e.manques : ['verdict ko sans détail']
      }
      if (!manques.length) break
      if (essais > MAXFIX) return await clore(t, 'bloquée', essais, r, manques, trace)
      trace.refus.push({ essai: essais, par, manques })
      const modele = auMoins(ESC[Math.min(essais - 1, ESC.length - 1)], t.modele)
      log(`${t.id} : correction ${essais} sur ${modele}`)
      const c = await agent(pCorr(t, r, manques), { label: `${t.id} · correction ${essais}`, agentType: AG('worker'), model: modele, schema: RAPPORT_S, ...effort(t) })
      essais++
      // Correction sans réponse : on garde le rapport des essais précédents (écarts, relectures, branche)
      if (!c) return await clore(t, 'échec', essais, r, ['correction sans réponse (limite d’usage ou erreur API)'], trace)
      r = cumuler(r, c)
    }
    // Contrôle post-fusion : la première commande de vérification que les agents ont le droit de lancer
    const controle = (t.verification || []).find(c => !trace.interdites.includes(c)) || 'aucune'
    const i = await exclusif(() => agent(pInteg(t, r, isole, controle), { label: `${t.id} · fusion`, agentType: AG('integrateur'), model: 'sonnet', schema: INTEG_S }))
    if (!i) return await clore(t, 'bloquée', essais, r, ['intégrateur sans réponse'], trace)
    if (!(i.fusionne ?? i.ok)) return await clore(t, 'bloquée', essais, r, [`fusion : ${i.detail || 'échec'}`], trace)
    if (!(i.controle_ok ?? i.ok)) {
      // Fusion faite mais contrôle en échec : la tâche reste fusionnée et le run s'arrête pour un humain
      const detail = `contrôle post-fusion en échec sur ${INTEG} (${controle}) : ${i.detail || 'échec'}`
      trace.entrees = [{ type: 'besoin-humain', gravite: 'majeur', description: detail }]
      arreter({ tache: t.id, titre: `Contrôle post-fusion en échec après ${t.id}`, contexte: detail, humain: true, options: [{ id: 'reparer', description: `Réparer sur ${INTEG}, rejouer les vérifications, puis relancer la phase`, impact: '', recommande: true }, { id: 'arreter', description: 'Arrêter le plan ici', impact: '', recommande: false }] })
    }
    return await clore(t, 'fusionnée', essais, r, [], trace)
  } catch (err) {
    return { id: t.id, statut: 'échec', essais: 0, branche: null, resume: String(err), blocage: [`erreur du workflow : ${String(err)}`] }
  }
}

// Ordonnancement : dépendances, ressources, parallélisme
phase('Tâches')
// Une tâche dont un prérequis de PREREQUIS.md est ouvert attend, même relancée : le prérequis se règle d'abord dans le plan
const attentePrerequis = plan.taches.filter(t => !FAIT(t.statut) && (t.prerequis_ouverts || []).length).map(t => ({ id: t.id, prerequis: t.prerequis_ouverts }))
const attendPrerequis = id => attentePrerequis.some(a => a.id === id)
// Une tâche « besoin-humain » ne repart que si l'utilisateur la relance (args.relancer)
const enAttente = plan.taches.filter(t => t.statut === 'besoin-humain' && !RELANCER.has(t.id) && !attendPrerequis(t.id)).map(t => t.id)
const restantes = new Map(plan.taches.filter(t => !FAIT(t.statut) && !enAttente.includes(t.id) && !attendPrerequis(t.id)).map(t => [t.id, t]))
const enCours = new Map()
const verrous = new Set()
const pret = t => deps(t).every(d => faites.has(d)) && !amendees.has(t.id) && !(t.ressources || []).some(r => verrous.has(r)) && !verrous.has('checkout')
while (restantes.size || enCours.size) {
  if (!arret) {
    for (const t of [...restantes.values()]) {
      if (enCours.size >= PAR) break
      if (!pret(t)) continue
      const autres = [...restantes.values(), ...[...enCours.keys()].map(id => T.get(id))].filter(o => o.id !== t.id)
      // Worktree seulement si une autre tâche peut tourner en même temps : jamais avec un parallélisme de 1
      const isole = PAR > 1 && (enCours.size > 0 || autres.some(o => chevauchable(o, t)))
      const pris = [...(t.ressources || []), ...(isole ? [] : ['checkout'])]
      pris.forEach(x => verrous.add(x))
      restantes.delete(t.id)
      enCours.set(t.id, executer(t, isole).then(res => {
        resultats.push(res)
        if (res.statut === 'fusionnée') faites.add(t.id)
        pris.forEach(x => verrous.delete(x))
        enCours.delete(t.id)
      }))
    }
  }
  if (!enCours.size) break
  await Promise.race(enCours.values())
}

phase('Clôture')
const ko = resultats.filter(r => r.statut !== 'fusionnée')
const bilan = {
  phase: PHASE, mode: MODE, taches: resultats, non_lancees: [...restantes.keys()], reportees,
  taches_ajoutees: ajoutees.map(x => ({ id: x.id, phase: x.phase, titre: x.titre })),
  relectures: resultats.flatMap(x => (x.relectures || []).map(d => ({ tache: x.id, relecture: d }))),
  decisions_office: office, amendements_ecartes: ecartesRun, points_a_trancher: points, arbitrages_appliques: appliques, en_attente: enAttente, en_attente_prerequis: attentePrerequis,
}
if (arret) return { statut: 'arbitrage', arbitrage: arret, ...bilan }
if (ko.length || restantes.size || enAttente.length || attentePrerequis.length) return { statut: 'partiel', ...bilan }
// Tâches initiales toutes fusionnées, mais des tâches ajoutées à cette phase ou reportées : relancer la phase
return { statut: reportees.length || ajoutees.some(x => x.phase === PHASE) ? 'à-relancer' : 'terminé', ...bilan }
