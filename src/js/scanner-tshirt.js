import '../styles/main.css';
import '../css/scanner-tshirt.css';
import Alpine from 'alpinejs';
import { PublicApiService } from './services/public-api.js';
import { createConfirmModalState, askConfirm, handleConfirm } from './utils/confirm.js';

/**
 * @typedef {Object} Volunteer
 * @property {string} benevole_id
 * @property {string} prenom
 * @property {string} nom
 * @property {string} taille_tshirt
 * @property {boolean} has_recupere_tshirt
 * @property {boolean} has_registrations
 * @property {boolean} [selected]
 */

Alpine.data('tshirtScanner', () => ({
  loading: true,
  error: null,
  /** @type {Volunteer[]} */
  volunteers: [],

  confirmModal: createConfirmModalState(),

  askConfirm(message, title = 'Confirmation') {
    return askConfirm(this.confirmModal, message, title);
  },

  handleConfirm(result) {
    handleConfirm(this.confirmModal, result);
  },

  async init() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');

    if (!id) {
      this.error = 'QR Code invalide (ID manquant).';
      this.loading = false;
      return;
    }

    // Failsafe timeout
    const timeoutId = setTimeout(() => {
      if (this.loading) {
        console.error('Init timed out');
        this.error = "Délai d'attente dépassé. Vérifiez votre connexion.";
        this.loading = false;
      }
    }, 5000);

    try {
      const { data, error } = await PublicApiService.rpc('get_family_tshirt_info_smart', {
        scan_id: id,
      });

      if (error) throw error;

      // @ts-ignore
      this.volunteers = (data || []).map((v) => ({
        ...v,
        selected: v.has_registrations && !v.has_recupere_tshirt, // Auto-select if eligible and needed
      }));

      if (this.volunteers.length === 0) {
        this.error = 'Aucun bénévole trouvé pour ce code.';
      }
    } catch (e) {
      console.error('Init Error:', e);
      this.error = 'Erreur chargement: ' + e.message;
    } finally {
      clearTimeout(timeoutId);
      this.loading = false;
    }
  },

  get anySelected() {
    return this.volunteers.some((v) => v.selected && !v.has_recupere_tshirt);
  },

  async validateSelected() {
    const toValidate = this.volunteers.filter((v) => v.selected && !v.has_recupere_tshirt);

    if (toValidate.length === 0) return;

    // Check sizes
    const missingSize = toValidate.find((v) => !v.taille_tshirt);
    if (missingSize) {
      alert(`Veuillez sélectionner une taille pour ${missingSize.prenom}.`);
      return;
    }

    const count = toValidate.length;
    const names = toValidate.map((v) => v.prenom).join(', ');

    const confirmed = await this.askConfirm(
      `Valider le retrait de ${count} T-shirt(s) pour : ${names} ?`,
      'Confirmer le retrait'
    );
    if (!confirmed) return;

    this.loading = true;

    try {
      // Process all in parallel
      const promises = toValidate.map(async (v) => {
        const { error } = await PublicApiService.rpc('update_tshirt_status', {
          target_id: v.benevole_id,
          new_taille: v.taille_tshirt,
          mark_collected: true,
        });
        if (error) throw error;
        v.has_recupere_tshirt = true;
        v.selected = false;
      });

      await Promise.all(promises);
      // Success
    } catch (err) {
      alert('Erreur lors de la validation : ' + err.message);
    } finally {
      this.loading = false;
    }
  },
}));

Alpine.start();
