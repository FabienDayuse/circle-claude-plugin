---
name: etat
description: Affiche l'état d'avancement d'un plan orchestre en un tableau compact (phases, tâches en cours, ce qui attend l'utilisateur), en lecture seule, y compris pendant un run. À lancer quand l'utilisateur tape /orchestre:etat.
argument-hint: "[<dossier-plan>]"
disable-model-invocation: true
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/etat.mjs *)
---
!`node ${CLAUDE_PLUGIN_ROOT}/scripts/etat.mjs $ARGUMENTS`

Ta réponse est le tableau de bord ci-dessus, recopié tel quel : rien avant, rien après, ni résumé ni commentaire. Une ligne qui commence par « orchestre:etat : » est une erreur : recopie-la seule.

Si tu vois à la place une commande qui n'a pas tourné (par exemple « [shell command execution disabled by policy] »), lance une fois `node ${CLAUDE_PLUGIN_ROOT}/scripts/etat.mjs $ARGUMENTS` et recopie sa sortie de la même façon. Ne lance rien d'autre et ne lis aucun fichier : un run peut tourner dans ce checkout, et le tableau suffit. L'étape de chaque agent se lit dans `/workflows`.
