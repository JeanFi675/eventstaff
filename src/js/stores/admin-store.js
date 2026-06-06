/**
 * Alpine.store('admin') — source de vérité du state partagé admin.
 *
 * - Détient le state transverse aux onglets : postes, benevoles, periodes, config, etc.
 * - Détient les loaders cross-onglets et les helpers globaux (toast, getReferents,
 *   calculateStats).
 * - Les composants `Alpine.data('admin<X>Tab', ...)` consomment ce store directement
 *   via `Alpine.store('admin').X` ou via des getters de proxy sur leur scope local.
 *
 * `loadX()` mute `this.X` (state du store) ; mutations via setter → propagation
 * réactive automatique.
 */

import { ApiService } from '../services/api.js';
import { pushToast } from '../utils/toast.js';
import { createConfirmModalState, askConfirm, handleConfirm } from '../utils/confirm.js';

/**
 * Factory de l'objet exposé via `Alpine.store('admin', ...)`.
 * @returns {object} Store admin (state + loaders + helpers).
 */
export function createAdminStore() {
  return {
    // --- State partagé ---
    isAdmin: false,
    loading: true,
    currentUser: null,
    toasts: [],

    // Modale de confirmation (cf. src/js/utils/confirm.js +
    // src/partials/components/confirm-modal.html, inclus dans admin.html).
    confirmModal: createConfirmModalState(),

    postes: [],
    benevoles: [],
    periodes: [],
    dbProgramme: null,
    dbJours: [],
    repasList: [],
    typePostes: [],

    // Liste des jours affichés dans l'onglet visual-creator (et lue par
    // l'onglet cagnotte-forcée). Calculée par `initVisualCreator` à partir
    // de `dbJours`, `dbProgramme`, `postes` et `periodes`, puis mutée par
    // add/deleteVisualDay. Hoistée ici pour partage cross-onglets.
    visualDays: [],

    // Assignations référent ↔ (titre, périodes) reconstruites depuis `postes`
    // au chargement initial. Mutées ensuite par l'onglet referents
    // (`adminReferentsTab`) via add/remove/save.
    referentAssignments: {},

    stats: {
      tshirts: {},
      repas: {},
      cagnotte: {
        total_distribue: 0,
        total_consomme: 0,
        total_restant: 0,
      },
    },

    config: {
      cagnotte_active: false,
      tshirt_question_active: true,
      tarif_cagnotte_journee: 15.0,
      event_title: '',
      event_address: '',
    },

    // --- Dérivés réactifs ---

    // Titres uniques **canoniques** depuis la table `type_postes` — source
    // de vérité métier pour l'onglet referents (permet d'attribuer un référent
    // à un type même s'il n'a pas encore de poste créé).
    get posteTitres() {
      return [...new Set(this.typePostes.map((t) => t.titre).filter(Boolean))].sort();
    },

    // Titres uniques **opérationnels** depuis `postes` (ayant au moins un
    // créneau créé) — sémantique mailing : on ne propose à l'envoi que les
    // types ayant un slot existant.
    get posteTitresWithSlots() {
      return [...new Set(this.postes.map((p) => p.titre).filter(Boolean))].sort();
    },

    // --- Helpers globaux ---

    /**
     * Empile un toast dans `this.toasts` (consommé par `partials/components/toast.html`).
     * @param {string} message
     * @param {'success'|'error'|'warning'|'info'} [type='success']
     * @returns {void}
     */
    showToast(message, type = 'success') {
      pushToast(this.toasts, message, type);
    },

    /**
     * Ouvre la modale de confirmation et retourne une Promise<bool>.
     * @param {string} message
     * @param {string} [title='Confirmation']
     * @returns {Promise<boolean>}
     */
    askConfirm(message, title = 'Confirmation') {
      return askConfirm(this.confirmModal, message, title);
    },

    /** @param {boolean} result */
    handleConfirm(result) {
      handleConfirm(this.confirmModal, result);
    },

    /**
     * Sous-liste des bénévoles éligibles au rôle de référent (referent + admin).
     * @returns {object[]}
     */
    getReferents() {
      return this.benevoles.filter((b) => ['referent', 'admin'].includes(b.role));
    },

    /**
     * Recalcule `this.stats` (tshirts par taille, repas normal/végé, cagnotte distribué/consommé/restant)
     * à partir de `this.benevoles` et `this.repasList`. Idempotent — appelé en fin de `loadBenevolesAndStats`.
     * @returns {void}
     */
    calculateStats() {
      const tshirts = {};
      let total_tshirts = 0;

      const repasStats = {};
      this.repasList.forEach((r) => {
        repasStats[r.id] = {
          nom: r.nom,
          total: 0,
          normal: 0,
          vege: 0,
          question_vege_active: r.question_vege_active !== false,
        };
      });

      this.benevoles.forEach((b) => {
        // T-Shirts : les bénévoles sans inscription n'ont pas de T-shirt.
        const skipTshirt = b.role === 'benevole' && (b.nb_inscriptions || 0) === 0;
        if (!skipTshirt) {
          const size = b.taille_tshirt || 'Non défini';
          tshirts[size] = (tshirts[size] || 0) + 1;
          if (size !== 'SANS' && size !== 'Non défini') {
            total_tshirts++;
          }
        }

        if (b.repas && Array.isArray(b.repas)) {
          b.repas.forEach((ur) => {
            if (!repasStats[ur.repas_id]) {
              repasStats[ur.repas_id] = {
                nom: ur.nom || 'Repas inconnu',
                total: 0,
                normal: 0,
                vege: 0,
                question_vege_active: true,
              };
            }
            repasStats[ur.repas_id].total++;
            if (ur.is_vegetarien) {
              repasStats[ur.repas_id].vege++;
            } else {
              repasStats[ur.repas_id].normal++;
            }
          });
        }
      });

      const total_distribue = this.benevoles.reduce((sum, b) => sum + (b.cagnotte_total || 0), 0);
      const total_restant = this.benevoles.reduce((sum, b) => sum + (b.cagnotte_solde || 0), 0);
      const total_consomme = this.benevoles.reduce(
        (sum, b) => sum + (b.cagnotte_real_consumed || 0),
        0
      );

      const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Non défini'];
      const sortedTshirts = {};
      sizeOrder.forEach((size) => {
        if (tshirts[size]) sortedTshirts[size] = tshirts[size];
      });
      Object.keys(tshirts).forEach((size) => {
        if (!sortedTshirts[size]) sortedTshirts[size] = tshirts[size];
      });

      this.stats = {
        tshirts: sortedTshirts,
        total_tshirts,
        repas: repasStats,
        cagnotte: {
          total_distribue,
          total_consomme,
          total_restant,
        },
      };
    },

    // --- Loaders transverses ---

    /**
     * Charge tout le state admin en parallèle puis reconstruit `referentAssignments`.
     * Appelé une fois au mount (`admin.js → init`).
     * @returns {Promise<void>}
     */
    async loadData() {
      await Promise.all([
        this.loadBenevolesAndStats(),
        this.loadPostes(),
        this.loadPeriodes(),
        this.loadConfig(),
        this.loadRepas(),
        this.loadProgramme(),
        this.loadJours(),
        this.loadTypePostes(),
      ]);
      this.initReferentAssignments();
    },

    /** @returns {Promise<void>} */
    async loadTypePostes() {
      try {
        const { data, error } = await ApiService.fetch('type_postes', {
          select: 'id, titre',
          order: { column: 'titre', ascending: true },
        });
        if (error) throw error;
        this.typePostes = data || [];
      } catch (error) {
        console.error('Erreur chargement type_postes:', error);
      }
    },

    /**
     * Reconstruit `referentAssignments` depuis l'état courant des postes :
     * pour chaque référent, regroupe les postes assignés (referent_id = ref.id)
     * par titre → liste de periode_id. Appelé en fin de `loadData`
     * et exposé pour le bouton "Recharger" de l'onglet referents.
     * @returns {void}
     */
    initReferentAssignments() {
      const assignments = {};
      this.getReferents().forEach((ref) => {
        const refPostes = this.postes.filter((p) => p.referent_id === ref.id);
        const groupedByTitre = {};
        refPostes.forEach((p) => {
          if (!groupedByTitre[p.titre]) groupedByTitre[p.titre] = [];
          groupedByTitre[p.titre].push(p.periode_id);
        });
        const lines = [];
        for (const [titre, periodes] of Object.entries(groupedByTitre)) {
          lines.push({ titre, periodes });
        }
        assignments[ref.id] = lines;
      });
      this.referentAssignments = assignments;
    },

    /** @returns {Promise<void>} */
    async loadJours() {
      try {
        const { data, error } = await ApiService.fetch('jours', {
          order: { column: 'date_ref', ascending: true },
        });
        if (error) throw error;
        this.dbJours = (data || []).map((j) => j.date_ref);
      } catch (error) {
        console.error('Erreur chargement jours:', error);
      }
    },

    /** @returns {Promise<void>} */
    async loadPostes() {
      try {
        const { data, error } = await ApiService.fetch('postes', {
          select:
            '*, type_postes(titre, description, ordre), periodes(nom, ordre), benevoles(prenom, nom)',
        });

        if (error) throw error;

        // Une SEULE requête pour toutes les inscriptions, puis regroupement par poste
        // en mémoire. Auparavant : une requête par poste (~114 appels lancés en rafale
        // = ~3,8 s de chargement à cause de la limite de connexions du navigateur). Le
        // count + la liste des inscrits sont désormais dérivés côté client.
        const { data: inscriptionsData, error: inscriptionsError } = await ApiService.fetch(
          'inscriptions',
          { select: '*, benevoles(prenom, nom)' }
        );
        if (inscriptionsError) throw inscriptionsError;

        const inscriptionsByPoste = new Map();
        for (const inscription of inscriptionsData || []) {
          const existing = inscriptionsByPoste.get(inscription.poste_id);
          if (existing) {
            existing.push(inscription);
          } else {
            inscriptionsByPoste.set(inscription.poste_id, [inscription]);
          }
        }

        const postesWithCounts = (data || []).map((poste) => {
          const inscriptions = inscriptionsByPoste.get(poste.id) || [];
          const count = inscriptions.length;
          const inscrits_ids = inscriptions.map((i) => i.benevole_id);
          const inscrits_noms = inscriptions
            .map((i) => (i.benevoles ? `${i.benevoles.prenom} ${i.benevoles.nom}` : ''))
            .filter(Boolean);

          let referentIdentite = '-';
          if (poste.benevoles) {
            referentIdentite = `${poste.benevoles.prenom} ${poste.benevoles.nom}`;
          }

          return {
            ...poste,
            titre: poste.type_postes?.titre || '',
            description: poste.type_postes?.description || '',
            ordre: poste.type_postes?.ordre || 0,
            periode_nom: poste.periodes?.nom || '-',
            periode_ordre: poste.periodes?.ordre || 999,
            inscrits_actuels: count,
            inscrits_ids,
            inscrits_noms,
            referent_identite: referentIdentite,
          };
        });

        this.postes = postesWithCounts.sort((a, b) => {
          if (a.periode_ordre !== b.periode_ordre) {
            return a.periode_ordre - b.periode_ordre;
          }
          return new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime();
        });
      } catch (error) {
        this.showToast('❌ Erreur chargement postes : ' + error.message, 'error');
      }
    },

    /**
     * Charge la vue `admin_benevoles` + cagnotte (transactions + crédits inscriptions/forced),
     * agrège par famille (`user_id`) avec un seul "head of family" porteur du solde restant,
     * puis déclenche `calculateStats`.
     * @returns {Promise<void>}
     */
    async loadBenevolesAndStats() {
      try {
        const { data: benevoleRaw, error: benevolesError } = await ApiService.fetch(
          'admin_benevoles',
          {
            order: { column: 'email', ascending: true },
          }
        );
        const benevolesData = (benevoleRaw || []).sort((a, b) => {
          const mailA = (a.email || '').toLowerCase();
          const mailB = (b.email || '').toLowerCase();
          if (mailA < mailB) return -1;
          if (mailA > mailB) return 1;
          return (a.prenom || '').localeCompare(b.prenom || '');
        });
        if (benevolesError) throw benevolesError;

        const { data: transactionsData, error: transactionsError } = await ApiService.fetch(
          'cagnotte_transactions',
          {
            select: '*',
          }
        );
        const transactions = transactionsError ? [] : transactionsData || [];

        const { data: inscriptionsData, error: inscriptionsError } = await ApiService.fetch(
          'inscriptions',
          {
            select: 'benevole_id, poste_id, postes(periode_id, periodes(montant_credit))',
          }
        );
        const allInscriptions = inscriptionsError ? [] : inscriptionsData || [];

        const { data: periodesData } = await ApiService.fetch('periodes', {
          select: 'id, montant_credit',
        });

        const userStats = {};
        const benevoleCredits = {};

        const getUserStats = (userId) => {
          if (!userId) return null;
          if (!userStats[userId]) {
            userStats[userId] = {
              inscriptions_credit: 0,
              transactions_solde: 0,
              transaction_debit_abs: 0,
            };
          }
          return userStats[userId];
        };

        const benevoleMap = {};
        (benevolesData || []).forEach((b) => {
          benevoleMap[b.id] = b.user_id;
        });

        allInscriptions.forEach((insc) => {
          if (insc.postes && insc.postes.periodes) {
            const credit = parseFloat(insc.postes.periodes.montant_credit || 0);
            const benevole = (benevolesData || []).find((b) => b.id === insc.benevole_id);
            const isForced = benevole?.is_cagnotte_forcee;
            if (!isForced) {
              benevoleCredits[insc.benevole_id] = (benevoleCredits[insc.benevole_id] || 0) + credit;
              const userId = benevoleMap[insc.benevole_id];
              if (userId) {
                const stats = getUserStats(userId);
                stats.inscriptions_credit += credit;
              }
            }
          }
        });

        // Crédits pour les bénévoles avec cagnotte forcée.
        (benevolesData || [])
          .filter((b) => b.is_cagnotte_forcee)
          .forEach((b) => {
            let creditForced = 0;
            if (b.cagnotte_forcee_type === 'journee') {
              const nbJours = Array.isArray(b.cagnotte_forcee_jours)
                ? b.cagnotte_forcee_jours.length
                : 0;
              creditForced = nbJours * parseFloat(this.config.tarif_cagnotte_journee || 0);
            } else if (b.cagnotte_forcee_type === 'periode') {
              const periodesIds = b.cagnotte_forcee_periodes_ids || [];
              creditForced = (periodesData || [])
                .filter((p) => periodesIds.includes(p.id))
                .reduce((sum, p) => sum + parseFloat(p.montant_credit || 0), 0);
            }

            benevoleCredits[b.id] = creditForced;
            if (b.user_id) {
              const stats = getUserStats(b.user_id);
              stats.inscriptions_credit += creditForced;
            }
          });

        transactions.forEach((t) => {
          const stats = getUserStats(t.user_id);
          if (stats) {
            const amount = parseFloat(t.montant);
            stats.transactions_solde += amount;
            if (amount < 0) {
              stats.transaction_debit_abs += Math.abs(amount);
            } else {
              stats.inscriptions_credit += amount;
            }
          }
        });

        // Head of family pour affichage Consommé/Restant (un seul porteur par user_id).
        const familyHeadMap = {};
        (benevolesData || []).forEach((b) => {
          if (b.user_id && !familyHeadMap[b.user_id]) {
            familyHeadMap[b.user_id] = b.id;
          }
        });

        this.benevoles = (benevolesData || []).map((b) => {
          const userId = b.user_id;
          const earned_individuel = benevoleCredits[b.id] || 0;

          let dispo = 0;
          let total_consomme = 0;
          let is_family_head = false;
          const has_family = !!userId;

          if (userId && userStats[userId]) {
            const stats = userStats[userId];
            if (familyHeadMap[userId] === b.id) {
              is_family_head = true;
              total_consomme = stats.transaction_debit_abs;
              const family_total_credit = stats.inscriptions_credit;
              const balance = family_total_credit - total_consomme;
              dispo = Math.max(0, balance);
            }
          }

          return {
            ...b,
            cagnotte_total: earned_individuel,
            cagnotte_solde: dispo,
            cagnotte_real_consumed: total_consomme,
            is_family_head,
            has_family,
          };
        });

        this.calculateStats();
      } catch (error) {
        console.error(error);
        this.showToast('❌ Erreur chargement bénévoles/cagnotte : ' + error.message, 'error');
      }
    },

    /** @returns {Promise<void>} */
    async loadPeriodes() {
      try {
        const { data, error } = await ApiService.fetch('periodes', {
          order: { column: 'ordre', ascending: true },
        });
        if (error) throw error;
        this.periodes = data || [];
      } catch (error) {
        this.showToast('❌ Erreur chargement périodes : ' + error.message, 'error');
      }
    },

    /** @returns {Promise<void>} */
    async loadProgramme() {
      try {
        const { data, error } = await ApiService.fetch('programmes', {
          order: { column: 'heure', ascending: true },
        });
        if (error) throw error;
        if (data && data.length > 0) {
          const days = {};
          data.forEach((item) => {
            const dateKey = item.date_ref;
            if (!days[dateKey]) {
              const d = new Date(dateKey + 'T00:00:00');
              const label = d.toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              });
              days[dateKey] = { label, events: [] };
            }

            const [h, m] = item.heure.split(':');
            const hStart = parseInt(h) + parseInt(m) / 60;
            const timeLabel = `${h}h${m}`;

            days[dateKey].events.push({
              num: days[dateKey].events.length + 1,
              timeLabel,
              hStart,
              description: item.description,
              id: item.id,
            });
          });
          this.dbProgramme = { meta: [], days };
        } else {
          this.dbProgramme = null;
        }
      } catch (err) {
        console.error('Erreur chargement programme de la DB :', err.message);
        this.dbProgramme = null;
      }
    },

    /** @returns {Promise<void>} */
    async loadConfig() {
      try {
        const { data, error } = await ApiService.fetch('config', {
          in: {
            key: [
              'cagnotte_active',
              'tarif_cagnotte_journee',
              'tshirt_question_active',
              'event_title',
              'event_address',
            ],
          },
        });
        if (error) throw error;

        if (data && data.length > 0) {
          const cagnotteActive = data.find((c) => c.key === 'cagnotte_active');
          if (cagnotteActive) this.config.cagnotte_active = cagnotteActive.value;

          const tshirt = data.find((c) => c.key === 'tshirt_question_active');
          if (tshirt) this.config.tshirt_question_active = tshirt.value;

          const tarifJournee = data.find((c) => c.key === 'tarif_cagnotte_journee');
          if (tarifJournee) this.config.tarif_cagnotte_journee = parseFloat(tarifJournee.value);

          const eventTitle = data.find((c) => c.key === 'event_title');
          if (eventTitle) this.config.event_title = eventTitle.value || '';

          const eventAddress = data.find((c) => c.key === 'event_address');
          if (eventAddress) this.config.event_address = eventAddress.value || '';
        }
      } catch (error) {
        console.error('Error loading config:', error);
        this.showToast('⚠️ Erreur chargement configuration', 'warning');
      }
    },

    /** @returns {Promise<void>} */
    async loadRepas() {
      try {
        const { data, error } = await ApiService.fetch('repas', {
          order: { column: 'created_at', ascending: true },
        });
        if (error) throw error;
        this.repasList = data || [];
      } catch (error) {
        this.showToast('❌ Erreur chargement repas : ' + error.message, 'error');
      }
    },
  };
}
