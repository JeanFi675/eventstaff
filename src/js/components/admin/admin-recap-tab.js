/**
 * Onglet "Récapitulatif" — Phase 5.2.5 (C4).
 *
 * Composant minimal : lecture seule de `Alpine.store('admin').stats`
 * (tshirts, repas, cagnotte). Aucun state ni méthode propre.
 */

import Alpine from 'alpinejs';

export function adminRecapTab() {
  return {
    get stats() {
      return Alpine.store('admin').stats;
    },
  };
}
