// @ts-check
// Modèle du mod de suivi d'orchestre : lit plans/<nom>/suivi.json (contrat orchestre-suivi/1, écrit par
// scripts/suivi.mjs du plugin orchestre) et en tire ce que le mod affiche. Fonctions pures, sans `$` :
// register.tsx s'occupe du moteur (fichiers, minuteur, dessin), tests/modele.test.mjs les vérifie sous Node.

/** @typedef {import('../types/index.d.ts').Instantane} Instantane */
/** @typedef {import('../types/index.d.ts').TacheVue} TacheVue */
/** @typedef {import('../types/index.d.ts').PhaseVue} PhaseVue */
/** @typedef {import('../types/index.d.ts').RunVue} RunVue */
/** @typedef {import('../types/index.d.ts').Morceau} Morceau */
/** @typedef {import('../types/index.d.ts').Ligne} Ligne */

export const FORMAT = 'orchestre-suivi/1'
export const STATUTS = ['à-faire', 'ajoutée', 'fusionnée', 'bloquée', 'échec', 'besoin-humain', 'annulée']
const ATTENTION = { 'besoin-humain': 'attend un humain', bloquée: 'bloquée', échec: 'en échec' }
const JOURNAL_VU = 40
// Un run noté « en-cours » sans écriture depuis 45 min est montré « sans nouvelles » : interrompu (Échap, session tuée),
// il reste « en-cours » jusqu'au debut-run suivant. Une étape seule (un worker) peut durer ; au-delà, mieux vaut le dire.
export const SILENCE_MS = 45 * 60000
// Durée d'une notification qui demande quelqu'un (4 s par défaut pour les autres)
export const DUREE_IMPORTANTE_MS = 15000

/** @param {unknown} x @returns {x is Record<string, any>} */
const estObjet = x => typeof x === 'object' && x !== null && !Array.isArray(x)
/** @param {unknown} x */
const texte = x => (typeof x === 'string' ? x : x == null ? '' : String(x))
/** @param {unknown} x @returns {string[]} */
const textes = x => (Array.isArray(x) ? x.map(texte) : [])
/** @param {unknown} x @returns {number | null} */
const date = x => { if (typeof x !== 'string') return null; const t = Date.parse(x); return Number.isNaN(t) ? null : t }
/** @param {unknown} x @param {number} d */
const entier = (x, d) => (Number.isInteger(x) ? /** @type {number} */ (x) : d)

/** Format déclaré par un suivi.json, ou null. @param {unknown} brut */
export const formatDe = brut => (estObjet(brut) && typeof brut.format === 'string' ? brut.format : null)

/**
 * suivi.json (orchestre-suivi/1) → ce que le mod affiche ; null si le format n'est pas celui-là.
 * Les champs inconnus sont ignorés, les champs manquants pris vides : un lecteur ne refuse que le format.
 * @param {unknown} brut @returns {Instantane | null}
 */
export function normaliser(brut) {
  if (!estObjet(brut) || brut.format !== FORMAT || !Array.isArray(brut.taches)) return null
  const runs = (Array.isArray(brut.runs) ? brut.runs : []).filter(estObjet)
  const dernier = runs.length ? runs[runs.length - 1] : null
  /** @type {TacheVue[]} */
  const taches = brut.taches.filter(estObjet).map(t => ({
    id: texte(t.id), titre: texte(t.titre) || texte(t.id), phase: entier(t.phase, 1),
    statut: STATUTS.includes(t.statut) ? t.statut : 'à-faire', essais: entier(t.essais, 0),
    etape: typeof t.etape === 'string' ? t.etape : null, isole: t.isole === true,
    debut: date(t.debut), fin: date(t.fin), attend: textes(t.attend), blocage: textes(t.blocage),
  }))
  const majeures = /** @type {Record<string, number>} */ ({})
  let tickets = 0
  if (estObjet(brut.handoff)) for (const section of Object.values(brut.handoff)) if (estObjet(section)) for (const [type, c] of Object.entries(section)) {
    if (!estObjet(c)) continue
    if (type === 'ticket') tickets += entier(c.mineur, 0) + entier(c.majeur, 0)
    const n = entier(c.majeur, 0)
    if (n > 0) majeures[type] = (majeures[type] || 0) + n
  }
  return {
    demo: false, plan: texte(brut.plan), dossier: texte(brut.dossier), maj: date(brut.maj),
    taches,
    runs: runs.map(runVue),
    run: dernier ? runVue(dernier) : null,
    relectures: (Array.isArray(brut.relectures) ? brut.relectures : []).filter(estObjet).map(r => ({ tache: r.tache == null ? null : texte(r.tache), phase: Number.isInteger(r.phase) ? r.phase : null, texte: texte(r.texte), quand: date(r.quand) })),
    decisions: (Array.isArray(brut.decisions_office) ? brut.decisions_office : []).filter(estObjet).map(d => ({ tache: texte(d.tache), titre: texte(d.titre), option: texte(d.option), description: texte(d.description) })),
    points: (Array.isArray(brut.points) ? brut.points : []).filter(p => estObjet(p) && p.statut !== 'tranché').map(p => ({ tache: texte(p.tache), titre: texte(p.titre), humain: p.humain === true, role: texte(p.role) })),
    prerequis: (Array.isArray(brut.prerequis) ? brut.prerequis : []).filter(p => estObjet(p) && p.statut === 'ouvert').map(p => ({ id: texte(p.id), type: texte(p.type), bloque: textes(p.bloque) })),
    majeures, tickets,
    lint: { ok: !estObjet(brut.lint) || brut.lint.ok !== false, erreurs: estObjet(brut.lint) ? textes(brut.lint.erreurs).length : 0 },
    journal: (Array.isArray(brut.journal) ? brut.journal : []).filter(estObjet).slice(-JOURNAL_VU).map(j => ({ quand: date(j.quand), genre: texte(j.genre), tache: j.tache == null ? null : texte(j.tache), texte: texte(j.texte) })),
  }
}

/** @param {Record<string, unknown>} r @returns {RunVue} */
const runVue = r => ({
  numero: entier(r.numero, 0), phase: entier(r.phase, 0), mode: texte(r.mode), statut: texte(r.statut), debut: date(r.debut), fin: date(r.fin), detail: r.detail == null ? null : texte(r.detail),
  arbitres: (Array.isArray(r.arbitrages_appliques) ? r.arbitrages_appliques : []).filter(estObjet).map(a => texte(a.tache)).filter(Boolean),
})

const fait = /** @param {TacheVue} t */ t => t.statut === 'fusionnée'
/** Le run noté en cours, s'il y en a un. @param {Instantane} inst */
export const runEnCours = inst => (inst.run && inst.run.statut === 'en-cours' ? inst.run : null)
/** Un run en cours sans écriture de suivi.json depuis SILENCE_MS. @param {Instantane} inst @param {number} maintenant */
export const silencieux = (inst, maintenant) => !!runEnCours(inst) && inst.maj != null && maintenant - inst.maj >= SILENCE_MS
/** Le run en cours qui donne des nouvelles. @param {Instantane} inst @param {number} maintenant */
export const runActif = (inst, maintenant) => (silencieux(inst, maintenant) ? null : runEnCours(inst))
/** Une tâche en cours : une étape notée pendant un run actif. @param {Instantane} inst @param {number} maintenant */
export const enCours = (inst, maintenant) => (runActif(inst, maintenant) ? inst.taches.filter(t => t.etape && !fait(t)) : [])
/** Le point de la tâche vient d'être tranché par le run en cours, qui va la relancer. @param {Instantane} inst @param {TacheVue} t */
const arbitree = (inst, t) => { const r = runEnCours(inst); return !!r && r.arbitres.includes(t.id) }
/**
 * Ce qui attend quelqu'un : une tâche qui a besoin d'un humain, bloquée ou en échec, sauf si le run en cours l'a reprise
 * (une étape notée pendant un run actif) ou vient d'en trancher le point. @param {Instantane} inst @param {number} maintenant
 */
export const attendQuelquun = (inst, maintenant) => { const actif = !!runActif(inst, maintenant); return /** @param {TacheVue} t */ t => t.statut in ATTENTION && !(actif && t.etape) && !arbitree(inst, t) }
/**
 * La phase où en est le dernier run : la plus haute des tâches qu'il a démarrées ou closes, au moins celle de son départ.
 * Un run en mode auto passe d'une phase à l'autre, et run.phase reste celle du départ. @param {Instantane} inst
 */
export function phaseDuRun(inst) {
  const r = inst.run
  if (!r) return null
  const d = r.debut
  const touchees = d == null ? [] : inst.taches.filter(t => t.statut !== 'annulée' && ((t.debut != null && t.debut >= d) || (t.fin != null && t.fin >= d)))
  return Math.max(r.phase, ...touchees.map(t => t.phase))
}

/**
 * Les chiffres du bandeau et des en-têtes. @param {Instantane} inst @param {number} maintenant ms
 */
export function resumer(inst, maintenant) {
  const actives = inst.taches.filter(t => t.statut !== 'annulée')
  const faites = actives.filter(fait).length
  const phases = phasesDe(inst, maintenant)
  const courante = phases.find(p => p.faites < p.total) ?? null
  const run = runActif(inst, maintenant)
  const attention = actives.filter(attendQuelquun(inst, maintenant))
  return {
    total: actives.length, faites, enCours: enCours(inst, maintenant), aFaire: actives.filter(t => !fait(t)).length, silence: silencieux(inst, maintenant),
    phases, courante, phaseMax: phases.at(-1)?.numero ?? 0,
    relectures: inst.relectures.length, attention, run,
    duree: inst.run && inst.run.debut != null ? (inst.run.fin ?? (runEnCours(inst) ? (run ? maintenant : inst.maj ?? inst.run.debut) : inst.run.debut)) - inst.run.debut : null,
    termine: actives.length > 0 && faites === actives.length,
  }
}

/** @param {Instantane} inst @param {number} maintenant @returns {PhaseVue[]} */
export function phasesDe(inst, maintenant) {
  // Une phase dont toutes les tâches sont annulées n'est plus une phase du plan, comme pour /orchestre:etat
  const nums = [...new Set(inst.taches.filter(t => t.statut !== 'annulée').map(t => t.phase))].sort((a, b) => a - b)
  const attend = attendQuelquun(inst, maintenant)
  return nums.map(numero => {
    const ts = inst.taches.filter(t => t.phase === numero && t.statut !== 'annulée')
    // Dans chaque run, du premier démarrage au dernier achèvement des tâches de la phase : un run en mode auto en parcourt
    // plusieurs, et l'attente entre deux runs ne compte pas
    let duree = /** @type {number | null} */ (null)
    for (const r of inst.runs) {
      if (r.debut == null) continue
      const d = r.debut, f = r.fin ?? (r.statut === 'en-cours' ? maintenant : d)
      const dans = /** @param {number | null} x */ x => x != null && x >= d && x <= f
      const vues = ts.filter(t => dans(t.debut) || dans(t.fin))
      if (!vues.length) continue
      const a = Math.min(...vues.map(t => (dans(t.debut) ? /** @type {number} */ (t.debut) : d)))
      const b = Math.max(...vues.map(t => (dans(t.fin) ? /** @type {number} */ (t.fin) : f)))
      duree = (duree ?? 0) + Math.max(0, b - a)
    }
    return {
      numero, total: ts.length, faites: ts.filter(fait).length,
      enCours: ts.filter(t => t.etape && !fait(t) && runActif(inst, maintenant)).length,
      attention: ts.filter(attend).length,
      essais: ts.reduce((s, t) => s + Math.max(t.essais, fait(t) ? 1 : 0), 0),
      relances: ts.filter(t => t.essais > 1).map(t => ({ id: t.id, essais: t.essais })),
      duree,
    }
  })
}

// ─── Mise en forme ───────────────────────────────────────────────────────────────────────────────────────────────

/** Durée lisible : « 45 s », « 18 min », « 1 h 12 ». @param {number | null} ms */
export function duree(ms) {
  if (ms == null || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
/** Âge court d'un événement : « 45 s », « 18 min », « 1 h 12 », « 3 j » (pas d'heure : le fuseau du mod n'est pas sûr). @param {number | null} ms @param {number} maintenant */
export function age(ms, maintenant) {
  if (ms == null) return '—'
  const s = Math.max(0, maintenant - ms)
  return s >= 86400000 ? `${Math.floor(s / 86400000)} j` : duree(s)
}
/** @param {number} faites @param {number} total @param {number} largeur */
export function barre(faites, total, largeur) {
  const k = total > 0 ? Math.floor((faites / total) * largeur) : 0
  return '█'.repeat(k) + '░'.repeat(Math.max(0, largeur - k))
}
/** Coupe à n caractères visibles, avec « … ». @param {string} s @param {number} n */
export function court(s, n) {
  const c = [...String(s).replace(/\s+/g, ' ').trim()]
  return c.length > n ? c.slice(0, Math.max(0, n - 1)).join('') + '…' : c.join('')
}
/** Complète à n caractères (après coupe). @param {string} s @param {number} n */
export const colonne = (s, n) => { const c = court(s, n); return c + ' '.repeat(Math.max(0, n - [...c].length)) }
/** @param {number} n @param {string} mot */
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`
/** « phase 2 », ou « phases 1 à 3 » pour un run qui en a parcouru plusieurs. @param {number} de @param {number} a */
const libellePhases = (de, a) => (a > de ? `phases ${de} à ${a}` : `phase ${de}`)

// ─── Couleurs et mouvement ───────────────────────────────────────────────────────────────────────────────────────
// Les images des animations se déduisent de l'heure : rien à garder d'un dessin à l'autre. register.tsx redessine
// toutes les IMAGE_MS pendant un run actif, et tant qu'un événement a moins de NOUVELLE_MS.
export const IMAGE_MS = 150
export const NOUVELLE_MS = 10000
const ROUE = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', TOUR = '◐◓◑◒'
/** @param {number} m */ export const roue = m => /** @type {string} */ (ROUE[Math.floor(m / 100) % ROUE.length])
/** @param {number} m */ export const tour = m => /** @type {string} */ (TOUR[Math.floor(m / IMAGE_MS) % TOUR.length])
/** @param {number} m */ const pouls = m => Math.floor(m / 450) % 2 === 1
// Une couleur par étape, du thème de la personne
const COULEUR_ETAPE = /** @type {Record<string, string>} */ ({ worker: 'suggestion', vérification: 'merged', évaluation: 'planMode', correction: 'warning', fusion: 'success', replanification: 'subtle', suivi: 'subtle' })
// Classes d'une tâche, dans l'ordre de la barre : fusionnée, en cours, attend un humain, bloquée ou en échec, le reste
const CLASSES = /** @type {const} */ ([
  { c: 'success', g: '█' }, { c: 'suggestion', g: '█' }, { c: 'warning', g: '█' }, { c: 'error', g: '█' }, { c: 'subtle', g: '░' },
])
/** @param {Instantane} inst @param {number} maintenant @returns {(t: TacheVue) => number} */
function classeur(inst, maintenant) {
  const actif = !!runActif(inst, maintenant), attend = attendQuelquun(inst, maintenant)
  return t => (fait(t) ? 0 : actif && t.etape ? 1 : attend(t) ? (t.statut === 'besoin-humain' ? 2 : 3) : 4)
}

/**
 * Barre empilée par classe de tâche : une ou plusieurs cases par tâche quand elles tiennent, sinon en proportion,
 * chaque classe présente gardant au moins une case. Les tâches en cours pulsent quand `anime`.
 * @param {TacheVue[]} ts @param {(t: TacheVue) => number} classe @param {number} cases @param {number} maintenant @param {boolean} anime @returns {Ligne}
 */
export function barreClasses(ts, classe, cases, maintenant, anime) {
  if (!ts.length || cases <= 0) return cases > 0 ? [{ t: '░'.repeat(cases), c: 'subtle' }] : []
  const n = [0, 0, 0, 0, 0]
  for (const t of ts) { const i = classe(t); n[i] = (n[i] ?? 0) + 1 }
  let k
  if (ts.length <= cases) {
    const par = Math.floor(cases / ts.length)
    k = n.map(x => x * par)
  } else {
    k = n.map(x => (x ? Math.max(1, Math.floor((x / ts.length) * cases)) : 0))
    // Ajuste à `cases` : on prend sur la plus grosse classe, ou on lui rend
    let ecart = cases - k.reduce((a, b) => a + b, 0)
    while (ecart !== 0) {
      const i = k.indexOf(Math.max(...k))
      if (ecart < 0 && /** @type {number} */ (k[i]) <= 1) break
      k[i] = /** @type {number} */ (k[i]) + Math.sign(ecart)
      ecart -= Math.sign(ecart)
    }
  }
  /** @type {Ligne} */
  const l = []
  k.forEach((x, i) => {
    if (!x) return
    const cl = /** @type {typeof CLASSES[number]} */ (CLASSES[i])
    l.push({ t: (i === 1 && anime && pouls(maintenant) ? '▓' : cl.g).repeat(x), c: cl.c })
  })
  return l
}

/** Une case par tâche (■), colorée par classe, dans l'ordre du plan. @param {TacheVue[]} ts @param {(t: TacheVue) => number} classe @returns {Ligne} */
function cases(ts, classe) {
  /** @type {Ligne} */
  const l = []
  for (const t of ts) {
    const c = /** @type {typeof CLASSES[number]} */ (CLASSES[classe(t)]).c
    const der = l[l.length - 1]
    if (der && der.c === c) der.t += '■'
    else l.push({ t: '■', c })
  }
  return l
}

/** Les phases en points : ● faite, ◉ celle du run, ○ ambre une qui attend, ○ à venir ; null au-delà de 10 phases. @param {PhaseVue[]} phases @param {number | null} courante @returns {Ligne | null} */
export function pointsPhases(phases, courante) {
  if (!phases.length || phases.length > 10) return null
  return phases.map(p => (p.total && p.faites === p.total ? { t: '●', c: 'success' } : p.numero === courante ? { t: '◉', c: 'claude', b: true } : p.attention ? { t: '○', c: 'warning', b: true } : { t: '○', c: 'subtle' }))
}

const GENRES = /** @type {Record<string, Morceau>} */ ({
  run: { t: '▶', c: 'claude' }, tache: { t: '▶', c: 'suggestion' }, etape: { t: '·', d: true }, refus: { t: '↻', c: 'merged' },
  statut: { t: '●', c: 'success' }, ajout: { t: '+', c: 'suggestion' }, amendement: { t: '~', c: 'merged' }, relecture: { t: '⚑', c: 'warning' },
  'decision-office': { t: '⇒', c: 'warning' }, point: { t: '?', c: 'warning' }, arbitrage: { t: '✓', c: 'success' }, pilote: { t: '✎', c: 'suggestion' }, erreur: { t: '✗', c: 'error' },
})
/** Glyphe et couleur d'une entrée du journal, d'après son genre et ce qu'elle dit. @param {{ genre: string, texte: string }} j @returns {Morceau} */
function marque(j) {
  if (j.genre === 'statut') return / fusionnée/.test(j.texte) ? { t: '✓', c: 'success' } : / besoin-humain/.test(j.texte) ? { t: '⚑', c: 'warning' } : / (bloquée|échec)/.test(j.texte) ? { t: '✗', c: 'error' } : { t: '●', c: 'subtle' }
  if (j.genre === 'run') return / : terminé/.test(j.texte) ? { t: '✓', c: 'success' } : / : (arbitrage|partiel|à-relancer)| interrompu/.test(j.texte) ? { t: '■', c: 'warning' } : { t: '▶', c: 'claude' }
  return GENRES[j.genre] || { t: '·', d: true }
}
// Ce qui fait une nouvelle au bout du bandeau, du plus important au moins important ; pas les étapes ni les démarrages,
// que le bandeau montre déjà. Une écriture de suivi.json en note souvent plusieurs, à la même seconde : la plus
// importante l'emporte, et la plus récente à importance égale.
const MARQUANTS = ['statut', 'run', 'erreur', 'arbitrage', 'point', 'refus', 'decision-office', 'relecture', 'pilote', 'ajout']
/** La nouvelle en peu de mots, d'après le texte que suivi.mjs écrit au journal. @param {{ genre: string, texte: string }} j */
function enBref(j) {
  const t = j.texte
  /** @type {RegExpMatchArray | null} */
  let m
  if (j.genre === 'run' && (m = t.match(/^run (\d+) : phase (\d+), mode (\S+?),/))) return `run ${m[1]} lancé (phase ${m[2]}, mode ${m[3]})`
  if (j.genre === 'statut' && (m = t.match(/^(\S+) : (fusionnée|besoin-humain|bloquée|échec) \((\d+) essai/))) {
    const [, id, st, n] = m
    return st === 'fusionnée' ? `${id} fusionnée${Number(n) > 1 ? ` au ${n}e essai` : ''}` : `${id} ${/** @type {Record<string, string>} */ (ATTENTION)[/** @type {string} */ (st)]}`
  }
  if (j.genre === 'refus' && (m = t.match(/^(\S+) : essai (\d+) refusé \(([^)]+)\)/))) return `${m[1]} : essai ${m[2]} refusé (${m[3]})`
  if (j.genre === 'relecture' && (m = t.match(/^(\S+) : relecture/))) return `${m[1]} : à relire avant la PR`
  if (j.genre === 'decision-office' && (m = t.match(/^(\S+) :/))) return `${m[1]} : décision prise d'office`
  if (j.genre === 'arbitrage' && (m = t.match(/^(\S+) : .* tranché, option (\S+)/))) return `${m[1]} : point tranché (option ${m[2]})`
  return t
}
/**
 * La dernière nouvelle de moins de NOUVELLE_MS : une tâche close, un run lancé ou fini, un arbitrage, un refus…
 * @param {Instantane} inst @param {number} maintenant @returns {{ marque: Morceau, texte: string, age: number, genre: string } | null}
 */
export function nouvelle(inst, maintenant) {
  const recentes = inst.journal.filter(j => j.quand != null && maintenant - j.quand <= NOUVELLE_MS && MARQUANTS.includes(j.genre))
  if (!recentes.length) return null
  const quand = Math.max(...recentes.map(j => /** @type {number} */ (j.quand)))
  const j = recentes.filter(x => x.quand === quand).reverse().sort((x, y) => MARQUANTS.indexOf(x.genre) - MARQUANTS.indexOf(y.genre))[0]
  if (!j) return null
  return { marque: marque(j), texte: enBref(j), age: Math.max(0, maintenant - quand), genre: j.genre }
}

/** Glyphe et couleur d'une tâche ; une tâche en cours tourne quand `anime`. @param {TacheVue} t @param {boolean} active @param {number} [maintenant] @param {boolean} [anime] @returns {Morceau} */
export function glyphe(t, active, maintenant = 0, anime = false) {
  if (t.statut === 'fusionnée') return { t: '●', c: 'success' }
  if (t.statut === 'annulée') return { t: '–', d: true }
  if (active && t.etape) return { t: anime ? tour(maintenant) : '◐', c: 'suggestion', b: true }
  if (t.statut === 'besoin-humain') return { t: '⚑', c: 'warning', b: true }
  if (t.statut === 'bloquée' || t.statut === 'échec') return { t: '✗', c: 'error', b: true }
  return { t: '○', c: 'subtle' }
}
const ETAPES = /** @type {Record<string, string>} */ ({ worker: 'réalisation', vérification: 'vérification', évaluation: 'évaluation', correction: 'correction', fusion: 'fusion', replanification: 'replanification', suivi: 'suivi' })

/** Ce que fait une tâche, en quelques mots. @param {TacheVue} t @param {boolean} active @param {boolean} [tranchee] */
export function quoi(t, active, tranchee = false) {
  if (active && t.etape) return (ETAPES[t.etape] || t.etape) + (t.essais > 1 ? `, essai ${t.essais}` : '') + (t.isole ? ' (worktree)' : '')
  if (t.statut in ATTENTION && tranchee) return 'point tranché, reprise à venir'
  if (t.statut in ATTENTION) return /** @type {Record<string, string>} */ (ATTENTION)[t.statut] + (t.blocage[0] ? ` : ${t.blocage[0]}` : '')
  if (t.statut === 'fusionnée') return t.essais > 1 ? `${t.essais} essais` : ''
  return t.attend.length ? `attend ${t.attend.slice(0, 4).join(', ')}${t.attend.length > 4 ? '…' : ''}` : ''
}
/** La même chose en couleurs : l'étape dans sa couleur, l'essai en ambre, le lieu estompé. @param {TacheVue} t @param {boolean} active @param {boolean} tranchee @param {number} n @returns {Ligne} */
function quoiColore(t, active, tranchee, n) {
  if (active && t.etape) {
    /** @type {Ligne} */
    const l = [{ t: court(ETAPES[t.etape] || t.etape, n), c: COULEUR_ETAPE[t.etape] || 'subtle', b: true }]
    if (t.essais > 1) l.push({ t: ` essai ${t.essais}`, c: 'warning' })
    if (t.isole) l.push({ t: ' (worktree)', d: true })
    return l
  }
  const q = court(quoi(t, active, tranchee), n)
  if (!q) return []
  return [{ t: q, c: tranchee ? 'subtle' : t.statut === 'besoin-humain' ? 'warning' : t.statut in ATTENTION ? 'error' : 'subtle' }]
}

/** Largeur affichée d'une ligne, en cellules (tous ses glyphes en occupent une). @param {Ligne} l */
export const largeur = l => l.reduce((n, m) => n + [...m.t].length, 0)

/**
 * Le bandeau au-dessus du prompt : une ligne, ou rien (null) quand aucun run n'est à montrer. Il tient dans `colonnes`
 * moins `reserve` (la place d'un bouton à sa suite) : on retire l'aide, la dernière nouvelle, le détail de l'étape,
 * puis on raccourcit les libellés et la barre, puis la durée et le numéro du run, jusqu'à ce qu'il tienne. La forme la
 * plus courte fait une quarantaine de cellules sur un petit plan, une soixantaine au plus sur un gros ; en deçà,
 * l'affichage coupe la fin de la ligne. Avec `anime`, la tête tourne et les tâches en cours pulsent dans la barre.
 * @param {Instantane} inst @param {number} maintenant @param {number} colonnes @param {number} [reserve] @param {boolean} [anime] @returns {Ligne | null}
 */
export function bandeau(inst, maintenant, colonnes, reserve = 0, anime = false) {
  if (!inst.run) return null
  const s = resumer(inst, maintenant)
  const place = Math.max(0, colonnes - reserve)
  /** @type {Ligne | null} */
  let l = null
  for (const forme of FORMES_BANDEAU) {
    l = ligneBandeau(inst, s, maintenant, forme, anime)
    if (largeur(l) <= place) return l
  }
  return l
}
// Du plus complet au plus court
const FORMES_BANDEAU = [
  { aide: true, nouvelle: true, etape: true, libelles: true, barre: 14, nom: 28, duree: true, run: true },
  { aide: false, nouvelle: true, etape: true, libelles: true, barre: 14, nom: 28, duree: true, run: true },
  { aide: false, nouvelle: false, etape: true, libelles: true, barre: 12, nom: 24, duree: true, run: true },
  { aide: false, nouvelle: false, etape: false, libelles: true, barre: 10, nom: 20, duree: true, run: true },
  { aide: false, nouvelle: false, etape: false, libelles: false, barre: 8, nom: 16, duree: true, run: true },
  { aide: false, nouvelle: false, etape: false, libelles: false, barre: 4, nom: 12, duree: false, run: true },
  { aide: false, nouvelle: false, etape: false, libelles: false, barre: 0, nom: 8, duree: false, run: true },
  { aide: false, nouvelle: false, etape: false, libelles: false, barre: 0, nom: 8, duree: false, run: false },
]
/**
 * @param {Instantane} inst @param {ReturnType<typeof resumer>} s @param {number} maintenant
 * @param {typeof FORMES_BANDEAU[number]} f @param {boolean} anime @returns {Ligne}
 */
function ligneBandeau(inst, s, maintenant, f, anime) {
  const run = /** @type {NonNullable<Instantane['run']>} */ (inst.run)
  const enCoursRun = !!s.run
  const tete = s.silence ? { t: '◌ ', c: 'warning' } : enCoursRun ? { t: `${anime ? roue(maintenant) : '▶'} `, c: 'claude' } : run.statut === 'terminé' ? { t: '✓ ', c: 'success' } : { t: '■ ', c: 'warning' }
  const phase = phaseDuRun(inst)
  /** @type {Ligne} */
  const l = [{ ...tete, b: true }, ...(inst.demo ? [{ t: ' DÉMO ', c: 'inverseText', f: 'merged', b: true }, { t: ' ' }] : []), { t: court(inst.plan, f.nom), b: true }, { t: '  ' }]
  const points = pointsPhases(s.phases, phase)
  if (points) l.push(...points)
  else l.push({ t: `phase ${phase}/${s.phaseMax}`, d: true })
  if (f.barre) l.push({ t: '  ' }, ...barreClasses(inst.taches.filter(t => t.statut !== 'annulée'), classeur(inst, maintenant), f.barre, maintenant, anime))
  l.push({ t: `  ${s.faites}/${s.total}`, b: true })
  const ec = s.enCours
  if (ec.length && f.etape) {
    const t = /** @type {TacheVue} */ (ec[0])
    l.push({ t: `  ◐ ${t.id} `, c: 'suggestion' }, { t: ETAPES[t.etape || ''] || String(t.etape), c: COULEUR_ETAPE[t.etape || ''] || 'subtle', b: true })
    if (ec.length > 1) l.push({ t: ` +${ec.length - 1}`, c: 'suggestion' })
  } else if (ec.length) l.push({ t: `  ◐ ${ec.length}${f.libelles ? ' en cours' : ''}`, c: 'suggestion' })
  if (s.relectures) l.push({ t: `  ⚑ ${s.relectures}${f.libelles ? ' à relire' : ''}`, c: 'warning' })
  if (s.attention.length) l.push({ t: '  ' }, { t: ` ⚠ ${s.attention.length}${f.libelles ? ' à toi' : ''} `, c: 'inverseText', f: 'warning', b: true })
  if (s.silence) l.push({ t: f.libelles ? `  sans nouvelles depuis ${duree(maintenant - /** @type {number} */ (inst.maj))}` : `  ◌ ${duree(maintenant - /** @type {number} */ (inst.maj))}`, c: 'warning' })
  else if (!enCoursRun) l.push({ t: f.run ? `  run ${run.numero} ${run.statut}` : `  ${run.statut}`, c: run.statut === 'terminé' ? 'success' : 'warning', b: true })
  if (f.duree) l.push({ t: `  ⏱ ${duree(s.duree)}`, d: true })
  const n = f.nouvelle ? nouvelle(inst, maintenant) : null
  // La fin du run est déjà dite par son statut, juste avant
  if (n && !(n.genre === 'run' && !enCoursRun)) {
    const vive = n.age < NOUVELLE_MS / 2
    l.push({ t: '   ' }, { ...n.marque, b: vive, d: !vive }, { t: ` ${court(n.texte, 44)}`, c: vive ? n.marque.c : undefined, b: vive, d: !vive })
  }
  if (f.aide) l.push({ t: '   /suivi pour le détail', d: true })
  return l
}

/** Le suffixe du spinner pendant un run actif : « · T22 vérification · 3 tâches en cours… ». @param {Instantane} inst @param {number} maintenant */
export function suffixe(inst, maintenant) {
  const ts = enCours(inst, maintenant), t = ts[0]
  if (!t) return null
  return ` · ${t.id} ${ETAPES[t.etape || ''] || t.etape} · ${pluriel(ts.length, 'tâche')} en cours…`
}

/**
 * Onglet Tâches : une ligne par phase avec une case par tâche, le détail des tâches de la phase du run et de celles qui
 * attendent, puis les dernières nouvelles. Une tâche tout juste fusionnée reste quelques secondes, en vert.
 * @param {Instantane} inst @param {number} maintenant @param {number} colonnes @param {boolean} [anime] @returns {Ligne[]}
 */
export function lignesTaches(inst, maintenant, colonnes, anime = false) {
  const s = resumer(inst, maintenant), actif = !!s.run
  const cur = actif ? phaseDuRun(inst) : s.courante?.numero ?? null
  const classe = classeur(inst, maintenant)
  const larg = Math.max(12, Math.min(40, colonnes - 40))
  const vient = /** @param {TacheVue} t */ t => fait(t) && t.fin != null && maintenant - t.fin < NOUVELLE_MS / 2
  /** @type {Ligne[]} */
  const out = []
  for (const p of s.phases) {
    const finie = p.total > 0 && p.faites === p.total
    const g = finie ? { t: '●', c: 'success' } : p.attention ? { t: '⚠', c: 'warning' } : p.numero === cur ? { t: '◉', c: 'claude', b: true } : p.faites ? { t: '◐', c: 'suggestion' } : { t: '○', c: 'subtle' }
    const ts = inst.taches.filter(t => t.phase === p.numero && t.statut !== 'annulée')
    /** @type {Ligne} */
    const l = [g, { t: ` Phase ${String(p.numero).padEnd(3)}`, b: p.numero === cur || finie, c: finie ? 'success' : undefined }, { t: ' ' }]
    l.push(...(ts.length <= 30 ? cases(ts, classe) : barreClasses(ts, classe, 20, maintenant, anime)))
    l.push({ t: `  ${p.faites}/${p.total}`, c: finie ? 'success' : undefined, b: finie }, { t: `  ${duree(p.duree)}`, d: true })
    if (p.relances.length) l.push({ t: `   ${p.relances.slice(0, 3).map(r => `${r.id} ×${r.essais}`).join(', ')}${p.relances.length > 3 ? '…' : ''}`, c: 'merged' })
    out.push(l)
    if (!(p.numero === cur || p.attention > 0 || p.enCours > 0 || ts.some(vient))) continue
    for (const t of ts.filter(vient)) out.push([{ t: '    ' }, { t: '●', c: 'success', b: true }, { t: ` ${colonne(t.id, 6)} `, c: 'success', b: true }, { t: `${colonne(t.titre, larg)} `, c: 'success' }, { t: ' fusionnée ', c: 'inverseText', f: 'success', b: true }])
    const restent = ts.filter(t => !fait(t))
    const aFaire = restent.filter(t => !(t.statut in ATTENTION) && !(actif && t.etape))
    for (const t of restent.filter(t => (t.statut in ATTENTION) || (actif && t.etape))) {
      const enMarche = actif && !!t.etape
      out.push([{ t: '    ' }, glyphe(t, actif, maintenant, anime), { t: ` ${colonne(t.id, 6)} `, b: enMarche }, { t: `${colonne(t.titre, larg)} `, d: !enMarche }, ...quoiColore(t, actif, arbitree(inst, t), Math.max(10, colonnes - larg - 24)), { t: t.debut != null && enMarche ? `  ${duree(maintenant - t.debut)}` : '', d: true }])
    }
    for (const t of aFaire.slice(0, 6)) out.push([{ t: '    ' }, glyphe(t, actif), { t: ` ${colonne(t.id, 6)} ${colonne(t.titre, larg)} `, d: true }, { t: court(quoi(t, actif), Math.max(10, colonnes - larg - 14)), d: true }])
    if (aFaire.length > 6) out.push([{ t: `    ○ ${aFaire.length - 6} autres à faire`, d: true }])
  }
  if (!out.length) return [[{ t: 'Aucune tâche dans suivi.json.', d: true }]]
  const derniers = inst.journal.filter(j => j.genre !== 'etape').slice(-3)
  if (derniers.length) {
    out.push([], [{ t: 'Dernières nouvelles', d: true }])
    for (const j of derniers) {
      const vive = j.quand != null && maintenant - j.quand < 4000
      out.push([{ t: '  ' }, marque(j), { t: ` ${court(enBref(j), Math.max(20, colonnes - 16))}`, b: vive, d: !vive }, { t: `  ${age(j.quand, maintenant)}`, d: true }])
    }
  }
  return out
}

/** Onglet À relire. @param {Instantane} inst @param {number} maintenant @param {number} colonnes @returns {Ligne[]} */
export function lignesRelire(inst, maintenant, colonnes) {
  if (!inst.relectures.length) return [[{ t: 'Rien à relire pour l\'instant.', d: true }]]
  /** @type {Ligne[]} */
  const out = [[{ t: `À relire avant la PR : ${inst.relectures.length}. Le run continue ; rien n'est autorisé d'ici.`, d: true }]]
  for (const r of inst.relectures) {
    const titre = r.tache ? inst.taches.find(t => t.id === r.tache)?.titre ?? '' : 'plan source'
    out.push([{ t: `⚑ ${r.tache ?? '—'}`, c: 'warning' }, { t: `  ${court(titre, Math.max(10, colonnes - 30))}` }, { t: `${r.phase != null ? ` · phase ${r.phase}` : ''}${r.quand != null ? ` · il y a ${age(r.quand, maintenant)}` : ''}`, d: true }])
    out.push([{ t: `    ${court(r.texte, Math.max(20, colonnes - 6))}`, d: true }])
  }
  return out
}

/** Onglet Journal : les derniers événements, les plus récents en bas, avec leur âge. @param {Instantane} inst @param {number} maintenant @param {number} colonnes @returns {Ligne[]} */
export function lignesJournal(inst, maintenant, colonnes) {
  if (!inst.journal.length) return [[{ t: 'Journal vide.', d: true }]]
  return inst.journal.map(j => [{ t: `${age(j.quand, maintenant).padStart(7)}  `, d: true }, marque(j), { t: ` ${court(j.texte, Math.max(20, colonnes - 12))}` }])
}

/** Onglet Bilan : phases, relectures, décisions d'office, ce qui attend. @param {Instantane} inst @param {number} maintenant @returns {Ligne[]} */
export function lignesBilan(inst, maintenant) {
  const s = resumer(inst, maintenant)
  /** @type {Ligne[]} */
  const out = [[{ t: s.termine ? `✓ ${inst.plan} terminé` : `${inst.plan} : ${s.faites}/${s.total} tâches fusionnées`, c: s.termine ? 'success' : 'claude', b: true }, { t: `   ${pluriel(inst.runs.length, 'run')}`, d: true }]]
  out.push([{ t: '  Phase  Tâches    Durée  Essais', d: true }])
  const classe = classeur(inst, maintenant)
  for (const p of s.phases) {
    const ts = inst.taches.filter(t => t.phase === p.numero && t.statut !== 'annulée')
    out.push([{ t: `  ${String(p.numero).padStart(5)}  ` }, { t: `${p.faites}/${p.total}`.padStart(6), c: p.faites === p.total ? 'success' : undefined }, { t: `  ${duree(p.duree).padStart(7)}  ${String(p.essais).padStart(6)}   ` }, ...(ts.length <= 30 ? cases(ts, classe) : barreClasses(ts, classe, 20, maintenant, false)), { t: p.relances.length ? `   ${p.relances.slice(0, 4).map(r => `${r.id} ×${r.essais}`).join(', ')}${p.relances.length > 4 ? '…' : ''}` : '', c: 'merged' }])
  }
  out.push([])
  out.push([{ t: `⚑ ${pluriel(s.relectures, 'relecture')} avant la PR`, c: s.relectures ? 'warning' : 'subtle' }, { t: s.relectures ? `   ${[...new Set(inst.relectures.map(r => r.tache ?? 'plan source'))].slice(0, 8).join(', ')}` : '', d: true }])
  out.push([{ t: `⇒ ${pluriel(inst.decisions.length, 'décision')} prise${inst.decisions.length > 1 ? 's' : ''} d'office`, c: inst.decisions.length ? 'warning' : 'subtle' }, { t: inst.decisions.length ? `   ${inst.decisions.slice(0, 6).map(d => d.tache).join(', ')}` : '', d: true }])
  const maj = Object.entries(inst.majeures).sort((a, b) => b[1] - a[1])
  out.push([{ t: `≠ ${pluriel(maj.reduce((n, [, k]) => n + k, 0), 'entrée')} majeure${maj.reduce((n, [, k]) => n + k, 0) > 1 ? 's' : ''} dans HANDOFF.md`, c: maj.length ? 'merged' : 'subtle' }, { t: maj.length ? `   ${maj.map(([type, k]) => `${type} ${k}`).join(', ')}` : '', d: true }])
  if (inst.tickets) out.push([{ t: `☐ ${pluriel(inst.tickets, 'ticket')} à ouvrir après la PR`, c: 'subtle' }])
  for (const t of s.attention) out.push([{ t: `⚠ ${t.id} ${ATTENTION[/** @type {keyof typeof ATTENTION} */ (t.statut)]}`, c: 'warning' }, { t: t.blocage[0] ? ` : ${court(t.blocage[0], 80)}` : '', d: true }])
  for (const p of inst.prerequis) out.push([{ t: `⚠ ${p.id} (${p.type}) ouvert`, c: 'warning' }, { t: p.bloque.length ? `, bloque ${p.bloque.slice(0, 5).join(', ')}` : '', d: true }])
  for (const p of inst.points) out.push([{ t: `? ${p.tache} : ${court(p.titre, 80)}`, c: 'warning' }, { t: p.humain ? ' (humain)' : '', d: true }])
  if (!inst.lint.ok) out.push([{ t: `✗ plan-lint : ${pluriel(inst.lint.erreurs, 'erreur')} au dernier suivi`, c: 'error' }])
  return out
}

/** Une ligne en texte brut. @param {Ligne} l */
export const brut = l => l.map(m => m.t).join('').replace(/\s+$/, '')

/** L'état en texte, là où rien ne se dessine (`/suivi texte`, panneau refusé). @param {Instantane} inst @param {number} maintenant */
export function texteEtat(inst, maintenant) {
  const b = bandeau(inst, maintenant, 120)
  return [b ? brut(b) : `${inst.plan} : aucun run noté dans suivi.json`, '', ...lignesTaches(inst, maintenant, 100).map(brut), '', ...lignesBilan(inst, maintenant).slice(2).map(brut).filter(Boolean)].join('\n')
}

/** Brouillon de description de PR, mis dans le prompt, jamais envoyé. @param {Instantane} inst @param {number} maintenant */
export function textePR(inst, maintenant) {
  const s = resumer(inst, maintenant)
  const l = [`Plan ${inst.plan} : ${s.faites}/${s.total} tâches fusionnées, ${pluriel(inst.runs.length, 'run')}.`, '']
  if (inst.relectures.length) {
    l.push('À relire avant de fusionner (fichiers et commandes interdits aux agents) :')
    for (const r of inst.relectures) l.push(`- ${r.tache ?? 'plan source'} : ${r.texte}`)
    l.push('')
  }
  if (inst.decisions.length) {
    l.push('Décisions prises d\'office (mode autonome) :')
    for (const d of inst.decisions) l.push(`- ${d.tache}, ${d.titre} : option ${d.option}, ${d.description}`)
    l.push('')
  }
  if (s.attention.length) l.push(`Encore en attente : ${s.attention.map(t => `${t.id} (${ATTENTION[/** @type {keyof typeof ATTENTION} */ (t.statut)]})`).join(', ')}.`, '')
  if (inst.tickets) l.push(`${pluriel(inst.tickets, 'ticket')} à ouvrir après la PR (HANDOFF.md, entrées « ticket »).`)
  return l.join('\n').replace(/\n+$/, '\n')
}

/** Une notification qui demande quelqu'un : tâche qui attend un humain, bloquée ou en échec, run arrêté ou en erreur. @param {string} m */
export const importante = m => / attend un humain$|^✗ |^Run arrêté|\) : erreur/.test(m)

/**
 * Ce qui mérite une notification entre deux lectures : run lancé ou fini, phase finie, tâche qui attend un humain,
 * bloquée ou en échec, nouvelle relecture, point d'arrêt. Rien à la première lecture.
 * @param {Instantane | null} avant @param {Instantane} apres @returns {string[]}
 */
export function changements(avant, apres) {
  if (!avant || avant.plan !== apres.plan) return []
  /** @type {string[]} */
  const m = []
  const ra = avant.run, rb = apres.run
  if (rb && (!ra || rb.numero !== ra.numero)) m.push(`Run ${rb.numero} lancé : phase ${rb.phase}, mode ${rb.mode}`)
  if (rb && ra && rb.numero === ra.numero && ra.statut === 'en-cours' && rb.statut !== 'en-cours') m.push(`Run ${rb.numero} (${libellePhases(rb.phase, phaseDuRun(apres) ?? rb.phase)}) : ${rb.statut}${rb.detail ? `, ${court(rb.detail, 80)}` : ''}`)
  const av = new Map(avant.taches.map(t => [t.id, t]))
  for (const t of apres.taches) {
    const a = av.get(t.id)
    if (a && a.statut !== t.statut && t.statut in ATTENTION) m.push(`${t.statut === 'besoin-humain' ? '⚑' : '✗'} ${t.id} ${ATTENTION[/** @type {keyof typeof ATTENTION} */ (t.statut)]}`)
  }
  const fini = /** @param {Instantane} i @param {number} n */ (i, n) => { const ts = i.taches.filter(t => t.phase === n && t.statut !== 'annulée'); return ts.length > 0 && ts.every(fait) }
  for (const n of [...new Set(apres.taches.map(t => t.phase))]) if (fini(apres, n) && !fini(avant, n)) m.push(`Phase ${n} terminée`)
  // Une notification par tâche, quel que soit le nombre de relectures qu'une clôture apporte
  const nouvelles = /** @type {Map<string, number>} */ (new Map())
  for (const r of apres.relectures.slice(avant.relectures.length)) nouvelles.set(r.tache ?? 'plan source', (nouvelles.get(r.tache ?? 'plan source') || 0) + 1)
  for (const [qui, k] of nouvelles) m.push(`⚑ ${qui} : ${k > 1 ? `${k} relectures` : 'à relire'} avant la PR`)
  // Un point devient point d'arrêt à la fin du run (le scribe l'a noté « a-trancher ») : le rôle fait partie de la clé
  const cle = /** @param {{ tache: string, titre: string, role: string }} p */ p => `${p.tache}\u0000${p.titre}\u0000${p.role}`
  const vus = new Set(avant.points.map(cle))
  for (const p of apres.points) if (p.role === 'arret' && !vus.has(cle(p))) m.push(`Run arrêté : ${p.tache}, ${court(p.titre, 80)}`)
  return m
}
