// @ts-nocheck
import Alpine from 'alpinejs';
import { AuthService } from './services/auth.js';
import { ApiService } from './services/api.js';
import { pushToast } from './utils/toast.js';

const PROGRAMME = { meta: [], days: {} };

// ---------------------------------------------------------------------------
// Composant Alpine
// ---------------------------------------------------------------------------
export function initAdminTimelineApp() {
  Alpine.data('adminTimelineApp', () => ({
    user: /** @type {any} */ (null),
    loading: true,
    isAdmin: false,
    /** @type {any[]} */
    postes: [],
    /** @type {Record<string, number>} */
    inscriptionCounts: {},
    selectedDay: null,
    toasts: [],
    tooltip: {
      show: false,
      titre: '',
      description: '',
      nb_min: 0,
      nb_max: 0,
      inscrits: 0,
      debutStr: '',
      finStr: '',
      liste_benevoles: [],
      x: 0,
      y: 0,
    },
    dbProgramme: null,

    getLocalDateKey(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },

    get availableDays() {
      const days = new Set();

      // Jours des postes
      this.postes.forEach((p) => {
        if (p.periode_debut) {
          days.add(this.getLocalDateKey(p.periode_debut));
        }
      });

      // Jours du programme en DB
      if (this.dbProgramme && this.dbProgramme.days) {
        Object.keys(this.dbProgramme.days).forEach((d) => days.add(d));
      }

      return Array.from(days).sort();
    },

    get postesDuJour() {
      if (!this.selectedDay) return [];
      return this.postes
        .filter((p) => {
          return this.getLocalDateKey(p.periode_debut) === this.selectedDay;
        })
        .sort((a, b) => new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime());
    },

    get hourRange() {
      const postes = this.postesDuJour;
      if (!postes.length) return { start: 8, end: 20 };
      const starts = postes.map((p) => new Date(p.periode_debut).getHours());
      const ends = postes.map((p) => {
        const d = new Date(p.periode_fin);
        return d.getHours() + (d.getMinutes() > 0 ? 1 : 0);
      });
      return {
        start: Math.max(0, Math.min(...starts) - 1),
        end: Math.min(24, Math.max(...ends) + 1),
      };
    },

    get segments() {
      const postes = this.postesDuJour;
      if (!postes.length) return [];
      const roundSec = (ms) => Math.round(ms / 1000) * 1000;
      const bps = new Set();
      postes.forEach((p) => {
        bps.add(roundSec(new Date(p.periode_debut).getTime()));
        bps.add(roundSec(new Date(p.periode_fin).getTime()));
      });
      const sorted = Array.from(bps).sort((a, b) => a - b);
      const segs = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const t = sorted[i],
          tNext = sorted[i + 1];
        const active = postes.filter((p) => {
          const debut = roundSec(new Date(p.periode_debut).getTime());
          const fin = roundSec(new Date(p.periode_fin).getTime());
          return debut <= t && fin > t;
        });
        if (!active.length) continue;
        const byTitre = new Map();
        active.forEach((p) => {
          if (!byTitre.has(p.titre)) byTitre.set(p.titre, []);
          byTitre.get(p.titre).push(p);
        });
        let sum_min = 0,
          sum_max = 0,
          sum_inscrits = 0;
        byTitre.forEach((group) => {
          sum_min += Math.max(...group.map((p) => p.nb_min || 0));
          sum_max += Math.max(...group.map((p) => p.nb_max || 0));
          sum_inscrits += group.reduce((acc, p) => acc + (this.inscriptionCounts[p.id] ?? 0), 0);
        });
        segs.push({
          start: t,
          end: tNext,
          sum_min,
          sum_max,
          sum_inscrits,
          posteTitres: Array.from(byTitre.keys()),
          distinctCount: byTitre.size,
          count: active.length,
        });
      }
      return segs;
    },

    get peaks() {
      const ids = new Set();
      this.segments.forEach((s, i) => {
        if (s.distinctCount > 1) ids.add(i);
      });
      return ids;
    },

    get maxLoad() {
      if (!this.segments.length) return 1;
      return Math.max(...this.segments.map((s) => Math.max(s.sum_max, s.sum_inscrits ?? 0)), 1);
    },

    // Ticks Y pour l'axe vertical HTML (en dehors du SVG)
    get svgYTicks() {
      if (!this.selectedDay || !this.segments.length) return [];
      const chartH = 120;
      const maxLoad = this.maxLoad;
      const yOf = (v) => chartH - Math.round((v / maxLoad) * (chartH - 10));
      return [maxLoad, Math.round(maxLoad / 2), 0].map((v) => ({
        v,
        topPct: (yOf(v) / chartH) * 100,
      }));
    },

    get svgMarkup() {
      if (!this.selectedDay) return '';
      const segs = this.segments;
      if (!segs.length)
        return '<svg style="width:100%;height:60px"><text x="10" y="35" font-size="13" fill="#6b7280">Aucun segment à afficher.</text></svg>';
      // padL=0 : l'axe Y est géré par la div HTML 130px à gauche — alignement parfait avec le Gantt
      // padB=0 : heures et cercles programme gérés en HTML sous le SVG (pas dans le SVG)
      const W = 820,
        chartH = 120;
      const usableW = W;
      const maxLoad = this.maxLoad,
        peaks = this.peaks;
      const range = this.hourRange;
      const totalMs = (range.end - range.start) * 3600000;
      const dayStart = new Date(this.selectedDay + 'T00:00:00');
      dayStart.setHours(range.start, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const xOf = (ms) => Math.max(0, Math.min(1, (ms - dayStartMs) / totalMs)) * usableW;
      const yOf = (v) => chartH - Math.round((v / maxLoad) * (chartH - 10));

      const maxFill = [`${xOf(segs[0].start).toFixed(1)},${chartH}`];
      const minFill = [`${xOf(segs[0].start).toFixed(1)},${chartH}`];
      const minLinePts = [],
        maxLinePts = [],
        inscritLinePts = [];
      segs.forEach((seg) => {
        const x1 = xOf(seg.start).toFixed(1),
          x2 = xOf(seg.end).toFixed(1);
        maxFill.push(`${x1},${yOf(seg.sum_max)}`, `${x2},${yOf(seg.sum_max)}`);
        minFill.push(`${x1},${yOf(seg.sum_min)}`, `${x2},${yOf(seg.sum_min)}`);
        minLinePts.push(`${x1},${yOf(seg.sum_min)}`, `${x2},${yOf(seg.sum_min)}`);
        maxLinePts.push(`${x1},${yOf(seg.sum_max)}`, `${x2},${yOf(seg.sum_max)}`);
        inscritLinePts.push(`${x1},${yOf(seg.sum_inscrits)}`, `${x2},${yOf(seg.sum_inscrits)}`);
      });
      maxFill.push(`${xOf(segs[segs.length - 1].end).toFixed(1)},${chartH}`);
      minFill.push(`${xOf(segs[segs.length - 1].end).toFixed(1)},${chartH}`);

      const peakRects = '';

      const labels = segs
        .map((seg, i) => {
          const x1 = xOf(seg.start),
            x2 = xOf(seg.end);
          if (x2 - x1 < 35) return '';
          const xmid = ((x1 + x2) / 2).toFixed(1);
          const y = Math.max(12, yOf(seg.sum_max) - 4);
          const color = peaks.has(i) ? '#dc2626' : '#1e40af';
          return `<text x="${xmid}" y="${y}" text-anchor="middle" font-size="9" font-weight="bold" fill="${color}">${seg.sum_min}/${seg.sum_max}</text>`;
        })
        .join('');

      // Grille verticale seulement — heures et cercles programme sont en HTML sous le SVG
      const ticks = this.hourTicks
        .map((tick) => {
          const x = ((tick.pct / 100) * usableW).toFixed(1);
          return `<line x1="${x}" y1="0" x2="${x}" y2="${chartH}" stroke="#e5e7eb" stroke-width="1"/>
<line x1="${x}" y1="${chartH}" x2="${x}" y2="${chartH + 4}" stroke="#9ca3af" stroke-width="1"/>`;
        })
        .join('\n');

      // Lignes programme uniquement (cercles en HTML sous le SVG)
      const progMarkers = this.programmeDuJour
        .map((ev) => {
          const x = (
            Math.max(0, Math.min(1, (ev.hStart - range.start) / (range.end - range.start))) *
            usableW
          ).toFixed(1);
          return `<line x1="${x}" y1="0" x2="${x}" y2="${chartH}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>`;
        })
        .join('\n');

      return `<svg viewBox="0 0 ${W} ${chartH}" style="width:100%;display:block;" font-family="'Space Grotesk',system-ui,sans-serif">
  ${peakRects}
  <polygon points="${maxFill.join(' ')}" fill="#93c5fd" opacity="0.45"/>
  <polygon points="${minFill.join(' ')}" fill="#3b82f6" opacity="0.4"/>
  ${ticks}
  <polyline points="${maxLinePts.join(' ')}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linejoin="miter"/>
  <polyline points="${minLinePts.join(' ')}" fill="none" stroke="#1d4ed8" stroke-width="2.5" stroke-linejoin="miter"/>
  <polyline points="${inscritLinePts.join(' ')}" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linejoin="miter" stroke-dasharray="6,3"/>
  ${labels}
  ${progMarkers}
  <line x1="0" y1="${chartH}" x2="${W}" y2="${chartH}" stroke="#374151" stroke-width="1.5"/>
</svg>`;
    },

    get hourTicks() {
      const range = this.hourRange;
      const total = range.end - range.start;
      if (total <= 0) return [];
      const ticks = [];
      for (let h = range.start; h <= range.end; h++) {
        ticks.push({ h, pct: ((h - range.start) / total) * 100, label: this.formatHour(h) });
      }
      return ticks;
    },

    get ganttGroups() {
      if (!this.selectedDay) return [];
      const range = this.hourRange;
      const totalMs = (range.end - range.start) * 3600000;
      const dayStart = new Date(this.selectedDay + 'T00:00:00');
      dayStart.setHours(range.start, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const pos = (poste) => {
        const debut = new Date(poste.periode_debut).getTime();
        const fin = new Date(poste.periode_fin).getTime();
        const inscrits = this.inscriptionCounts[poste.id] || 0;

        let baseColor = 'bg-red-100';
        let fillColor = 'bg-red-300';
        let borderColor = 'border-red-400';

        if (inscrits >= poste.nb_max) {
          baseColor = 'bg-green-100';
          fillColor = 'bg-green-300';
          borderColor = 'border-green-400';
        } else if (inscrits >= poste.nb_min) {
          baseColor = 'bg-yellow-100';
          fillColor = 'bg-yellow-300';
          borderColor = 'border-yellow-400';
        }

        return {
          ...poste,
          inscrits,
          baseColor,
          fillColor,
          borderColor,
          leftPct: Math.max(0, ((debut - dayStartMs) / totalMs) * 100),
          widthPct: Math.max(0.5, ((fin - debut) / totalMs) * 100),
          debutStr: this.formatTime(debut),
          finStr: this.formatTime(fin),
        };
      };
      const groups = new Map();
      this.postesDuJour.forEach((p) => {
        if (!groups.has(p.titre)) groups.set(p.titre, []);
        groups.get(p.titre).push(pos(p));
      });
      return Array.from(groups.entries())
        .map(([titre, bars]) => ({
          titre,
          bars: bars.sort(
            (a, b) => new Date(a.periode_debut).getTime() - new Date(b.periode_debut).getTime()
          ),
          firstDebut: Math.min(...bars.map((b) => new Date(b.periode_debut).getTime())),
        }))
        .sort((a, b) => a.firstDebut - b.firstDebut)
        .map((g, gIdx) => ({ ...g, gIdx }));
    },

    // Événements du programme pour le jour sélectionné, avec position % sur l'axe
    get programmeDuJour() {
      const prog = this.dbProgramme || PROGRAMME;
      if (!this.selectedDay || !prog.days[this.selectedDay]) return [];
      const range = this.hourRange;
      const total = range.end - range.start;
      return prog.days[this.selectedDay].events.map((ev) => ({
        ...ev,
        xPct: Math.max(0, Math.min(100, ((ev.hStart - range.start) / total) * 100)),
      }));
    },

    // Texte d'information générale du programme (avant le premier ##)
    get programmeMeta() {
      const prog = this.dbProgramme || PROGRAMME;
      return prog.meta || [];
    },

    showTooltip(poste, event) {
      this.tooltip = {
        show: true,
        titre: poste.titre || '',
        description: poste.description || '',
        nb_min: poste.nb_min,
        nb_max: poste.nb_max,
        inscrits: poste.inscrits,
        debutStr: poste.debutStr || this.formatTime(new Date(poste.periode_debut).getTime()),
        finStr: poste.finStr || this.formatTime(new Date(poste.periode_fin).getTime()),
        liste_benevoles: poste.liste_benevoles || [],
        x: event.clientX + 16,
        y: event.clientY - 10,
      };

      this.$nextTick(() => {
        this.adjustTooltipPosition(event);
      });
    },

    showProgramTooltip(ev, event) {
      this.tooltip = {
        show: true,
        titre: `Repère #${ev.num || ''}`,
        description: ev.description || '',
        nb_min: 0,
        nb_max: 0,
        inscrits: null,
        debutStr: ev.timeLabel || '',
        finStr: '',
        x: event.clientX + 16,
        y: event.clientY - 10,
      };

      this.$nextTick(() => {
        this.adjustTooltipPosition(event);
      });
    },

    moveTooltip(event) {
      if (this.tooltip.show) {
        this.adjustTooltipPosition(event);
      }
    },

    adjustTooltipPosition(event) {
      if (!this.tooltip.show) return;

      let x = event.clientX + 16;
      let y = event.clientY - 10;

      const tooltipEl = document.querySelector('[x-show="tooltip.show"]');
      if (tooltipEl) {
        const rect = tooltipEl.getBoundingClientRect();
        const wWidth = window.innerWidth;
        const wHeight = window.innerHeight;

        if (x + rect.width > wWidth) {
          x = event.clientX - rect.width - 16;
        }
        if (y + rect.height > wHeight) {
          y = event.clientY - rect.height + 10;
        }

        if (x < 10) x = 10;
        if (y < 10) y = 10;
      }

      this.tooltip.x = x;
      this.tooltip.y = y;
    },

    hideTooltip() {
      this.tooltip.show = false;
    },
    selectDay(day) {
      if (this.selectedDay === day) {
        this.selectedDay = null;
      } else {
        this.selectedDay = day;
      }
    },
    formatDay(dayKey) {
      if (!dayKey) return '';
      const [y, m, d] = dayKey.split('-');
      return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    },

    formatTime(ts) {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
    },

    formatHour(h) {
      return `${String(h).padStart(2, '0')}h`;
    },

    addToast(message, type = 'info') {
      pushToast(this.toasts, message, type);
    },

    async init() {
      let { user } = await AuthService.getSession();
      if (!user) {
        window.location.href = 'index.html';
        return;
      }
      this.user = user;
      await this.loadProgramme();
      await this.checkAdminRole();
    },

    async loadProgramme() {
      try {
        const { data, error } = await ApiService.fetch('programmes', {
          order: { column: 'heure', ascending: true },
        });
        if (error) throw error;
        if (data && data.length > 0) {
          const days = {};
          data.forEach((item) => {
            const dateKey = item.date_ref; // format YYYY-MM-DD
            if (!days[dateKey]) {
              const d = new Date(dateKey + 'T00:00:00');
              const label = d.toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              });
              days[dateKey] = { label, events: [] };
            }

            // Convert time '07:00:00' to hStart decimal and timeLabel
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

    async checkAdminRole() {
      try {
        const { data, error } = await ApiService.fetch('benevoles', {
          eq: { user_id: this.user.id },
        });
        if (error) throw error;
        this.isAdmin = data && data.some((p) => p.role === 'admin');
        // Toujours charger les postes, même si pas admin, car l'accès est public
        await this.loadPostes();
      } catch (err) {
        console.error('Erreur vérification droits admin:', err);
        this.isAdmin = false;
        // On essaie quand même de charger les postes au cas où
        await this.loadPostes();
      } finally {
        this.loading = false;
        const days = this.availableDays;
        if (days.length > 0 && !this.selectedDay) {
          this.selectedDay = days[0];
        }
      }
    },

    async loadPostes() {
      try {
        const { data, error } = await ApiService.fetch('public_planning', {
          select:
            'poste_id, titre, description, periode_debut, periode_fin, nb_min, nb_max, liste_benevoles',
          order: { column: 'periode_debut', ascending: true },
        });
        if (error) throw error;
        this.postes = (data || []).map((p) => ({
          id: p.poste_id,
          titre: p.titre,
          description: p.description,
          periode_debut: p.periode_debut,
          periode_fin: p.periode_fin,
          nb_min: p.nb_min,
          nb_max: p.nb_max,
          liste_benevoles: p.liste_benevoles || [],
        }));
      } catch (err) {
        console.error('Erreur chargement postes:', err);
        this.addToast('Erreur lors du chargement des postes', 'error');
      }
      this.loadInscriptionCounts();
    },

    loadInscriptionCounts() {
      // Compte d'occupation dérivé de public_planning.liste_benevoles (liste anonymisée
      // complète, déjà chargée dans loadPostes et accessible à TOUS les rôles). On
      // n'interroge pas la table `inscriptions` : protégée par RLS, elle renverrait 0
      // pour un non-admin → tous les postes en rouge (cf. audit/notes.md 2026-06-04).
      const counts = {};
      this.postes.forEach((p) => {
        counts[p.id] = (p.liste_benevoles || []).length;
      });
      this.inscriptionCounts = counts;
    },
  }));
}

// initAdminTimelineApp() and Alpine.start() are called by admin.js
