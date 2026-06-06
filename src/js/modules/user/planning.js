import { ApiService } from '../../services/api.js';
import { AuthService } from '../../services/auth.js';
import { formatDate, formatTime } from '../../utils/format-date.js';

/**
 * Module for managing planning and inscriptions.
 * @namespace PlanningModule
 */
export const PlanningModule = {
  postes: [],
  userInscriptions: [],
  showMyInscriptions: true,
  showOnlyAvailable: false,
  selectedVolunteerId: '', // For filtering in "Mes inscriptions" view

  // Referent View State
  showReferentView: false,
  referentInscriptions: [],
  referentProfiles: [],
  selectedReferentProfileId: null,
  showReferentSelectionModal: false,
  viewMode: window.innerWidth >= 768 ? 'week' : 'list', // Responsive Default
  calendarPage: 0,
  itemsPerPage: 4,
  PIXELS_PER_HOUR: 35,
  START_HOUR: 6, // 06:00
  END_HOUR: 28, // 04:00 next day (24 + 4)

  // Expose utils to template
  formatDate,
  formatTime,

  formatWhatsAppUrl(phone) {
    if (!phone) return '#';
    let cleaned = phone.replace(/[\s\-\.\(\)]/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '33' + cleaned.slice(1);
    } else if (cleaned.startsWith('+')) {
      cleaned = cleaned.slice(1);
    }
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return isMobile ? `https://wa.me/${cleaned}` : `https://web.whatsapp.com/send?phone=${cleaned}`;
  },

  /**
   * Calculates the style for a poste in the calendar view.
   * @param {object} poste - The poste to position.
   * @returns {string} The style string (top, height).
   */
  getPosteStyle(poste) {
    const start = new Date(poste.periode_debut);
    const end = new Date(poste.periode_fin);

    // Calculate hours from start of day (START_HOUR)
    let startHour = start.getHours() + start.getMinutes() / 60;
    let endHour = end.getHours() + end.getMinutes() / 60;

    // Handle crossing midnight
    if (startHour < this.START_HOUR) startHour += 24;
    if (endHour < this.START_HOUR) endHour += 24;
    if (endHour < startHour) endHour += 24; // Should be covered by above, but safety

    const top = (startHour - this.START_HOUR) * this.PIXELS_PER_HOUR;
    const duration = endHour - startHour;
    const height = duration * this.PIXELS_PER_HOUR;

    return `top: ${top}px; height: ${height}px; position: absolute; width: 100%;`;
  },

  /**
   * Calculates the total height of the calendar container.
   * @returns {string} The height in pixels.
   */
  getCalendarHeight() {
    const totalHours = this.END_HOUR - this.START_HOUR;
    return totalHours * this.PIXELS_PER_HOUR + 'px';
  },

  toggleReferentView() {
    this.showReferentView = !this.showReferentView;
    if (this.showReferentView) {
      this.showMyInscriptions = false;
      this.referentInscriptions = []; // Reset previous data
      this.loading = true; // Show loading state

      // Identify which profiles are referents
      this.referentProfiles = this.profiles.filter((profile) =>
        this.postes.some((p) => p.referent_id === profile.id)
      );

      if (this.referentProfiles.length > 1) {
        this.loading = false; // Stop loading if waiting for selection
        // If multiple, show modal to choose
        this.showReferentSelectionModal = true;
      } else if (this.referentProfiles.length === 1) {
        // If only one, select it automatically
        this.selectedReferentProfileId = this.referentProfiles[0].id;
        this.loadReferentInscriptions();
      } else {
        this.loading = false; // No profiles
      }
    }
  },

  selectReferent(profileId) {
    this.selectedReferentProfileId = profileId;
    this.showReferentSelectionModal = false;
    this.loadReferentInscriptions();
  },

  /**
   * Returns unique referents from the currently filtered postes.
   */
  getMyReferentsList() {
    // 1. Get visible dates (same logic as getCalendarData)
    const sortedDates = this._getSortedActiveDates();
    const start = this.calendarPage * this.itemsPerPage;
    const visibleDates = sortedDates.slice(start, start + this.itemsPerPage);
    const visibleDateStrings = new Set(visibleDates.map((d) => d.toDateString()));

    const referents = new Map();

    // 2. Filter source posts: Registered AND Visible on current page
    const myPostes = this.postes.filter((poste) => {
      const isReg = this.isUserRegistered(poste.poste_id);
      const pDate = new Date(poste.periode_debut).toDateString();
      const isVisible = visibleDateStrings.has(pDate);
      return isReg && isVisible;
    });

    myPostes.forEach((poste) => {
      if (poste.referent_id && poste.referent_nom) {
        if (!referents.has(poste.referent_id)) {
          referents.set(poste.referent_id, {
            id: poste.referent_id,
            nom: poste.referent_nom,
            email: poste.referent_email,
            telephone: poste.referent_telephone,
            posts: [],
          });
        }
        const ref = referents.get(poste.referent_id);
        // Avoid duplicates if multiple slots have same title
        if (!ref.posts.includes(poste.titre)) {
          ref.posts.push(poste.titre);
        }
      }
    });
    return Array.from(referents.values());
  },

  /**
   * Helper to get all unique active dates based on current filters.
   */
  _getSortedActiveDates() {
    const sourcePostes = this.filteredPostes();
    if (sourcePostes.length === 0) return [];

    const uniqueDates = new Set();
    sourcePostes.forEach((p) => {
      const date = new Date(p.periode_debut);
      date.setHours(0, 0, 0, 0);
      uniqueDates.add(date.getTime());
    });

    return Array.from(uniqueDates)
      .sort((a, b) => a - b)
      .map((time) => new Date(time));
  },

  /**
   * Prepares data for the weekly calendar view.
   * Groups: Day -> Profile -> Postes
   * PAGINATED: Returns only itemsPerPage days.
   */
  getCalendarData() {
    const sortedDates = this._getSortedActiveDates();

    // Pagination logic
    const start = this.calendarPage * this.itemsPerPage;
    const visibleDates = sortedDates.slice(start, start + this.itemsPerPage);

    // Use the same source as dates to ensure consistency
    const sourcePostes = this.filteredPostes();

    // Build Data Structure
    return visibleDates.map((day) => {
      const dayStr = day.toDateString();

      // For each profile, find their shifts on this day
      const profilesData = (this.profiles || []).map((profile) => {
        const profilePostes = sourcePostes.filter((poste) => {
          const pDate = new Date(poste.periode_debut);
          const isSameDay = pDate.toDateString() === dayStr;
          const isRegistered = this.isProfileRegistered(poste.poste_id, profile.id);
          return isSameDay && isRegistered;
        });

        // Sort by time
        profilePostes.sort(
          (a, b) => new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime()
        );

        return {
          profile: profile,
          postes: profilePostes,
        };
      });

      return {
        date: day,
        formattedDate: day.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        }),
        profiles: profilesData,
      };
    });
  },

  nextPage() {
    if (this.hasNextPage()) {
      this.calendarPage++;
    }
  },

  prevPage() {
    if (this.hasPrevPage()) {
      this.calendarPage--;
    }
  },

  hasNextPage() {
    const totalDays = this._getSortedActiveDates().length;
    return (this.calendarPage + 1) * this.itemsPerPage < totalDays;
  },

  hasPrevPage() {
    return this.calendarPage > 0;
  },

  /**
   * Loads all public planning postes.
   */
  async loadPostes() {
    try {
      const { data, error } = await ApiService.fetch('public_planning', {
        select: '*, inscrits_actuels:nb_inscrits_actuels',
        order: { column: 'periode_debut', ascending: true },
      });

      if (error) throw error;
      this.postes = data || [];

      // Immediately reconcile if we already have user inscriptions loaded
      if (this.userInscriptions && this.userInscriptions.length > 0) {
        this.reconcileLocalCounts();
      }

      // Reconcile Wizard State (Optimistic Updates)
      if (this.wizardOpen) {
        this.reconcileWizardState();
      }
    } catch (error) {
      this.showToast('❌ Erreur chargement postes : ' + error.message, 'error');
    }
  },

  /**
   * Forces consistency between local user inscriptions and public counts.
   * Fixes stale view issues where `inscrits_actuels` < my inscriptions.
   */
  reconcileLocalCounts() {
    if (!this.postes || !this.userInscriptions) return;

    this.postes.forEach((poste) => {
      // Count my VALID registrations for this poste (in DB)
      // Use loose equality for safety
      const myCount = this.userInscriptions.filter((i) => i.poste_id == poste.poste_id).length;

      // Ensure numeric comparison
      if (Number(poste.inscrits_actuels) < myCount) {
        poste.inscrits_actuels = myCount;
      }
    });
  },

  /**
   * Re-applies local Wizard modifications (selections/removals) on top of fresh server data.
   * Prevents losing the "visual state" when polling updates the list.
   */
  reconcileWizardState() {
    if (!this.postes) return;

    // 1. Re-apply Removals (Visual Decrement)
    this.wizardRemovals.forEach((key) => {
      const [posteId] = key.split('::');
      // Loose equality for safety
      const poste = this.postes.find((p) => p.poste_id == posteId);
      if (poste) {
        // Ensure we don't go below zero
        if (poste.inscrits_actuels > 0) poste.inscrits_actuels--;
      }
    });

    // 2. Re-apply Selections (Visual Increment)
    this.wizardSelections.forEach((sel) => {
      const poste = this.postes.find((p) => p.poste_id == sel.posteId);
      if (poste) {
        poste.inscrits_actuels++;
      }
    });
  },

  /**
   * Loads inscriptions for the current user's profiles.
   */
  async loadUserInscriptions() {
    if (!this.user) return;

    try {
      // We fetch all inscriptions. RLS ensures we only see what we are allowed to see.
      // We need nested 'postes' data for time conflict checks.
      const { data: inscriptions, error: err } = await ApiService.fetch('inscriptions', {
        select: '*, postes(*)',
      });

      if (err) throw err;
      this.userInscriptions = inscriptions || [];
    } catch (error) {
      console.error('Erreur chargement inscriptions:', error);
    }
  },

  /**
   * Checks if the current user is a referent for any loaded poste.
   */
  isReferent() {
    if (!this.user || !this.postes.length || !this.profiles) return false;
    return this.postes.some((p) => this.profiles.some((profile) => profile.id === p.referent_id));
  },

  /**
   * Loads inscriptions for postes where the current user is referent.
   */
  async loadReferentInscriptions() {
    if (!this.user || !this.selectedReferentProfileId) return;

    // 1. Get all poste IDs where user is referent
    const myPosteIds = this.postes
      .filter((p) => p.referent_id === this.selectedReferentProfileId)
      .map((p) => p.poste_id);

    if (myPosteIds.length === 0) {
      this.referentInscriptions = [];
      return;
    }

    this.referentInscriptions = [];
    this.loading = true;
    try {
      // 2. Fetch inscriptions for these postes
      // We need benevoles details (now allowed by RLS) and postes details
      // Re-implementing fetch with 'in' support using supabase directly
      const { data: inscriptions, error: err } = await import('../../config.js').then(
        ({ supabase }) =>
          supabase
            .from('inscriptions')
            .select('*, benevoles(*), postes(*)')
            .in('poste_id', myPosteIds)
      );

      if (err) throw err;
      this.referentInscriptions = inscriptions || [];
    } catch (error) {
      console.error('Erreur chargement inscriptions référent:', error);
      this.showToast('❌ Erreur chargement bénévoles: ' + error.message, 'error');
    } finally {
      this.loading = false;
    }
  },

  /**
   * Groups referent inscriptions by Period -> Poste -> Volunteers
   */
  getReferentViewData() {
    const groups = {};

    this.referentInscriptions.forEach((insc) => {
      if (!insc.postes || !insc.benevoles) return;

      const posteId = insc.postes.id;

      // Find the full poste details from the loaded public_planning (this.postes)
      // to get the correct period name and order
      const publicPoste = this.postes.find((p) => p.poste_id === posteId);

      const periode = publicPoste ? publicPoste.periode : 'Autre';
      const periodeOrdre = publicPoste ? publicPoste.periode_ordre || 0 : 999;

      if (!groups[periode]) {
        groups[periode] = {
          name: periode,
          order: periodeOrdre,
          postes: {},
        };
      }

      if (!groups[periode].postes[posteId]) {
        groups[periode].postes[posteId] = {
          ...insc.postes, // Base info from inscription join
          titre: publicPoste ? publicPoste.titre : insc.postes.titre, // Prefer public info
          periode_debut: publicPoste ? publicPoste.periode_debut : insc.postes.periode_debut,
          periode_fin: publicPoste ? publicPoste.periode_fin : insc.postes.periode_fin,
          nb_min: publicPoste ? publicPoste.nb_min : insc.postes.nb_min,
          nb_max: publicPoste ? publicPoste.nb_max : insc.postes.nb_max,
          inscrits_actuels: publicPoste ? publicPoste.inscrits_actuels : 0,
          volunteers: [],
        };
      }

      groups[periode].postes[posteId].volunteers.push(insc.benevoles);
    });

    // Convert to array and sort
    return Object.values(groups)
      .sort((a, b) => a.order - b.order)
      .map((group) => {
        const sortedPostes = Object.values(group.postes).sort((a, b) => {
          return new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime();
        });

        // Sort volunteers in each poste
        sortedPostes.forEach((poste) => {
          poste.volunteers.sort((a, b) => {
            const prenomA = (a.prenom || '').toLowerCase();
            const prenomB = (b.prenom || '').toLowerCase();
            if (prenomA < prenomB) return -1;
            if (prenomA > prenomB) return 1;

            const nomA = (a.nom || '').toLowerCase();
            const nomB = (b.nom || '').toLowerCase();
            return nomA.localeCompare(nomB);
          });
        });

        return {
          name: group.name,
          postes: sortedPostes,
        };
      });
  },

  /**
   * Registers a profile for a poste.
   * @param {string} posteId - The ID of the poste.
   * @param {string} benevoleId - The ID of the profile.
   */
  async register(posteId, benevoleId) {
    if (!this.user) return;

    // ALWAYS Redirect to Wizard logic
    if (this.wizardOpen) {
      return this.wizardRegister(posteId, benevoleId);
    } else {
      // Dashboard Action -> Open Wizard with Context
      return this.openWizardWithContext(posteId, benevoleId, 'register');
    }
  },

  /**
   * Unregisters a profile from a poste.
   * @param {string} posteId - The ID of the poste.
   * @param {string} benevoleId - The ID of the profile.
   */
  async unregister(posteId, benevoleId) {
    if (!this.user) return;

    // ALWAYS Redirect to Wizard logic
    if (this.wizardOpen) {
      return this.wizardUnregister(posteId, benevoleId);
    } else {
      // Dashboard Action -> Open Wizard with Context
      return this.openWizardWithContext(posteId, benevoleId, 'unregister');
    }
  },

  /**
   * Checks if a specific profile is registered for a poste.
   * @param {string} posteId - The ID of the poste.
   * @param {string} profileId - The ID of the profile.
   * @returns {boolean} True if registered.
   */
  isProfileRegistered(posteId, profileId) {
    if (!this.userInscriptions) return false;

    // Check DB inscriptions
    const inDb = this.userInscriptions.some(
      (i) => i.poste_id == posteId && i.benevole_id == profileId
    );

    if (this.wizardOpen) {
      // Check Wizard Removals (Array)
      if (this.wizardRemovals && this.wizardRemovals.includes(`${posteId}::${profileId}`)) {
        return false;
      }

      // Check Wizard Selections (Array)
      if (this.wizardSelections) {
        const inWizard = this.wizardSelections.some(
          (sel) => sel.posteId == posteId && sel.profileId == profileId
        );
        if (inWizard) return true;
      }
    }

    return inDb;
  },

  // --- Helpers ---

  /**
   * Checks if any managed profile is registered for a poste.
   * @param {string} posteId - The ID of the poste.
   * @returns {boolean} True if registered.
   */
  isUserRegistered(posteId) {
    if (!this.profiles || this.profiles.length === 0) return false;
    const myProfileIds = this.profiles.map((p) => p.id);
    const inDb = this.userInscriptions.some(
      (i) => i.poste_id == posteId && myProfileIds.includes(i.benevole_id)
    );

    if (this.wizardOpen && this.wizardSelections) {
      // Check if ANY of my profiles is in wizard selections for this poste (Array check)
      const inWizard = this.wizardSelections.some((sel) => sel.posteId == posteId);
      return inDb || inWizard;
    }
    return inDb;
  },

  /**
   * Checks for time conflicts for a profile.
   * @param {object} poste - The poste to check against.
   * @param {string} [profileId=null] - Optional profile ID to check specific conflicts.
   * @returns {boolean} True if there is a conflict.
   */
  hasTimeConflict(poste, profileId = null) {
    // Check against CONFIRMED inscriptions (DB) AND Wizard Selections
    // BUT ignore Wizard Removals

    const profileInscriptions = [
      // DB Inscriptions (excluding those marked for removal)
      ...this.userInscriptions.filter(
        (i) =>
          (profileId ? i.benevole_id === profileId : true) &&
          (!this.wizardOpen ||
            !this.wizardRemovals ||
            !this.wizardRemovals.includes(`${i.poste_id}::${i.benevole_id}`))
      ),
      // Wizard Selections (only if wizard is open)
      ...(this.wizardOpen
        ? this.wizardSelections
            .filter((s) => (profileId ? s.profileId === profileId : true))
            .map((s) => ({
              poste_id: s.posteId,
              benevole_id: s.profileId,
              // Mocking structure for overlap check
              postes: {
                periode_debut: s.debut,
                periode_fin: s.fin,
                id: s.posteId, // important for self-check exclusion
              },
            }))
        : []),
    ];

    // Current poste times
    const start = new Date(poste.periode_debut).getTime();
    const end = new Date(poste.periode_fin).getTime();

    return profileInscriptions.some((i) => {
      // If i.postes is populated
      const p = i.postes;
      if (!p) return false;

      // Ignore self
      if (i.poste_id === poste.poste_id) return false;
      // Also check profile match if not filtered above? (Already filtered by profileId if provided)
      if (profileId && i.benevole_id !== profileId) return false;

      const pStart = new Date(p.periode_debut).getTime();
      const pEnd = new Date(p.periode_fin).getTime();

      return start < pEnd && end > pStart;
    });
  },

  /**
   * Method for filtered postes based on UI state.
   * @returns {object[]} Array of filtered postes.
   */
  filteredPostes() {
    return this.postes.filter((poste) => {
      if (this.showOnlyAvailable) {
        const isFull = poste.inscrits_actuels >= poste.nb_max;
        const isRegistered = this.isUserRegistered(poste.poste_id);
        if (isFull && !isRegistered) return false;
      }

      if (this.showMyInscriptions) {
        // If a specific volunteer is selected, filter for their registrations
        if (this.selectedVolunteerId) {
          if (!this.isProfileRegistered(poste.poste_id, this.selectedVolunteerId)) return false;
        } else {
          // Otherwise show all posts where ANY of the user's profiles is registered
          if (!this.isUserRegistered(poste.poste_id)) return false;
        }
      }

      return true;
    });
  },

  /**
   * Method for grouping postes by period.
   * @returns {object[]} Array of groups { name, postes, order }.
   */
  groupedPostes() {
    const groups = {};
    this.filteredPostes().forEach((poste) => {
      if (!groups[poste.periode]) {
        groups[poste.periode] = [];
      }
      groups[poste.periode].push(poste);
    });

    return Object.keys(groups)
      .map((periode) => {
        const postes = groups[periode];
        const ordre = postes.length > 0 ? postes[0].periode_ordre || 0 : 0;

        let subgroups = [];

        if (this.showMyInscriptions) {
          // FLAT LIST MODE for "Mes Inscriptions"
          subgroups = [
            {
              id: 'all',
              title: '', // Empty title triggers logic to hide header
              expanded: true,
              postes: [...postes].sort((a, b) => {
                const oA = a.type_poste_ordre !== undefined ? a.type_poste_ordre : 999999;
                const oB = b.type_poste_ordre !== undefined ? b.type_poste_ordre : 999999;
                if (oA !== oB) return oA - oB;
                return new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime();
              }),
            },
          ];
        } else {
          // GROUPED MODE for "Formulaire d'inscription"
          subgroups = [
            {
              id: 'critical',
              title: '⚠️ Postes Prioritaires (Manque de bénévoles)',
              expanded: true,
              postes: [],
            },
            {
              id: 'open',
              title: '✅ Inscriptions Ouvertes',
              expanded: true,
              postes: [],
            },
            {
              id: 'full',
              title: '🔒 Postes Complets',
              expanded: false, // Default closed
              postes: [],
            },
          ];

          // Distribute posts
          postes.forEach((poste) => {
            const min = poste.nb_min || 0;
            const max = poste.nb_max || 0;
            const current = poste.inscrits_actuels || 0;

            if (current < min) {
              subgroups[0].postes.push(poste);
            } else if (current >= max) {
              subgroups[2].postes.push(poste);
            } else {
              subgroups[1].postes.push(poste);
            }
          });

          // Sort posts within subgroups (respecting row order first, then time)
          subgroups.forEach((subgroup) => {
            subgroup.postes.sort((a, b) => {
              const oA = a.type_poste_ordre !== undefined ? a.type_poste_ordre : 999999;
              const oB = b.type_poste_ordre !== undefined ? b.type_poste_ordre : 999999;
              if (oA !== oB) return oA - oB;
              return new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime();
            });
          });
        }

        // Filter out empty subgroups if necessary, or keep them to show status.
        // Design decision: Keep them if they have content, or meaningful to show emptiness?
        // Let's filter out empty ones to reduce clutter.
        const visibleSubgroups = subgroups.filter((sg) => sg.postes.length > 0);

        return {
          name: periode,
          subgroups: visibleSubgroups,
          order: ordre,
          totalPostes: postes.length,
          totalInscrits: postes.reduce((sum, p) => sum + p.inscrits_actuels, 0),
          totalMax: postes.reduce((sum, p) => sum + p.nb_max, 0),
        };
      })
      .sort((a, b) => a.order - b.order);
  },

  /**
   * Initializes the module with responsive listeners.
   */
  initPlanningResponsive() {
    window.addEventListener('resize', () => {
      // Force view constraints
      if (window.innerWidth >= 768) {
        if (this.viewMode !== 'week') this.viewMode = 'week';
      } else {
        if (this.viewMode !== 'list') this.viewMode = 'list';
      }
    });
  },

  /**
   * Sends the planning by email to the connected user.
   */
  async sendPlanningByEmail() {
    if (!this.user) return;

    // Prevent spam clicks
    if (this.loading) return;

    // Ask for confirmation (Optional, but nice UX)
    if (
      !(await this.askConfirm(
        'Voulez-vous recevoir le récapitulatif de votre planning par email ?',
        'Envoi du planning'
      ))
    ) {
      return;
    }

    this.loading = true;
    this.showToast('📧 Envoi en cours...', 'info');

    try {
      // Force refresh/get session to ensure token is valid just before call
      const { session } = await AuthService.getSession();
      const token = session?.access_token;

      if (!token) {
        throw new Error('Impossible de récupérer votre session. Merci de recharger la page.');
      }

      const path = window.location.pathname;
      const baseDir = path.substring(0, path.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;

      const { error } = await ApiService.invoke('send-planning', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: { baseUrl },
      });

      if (error) throw error;

      this.showToast('✅ Planning envoyé avec succès ! Vérifiez votre boîte mail.', 'success');
    } catch (error) {
      console.error('Erreur envoi planning:', error);
      if (error && error.context) console.error('Erreur Context:', await error.context.json());
      // Translate common edge function errors if needed
      let msg = error.message || 'Une erreur est survenue.';
      this.showToast('❌ Erreur : ' + msg, 'error');
    } finally {
      this.loading = false;
    }
  },
};
