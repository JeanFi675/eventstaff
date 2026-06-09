/**
 * Onglet "Configuration" (créateur visuel) — Phase 5.2.5 (C7.b).
 *
 * Le plus gros composant admin : édition Gantt interactive du planning
 * (jours, périodes, lignes de postes, créneaux), repas, T-shirt, cagnotte.
 *
 * State local : visualDaySelected/Periods/Lines/ProgramEvents, modales,
 * tampons de soft-delete, état drag/draw/tooltip, autoSave.
 *
 * Lecture / écriture store : `loading`, `postes`, `benevoles`, `periodes`,
 * `dbProgramme`, `dbJours`, `visualDays`, `config`. Loaders + toasts +
 * `getReferents` passent par `Alpine.store('admin')`.
 *
 * Bootstrap : écoute l'événement `admin:loaded` (dispatché par
 * `adminApp.init()` après `loadData`) pour déclencher `initVisualCreator`.
 */

import Alpine from 'alpinejs';
import { ApiService } from '../../services/api.js';
import {
  getLocalDateKey,
  formatDecimalHour,
  formatHourMin,
  formatDay,
  formatDecimalToISO,
} from '../../utils/admin-time.js';
import {
  findBestPeriodForShift,
  detectShiftConflicts,
  computePeriodWeight,
} from '../../utils/admin-shift-validation.js';

export function adminVisualCreatorTab() {
  return {
    // --- State local ---
    newRepasName: '',
    newRepasVege: true,
    editingRepasId: null,
    editingRepasName: '',
    editingRepasVege: true,

    visualDaySelected: '',
    visualProgramEvents: [],
    visualPeriods: [],
    visualLines: [],
    visualDeletedPosteIds: [],
    visualDeletedPeriodIds: [],
    visualDeletedEventIds: [],
    visualDeletedTypePosteTitres: [],
    dragState: null,
    hoursRange: { start: 6, end: 22 },
    periodConflicts: [],
    autoSaveStatus: 'synced',
    autoSaveTimeout: null,
    isSavingVisual: false,
    hasPendingChanges: false,
    showAddDayModal: false,
    newDayDate: '2026-05-18',

    selectedPeriodFilterId: null,
    showPeriodCreditModal: false,
    editPeriodCreditData: { idx: -1, nom: '', montant_credit: 0 },
    periodDragState: null,

    showAddShiftModal: false,
    addShiftData: {
      lineIndex: -1,
      titre: '',
      description: '',
      debut: 8,
      fin: 12,
      nb_min: 1,
      nb_max: 5,
      referent_id: '',
    },
    showEditShiftModal: false,
    editShiftData: {
      lineIndex: -1,
      shiftIndex: -1,
      id: '',
      titre: '',
      description: '',
      debut: 8,
      fin: 12,
      nb_min: 1,
      nb_max: 5,
      referent_id: '',
    },
    hoveredShift: null,

    isDrawingShift: false,
    drawingLineIndex: -1,
    drawingState: null,

    lineDragTimer: null,
    lineDragState: null,

    // --- Utilitaires exposés au template ---
    formatDecimalHour,
    formatDay,

    // --- Proxies store ---

    get loading() {
      return Alpine.store('admin').loading;
    },
    set loading(v) {
      Alpine.store('admin').loading = v;
    },

    get postes() {
      return Alpine.store('admin').postes;
    },
    get benevoles() {
      return Alpine.store('admin').benevoles;
    },
    get periodes() {
      return Alpine.store('admin').periodes;
    },
    get dbProgramme() {
      return Alpine.store('admin').dbProgramme;
    },
    get dbJours() {
      return Alpine.store('admin').dbJours;
    },
    get config() {
      return Alpine.store('admin').config;
    },
    get repasList() {
      return Alpine.store('admin').repasList;
    },

    get visualDays() {
      return Alpine.store('admin').visualDays;
    },
    set visualDays(v) {
      Alpine.store('admin').visualDays = v;
    },

    showToast(message, type = 'success') {
      return Alpine.store('admin').showToast(message, type);
    },

    getReferents() {
      return Alpine.store('admin').getReferents();
    },

    async loadData() {
      return Alpine.store('admin').loadData();
    },

    async loadRepas() {
      return Alpine.store('admin').loadRepas();
    },

    async loadBenevolesAndStats() {
      return Alpine.store('admin').loadBenevolesAndStats();
    },

    // --- Bootstrap ---

    init() {
      // Init différée : on attend que `adminApp.init()` ait terminé
      // `loadData()`, signalé via `window` event 'admin:loaded'.
      const onLoaded = () => {
        this.initVisualCreator();
        window.removeEventListener('admin:loaded', onLoaded);
      };
      window.addEventListener('admin:loaded', onLoaded);
    },

    // --- Configuration des formulaires (T-shirt, cagnotte, repas) ---

    async toggleCagnotte() {
      const newValue = !this.config.cagnotte_active;
      this.config.cagnotte_active = newValue;

      try {
        const { error } = await ApiService.upsert('config', {
          key: 'cagnotte_active',
          value: newValue,
        });

        if (error) throw error;

        this.showToast(`✅ Cagnotte ${newValue ? 'ACTIVÉE' : 'DÉSACTIVÉE'}`, 'success');
      } catch (error) {
        this.config.cagnotte_active = !newValue;
        this.showToast('❌ Erreur mise à jour : ' + error.message, 'error');
      }
    },

    async toggleTshirtQuestion() {
      const newValue = !this.config.tshirt_question_active;
      this.config.tshirt_question_active = newValue;

      try {
        const { error } = await ApiService.upsert('config', {
          key: 'tshirt_question_active',
          value: newValue,
        });

        if (error) throw error;

        this.showToast(`✅ Question T-Shirt ${newValue ? 'ACTIVÉE' : 'DÉSACTIVÉE'}`, 'success');
      } catch (error) {
        this.config.tshirt_question_active = !newValue;
        this.showToast('❌ Erreur : ' + error.message, 'error');
      }
    },

    /**
     * Sauvegarde le titre et l'adresse de l'évènement (clés config
     * `event_title` / `event_address`). Ces valeurs rendent l'application
     * générique : le titre alimente le header public et le <title> des pages.
     * @returns {Promise<void>}
     */
    async saveEventIdentity() {
      const title = (this.config.event_title || '').trim();
      const address = (this.config.event_address || '').trim();
      this.config.event_title = title;
      this.config.event_address = address;

      try {
        const { error } = await ApiService.upsertMany('config', [
          { key: 'event_title', value: title },
          { key: 'event_address', value: address },
        ]);
        if (error) throw error;

        this.showToast("✅ Identité de l'évènement enregistrée", 'success');
      } catch (error) {
        this.showToast('❌ Erreur enregistrement : ' + error.message, 'error');
      }
    },

    // --- Repas (CRUD) ---

    async addRepas() {
      if (!this.newRepasName || this.newRepasName.trim() === '') return;
      this.loading = true;
      try {
        const { error } = await ApiService.insert('repas', {
          nom: this.newRepasName.trim(),
          question_vege_active: this.newRepasVege,
        });
        if (error) throw error;

        this.showToast('✅ Repas ajouté avec succès !', 'success');
        this.newRepasName = '';
        this.newRepasVege = true;
        await this.loadRepas();
        await this.loadBenevolesAndStats();
      } catch (error) {
        this.showToast('❌ Erreur ajout repas : ' + error.message, 'error');
      } finally {
        this.loading = false;
      }
    },

    async deleteRepas(id) {
      const confirmed = await Alpine.store('admin').askConfirm(
        'Voulez-vous vraiment supprimer ce repas ? Tous les choix des bénévoles associés à ce repas seront perdus.',
        'Supprimer le repas'
      );
      if (!confirmed) return;
      this.loading = true;
      try {
        const { error } = await ApiService.delete('repas', { id });
        if (error) throw error;

        this.showToast('✅ Repas supprimé !', 'success');
        await this.loadRepas();
        await this.loadBenevolesAndStats();
      } catch (error) {
        this.showToast('❌ Erreur suppression : ' + error.message, 'error');
      } finally {
        this.loading = false;
      }
    },

    startEditRepas(repas) {
      this.editingRepasId = repas.id;
      this.editingRepasName = repas.nom;
      this.editingRepasVege = repas.question_vege_active !== false;
    },

    cancelEditRepas() {
      this.editingRepasId = null;
      this.editingRepasName = '';
      this.editingRepasVege = true;
    },

    async saveEditRepas(id) {
      if (!this.editingRepasName || this.editingRepasName.trim() === '') return;
      this.loading = true;
      try {
        const { error } = await ApiService.update(
          'repas',
          {
            nom: this.editingRepasName.trim(),
            question_vege_active: this.editingRepasVege,
          },
          { id }
        );

        if (error) throw error;

        this.showToast('✅ Repas mis à jour avec succès !', 'success');
        this.editingRepasId = null;
        this.editingRepasName = '';
        this.editingRepasVege = true;
        await this.loadRepas();
        await this.loadBenevolesAndStats();
      } catch (error) {
        this.showToast('❌ Erreur modification repas : ' + error.message, 'error');
      } finally {
        this.loading = false;
      }
    },

    // --- Création visuelle ---

    async initVisualCreator() {
      if (!window._beforeUnloadHandlerRegistered) {
        window._beforeUnloadHandlerRegistered = true;
        window.addEventListener('beforeunload', (e) => {
          const hasPending =
            this.autoSaveTimeout || this.autoSaveStatus === 'saving' || this.isSavingVisual;
          if (hasPending) {
            e.preventDefault();
            e.returnValue =
              'Vous avez des modifications de planning non enregistrées. Voulez-vous vraiment quitter ?';
            return e.returnValue;
          }
        });
      }

      const days = new Set(this.dbJours || []);

      this.postes.forEach((p) => {
        if (p.periode_debut) {
          days.add(getLocalDateKey(p.periode_debut));
        }
      });

      if (this.dbProgramme && this.dbProgramme.days) {
        Object.keys(this.dbProgramme.days).forEach((d) => days.add(d));
      }

      let baseDate = new Date();
      if (days.size > 0) {
        const sortedIdentified = Array.from(days).sort();
        baseDate = new Date(sortedIdentified[0] + 'T00:00:00');
      }

      for (let i = -30; i <= 30; i++) {
        const tempDate = new Date(baseDate.getTime());
        tempDate.setDate(baseDate.getDate() + i);

        const y = tempDate.getFullYear();
        const m = String(tempDate.getMonth() + 1).padStart(2, '0');
        const day = String(tempDate.getDate()).padStart(2, '0');
        const dateKey = `${y}-${m}-${day}`;

        if (days.has(dateKey)) continue;

        const dayLabel = tempDate.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const dayPrefix = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
        const dayPrefixNoYear = dayPrefix.split(' 202')[0];

        const hasMatchingPeriod = this.periodes.some(
          (per) => per.nom && per.nom.startsWith(dayPrefixNoYear)
        );
        if (hasMatchingPeriod) {
          days.add(dateKey);
        }
      }

      this.visualDays = Array.from(days).sort();

      if (this.visualDays.length > 0) {
        await this.selectVisualDay(this.visualDays[0]);
      }
    },

    async selectVisualDay(day) {
      this.visualDaySelected = day;
      this.visualDeletedPosteIds = [];
      this.visualDeletedPeriodIds = [];
      this.visualDeletedEventIds = [];
      this.dragState = null;
      this.selectedPeriodFilterId = null;

      this.visualProgramEvents = [];

      if (this.dbProgramme && this.dbProgramme.days && this.dbProgramme.days[day]) {
        this.visualProgramEvents = this.dbProgramme.days[day].events
          .map((ev) => ({
            id: ev.id || null,
            hStart: ev.hStart,
            description: ev.description,
          }))
          .sort((a, b) => a.hStart - b.hStart);
      }

      const dayPostes = this.postes.filter(
        (p) => p.periode_debut && getLocalDateKey(p.periode_debut) === day
      );

      const d = new Date(day + 'T00:00:00');
      const dayLabel = d.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const dayPrefix = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
      const dayPrefixNoYear = dayPrefix.split(' 202')[0];

      const dayPeriods = this.periodes.filter((per) => {
        const hasPostsOnDay = dayPostes.some((p) => p.periode_id === per.id);
        const isDayPrefix = per.nom && per.nom.startsWith(dayPrefixNoYear);
        return isDayPrefix || hasPostsOnDay;
      });

      this.visualPeriods = dayPeriods
        .map((per, index) => {
          let debut = null;
          let fin = null;

          if (per.nom) {
            const timeMatch = per.nom.match(/ - (\d{2})[:h](\d{2}) \/ (\d{2})[:h](\d{2})/);
            if (timeMatch) {
              debut = parseInt(timeMatch[1]) + parseInt(timeMatch[2]) / 60;
              fin = parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 60;
            }
          }

          if (debut === null || fin === null) {
            const perPostes = dayPostes.filter((p) => p.periode_id === per.id);
            if (perPostes.length > 0) {
              const starts = perPostes.map((p) => {
                const dd = new Date(p.periode_debut);
                return dd.getHours() + dd.getMinutes() / 60;
              });
              const ends = perPostes.map((p) => {
                const dd = new Date(p.periode_fin);
                return dd.getHours() + dd.getMinutes() / 60;
              });
              debut = Math.min(...starts);
              fin = Math.max(...ends);
            } else {
              if (index === 0) {
                debut = 7;
                fin = 13;
              } else if (index === 1) {
                debut = 13;
                fin = 19;
              } else {
                debut = 19;
                fin = 22;
              }
            }
          }

          return {
            id: per.id,
            nom: per.nom,
            ordre: per.ordre,
            montant_credit: per.montant_credit || 0.0,
            debut,
            fin,
          };
        })
        .sort((a, b) => a.ordre - b.ordre);

      if (this.visualPeriods.length === 0) {
        const tempPerId = crypto.randomUUID();
        this.visualPeriods.push({
          id: tempPerId,
          nom: `${dayPrefixNoYear} - 08:00 / 12:00`,
          ordre: 1,
          montant_credit: 10.0,
          debut: 8,
          fin: 12,
          isNew: true,
        });
      }

      const groups = {};
      dayPostes.forEach((p) => {
        const key = `${p.titre.trim()}|||${(p.description || '').trim()}`;
        if (!groups[key]) {
          const dayOrder = p.ordre !== undefined ? p.ordre : 999999;
          groups[key] = {
            titre: p.titre,
            description: p.description || '',
            shifts: [],
            ordre: dayOrder,
          };
        }

        const dStart = new Date(p.periode_debut);
        const dEnd = new Date(p.periode_fin);
        const startHour = dStart.getHours() + dStart.getMinutes() / 60;
        const endHour = dEnd.getHours() + dEnd.getMinutes() / 60;

        groups[key].shifts.push({
          id: p.id,
          debut: startHour,
          fin: endHour,
          nb_min: p.nb_min,
          nb_max: p.nb_max,
          referent_id: p.referent_id || '',
          inscrits_actuels: p.inscrits_actuels || 0,
          inscrits_noms: p.inscrits_noms || [],
          periode_id: p.periode_id || null,
          error: null,
        });
      });

      const initialLines = Object.values(groups);

      initialLines.sort((a, b) => {
        if (a.ordre !== b.ordre) return a.ordre - b.ordre;
        return a.titre.localeCompare(b.titre);
      });

      this.visualLines = initialLines.map((line, index) => ({
        ...line,
        lineIndex: index,
      }));

      this.validateAndAutoAssignPeriods();
    },

    addVisualDay() {
      this.newDayDate = '2026-05-18';
      this.showAddDayModal = true;
    },

    confirmAddVisualDay() {
      const d = this.newDayDate;
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        if (!this.visualDays.includes(d)) {
          this.visualDays.push(d);
          this.visualDays.sort();
          this.selectVisualDay(d);
          this.showAddDayModal = false;
          this.triggerAutoSave();
        } else {
          this.showToast('Ce jour existe déjà !', 'warning');
        }
      } else {
        this.showToast('Format de date invalide. Utilisez AAAA-MM-JJ.', 'error');
      }
    },

    async deleteVisualDay(day) {
      if (!day) return;

      const formattedDayStr = formatDay(day);
      const confirmed = await Alpine.store('admin').askConfirm(
        `⚠️ Attention : Êtes-vous sûr de vouloir supprimer le jour "${formattedDayStr}" ?\n\nCette action supprimera DÉFINITIVEMENT :\n- Tous les postes et créneaux associés à ce jour\n- Toutes les périodes définies pour ce jour\n- Toutes les inscriptions de bénévoles sur ces postes\n- Tous les événements de programme de ce jour\n\nCette action est irréversible et modifiera directement la base de production. Voulez-vous continuer ?`,
        `Supprimer le jour "${formattedDayStr}"`
      );
      if (!confirmed) return;

      this.loading = true;

      try {
        const { error: progError } = await ApiService.delete('programmes', { date_ref: day });
        if (progError) {
          console.error('Erreur lors de la suppression du programme :', progError);
        }

        const { error: jourError } = await ApiService.delete('jours', { date_ref: day });
        if (jourError) {
          console.error('Erreur lors de la suppression du jour de la table jours :', jourError);
          throw jourError;
        }

        // Les périodes ne sont pas reliées à `jours` par FK : leur appartenance
        // à un jour repose sur la convention de nommage "{dayPrefix} - HH:MM / HH:MM".
        // Sans nettoyage explicite, `initVisualCreator` re-détecte le jour au refresh
        // via le scan de préfixe et la suppression apparaît annulée.
        // À faire APRÈS la suppression de jours (cascade postes) pour ne pas violer
        // la FK postes.periode_id.
        const dLocal = new Date(day + 'T00:00:00');
        const dayLabel = dLocal.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const dayPrefix = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
        const dayPrefixNoYear = dayPrefix.split(' 202')[0];
        const orphanPeriodIds = this.periodes
          .filter((p) => p.nom && p.nom.startsWith(dayPrefixNoYear))
          .map((p) => p.id);
        if (orphanPeriodIds.length > 0) {
          const { error: orphanError } = await ApiService.delete('periodes', {
            id: orphanPeriodIds,
          });
          if (orphanError) {
            console.error(
              'Erreur lors de la suppression des périodes orphelines du jour :',
              orphanError
            );
          }
        }

        this.visualDays = this.visualDays.filter((d) => d !== day);

        await this.loadData();

        if (this.visualDays.length > 0) {
          await this.selectVisualDay(this.visualDays[0]);
        } else {
          await this.initVisualCreator();
        }

        this.showToast(
          `✅ Le jour "${formattedDayStr}" et toutes ses données associées ont été supprimés avec succès.`,
          'success'
        );
      } catch (err) {
        console.error('Erreur de suppression du jour :', err);
        this.showToast(`❌ Erreur lors de la suppression : ${err.message}`, 'error');
      } finally {
        this.loading = false;
      }
    },

    async deleteVisualLine(lineIndex) {
      const confirmed = await Alpine.store('admin').askConfirm(
        'Voulez-vous supprimer cette ligne de postes et tous ses créneaux ?',
        'Supprimer la ligne'
      );
      if (!confirmed) return;
      const line = this.visualLines[lineIndex];
      if (line && line.shifts) {
        line.shifts.forEach((shift) => {
          if (shift.id && !shift.isNew) {
            this.visualDeletedPosteIds.push(shift.id);
          }
        });
      }
      if (line && line.titre) {
        this.visualDeletedTypePosteTitres.push({
          date_ref: this.visualDaySelected,
          titre: line.titre.trim(),
        });
      }
      this.visualLines.splice(lineIndex, 1);
      this.visualLines.forEach((l, idx) => (l.lineIndex = idx));
      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    // --- Drag de créneaux (shifts) ---

    startDrag(event, lineIndex, shiftIndex, mode) {
      event.preventDefault();
      const line = this.visualLines[lineIndex];
      if (!line) return;
      const shift = line.shifts[shiftIndex];
      if (!shift) return;

      const container = event.target.closest('.timeline-track');
      if (!container) return;

      const rect = container.getBoundingClientRect();

      this.dragState = {
        lineIndex,
        shiftIndex,
        mode,
        initialDebut: shift.debut,
        initialFin: shift.fin,
        startX: event.clientX || (event.touches ? event.touches[0].clientX : 0),
        containerWidth: rect.width || 800,
        hasMoved: false,
      };

      const handleMove = (e) => this.handleDrag(e);
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleUp);
        this.stopDrag();
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleUp);
    },

    handleDrag(event) {
      if (!this.dragState) return;
      if (event.cancelable) event.preventDefault();

      const clientX = event.clientX || (event.touches ? event.touches[0].clientX : 0);
      const dx = clientX - this.dragState.startX;

      if (Math.abs(dx) > 4) {
        this.dragState.hasMoved = true;
      }

      const totalHours = this.hoursRange.end - this.hoursRange.start;
      const deltaHours = (dx / this.dragState.containerWidth) * totalHours;
      const deltaHoursSnapped = Math.round(deltaHours / 0.25) * 0.25;

      const line = this.visualLines[this.dragState.lineIndex];
      const shift = line.shifts[this.dragState.shiftIndex];

      if (this.dragState.mode === 'move') {
        const duration = this.dragState.initialFin - this.dragState.initialDebut;
        let newDebut = this.dragState.initialDebut + deltaHoursSnapped;

        let gaucheShift = null;
        line.shifts.forEach((s, idx) => {
          if (idx === this.dragState.shiftIndex) return;
          if (s.fin <= this.dragState.initialDebut) {
            if (!gaucheShift || s.fin > gaucheShift.fin) {
              gaucheShift = s;
            }
          }
        });

        let droiteShift = null;
        line.shifts.forEach((s, idx) => {
          if (idx === this.dragState.shiftIndex) return;
          if (s.debut >= this.dragState.initialFin) {
            if (!droiteShift || s.debut < droiteShift.debut) {
              droiteShift = s;
            }
          }
        });

        const limiteGauche = gaucheShift ? gaucheShift.fin : this.hoursRange.start;
        const limiteDroite = droiteShift ? droiteShift.debut : this.hoursRange.end;

        newDebut = Math.max(limiteGauche, Math.min(limiteDroite - duration, newDebut));
        const newFin = newDebut + duration;

        shift.debut = newDebut;
        shift.fin = newFin;
      } else if (this.dragState.mode === 'resize-start') {
        let newDebut = this.dragState.initialDebut + deltaHoursSnapped;
        newDebut = Math.max(this.hoursRange.start, Math.min(shift.fin - 0.5, newDebut));

        const previousShift = line.shifts[this.dragState.shiftIndex - 1];
        if (previousShift && newDebut < previousShift.fin) {
          newDebut = previousShift.fin;
        }

        shift.debut = newDebut;
      } else if (this.dragState.mode === 'resize-end') {
        let newFin = this.dragState.initialFin + deltaHoursSnapped;
        newFin = Math.min(this.hoursRange.end, Math.max(shift.debut + 0.5, newFin));

        const nextShift = line.shifts[this.dragState.shiftIndex + 1];
        if (nextShift && newFin > nextShift.debut) {
          newFin = nextShift.debut;
        }

        shift.fin = newFin;
      }
    },

    stopDrag() {
      if (this.dragState && !this.dragState.hasMoved && this.dragState.mode === 'move') {
        const lIdx = this.dragState.lineIndex;
        const sIdx = this.dragState.shiftIndex;
        this.dragState = null;
        this.openEditShiftModal(lIdx, sIdx);
        return;
      }

      this.dragState = null;
      this.visualLines.forEach((line) => {
        line.shifts.sort((a, b) => a.debut - b.debut);
      });
      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    // --- Événements de programme ---

    addVisualProgramEvent() {
      const desc = prompt("Description de l'événement (ex: Qualifications U15) :");
      if (!desc || desc.trim() === '') return;

      const hStr = prompt('Heure de début (Format: HHhMM, ex: 08h30) :', '08h00');
      const m = hStr ? hStr.match(/^(\d{1,2})h(\d{2})$/) : null;
      if (!m) {
        this.showToast("Format d'heure invalide. Utilisez HHhMM (ex: 08h30).", 'error');
        return;
      }

      const h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const hStart = h + min / 60;

      this.visualProgramEvents.push({
        id: crypto.randomUUID(),
        isNew: true,
        hStart,
        description: desc.trim(),
      });

      this.visualProgramEvents.sort((a, b) => a.hStart - b.hStart);
      this.triggerAutoSave();
    },

    deleteVisualProgramEvent(index) {
      const ev = this.visualProgramEvents[index];
      if (ev && ev.id && !ev.isNew) {
        this.visualDeletedEventIds.push(ev.id);
      }
      this.visualProgramEvents.splice(index, 1);
      this.triggerAutoSave();
    },

    // --- Validation + auto-assignation des périodes ---

    validateAndAutoAssignPeriods() {
      this.periodConflicts = [];

      let H_min = 8;
      let H_max = 18;

      const allShifts = [];
      this.visualLines.forEach((line) => {
        line.shifts.forEach((shift) => {
          allShifts.push({
            shift,
            lineTitle: line.titre.trim().toLowerCase(),
            lineTitleRaw: line.titre.trim(),
            lineDescription: line.description ? line.description.trim() : '',
          });
        });
      });

      if (allShifts.length > 0) {
        H_min = Math.min(...allShifts.map((s) => s.shift.debut));
        H_max = Math.max(...allShifts.map((s) => s.shift.fin));
      }

      if (this.visualPeriods.length === 0) {
        const tempPerId = crypto.randomUUID();
        this.visualPeriods.push({
          id: tempPerId,
          nom: '',
          ordre: 1,
          montant_credit: 10.0,
          debut: H_min,
          fin: H_max,
          isNew: true,
        });
      }

      this.visualPeriods.sort((a, b) => a.debut - b.debut);

      this.visualPeriods[0].debut = H_min;
      this.visualPeriods[this.visualPeriods.length - 1].fin = H_max;

      for (let i = 0; i < this.visualPeriods.length - 1; i++) {
        const current = this.visualPeriods[i];
        const next = this.visualPeriods[i + 1];

        next.debut = current.fin;

        const minAllowedFin = current.debut + 0.5;
        if (current.fin < minAllowedFin) {
          current.fin = minAllowedFin;
          next.debut = minAllowedFin;
        }
      }

      for (let i = this.visualPeriods.length - 1; i > 0; i--) {
        const current = this.visualPeriods[i];
        const prev = this.visualPeriods[i - 1];

        if (current.debut > current.fin - 0.5) {
          current.debut = current.fin - 0.5;
          prev.fin = current.debut;
        }
      }

      const totalDuration = H_max - H_min;
      const numPeriods = this.visualPeriods.length;
      const minRequiredTotal = numPeriods * 0.5;

      if (totalDuration < minRequiredTotal) {
        const step = totalDuration / numPeriods;
        for (let i = 0; i < numPeriods; i++) {
          this.visualPeriods[i].debut = H_min + i * step;
          this.visualPeriods[i].fin = H_min + (i + 1) * step;
        }
      }

      this.visualPeriods.forEach((p, idx) => (p.ordre = idx + 1));

      const d = new Date(this.visualDaySelected + 'T00:00:00');
      const dayLabel = d.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const dayPrefix = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
      const dayPrefixNoYear = dayPrefix.split(' 202')[0];

      this.visualPeriods.forEach((per) => {
        per.nom = `${dayPrefixNoYear} - ${formatHourMin(per.debut)} / ${formatHourMin(per.fin)}`;
      });

      this.visualLines.forEach((line) => {
        line.shifts.forEach((shift) => {
          shift.error = null;
          shift.periode_id = findBestPeriodForShift(shift, this.visualPeriods);
        });
      });

      const conflicts = detectShiftConflicts(allShifts, formatDecimalHour);
      conflicts.forEach(({ shiftA, shiftB, message }) => {
        shiftA.error = 'Chevauchement';
        shiftB.error = 'Chevauchement';
        if (!this.periodConflicts.includes(message)) {
          this.periodConflicts.push(message);
        }
      });
    },

    // --- Filtrage / split / suppression de périodes ---

    togglePeriodFilter(perId) {
      if (this.selectedPeriodFilterId === perId) {
        this.selectedPeriodFilterId = null;
      } else {
        this.selectedPeriodFilterId = perId;
      }
    },

    splitVisualPeriod() {
      if (this.visualPeriods.length === 0) {
        this.validateAndAutoAssignPeriods();
        return;
      }

      let maxDuration = 0;
      let longestPeriodIdx = 0;
      this.visualPeriods.forEach((per, idx) => {
        const dur = per.fin - per.debut;
        if (dur > maxDuration) {
          maxDuration = dur;
          longestPeriodIdx = idx;
        }
      });

      const targetPeriod = this.visualPeriods[longestPeriodIdx];
      if (maxDuration < 1.0) {
        this.showToast(
          "La période la plus longue est trop courte pour être scindée (durée minimale d'une heure requise).",
          'warning'
        );
        return;
      }

      const rawMid = (targetPeriod.debut + targetPeriod.fin) / 2;
      const mid = Math.round(rawMid / 0.25) * 0.25;

      if (mid - targetPeriod.debut < 0.5 || targetPeriod.fin - mid < 0.5) {
        this.showToast(
          'Impossible de scinder à cet endroit : les périodes doivent durer au moins 30 minutes.',
          'warning'
        );
        return;
      }

      const tempPerId = crypto.randomUUID();
      const newPeriod = {
        id: tempPerId,
        nom: '',
        ordre: targetPeriod.ordre + 1,
        montant_credit: targetPeriod.montant_credit || 10.0,
        debut: mid,
        fin: targetPeriod.fin,
        isNew: true,
      };

      targetPeriod.fin = mid;

      this.visualPeriods.splice(longestPeriodIdx + 1, 0, newPeriod);
      this.visualPeriods.forEach((p, idx) => (p.ordre = idx + 1));

      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    async removeVisualPeriod() {
      if (this.visualPeriods.length <= 1) {
        this.showToast(
          'Impossible de supprimer la dernière période restante. Il doit y en avoir au moins une.',
          'warning'
        );
        return;
      }

      let idxToDelete = this.visualPeriods.length - 1;
      if (this.selectedPeriodFilterId !== null) {
        const idx = this.visualPeriods.findIndex((p) => p.id === this.selectedPeriodFilterId);
        if (idx !== -1) {
          idxToDelete = idx;
        }
      }

      const per = this.visualPeriods[idxToDelete];
      if (!per) return;

      const timeStr = per.nom.split(' - ')[1] || per.nom;
      const confirmed = await Alpine.store('admin').askConfirm(
        `Voulez-vous supprimer la période "${timeStr}" ?\nLes créneaux associés seront automatiquement réassignés aux autres périodes les plus adaptées.`,
        'Supprimer la période'
      );
      if (!confirmed) return;

      if (per.id && !String(per.id).startsWith('temp-per-')) {
        this.visualDeletedPeriodIds.push(per.id);
      }
      this.visualPeriods.splice(idxToDelete, 1);

      if (this.selectedPeriodFilterId === per.id) {
        this.selectedPeriodFilterId = null;
      }

      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    // --- Drag de jonctions de périodes ---

    startPeriodDrag(event, index) {
      event.preventDefault();
      const per = this.visualPeriods[index];
      const nextPer = this.visualPeriods[index + 1];
      if (!per || !nextPer) return;

      const container = event.target.closest('.relative');
      if (!container) return;

      const rect = container.getBoundingClientRect();

      this.periodDragState = {
        index,
        initialFin: per.fin,
        startX: event.clientX || (event.touches ? event.touches[0].clientX : 0),
        containerWidth: rect.width || 800,
        minFin: per.debut + 0.5,
        maxFin: nextPer.fin - 0.5,
      };

      const handleMove = (e) => this.handlePeriodDrag(e);
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleUp);
        this.stopPeriodDrag();
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleUp);
    },

    handlePeriodDrag(event) {
      if (!this.periodDragState) return;
      if (event.cancelable) event.preventDefault();

      const clientX = event.clientX || (event.touches ? event.touches[0].clientX : 0);
      const dx = clientX - this.periodDragState.startX;

      const totalHours = this.hoursRange.end - this.hoursRange.start;
      const deltaHours = (dx / this.periodDragState.containerWidth) * totalHours;
      const deltaHoursSnapped = Math.round(deltaHours / 0.25) * 0.25;

      let newFin = this.periodDragState.initialFin + deltaHoursSnapped;
      newFin = Math.max(this.periodDragState.minFin, Math.min(this.periodDragState.maxFin, newFin));

      const per = this.visualPeriods[this.periodDragState.index];
      const nextPer = this.visualPeriods[this.periodDragState.index + 1];

      per.fin = newFin;
      nextPer.debut = newFin;
    },

    stopPeriodDrag() {
      this.periodDragState = null;
      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    openPeriodCreditModal(idx) {
      const per = this.visualPeriods[idx];
      if (!per) return;
      this.editPeriodCreditData = {
        idx,
        nom: per.nom,
        montant_credit: per.montant_credit || 0,
      };
      this.showPeriodCreditModal = true;
    },

    savePeriodCredit() {
      const idx = this.editPeriodCreditData.idx;
      if (idx !== -1 && this.visualPeriods[idx]) {
        this.visualPeriods[idx].montant_credit = parseFloat(
          this.editPeriodCreditData.montant_credit || 0
        );
        this.showPeriodCreditModal = false;
        this.triggerAutoSave();
      }
    },

    // --- Sauvegarde ---

    triggerAutoSave() {
      this.autoSaveStatus = 'saving';
      if (this.autoSaveTimeout) {
        clearTimeout(this.autoSaveTimeout);
      }
      this.autoSaveTimeout = setTimeout(async () => {
        try {
          await this.saveVisualCreator(true);
          this.autoSaveStatus = 'synced';
        } catch (err) {
          console.error('Erreur de sauvegarde automatique:', err);
          this.autoSaveStatus = 'error';
        }
      }, 1000);
    },

    async saveVisualCreator(isSilent = false) {
      if (this.isSavingVisual) {
        this.hasPendingChanges = true;
        return;
      }

      this.validateAndAutoAssignPeriods();

      if (this.periodConflicts.length > 0) {
        if (!isSilent) {
          this.showToast(
            '❌ Enregistrement impossible : veuillez corriger les chevauchements de créneaux détectés.',
            'error'
          );
        }
        throw new Error('Chevauchement de créneaux de poste détecté.');
      }

      this.isSavingVisual = true;
      if (!isSilent) {
        this.loading = true;
      }

      try {
        const deletePromises = [];
        const deletedPeriodIdsSet = new Set(this.visualDeletedPeriodIds);

        if (this.visualDeletedPosteIds.length > 0) {
          deletePromises.push(ApiService.delete('postes', { id: this.visualDeletedPosteIds }));
        }
        if (this.visualDeletedEventIds.length > 0) {
          try {
            deletePromises.push(
              ApiService.delete('programmes', { id: this.visualDeletedEventIds })
            );
          } catch {}
        }

        if (deletePromises.length > 0) {
          await Promise.all(deletePromises);
          this.visualDeletedPosteIds = [];
          this.visualDeletedEventIds = [];
        }

        // Suppression des périodes orphelines : déplacée APRÈS l'upsert des postes
        // (cf. plus bas). La stratégie historique "DETACH + DELETE" mettait
        // `postes.periode_id = NULL` avant la suppression, mais cette colonne est
        // désormais `NOT NULL` (durcissement DB). Comme `validateAndAutoAssignPeriods`
        // a déjà réassigné chaque shift à une période survivante, l'upsert postes
        // libérera les références à la période supprimée et le DELETE pourra passer.

        const currentPeriodIds = new Set(this.visualPeriods.map((p) => p.id));
        const otherDayPeriods = this.periodes.filter(
          (p) => !currentPeriodIds.has(p.id) && !deletedPeriodIdsSet.has(p.id)
        );

        const allPeriodsToSave = [...otherDayPeriods, ...this.visualPeriods];

        const weightCtx = {
          currentPeriodIds,
          visualPeriods: this.visualPeriods,
          postes: this.postes,
          daySelected: this.visualDaySelected,
        };
        allPeriodsToSave.sort(
          (a, b) => computePeriodWeight(a, weightCtx) - computePeriodWeight(b, weightCtx)
        );

        allPeriodsToSave.forEach((per, index) => {
          per.ordreCible = index + 1;
        });

        const baseOffset = 10000 + Math.floor(Math.random() * 10000) * 100;
        const tempPeriodsPayload = allPeriodsToSave.map((per) => ({
          id: per.id,
          nom: per.nom,
          ordre: baseOffset + per.ordreCible,
          montant_credit: parseFloat(per.montant_credit || 0.0),
        }));

        if (tempPeriodsPayload.length > 0) {
          const { error } = await ApiService.upsertMany('periodes', tempPeriodsPayload);
          if (error) throw error;
        }

        const periodsToUpsert = allPeriodsToSave.map((per) => ({
          id: per.id,
          nom: per.nom,
          ordre: parseInt(per.ordreCible),
          montant_credit: parseFloat(per.montant_credit || 0.0),
        }));

        if (periodsToUpsert.length > 0) {
          const { error } = await ApiService.upsertMany('periodes', periodsToUpsert);
          if (error) throw error;
        }

        this.visualPeriods.forEach((p) => delete p.isNew);

        const { error: upsertJourError } = await ApiService.upsert('jours', {
          date_ref: this.visualDaySelected,
        });
        if (upsertJourError) throw upsertJourError;

        const dayStr = this.visualDaySelected;

        const deletedTypeTitres = this.visualDeletedTypePosteTitres || [];
        if (deletedTypeTitres.length > 0) {
          for (const { date_ref, titre } of deletedTypeTitres) {
            const stillExists = this.visualLines.some((l) => l.titre.trim() === titre);
            if (!stillExists) {
              await ApiService.delete('type_postes', { date_ref, titre });
            }
          }
          this.visualDeletedTypePosteTitres = [];
        }

        const typePostesPayload = this.visualLines.map((line, lineIndex) => ({
          date_ref: this.visualDaySelected,
          titre: line.titre.trim(),
          description: line.description.trim() || null,
          ordre: lineIndex,
        }));

        let typePostesMap = {};
        if (typePostesPayload.length > 0) {
          const { data: typePostesSaved, error: upsertTypePostesError } =
            await ApiService.upsertMany('type_postes', typePostesPayload, {
              onConflict: 'date_ref,titre',
            });
          if (upsertTypePostesError) throw upsertTypePostesError;

          (typePostesSaved || []).forEach((tp) => {
            typePostesMap[tp.titre.trim()] = tp.id;
          });
        }

        const postesToUpsert = [];
        this.visualLines.forEach((line) => {
          const typePosteId = typePostesMap[line.titre.trim()];
          if (!typePosteId) {
            throw new Error(`Type de poste non trouvé pour : ${line.titre}`);
          }
          for (const shift of line.shifts) {
            postesToUpsert.push({
              id: shift.id,
              type_poste_id: typePosteId,
              periode_debut: formatDecimalToISO(shift.debut, dayStr),
              periode_fin: formatDecimalToISO(shift.fin, dayStr),
              nb_min: parseInt(shift.nb_min),
              nb_max: parseInt(shift.nb_max),
              referent_id: shift.referent_id || null,
              periode_id: shift.periode_id,
            });
          }
        });

        if (postesToUpsert.length > 0) {
          const { error: upsertPostesError } = await ApiService.upsertMany(
            'postes',
            postesToUpsert
          );
          if (upsertPostesError) throw upsertPostesError;
        }

        this.visualLines.forEach((line) => {
          line.shifts.forEach((shift) => delete shift.isNew);
        });

        // Maintenant que les postes pointent vers d'autres périodes (réassignées
        // par validateAndAutoAssignPeriods), on peut supprimer les périodes orphelines.
        if (this.visualDeletedPeriodIds.length > 0) {
          const { error: deletePerError } = await ApiService.delete('periodes', {
            id: this.visualDeletedPeriodIds,
          });
          if (deletePerError) {
            throw deletePerError;
          }
          this.visualDeletedPeriodIds = [];
        }

        const programmePayload = this.visualProgramEvents.map((ev) => {
          const h = Math.floor(ev.hStart);
          const min = Math.round((ev.hStart - h) * 60);
          const heureStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
          return {
            id: ev.id,
            date_ref: this.visualDaySelected,
            heure: heureStr,
            description: ev.description.trim(),
          };
        });

        try {
          await ApiService.delete('programmes', { date_ref: this.visualDaySelected });
        } catch {}

        if (programmePayload.length > 0) {
          const { error: insertProgError } = await ApiService.upsertMany(
            'programmes',
            programmePayload
          );
          if (insertProgError) throw insertProgError;
        }

        this.visualProgramEvents.forEach((ev) => delete ev.isNew);

        if (!isSilent) {
          this.showToast('💾 Configuration du planning enregistrée avec succès !', 'success');
        }

        await this.loadData();

        if (!isSilent) {
          await this.selectVisualDay(this.visualDaySelected);
        }
      } catch (error) {
        console.error('Erreur enregistrement planning interactif:', error);
        if (!isSilent) {
          this.showToast(`❌ Erreur d'enregistrement : ${error.message}`, 'error');
        } else {
          this.showToast(`❌ Erreur de sauvegarde automatique : ${error.message}`, 'error');
        }
        throw error;
      } finally {
        this.isSavingVisual = false;
        if (!isSilent) {
          this.loading = false;
        }
        if (this.hasPendingChanges) {
          this.hasPendingChanges = false;
          this.triggerAutoSave();
        }
      }
    },

    saveLinesOrder() {
      if (!this.visualDaySelected) return;
      this.visualLines.forEach((line, index) => {
        line.lineIndex = index;
        line.shifts.forEach((shift) => {
          shift.ordre = index;
        });
      });
    },

    // --- Tracé de créneau (drawing mode) ---

    armDrawShift(lineIdx) {
      this.hideShiftTooltip();
      this.isDrawingShift = true;
      this.drawingLineIndex = lineIdx;
      this.showToast(
        '👉 Cliquez-glissez sur la ligne en pointillés orange pour tracer votre créneau.',
        'info'
      );
    },

    cancelDrawShift() {
      this.isDrawingShift = false;
      this.drawingLineIndex = -1;
      this.drawingState = null;
    },

    startDrawingShift(event, lineIdx) {
      if (!this.isDrawingShift || this.drawingLineIndex !== lineIdx) return;
      event.preventDefault();

      const container = event.currentTarget;
      const rect = container.getBoundingClientRect();
      const clientX = event.clientX || (event.touches ? event.touches[0].clientX : 0);
      const clickX = clientX - rect.left;
      const pct = clickX / rect.width;

      const totalHours = this.hoursRange.end - this.hoursRange.start;
      const startHour = this.hoursRange.start + pct * totalHours;
      const startHourSnapped = Math.max(
        this.hoursRange.start,
        Math.min(this.hoursRange.end, Math.round(startHour / 0.25) * 0.25)
      );

      this.drawingState = {
        lineIdx,
        startHour: startHourSnapped,
        currentHour: startHourSnapped,
        containerWidth: rect.width,
        containerLeft: rect.left,
      };

      const handleMove = (e) => this.handleDrawingMove(e);
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleUp);
        this.stopDrawingShift();
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleUp);
    },

    handleDrawingMove(event) {
      if (!this.drawingState) return;
      if (event.cancelable) event.preventDefault();

      const clientX = event.clientX || (event.touches ? event.touches[0].clientX : 0);
      const clickX = clientX - this.drawingState.containerLeft;
      const pct = clickX / this.drawingState.containerWidth;

      const totalHours = this.hoursRange.end - this.hoursRange.start;
      const currentHour = this.hoursRange.start + pct * totalHours;
      const currentHourSnapped = Math.max(
        this.hoursRange.start,
        Math.min(this.hoursRange.end, Math.round(currentHour / 0.25) * 0.25)
      );

      this.drawingState.currentHour = currentHourSnapped;
    },

    stopDrawingShift() {
      if (!this.drawingState) return;

      let debut = Math.min(this.drawingState.startHour, this.drawingState.currentHour);
      let fin = Math.max(this.drawingState.startHour, this.drawingState.currentHour);

      if (fin - debut < 0.25) {
        if (debut + 1 <= this.hoursRange.end) {
          fin = debut + 1;
        } else {
          debut = fin - 1;
        }
      }

      const lineIdx = this.drawingState.lineIdx;
      this.drawingState = null;
      this.isDrawingShift = false;
      this.drawingLineIndex = -1;

      this.openAddShiftModalWithTimes(lineIdx, debut, fin);
    },

    // --- Modales add/edit shift ---

    openAddShiftModalWithTimes(lineIndex, debut, fin) {
      this.hideShiftTooltip();
      const line = this.visualLines[lineIndex];
      if (!line) return;

      this.addShiftData = {
        lineIndex,
        titre: line.titre,
        description: line.description,
        debut,
        fin,
        nb_min: 1,
        nb_max: 5,
        referent_id: '',
      };
      this.showAddShiftModal = true;
    },

    openAddShiftModal(lineIndex = -1) {
      this.hideShiftTooltip();
      if (lineIndex !== -1) {
        const line = this.visualLines[lineIndex];
        this.addShiftData = {
          lineIndex,
          titre: line.titre,
          description: line.description,
          debut: 8,
          fin: 12,
          nb_min: 1,
          nb_max: 5,
          referent_id: '',
        };
      } else {
        this.addShiftData = {
          lineIndex: -1,
          titre: '',
          description: '',
          debut: 8,
          fin: 12,
          nb_min: 1,
          nb_max: 5,
          referent_id: '',
        };
      }
      this.showAddShiftModal = true;
    },

    confirmAddShift() {
      if (!this.addShiftData.titre.trim()) {
        this.showToast('Le titre du poste est obligatoire', 'error');
        return;
      }
      if (this.addShiftData.debut >= this.addShiftData.fin) {
        this.showToast("L'heure de fin doit être supérieure à l'heure de début", 'error');
        return;
      }

      const debut = parseFloat(this.addShiftData.debut);
      const fin = parseFloat(this.addShiftData.fin);
      const nb_min = parseInt(this.addShiftData.nb_min);
      const nb_max = parseInt(this.addShiftData.nb_max);
      const referent_id = this.addShiftData.referent_id;

      const tempId = crypto.randomUUID();
      const newShift = {
        id: tempId,
        isNew: true,
        debut,
        fin,
        nb_min,
        nb_max,
        referent_id,
        inscrits_actuels: 0,
        periode_id: null,
        error: null,
      };

      if (this.addShiftData.lineIndex !== -1) {
        const line = this.visualLines[this.addShiftData.lineIndex];

        const hasOverlap = line.shifts.some((s) => debut < s.fin && fin > s.debut);
        if (hasOverlap) {
          this.showToast('Ce créneau chevauche un créneau existant sur la même ligne', 'error');
          return;
        }

        line.shifts.push(newShift);
        line.shifts.sort((a, b) => a.debut - b.debut);
      } else {
        const index = this.visualLines.length;
        this.visualLines.push({
          titre: this.addShiftData.titre.trim(),
          description: this.addShiftData.description.trim(),
          shifts: [newShift],
          lineIndex: index,
        });
        this.saveLinesOrder();
      }

      this.showAddShiftModal = false;
      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    openEditShiftModal(lineIndex, shiftIndex) {
      this.hideShiftTooltip();
      const line = this.visualLines[lineIndex];
      const shift = line.shifts[shiftIndex];
      if (!line || !shift) return;

      this.editShiftData = {
        lineIndex,
        shiftIndex,
        id: shift.id,
        titre: line.titre,
        description: line.description,
        debut: shift.debut,
        fin: shift.fin,
        nb_min: shift.nb_min,
        nb_max: shift.nb_max,
        referent_id: shift.referent_id || '',
      };
      this.showEditShiftModal = true;
    },

    saveEditShift() {
      if (!this.editShiftData.titre.trim()) {
        this.showToast('Le titre du poste est obligatoire', 'error');
        return;
      }
      if (this.editShiftData.debut >= this.editShiftData.fin) {
        this.showToast("L'heure de fin doit être supérieure à l'heure de début", 'error');
        return;
      }

      const line = this.visualLines[this.editShiftData.lineIndex];
      const shift = line.shifts[this.editShiftData.shiftIndex];
      if (!line || !shift) return;

      const debut = parseFloat(this.editShiftData.debut);
      const fin = parseFloat(this.editShiftData.fin);

      const hasOverlap = line.shifts.some((s, idx) => {
        if (idx === this.editShiftData.shiftIndex) return false;
        return debut < s.fin && fin > s.debut;
      });

      if (hasOverlap) {
        this.showToast('Ce créneau chevauche un créneau existant sur la même ligne', 'error');
        return;
      }

      const titreChange = line.titre !== this.editShiftData.titre.trim();
      const descChange = line.description !== this.editShiftData.description.trim();

      line.titre = this.editShiftData.titre.trim();
      line.description = this.editShiftData.description.trim();

      shift.debut = debut;
      shift.fin = fin;
      shift.nb_min = parseInt(this.editShiftData.nb_min);
      shift.nb_max = parseInt(this.editShiftData.nb_max);
      shift.referent_id = this.editShiftData.referent_id || null;

      line.shifts.sort((a, b) => a.debut - b.debut);

      if (titreChange || descChange) {
        this.saveLinesOrder();
      }

      this.showEditShiftModal = false;
      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    async deleteShiftFromModal() {
      if (this.editShiftData.lineIndex === -1 || this.editShiftData.shiftIndex === -1) return;
      const confirmed = await Alpine.store('admin').askConfirm(
        'Voulez-vous supprimer ce créneau ?',
        'Supprimer le créneau'
      );
      if (!confirmed) return;

      const line = this.visualLines[this.editShiftData.lineIndex];
      const shift = line.shifts[this.editShiftData.shiftIndex];

      if (shift.id && !shift.isNew) {
        this.visualDeletedPosteIds.push(shift.id);
      }

      line.shifts.splice(this.editShiftData.shiftIndex, 1);

      this.showEditShiftModal = false;
      this.validateAndAutoAssignPeriods();
      this.triggerAutoSave();
    },

    // --- Tooltip survol créneau ---

    showShiftTooltip(event, line, shift) {
      let referentNom = 'Aucun';
      if (shift.referent_id) {
        const ref = this.getReferents().find((r) => r.id === shift.referent_id);
        if (ref) {
          referentNom = `${ref.prenom} ${ref.nom}`;
        }
      }

      this.hoveredShift = {
        shift,
        line,
        referentNom,
        inscrits_noms: shift.inscrits_noms || [],
        x: event.clientX + 15,
        y: event.clientY + 15,
      };

      this.$nextTick(() => {
        this.adjustShiftTooltipPosition(event);
      });
    },

    updateShiftTooltip(event) {
      if (this.hoveredShift) {
        this.adjustShiftTooltipPosition(event);
      }
    },

    adjustShiftTooltipPosition(event) {
      if (!this.hoveredShift) return;

      let x = event.clientX + 15;
      let y = event.clientY + 15;

      const tooltipEl = document.querySelector('[x-show="hoveredShift"]');
      if (tooltipEl) {
        const rect = tooltipEl.getBoundingClientRect();
        const wWidth = window.innerWidth;
        const wHeight = window.innerHeight;

        if (x + rect.width > wWidth) {
          x = event.clientX - rect.width - 15;
        }
        if (y + rect.height > wHeight) {
          y = event.clientY - rect.height - 15;
        }

        if (x < 10) x = 10;
        if (y < 10) y = 10;
      }

      this.hoveredShift.x = x;
      this.hoveredShift.y = y;
    },

    hideShiftTooltip() {
      this.hoveredShift = null;
    },

    // --- Drag de lignes (clic long) ---

    startLineDragTimer(event, lineIndex) {
      if (
        event.target.closest('button') ||
        event.target.closest('a') ||
        event.target.closest('input')
      ) {
        return;
      }

      event.preventDefault();
      const clientY = event.clientY || (event.touches ? event.touches[0].clientY : 0);

      this.lineDragTimer = setTimeout(() => {
        this.startLineDrag(event, lineIndex, clientY);
      }, 400);

      const clearTimer = () => {
        if (this.lineDragTimer) {
          clearTimeout(this.lineDragTimer);
          this.lineDragTimer = null;
        }
        document.removeEventListener('mouseup', clearTimer);
        document.removeEventListener('touchend', clearTimer);
      };
      document.addEventListener('mouseup', clearTimer);
      document.addEventListener('touchend', clearTimer);
    },

    startLineDrag(event, lineIndex, startY) {
      this.lineDragTimer = null;
      this.lineDragState = {
        lineIndex,
        startY,
        currentY: startY,
      };

      const handleMove = (e) => {
        if (!this.lineDragState) return;
        const currentY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
        this.handleLineDrag(currentY);
      };

      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleUp);
        this.stopLineDrag();
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleUp);
    },

    handleLineDrag(currentY) {
      if (!this.lineDragState) return;

      const diffY = currentY - this.lineDragState.startY;
      const lineIdx = this.lineDragState.lineIndex;

      const threshold = 35;
      if (diffY > threshold && lineIdx < this.visualLines.length - 1) {
        const temp = this.visualLines[lineIdx];
        this.visualLines[lineIdx] = this.visualLines[lineIdx + 1];
        this.visualLines[lineIdx + 1] = temp;

        this.visualLines[lineIdx].lineIndex = lineIdx;
        this.visualLines[lineIdx + 1].lineIndex = lineIdx + 1;

        this.lineDragState.lineIndex = lineIdx + 1;
        this.lineDragState.startY = currentY;
        this.saveLinesOrder();
      } else if (diffY < -threshold && lineIdx > 0) {
        const temp = this.visualLines[lineIdx];
        this.visualLines[lineIdx] = this.visualLines[lineIdx - 1];
        this.visualLines[lineIdx - 1] = temp;

        this.visualLines[lineIdx].lineIndex = lineIdx;
        this.visualLines[lineIdx - 1].lineIndex = lineIdx - 1;

        this.lineDragState.lineIndex = lineIdx - 1;
        this.lineDragState.startY = currentY;
        this.saveLinesOrder();
      }
    },

    stopLineDrag() {
      this.lineDragState = null;
      this.saveLinesOrder();
      this.triggerAutoSave();
    },
  };
}
