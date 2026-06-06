import { supabase, safeRefreshSession } from '../config.js';

/**
 * Service handling authentication operations.
 * @namespace AuthService
 */
export const AuthService = {
  /**
   * Gets the current session from Supabase.
   * @returns {Promise<{ session: object|null, user: object|null }>} The session and user object.
   */
  async getSession() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('❌ AuthService.getSession error:', error);
        return { session: null, user: null };
      }
      return {
        session: data?.session || null,
        user: data?.session?.user || null,
      };
    } catch (err) {
      console.error('❌ AuthService.getSession exception:', err);
      return { session: null, user: null };
    }
  },

  /**
   * Subscribes to authentication state changes.
   * @param {function(string, object): void} callback - Function called on state change.
   * @returns {object} The subscription object (call .unsubscribe() to stop).
   */
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },

  /**
   * Sends a magic link to the specified email.
   * @param {string} email - The user's email address.
   * @returns {Promise<{ error: object|null }>} Result of the operation.
   */
  async signInWithOtp(email) {
    return await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
  },

  /**
   * Verifies an OTP code for the given email.
   * @param {string} email - The user's email address.
   * @param {string} token - The 6-digit OTP code.
   * @returns {Promise<{ data: object|null, error: object|null }>} Result of the operation.
   */
  async verifyOtp(email, token) {
    return await supabase.auth.verifyOtp({
      email,
      token,
      type: 'magiclink',
    });
  },

  /**
   * Logs out the current user.
   * @returns {Promise<{ error: object|null }>} Result of the operation.
   */
  async signOut() {
    return await supabase.auth.signOut();
  },

  /**
   * Refreshes the current session safely (singleton de déduplication
   * géré dans config.js pour éviter les race conditions).
   * @returns {Promise<{ data: { session: object|null }, error: object|null }>}
   */
  async refreshSession() {
    return await safeRefreshSession();
  },
};
