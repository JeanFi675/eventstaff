/**
 * Onglet "Bénévoles" — Phase 5.2.5 (C6).
 *
 * State local : recherche, tri, modales (détails/édition/ajout), formulaires.
 * Lecture store : `benevoles`, `postes`, `periodes`, `loading`.
 *
 * Toasts et rechargements de données passent par `Alpine.store('admin')`.
 */

import Alpine from 'alpinejs';
import { ApiService } from '../../services/api.js';
import { formatTime } from '../../utils/format-date.js';

export function adminBenevolesTab() {
  return {
    // --- State local ---
    searchQuery: '',
    benevolesSort: 'name_asc',
    selectedBenevoleInscriptions: [],
    showDetailsModal: false,
    showEditModal: false,
    selectedBenevoleName: '',
    currentBenevole: null,
    showAddBenevoleModal: false,
    newBenevoleForm: { email: '', nom: '', prenom: '' },
    newInscriptionForm: { periode_id: '', poste_id: '' },

    // --- Proxies store (résolution scope template) ---

    get benevoles() {
      return Alpine.store('admin').benevoles;
    },

    get postes() {
      return Alpine.store('admin').postes;
    },

    get periodes() {
      return Alpine.store('admin').periodes;
    },

    get loading() {
      return Alpine.store('admin').loading;
    },

    set loading(v) {
      Alpine.store('admin').loading = v;
    },

    // --- Stats d'en-tête ---

    getBenevolesStandardAvecInscriptions() {
      return this.benevoles.filter(
        (b) =>
          ['admin', 'referent', 'benevole'].includes(b.role || 'benevole') &&
          (b.nb_inscriptions || 0) > 0
      ).length;
    },

    getBenevolesStandardSansInscriptions() {
      return this.benevoles.filter(
        (b) =>
          ['admin', 'referent', 'benevole'].includes(b.role || 'benevole') &&
          (b.nb_inscriptions || 0) === 0
      ).length;
    },

    // --- Liste filtrée + triée + colorée ---

    getFilteredBenevoles() {
      let filtered = [...this.benevoles];

      if (this.searchQuery) {
        const lowerQuery = this.searchQuery.toLowerCase();
        filtered = filtered.filter(
          (b) =>
            (b.nom && b.nom.toLowerCase().includes(lowerQuery)) ||
            (b.prenom && b.prenom.toLowerCase().includes(lowerQuery)) ||
            (b.email && b.email.toLowerCase().includes(lowerQuery))
        );
      }

      filtered.sort((a, b) => {
        const nameA = ((a.nom || '') + ' ' + (a.prenom || '')).toLowerCase();
        const nameB = ((b.nom || '') + ' ' + (b.prenom || '')).toLowerCase();
        const sortIdentity = nameA.localeCompare(nameB);

        if (this.benevolesSort === 'date_desc') {
          const dateDiff =
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
          return dateDiff !== 0 ? dateDiff : sortIdentity;
        } else if (this.benevolesSort === 'inscriptions_desc') {
          const inscriDiff = (b.nb_inscriptions || 0) - (a.nb_inscriptions || 0);
          return inscriDiff !== 0 ? inscriDiff : sortIdentity;
        } else if (this.benevolesSort === 'role_desc') {
          const roleOrder = { admin: 1, referent: 2, benevole: 3 };
          const roleA = roleOrder[a.role] || 4;
          const roleB = roleOrder[b.role] || 4;
          const roleDiff = roleA - roleB;
          return roleDiff !== 0 ? roleDiff : sortIdentity;
        } else {
          return sortIdentity;
        }
      });

      // Quinconce : par famille (email) si tri name_asc, sinon alterné simple
      let lastEmail = null;
      let isAlt = false;

      return filtered.map((b, index) => {
        if (this.benevolesSort === 'name_asc') {
          const currentEmail = (b.email || '').toLowerCase();
          if (currentEmail !== lastEmail) {
            if (lastEmail !== null) {
              isAlt = !isAlt;
            }
            lastEmail = currentEmail;
          }
        } else {
          isAlt = index % 2 !== 0;
        }

        return { ...b, bgClass: isAlt ? 'bg-gray-100' : 'bg-white' };
      });
    },

    // --- Export Excel (CSV avec BOM UTF-8) ---

    exportBenevolesExcel() {
      const store = Alpine.store('admin');
      const filtered = this.getFilteredBenevoles();
      if (filtered.length === 0) {
        store.showToast('⚠️ Aucun bénévole à exporter.', 'warning');
        return;
      }

      const headers = [
        'Nom',
        'Prénom',
        'Email',
        'Téléphone',
        'Taille T-shirt',
        'Rôle',
        'Club (Type adhésion)',
        'Inscriptions',
        'Postes Référent',
        'Total Cagnotte Matériel (D)',
        'Compte Principal Famille ?',
        'Consommé Global Famille (D)',
        'Reste Global Famille (D)',
        'Cagnotte forcée ?',
        'Créé le',
      ];

      const roleTraduit = {
        admin: '🔐 Administrateur',
        referent: '👔 Référent',
        benevole: '👤 Bénévole',
      };

      const rows = [headers];

      filtered.forEach((b) => {
        const adhesionType = b.adhesion ? b.adhesion.type : '—';
        const roleStr = roleTraduit[b.role] || b.role || '👤 Bénévole';
        const dateStr = b.created_at ? new Date(b.created_at).toLocaleDateString('fr-FR') : '';

        rows.push([
          b.nom || '',
          b.prenom || '',
          b.email || '',
          b.telephone || '',
          b.taille_tshirt || '',
          roleStr,
          adhesionType,
          b.nb_inscriptions || 0,
          b.nb_postes_referent || 0,
          b.cagnotte_total || 0,
          b.is_family_head ? 'Oui' : b.user_id ? 'Non (Membre famille)' : 'Non (Compte unique)',
          b.cagnotte_real_consumed || 0,
          b.cagnotte_solde || 0,
          b.is_cagnotte_forcee
            ? 'Oui (' + (b.cagnotte_forcee_type === 'journee' ? 'Jour' : 'Période') + ')'
            : 'Non',
          dateStr,
        ]);
      });

      const csvContent = rows
        .map((row) =>
          row
            .map((val) => {
              const str = String(val).replace(/"/g, '""');
              return `"${str}"`;
            })
            .join(';')
        )
        .join('\r\n');

      // BOM UTF-8 pour préserver les accents dans Excel Windows
      const bom = '﻿';
      const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('download', `export_benevoles_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        store.showToast('✅ Export Excel réussi !', 'success');
      }
    },

    // --- Formulaire ajout inscription ---

    getPostesForSelectedPeriod() {
      if (!this.newInscriptionForm.periode_id) return [];

      // Inscriptions actuelles du bénévole : ID des postes pris + plages
      // horaires occupées (pour détecter chevauchements et doublons).
      const existing = this.selectedBenevoleInscriptions || [];
      const alreadyRegisteredIds = new Set(existing.map((i) => i.poste_id));
      const occupiedRanges = existing
        .map((i) => ({
          debut: i.postes?.periode_debut ? new Date(i.postes.periode_debut).getTime() : null,
          fin: i.postes?.periode_fin ? new Date(i.postes.periode_fin).getTime() : null,
        }))
        .filter((r) => r.debut !== null && r.fin !== null);

      return (
        this.postes
          .filter((p) => p.periode_id === this.newInscriptionForm.periode_id)
          // Exclure les postes complets (capacité max atteinte)
          .filter((p) => (p.inscrits_actuels || 0) < (p.nb_max || 0))
          // Exclure les postes où le bénévole est déjà inscrit
          .filter((p) => !alreadyRegisteredIds.has(p.id))
          // Exclure les chevauchements horaires avec une autre inscription
          .filter((p) => {
            if (!p.periode_debut || !p.periode_fin) return true;
            const pStart = new Date(p.periode_debut).getTime();
            const pEnd = new Date(p.periode_fin).getTime();
            return !occupiedRanges.some((r) => pStart < r.fin && pEnd > r.debut);
          })
          .sort((a, b) => a.titre.localeCompare(b.titre))
      );
    },

    // --- Modales détails / édition ---

    async viewBenevoleInscriptions(benevole) {
      this.currentBenevole = benevole;
      this.selectedBenevoleName = `${benevole.prenom} ${benevole.nom}`;
      this.selectedBenevoleInscriptions = [];
      this.showDetailsModal = true;
      await this.refreshBenevoleInscriptions();
    },

    async openEditBenevoleInscriptions(benevole) {
      this.currentBenevole = benevole;
      this.selectedBenevoleName = `${benevole.prenom} ${benevole.nom}`;
      this.selectedBenevoleInscriptions = [];
      this.newInscriptionForm = { periode_id: '', poste_id: '' };
      this.showEditModal = true;
      await this.refreshBenevoleInscriptions();
    },

    async refreshBenevoleInscriptions() {
      if (!this.currentBenevole) return;
      const store = Alpine.store('admin');

      try {
        // `postes.titre` a été migré vers `type_postes.titre` (refactor DB).
        // On joint via type_postes pour récupérer le libellé du poste.
        const { data, error } = await ApiService.fetch('inscriptions', {
          select: '*, postes(periode_debut, periode_fin, type_postes(titre), periodes(nom, ordre))',
          eq: { benevole_id: this.currentBenevole.id },
        });

        if (error) throw error;

        this.selectedBenevoleInscriptions = (data || [])
          .map((i) => {
            const debut = i.postes?.periode_debut ? formatTime(i.postes.periode_debut) : '';
            const fin = i.postes?.periode_fin ? formatTime(i.postes.periode_fin) : '';

            return {
              ...i,
              poste_titre: i.postes?.type_postes?.titre || 'Poste inconnu',
              periode_nom: i.postes?.periodes?.nom || 'Période inconnue',
              periode_ordre: i.postes?.periodes?.ordre || 999,
              horaire: debut && fin ? `${debut} - ${fin}` : '',
            };
          })
          .sort((a, b) => a.periode_ordre - b.periode_ordre);
      } catch (error) {
        store.showToast('❌ Erreur chargement inscriptions : ' + error.message, 'error');
      }
    },

    async deleteInscription(inscriptionId) {
      const store = Alpine.store('admin');
      const confirmed = await store.askConfirm(
        'Êtes-vous sûr de vouloir supprimer cette inscription ?',
        "Supprimer l'inscription"
      );
      if (!confirmed) return;

      // Optimistic UI
      const originalList = [...this.selectedBenevoleInscriptions];
      this.selectedBenevoleInscriptions = this.selectedBenevoleInscriptions.filter(
        (i) => i.id !== inscriptionId
      );

      try {
        const { error } = await ApiService.delete('inscriptions', { id: inscriptionId });
        if (error) throw error;

        store.showToast('✅ Inscription supprimée', 'success');

        store.loadBenevolesAndStats();
        store.loadPostes();
      } catch (error) {
        this.selectedBenevoleInscriptions = originalList;
        store.showToast('❌ Erreur suppression : ' + error.message, 'error');
      }
    },

    async addInscription() {
      const store = Alpine.store('admin');

      if (!this.newInscriptionForm.periode_id || !this.newInscriptionForm.poste_id) {
        store.showToast('⚠️ Veuillez sélectionner une période et un poste.', 'warning');
        return;
      }

      const alreadyRegistered = this.selectedBenevoleInscriptions.some(
        (i) => i.poste_id === this.newInscriptionForm.poste_id
      );
      if (alreadyRegistered) {
        store.showToast('⚠️ Ce bénévole est déjà inscrit à ce poste.', 'warning');
        return;
      }

      store.loading = true;
      try {
        const payload = {
          benevole_id: this.currentBenevole.id,
          poste_id: this.newInscriptionForm.poste_id,
        };

        const { error } = await ApiService.insert('inscriptions', payload);
        if (error) throw error;

        store.showToast('✅ Inscription ajoutée !', 'success');

        this.newInscriptionForm = { periode_id: '', poste_id: '' };

        await this.refreshBenevoleInscriptions();
        store.loadBenevolesAndStats();
        store.loadPostes();
      } catch (error) {
        store.showToast('❌ Erreur ajout : ' + error.message, 'error');
      } finally {
        store.loading = false;
      }
    },

    closeInscriptionsModal() {
      this.showDetailsModal = false;
      this.showEditModal = false;
      this.selectedBenevoleInscriptions = [];
      this.selectedBenevoleName = '';
      this.currentBenevole = null;
    },

    // --- Modale ajout bénévole ---

    openAddBenevoleModal() {
      this.newBenevoleForm = { email: '', nom: '', prenom: '' };
      this.showAddBenevoleModal = true;
    },

    closeAddBenevoleModal() {
      this.showAddBenevoleModal = false;
      this.newBenevoleForm = { email: '', nom: '', prenom: '' };
    },

    async createBenevole() {
      const store = Alpine.store('admin');

      if (
        !this.newBenevoleForm.email ||
        !this.newBenevoleForm.nom ||
        !this.newBenevoleForm.prenom
      ) {
        store.showToast('⚠️ Veuillez remplir tous les champs.', 'warning');
        return;
      }

      store.loading = true;
      try {
        const { data, error } = await ApiService.invoke('create-benevole', {
          body: {
            email: this.newBenevoleForm.email,
            nom: this.newBenevoleForm.nom,
            prenom: this.newBenevoleForm.prenom,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const newBenevole = data.benevole;

        store.showToast('✅ Bénévole ajouté avec succès !', 'success');

        this.closeAddBenevoleModal();

        await store.loadBenevolesAndStats();

        // Ouvre directement la modale d'édition pour le nouveau bénévole
        await this.openEditBenevoleInscriptions(newBenevole);
      } catch (error) {
        store.showToast('❌ Erreur création : ' + error.message, 'error');
      } finally {
        store.loading = false;
      }
    },

    // --- Changement de rôle ---

    async updateBenevoleRole(benevoleId, newRole) {
      const store = Alpine.store('admin');

      try {
        const { error } = await ApiService.update(
          'benevoles',
          { role: newRole },
          { id: benevoleId }
        );
        if (error) throw error;

        // Retirer le rôle de référent sur tous ses postes si on rétrograde
        if (newRole !== 'referent') {
          const { error: updatePostesError } = await ApiService.updateMany(
            'postes',
            { referent_id: null },
            { referent_id: benevoleId }
          );
          if (updatePostesError) {
            console.error('Error removing referent from posts:', updatePostesError);
            store.showToast('⚠️ Rôle changé, mais erreur lors du retrait des postes.', 'warning');
          } else {
            await store.loadPostes();
          }
        }

        const roleNames = { benevole: 'Bénévole', referent: 'Référent', admin: 'Admin' };
        store.showToast(`✅ Rôle changé en ${roleNames[newRole]}`, 'success');
        await store.loadBenevolesAndStats();
      } catch (error) {
        store.showToast('❌ Erreur : ' + error.message, 'error');
        await store.loadBenevolesAndStats();
      }
    },
  };
}
