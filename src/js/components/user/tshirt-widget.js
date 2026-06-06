/**
 * Widget T-shirts — compteur "à récupérer" + QR Code vers scanner-tshirt.
 * Masqué si feature flag off / aucun éligible / tout déjà collecté.
 */

import { ApiService } from '../../services/api.js';
import QRCode from 'qrcode';

export function tshirtWidget(benevoleId) {
  return {
    benevoleId,
    rows: [],
    isOpen: false,
    loaded: false,

    get eligibles() {
      return this.rows.filter(
        (v) =>
          v.has_registrations &&
          v.taille_tshirt &&
          v.taille_tshirt !== 'SANS' &&
          v.taille_tshirt.trim() !== ''
      );
    },

    get countToCollect() {
      return this.eligibles.filter((v) => !v.has_recupere_tshirt).length;
    },

    get allCollected() {
      return this.eligibles.length > 0 && this.eligibles.every((v) => v.has_recupere_tshirt);
    },

    get isVisible() {
      return this.loaded && this.eligibles.length > 0 && !this.allCollected;
    },

    get scannerUrl() {
      const path = window.location.pathname;
      const directory = path.substring(0, path.lastIndexOf('/') + 1);
      return `${window.location.origin}${directory}scanner-tshirt.html?id=${this.benevoleId}`;
    },

    async init() {
      await this.reload();
    },

    async reload() {
      if (!this.benevoleId) return;
      try {
        const { data, error } = await ApiService.rpc('get_family_tshirt_info_smart', {
          scan_id: this.benevoleId,
        });
        if (error) throw error;
        this.rows = data || [];
        this.loaded = true;
      } catch (e) {
        console.error('Tshirt reload error:', e);
      }
    },

    toggleQR() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) this.$nextTick(() => this.renderQR());
    },

    renderQR() {
      const canvas = this.$refs.qrCanvas;
      if (!canvas) return;
      QRCode.toCanvas(canvas, this.scannerUrl, { width: 200, margin: 2 }, (e) => {
        if (e) console.error(e);
      });
    },
  };
}
