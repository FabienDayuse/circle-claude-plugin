#!/usr/bin/env node
// État d'avancement d'un plan orchestre (plugin orchestre v0.6.3), en Markdown compact, pour /orchestre:etat.
// Lecture seule, sûr pendant un run : aucun switch, aucune écriture, git sans verrou optionnel (GIT_OPTIONAL_LOCKS=0).
// Usage : node <racine du plugin>/scripts/etat.mjs [<dossier-plan>]
// Sans dossier, prend le seul plan de plans/. Sort toujours avec le code 0 : une commande injectée dans une skill
// qui échoue annulerait la skill ; une erreur s'affiche donc en une ligne « orchestre:etat : … ».
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, basename, dirname, relative } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
const LINT = join(dirname(fileURLToPath(import.meta.url)), 'plan-lint.mjs')
const essai = f => { try { return f() } catch { return null } }
const git = (args, cwd) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`
const barre = (r, n) => { const k = Math.floor(r * n); return '█'.repeat(k) + '░'.repeat(n - k) }
const pct = (f, n) => Math.floor((100 * f) / n)
const depuis = ts => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`
}
const court = (xs, max) => (xs.length > max ? [...xs.slice(0, max - 1), `+${xs.length - max + 1}`] : xs)

function etat() {
  const racine = essai(() => git(['rev-parse', '--show-toplevel'], process.cwd()).trim())
  if (!racine) return 'orchestre:etat : pas dans un dépôt git'

  // Plan : l'argument, relatif au dossier courant puis à la racine ; sinon le seul plan de plans/
  const arg = process.argv.slice(2).find(a => !a.startsWith('--'))
  let dir
  if (arg) {
    dir = [resolve(arg), resolve(racine, arg)].find(d => existsSync(join(d, 'taches')))
    if (!dir) return `orchestre:etat : plan introuvable dans ce checkout : ${arg}`
  } else {
    const p = join(racine, 'plans')
    const plans = existsSync(p) ? readdirSync(p).filter(n => existsSync(join(p, n, 'taches'))).sort() : []
    if (!plans.length) return 'orchestre:etat : aucun plan dans plans/ ; précise son dossier : /orchestre:etat plans/<nom>'
    if (plans.length > 1) return `orchestre:etat : plusieurs plans (${plans.map(n => 'plans/' + n).join(', ')}) ; précise lequel : /orchestre:etat plans/${plans[0]}`
    dir = join(p, plans[0])
  }
  const nom = basename(dir)
  const cfg = essai(() => JSON.parse(readFileSync(join(dir, 'orchestre.config.json'), 'utf8'))) || {}
  const integ = cfg.branche_integration || `plan/${nom}`
  const baseCfg = cfg.branche_base || null
  // Un nom de branche qui commence par « - » serait lu par git comme une option
  if ([integ, baseCfg].some(b => b && String(b).startsWith('-'))) return 'orchestre:etat : branche invalide dans orchestre.config.json'

  // plan-lint fait foi pour les tâches, leurs statuts (git compris) et les prérequis
  const r = spawnSync(process.execPath, [LINT, relative(racine, dir) || '.', '--json', '--integration', integ, ...(baseCfg ? ['--base', baseCfg] : [])], { cwd: racine, env: ENV, encoding: 'utf8' })
  const L = essai(() => JSON.parse(r.stdout))
  if (!L) return `orchestre:etat : plan-lint n'a pas rendu d'état (${String(r.stderr || r.stdout || 'sans message').trim().split('\n')[0]})`
  const actives = (L.taches || []).filter(t => t.statut !== 'annulée')
  if (!actives.length) return `orchestre:etat : aucune tâche dans ${relative(racine, dir)}`
  const fait = t => t.statut === 'fusionnée'
  const ATTENTION = { 'besoin-humain': 'attend un humain', bloquée: 'bloquée', échec: 'en échec' }

  // Tâches commencées : une branche tache/<id> (ou tache/<id>-r<n>) existe, la tâche n'est ni fusionnée ni en attente
  const refs = (essai(() => git(['for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads/tache/'], racine)) || '')
    .split('\n').filter(Boolean).map(l => { const [ref, ts] = l.split('\t'); return { ref, ts: Number(ts), id: ref.replace(/^tache\//, '').replace(/-r\d+$/, '') } })
  const tete = essai(() => git(['symbolic-ref', '-q', '--short', 'HEAD'], racine).trim()) || ''
  // Le premier worktree listé est le checkout principal
  const worktrees = new Set((essai(() => git(['worktree', 'list', '--porcelain'], racine)) || '').split(/\n\s*\n/).slice(1).map(b => (b.match(/^branch refs\/heads\/(.+)$/m) || [])[1]).filter(Boolean))
  const enCours = []
  for (const t of actives) {
    if (fait(t) || ATTENTION[t.statut]) continue
    const b = refs.filter(x => x.id === t.id).sort((x, y) => y.ts - x.ts)[0]
    if (!b) continue
    const avance = Number(essai(() => git(['rev-list', '--count', `${integ}..${b.ref}`], racine).trim()) || 0)
    const ou = b.ref === tete ? 'checkout' : worktrees.has(b.ref) ? 'worktree' : null
    enCours.push({ id: t.id, texte: `${t.id} (${[ou, avance ? `dernier commit ${depuis(b.ts)}` : 'démarrée'].filter(Boolean).join(', ')})` })
  }

  // Dernière fusion sur la branche d'intégration, hors fusions d'un plan précédent déjà dans la base
  const existe = b => essai(() => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], racine)) != null
  const base = baseCfg || ['main', 'master'].find(existe)
  const log = essai(() => git(['log', '--format=%ct%x09%s', base && base !== integ ? `${base}..${integ}` : integ, '--'], racine)) || ''
  const fusion = log.split('\n').map(l => l.split('\t')).find(([, s]) => /^tâche \S+ :/.test(s || ''))

  // Ce qui attend l'utilisateur
  const aToi = []
  for (const p of (L.prerequis || []).filter(x => x.statut === 'ouvert' && (x.bloque || []).length)) aToi.push(`${p.id} (${p.type}) bloque ${court(p.bloque, 4).join(', ')}`)
  for (const [st, quoi] of Object.entries(ATTENTION)) for (const t of actives.filter(x => x.statut === st)) aToi.push(`${t.id} ${quoi}`)
  const handoff = essai(() => readFileSync(join(dir, 'HANDOFF.md'), 'utf8')) || ''
  const nb = type => (handoff.match(new RegExp(`^\\s*(?:[-*]\\s*)?${type}\\s*·`, 'gim')) || []).length
  const rel = nb('relecture'), tic = nb('ticket')
  if (rel) aToi.push(`${pluriel(rel, 'relecture')} avant la PR`)
  if (tic) aToi.push(`${pluriel(tic, 'ticket')} après la PR`)
  if (!L.ok) aToi.push(`plan-lint : ${pluriel((L.erreurs || []).length, 'erreur')}`)

  // Rendu
  const phases = [...new Set(actives.map(t => t.phase))].sort((a, b) => a - b)
  const commencee = ph => actives.some(t => t.phase === ph && (fait(t) || enCours.some(e => e.id === t.id)))
  const courante = phases.find(ph => actives.some(t => t.phase === ph && !fait(t)))
  const faites = actives.filter(fait).length
  const out = [
    `## ${nom} — ${faites}/${pluriel(actives.length, 'tâche')} · ${pct(faites, actives.length)} %`,
    `\`${barre(faites / actives.length, 24)}\` ${courante == null ? 'plan terminé' : `phase ${courante} ${commencee(courante) ? 'en cours' : 'à lancer'}`}${fusion ? ` · dernière fusion ${fusion[1].match(/^tâche (\S+) :/)[1]} ${depuis(Number(fusion[0]))}` : ''}`,
    '',
    '| Phase | Avancement | Tâches |',
    '| :-- | :-- | :-- |',
  ]
  for (const ph of phases) {
    const ts = actives.filter(t => t.phase === ph), f = ts.filter(fait).length
    const sym = f === ts.length ? '✓' : ts.some(t => ATTENTION[t.statut]) ? '⚠' : commencee(ph) ? '●' : '○'
    out.push(`| ${sym} ${ph} | \`${barre(f / ts.length, 10)}\` ${pct(f, ts.length)} % | ${f}/${ts.length} |`)
  }
  if (enCours.length) out.push('', `**En cours** : ${court(enCours.map(e => e.texte), 5).join(' · ')}`)
  out.push('', `**À toi** : ${aToi.length ? court(aToi, 6).join(' · ') : "rien pour l'instant"}`)
  return out.join('\n')
}

let texte
try { texte = etat() } catch (e) { texte = `orchestre:etat : ${String((e && e.message) || e).split('\n')[0]}` }
console.log(texte)
process.exit(0)
