/**
 * Widget Cagnotte — solde "Mon Matériel" + QR Code vers debit.html.
 * Refresh via l'événement `window.cagnotte-refresh`.
 */

import { ApiService } from '../../services/api.js';
import QRCode from 'qrcode';

export function cagnotteWidget(benevoleId) {
  return {
    benevoleId,
    balance: 0,
    isOpen: false,

    get debitUrl() {
      const path = window.location.pathname;
      const directory = path.substring(0, path.lastIndexOf('/') + 1);
      return `${window.location.origin}${directory}debit.html?id=${this.benevoleId}`;
    },

    async init() {
      await this.reload();
      // Canvas rendu via x-show (présent dans le DOM dès l'init) :
      // génération une seule fois, URL stable par utilisateur.
      this.$nextTick(() => this.renderQR());
    },

    async reload() {
      if (!this.benevoleId) return;
      try {
        const { data, error } = await ApiService.rpc('get_user_balance', {
          target_user_id: this.benevoleId,
        });
        if (error) throw error;
        this.balance = data || 0;
      } catch (e) {
        console.error('Cagnotte reload error:', e);
      }
    },

    renderQR() {
      const canvas = this.$refs.qrCanvas;
      if (!canvas) return;
      QRCode.toCanvas(
        canvas,
        this.debitUrl,
        {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        },
        (err) => {
          if (err) console.error(err);
        }
      );
    },
  };
}
