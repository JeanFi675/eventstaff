/**
 * Onglet "Heures de bénévolat" — Phase 5.2.5 (C1).
 *
 * Composant Alpine.data autonome consommant `Alpine.store('admin')` en lecture seule
 * (postes + periodes). Aucune mutation : agrégations pures à partir du state partagé.
 */

import Alpine from 'alpinejs';
import { formatTime } from '../../utils/format-date.js';

export function adminHeuresTab() {
  return {
    formatTime,

    getHeuresParPeriode() {
      const store = Alpine.store('admin');
      const arrondi = (v) => Math.round(v * 10) / 10;
      return store.periodes.map((periode) => {
        const postesAvecHeures = store.postes
          .filter((p) => p.periode_id === periode.id && p.periode_debut && p.periode_fin)
          .map((p) => {
            const dureeH =
              (new Date(p.periode_fin).getTime() - new Date(p.periode_debut).getTime()) / 3600000;
            const inscrits = p.inscrits_actuels || 0;
            return {
              id: p.id,
              titre: p.titre,
              debut: p.periode_debut,
              fin: p.periode_fin,
              dureeH: arrondi(dureeH),
              inscrits,
              heuresInscrits: arrondi(dureeH * inscrits),
              heuresMin: arrondi(dureeH * p.nb_min),
              heuresMax: arrondi(dureeH * p.nb_max),
            };
          });

        return {
          nom: periode.nom,
          postes: postesAvecHeures,
          totalHeuresInscrits: arrondi(postesAvecHeures.reduce((s, p) => s + p.heuresInscrits, 0)),
          totalHeuresMin: arrondi(postesAvecHeures.reduce((s, p) => s + p.heuresMin, 0)),
          totalHeuresMax: arrondi(postesAvecHeures.reduce((s, p) => s + p.heuresMax, 0)),
        };
      });
    },

    getTotalHeures() {
      const periodes = this.getHeuresParPeriode();
      return {
        inscrits: Math.round(periodes.reduce((s, p) => s + p.totalHeuresInscrits, 0) * 10) / 10,
        min: Math.round(periodes.reduce((s, p) => s + p.totalHeuresMin, 0) * 10) / 10,
        max: Math.round(periodes.reduce((s, p) => s + p.totalHeuresMax, 0) * 10) / 10,
      };
    },
  };
}
