// Tests du modèle du mod orchestre-suivi (plugins/orchestre-suivi/hooks/modele.mjs) sur des suivi.json écrits par le
// vrai scripts/suivi.mjs dans un dépôt git temporaire. Les hooks eux-mêmes se testent par `claude plugin test`.
// Usage : node tests/orchestre-suivi.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import * as M from '../plugins/orchestre-suivi/hooks/modele.mjs'

const SUIVI = resolve('plugins/orchestre/scripts/suivi.mjs')
const racine = mkdtempSync(join(tmpdir(), 'orchestre-suivi-'))
const git = (...a) => execFileSync('git', a, { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const d = join(racine, 'plans', 'demo')
const tache = (id, phase, depend_de = []) => `---\nid: ${id}\ntitre: Tâche ${id} au titre long du frontmatter\nphase: ${phase}\nmodele: sonnet\ndepend_de: [${depend_de.join(', ')}]\nfichiers_possedes:\n  - src/${id}/**\nressources: []\nestimation_tokens: 1.0M\nverification:\n  - "npm test"\ndefinition_du_fini:\n  - "le test passe"\n---\n`
const suivi = (cmd, E) => {
  const r = spawnSync(process.execPath, [SUIVI, cmd, 'plans/demo', '--json', JSON.stringify(E)], { cwd: racine, encoding: 'utf8' })
  assert.equal(r.status, 0, `${cmd} : ${r.stderr}`)
}
const lire = () => M.normaliser(JSON.parse(readFileSync(join(d, 'suivi.json'), 'utf8')))
const texte = lignes => lignes.map(M.brut).join('\n')
let n = 0
const cas = (nom, fn) => { fn(); n++; console.log('ok ·', nom) }

try {
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(racine, 'README.md'), 'x\n'); git('add', '.'); git('commit', '-qm', 'init')
  mkdirSync(join(d, 'taches'), { recursive: true })
  const T = [['T01', 1], ['T02', 1], ['T03', 2, ['T01']], ['T04', 2, ['T02', 'T03']]]
  for (const [id, ph, dep] of T) writeFileSync(join(d, 'taches', `${id}-x.md`), tache(id, ph, dep))
  writeFileSync(join(d, 'SUIVI.md'), `# SUIVI — demo\n\n| ID | Titre | Phase | Lot | Dépend de | Modèle | Statut | Essais | Branche | Tokens est. / réels |\n|----|----|----|----|----|----|----|----|----|----|\n${T.map(([id, ph]) => `| ${id} | Tâche ${id} | ${ph} | — | — | sonnet | à-faire | 0 | — | 1,0 M / — |`).join('\n')}\n\nStatuts : à-faire · ajoutée · fusionnée · bloquée · échec · besoin-humain · annulée\n`)
  writeFileSync(join(d, 'HANDOFF.md'), '# HANDOFF — demo\n')
  writeFileSync(join(d, 'orchestre.config.json'), JSON.stringify({ branche_integration: 'plan/demo' }))
  git('switch', '-qc', 'plan/demo'); git('add', '.'); git('commit', '-qm', 'plan')

  suivi('debut-run', { phase: 1, mode: 'auto', parallelisme: 2, corrections_max: 2, decisions_office_max: 3 })
  suivi('etape', { tache: 'T01', etape: 'worker', isole: true })
  suivi('etape', { tache: 'T02', etape: 'vérification', isole: true })
  const A = lire()
  const tA = Date.parse(JSON.parse(readFileSync(join(d, 'suivi.json'), 'utf8')).maj) + 90000

  cas('format : orchestre-suivi/1 lu, un autre format refusé sans deviner', () => {
    assert.ok(A); assert.equal(A.plan, 'demo'); assert.equal(A.taches.length, 4)
    assert.equal(M.normaliser({ format: 'orchestre-suivi/2', taches: [] }), null)
    assert.equal(M.formatDe({ format: 'orchestre-suivi/2' }), 'orchestre-suivi/2')
    assert.equal(M.normaliser({ format: 'orchestre-suivi/1' }), null, 'sans taches')
  })

  cas('pendant un run : bandeau, suffixe du spinner, tâches en cours dans l\'onglet Tâches', () => {
    const b = M.brut(M.bandeau(A, tA, 140))
    assert.match(b, /^▶ demo {2}phase 1\/2 {2}▕░+▏ 0\/4 {2}◐ 2 en cours {2}⏱ 1 min {3}\/suivi pour le détail$/)
    assert.match(M.brut(M.bandeau(A, tA, 80)), /◐ 2 {2}⏱/, 'version étroite')
    assert.equal(M.suffixe(A, tA), ' · T01 réalisation · 2 tâches en cours…')
    const t = texte(M.lignesTaches(A, tA, 100))
    assert.match(t, /^◐ Phase 1 {2}0\/2/m); assert.match(t, /◐ T01 +Tâche T01 +réalisation \(worktree\)/); assert.match(t, /◐ T02 .*vérification/)
    assert.match(t, /^○ Phase 2 {2}0\/2/m); assert.doesNotMatch(t, /T03/, 'phase suivante repliée')
  })

  suivi('cloture', { tache: 'T01', statut: 'fusionnée', essais: 2, branche: 'tache/T01', refus: [{ essai: 1, par: 'évaluation', manques: ['texte faux'] }], relectures: ['agents/x/.env.example : ajouter MR_MAX'], decisions_office: [{ titre: 'Seuil de relance', option: 'A', description: 'plafond à 30 s' }] })
  suivi('cloture', { tache: 'T02', statut: 'besoin-humain', essais: 1, branche: 'tache/T02', blocage: ['secret manquant pour les tests'], relectures: ['a.env.example : x', 'b.env.example : y'], points: [{ titre: 'Secret manquant', contexte: '', humain: true, options: [] }] })
  const B = lire()

  cas('notifications : relecture, tâche qui attend un humain ; rien à la première lecture', () => {
    assert.deepEqual(M.changements(null, B), [])
    assert.deepEqual(M.changements(A, B), ['⚑ T02 attend un humain', '⚑ T01 : à relire avant la PR', '⚑ T02 : 2 relectures avant la PR'], 'une notification par tâche')
    assert.deepEqual(M.changements(B, B), [])
  })

  cas('onglets À relire et Bilan, état en texte et brouillon de PR', () => {
    const r = texte(M.lignesRelire(B, tA, 100))
    assert.match(r, /À relire avant la PR : 3\./); assert.match(r, /⚑ T01 {2}Tâche T01 · phase 1 · il y a/); assert.match(r, /agents\/x\/\.env\.example : ajouter MR_MAX/)
    const bi = texte(M.lignesBilan(B, tA))
    assert.match(bi, /demo : 1\/4 tâches fusionnées/); assert.match(bi, /^ +1 +1\/2 .* 3 +T01 ×2$/m)
    assert.match(bi, /⚑ 3 relectures avant la PR {3}T01, T02/); assert.match(bi, /⇒ 1 décision prise d'office {3}T01/); assert.match(bi, /⚠ T02 attend un humain : secret manquant/)
    const pr = M.textePR(B, tA)
    assert.match(pr, /- T01 : agents\/x\/\.env\.example : ajouter MR_MAX/); assert.match(pr, /- T01, Seuil de relance : option A, plafond à 30 s/); assert.match(pr, /Encore en attente : T02 \(attend un humain\)/)
    assert.match(M.texteEtat(B, tA), /^▶ demo {2}phase 1\/2/)
    assert.match(texte(M.lignesJournal(B, tA, 100)), /⚑ /)
  })

  suivi('fin-run', { statut: 'arbitrage', phase: 1, mode: 'auto', arbitrage: { tache: 'T02', titre: 'Secret manquant', contexte: '', humain: true, options: [] }, points_a_trancher: [], taches: [], non_lancees: [], reportees: [], taches_ajoutees: [], arbitrages_appliques: [], decisions_office: [], amendements_ecartes: [], en_attente: ['T02'], en_attente_prerequis: [] })
  const C = lire()

  cas('fin de run : notification, bandeau de fin, plus de suffixe ni de tâche en cours', () => {
    assert.deepEqual(B.points.map(p => p.role), ['a-trancher'], 'le scribe note le point à la clôture')
    assert.deepEqual(M.changements(B, C), ['Run 1 (phase 1) : arbitrage', 'Run arrêté : T02, Secret manquant'], 'point devenu point d\'arrêt')
    assert.match(M.brut(M.bandeau(C, tA, 140)), /^■ demo {2}phase 1\/2 .* 1\/4 {2}⚑ 3 à relire {2}⚠ 1 à toi {2}run 1 arbitrage {2}⏱ /)
    assert.equal(M.suffixe(C, tA), null); assert.deepEqual(M.enCours(C, tA), [])
    assert.match(texte(M.lignesBilan(C, tA)), /\? T02 : Secret manquant \(humain\)/)
  })

  cas('gros plan : l\'onglet Tâches replie les phases sans activité et borne les tâches à faire', () => {
    const doc = JSON.parse(readFileSync(join(d, 'suivi.json'), 'utf8'))
    doc.taches = Array.from({ length: 130 }, (_, i) => ({ ...doc.taches[0], id: `T${String(i + 1).padStart(3, '0')}`, phase: Math.floor(i / 13) + 1, statut: i < 40 ? 'fusionnée' : 'à-faire', etape: null }))
    const G = M.normaliser(doc)
    const l = M.lignesTaches(G, tA, 100)
    assert.equal(l.filter(x => /Phase/.test(M.brut(x))).length, 10)
    assert.ok(l.length <= 10 + 6 + 1 + 2, `${l.length} lignes`)
    assert.match(texte(l), /○ 1 autres à faire|○ \d+ autres à faire/)
    assert.equal(M.resumer(G, tA).courante.numero, 4)
  })

  cas('run interrompu (resté « en-cours » sans écriture depuis 45 min) : sans nouvelles, plus d\'étape ni de suffixe', () => {
    const tard = (A.maj ?? 0) + M.SILENCE_MS + 60000
    assert.ok(M.silencieux(A, tard)); assert.ok(!M.silencieux(A, tA))
    assert.match(M.brut(M.bandeau(A, tard, 140)), /^◌ demo {2}phase 1\/2 .* 0\/4 {2}sans nouvelles depuis 46 min {2}⏱ /)
    assert.doesNotMatch(M.brut(M.bandeau(A, tard, 140)), /en cours/)
    assert.equal(M.suffixe(A, tard), null); assert.deepEqual(M.enCours(A, tard), [])
    assert.doesNotMatch(texte(M.lignesTaches(A, tard, 100)), /◐ T0/)
  })

  cas('phase dont toutes les tâches sont annulées : plus comptée', () => {
    const doc = JSON.parse(readFileSync(join(d, 'suivi.json'), 'utf8'))
    for (const t of doc.taches) if (t.phase === 2) t.statut = 'annulée'
    const X = M.normaliser(doc)
    assert.deepEqual(M.phasesDe(X, tA).map(p => p.numero), [1])
    assert.match(M.brut(M.bandeau(X, tA, 140)), /phase 1\/1 .* 1\/2/)
  })

  cas('mise en forme : durées, âges, barre, coupe', () => {
    assert.deepEqual([M.duree(45000), M.duree(18 * 60000), M.duree(72 * 60000), M.duree(null)], ['45 s', '18 min', '1 h 12', '—'])
    assert.equal(M.age(0, 3 * 86400000), '3 j'); assert.equal(M.barre(1, 4, 8), '██░░░░░░'); assert.equal(M.court('abcdef', 4), 'abc…')
  })

  console.log(`orchestre-suivi : TOUT EST VERT (${n} cas)`)
} finally {
  rmSync(racine, { recursive: true, force: true })
}
