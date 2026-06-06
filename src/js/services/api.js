import { supabase } from '../config.js';

/**
 * Generic service for database operations.
 * @namespace ApiService
 */
export const ApiService = {
  /**
   * Fetches data from a table with optional filtering and ordering.
   * @param {string} table - The table name.
   * @param {object} [options] - Query options.
   * @param {string} [options.select='*'] - Columns to select.
   * @param {object} [options.eq] - Equality filter { column: value }.
   * @param {object} [options.in] - In filter { column: [values] }.
   * @param {object} [options.order] - Ordering { column: 'name', ascending: true }.
   * @returns {Promise<{ data: any[], error: object|null }>} The query result.
   */
  async fetch(table, options = {}) {
    let query = supabase.from(table).select(options.select || '*');

    if (options.eq) {
      for (const [key, value] of Object.entries(options.eq)) {
        query = query.eq(key, value);
      }
    }

    if (options.in) {
      for (const [key, value] of Object.entries(options.in)) {
        query = query.in(key, value);
      }
    }

    if (options.order) {
      query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
    }

    return await query;
  },

  /**
   * Calls a remote procedure (SQL function).
   * @param {string} rpcName - The name of the RPC function.
   * @param {object} [params] - Parameters for the function.
   * @returns {Promise<{ data: any, error: object|null }>} The result.
   */
  async rpc(rpcName, params = {}) {
    // Enforce a 30s timeout on RPC calls (increased from 15s for slow transactions)
    const rpcCall = supabase.rpc(rpcName, params);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RPC Timeout (30s)')), 30000)
    );
    return await Promise.race([rpcCall, timeout]);
  },

  /**
   * Inserts a new record into a table.
   * @param {string} table - The table name.
   * @param {object} data - The data to insert.
   * @returns {Promise<{ data: any, error: object|null }>} The inserted data.
   */
  async insert(table, data) {
    return await supabase.from(table).insert(data);
  },

  /**
   * Updates an existing record.
   * @param {string} table - The table name.
   * @param {object} data - The data to update.
   * @param {object} match - The condition to match { column: value }.
   * @returns {Promise<{ data: any, error: object|null }>} The updated data.
   */
  async update(table, data, match) {
    let query = supabase.from(table).update(data);

    for (const [key, value] of Object.entries(match)) {
      query = query.eq(key, value);
    }

    return await query.select().single();
  },

  /**
   * Updates multiple records.
   * @param {string} table - The table name.
   * @param {object} data - The data to update.
   * @param {object} match - The condition to match { column: value }.
   * @returns {Promise<{ data: any[], error: object|null }>} The updated data.
   */
  async updateMany(table, data, match) {
    let query = supabase.from(table).update(data);

    for (const [key, value] of Object.entries(match)) {
      if (Array.isArray(value)) {
        query = query.in(key, value);
      } else {
        query = query.eq(key, value);
      }
    }

    return await query.select();
  },

  /**
   * Upserts a record (insert or update).
   * @param {string} table - The table name.
   * @param {object} data - The data to upsert.
   * @returns {Promise<{ data: any, error: object|null }>} The upserted data.
   */
  async upsert(table, data, options = {}) {
    return await supabase.from(table).upsert(data, options).select().single();
  },

  /**
   * Upserts multiple records in a single batch.
   * @param {string} table - The table name.
   * @param {array} data - The array of data to upsert.
   * @param {object} [options] - Options for the upsert (e.g. { onConflict: 'column' }).
   * @returns {Promise<{ data: any[], error: object|null }>} The upserted data.
   */
  async upsertMany(table, data, options = {}) {
    return await supabase.from(table).upsert(data, options).select();
  },

  /**
   * Deletes a record.
   * @param {string} table - The table name.
   * @param {object} match - The condition to match { column: value }.
   * @returns {Promise<{ error: object|null }>} The result.
   */
  async delete(table, match) {
    let query = supabase.from(table).delete();

    for (const [key, value] of Object.entries(match)) {
      if (Array.isArray(value)) {
        query = query.in(key, value);
      } else {
        query = query.eq(key, value);
      }
    }

    return await query;
  },

  /**
   * Invokes a Supabase Edge Function.
   * @param {string} functionName - The name of the function.
   * @param {object} [options] - Options for the invocation (body, headers, etc.).
   * @returns {Promise<{ data: any, error: object|null }>} The result.
   */
  async invoke(functionName, options = {}) {
    return await supabase.functions.invoke(functionName, options);
  },
};
