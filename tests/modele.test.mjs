// Modèle de réglages de /orchestre:installer : refus attendus, et exceptions des modèles .env placées après la règle qu'elles corrigent
import fs from 'node:fs'
import assert from 'node:assert/strict'

const m = JSON.parse(fs.readFileSync(new URL('../plugins/orchestre/skills/installer/settings.local.modele.json', import.meta.url), 'utf8'))
const deny = m.permissions.deny
for (const r of ['Bash(git push *)', 'Bash(git -C * push *)', 'Read(./.env)', 'Read(./.env.*)']) assert.ok(deny.includes(r), `refus manquant : ${r}`)
// Une exception « ! » n'annule que les règles listées avant elle dans le même fichier
const i = deny.indexOf('Read(./.env.*)')
for (const x of ['.env.example', '.env.sample', '.env.template', '.env.dist']) {
  const j = deny.indexOf(`Read(!${x})`)
  assert.ok(j > i, `exception Read(!${x}) absente ou placée avant Read(./.env.*)`)
}
// Reprise d'une branche : le worker vérifie qu'elle contient la branche d'intégration avant de la fusionner dedans
assert.ok(m.permissions.allow.includes('Bash(git merge-base *)'), 'autorisation manquante : git merge-base')
assert.equal(m.worktree.baseRef, 'head')
assert.equal(m.autoContinueAtUsageLimit, true)
console.log('modèle de réglages : TOUT EST VERT')
