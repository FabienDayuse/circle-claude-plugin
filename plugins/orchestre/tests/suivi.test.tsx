// Tests du mod sous le moteur (`claude plugin test plugins/orchestre`) : un dépôt en mémoire, servi par les
// hooks du test sous le plugin ($.fs, $.session.cwd), et un suivi.json qui change entre deux lectures.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { bandeau, largeur, normaliser } from '../hooks/modele.mjs'
import { NB_PAS, instantDuPas, instantaneDemo } from '../hooks/demo.mjs'

const RACINE = '/depot'
const SUIVI = `${RACINE}/plans/demo/suivi.json`
const T0 = Date.parse('2026-10-08T12:00:00+02:00')

const tache = (id: string, phase: number, extra: object = {}) => ({ id, titre: `Tâche ${id}`, phase, lot: null, depend_de: [], modele: 'sonnet', statut: 'à-faire', essais: 0, branche: null, estimation_tokens: 1, tokens_reels: null, ajoutee_par: null, etape: null, isole: null, debut: null, fin: null, attend: [], refus: [], instables: [], non_verifiables: [], blocage: [], ...extra })
const doc = (taches: object[], extra: object = {}) => JSON.stringify({
  format: 'orchestre-suivi/1', plan: 'demo', dossier: 'plans/demo', integration: 'plan/demo', base: null, maj: '2026-10-08T11:59:00+02:00',
  taches, runs: [{ numero: 1, run_id: null, phase: 1, mode: 'auto', parallelisme: 2, corrections_max: 2, decisions_office_max: 3, statut: 'en-cours', debut: '2026-10-08T11:30:00+02:00', fin: null, detail: null, arbitrages_appliques: [], amendements_ecartes: [], taches_ajoutees: [], reportees: [], non_lancees: [], en_attente: [], en_attente_prerequis: [] }],
  points: [], decisions_office: [], relectures: [], prerequis: [], handoff: {}, lint: { ok: true, erreurs: [] }, journal: [], journal_omis: 0, ...extra,
})

// Ce que le moteur fait sous tout plugin : démarrer la session, dire son dossier, enregistrer une commande, dessiner.
// Sous le bandeau, un autre mod y dessine aussi : il doit rester visible.
function bas(on: On, commande: 'ok' | 'pris' = 'ok') {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('classic.SessionStart', () => ({}))
  on('session.cwd', () => ({ value: RACINE }))
  on('command.register', ($, e) => (commande === 'pris' ? { deny: `"/${e.name}" refused: another plugin registered it` } : { value: { command: e.name } }))
  on('ui.render', ($, e) => { const { Box, Text } = $.ui.resolve(e); return e.component === 'AbovePrompt' ? <Text>bandeau d'un autre mod</Text> : <Box /> })
}

// Le monde sous le plugin : un fichier suivi.json qu'on remplace, les appels d'interface notés
function monde(on: On, commande: 'ok' | 'pris' = 'ok') {
  const fichier = { texte: doc([tache('T01', 1, { etape: 'worker', isole: true, debut: '2026-10-08T11:31:00+02:00' }), tache('T02', 1), tache('T03', 2)]), mtime: 1 }
  const toasts: string[] = [], ouverts: string[] = [], remplis: string[] = []
  bas(on, commande)
  on('fs.exists', ($, e) => ({ value: e.path === `${RACINE}/plans` || e.path === SUIVI }))
  on('fs.list', () => ({ value: [{ name: 'demo', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }, { name: 'LISEZMOI.md', kind: 'file' as const, size: 3, mtimeMs: 0, isLink: false }] }))
  on('fs.stat', ($, e) => (e.path === SUIVI ? { value: { kind: 'file' as const, size: fichier.texte.length, mtimeMs: fichier.mtime, isLink: false } } : { deny: 'ENOENT' }))
  on('fs.read', ($, e) => (e.path === SUIVI ? { value: fichier.texte } : { deny: 'ENOENT' }))
  on('ui.toast', ($, e) => { toasts.push(e.text + (e.timeoutMs ? ` (${e.timeoutMs} ms)` : '')); return { value: undefined } })
  on('ui.open', ($, e) => { ouverts.push(e.id + (e.closeOnEscape ? ' (Échap ferme)' : '')); return { value: { isPlaced: true as const } } })
  on('prompt.fill', ($, e) => { remplis.push(`${e.mode}:${e.text}`); return { isFilled: true } })
  return { fichier, toasts, ouverts, remplis }
}

// La tête du bandeau pendant un run : une roue qui tourne
const ROUE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] $/

const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 9 }, view: {} } }

// Une minute d'animation à 150 ms : quelques secondes de dessins sous le kit
test('bandeau, /suivi et notifications pendant un run, sur le terminal et le bureau', { timeoutMs: 20000 }, async ($, on) => {
  const horloge = mock.clock(on, { now: T0 })
  const w = monde(on)
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestre', surface, ...BAND })
    expect(await ui.find({ text: ROUE })).toBeDefined()
    expect(await ui.find({ text: /0\/3/ })).toBeDefined()
    expect(await ui.find({ text: /◐ T01 / })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'réalisation' }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: /^█+$/ }))?.props.color).toBe('suggestion')
    expect(await ui.find({ text: /⏱ 30 min/ })).toBeDefined()
    expect(await ui.find({ text: /bandeau d'un autre mod/ })).toBeDefined()
    await ui.unmount()
  }
  // Sans écriture de suivi.json, le bandeau déjà affiché se redessine à chaque image : la roue tourne, la durée avance
  const affiche = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  // La roue tourne d'une image à l'autre, sans écriture de suivi.json
  const image = async () => String((await affiche.find({ text: ROUE }))?.children?.[0] ?? '')
  const avant = await image()
  await horloge.advance(150)
  expect(await image()).not.toBe(avant)
  await horloge.advance(60000)
  expect(await affiche.find({ text: /⏱ 31 min/ })).toBeDefined()
  await affiche.unmount()
  const texte = await $.command.run({ command: 'suivi', args: 'texte', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(texte.text ?? '').toMatch(/^▶ demo {2}◉○/)
  // T01 fusionnée, T02 attend un humain : deux notifications à la lecture suivante
  w.fichier.texte = doc([tache('T01', 1, { statut: 'fusionnée', essais: 1 }), tache('T02', 1, { statut: 'besoin-humain', blocage: ['secret'] }), tache('T03', 2)])
  w.fichier.mtime = 2
  await horloge.advance(2100)
  expect(w.toasts).toEqual(['⚑ T02 attend un humain (15000 ms)'])
})

test('panneau /suivi : onglets, bilan et brouillon de PR dans le prompt', async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = monde(on)
  w.fichier.texte = doc([tache('T01', 1, { statut: 'fusionnée', essais: 2 }), tache('T02', 1)], { relectures: [{ tache: 'T01', phase: 1, texte: '.env.example : ajouter MR_MAX', run: 1, quand: '2026-10-08T11:40:00+02:00' }], decisions_office: [{ run: 1, tache: 'T01', titre: 'Seuil', option: 'A', description: 'plafond à 30 s' }] })
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'suivi', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as never)
  expect(r.text ?? '').toMatch(/ouvert dans le panneau/)
  expect(w.ouverts).toEqual(['orchestre (Échap ferme)'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestre', surface, component: 'Pane', requestId: 'orchestre', props: { title: 'Orchestre', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    expect(await ui.find({ text: /Phase 1/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^■+$/ }))?.props.color).toBe('success')
    // L'onglet ouvert est une pastille, les autres des boutons
    expect((await ui.find({ type: 'Text', text: ' Tâches ' }))?.props.backgroundColor).toBe('claude')
    await ui.press({ key: 'onglet-relire' })
    expect((await ui.find({ type: 'Text', text: /^ À relire/ }))?.props.backgroundColor).toBe('claude')
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
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /▶/ })).toBeUndefined()
  expect(await ui.find({ text: /bandeau d'un autre mod/ })).toBeDefined()
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

// $.state tenu par le test, pour simuler /clear, /resume et /branch : toutes les valeurs reviennent à leur défaut
function etat(on: On) {
  const valeurs = new Map<string, { value: unknown; version: number }>()
  on('state.get', ($, e) => ({ value: valeurs.get(e.key) ?? { value: undefined, version: 0 } }) as never)
  on('state.set', ($, e) => {
    const avant = valeurs.get(e.key)?.version ?? 0
    if (e.ifVersion != null && e.ifVersion !== avant) return { value: { isSet: false, version: avant } } as never
    valeurs.set(e.key, { value: e.value, version: avant + 1 })
    return { value: { isSet: true, version: avant + 1 } } as never
  })
  return { effacer: () => valeurs.clear(), poser: (key: string, value: unknown) => { valeurs.set(key, { value, version: 1 }) } }
}

const FINI = doc([tache('T01', 1, { statut: 'fusionnée', essais: 1 }), tache('T02', 1, { statut: 'besoin-humain', blocage: ['secret'] })], {
  runs: [{ numero: 1, run_id: null, phase: 1, mode: 'phase', parallelisme: 2, corrections_max: 2, decisions_office_max: 3, statut: 'arbitrage', debut: '2026-10-08T11:30:00+02:00', fin: '2026-10-08T11:50:00+02:00', detail: null, arbitrages_appliques: [], amendements_ecartes: [], taches_ajoutees: [], reportees: [], non_lancees: [], en_attente: ['T02'], en_attente_prerequis: [] }],
  relectures: [{ tache: 'T01', phase: 1, texte: '.env.example : ajouter MR_MAX', run: 1, quand: '2026-10-08T11:40:00+02:00' }],
})

test('fin de run : « Masquer » sur la touche 0, place du bouton gardée, masqué encore après /clear', async ($, on) => {
  mock.clock(on, { now: T0 })
  const memoire = etat(on)
  const w = monde(on)
  w.fichier.texte = FINI
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  // La ligne complète tiendrait seule, mais pas avec le bouton : l'aide « /suivi pour le détail » part
  const pleine = largeur(bandeau(normaliser(JSON.parse(FINI))!, T0, 1000)!)
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: pleine + 5 } })
  expect(await ui.find({ text: /■ / })).toBeDefined()
  expect(await ui.find({ text: /\/suivi pour le détail/ })).toBeUndefined()
  // Ce qui demande quelqu'un, en pastille sur fond ambre
  expect((await ui.find({ type: 'Text', text: /⚠ 1 à toi/ }))?.props.backgroundColor).toBe('warning')
  const bouton = await ui.find({ key: 'masquer' })
  expect(bouton?.props.hotkey).toBe('0')
  await ui.press({ key: 'masquer' })
  await ui.unmount()
  const masque = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await masque.find({ text: /■ / })).toBeUndefined()
  expect(await masque.find({ text: /bandeau d'un autre mod/ })).toBeDefined()
  await masque.unmount()
  // /clear remet $.state à zéro sans relancer session.start : le choix revient avec classic.SessionStart
  memoire.effacer()
  await $.classic.SessionStart({ source: 'clear' } as never)
  const apres = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await apres.find({ text: /■ / })).toBeUndefined()
  await apres.unmount()
})

test('/suivi déjà pris par un autre plugin : le suivi démarre quand même et le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = monde(on, 'pris')
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: ROUE })).toBeDefined()
  await ui.unmount()
  expect(w.toasts.some(t => t.startsWith("orchestre : /suivi n'a pas pu être ajoutée"))).toBe(true)
})

test('après /clear : le plan choisi par /suivi plans/<nom> revient, et suivi.json est relu sans attendre', async ($, on) => {
  mock.clock(on, { now: T0 })
  const memoire = etat(on)
  const AUTRE = `${RACINE}/plans/autre/suivi.json`
  const fichiers: Record<string, { texte: string; mtime: number }> = {
    [SUIVI]: { texte: doc([tache('T01', 1, { etape: 'worker', isole: true })]), mtime: 2 },
    [AUTRE]: { texte: doc([tache('A01', 1, { etape: 'worker', isole: true })], { plan: 'autre', dossier: 'plans/autre' }), mtime: 1 },
  }
  bas(on)
  on('fs.exists', ($, e) => ({ value: e.path === `${RACINE}/plans` || e.path in fichiers }))
  on('fs.list', () => ({ value: ['demo', 'autre'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.stat', ($, e) => { const f = fichiers[e.path]; return f ? { value: { kind: 'file' as const, size: f.texte.length, mtimeMs: f.mtime, isLink: false } } : { deny: 'ENOENT' } })
  on('fs.read', ($, e) => { const f = fichiers[e.path]; return f ? { value: f.texte } : { deny: 'ENOENT' } })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const choix = await $.command.run({ command: 'suivi', args: 'plans/autre texte', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(choix.text ?? '').toMatch(/^▶ autre /)
  // Ce que /clear laisse : $.state à ses valeurs par défaut, le minuteur toujours là mais pas encore passé
  memoire.effacer()
  await $.classic.SessionStart({ source: 'clear' } as never)
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: ROUE })).toBeDefined()
  expect(await ui.find({ text: /^autre$/ })).toBeDefined()
  await ui.unmount()
})

test('run resté « en-cours » sans nouvelles : plus d\'animation, mais son âge avance toutes les 30 s', async ($, on) => {
  const horloge = mock.clock(on, { now: T0 })
  const w = monde(on)
  w.fichier.texte = doc([tache('T01', 1, { etape: 'worker', isole: true, debut: '2026-10-08T11:05:00+02:00' })], { maj: '2026-10-08T11:10:00+02:00' })
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^◌ $/ })).toBeDefined()
  expect(await ui.find({ text: /sans nouvelles depuis 50 min/ })).toBeDefined()
  await horloge.advance(61000)
  expect(await ui.find({ text: /sans nouvelles depuis 51 min/ })).toBeDefined()
  await ui.unmount()
})

const CMD = (args: string) => ({ command: 'suivi', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never

test('/suivi demo, sans dépôt : un run joué en mémoire, marqué DÉMO, ses notifications, puis retour au vrai suivi', { timeoutMs: 30000 }, async ($, on) => {
  const horloge = mock.clock(on, { now: T0 })
  const toasts: string[] = [], lus: string[] = []
  bas(on)
  on('fs.exists', ($, e) => { lus.push(e.path); return { value: false } })
  on('ui.toast', ($, e) => { toasts.push(e.text + (e.timeoutMs ? ` (${e.timeoutMs} ms)` : '')); return { value: undefined } })
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const r = await $.command.run(CMD('demo'))
  expect(r.text ?? '').toMatch(/^Démo lancée/)
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: ' DÉMO ' }))?.props.backgroundColor).toBe('merged')
  expect(await ui.find({ text: /^site-vitrine$/ })).toBeDefined()
  expect(await ui.find({ text: ROUE })).toBeDefined()
  expect((await $.command.run(CMD('texte'))).text ?? '').toMatch(/^▶  DÉMO  site-vitrine/)
  // Pendant la démo, aucun suivi.json n'est cherché
  const avant = lus.length
  await horloge.advance(instantDuPas(NB_PAS - 1, 0) + 500)
  expect(lus.length).toBe(avant)
  expect(await ui.find({ text: /^✓ $/ })).toBeDefined()
  expect(toasts).toContain('⚑ T03 attend un humain (15000 ms)')
  expect(toasts).toContain('Run arrêté : T03, Clé SMTP de test (15000 ms)')
  expect(toasts).toContain('Phase 1 terminée')
  expect(toasts).toContain('Run 2 (phases 1 à 2) : terminé')
  expect(toasts.at(-1) ?? '').toMatch(/^Démo terminée/)
  await ui.unmount()
  // Une minute après la fin, le vrai suivi reprend : ici, rien à suivre
  await horloge.advance(60000)
  expect(lus.length).toBeGreaterThan(avant)
  const apres = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await apres.find({ type: 'Text', text: ' DÉMO ' })).toBeUndefined()
  await apres.unmount()
})

test('/suivi demo dans un dépôt suivi : le vrai plan attend, /suivi auto y revient', async ($, on) => {
  const horloge = mock.clock(on, { now: T0 })
  const w = monde(on)
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  await $.command.run(CMD('demo'))
  // suivi.json change pendant la démo : rien n'est lu, aucune notification du vrai plan
  w.fichier.texte = doc([tache('T01', 1, { statut: 'fusionnée', essais: 1 }), tache('T02', 1, { statut: 'besoin-humain', blocage: ['secret'] }), tache('T03', 2)])
  w.fichier.mtime = 2
  await horloge.advance(2100)
  expect(w.toasts.some(t => t.includes('T02 attend'))).toBe(false)
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^site-vitrine$/ })).toBeDefined()
  await ui.unmount()
  expect((await $.command.run(CMD('auto texte'))).text ?? '').toMatch(/^▶ demo {2}/)
  const vrai = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await vrai.find({ type: 'Text', text: ' DÉMO ' })).toBeUndefined()
  expect(await vrai.find({ text: /^demo$/ })).toBeDefined()
  await vrai.unmount()
})

test('« Masquer » pendant la démo ne masque pas le vrai run de même numéro', async ($, on) => {
  const horloge = mock.clock(on, { now: T0 })
  const w = monde(on)
  w.fichier.texte = FINI
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  await $.command.run(CMD('demo'))
  // Le run 1 de la démo s'arrête sur son arbitrage : on le masque
  await horloge.advance(instantDuPas(11, 0) + 100)
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^site-vitrine$/ })).toBeDefined()
  await ui.press({ key: 'masquer' })
  await ui.unmount()
  await $.command.run(CMD('auto'))
  const vrai = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await vrai.find({ text: /^■ $/ })).toBeDefined()
  expect(await vrai.find({ text: /^demo$/ })).toBeDefined()
  await vrai.unmount()
})

test('rechargement du mod en pleine démo, sans rien à suivre : la démo figée s\'efface', async ($, on) => {
  mock.clock(on, { now: T0 })
  const memoire = etat(on)
  bas(on)
  on('fs.exists', () => ({ value: false }))
  // Ce que $.state garde d'avant le rechargement : la dernière image de la démo
  memoire.poser('instantane', instantaneDemo(5, T0 - 20000))
  await $.session.start({ cwd: RACINE, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'orchestre', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: ' DÉMO ' })).toBeUndefined()
  await ui.unmount()
})
