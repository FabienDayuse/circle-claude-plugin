// Le mod du plugin orchestre : suit un run dans la session pilote, en lecture seule.
// Il lit plans/<nom>/suivi.json (orchestre-suivi/1), que seul scripts/suivi.mjs d'orchestre écrit, et dessine :
//   - un bandeau au-dessus du prompt pendant un run (phase, avancement, en cours, à relire, durée) ;
//   - un suffixe au spinner (tâche et étape en cours) ;
//   - /suivi : un panneau à onglets (Tâches, À relire, Journal, Bilan), ou le même état en texte ;
//   - une notification quand un run part ou s'arrête, qu'une phase finit, qu'une tâche attend un humain,
//     est bloquée ou en échec, qu'une relecture ou un point d'arrêt arrive.
// Il n'écrit jamais dans le dépôt : ses seules écritures sont dans $.state (affichage) et le prompt (« Préparer la PR »).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Instantane, Ligne, Onglet } from '../types'
import { NB_PAS, PAS_DEMO_MS, PLAN_DEMO, finDemo, instantaneDemo, pasA } from './demo.mjs'
import { DUREE_IMPORTANTE_MS, FORMAT, IMAGE_MS, bandeau, changements, formatDe, importante, lignesBilan, lignesJournal, lignesRelire, lignesTaches, normaliser, nouvelle, runActif, runEnCours, suffixe, texteEtat, textePR } from './modele.mjs'

const PANNEAU = 'orchestre'
const RELIRE_MS = 2000
// Un run interrompu (« sans nouvelles ») ne s'anime plus : son âge avance toutes les 30 s
const LENT_MS = 30000
const instantane = atom({ plugin: 'orchestre', key: 'instantane' } as const, null)
const planSuivi = atom({ plugin: 'orchestre', key: 'plan' } as const, null)
const lu = atom({ plugin: 'orchestre', key: 'lu' } as const, 0)
const onglet = atom({ plugin: 'orchestre', key: 'onglet' } as const, 'taches')
const masque = atom({ plugin: 'orchestre', key: 'masque' } as const, null)
const alerte = atom({ plugin: 'orchestre', key: 'alerte' } as const, null)

// Place du bouton « Masquer » (« 0: Masquer ») à la suite du bandeau
const RESERVE_MASQUER = 12

// /clear, /resume et /branch remettent $.state à ses valeurs par défaut sans relancer session.start : les deux choix de
// la personne y sont gardés aussi, pour les rétablir (classic.SessionStart). Un rechargement du module, lui, garde $.state.
let planChoisi: string | null = null
let masqueChoisi: number | null = null

const parent = (p: string) => p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'

// Le dossier plans/ du dépôt : celui du dossier de la session, sinon d'un dossier parent (4 au plus)
async function racine($: EngineInterface): Promise<string | null> {
  let dir = await $.session.cwd()
  for (let i = 0; i < 5; i++) {
    if (await $.fs.exists(`${dir}/plans`).catch(() => false)) return dir
    const haut = parent(dir)
    if (haut === dir) break
    dir = haut
  }
  return null
}

// Le plan à suivre : celui que /suivi plans/<nom> a choisi, s'il a un suivi.json ; sinon le suivi.json écrit en dernier,
// celui du run en cours puisque le workflow l'écrit à chaque transition. Rien n'est lu ici : une liste et des stat.
async function trouverPlan($: EngineInterface, base: string): Promise<string | null> {
  const choisi = await read($, planSuivi)
  if (choisi && (await $.fs.exists(`${base}/${choisi}/suivi.json`).catch(() => false))) return choisi
  const entrees = await $.fs.list(`${base}/plans`).catch(() => [])
  let meilleur: { plan: string; mtime: number } | null = null
  for (const d of entrees.filter(x => x.kind === 'dir').slice(0, 50)) {
    const st = await $.fs.stat(`${base}/plans/${d.name}/suivi.json`).catch(() => null)
    if (st && (!meilleur || st.mtimeMs > meilleur.mtime)) meilleur = { plan: `plans/${d.name}`, mtime: st.mtimeMs }
  }
  return meilleur?.plan ?? null
}

async function lireJson($: EngineInterface, chemin: string): Promise<unknown> {
  try {
    const t = await $.fs.read(chemin)
    return typeof t === 'string' ? JSON.parse(t) : null
  } catch {
    return null // absent, trop gros ou en cours de renommage : on garde l'affichage précédent
  }
}

// Relit suivi.json s'il a changé (ou si c'est un autre fichier), met l'instantané à jour et notifie ce qui le mérite.
// Pendant la démo, rien n'est lu. Une démo restée affichée après un rechargement du mod s'efface s'il n'y a rien à suivre.
let dernierFichier: string | null = null
async function rafraichir($: EngineInterface, force: boolean): Promise<void> {
  if (demo) return
  const base = await racine($)
  if (!base) return oublierDemo($)
  const plan = await trouverPlan($, base)
  if (!plan) return oublierDemo($)
  const f = `${base}/${plan}/suivi.json`
  const st = await $.fs.stat(f).catch(() => null)
  if (!st) return oublierDemo($)
  if (!force && f === dernierFichier && st.mtimeMs === (await read($, lu))) return
  const doc = await lireJson($, f)
  if (doc === null) return
  dernierFichier = f
  await update($, lu, () => st.mtimeMs)
  if (formatDe(doc) !== FORMAT) {
    const format = formatDe(doc) ?? 'inconnu'
    if ((await read($, alerte)) !== format) {
      await update($, alerte, () => format)
      $.ui.toast(`${plan}/suivi.json est au format ${format} ; ce mod lit ${FORMAT}. Mets à jour le plugin orchestre.`, { timeoutMs: DUREE_IMPORTANTE_MS })
    }
    return
  }
  const apres = normaliser(doc)
  if (!apres) return
  const avant = await read($, instantane)
  await update($, instantane, () => apres)
  for (const message of changements(avant, apres)) $.ui.toast(message, importante(message) ? { timeoutMs: DUREE_IMPORTANTE_MS } : undefined)
}

async function oublierDemo($: EngineInterface): Promise<void> {
  if ((await read($, instantane))?.demo) await update($, instantane, () => null)
}

// Le mode démo (/suivi demo) : un run joué en mémoire, pas à pas, avec ses notifications ; la dernière image reste une
// minute, puis le vrai suivi reprend. Le « Masquer » d'un run de la démo ne vaut pas pour les vrais runs.
let demo: { debut: number; pas: number; vu: number; fini: boolean } | null = null
async function lancerDemo($: EngineInterface): Promise<void> {
  demo = { debut: await $.clock.now(), pas: PAS_DEMO_MS, vu: -1, fini: false }
  masqueChoisi = null
  await update($, masque, () => null)
  await avancerDemo($)
}
async function avancerDemo($: EngineInterface): Promise<void> {
  if (!demo) return
  const maintenant = await $.clock.now()
  if (maintenant >= finDemo(demo.debut, demo.pas)) return quitterDemo($)
  const k = Math.max(0, pasA(maintenant, demo.debut, demo.pas))
  const avant = await read($, instantane)
  // Après /clear, l'image courante revient sans notification
  if (k === demo.vu && avant?.demo) return
  const suite = demo.vu >= 0 && !!avant?.demo
  demo.vu = k
  const apres = instantaneDemo(k, demo.debut, demo.pas)
  await update($, instantane, () => apres)
  if (suite) for (const message of changements(avant, apres)) $.ui.toast(message, importante(message) ? { timeoutMs: DUREE_IMPORTANTE_MS } : undefined)
  if (k === NB_PAS - 1 && !demo.fini) {
    demo.fini = true
    $.ui.toast('Démo terminée. Le vrai suivi reprend dans une minute ; /suivi auto pour tout de suite.', { timeoutMs: DUREE_IMPORTANTE_MS })
  }
}
async function quitterDemo($: EngineInterface): Promise<void> {
  if (!demo) return
  demo = null
  masqueChoisi = null
  await update($, masque, () => null)
  await update($, instantane, () => null)
  await update($, lu, () => 0)
  dernierFichier = null
  await rafraichir($, true).catch(() => undefined)
}

// On ne suit que là où quelque chose se dessine : le terminal (REPL), ou une session que l'app de bureau héberge,
// qui démarre sans surface et en reçoit une à la connexion de l'app (session.attach). Un `claude -p` ne lit rien.
let demarre = false
async function demarrer($: EngineInterface): Promise<void> {
  if (demarre) return
  demarre = true
  await rafraichir($, true).catch(() => undefined)
  $.clock.every(RELIRE_MS, () => { void rafraichir($, false).catch(() => undefined) })
  $.clock.every(IMAGE_MS, () => { void animer($).catch(() => undefined) })
  // En dernier : un nom déjà pris fait échouer l'enregistrement, et le suivi doit tourner quand même
  try {
    await $.command.register({ name: 'suivi', description: 'Suivi du plan orchestre : tâches, relectures, journal, bilan', argumentHint: '[plans/<nom> | auto | demo] [texte]', immediate: true })
  } catch (err) {
    $.ui.toast(`orchestre : /suivi n'a pas pu être ajoutée (${err instanceof Error ? err.message : String(err)}). Le bandeau et les notifications restent actifs.`, { timeoutMs: DUREE_IMPORTANTE_MS })
  }
}

// Les animations : pendant un run actif, et tant qu'une nouvelle a moins de 10 s, tout est redessiné à chaque image
// (spinner, barre qui pulse, chronos, nouvelle qui s'estompe). Un run sans nouvelles ne bouge plus : toutes les 30 s.
let dernierRedessin = 0
async function animer($: EngineInterface): Promise<void> {
  if (demo) await avancerDemo($)
  const inst = await read($, instantane)
  if (!inst) return
  const maintenant = await $.clock.now()
  const vif = !!runActif(inst, maintenant) || !!nouvelle(inst, maintenant)
  if (!vif && !(runEnCours(inst) && maintenant - dernierRedessin >= LENT_MS)) return
  dernierRedessin = maintenant
  $.ui.invalidate('ui.render')
}

// Après /clear, /resume ou /branch : les choix de la personne reviennent, et suivi.json est relu tout de suite
async function retablir($: EngineInterface): Promise<void> {
  if (planChoisi) await update($, planSuivi, () => planChoisi)
  if (masqueChoisi != null) await update($, masque, () => masqueChoisi)
  await rafraichir($, true).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if (e.isInteractive || e.surface !== null) await demarrer($)
    return r
  })

  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    await demarrer($)
    return r
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const r = await next(e)
    if (demarre) await retablir($)
    return r
  })

  // /suivi répond tout de suite, même pendant un tour : le panneau, ou l'état en texte
  on('command.run', { command: 'suivi' }, async ($, e) => {
    const mots = e.args.trim().split(/\s+/).filter(Boolean)
    if (mots.includes('demo') || mots.includes('démo')) {
      await lancerDemo($)
      return { text: `Démo lancée : le run d'un plan fictif, ${PLAN_DEMO} (5 tâches, 2 phases), joué en un peu plus d'une minute dans le bandeau et les notifications, marqué DÉMO. /suivi ouvre le panneau ; /suivi auto revient au vrai suivi.` }
    }
    const plan = mots.find(m => m.startsWith('plans/'))
    if (plan) {
      planChoisi = plan.replace(/\/+$/, '')
      await update($, planSuivi, () => planChoisi)
    }
    if (mots.includes('auto')) {
      planChoisi = null
      await update($, planSuivi, () => null)
    }
    if (plan || mots.includes('auto')) await quitterDemo($)
    await rafraichir($, true).catch(() => undefined)
    const inst = await read($, instantane)
    if (!inst) return { text: 'orchestre : aucun plans/<nom>/suivi.json dans ce dépôt. Il apparaît au premier run d\'orchestre 0.8 ou plus. Pour voir le mod à l\'œuvre : /suivi demo.' }
    const maintenant = await $.clock.now()
    if (mots.includes('texte')) return { text: texteEtat(inst, maintenant) }
    const ouvert = await $.ui.open({ id: PANNEAU, title: `Orchestre · ${inst.plan}${inst.demo ? ' (démo)' : ''}`, focus: true, closeOnEscape: true }).catch(() => null)
    return ouvert?.isPlaced ? { text: `Suivi de ${inst.plan} ouvert dans le panneau.` } : { text: texteEtat(inst, maintenant) }
  })

  // Le bandeau : pendant un run, puis l'état de fin jusqu'à ce qu'on le masque ou qu'un run reparte. La bande est partagée :
  // ce que dessinent les mods suivants (next) reste dessous. « Masquer » a la touche 0, qui marche aussi tapée seule dans
  // un prompt vide, sans donner le focus au bandeau.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inst = await read($, instantane)
    if (!inst || !inst.run || e.props.hasSurvey) return next(e)
    const fini = inst.run.statut !== 'en-cours'
    if (fini && (await read($, masque)) === inst.run.numero) return next(e)
    const ligne = bandeau(inst, await $.clock.now(), e.props.bodyColumns, fini ? RESERVE_MASQUER : 0, true)
    if (!ligne) return next(e)
    const autres = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const numero = inst.run.numero
    return (
      <Box flexDirection="column">
        <Box key="orchestre" flexDirection="row">
          {dessiner($, e, ligne, 'bandeau')}
          {fini && <Text> </Text>}
          {fini && <Button key="masquer" label="Masquer" hotkey="0" plain onPress={() => { masqueChoisi = numero; return update($, masque, () => numero) }} />}
        </Box>
        {autres}
      </Box>
    )
  })

  // Le spinner : la tâche et l'étape en cours, et le nombre de tâches qui tournent
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const inst = await read($, instantane)
    const s = inst ? suffixe(inst, await $.clock.now()) : null
    return s ? next({ ...e, props: { ...e.props, suffix: s } }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const inst = await read($, instantane)
    if (!inst) return <Text dimColor>Aucun suivi.json lu pour l'instant.</Text>
    const actif: Onglet = await read($, onglet)
    const maintenant = await $.clock.now()
    const colonnes = e.props.bodyColumns
    const lignes: Ligne[] =
      actif === 'relire' ? lignesRelire(inst, maintenant, colonnes)
      : actif === 'journal' ? lignesJournal(inst, maintenant, colonnes)
      : actif === 'bilan' ? lignesBilan(inst, maintenant)
      : lignesTaches(inst, maintenant, colonnes, true)
    // L'onglet ouvert est une pastille ; les autres, des boutons avec leur touche
    const ongletBouton = (id: Onglet, libelle: string, touche: string) => (id === actif
      ? <Text key={`onglet-${id}`} color="inverseText" backgroundColor="claude" bold>{` ${libelle} `}</Text>
      : <Button key={`onglet-${id}`} label={libelle} hotkey={touche} plain onPress={() => update($, onglet, () => id)} />
    )
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {ongletBouton('taches', 'Tâches', 't')}
          <Text> </Text>
          {ongletBouton('relire', `À relire (${inst.relectures.length})`, 'r')}
          <Text> </Text>
          {ongletBouton('journal', 'Journal', 'j')}
          <Text> </Text>
          {ongletBouton('bilan', 'Bilan', 'b')}
        </Box>
        <Text> </Text>
        {lignes.map((l, i) => dessiner($, e, l, `l${i}`))}
        {actif === 'bilan' && (
          <Box flexDirection="row">
            <Text> </Text>
            <Button key="pr" label="Préparer la PR dans le prompt" hotkey="p" onPress={() => preparerPR($, inst)} />
          </Box>
        )}
      </Box>
    )
  })
}

async function preparerPR($: EngineInterface, inst: Instantane): Promise<void> {
  // Ajouté après ce qui est déjà tapé, jamais à sa place
  const fait = await $.prompt.fill({ text: textePR(inst, await $.clock.now()), mode: 'append' })
  $.ui.toast(fait.isFilled ? 'Brouillon de PR dans le prompt : relis-le, rien n\'est envoyé.' : 'Le prompt n\'a pas pris le brouillon de PR.')
}

// Une ligne de morceaux : un Text par morceau, dans une rangée
function dessiner($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], ligne: Ligne, cle: string) {
  const { Box, Text } = $.ui.resolve(e)
  if (!ligne.length) return <Text key={cle}> </Text>
  return (
    <Box key={cle} flexDirection="row">
      {ligne.map((m, i) => (
        <Text key={`${cle}-${i}`} color={m.c} backgroundColor={m.f} bold={m.b} dimColor={m.d} wrap="truncate">{m.t}</Text>
      ))}
    </Box>
  )
}
