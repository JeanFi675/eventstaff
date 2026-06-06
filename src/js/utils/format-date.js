/**
 * Formats a date string to a French readable format.
 * @param {string} dateString - The ISO date string.
 * @returns {string} Formatted date (e.g., "sam. 14 juin").
 */
export function formatDate(dateString) {
  const date = new Date(dateString);
  /** @type {Intl.DateTimeFormatOptions} */
  const options = { weekday: 'short', day: 'numeric', month: 'short' };
  return date.toLocaleDateString('fr-FR', options);
}

/**
 * Formats a date string to time only.
 * @param {string} dateString - The ISO date string.
 * @returns {string} Formatted time (e.g., "08:00").
 */
export function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formats a date string to full date and time.
 * @param {string} dateString - The ISO date string.
 * @returns {string} Formatted string (e.g., "sam. 14 juin, 08:00").
 */
export function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a date string for HTML datetime-local input.
 * @param {string} dateString - The ISO date string.
 * @returns {string} Formatted string (e.g., "2023-06-14T08:00").
 */
export function formatDateTimeForInput(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
