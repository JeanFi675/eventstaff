import { getPublicSupabaseClient } from '../config.js';

/**
 * Service d'accès aux RPCs publiques (rôle `anon`, sans session utilisateur).
 *
 * À utiliser exclusivement par les pages publiques accédées sans authentification
 * (ex: page `debit.html` scannée via QR code par un commerçant).
 *
 * Les RPCs appelées via ce service doivent être :
 * - soit ouvertes au rôle `anon` côté Postgres (GRANT EXECUTE TO anon),
 * - soit déclarées `SECURITY DEFINER` avec leurs propres contrôles internes.
 *
 * Pour le reste de l'app (utilisateur authentifié, admin, etc.), utiliser
 * `ApiService` (src/js/services/api.js) qui consomme le client principal avec session.
 *
 * @namespace PublicApiService
 */
export const PublicApiService = {
  /**
   * Appelle une fonction RPC publique via le client Supabase isolé.
   *
   * Ne wrappe pas de timeout par défaut : les callers ajoutent leur propre
   * `Promise.race` s'ils ont des contraintes de latence spécifiques.
   *
   * @param {string} rpcName
   * @param {object} [params]
   * @returns {Promise<{ data: any, error: object|null }>}
   */
  async rpc(rpcName, params = {}) {
    return await getPublicSupabaseClient().rpc(rpcName, params);
  },
};
