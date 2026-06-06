/**
 * Helpers date/heure de l'admin (visual-creator, timeline).
 * Fonctions pures, sans dépendance Alpine.
 */

/**
 * Convertit une date ISO en clé locale au format YYYY-MM-DD.
 * @param {string} isoStr - Date ISO (ex: "2026-05-16T08:00:00Z").
 * @returns {string} Clé locale (ex: "2026-05-16") ou "" si vide.
 */
export function getLocalDateKey(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formate une heure décimale en libellé "HHhMM".
 * @param {number} dec - Heure décimale (ex: 8.5).
 * @returns {string} Libellé formaté (ex: "08h30").
 */
export function formatDecimalHour(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`;
}

/**
 * Formate une heure décimale en libellé "HH:MM".
 * @param {number} dec - Heure décimale (ex: 8.5).
 * @returns {string} Libellé formaté (ex: "08:30").
 */
export function formatHourMin(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Formate une clé YYYY-MM-DD en libellé français capitalisé.
 * @param {string} dayKey - Clé jour (ex: "2026-05-16").
 * @returns {string} Libellé (ex: "Samedi 16 mai") ou "" si vide.
 */
export function formatDay(dayKey) {
  if (!dayKey) return '';
  const [y, m, d] = dayKey.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const formatted = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Combine un jour YYYY-MM-DD et une heure décimale en ISO string.
 * @param {number} dec - Heure décimale (ex: 8.5).
 * @param {string} dayStr - Jour au format YYYY-MM-DD.
 * @returns {string} ISO string.
 */
export function formatDecimalToISO(dec, dayStr) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  return new Date(`${dayStr}T${timeStr}`).toISOString();
}
