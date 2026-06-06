/**
 * Helpers de gestion des notifications "toast".
 *
 * Logique pure : pas de dépendance Alpine. Chaque host (store / Alpine.data root)
 * fournit son propre tableau réactif `toasts` et appelle `pushToast(this.toasts, ...)`.
 * Le rendu DOM est centralisé dans `src/partials/components/toast.html` (template
 * `<template x-for="toast in toasts">`).
 *
 * Centralisé en Phase 5.3.1 (DRY) pour remplacer 4 implémentations divergentes
 * de `showToast` (cf. audit/notes.md, section « Pattern A »).
 */

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Génère un identifiant unique pour un toast (résistant aux collisions
 * intra-milliseconde quand plusieurs toasts sont déclenchés simultanément).
 *
 * @returns {string}
 */
function generateToastId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Pousse un toast dans le tableau réactif fourni puis programme sa disparition.
 *
 * @param {Array<{id: string, message: string, type: string}>} toastsArray
 *   Tableau réactif (Alpine.store ou propriété d'un Alpine.data root) qui hébergera le toast.
 *   La fonction mute ce tableau in-place puis le remplace par un filtre après expiration —
 *   Alpine détecte les deux opérations.
 * @param {string} message - Message à afficher.
 * @param {string} [type='success'] - Type ('success' | 'error' | 'warning' | 'info').
 * @param {number} [timeoutMs=5000] - Durée d'affichage en ms.
 * @returns {string} - L'ID généré (utile pour annulation manuelle si besoin futur).
 */
export function pushToast(toastsArray, message, type = 'success', timeoutMs = DEFAULT_TIMEOUT_MS) {
  const id = generateToastId();
  toastsArray.push({ id, message, type });
  setTimeout(() => {
    const idx = toastsArray.findIndex((t) => t.id === id);
    if (idx !== -1) toastsArray.splice(idx, 1);
  }, timeoutMs);
  return id;
}
