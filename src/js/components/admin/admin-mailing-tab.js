/**
 * Onglet "Espace Mailing" — Phase 5.2.5 (C2).
 *
 * Composant Alpine.data autonome — filtres mailing (rôle, assignation, postes
 * spécifiques) + aperçu + copie clipboard groupée.
 *
 * State local : filtres et lignes poste/créneau (n'a de sens que dans cet onglet).
 * Lecture de `Alpine.store('admin')` : postes, benevoles, uniquePosteTitres (dérivé), showToast.
 */

import Alpine from 'alpinejs';
import { formatTime } from '../../utils/format-date.js';

export function adminMailingTab() {
  return {
    // --- State local ---
    mailingFilterRole: 'tous', // 'tous' | 'benevole' | 'referent' | 'admin'
    mailingFilterAssignation: 'tous', // 'tous' | 'avec_poste' | 'sans_poste' | 'poste_specifique'
    mailingPostLines: [{ id: 1, selectedTitle: '', selectedSlots: [] }],

    formatTime,

    // --- Dérivés (lecture store) ---

    get uniquePosteTitres() {
      // Sémantique mailing : titres ayant au moins un slot créé.
      return Alpine.store('admin').posteTitresWithSlots;
    },

    // --- Mutations locales ---

    addMailingPostLine() {
      this.mailingPostLines.push({
        id: Date.now(),
        selectedTitle: '',
        selectedSlots: [],
      });
    },

    removeMailingPostLine(index) {
      this.mailingPostLines.splice(index, 1);
      if (this.mailingPostLines.length === 0) {
        this.addMailingPostLine();
      }
    },

    // --- Calculs / sélections ---

    getSlotsForPostTitle(title) {
      if (!title) return [];
      return Alpine.store('admin')
        .postes.filter((p) => p.titre === title)
        .sort((a, b) => {
          if (a.periode_ordre !== b.periode_ordre) {
            return a.periode_ordre - b.periode_ordre;
          }
          return new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime();
        });
    },

    getFilteredMailingBenevoles() {
      const store = Alpine.store('admin');
      let list = [...store.benevoles];

      // 1. Filtre par rôle
      if (this.mailingFilterRole !== 'tous') {
        list = list.filter((b) => b.role === this.mailingFilterRole);
      }

      // 2. Filtre par assignation/poste
      if (this.mailingFilterAssignation === 'avec_poste') {
        list = list.filter((b) => (b.nb_inscriptions || 0) > 0);
      } else if (this.mailingFilterAssignation === 'sans_poste') {
        list = list.filter((b) => (b.nb_inscriptions || 0) === 0);
      } else if (this.mailingFilterAssignation === 'poste_specifique') {
        // Agrège les IDs de créneaux sélectionnés à travers toutes les lignes
        const allSelectedSlotIds = new Set();
        this.mailingPostLines.forEach((line) => {
          if (line.selectedTitle) {
            line.selectedSlots.forEach((slotId) => {
              allSelectedSlotIds.add(slotId);
            });
          }
        });

        if (allSelectedSlotIds.size > 0) {
          const matchedBenevoleIds = new Set();
          store.postes.forEach((p) => {
            if (allSelectedSlotIds.has(p.id)) {
              (p.inscrits_ids || []).forEach((bId) => {
                matchedBenevoleIds.add(bId);
              });
            }
          });
          list = list.filter((b) => matchedBenevoleIds.has(b.id));
        } else {
          list = [];
        }
      }

      return list;
    },

    getFilteredMailingEmails() {
      return this.getFilteredMailingBenevoles()
        .map((b) => (b.email ? b.email.trim() : ''))
        .filter((email) => email.length > 0);
    },

    copyMailingEmails() {
      const store = Alpine.store('admin');
      const emails = this.getFilteredMailingEmails();
      if (emails.length === 0) {
        store.showToast('⚠️ Aucun e-mail à copier.', 'warning');
        return;
      }

      navigator.clipboard
        .writeText(emails.join(', '))
        .then(() => {
          store.showToast(`📋 ${emails.length} adresses e-mail copiées !`, 'success');
        })
        .catch((err) => {
          console.error('Erreur lors de la copie :', err);
          store.showToast('❌ Impossible de copier les e-mails automatiquement.', 'error');
        });
    },
  };
}
