/// <reference types="vite/client" />
// Environment Constants
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validation
if (import.meta.env.DEV && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.error("Configuration Supabase manquante dans les variables d'environnement.");
}
