import { ApiService } from '../../services/api.js';
import { AuthService } from '../../services/auth.js';

/**
 * Module for the Registration Wizard.
 * @namespace WizardModule
 */
export const WizardModule = {
  wizardOpen: false,
  wizardStep: 1,
  wizardSelectedProfileId: '',
  wizardPeriodIndex: 0,
  wizardSelections: [], // Array of objects: { key, posteId, profileId, ... }
  wizardRemovals: [], // Array of keys: strings "posteId-profileId"
  showWizardProfileForm: false,
  showPostCreationModal: false,
  modalTitle: '',
  wizardProfileForm: {
    id: null,
    prenom: '',
    nom: '',
    telephone: '',
    taille_tshirt: '',
    repas: [], // Array of { repas_id, is_vegetarien }
  },

  // Data for public view
  publicInscriptions: [], // Stores { poste_id, formatted_name }

  // Computeds converted to Methods for Alpine Mixin compatibility
  getWizardPeriods() {
    if (!this.postes || this.postes.length === 0) return [];
    const periods = [...new Set(this.postes.map((p) => p.periode))];
    return periods.sort((a, b) => {
      const pA = this.postes.find((p) => p.periode === a);
      const pB = this.postes.find((p) => p.periode === b);
      return (Number(pA?.periode_ordre) || 0) - (Number(pB?.periode_ordre) || 0);
    });
  },

  getCurrentWizardPeriodName() {
    const periods = this.getWizardPeriods();
    if (!periods.length) return '';
    return periods[this.wizardPeriodIndex] || '';
  },

  getWizardGroups() {
    const period = this.getCurrentWizardPeriodName();
    if (!period) return [];

    const methodPosts = this.postes.filter((p) => p.periode === period);

    const subgroups = [
      {
        id: 'critical',
        title: '⚠️ Postes Prioritaires (Manque de bénévoles)',
        expanded: true,
        postes: [],
      },
      { id: 'open', title: '✅ Inscriptions Ouvertes', expanded: true, postes: [] },
      { id: 'full', title: '🔒 Postes Complets', expanded: false, postes: [] },
    ];

    methodPosts.forEach((poste) => {
      // enrich with volunteer names
      const names = this.publicInscriptions
        .filter((i) => i.poste_id === poste.poste_id)
        .map((i) => i.formatted_name);

      // Allow mutation of the object for display purposes,
      // or create a lightweight copy to avoid side effects if 'postes' is frozen (likely not).
      // Direct mutation is easiest for Alpine reactivity if 'postes' is reactive.
      poste.liste_benevoles = names;

      const min = poste.nb_min || 0;
      const max = poste.nb_max || 0;
      const current = poste.inscrits_actuels || 0;

      if (current < min) subgroups[0].postes.push(poste);
      else if (current >= max) subgroups[2].postes.push(poste);
      else subgroups[1].postes.push(poste);
    });

    subgroups.forEach((group) =>
      group.postes.sort(
        (a, b) => new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime()
      )
    );
    return subgroups.filter((g) => g.postes.length > 0);
  },

  openWizard() {
    if (!this.user) return;
    this.wizardOpen = true;
    this.wizardStep = 1;
    this.wizardPeriodIndex = 0;
    this.showPostCreationModal = false;
    if (this.profiles && this.profiles.length === 1) {
      this.wizardSelectedProfileId = this.profiles[0].id;
    }

    // Load public inscriptions when opening
    this.loadPublicInscriptions();
  },

  async loadPublicInscriptions() {
    try {
      const { data, error } = await ApiService.rpc('get_public_inscriptions');
      if (error) throw error;
      this.publicInscriptions = data || [];
    } catch (err) {
      console.error('Error loading public inscriptions:', err);
      // Non-blocking error, we just don't show names
    }
  },

  /**
   * Opens the wizard and pre-selects a poste (Action from Dashboard).
   * @param {string} posteId
   * @param {string} [profileId]
   * @param {'register'|'unregister'} [action='register']
   */
  async openWizardWithContext(posteId, profileId, action = 'register') {
    this.openWizard();

    // Ensure profiles are loaded to avoid false Step 1 (Creation)
    if ((!this.profiles || this.profiles.length === 0) && this.loadProfiles) {
      await this.loadProfiles();
    }

    // Move to Step 2 (Choice) directly if profiles exist
    if (this.profiles && this.profiles.length > 0) {
      this.wizardStep = 2;
    }

    // Find the period index for this poste to show the right slide
    const targetPoste = this.postes.find((p) => p.poste_id === posteId);
    if (targetPoste) {
      const periods = this.getWizardPeriods();
      const pIndex = periods.indexOf(targetPoste.periode);
      if (pIndex !== -1) this.wizardPeriodIndex = pIndex;

      // Perform the action (Optimistic Add/Remove to Basket)
      // We need a profile ID. If not provided, and user has 1 profile, use it.
      // If user has multiple profiles, we can't auto-add without clarification,
      // BUT for UX we might want to just open the wizard at the right place.

      let effectiveProfileId = profileId;
      if (!effectiveProfileId && this.profiles.length === 1) {
        effectiveProfileId = this.profiles[0].id;
      }

      if (effectiveProfileId) {
        if (action === 'register') {
          await this.wizardRegister(posteId, effectiveProfileId);
        } else if (action === 'unregister') {
          this.wizardUnregister(posteId, effectiveProfileId);
        }
      } else {
        // If multiple profiles and no forced profile, we can't auto-register blindly.
        // But we navigated to the correct period, so the user can just click.
        if (action === 'register') {
          this.showToast('Veuillez sélectionner le bénévole pour ce poste.', 'info');
        }
      }
    }
  },

  async closeWizard() {
    if (this.wizardSelections.length > 0 || this.wizardRemovals.length > 0) {
      const confirmed = await this.askConfirm(
        "Attention, vos choix dans l'assistant seront perdus. Continuer ?",
        "Fermer l'assistant"
      );
      if (!confirmed) return;

      // Revert Optimistic Updates manually to ensure immediate UI consistency
      // 1. Revert Removals (Add back)
      this.wizardRemovals.forEach((key) => {
        const [posteId] = key.split('::');
        const poste = this.postes.find((p) => p.poste_id == posteId);
        if (poste) poste.inscrits_actuels++;
      });

      // 2. Revert Selections (Remove added)
      // Note: We only decrement if it was a NEW selection (key in wizardSelections)
      this.wizardSelections.forEach((sel) => {
        const poste = this.postes.find((p) => p.poste_id == sel.posteId);
        if (poste) poste.inscrits_actuels--;
      });
    }

    this.resetWizard();
    this.wizardOpen = false;
    // Mémoriser que l'utilisateur a fermé l'assistant pour cette session
    if (this.user) {
      sessionStorage.setItem('wizard_dismissed_' + this.user.id, 'true');
    }
    // Still reload to be safe, but UI is fixed instantly
    this.loadPostes();
  },

  resetWizard() {
    this.wizardSelections = [];
    this.wizardRemovals = [];
    this.wizardStep = 1;
    this.wizardSelectedProfileId = '';
    this.wizardPeriodIndex = 0;
    this.showPostCreationModal = false;
    this.cancelWizardEdit();
  },

  /**
   * Scrolls the wizard content area to the top.
   */
  scrollWizardToTop() {
    const scroller = document.querySelector('.wizard-content-scroller');
    if (scroller) scroller.scrollTop = 0;
  },

  prevPeriod() {
    if (this.wizardPeriodIndex > 0) this.wizardPeriodIndex--;
    this.scrollWizardToTop();
  },

  nextPeriod() {
    if (this.wizardPeriodIndex < this.getWizardPeriods().length - 1) this.wizardPeriodIndex++;
    this.scrollWizardToTop();
  },

  // --- Profile Management (Wizard) ---

  editWizardProfile(profileId) {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    this.wizardProfileForm = {
      id: profile.id,
      prenom: profile.prenom,
      nom: profile.nom,
      telephone: profile.telephone,
      taille_tshirt: profile.taille_tshirt,
      repas: (profile.benevole_repas || []).map((r) => ({
        repas_id: r.repas_id,
        is_vegetarien: r.is_vegetarien,
      })),
    };
    this.showWizardProfileForm = true;
  },

  cancelWizardEdit() {
    this.loading = false; // FIX: s'assurer que loading est libéré si on annule
    this.showWizardProfileForm = false;
    this.wizardProfileForm = {
      id: null,
      prenom: '',
      nom: '',
      telephone: '',
      taille_tshirt: '',
      repas: [],
    };
  },

  async createProfileAndContinue() {
    if (!this.user) return;
    const f = this.wizardProfileForm;
    if (
      !f.prenom ||
      !f.nom ||
      !f.telephone ||
      (this.config.tshirt_question_active && !f.taille_tshirt)
    ) {
      this.showToast('❌ Veuillez remplir tous les champs', 'error');
      return;
    }

    this.loading = true;
    const safetyTimeout = setTimeout(() => {
      if (this.loading) {
        this.loading = false;
        this.showToast('❌ Le serveur met du temps à répondre. Veuillez réessayer.', 'error');
      }
    }, 8000);

    try {
      const payload = {
        user_id: this.user.id,
        email: this.user.email,
        prenom: f.prenom,
        nom: f.nom,
        telephone: f.telephone,
        taille_tshirt: f.taille_tshirt || 'SANS',
      };

      if (f.id) {
        payload.id = f.id;
      }

      const { data, error } = await ApiService.upsert('benevoles', payload);

      if (error) throw error;

      const benevoleId = f.id || (data ? data.id : null);

      if (benevoleId) {
        // 1. Déterminer les IDs des repas actuellement actifs/affichés dans le store
        const activeRepasIds = (this.repasList || []).map((r) => r.id);

        if (activeRepasIds.length > 0) {
          // Supprimer uniquement les choix associés aux repas actifs
          const { error: deleteError } = await ApiService.delete('benevole_repas', {
            benevole_id: benevoleId,
            repas_id: activeRepasIds,
          });
          if (deleteError) throw deleteError;

          // 2. Insérer uniquement les choix cochés faisant partie des repas actifs
          if (f.repas && f.repas.length > 0) {
            const repasPayload = f.repas
              .filter((r) => activeRepasIds.includes(r.repas_id))
              .map((r) => {
                // Si la question végé est désactivée pour ce repas, on force false
                // (la case est masquée côté UI ; on évite de persister un ancien true).
                const repasDef = (this.repasList || []).find((rl) => rl.id === r.repas_id);
                const vegeAllowed = !repasDef || repasDef.question_vege_active !== false;
                return {
                  benevole_id: benevoleId,
                  repas_id: r.repas_id,
                  is_vegetarien: vegeAllowed ? r.is_vegetarien : false,
                };
              });

            if (repasPayload.length > 0) {
              const { error: insertError } = await ApiService.insert(
                'benevole_repas',
                repasPayload
              );
              if (insertError) throw insertError;
            }
          }
        }
      }

      await this.loadProfiles();

      const newId = f.id || (data ? data.id : null);
      if (newId) this.wizardSelectedProfileId = newId;

      if (f.id) {
        this.showToast('✅ Profil mis à jour !', 'success');
        this.showWizardProfileForm = false;
        this.wizardProfileForm = {
          id: null,
          prenom: '',
          nom: '',
          telephone: '',
          taille_tshirt: '',
          repas: [],
        };
      } else {
        this.showToast('✅ Profil créé !', 'success');
        this.showPostCreationModal = true;
        this.showWizardProfileForm = false;
      }

      clearTimeout(safetyTimeout);
    } catch (error) {
      clearTimeout(safetyTimeout);
      this.showToast('❌ Erreur : ' + error.message, 'error');
      this.loading = false;
    } finally {
      clearTimeout(safetyTimeout);
      this.loading = false;
    }
  },

  handlePostProfileCreation(choice) {
    this.loading = false;
    this.showPostCreationModal = false;
    if (choice === 'add') {
      this.wizardProfileForm = {
        id: null,
        prenom: '',
        nom: '',
        telephone: '',
        taille_tshirt: '',
        repas: [],
      };
      this.showWizardProfileForm = true;
    } else {
      this.wizardStep = 2;
      this.scrollWizardToTop();
    }
  },

  /**
   * Helpers pour l'édition dynamique des repas dans l'assistant.
   */
  isWizardRepasSelected(repasId) {
    return (
      this.wizardProfileForm.repas &&
      this.wizardProfileForm.repas.some((r) => r.repas_id === repasId)
    );
  },

  isWizardRepasVege(repasId) {
    const r =
      this.wizardProfileForm.repas &&
      this.wizardProfileForm.repas.find((r) => r.repas_id === repasId);
    return r ? r.is_vegetarien : false;
  },

  toggleWizardRepas(repasId, checked) {
    if (!this.wizardProfileForm.repas) this.wizardProfileForm.repas = [];
    if (checked) {
      if (!this.wizardProfileForm.repas.some((r) => r.repas_id === repasId)) {
        this.wizardProfileForm.repas.push({ repas_id: repasId, is_vegetarien: false });
      }
    } else {
      this.wizardProfileForm.repas = this.wizardProfileForm.repas.filter(
        (r) => r.repas_id !== repasId
      );
    }
  },

  setWizardRepasVege(repasId, vege) {
    if (!this.wizardProfileForm.repas) this.wizardProfileForm.repas = [];
    const r = this.wizardProfileForm.repas.find((r) => r.repas_id === repasId);
    if (r) {
      r.is_vegetarien = vege;
    }
  },

  // --- Basket Logic (REFACTORED TO ARRAYS) ---

  async wizardRegister(posteId, profileId) {
    try {
      const key = `${posteId}::${profileId}`;

      // Check if already selected locally
      if (this.wizardSelections.some((s) => s.key === key)) return;

      const targetPoste = this.postes.find((p) => p.poste_id === posteId);
      if (!targetPoste) return;

      if (targetPoste.inscrits_actuels >= targetPoste.nb_max) {
        this.showToast('Ce poste est complet.', 'error');
        return;
      }

      // --- Priority Check Logic (Condensed) ---
      if (targetPoste.inscrits_actuels >= targetPoste.nb_min) {
        const targetStart = new Date(targetPoste.periode_debut).getTime();
        const targetEnd = new Date(targetPoste.periode_fin).getTime();
        const hasUnderfilledPostes = this.postes.some((other) => {
          if (other.poste_id === targetPoste.poste_id) return false;
          const otherStart = new Date(other.periode_debut).getTime();
          const otherEnd = new Date(other.periode_fin).getTime();
          const sameSlot =
            Math.abs(otherStart - targetStart) < 60000 && Math.abs(otherEnd - targetEnd) < 60000;
          return sameSlot && other.inscrits_actuels < other.nb_min;
        });

        if (hasUnderfilledPostes && typeof this.askConfirm === 'function') {
          const confirmed = await this.askConfirm(
            "Le nombre minimum de bénévoles pour ce poste est déjà atteint, alors que d'autres postes sur ce créneau horaire ont encore besoin de monde. Êtes-vous sûr de vouloir maintenir ce choix ?",
            'Attention : Besoins prioritaires'
          );
          if (!confirmed) return;
        }
      }

      // Remove from removals if present (undo delete)
      if (this.wizardRemovals.includes(key)) {
        this.wizardRemovals = this.wizardRemovals.filter((k) => k !== key);
      } else {
        // Add to selections
        this.wizardSelections.push({
          key,
          posteId,
          profileId,
          posteTitle: targetPoste.titre,
          debut: targetPoste.periode_debut,
          fin: targetPoste.periode_fin,
          profileName: this.profiles.find((p) => p.id === profileId)?.prenom,
        });
      }

      targetPoste.inscrits_actuels++;
    } catch (error) {
      console.error(error);
      alert('Erreur: ' + error.message);
    }
  },

  wizardUnregister(posteId, profileId) {
    const key = `${posteId}::${profileId}`;

    // 1. Check if it's a new local selection -> Remove it
    const selectionIndex = this.wizardSelections.findIndex((s) => s.key === key);
    if (selectionIndex !== -1) {
      this.wizardSelections.splice(selectionIndex, 1); // Mutate array triggers reactivity
      const targetPoste = this.postes.find((p) => p.poste_id === posteId);
      if (targetPoste) targetPoste.inscrits_actuels--;
      return;
    }

    // 2. If it's in DB -> Add to removals
    if (!this.wizardRemovals.includes(key)) {
      this.wizardRemovals.push(key);
      const targetPoste = this.postes.find((p) => p.poste_id === posteId);
      if (targetPoste) targetPoste.inscrits_actuels--;
    }
  },

  getRemovalDetailsList() {
    return this.wizardRemovals.map((key) => {
      const [posteId, profileId] = key.split('::');
      // Use loose equality (==) because split returns strings, but IDs might be integers
      const poste = this.postes.find((p) => p.poste_id == posteId);
      const profile = this.profiles.find((p) => p.id == profileId);
      return {
        key,
        posteId,
        profileId,
        posteTitle: poste ? poste.titre : 'inconnu',
        profileName: profile ? profile.prenom : 'inconnu',
        debut: poste ? poste.periode_debut : null,
        fin: poste ? poste.periode_fin : null,
      };
    });
  },

  async submitWizard() {
    if (this.wizardSelections.length === 0 && this.wizardRemovals.length === 0) {
      this.showToast('Aucune modification à enregistrer.', 'info');
      this.closeWizard(); // Ensure we close even if no changes
      return;
    }

    this.loading = true;

    // 1. Safety Timeout (Extended to 60s)
    const SAFETY_TIMEOUT_MS = 60000;
    const safetyTimeout = setTimeout(() => {
      if (this.loading) {
        console.error('Safety Timeout Triggered');
        this.loading = false;
        this.showToast('❌ Le serveur met du temps à répondre (Timeout 60s).', 'error');
      }
    }, SAFETY_TIMEOUT_MS);

    try {
      // 2. FORCE REFRESH SESSION (Security)
      // Critical: If user stayed on page for >5min, token might be expired or invalid/concurrently refreshed.
      // We force a refresh to ensure we have a valid access_token before sending data.

      // SECURITY: Refresh obligatoire avec retry (10s timeout, 2 tentatives)
      let sessionValid = false;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const refreshResult = await Promise.race([
            AuthService.refreshSession(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Refresh timeout (10s)')), 10000)
            ),
          ]); // 10s is generous but safe

          if (!refreshResult.error && refreshResult.data?.session) {
            sessionValid = true;
            break;
          }
          console.error(`Refresh tentative ${attempt} échouée:`, refreshResult.error);
        } catch (e) {
          console.error(`Refresh tentative ${attempt} exception:`, e.message);
        }
      }

      if (!sessionValid) {
        console.error('Session refresh failed after retries.');
        this.loading = false;
        clearTimeout(safetyTimeout);
        this.showToast('⚠️ Session expirée. Veuillez recharger la page.', 'error');
        return;
      }

      // 3. Prepare Payload for RPC
      const modifications = [];

      // Add Removals
      this.wizardRemovals.forEach((key) => {
        const [posteId, profileId] = key.split('::');
        modifications.push({ action: 'remove', poste_id: posteId, benevole_id: profileId });
      });

      // Add Selections
      this.wizardSelections.forEach((sel) => {
        modifications.push({ action: 'add', poste_id: sel.posteId, benevole_id: sel.profileId });
      });

      // CRITICAL: Sort by poste_id to prevent DB Deadlocks (Lock Order Policy)
      modifications.sort((a, b) => a.poste_id.localeCompare(b.poste_id));

      if (modifications.length === 0) {
        this.loading = false;
        clearTimeout(safetyTimeout);
        return;
      }

      // 4. Call RPC (Single Transaction)
      const { error } = await ApiService.rpc('manage_inscriptions_transaction', {
        target_user_id: this.user.id, // Optional, checked by RLS/Security Definer anyway
        modifications: modifications,
      });

      if (error) {
        console.error('Transaction Error:', error);
        throw error;
      }

      // 5. Success Handling
      this.showToast('🎉 Inscriptions mises à jour avec succès !', 'success');

      // UX: Close immediately so user doesn't wait for data reload
      this.resetWizard();
      this.closeWizard();
      this.loading = false;

      await this.loadInitialData();

      window.dispatchEvent(new CustomEvent('cagnotte-refresh'));
    } catch (error) {
      console.error('Submit Error Caught:', error);
      let msg = error.message || error;

      // User-friendly error mapping
      if (msg.includes('Permission refusée')) msg = 'Vous ne pouvez pas modifier ces inscriptions.';
      if (msg.includes('complet')) msg = 'Certains postes sont désormais complets.';
      if (msg.includes('Conflit horaire')) msg = "Conflit d'horaire détecté.";

      this.showToast('Erreur: ' + msg, 'error');
    } finally {
      clearTimeout(safetyTimeout);
      this.loading = false;
    }
  },

  /**
   * Hook to run after initial data load to auto-open wizard.
   */
  checkWizardAutoOpen() {
    if (!this.user) return;

    // CRITICAL: Do not auto-open (and reset step!) if already open.
    // This prevents the polling from interrupting the user's flow.
    if (this.wizardOpen) {
      return;
    }

    // Check if the user voluntarily dismissed the wizard in this active tab session
    const dismissedKey = 'wizard_dismissed_' + this.user.id;
    const hasDismissedInSession = sessionStorage.getItem(dismissedKey);

    const hasProfiles = this.profiles && this.profiles.length > 0;

    // Check if there are VALID inscriptions (linking to an existing profile)
    // This handles cases where a profile was deleted but inscriptions remain (orphans)
    const hasInscriptions =
      this.userInscriptions &&
      this.userInscriptions.some((ins) => {
        return this.profiles.some((p) => p.id === ins.benevole_id);
      });

    // Condition: Open if (No Profiles) OR (No Inscriptions)
    // But respect the session dismissal if the user clicked the close button (X/Annuler)

    if (!hasDismissedInSession && (!hasProfiles || !hasInscriptions)) {
      this.openWizard();
    }
  },
};
