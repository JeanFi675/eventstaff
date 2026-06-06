/**
 * Logique de validation et d'assignation des créneaux du visual-creator admin.
 * Fonctions pures (zéro dépendance Alpine, zéro mutation cachée).
 */

/**
 * Calcule la durée d'overlap entre un créneau et une période (en heures décimales).
 * Retourne 0 s'il n'y a pas d'intersection.
 * @param {number} shiftStart - Heure de début du créneau.
 * @param {number} shiftEnd - Heure de fin du créneau.
 * @param {number} periodStart - Heure de début de la période.
 * @param {number} periodEnd - Heure de fin de la période.
 * @returns {number} Durée d'overlap (>= 0).
 */
export function calculateShiftPeriodOverlap(shiftStart, shiftEnd, periodStart, periodEnd) {
  return Math.max(0, Math.min(shiftEnd, periodEnd) - Math.max(shiftStart, periodStart));
}

/**
 * Choisit la période la plus adaptée pour un créneau.
 * Règle primaire : durée d'overlap maximale.
 * Fallback (aucun overlap) : période dont le milieu est le plus proche du milieu du créneau.
 * @param {{debut: number, fin: number}} shift - Créneau à classer.
 * @param {Array<{id: string, debut: number, fin: number}>} periods - Périodes candidates.
 * @returns {string|null} ID de la période choisie, ou null si `periods` est vide.
 */
export function findBestPeriodForShift(shift, periods) {
  if (!periods || periods.length === 0) return null;

  let maxOverlap = 0;
  let bestPeriodId = null;

  for (const per of periods) {
    const overlap = calculateShiftPeriodOverlap(shift.debut, shift.fin, per.debut, per.fin);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      bestPeriodId = per.id;
    }
  }

  if (bestPeriodId) return bestPeriodId;

  // Fallback : période la plus proche du milieu du créneau.
  const shiftMid = (shift.debut + shift.fin) / 2;
  let minDistance = Infinity;
  let closestPeriodId = periods[0].id;
  for (const per of periods) {
    const perMid = (per.debut + per.fin) / 2;
    const dist = Math.abs(shiftMid - perMid);
    if (dist < minDistance) {
      minDistance = dist;
      closestPeriodId = per.id;
    }
  }
  return closestPeriodId;
}

/**
 * Détecte les chevauchements de créneaux partageant le même titre.
 * Tolérance numérique : 0.01h pour éviter les faux positifs sur des bornes contiguës.
 * Aucune mutation : retourne les paires en conflit et leurs messages, l'appelant applique l'état.
 * @param {Array<{shift: object, lineTitle: string, lineTitleRaw: string, lineDescription: string}>} allShifts
 * @param {(dec: number) => string} formatDecimalHourFn - Formateur d'heure injecté (ex: "08h30").
 * @returns {Array<{shiftA: object, shiftB: object, message: string}>}
 */
export function detectShiftConflicts(allShifts, formatDecimalHourFn) {
  const conflicts = [];
  for (let i = 0; i < allShifts.length; i++) {
    const s1 = allShifts[i];
    for (let j = i + 1; j < allShifts.length; j++) {
      const s2 = allShifts[j];
      if (s1.lineTitle !== s2.lineTitle) continue;

      const overlap = s1.shift.debut < s2.shift.fin - 0.01 && s1.shift.fin > s2.shift.debut + 0.01;
      if (!overlap) continue;

      const time1 = `${formatDecimalHourFn(s1.shift.debut)}–${formatDecimalHourFn(s1.shift.fin)}`;
      const time2 = `${formatDecimalHourFn(s2.shift.debut)}–${formatDecimalHourFn(s2.shift.fin)}`;
      let message = `Le créneau ${time1} de "${s1.lineTitleRaw}"`;
      if (s1.lineDescription) message += ` (${s1.lineDescription})`;
      message += ` chevauche le créneau ${time2} de "${s2.lineTitleRaw}"`;
      if (s2.lineDescription) message += ` (${s2.lineDescription})`;

      conflicts.push({ shiftA: s1.shift, shiftB: s2.shift, message });
    }
  }
  return conflicts;
}

const MOIS_FR_MAP = {
  janvier: 0,
  fevrier: 1,
  février: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  août: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
  décembre: 11,
};

/**
 * Calcule un poids chronologique pour trier une période globalement.
 * Source de vérité (dans l'ordre) :
 *  1. Période en cours d'édition dans le visual-creator → timestamp du jour + offset horaire.
 *  2. Postes existants rattachés → début du plus ancien.
 *  3. Parsing du nom FR ("Samedi 16 mai - 08:00 / 12:00") → timestamp reconstruit.
 *  4. Fallback : valeur sentinelle en queue d'ordre.
 *
 * @param {{id: string, nom?: string, ordre?: number}} per - Période à pondérer.
 * @param {{
 *   currentPeriodIds: Set<string>,
 *   visualPeriods: Array<{id: string, debut?: number}>,
 *   postes: Array<{periode_id: string, periode_debut: string}>,
 *   daySelected: string
 * }} ctx
 * @returns {number} Poids (timestamp ms, plus petit = plus tôt).
 */
export function computePeriodWeight(per, ctx) {
  const { currentPeriodIds, visualPeriods, postes, daySelected } = ctx;

  if (currentPeriodIds.has(per.id)) {
    const vp = visualPeriods.find((p) => p.id === per.id);
    const dayTime = new Date(daySelected + 'T00:00:00').getTime();
    const hourOffset = ((vp && vp.debut) || 0) * 3600000;
    return dayTime + hourOffset;
  }

  const perPostes = postes.filter((p) => p.periode_id === per.id && p.periode_debut);
  if (perPostes.length > 0) {
    const starts = perPostes.map((p) => new Date(p.periode_debut).getTime());
    return Math.min(...starts);
  }

  if (per.nom) {
    const cleanNom = per.nom.toLowerCase();
    const match = cleanNom.match(/(\d{1,2})\s+([a-zéû]+)/);
    if (match) {
      const dayNum = parseInt(match[1]);
      const moisStr = match[2];
      if (MOIS_FR_MAP[moisStr] !== undefined) {
        const yearMatch = cleanNom.match(/20\d{2}/);
        const year = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
        const parsedDate = new Date(year, MOIS_FR_MAP[moisStr], dayNum);

        let hour = 8;
        const timeMatch = cleanNom.match(/(\d{1,2})[:h](\d{2})/);
        if (timeMatch) {
          hour = parseInt(timeMatch[1]) + parseInt(timeMatch[2]) / 60;
        }
        return parsedDate.getTime() + hour * 3600000;
      }
    }
  }

  return 9999999999999 + (per.ordre || 0);
}
