import Alpine from 'alpinejs';
import { AuthService } from './services/auth.js';
import { ApiService } from './services/api.js';
import { pushToast } from './utils/toast.js';

function initAdminConnexionsApp() {
  Alpine.data('adminConnexionsApp', () => ({
    user: null,
    loading: true,
    isAdmin: false,
    users: [],
    selectedIds: [],
    sortField: 'created_at',
    sortDir: 'desc',

    benevolesSansInscr: [],
    selectedBenevolesIds: [],
    sortFieldBenevoles: 'updated_at',
    sortDirBenevoles: 'desc',
    editingPhones: {},
    savingPhoneIds: [],

    toasts: [],

    get sortedUsers() {
      return [...this.users].sort((a, b) => {
        const va = this.sortField === 'email' ? (a.email || '').toLowerCase() : a.created_at || '';
        const vb = this.sortField === 'email' ? (b.email || '').toLowerCase() : b.created_at || '';
        if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
        if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    },

    get allChecked() {
      return this.users.length > 0 && this.selectedIds.length === this.users.length;
    },

    get someChecked() {
      return this.selectedIds.length > 0;
    },

    toggleAll(checked) {
      this.selectedIds = checked ? this.users.map((u) => /** @type {any} */ (u).id) : [];
    },

    sortBy(field) {
      if (this.sortField === field) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortField = field;
        this.sortDir = 'asc';
      }
    },

    sortIcon(field) {
      if (this.sortField !== field) return '↕';
      return this.sortDir === 'asc' ? '↑' : '↓';
    },

    get sortedBenevoles() {
      return [...this.benevolesSansInscr].sort((a, b) => {
        let va, vb;
        if (this.sortFieldBenevoles === 'email') {
          va = (a.email || '').toLowerCase();
          vb = (b.email || '').toLowerCase();
        } else if (this.sortFieldBenevoles === 'updated_at') {
          va = a.updated_at || '';
          vb = b.updated_at || '';
        } else {
          va = a.created_at || a.nom || '';
          vb = b.created_at || b.nom || '';
        }
        if (va < vb) return this.sortDirBenevoles === 'asc' ? -1 : 1;
        if (va > vb) return this.sortDirBenevoles === 'asc' ? 1 : -1;
        return 0;
      });
    },

    get allBenevolesChecked() {
      return (
        this.benevolesSansInscr.length > 0 &&
        this.selectedBenevolesIds.length === this.benevolesSansInscr.length
      );
    },

    get someBenevolesChecked() {
      return this.selectedBenevolesIds.length > 0;
    },

    toggleAllBenevoles(checked) {
      this.selectedBenevolesIds = checked ? this.benevolesSansInscr.map((u) => u.id) : [];
    },

    sortByBenevoles(field) {
      if (this.sortFieldBenevoles === field) {
        this.sortDirBenevoles = this.sortDirBenevoles === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortFieldBenevoles = field;
        this.sortDirBenevoles = 'asc';
      }
    },

    sortIconBenevoles(field) {
      if (this.sortFieldBenevoles !== field) return '↕';
      return this.sortDirBenevoles === 'asc' ? '↑' : '↓';
    },

    async init() {
      let { user } = await AuthService.getSession();

      if (!user) {
        window.location.href = 'index.html';
        return;
      }
      this.user = user;

      await this.checkAdminRole();
    },

    async checkAdminRole() {
      try {
        const currentUser = /** @type {any} */ (this.user);
        const { data, error } = await ApiService.fetch('benevoles', {
          eq: { user_id: currentUser.id },
        });

        if (error) throw error;

        // Check if user has 'admin'
        if (data && data.some((p) => p.role === 'admin')) {
          this.isAdmin = true;
          await this.loadUsers();
        } else {
          this.isAdmin = false;
          window.location.href = 'index.html';
        }
      } catch (err) {
        console.error('Erreur vérification droits admin:', err);
        this.isAdmin = false;
      } finally {
        this.loading = false;
      }
    },

    async loadUsers() {
      try {
        const [orphelinsRes, benevolesRes] = await Promise.all([
          ApiService.rpc('get_auth_users_without_benevole'),
          ApiService.fetch('admin_benevoles'),
        ]);

        if (orphelinsRes.error) throw orphelinsRes.error;
        if (benevolesRes.error) throw benevolesRes.error;

        this.users = orphelinsRes.data || [];

        // Initialise l'état d'édition du téléphone pour chaque orphelin
        this.editingPhones = {};
        this.users.forEach((u) => {
          this.editingPhones[/** @type {any} */ (u).id] = /** @type {any} */ (u).telephone || '';
        });

        const allBenevoles = benevolesRes.data || [];
        this.benevolesSansInscr = allBenevoles.filter(
          (b) =>
            ['admin', 'referent', 'benevole'].includes(b.role || 'benevole') &&
            (b.nb_inscriptions || 0) === 0
        );
      } catch (err) {
        console.error('Erreur chargement:', err);
        this.showToast('❌ Impossible de charger la liste', 'error');
      }
    },

    copyEmails() {
      const source = this.someChecked
        ? this.users.filter((u) => this.selectedIds.includes(/** @type {any} */ (u).id))
        : this.users;
      if (!source.length) return;
      const emails = source.map((u) => /** @type {any} */ (u).email).join(', ');
      navigator.clipboard
        .writeText(emails)
        .then(() => {
          const nb = source.length;
          this.showToast(
            `✅ ${nb} email${nb > 1 ? 's' : ''} copié${nb > 1 ? 's' : ''} dans le presse-papier !`
          );
        })
        .catch((err) => {
          console.error('Erreur copie presse-papier:', err);
          this.showToast('❌ Erreur lors de la copie des emails', 'error');
        });
    },

    copyEmail(email) {
      if (!email) {
        this.showToast('❌ Aucune adresse email pour ce profil', 'error');
        return;
      }
      navigator.clipboard
        .writeText(email)
        .then(() => {
          this.showToast(`✅ Email copié dans le presse-papier !`);
        })
        .catch((err) => {
          console.error('Erreur copie presse-papier:', err);
          this.showToast("❌ Erreur lors de la copie de l'email", 'error');
        });
    },

    copyBenevolesEmails() {
      const source = this.someBenevolesChecked
        ? this.benevolesSansInscr.filter((u) => this.selectedBenevolesIds.includes(u.id))
        : this.benevolesSansInscr;
      if (!source.length) return;
      const emails = source
        .map((u) => u.email)
        .filter((e) => e)
        .join(', ');
      navigator.clipboard
        .writeText(emails)
        .then(() => {
          const nb = source.length;
          this.showToast(
            `✅ ${nb} email${nb > 1 ? 's' : ''} copié${nb > 1 ? 's' : ''} dans le presse-papier !`
          );
        })
        .catch((err) => {
          console.error('Erreur copie presse-papier:', err);
          this.showToast('❌ Erreur lors de la copie des emails', 'error');
        });
    },

    formatWhatsAppUrl(phone) {
      if (!phone) return '#';
      let cleaned = phone.replace(/[\s\-\.\(\)]/g, '');
      if (cleaned.startsWith('0')) {
        cleaned = '33' + cleaned.slice(1);
      } else if (cleaned.startsWith('+')) {
        cleaned = cleaned.slice(1);
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      return isMobile
        ? `https://wa.me/${cleaned}`
        : `https://web.whatsapp.com/send?phone=${cleaned}`;
    },

    async saveOrphelinPhone(user) {
      if (this.savingPhoneIds.includes(/** @type {any} */ (user).id)) return;
      const phone = this.editingPhones[/** @type {any} */ (user).id] || '';
      this.savingPhoneIds = [...this.savingPhoneIds, /** @type {any} */ (user).id];
      try {
        const { error } = await ApiService.rpc('save_orphelin_phone', {
          p_auth_user_id: /** @type {any} */ (user).id,
          p_telephone: phone,
        });
        if (error) throw error;

        const idx = this.users.findIndex(
          (u) => /** @type {any} */ (u).id === /** @type {any} */ (user).id
        );
        if (idx !== -1) {
          this.users[idx] = { ...this.users[idx], telephone: phone };
          this.users = [...this.users];
        }
        this.showToast(`✅ Téléphone enregistré`);
      } catch (err) {
        console.error('[saveOrphelinPhone] Erreur:', err);
        this.showToast(`❌ ${/** @type {any} */ (err).message}`, 'error');
      } finally {
        this.savingPhoneIds = this.savingPhoneIds.filter(
          (id) => id !== /** @type {any} */ (user).id
        );
      }
    },

    formatDate(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    },

    showToast(message, type = 'success') {
      pushToast(this.toasts, message, type);
    },
  }));
}

initAdminConnexionsApp();
Alpine.start();
