// Tests de worktrees.mjs (nettoyage des worktrees des essais précédents), dans des dépôts git temporaires.
// Usage : node tests/worktrees.test.mjs [chemin de worktrees.mjs]
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const SCRIPT = resolve(process.argv[2] || 'plugins/orchestre/scripts/worktrees.mjs')
const temporaires = []
let n = 0
const cas = (nom, fn) => { fn(); n++; console.log('ok ·', nom) }

// Un dépôt dont le chemin contient des espaces, avec un plan de quatre tâches et des worktrees d'essais précédents
function depot() {
  const base = mkdtempSync(join(tmpdir(), 'worktrees-')); temporaires.push(base)
  const racine = join(base, 'mon dépôt'), wt = n => join(base, 'arbres de travail', n)
  mkdirSync(racine, { recursive: true })
  const git = (...a) => execFileSync('git', a, { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(racine, '.gitignore'), 'node_modules/\n'); writeFileSync(join(racine, 'a.txt'), 'a\n')
  mkdirSync(join(racine, 'plans', 'p', 'taches'), { recursive: true })
  for (const id of ['T01', 'T02', 'T03', 'T04']) writeFileSync(join(racine, 'plans', 'p', 'taches', `${id}-x.md`), `---\nid: ${id}\nphase: 1\n---\n`)
  git('add', '.'); git('commit', '-qm', 'plan'); git('switch', '-qc', 'plan/p')
  const ajouter = (nom, branche) => { git('worktree', 'add', '-q', '-b', branche, wt(nom), 'plan/p'); return wt(nom) }
  return { racine, git, wt, ajouter, lancer: (args, cwd = racine) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() } } }
}
const branches = D => D.git('branch', '--format=%(refname:short)').trim().split('\n').sort()
const worktrees = D => D.git('worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('branch ')).map(l => l.slice(18)).sort()

try {
  cas('worktrees propres des tâches retirés, branches gardées ; modifiés, autres branches et autres plans gardés', () => {
    const D = depot()
    const w1 = D.ajouter('w1', 'tache/T01')
    mkdirSync(join(w1, 'node_modules')); writeFileSync(join(w1, 'node_modules', 'x'), 'ignoré\n')
    D.git('worktree', 'lock', w1, '--reason', 'agent')
    D.ajouter('w2', 'tache/T02-r2')
    writeFileSync(join(D.ajouter('w3', 'tache/T03'), 'a.txt'), 'modifié\n')
    writeFileSync(join(D.ajouter('w4', 'tache/T04'), 'nouveau.txt'), 'non suivi\n')
    D.ajouter('w5', 'feature/autre'); D.ajouter('w6', 'tache/T99'); D.ajouter('w7', 'tache/T01-old')
    const avant = branches(D)
    const r = D.lancer(['nettoyer', 'plans/p'])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(worktrees(D), ['feature/autre', 'plan/p', 'tache/T01-old', 'tache/T03', 'tache/T04', 'tache/T99'])
    assert.deepEqual(branches(D), avant, 'aucune branche supprimée')
    assert.ok(!existsSync(w1) && existsSync(D.wt('w3')))
    assert.match(r.out, /^retiré tache\/T01 \(.*w1\), branche gardée, verrou « agent » levé$/m)
    assert.match(r.out, /^gardé  tache\/T03 \(.*w3\) : 1 fichier modifié ou non suivi, à commiter ou annuler à la main$/m)
    assert.match(r.out, /^gardé  tache\/T04 /m)
    assert.equal(r.out.split('\n').pop(), 'worktrees plans/p : 2 retirés, 2 gardés')
    // La branche libérée se reprend
    D.git('switch', '-q', 'tache/T01'); D.git('switch', '-q', 'plan/p')
  })

  cas('--essai : rien ne bouge ; dossier disparu oublié ; appel depuis un worktree, sans dossier de plan', () => {
    const D = depot()
    const w1 = D.ajouter('w1', 'tache/T01'), w2 = D.ajouter('w2', 'tache/T02')
    let r = D.lancer(['nettoyer', '--essai'])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(worktrees(D), ['plan/p', 'tache/T01', 'tache/T02'])
    assert.equal(r.out.split('\n').pop(), 'worktrees plans/p : 2 à retirer, 0 gardé')
    rmSync(w2, { recursive: true, force: true })
    r = D.lancer(['nettoyer'], w1)
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /^gardé  tache\/T01 \(.*w1\) : c'est le dossier d'où le nettoyage est lancé$/m)
    assert.equal(r.out.split('\n').pop(), 'worktrees plans/p : 0 retiré, 1 gardé, 1 orphelin oublié')
    assert.deepEqual(worktrees(D), ['plan/p', 'tache/T01'])
  })

  cas('run « en-cours » dans suivi.json : refus (code 1), sauf --essai ou --run-arrete', () => {
    const D = depot()
    D.ajouter('w1', 'tache/T01')
    writeFileSync(join(D.racine, 'plans', 'p', 'suivi.json'), JSON.stringify({ format: 'orchestre-suivi/1', runs: [{ numero: 1, statut: 'terminé' }, { numero: 2, statut: 'en-cours', debut: '2026-10-08T10:00:00+02:00' }] }))
    let r = D.lancer(['nettoyer', 'plans/p'])
    assert.equal(r.code, 1); assert.match(r.err, /run 2 « en-cours » depuis 2026-10-08T10:00:00\+02:00 : rien n'est retiré/)
    assert.deepEqual(worktrees(D), ['plan/p', 'tache/T01'])
    r = D.lancer(['nettoyer', 'plans/p', '--essai'])
    assert.equal(r.code, 0); assert.equal(r.out.split('\n').pop(), 'worktrees plans/p : 1 à retirer, 0 gardé')
    r = D.lancer(['nettoyer', 'plans/p', '--run-arrete'])
    assert.equal(r.code, 0, r.err); assert.deepEqual(worktrees(D), ['plan/p'])
  })

  cas('appels invalides : code 2, rien ne bouge', () => {
    const D = depot()
    D.ajouter('w1', 'tache/T01')
    for (const [args, motif] of [[[], /usage/], [['nettoyer', 'plans/inconnu'], /plan introuvable/], [['effacer'], /usage/]]) {
      const r = D.lancer(args)
      assert.equal(r.code, 2, JSON.stringify(r)); assert.match(r.err, motif)
    }
    const hors = mkdtempSync(join(tmpdir(), 'hors-')); temporaires.push(hors)
    assert.match(D.lancer(['nettoyer'], hors).err, /pas dans un dépôt git/)
    assert.deepEqual(worktrees(D), ['plan/p', 'tache/T01'])
  })
  console.log(`worktrees : TOUT EST VERT (${n} cas)`)
} finally { for (const d of temporaires) rmSync(d, { recursive: true, force: true }) }
