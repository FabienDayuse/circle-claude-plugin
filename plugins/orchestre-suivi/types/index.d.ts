// Contrat du mod orchestre-suivi : ce qu'il garde dans $.state, et le modèle qu'il tire de suivi.json
// (orchestre-suivi/1, voir hooks/modele.mjs). Dates en millisecondes depuis l'époque.

export type Statut = 'à-faire' | 'ajoutée' | 'fusionnée' | 'bloquée' | 'échec' | 'besoin-humain' | 'annulée'

export type TacheVue = {
  id: string
  titre: string
  phase: number
  statut: Statut
  essais: number
  etape: string | null
  isole: boolean
  debut: number | null
  fin: number | null
  attend: string[]
  blocage: string[]
}

export type RunVue = {
  numero: number
  phase: number
  mode: string
  statut: string
  debut: number | null
  fin: number | null
  detail: string | null
  // Tâches dont ce run a appliqué un arbitrage (arbitrages_appliques)
  arbitres: string[]
}

export type PhaseVue = {
  numero: number
  total: number
  faites: number
  enCours: number
  attention: number
  essais: number
  relances: { id: string; essais: number }[]
  duree: number | null
}

export type Instantane = {
  plan: string
  dossier: string
  maj: number | null
  taches: TacheVue[]
  runs: RunVue[]
  run: RunVue | null
  relectures: { tache: string | null; phase: number | null; texte: string; quand: number | null }[]
  decisions: { tache: string; titre: string; option: string; description: string }[]
  points: { tache: string; titre: string; humain: boolean; role: string }[]
  prerequis: { id: string; type: string; bloque: string[] }[]
  majeures: Record<string, number>
  tickets: number
  lint: { ok: boolean; erreurs: number }
  journal: { quand: number | null; genre: string; tache: string | null; texte: string }[]
}

// Un morceau de ligne : texte, couleur du thème (success, error, warning, suggestion, subtle, claude, merged), gras, estompé
export type Morceau = { t: string; c?: string; b?: boolean; d?: boolean }
export type Ligne = Morceau[]

export type Onglet = 'taches' | 'relire' | 'journal' | 'bilan'

declare module 'claude-code' {
  interface PluginState {
    'orchestre-suivi': {
      // Dernière lecture valide de suivi.json, null tant qu'aucun plan n'est suivi
      instantane: Instantane | null
      // Plan choisi par /suivi plans/<nom> ; null : le suivi.json écrit en dernier (/suivi auto y revient)
      plan: string | null
      // mtime de suivi.json à la dernière lecture : on ne relit que s'il a changé
      lu: number
      onglet: Onglet
      // Numéro du run dont le bandeau de fin a été masqué
      masque: number | null
      // Format inconnu déjà signalé, pour ne le dire qu'une fois
      alerte: string | null
      // Heure du dernier redessin forcé pendant un run : les durées avancent sans nouvelle écriture de suivi.json
      tic: number
    }
  }
}
