// Tests du mod sous le moteur (`claude plugin test plugins/orchestre-suivi`) : un dépôt en mémoire, servi par les
// hooks du test sous le plugin ($.fs, $.session.cwd), et un suivi.json qui change entre deux lectures.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RACINE = '/depot'
const SUIVI = `${RACINE}/plans/demo/suivi.json`
const T0 = Date.parse('2026-10-08T12:00:00+02:00')

const tache = (id: string, phase: number, extra: object = {}) => ({ id, titre: `Tâche ${id}`, phase, lot: null, depend_de: [], modele: 'sonnet', statut: 'à-faire', essais: 0, branche: null, estimation_tokens: 1, tokens_reels: null, ajoutee_par: null, etape: null, isole: null, debut: null, fin: null, attend: [], refus: [], instables: [], non_verifiables: [], blocage: [], ...extra })
const doc = (taches: object[], extra: object = {}) => JSON.stringify({
  format: 'orchestre-suivi/1', plan: 'demo', dossier: 'plans/demo', integration: 'plan/demo', base: null, maj: '2026-10-08T11:59:00+02:00',
  taches, runs: [{ numero: 1, run_id: null, phase: 1, mode: 'auto', parallelisme: 2, corrections_max: 2, decisions_office_max: 3, statut: 'en-cours', debut: '2026-10-08T11:30:00+02:00', fin: null, detail: null, arbitrages_appliques: [], amendements_ecartes: [], taches_ajoutees: [], reportees: [], non_lancees: [], en_attente: [], en_attente_prerequis: [] }],
  points: [], decisions_office: [], relectures: [], prerequis: [], handoff: {}, lint: { ok: true, erreurs: [] }, journal: [], journal_omis: 0, ...extra,
})

// Ce que le moteur fait sous tout plugin : démarrer la session, dire son dossier, enregistrer une commande, dessiner
function bas(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('session.cwd', () => ({ value: RACINE }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
}

// Le monde sous le plugin : un fichier suivi.json qu'on remplace, les appels d'interface notés
function monde(on: On) {
  const fichier = { texte: doc([tache('T01', 1, { etape: 'worker', isole: true, debut: '2026-10-08T11:31:00+02:00' }), tache('T02', 1), tache('T03', 2)]), mtime: 1 }
  const toasts: string[] = [], ouverts: string[] = [], remplis: string[] = []
  bas(on)
  on('fs.exists', ($, e) => ({ value: e.path === `${RACINE}/plans` || e.path === SUIVI }))
  on('fs.list', () => ({ value: [{ name: 'demo', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }, { name: 'LISEZMOI.md', kind: 'file' as const, size: 3, mtimeMs: 0, isLink: false }] }))
  on('fs.stat', ($, e) => (e.path === SUIVI ? { value: { kind: 'file' as const, size: fichier.texte.length, mtimeMs: fichier.mtime, isLink: false } } : { deny: 'ENOENT' }))
  on('fs.read', ($, e) => (e.path === SUIVI ? { value: fichier.texte } : { deny: 'ENOENT' }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.open', ($, e) => { ouverts.push(e.id); return { value: { isPlaced: true as const } } })
  on('prompt.fill', ($, e) => { remplis.push(`${e.mode}:${e.text}`); return { isFilled: true } })
  return { fichier, toasts, ouverts, remplis }
}

const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 9 }, view: {} } }

test('bandeau, /suivi et notifications pendant un run, sur le terminal et le bureau', async ($, on) => {
  const horloge = mock.clock(on, { now: T0 })
  const w = monde(on)
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestre-suivi', surface, ...BAND })
    expect(await ui.find({ text: /▶ / })).toBeDefined()
    expect(await ui.find({ text: /0\/3/ })).toBeDefined()
    expect(await ui.find({ text: /◐ 1 en cours/ })).toBeDefined()
    expect(await ui.find({ text: /⏱ 30 min/ })).toBeDefined()
    await ui.unmount()
  }
  // Dix minutes sans écriture de suivi.json : le bandeau déjà affiché se redessine (toutes les 30 s), la durée avance
  const affiche = await $.ui.mount({ plugin: 'orchestre-suivi', surface: 'terminal', ...BAND })
  await horloge.advance(10 * 60000)
  expect(await affiche.find({ text: /⏱ (39|40) min/ })).toBeDefined()
  await affiche.unmount()
  const texte = await $.command.run({ command: 'suivi', args: 'texte', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(texte.text ?? '').toMatch(/^▶ demo {2}phase 1\/2/)
  // T01 fusionnée, T02 attend un humain : deux notifications à la lecture suivante
  w.fichier.texte = doc([tache('T01', 1, { statut: 'fusionnée', essais: 1 }), tache('T02', 1, { statut: 'besoin-humain', blocage: ['secret'] }), tache('T03', 2)])
  w.fichier.mtime = 2
  await horloge.advance(2100)
  expect(w.toasts).toEqual(['⚑ T02 attend un humain'])
})

test('panneau /suivi : onglets, bilan et brouillon de PR dans le prompt', async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = monde(on)
  w.fichier.texte = doc([tache('T01', 1, { statut: 'fusionnée', essais: 2 }), tache('T02', 1)], { relectures: [{ tache: 'T01', phase: 1, texte: '.env.example : ajouter MR_MAX', run: 1, quand: '2026-10-08T11:40:00+02:00' }], decisions_office: [{ run: 1, tache: 'T01', titre: 'Seuil', option: 'A', description: 'plafond à 30 s' }] })
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'suivi', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as never)
  expect(r.text ?? '').toMatch(/ouvert dans le panneau/)
  expect(w.ouverts).toEqual(['orchestre-suivi'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestre-suivi', surface, component: 'Pane', requestId: 'orchestre-suivi', props: { title: 'Orchestre', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    expect(await ui.find({ text: /Phase 1/ })).toBeDefined()
    await ui.press({ key: 'onglet-relire' })
    expect(await ui.find({ text: /\.env\.example : ajouter MR_MAX/ })).toBeDefined()
    await ui.press({ key: 'onglet-bilan' })
    expect(await ui.find({ text: /1 décision prise d'office/ })).toBeDefined()
    await ui.press({ key: 'pr' })
    await ui.press({ key: 'onglet-taches' })
    await ui.unmount()
  }
  expect(w.remplis.length).toBe(2)
  expect(w.remplis[0] ?? '').toMatch(/^append:[\s\S]*- T01 : \.env\.example : ajouter MR_MAX/)
})

test('rien à suivre : pas de bandeau, /suivi le dit ; une session hébergée attend sa surface, un -p ne lit rien', async ($, on) => {
  mock.clock(on, { now: T0 })
  const lus: string[] = []
  bas(on)
  on('fs.exists', ($, e) => { lus.push(e.path); return { value: false } })
  on('fs.read', ($, e) => { lus.push(e.path); return { deny: 'ENOENT' } })
  await $.session.start({ cwd: RACINE, surface: null, isInteractive: false })
  expect(lus).toEqual([])
  // L'app de bureau héberge la session sans surface au démarrage, puis s'y connecte
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(lus.length).toBeGreaterThan(0)
  const ui = await $.ui.mount({ plugin: 'orchestre-suivi', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /▶/ })).toBeUndefined()
  await ui.unmount()
  const r = await $.command.run({ command: 'suivi', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(r.text ?? '').toMatch(/aucun plans\/<nom>\/suivi\.json/)
})

test('une session de bureau non interactive au démarrage est suivie', async ($, on) => {
  mock.clock(on, { now: T0 })
  const lus: string[] = []
  bas(on)
  on('fs.exists', ($, e) => { lus.push(e.path); return { value: false } })
  await $.session.start({ cwd: RACINE, surface: 'desktop', isInteractive: false })
  expect(lus.length).toBeGreaterThan(0)
})
