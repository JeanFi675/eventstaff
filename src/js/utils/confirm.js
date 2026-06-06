/**
 * Helpers de gestion de la modale de confirmation (remplace `window.confirm()`).
 *
 * Pattern Promise : `askConfirm(state, message, title)` retourne une Promise<boolean>
 * résolue par le clic utilisateur sur "Oui" ou "Non". Le rendu DOM est centralisé
 * dans `src/partials/components/confirm-modal.html` qui lit `confirmModal.{open,title,message}`
 * et appelle `handleConfirm(true|false)` sur les boutons.
 *
 * Centralisé en Phase 5.3.1 (DRY) pour remplacer 8 appels natifs `confirm()`
 * (cf. audit/notes.md, section « Pattern B »).
 *
 * Usage type dans un Alpine.store ou Alpine.data :
 *
 *   import { createConfirmModalState, askConfirm, handleConfirm } from '@/utils/confirm.js';
 *
 *   return {
 *     confirmModal: createConfirmModalState(),
 *     askConfirm(message, title) { return askConfirm(this.confirmModal, message, title); },
 *     handleConfirm(result) { handleConfirm(this.confirmModal, result); },
 *   };
 */

/**
 * @typedef {Object} ConfirmModalState
 * @property {boolean} open
 * @property {string} title
 * @property {string} message
 * @property {((value: boolean) => void) | null} resolve
 */

/**
 * Crée l'objet d'état réactif attendu par `src/partials/components/confirm-modal.html`.
 *
 * @returns {ConfirmModalState}
 */
export function createConfirmModalState() {
  return {
    open: false,
    title: '',
    message: '',
    resolve: null,
  };
}

/**
 * Ouvre la modale et retourne une Promise résolue par l'action utilisateur.
 *
 * @param {ConfirmModalState} state
 * @param {string} message
 * @param {string} [title='Confirmation']
 * @returns {Promise<boolean>}
 */
export function askConfirm(state, message, title = 'Confirmation') {
  state.title = title;
  state.message = message;
  state.open = true;
  return new Promise((resolve) => {
    state.resolve = resolve;
  });
}

/**
 * Ferme la modale et résout la Promise en attente avec le choix utilisateur.
 *
 * @param {ConfirmModalState} state
 * @param {boolean} result
 */
export function handleConfirm(state, result) {
  state.open = false;
  if (state.resolve) {
    state.resolve(result);
    state.resolve = null;
  }
}
