import Alpine from 'alpinejs';
import { AuthService } from './services/auth.js';
import { ApiService } from './services/api.js';
import { createAdminStore } from './stores/admin-store.js';
import { adminHeuresTab } from './components/admin/admin-heures-tab.js';
import { adminMailingTab } from './components/admin/admin-mailing-tab.js';
import { adminReferentsTab } from './components/admin/admin-referents-tab.js';
import { adminRecapTab } from './components/admin/admin-recap-tab.js';
import { adminCagnotteForceeTab } from './components/admin/admin-cagnotte-forcee-tab.js';
import { adminBenevolesTab } from './components/admin/admin-benevoles-tab.js';
import { adminVisualCreatorTab } from './components/admin/admin-visual-creator-tab.js';

document.addEventListener('alpine:init', () => {
  Alpine.store('admin', createAdminStore());
  Alpine.data('adminHeuresTab', adminHeuresTab);
  Alpine.data('adminMailingTab', adminMailingTab);
  Alpine.data('adminReferentsTab', adminReferentsTab);
  Alpine.data('adminRecapTab', adminRecapTab);
  Alpine.data('adminCagnotteForceeTab', adminCagnotteForceeTab);
  Alpine.data('adminBenevolesTab', adminBenevolesTab);
  Alpine.data('adminVisualCreatorTab', adminVisualCreatorTab);

  // Coquille racine d'admin.html. Tous les onglets sont des `Alpine.data(...)`
  // autonomes ; le state partagé vit dans `Alpine.store('admin')`. `adminApp`
  // n'expose que ce que le scope racine d'admin.html consomme : `activeTab`
  // (tabs.html), `isAdmin` / `loading` (bandeaux), `toasts` (toast.html) et
  // `init` (x-init).
  Alpine.data('adminApp', () => ({
    activeTab: 'visual-creator',

    get isAdmin() {
      return Alpine.store('admin').isAdmin;
    },
    set isAdmin(v) {
      Alpine.store('admin').isAdmin = v;
    },

    get loading() {
      return Alpine.store('admin').loading;
    },
    set loading(v) {
      Alpine.store('admin').loading = v;
    },

    get toasts() {
      return Alpine.store('admin').toasts;
    },
    set toasts(v) {
      Alpine.store('admin').toasts = v;
    },

    // Proxy de la modale de confirmation : confirm-modal.html lit `confirmModal.{open,title,message}`
    // et invoque `handleConfirm(true|false)` sur le scope racine. La source de vérité
    // vit dans `Alpine.store('admin').confirmModal`.
    get confirmModal() {
      return Alpine.store('admin').confirmModal;
    },
    handleConfirm(result) {
      Alpine.store('admin').handleConfirm(result);
    },

    async init() {
      const { user } = await AuthService.getSession();
      if (!user) {
        window.location.href = 'index.html';
        return;
      }

      const { data: profiles, error } = await ApiService.fetch('benevoles', {
        eq: { user_id: user.id },
        select: 'role',
      });

      const hasAdminRole = profiles && profiles.some((p) => p.role === 'admin');

      if (error || !hasAdminRole) {
        this.isAdmin = false;
        this.loading = false;

        window.location.href = 'index.html';
        return;
      }

      this.isAdmin = true;

      await Alpine.store('admin').loadData();
      // Signaler aux composants Phase C (notamment `adminVisualCreatorTab`)
      // qu'ils peuvent procéder à leur initialisation différée.
      window.dispatchEvent(new CustomEvent('admin:loaded'));
      this.loading = false;

      AuthService.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && window.location.hash.includes('access_token')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      });
    },
  }));
});

Alpine.start();
