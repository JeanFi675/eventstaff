/**
 * Onglet "Cagnotte forcée" — Phase 5.2.5 (C5).
 *
 * State local : recherche, sélection courante, formulaire d'édition.
 * Lecture store : `benevoles`, `periodes`, `config`, `loading`, `visualDays`.
 */

import Alpine from 'alpinejs';
import { ApiService } from '../../services/api.js';

export function adminCagnotteForceeTab() {
  return {
    // --- State local ---
    forcedSearchQuery: '',
    selectedForcedBenevole: null,
    forcedForm: {
      is_cagnotte_forcee: false,
      cagnotte_forcee_type: 'journee',
      cagnotte_forcee_jours: [],
      cagnotte_forcee_periodes_ids: [],
    },

    // --- Proxies vers le store (résolution scope template) ---

    get benevoles() {
      return Alpine.store('admin').benevoles;
    },

    get periodes() {
      return Alpine.store('admin').periodes;
    },

    get config() {
      return Alpine.store('admin').config;
    },

    get loading() {
      return Alpine.store('admin').loading;
    },

    get visualDays() {
      return Alpine.store('admin').visualDays;
    },

    // --- Méthodes ---

    async saveForcedJourneeTarif() {
      const store = Alpine.store('admin');
      const tarif = parseFloat(store.config.tarif_cagnotte_journee);
      if (isNaN(tarif) || tarif < 0) {
        store.showToast(
          '⚠️ Veuillez saisir un tarif journalier valide supérieur ou égal à 0.',
          'warning'
        );
        return;
      }

      store.loading = true;
      try {
        const { error } = await ApiService.upsert('config', {
          key: 'tarif_cagnotte_journee',
          value: tarif,
        });
        if (error) throw error;
        store.showToast('✅ Tarif journée mis à jour avec succès !', 'success');
        await store.loadBenevolesAndStats(); // recalcul des soldes
      } catch (err) {
        console.error(err);
        store.showToast('❌ Erreur lors de la sauvegarde du tarif : ' + err.message, 'error');
      } finally {
        store.loading = false;
      }
    },

    selectBenevoleForCagnotte(benevole) {
      this.selectedForcedBenevole = benevole;
      this.forcedForm.is_cagnotte_forcee = benevole.is_cagnotte_forcee || false;
      this.forcedForm.cagnotte_forcee_type = benevole.cagnotte_forcee_type || 'journee';
      this.forcedForm.cagnotte_forcee_jours = benevole.cagnotte_forcee_jours
        ? [...benevole.cagnotte_forcee_jours]
        : [];
      this.forcedForm.cagnotte_forcee_periodes_ids = benevole.cagnotte_forcee_periodes_ids
        ? [...benevole.cagnotte_forcee_periodes_ids]
        : [];
    },

    async saveCagnotteForcee() {
      if (!this.selectedForcedBenevole) return;
      const store = Alpine.store('admin');

      store.loading = true;
      try {
        const benevoleId = this.selectedForcedBenevole.id;

        // 1. Update du bénévole
        const isForced = this.forcedForm.is_cagnotte_forcee;
        const type = isForced ? this.forcedForm.cagnotte_forcee_type : null;
        const jours = isForced && type === 'journee' ? this.forcedForm.cagnotte_forcee_jours : [];

        const updatePayload = {
          is_cagnotte_forcee: isForced,
          cagnotte_forcee_type: type,
          cagnotte_forcee_jours: jours,
        };

        const { error: updateError } = await ApiService.update('benevoles', updatePayload, {
          id: benevoleId,
        });
        if (updateError) throw updateError;

        // 2. Nettoyer les anciennes périodes forcées
        const { error: deleteError } = await ApiService.delete('benevole_cagnotte_periodes', {
          benevole_id: benevoleId,
        });
        if (deleteError) throw deleteError;

        // 3. Insérer les nouvelles périodes si requis
        if (
          isForced &&
          type === 'periode' &&
          this.forcedForm.cagnotte_forcee_periodes_ids.length > 0
        ) {
          const inserts = this.forcedForm.cagnotte_forcee_periodes_ids.map((pid) => ({
            benevole_id: benevoleId,
            periode_id: pid,
          }));
          const { error: insertError } = await ApiService.insert(
            'benevole_cagnotte_periodes',
            inserts
          );
          if (insertError) throw insertError;
        }

        store.showToast('✅ Configuration de la cagnotte enregistrée !', 'success');

        // 4. Recharger pour rafraîchir les soldes
        await store.loadBenevolesAndStats();

        // 5. Re-sélectionner pour refléter les changements à l'écran
        const updatedBenevole = store.benevoles.find((b) => b.id === benevoleId);
        if (updatedBenevole) {
          this.selectBenevoleForCagnotte(updatedBenevole);
        } else {
          this.selectedForcedBenevole = null;
        }
      } catch (err) {
        console.error(err);
        store.showToast("❌ Erreur lors de l'enregistrement : " + err.message, 'error');
      } finally {
        store.loading = false;
      }
    },

    async revertCagnotteForcee(benevole) {
      if (!benevole) return;
      const store = Alpine.store('admin');
      const confirmed = await store.askConfirm(
        `Voulez-vous vraiment annuler le forçage de la cagnotte pour ${benevole.prenom} ${benevole.nom} ?`,
        'Annuler le forçage'
      );
      if (!confirmed) return;

      store.loading = true;
      try {
        const benevoleId = benevole.id;

        // 1. Désactiver le forçage sur le bénévole
        const updatePayload = {
          is_cagnotte_forcee: false,
          cagnotte_forcee_type: null,
          cagnotte_forcee_jours: [],
        };

        const { error: updateError } = await ApiService.update('benevoles', updatePayload, {
          id: benevoleId,
        });
        if (updateError) throw updateError;

        // 2. Nettoyer les périodes forcées
        const { error: deleteError } = await ApiService.delete('benevole_cagnotte_periodes', {
          benevole_id: benevoleId,
        });
        if (deleteError) throw deleteError;

        store.showToast('✅ Forçage de la cagnotte annulé avec succès !', 'success');

        // 3. Réinitialiser la sélection si c'était ce bénévole
        if (this.selectedForcedBenevole?.id === benevoleId) {
          this.selectedForcedBenevole = null;
        }

        // 4. Recharger pour recalculer les soldes
        await store.loadBenevolesAndStats();
      } catch (err) {
        console.error(err);
        store.showToast("❌ Erreur lors de l'annulation : " + err.message, 'error');
      } finally {
        store.loading = false;
      }
    },
  };
}
