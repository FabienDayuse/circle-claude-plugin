#!/usr/bin/env node
// worktrees (plugin orchestre 0.8.0) : retire les worktrees que les essais précédents ont laissés aux tâches d'un plan.
// Node 18 ou plus, aucune dépendance.
//
// Usage : node <racine du plugin>/scripts/worktrees.mjs nettoyer [<dossier-plan>] [--essai] [--run-arrete]
//   Sans dossier : le seul plan de plans/. --essai : dit ce qui serait fait, sans rien toucher.
//   --run-arrete : l'utilisateur confirme que le run noté « en-cours » dans suivi.json est arrêté (session fermée sans fin de run).
//
// Un worktree resté sur la branche tache/<id> (ou tache/<id>-rN) d'une tâche du plan tient cette branche : l'essai suivant
// ne peut plus s'y placer et part sur une branche -rN, parfois sans la remettre à jour. Le script retire ces worktrees :
//   - seulement ceux des tâches du plan, jamais le checkout principal ;
//   - seulement s'ils sont propres (git status vide, fichiers non suivis compris ; les fichiers ignorés, comme les
//     dépendances installées, partent avec le worktree) ; un worktree modifié est signalé, jamais retiré ;
//   - par « git worktree remove » sans --force (git refuse lui-même un worktree modifié), après « git worktree unlock » : quand
//     aucun run du plan ne tourne, le verrou qu'un agent a posé sur son worktree est périmé ;
//   - jamais le worktree d'où le script est lancé ;
//   - la branche est toujours gardée : le travail des essais précédents reste dans git.
// À lancer quand aucun agent du plan ne travaille : par le greffier en fin de run, ou par /orchestre:lancer avant un run.
// Si suivi.json note un run « en-cours », le script refuse (code 1) : ses agents travaillent peut-être dans ces worktrees.
// Deux plans d'un même dépôt ne partagent pas d'identifiant de tâche : ils partageraient aussi les branches tache/<id>.
// Sortie : une ligne par worktree retiré ou gardé, puis un bilan. Code 0, même s'il reste des worktrees ; 1 si un run est en cours ;
// 2 si l'appel est invalide.
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
const RE_ID = /^[A-Z]+[0-9]+[A-Z]*$/
class Usage extends Error {}
class Refus extends Error {}
const essai = f => { try { return f() } catch { return null } }
const git = (args, cwd) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const reel = p => essai(() => realpathSync(p)) || resolve(p)

// Les blocs de « git worktree list --porcelain » : le premier est le checkout principal
export function lireWorktrees(texte) {
  const blocs = []
  for (const bloc of String(texte).split(/\n\s*\n/)) {
    const b = {}
    for (const l of bloc.split('\n')) {
      const i = l.indexOf(' '), k = i < 0 ? l : l.slice(0, i), v = i < 0 ? '' : l.slice(i + 1)
      if (k === 'worktree') b.chemin = v
      else if (k === 'HEAD') b.head = v
      else if (k === 'branch') b.branche = v.replace(/^refs\/heads\//, '')
      else if (k === 'detached') b.detache = true
      else if (k === 'locked') b.verrou = v || true
      else if (k === 'prunable') b.orphelin = v || true
    }
    if (b.chemin) blocs.push(b)
  }
  return blocs
}

// La tâche d'une branche tache/<id> ou tache/<id>-rN
export const tacheDe = branche => { const m = String(branche || '').match(/^tache\/([A-Z]+[0-9]+[A-Z]*)(?:-r[0-9]+)?$/); return m ? m[1] : null }

function localiser(arg) {
  const ici = essai(() => git(['rev-parse', '--show-toplevel'], process.cwd()).trim())
  if (!ici) throw new Usage('pas dans un dépôt git')
  const principal = reel(lireWorktrees(essai(() => git(['worktree', 'list', '--porcelain'], ici)) || '')[0]?.chemin || ici)
  let dir
  if (arg) {
    const abs = resolve(process.cwd(), arg)
    const r = existsSync(abs) ? relative(reel(ici), reel(abs)) : null
    dir = r != null && !r.startsWith('..') && !isAbsolute(r) ? join(principal, r) : resolve(principal, arg)
    if (!existsSync(join(dir, 'taches'))) throw new Usage(`plan introuvable : ${arg}`)
  } else {
    const p = join(principal, 'plans')
    const plans = existsSync(p) ? readdirSync(p).filter(n => existsSync(join(p, n, 'taches'))).sort() : []
    if (!plans.length) throw new Usage('aucun plan dans plans/ ; précise son dossier : plans/<nom>')
    if (plans.length > 1) throw new Usage(`plusieurs plans (${plans.map(n => 'plans/' + n).join(', ')}) ; précise lequel`)
    dir = join(p, plans[0])
  }
  return { principal, dir, ici: reel(ici) }
}

// Les identifiants des tâches du plan, lus dans le frontmatter de taches/*.md
function idsDuPlan(dir) {
  const ids = new Set()
  for (const f of readdirSync(join(dir, 'taches')).filter(f => f.endsWith('.md'))) {
    const fm = (readFileSync(join(dir, 'taches', f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || ''
    const id = (fm.match(/^id:\s*["']?([^"'\s#]+)/m) || [])[1]
    if (id && RE_ID.test(id)) ids.add(id)
  }
  return ids
}

// Un run noté « en-cours » dans suivi.json (0.8.0) : ses agents travaillent peut-être dans les worktrees
function runEnCours(dir) {
  const doc = essai(() => JSON.parse(readFileSync(join(dir, 'suivi.json'), 'utf8')))
  return ((doc && Array.isArray(doc.runs) && doc.runs) || []).filter(r => r && r.statut === 'en-cours').pop() || null
}

export function nettoyer(arg, { essai: aBlanc = false, runArrete = false } = {}) {
  const { principal, dir, ici } = localiser(arg)
  const enCours = runEnCours(dir)
  if (enCours && !runArrete && !aBlanc) throw new Refus(`suivi.json note le run ${enCours.numero} « en-cours » depuis ${enCours.debut} : rien n'est retiré, ses agents travaillent peut-être dans ces worktrees. S'il est arrêté, relance avec --run-arrete.`)
  const ids = idsDuPlan(dir)
  const tous = lireWorktrees(git(['worktree', 'list', '--porcelain'], principal))
  const lignes = [], retires = [], gardes = []
  let orphelins = 0
  for (const w of tous.slice(1)) {
    const id = tacheDe(w.branche)
    if (!id || !ids.has(id) || reel(w.chemin) === principal) continue
    if (reel(w.chemin) === ici) { gardes.push(w); lignes.push(`gardé  ${w.branche} (${w.chemin}) : c'est le dossier d'où le nettoyage est lancé`); continue }
    if (w.orphelin || !existsSync(w.chemin)) { orphelins++; continue }
    const modifs = essai(() => git(['-C', w.chemin, 'status', '--porcelain', '--untracked-files=all'], principal))
    if (modifs == null) { gardes.push(w); lignes.push(`gardé  ${w.branche} (${w.chemin}) : état illisible`); continue }
    const n = modifs.split('\n').filter(Boolean).length
    if (n) { gardes.push(w); lignes.push(`gardé  ${w.branche} (${w.chemin}) : ${n} fichier${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''} ou non suivi${n > 1 ? 's' : ''}, à commiter ou annuler à la main`); continue }
    const verrou = w.verrou ? `, verrou${w.verrou === true ? '' : ` « ${w.verrou} »`} levé` : ''
    if (aBlanc) { retires.push(w); lignes.push(`à retirer ${w.branche} (${w.chemin})${verrou ? verrou.replace('levé', 'à lever') : ''}`); continue }
    if (w.verrou) essai(() => git(['worktree', 'unlock', w.chemin], principal))
    try {
      git(['worktree', 'remove', w.chemin], principal)
      retires.push(w)
      lignes.push(`retiré ${w.branche} (${w.chemin}), branche gardée${verrou}`)
    } catch (e) {
      gardes.push(w)
      lignes.push(`gardé  ${w.branche} (${w.chemin}) : git refuse de le retirer (${String(e.stderr || e.message).trim().split('\n')[0]})`)
    }
  }
  // Worktrees dont le dossier a disparu : seulement leurs métadonnées dans .git
  if (orphelins && !aBlanc) essai(() => git(['worktree', 'prune'], principal))
  const plan = relative(principal, dir) || '.'
  const bilan = `worktrees ${plan} : ${retires.length} ${aBlanc ? 'à retirer' : 'retiré' + (retires.length > 1 ? 's' : '')}, ${gardes.length} gardé${gardes.length > 1 ? 's' : ''}${orphelins ? `, ${orphelins} orphelin${orphelins > 1 ? 's' : ''} ${aBlanc ? 'à oublier' : 'oublié' + (orphelins > 1 ? 's' : '')}` : ''}`
  return { texte: [...lignes, bilan].join('\n'), retires: retires.map(w => w.branche), gardes: gardes.map(w => w.branche), orphelins }
}

const lance = process.argv[1] && reel(process.argv[1]) === reel(fileURLToPath(import.meta.url))
if (lance) {
  try {
    const argv = process.argv.slice(2)
    if (argv[0] !== 'nettoyer') throw new Usage('usage : worktrees.mjs nettoyer [<dossier-plan>] [--essai] [--run-arrete]')
    const arg = argv.slice(1).find(a => !a.startsWith('--'))
    console.log(nettoyer(arg, { essai: argv.includes('--essai'), runArrete: argv.includes('--run-arrete') }).texte)
  } catch (e) {
    console.error(`worktrees : ${e instanceof Usage || e instanceof Refus ? e.message : `erreur inattendue, rien de plus n'est retiré : ${(e && e.stack) || e}`}`)
    process.exitCode = e instanceof Usage ? 2 : 1
  }
}
