// Tests de plan-lint sur des plans jouets, dans un dépôt git temporaire.
// Usage : node tests/plan-lint.test.mjs [chemin de plan-lint.mjs]
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const LINT = resolve(process.argv[2] || 'plugins/orchestre/scripts/plan-lint.mjs')
const racine = mkdtempSync(join(tmpdir(), 'plan-lint-'))
const git = (...a) => execFileSync('git', a, { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const lint = (...a) => {
  const r = spawnSync('node', [LINT, ...a], { cwd: racine, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr, json: a.includes('--json') && r.stdout ? JSON.parse(r.stdout) : null }
}
const tache = (id, { phase = 1, depend_de = '[]', fichiers = [`src/${id}/**`], ressources = '[]', verification = ['"npm test"'], fini = ['"le test passe"'], prerequis = null } = {}) => `---
id: ${id}
titre: Tâche ${id}
phase: ${phase}
modele: sonnet
effort: high
depend_de: ${depend_de}
fichiers_possedes:
${fichiers.map(f => `  - ${f}`).join('\n')}
ressources: ${ressources}${prerequis ? `\nprerequis: ${prerequis}` : ''}
estimation_tokens: 1.0M
verification:
${verification.map(v => `  - ${v}`).join('\n')}
definition_du_fini:
${fini.map(v => `  - ${v}`).join('\n')}
---

## Prompt de lancement
Tu réalises ${id}.
`
const SUIVI = ids => `| ID | Titre | Phase | Lot | Dépend de | Modèle | Statut | Essais | Branche | Tokens est. / réels |
|----|-------|-------|-----|-----------|--------|--------|--------|---------|---------------------|
${ids.map(([id, st]) => `| ${id} | Tâche ${id} | 1 | 1A | — | sonnet | ${st} | 0 | — | 1,0 M / — |`).join('\n')}
`
function plan(nom, taches, suivi) {
  const d = join(racine, 'plans', nom)
  mkdirSync(join(d, 'taches'), { recursive: true })
  for (const [id, txt] of Object.entries(taches)) writeFileSync(join(d, 'taches', `${id}-x.md`), txt)
  writeFileSync(join(d, 'SUIVI.md'), SUIVI(suivi || Object.keys(taches).map(id => [id, 'à-faire'])))
  return `plans/${nom}`
}
let n = 0
const cas = (nom, fn) => { fn(); n++; console.log('ok ·', nom) }

try {
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
  const p = plan('ok', { T01: tache('T01'), T02: tache('T02', { depend_de: '[T01]' }), T03: tache('T03', { phase: 2, depend_de: '[T02]' }), T02B: tache('T02B', { ressources: '[base]', fichiers: ['src/b/**'] }) })
  git('add', '.'); git('commit', '-qm', 'plan'); git('switch', '-qc', 'plan/ok')

  cas('plan valide : JSON complet (taches, tous, phase_max), estimation lisible', () => {
    const r = lint(p, '--json')
    assert.equal(r.code, 0, r.out + r.err); assert.equal(r.json.ok, true)
    assert.equal(r.json.phase_max, 2); assert.equal(r.json.tous.length, 4); assert.equal(r.json.taches.length, 4)
    const t02b = r.json.taches.find(t => t.id === 'T02B')
    assert.deepEqual(t02b.ressources, ['base']); assert.equal(t02b.statut, 'à-faire'); assert.deepEqual(t02b.verification, ['npm test'])
    const h = lint(p); assert.equal(h.code, 0); assert.match(h.out, /plan valide : 4 tâches/)
  })
  cas('--phase : seules les tâches de la phase, et la phase 2 refusée tant que la phase 1 n’est pas faite', () => {
    const r = lint(p, '--json', '--phase', '1'); assert.equal(r.json.taches.length, 3); assert.equal(r.json.tous.length, 4)
    const r2 = lint(p, '--json', '--phase', '2'); assert.equal(r2.code, 1)
    assert.ok(r2.json.erreurs.some(e => e.includes('T01 (phase 1) n\'est ni fusionnée ni annulée')))
  })
  cas('--integration : le commit « tâche <id> : » sur la branche fait foi, « annulée » compte comme faite', () => {
    git('commit', '-q', '--allow-empty', '-m', 'tâche T01 : x'); git('commit', '-q', '--allow-empty', '-m', 'tâche T02 : x')
    writeFileSync(join(racine, p, 'SUIVI.md'), SUIVI([['T01', 'à-faire'], ['T02', 'à-faire'], ['T02B', 'annulée'], ['T03', 'à-faire']]))
    const r = lint(p, '--json', '--phase', '2', '--integration', 'plan/ok')
    assert.equal(r.code, 0, JSON.stringify(r.json)); assert.equal(r.json.taches[0].id, 'T03')
    assert.equal(r.json.tous.find(t => t.id === 'T01').statut, 'fusionnée'); assert.equal(r.json.tous.find(t => t.id === 'T02B').statut, 'annulée')
  })
  cas('--integration : branche inconnue signalée, branche qui ressemble à une option refusée sans rien écrire', () => {
    const r = lint(p, '--json', '--integration', 'plan/absente'); assert.equal(r.code, 1)
    assert.ok(r.json.erreurs.includes("branche d'intégration introuvable : plan/absente"))
    const x = join(racine, 'ecrit.txt'), r2 = lint(p, '--integration', `--output=${x}`)
    assert.equal(r2.code, 2); assert.ok(!existsSync(x), 'git ne doit rien écrire')
  })
  cas('--integration : les fusions d’un plan précédent, déjà dans main, ne comptent pas', () => {
    git('switch', '-q', 'main'); git('commit', '-q', '--allow-empty', '-m', 'tâche T03 : plan précédent, déjà dans main'); git('switch', '-qc', 'plan/nouveau')
    const r = lint(p, '--json', '--integration', 'plan/nouveau')
    assert.equal(r.code, 0, JSON.stringify(r.json)); assert.equal(r.json.tous.find(t => t.id === 'T03').statut, 'à-faire')
    const r2 = lint(p, '--json', '--integration', 'plan/nouveau', '--base', 'main'); assert.equal(r2.json.tous.find(t => t.id === 'T03').statut, 'à-faire')
    const r3 = lint(p, '--json', '--integration', 'plan/nouveau', '--base', 'develop'); assert.equal(r3.code, 1)
    assert.ok(r3.json.erreurs.includes('branche de base introuvable : develop'))
    git('switch', '-q', 'plan/ok')
  })
  cas('liste courte : une virgule entre guillemets ne coupe pas l’élément', () => {
    const txt = tache('C01').replace('verification:\n  - "npm test"', `verification: ["pnpm test --reporter=dot,summary", 'echo ''a, b''', npm run lint]`).replace('definition_du_fini:\n  - "le test passe"', 'definition_du_fini: [un, "deux, trois"]')
    const q = plan('court', { C01: txt })
    const r = lint(q, '--json'); assert.equal(r.code, 0, JSON.stringify(r.json))
    assert.deepEqual(r.json.taches[0].verification, ['pnpm test --reporter=dot,summary', "echo 'a, b'", 'npm run lint'])
    assert.equal(lint(q).out.trim().startsWith('✓ plan valide : 1 tâche.'), true)
  })
  cas('prérequis : tâches en attente (directes et par dépendance), phase suivante en attente, JSON et sortie texte', () => {
    const q = plan('pre', {
      P01: tache('P01', { prerequis: '[H1]' }),
      P02: tache('P02', { prerequis: '[D5, E1]' }),
      P03: tache('P03', { depend_de: '[P02]' }),
      P04: tache('P04', { phase: 2, prerequis: '[H2]' }),
    })
    writeFileSync(join(racine, q, 'PREREQUIS.md'), `# PREREQUIS — pre

| ID | Type | Prérequis | Statut | Preuve |
|----|------|-----------|--------|--------|
| D5 | décision | Choisir le fournisseur de modèles | ouvert | — |
| H1 | geste | Clé d'API dans \`.env\` | fait | confirmé par Fabien |
| E1 | environnement | Base de test \\| port 5433 | abandonné | plus utile |
| H2 | Geste | Compte de service | Ouvert | — |
`)
    const r = lint(q, '--json'); assert.equal(r.code, 0, JSON.stringify(r.json && r.json.erreurs))
    const t = id => r.json.taches.find(x => x.id === id)
    assert.deepEqual(t('P01').prerequis_ouverts, []); assert.deepEqual(t('P02').prerequis_ouverts, ['D5']); assert.deepEqual(t('P04').prerequis_ouverts, ['H2'])
    const e1 = r.json.prerequis.find(x => x.id === 'E1'); assert.equal(e1.texte, 'Base de test | port 5433'); assert.equal(e1.statut, 'abandonné')
    assert.deepEqual(r.json.prerequis.find(x => x.id === 'D5').bloque, ['P02']); assert.equal(r.json.prerequis.find(x => x.id === 'H2').type, 'geste')
    assert.deepEqual(r.json.pret[0], { phase: 1, apres_phase: null, taches: 3, en_attente: [{ id: 'P02', attend: ['D5'] }, { id: 'P03', attend: ['P02'] }] })
    assert.equal(r.json.pret[1].apres_phase, 1); assert.deepEqual(r.json.pret[1].en_attente, [{ id: 'P04', attend: ['H2'] }])
    const h = lint(q).out
    assert.ok(h.includes('Prérequis ouverts : D5 (décision) → P02 · H2 (geste) → P04'), h)
    assert.ok(h.includes('- phase 1 : P02 attend D5 ; P03 attend P02'), h)
    assert.ok(h.includes('- phase 2 : attend la fin de la phase 1 ; aucune tâche ne peut partir ; P04 attend H2'), h)
    const r1 = lint(q, '--json', '--phase', '1'); assert.equal(r1.json.pret.length, 1); assert.equal(r1.json.taches.length, 3)
  })
  cas('prérequis : identifiant inconnu, en double ou pris par une tâche, type et statut inconnus, décision faite absente de HANDOFF', () => {
    const q = plan('prek', { K01: tache('K01', { prerequis: '[D9, K02]' }), K02: tache('K02') })
    writeFileSync(join(racine, q, 'PREREQUIS.md'), `| ID | Type | Prérequis | Statut | Preuve |
|----|------|-----------|--------|--------|
| D1 | décision | a | fait | HANDOFF |
| D1 | décision | b | ouvert | — |
| K02 | geste | c | ouvert | — |
| X1 | idée | d | ouvert | — |
| X2 | geste | e | peut-être | — |
| D2 | décision | f | fait | HANDOFF |
| D3 | décision | g | fait | HANDOFF |
`)
    writeFileSync(join(racine, q, 'HANDOFF.md'), '# HANDOFF — prek\nEntrées : `décision`…\n## plan source\ndécision · majeur · D2 : option A retenue (tranchée par Fabien)\nbesoin-humain · majeur · D3 : décision à prendre par le PO\n')
    const r = lint(q, '--json'); assert.equal(r.code, 1)
    const e = r.json.erreurs.join('\n')
    for (const x of ['K01 : prérequis inconnu D9', 'prérequis D1 : identifiant en double', 'prérequis K02 : identifiant déjà pris par une tâche', 'prérequis X1 : type inconnu « idée »', 'prérequis X2 : statut inconnu « peut-être »', 'prérequis D1 : décision marquée « fait » sans entrée « décision » qui la cite dans HANDOFF.md', 'prérequis D3 : décision marquée « fait » sans entrée « décision » qui la cite dans HANDOFF.md'])
      assert.ok(e.includes(x), 'attendu : ' + x + '\n' + e)
    assert.ok(!e.includes('prérequis D2'), 'D2 est écrite dans HANDOFF.md')
  })
  cas('prérequis : sans PREREQUIS.md, une tâche qui en cite un est refusée ; sinon, simple rappel', () => {
    const q = plan('sans', { S01: tache('S01', { prerequis: '[D1]' }) })
    const r = lint(q, '--json'); assert.equal(r.code, 1); assert.ok(r.json.erreurs.includes('S01 : prérequis inconnu D1 (pas de PREREQUIS.md)'))
    const q2 = plan('sans2', { S02: tache('S02') })
    const h = lint(q2); assert.equal(h.code, 0); assert.match(h.out, /pas de PREREQUIS\.md/); assert.ok(!h.out.includes('Prêt à lancer'))
  })
  cas('prérequis : tableau non reconnu, ligne ignorée, dernière cellule sans « | », décision ouverte orpheline, geste orphelin, tâche besoin-humain', () => {
    const q = plan('orph', { O01: tache('O01', { prerequis: '[E2]' }), O02: tache('O02') }, [['O01', 'à-faire'], ['O02', 'besoin-humain']])
    writeFileSync(join(racine, q, 'PREREQUIS.md'), '| Identifiant | Quoi | État |\n|---|---|---|\n| D1 | décision | ouvert |\n')
    let r = lint(q, '--json'); assert.equal(r.code, 1)
    assert.ok(r.json.erreurs.includes('PREREQUIS.md : aucun tableau reconnu (en-têtes ID, Type, Prérequis, Statut, Preuve)'), JSON.stringify(r.json.erreurs))
    writeFileSync(join(racine, q, 'PREREQUIS.md'), '| ID | Type | Prérequis | Statut | Preuve |\n|:--|---|---|---|---|\n| d6 | décision | x | ouvert | — |\n| D7 | décision | y | ouvert | — |\n| H3 | geste | z | ouvert | — |\n| E2 | environnement | base de test | fait | `docker ps` sans barre finale\n')
    r = lint(q, '--json'); const e = r.json.erreurs.join('\n')
    assert.ok(e.includes('PREREQUIS.md : ligne ignorée, identifiant invalide « d6 »'), e)
    assert.ok(e.includes("prérequis D7 : décision ouverte qu'aucune tâche restante ne cite"), e)
    assert.ok(!e.includes('H3'), 'un geste orphelin est un avertissement, pas une erreur')
    assert.equal(r.json.prerequis.find(x => x.id === 'E2').preuve, '`docker ps` sans barre finale')
    assert.deepEqual(r.json.pret[0].en_attente, [{ id: 'O02', attend: ['besoin-humain'] }])
    writeFileSync(join(racine, q, 'PREREQUIS.md'), '| ID | Type | Prérequis | Statut | Preuve |\n|---|---|---|---|---|\n| H3 | geste | z | ouvert | — |\n| E2 | environnement | base de test | fait | ok |\n')
    const h = lint(q); assert.equal(h.code, 0, h.out)
    assert.ok(h.out.includes('⚠ prérequis H3 (geste) ouvert, mais aucune tâche restante ne le cite'), h.out)
    assert.ok(h.out.includes('- phase 1 : O02 attend besoin-humain'), h.out)
  })
  cas('erreurs : vérification, fini, dépendance inconnue ou ultérieure, cycle, doublon, fichiers partagés en parallèle', () => {
    const q = plan('ko', {
      A01: tache('A01', { verification: [], fini: [] }).replace('verification:\n\n', 'verification: []\n').replace('definition_du_fini:\n\n', 'definition_du_fini: []\n'),
      A02: tache('A02', { depend_de: '[A09]' }),
      A03: tache('A03', { depend_de: '[A04]' }), A04: tache('A04', { depend_de: '[A03]', phase: 1 }),
      A05: tache('A05', { depend_de: '[A06]' }), A06: tache('A06', { phase: 2 }),
      A07: tache('A07', { fichiers: ['src/commun/**'] }), A08: tache('A08', { fichiers: ['src/commun/x.ts'] }),
    })
    writeFileSync(join(racine, q, 'taches', 'A07-double.md'), tache('A07', { fichiers: ['src/autre/**'] }))
    const r = lint(q, '--json'); assert.equal(r.code, 1)
    const e = r.json.erreurs.join('\n')
    for (const x of ['A01 : aucune commande de vérification', 'A01 : définition du fini absente', 'A02 : dépendance inconnue A09', 'A03 : cycle de dépendances', 'A05 : dépend de A06, d\'une phase ultérieure', 'A07 : identifiant en double', 'A07 et A08 peuvent tourner ensemble et partagent des fichiers'])
      assert.ok(e.includes(x), 'attendu : ' + x + '\n' + e)
  })
  cas('ressource partagée : pas d’erreur de fichiers, les tâches seront sérialisées', () => {
    const q = plan('res', { R01: tache('R01', { fichiers: ['src/c/**'], ressources: '[base]' }), R02: tache('R02', { fichiers: ['src/c/y.ts'], ressources: '[base]' }) })
    assert.equal(lint(q, '--json').code, 0)
  })
  cas('dossier sans taches/ : arrêt clair', () => {
    mkdirSync(join(racine, 'plans', 'vide'), { recursive: true })
    const r = lint('plans/vide'); assert.equal(r.code, 2); assert.match(r.err, /dossier de tâches introuvable/)
  })
  console.log(`plan-lint : TOUT EST VERT (${n} cas)`)
} finally {
  rmSync(racine, { recursive: true, force: true })
}
