--
-- ============================================================================
-- BASELINE — Schéma consolidé « appel-benevoles »
-- ----------------------------------------------------------------------------
-- Date de consolidation : 2026-06-06
-- Origine               : pg_dump --schema-only --no-owner --schema=public
--                         de la PROD finale (Supabase pulrflaantftaogvgtnc),
--                         via Session Pooler IPv4. Toutes les migrations
--                         (Phase 3 RLS + durcissements/perf 2026-06-05) sont
--                         intégrées et vérifiées présentes en prod.
-- Phase                 : 8.6 (clôture V1 — source de vérité unique du schéma)
-- Privilèges            : GRANTs PostgREST inclus (dump SANS --no-privileges).
-- Nettoyage             : meta-commandes psql \restrict/\unrestrict retirées ;
--                         CREATE SCHEMA public rendu idempotent.
-- Rejeu                 : exécuté une seule fois par `supabase db reset` sur
--                         une base vierge (auth/storage fournis par Supabase).
-- ============================================================================
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Extensions (réinjectées : pg_dump --schema=public n'émet pas les CREATE
-- EXTENSION). citext = type de benevoles.email ; btree_gist = opérateur '='
-- requis par la contrainte EXCLUDE USING gist sur public.postes.
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext     WITH SCHEMA public;


--
-- Name: cagnotte_forced_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cagnotte_forced_type AS ENUM (
    'journee',
    'periode'
);


--
-- Name: role_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_type AS ENUM (
    'benevole',
    'referent',
    'admin'
);


--
-- Name: tshirt_size; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tshirt_size AS ENUM (
    'SANS',
    'XS',
    'S',
    'M',
    'L',
    'XL',
    'XXL'
);


--
-- Name: auth_has_role(public.role_type); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_has_role(target_role public.role_type) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM benevoles
    WHERE user_id = auth.uid()
      AND role = target_role
  );
$$;


--
-- Name: FUNCTION auth_has_role(target_role public.role_type); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auth_has_role(target_role public.role_type) IS 'Phase 3.3 : test du rôle applicatif courant via auth.uid(). SECURITY DEFINER -> bypass RLS de benevoles, pas de récursion.';


--
-- Name: check_capacity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_capacity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  current_count INTEGER;
  max_capacity INTEGER;
BEGIN
  SELECT nb_max INTO max_capacity FROM postes WHERE id = NEW.poste_id;
  SELECT COUNT(*) INTO current_count FROM inscriptions WHERE poste_id = NEW.poste_id;
  
  IF current_count >= max_capacity THEN
    RAISE EXCEPTION 'Ce créneau est complet (% / %)', current_count, max_capacity;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: check_time_conflict(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_time_conflict() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  conflict_count INTEGER;
  poste_debut TIMESTAMPTZ;
  poste_fin TIMESTAMPTZ;
BEGIN
  SELECT periode_debut, periode_fin INTO poste_debut, poste_fin
  FROM postes WHERE id = NEW.poste_id;
  
  SELECT COUNT(*) INTO conflict_count
  FROM inscriptions i
  JOIN postes p ON i.poste_id = p.id
  WHERE i.benevole_id = NEW.benevole_id
    AND i.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND ((p.periode_debut < poste_fin) AND (p.periode_fin > poste_debut));
  
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Vous êtes déjà inscrit(e) sur un créneau qui chevauche cette période';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: debit_cagnotte_public(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debit_cagnotte_public(target_benevole_id uuid, montant_input numeric, description_input text DEFAULT 'Debit Public'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    benevole_pk      UUID;
    target_user_id   UUID;
    current_balance  DECIMAL(10,2);
    debit_amount     DECIMAL(10,2);
    remainder        DECIMAL(10,2);
    new_balance      DECIMAL(10,2);
BEGIN
    -- 1. Validation
    IF montant_input <= 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Le montant doit être positif.'
        );
    END IF;

    -- 2. Cherche la famille par user_id (pas benevoles.id)
    --    Récupère un benevole_pk valide pour la FK de cagnotte_transactions
    SELECT b.id, b.user_id, get_user_balance(b.user_id)
    INTO benevole_pk, target_user_id, current_balance
    FROM benevoles b
    WHERE b.user_id = target_benevole_id
    ORDER BY b.created_at
    LIMIT 1;

    IF target_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Bénévole introuvable.'
        );
    END IF;

    -- 3. Smart Debit

    -- Cas A : Solde déjà négatif ou nul → Refus
    IF current_balance <= 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Solde insuffisant (Déjà à 0 ou négatif).',
            'debited_amount', 0,
            'new_balance', current_balance,
            'remainder_to_pay', montant_input
        );
    END IF;

    -- Cas B : Solde suffisant
    IF current_balance >= montant_input THEN
        debit_amount := montant_input;
        remainder    := 0;
        new_balance  := current_balance - montant_input;
    ELSE
    -- Cas C : Paiement partiel → vide le compte
        debit_amount := current_balance;
        remainder    := montant_input - current_balance;
        new_balance  := 0;
    END IF;

    -- 4. Insertion transaction (montant négatif)
    --    auteur_id retiré : colonne morte, sera supprimée dans la migration suivante
    IF debit_amount > 0 THEN
        INSERT INTO cagnotte_transactions (user_id, benevole_id, montant, description)
        VALUES (target_user_id, benevole_pk, -debit_amount, description_input || ' (Smart Debit)');
    END IF;

    -- 5. Résultat
    RETURN jsonb_build_object(
        'success', true,
        'debited_amount', debit_amount,
        'new_balance', new_balance,
        'remainder_to_pay', remainder,
        'message', CASE WHEN remainder > 0 THEN 'Paiement Partiel' ELSE 'Paiement Validé' END
    );
END;
$$;


--
-- Name: get_auth_users_without_benevole(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_auth_users_without_benevole() RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, telephone text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT u.id, u.email::text, u.created_at, r.telephone
  FROM auth.users u
  LEFT JOIN public.benevoles b ON b.user_id = u.id
  LEFT JOIN public.orphan_relances r ON r.user_id = u.id
  WHERE b.id IS NULL AND public.is_admin()
  ORDER BY u.created_at DESC;
$$;


--
-- Name: get_benevole_email(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_benevole_email(b_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  res TEXT;
BEGIN
  SELECT email
  INTO res
  FROM benevoles
  WHERE id = b_id;
  RETURN res;
END;
$$;


--
-- Name: get_benevole_full_name(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_benevole_full_name(b_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  res TEXT;
BEGIN
  SELECT prenom || ' ' || nom
  INTO res
  FROM benevoles
  WHERE id = b_id;
  RETURN res;
END;
$$;


--
-- Name: get_benevole_name(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_benevole_name(b_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  res TEXT;
BEGIN
  SELECT prenom || ' ' || SUBSTRING(nom FROM 1 FOR 1) || '.'
  INTO res
  FROM benevoles
  WHERE id = b_id;
  RETURN res;
END;
$$;


--
-- Name: get_benevole_phone(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_benevole_phone(b_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  res TEXT;
BEGIN
  SELECT telephone
  INTO res
  FROM benevoles
  WHERE id = b_id;
  RETURN res;
END;
$$;


--
-- Name: get_family_tshirt_info(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_family_tshirt_info(target_user_id uuid) RETURNS TABLE(benevole_id uuid, prenom text, nom text, taille_tshirt text, has_recupere_tshirt boolean, has_registrations boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.prenom,
        b.nom,
        b.taille_tshirt::text,
        b.has_recupere_tshirt,
        (SELECT COUNT(*) FROM inscriptions i WHERE i.benevole_id = b.id) > 0
    FROM benevoles b
    WHERE b.user_id = target_user_id;
END;
$$;


--
-- Name: get_family_tshirt_info_smart(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_family_tshirt_info_smart(scan_id uuid) RETURNS TABLE(benevole_id uuid, prenom text, nom text, taille_tshirt text, has_recupere_tshirt boolean, has_registrations boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    found_user_id UUID;
BEGIN
    SELECT user_id INTO found_user_id FROM benevoles WHERE id = scan_id;
    IF found_user_id IS NULL THEN
        PERFORM 1 FROM benevoles WHERE user_id = scan_id LIMIT 1;
        IF FOUND THEN
            found_user_id := scan_id;
        END IF;
    END IF;
    IF found_user_id IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT
        b.id,
        b.prenom,
        b.nom,
        b.taille_tshirt::text,
        b.has_recupere_tshirt,
        ((SELECT COUNT(*) FROM inscriptions i WHERE i.benevole_id = b.id) > 0 OR b.role = 'admin')
    FROM benevoles b
    WHERE b.user_id = found_user_id;
END;
$$;


--
-- Name: get_public_benevole_info(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_benevole_info(target_id uuid) RETURNS TABLE(prenom text, nom text, solde numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    target_user_id UUID;
BEGIN
    -- Cherche par user_id (l'UUID auth passé dans les QR codes)
    SELECT b.prenom, b.nom, b.user_id
    INTO prenom, nom, target_user_id
    FROM benevoles b
    WHERE b.user_id = target_id
    ORDER BY b.created_at
    LIMIT 1;

    IF prenom IS NULL THEN
        RETURN; -- Aucun résultat
    END IF;

    -- Calcule le solde famille via la fonction sécurisée existante
    SELECT get_user_balance(target_user_id) INTO solde;

    RETURN NEXT;
END;
$$;


--
-- Name: get_public_inscriptions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_inscriptions() RETURNS TABLE(poste_id uuid, formatted_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.poste_id, 
        (b.prenom || ' ' || SUBSTRING(b.nom, 1, 2) || '.')::TEXT as formatted_name
    FROM inscriptions i
    JOIN benevoles b ON i.benevole_id = b.id;
END;
$$;


--
-- Name: get_public_tshirt_info(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_tshirt_info(target_id uuid) RETURNS TABLE(prenom text, nom text, taille_tshirt text, has_recupere_tshirt boolean, has_registrations boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    count_regs INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_regs FROM inscriptions WHERE benevole_id = target_id;

    SELECT b.prenom, b.nom, b.taille_tshirt::text, b.has_recupere_tshirt
    INTO prenom, nom, taille_tshirt, has_recupere_tshirt
    FROM benevoles b
    WHERE b.id = target_id;

    has_registrations := count_regs > 0;

    IF prenom IS NULL THEN
        RETURN;
    END IF;

    RETURN NEXT;
END;
$$;


--
-- Name: get_user_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_balance(target_user_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    total_credits    DECIMAL(10,2) := 0;
    forced_credits   DECIMAL(10,2) := 0;
    total_debits     DECIMAL(10,2) := 0;
    tarif_journee    DECIMAL(10,2) := 0;
    rec              RECORD;
BEGIN
    SELECT COALESCE((value::text)::decimal, 15.00)
    INTO tarif_journee
    FROM public.config
    WHERE key = 'tarif_cagnotte_journee';

    SELECT COALESCE(SUM(per.montant_credit), 0)
    INTO total_credits
    FROM public.inscriptions i
    JOIN public.benevoles b ON i.benevole_id = b.id
    JOIN public.postes p ON i.poste_id = p.id
    JOIN public.periodes per ON p.periode_id = per.id
    WHERE b.user_id = target_user_id
      AND b.is_cagnotte_forcee = false;

    FOR rec IN
        SELECT id, cagnotte_forcee_type, cagnotte_forcee_jours
        FROM public.benevoles
        WHERE user_id = target_user_id AND is_cagnotte_forcee = true
    LOOP
        IF rec.cagnotte_forcee_type = 'journee' THEN
            forced_credits := forced_credits + (COALESCE(cardinality(rec.cagnotte_forcee_jours), 0) * tarif_journee);
        ELSIF rec.cagnotte_forcee_type = 'periode' THEN
            forced_credits := forced_credits + COALESCE((
                SELECT SUM(per.montant_credit)
                FROM public.benevole_cagnotte_periodes bcp
                JOIN public.periodes per ON bcp.periode_id = per.id
                WHERE bcp.benevole_id = rec.id
            ), 0.00);
        END IF;
    END LOOP;

    SELECT COALESCE(SUM(t.montant), 0)
    INTO total_debits
    FROM public.cagnotte_transactions t
    WHERE t.user_id = target_user_id;

    RETURN total_credits + forced_credits + total_debits;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.auth_has_role('admin'::role_type);
$$;


--
-- Name: FUNCTION is_admin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_admin() IS 'Phase 3.3 : alias conservé pour compatibilité (vue admin_*, RPC). Délègue à auth_has_role.';


--
-- Name: is_own_benevole(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_own_benevole(target_benevole_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM benevoles
    WHERE id = target_benevole_id
      AND user_id = auth.uid()
  );
$$;


--
-- Name: FUNCTION is_own_benevole(target_benevole_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_own_benevole(target_benevole_id uuid) IS 'Phase 3.3 : test d''appartenance d''une ligne par benevole_id (support famille = plusieurs benevoles par auth.uid()).';


--
-- Name: is_referent_for_benevole(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_referent_for_benevole(target_benevole_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM inscriptions i
    JOIN postes p ON i.poste_id = p.id
    JOIN benevoles ref ON p.referent_id = ref.id
    WHERE i.benevole_id = target_benevole_id
      AND ref.user_id = auth.uid()
  );
$$;


--
-- Name: is_referent_for_poste(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_referent_for_poste(target_poste_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM postes p
    JOIN benevoles ref ON p.referent_id = ref.id
    WHERE p.id = target_poste_id
      AND ref.user_id = auth.uid()
  );
$$;


--
-- Name: FUNCTION is_referent_for_poste(target_poste_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_referent_for_poste(target_poste_id uuid) IS 'Phase 3.3 : test "auth.uid() est le référent de ce poste". Cf. matrice §2.2.';


--
-- Name: manage_inscriptions_transaction(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manage_inscriptions_transaction(target_user_id uuid, modifications jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '30s'
    AS $$
DECLARE
    mod RECORD;
    target_benevole_id UUID;
    target_poste_id UUID;
    current_inscriptions INTEGER;
    max_capacity INTEGER;
    poste_record RECORD;
    conflict_count INTEGER;
    caller_id UUID;
    is_admin BOOLEAN;
    benevole_user_id UUID;
    result_log JSONB := '[]'::jsonb;
BEGIN
    caller_id := auth.uid();

    -- SECURITE: Check session active IMMEDIATEMENT (Fail Fast)
    -- Evite les timeouts silencieux quand le token est expiré/révoqué
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Session expirée. Veuillez recharger la page.';
    END IF;
    
    -- 1. Vérification des permissions globales
    -- Est-ce que l'appelant est admin ?
    SELECT EXISTS (
        SELECT 1 FROM benevoles 
        WHERE user_id = caller_id AND role = 'admin'
    ) INTO is_admin;

    -- Pour chaque modification demandée
    FOR mod IN SELECT * FROM jsonb_to_recordset(modifications) AS x(action text, poste_id uuid, benevole_id uuid)
    LOOP
        target_poste_id := mod.poste_id;
        target_benevole_id := mod.benevole_id;

        -- 1.1 Vérification de la propriété du bénévole
        SELECT user_id INTO benevole_user_id FROM benevoles WHERE id = target_benevole_id;
        
        IF benevole_user_id IS NULL THEN
            RAISE EXCEPTION 'Bénévole introuvable : %', target_benevole_id;
        END IF;

        IF (benevole_user_id != caller_id) AND (NOT is_admin) THEN
            RAISE EXCEPTION 'Permission refusée : Vous ne pouvez modifier que vos propres inscriptions.';
        END IF;

        -- 2. Traitement des suppressions (DELETE)
        IF mod.action = 'remove' THEN
            DELETE FROM inscriptions 
            WHERE poste_id = target_poste_id AND benevole_id = target_benevole_id;
            
            result_log := result_log || jsonb_build_object('status', 'removed', 'poste', target_poste_id);
        
        -- 3. Traitement des ajouts (ADD)
        ELSIF mod.action = 'add' THEN
            -- 3.1 Verrouillage du poste pour éviter Race Condition (FOR UPDATE)
            -- On verrouille la ligne du poste pour être sûr que le compteur ne bouge pas pendant notre check
            SELECT * INTO poste_record FROM postes WHERE id = target_poste_id FOR UPDATE;
            
            IF poste_record IS NULL THEN
                RAISE EXCEPTION 'Poste introuvable : %', target_poste_id;
            END IF;

            -- 3.2 Vérification Capacité (Check manuel pour être sûr, même si trigger existe)
            SELECT COUNT(*) INTO current_inscriptions FROM inscriptions WHERE poste_id = target_poste_id;
            
            IF current_inscriptions >= poste_record.nb_max THEN
                RAISE EXCEPTION 'Le poste est complet (% / %)', current_inscriptions, poste_record.nb_max;
            END IF;

            -- 3.3 Vérification Conflit Horaire
            -- On vérifie s'il y a déjà une inscription sur un créneau qui chevauche
            SELECT COUNT(*) INTO conflict_count
            FROM inscriptions i
            JOIN postes p ON i.poste_id = p.id
            WHERE i.benevole_id = target_benevole_id
              AND (
                  (p.periode_debut < poste_record.periode_fin) AND 
                  (p.periode_fin > poste_record.periode_debut)
              );
            
            IF conflict_count > 0 THEN
                RAISE EXCEPTION 'Conflit horaire détecté pour ce bénévole.';
            END IF;

            -- 3.4 Insertion
            INSERT INTO inscriptions (poste_id, benevole_id)
            VALUES (target_poste_id, target_benevole_id)
            ON CONFLICT (poste_id, benevole_id) DO NOTHING; -- Idempotence

            result_log := result_log || jsonb_build_object('status', 'added', 'poste', target_poste_id);
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'log', result_log);

EXCEPTION WHEN OTHERS THEN
    -- En cas d'erreur, tout est annulé (Rollback automatique de la transaction RPC)
    RAISE EXCEPTION 'Opération échouée : %', SQLERRM;
END;
$$;


--
-- Name: prevent_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_role_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Check if the role is actually changing
  -- AND the user is authenticated
  -- AND the user is trying to change their own record (auth.uid() matches the record's user_id)
  IF NEW.role IS DISTINCT FROM OLD.role 
     AND auth.role() = 'authenticated' 
     AND auth.uid() = OLD.user_id THEN
    RAISE EXCEPTION 'You cannot change your own role.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: save_orphelin_phone(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_orphelin_phone(p_auth_user_id uuid, p_telephone text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM benevoles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  INSERT INTO orphan_relances (user_id, telephone)
  VALUES (p_auth_user_id, p_telephone)
  ON CONFLICT (user_id) DO UPDATE SET telephone = EXCLUDED.telephone;
END;
$$;


--
-- Name: update_tshirt_status(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_tshirt_status(target_id uuid, new_taille text, mark_collected boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE benevoles
    SET
        taille_tshirt = COALESCE(new_taille::tshirt_size, taille_tshirt),
        has_recupere_tshirt = mark_collected,
        updated_at = now()
    WHERE id = target_id;

    RETURN TRUE;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: benevole_cagnotte_periodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benevole_cagnotte_periodes (
    benevole_id uuid NOT NULL,
    periode_id uuid NOT NULL
);

ALTER TABLE ONLY public.benevole_cagnotte_periodes FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE benevole_cagnotte_periodes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.benevole_cagnotte_periodes IS 'Table de liaison stockant les périodes cochées pour les bénévoles ayant une cagnotte forcée par période.';


--
-- Name: benevole_repas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benevole_repas (
    benevole_id uuid NOT NULL,
    repas_id uuid NOT NULL,
    is_vegetarien boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.benevole_repas FORCE ROW LEVEL SECURITY;


--
-- Name: benevoles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benevoles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    prenom text NOT NULL,
    nom text NOT NULL,
    telephone text NOT NULL,
    taille_tshirt public.tshirt_size,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role public.role_type DEFAULT 'benevole'::public.role_type NOT NULL,
    user_id uuid NOT NULL,
    has_recupere_tshirt boolean DEFAULT false NOT NULL,
    is_cagnotte_forcee boolean DEFAULT false NOT NULL,
    cagnotte_forcee_type public.cagnotte_forced_type,
    cagnotte_forcee_jours text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT benevoles_cagnotte_consistency CHECK ((((is_cagnotte_forcee = false) AND (cagnotte_forcee_type IS NULL)) OR ((is_cagnotte_forcee = true) AND (cagnotte_forcee_type IS NOT NULL)))),
    CONSTRAINT benevoles_cagnotte_journee_has_days CHECK (((cagnotte_forcee_type IS DISTINCT FROM 'journee'::public.cagnotte_forced_type) OR (cardinality(cagnotte_forcee_jours) > 0))),
    CONSTRAINT benevoles_email_format_chk CHECK (((email)::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)),
    CONSTRAINT benevoles_nom_nonempty CHECK ((length(TRIM(BOTH FROM nom)) > 0)),
    CONSTRAINT benevoles_prenom_nonempty CHECK ((length(TRIM(BOTH FROM prenom)) > 0)),
    CONSTRAINT benevoles_telephone_format_chk CHECK (((telephone = 'INCONNU'::text) OR (telephone ~ '^[+0-9 ().-]{6,}$'::text)))
);

ALTER TABLE ONLY public.benevoles FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN benevoles.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benevoles.role IS 'User role: benevole (default) or admin. Set manually in Supabase dashboard.';


--
-- Name: COLUMN benevoles.is_cagnotte_forcee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benevoles.is_cagnotte_forcee IS 'Indique si la cagnotte du bénévole est forcée (outrepasse les inscriptions).';


--
-- Name: COLUMN benevoles.cagnotte_forcee_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benevoles.cagnotte_forcee_type IS 'Mode de forçage : ''journee'' (montant par jour) ou ''periode'' (périodes sélectionnées).';


--
-- Name: COLUMN benevoles.cagnotte_forcee_jours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benevoles.cagnotte_forcee_jours IS 'Tableau de chaînes représentant les dates des jours cochés pour le forfait journée.';


--
-- Name: inscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poste_id uuid NOT NULL,
    benevole_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.inscriptions FORCE ROW LEVEL SECURITY;


--
-- Name: postes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    periode_debut timestamp with time zone NOT NULL,
    periode_fin timestamp with time zone NOT NULL,
    referent_id uuid,
    nb_min integer DEFAULT 1 NOT NULL,
    nb_max integer DEFAULT 10 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    periode_id uuid NOT NULL,
    type_poste_id uuid NOT NULL,
    CONSTRAINT capacite_valide CHECK (((nb_max >= nb_min) AND (nb_min > 0))),
    CONSTRAINT periode_valide CHECK ((periode_fin > periode_debut)),
    CONSTRAINT postes_nb_max_bound CHECK ((nb_max <= 200))
);

ALTER TABLE ONLY public.postes FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN postes.periode_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.postes.periode_id IS 'Reference to the period this shift belongs to';


--
-- Name: repas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nom text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    question_vege_active boolean DEFAULT true NOT NULL,
    CONSTRAINT repas_nom_nonempty CHECK ((length(TRIM(BOTH FROM nom)) > 0))
);

ALTER TABLE ONLY public.repas FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN repas.question_vege_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.repas.question_vege_active IS 'Si true, le wizard affiche la case « Repas Végétarien » pour ce repas. Si false, la question végé est masquée (is_vegetarien reste false).';


--
-- Name: admin_benevoles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_benevoles WITH (security_invoker='true') AS
 SELECT id,
    user_id,
    email,
    prenom,
    nom,
    telephone,
    taille_tshirt,
    role,
    created_at,
    updated_at,
    is_cagnotte_forcee,
    cagnotte_forcee_type,
    cagnotte_forcee_jours,
    COALESCE(( SELECT jsonb_agg(bcp.periode_id) AS jsonb_agg
           FROM public.benevole_cagnotte_periodes bcp
          WHERE (bcp.benevole_id = b.id)), '[]'::jsonb) AS cagnotte_forcee_periodes_ids,
    ( SELECT count(*) AS count
           FROM public.inscriptions i
          WHERE (i.benevole_id = b.id)) AS nb_inscriptions,
    ( SELECT count(*) AS count
           FROM public.postes p
          WHERE (p.referent_id = b.id)) AS nb_postes_referent,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('repas_id', br.repas_id, 'nom', r.nom, 'is_vegetarien', br.is_vegetarien) ORDER BY r.created_at) AS jsonb_agg
           FROM (public.benevole_repas br
             JOIN public.repas r ON ((br.repas_id = r.id)))
          WHERE (br.benevole_id = b.id)), '[]'::jsonb) AS repas
   FROM public.benevoles b;


--
-- Name: periodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.periodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nom text NOT NULL,
    ordre integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    montant_credit numeric(10,2) DEFAULT 0.00 NOT NULL,
    CONSTRAINT periodes_montant_credit_positive CHECK ((montant_credit >= (0)::numeric)),
    CONSTRAINT periodes_nom_nonempty CHECK ((length(TRIM(BOTH FROM nom)) > 0)),
    CONSTRAINT periodes_ordre_positive CHECK ((ordre > 0))
);

ALTER TABLE ONLY public.periodes FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE periodes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.periodes IS 'Competition periods with display order';


--
-- Name: COLUMN periodes.nom; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.periodes.nom IS 'Period name (e.g., "Qualifications Samedi", "Finales Dimanche")';


--
-- Name: COLUMN periodes.ordre; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.periodes.ordre IS 'Display order (lower numbers appear first)';


--
-- Name: COLUMN periodes.montant_credit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.periodes.montant_credit IS 'Crédit (en €) généré par une inscription validée sur cette période';


--
-- Name: type_postes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.type_postes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date_ref date NOT NULL,
    titre text NOT NULL,
    description text,
    ordre integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT type_postes_ordre_positive CHECK ((ordre >= 0)),
    CONSTRAINT type_postes_titre_nonempty CHECK ((length(TRIM(BOTH FROM titre)) > 0))
);

ALTER TABLE ONLY public.type_postes FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE type_postes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.type_postes IS 'Table hiérarchique pour les types de postes par jour';


--
-- Name: admin_inscriptions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_inscriptions WITH (security_invoker='true') AS
 SELECT i.id,
    i.created_at,
    tp.titre AS poste_titre,
    p.periode_debut,
    p.periode_fin
   FROM ((((public.inscriptions i
     JOIN public.benevoles b ON ((i.benevole_id = b.id)))
     JOIN public.postes p ON ((i.poste_id = p.id)))
     JOIN public.type_postes tp ON ((p.type_poste_id = tp.id)))
     LEFT JOIN public.periodes per ON ((p.periode_id = per.id)))
  ORDER BY p.periode_debut, b.nom;


--
-- Name: admin_periodes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.admin_periodes WITH (security_invoker='true') AS
 SELECT id,
    nom,
    ordre
   FROM public.periodes per
  ORDER BY ordre;


--
-- Name: cagnotte_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cagnotte_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    benevole_id uuid NOT NULL,
    montant numeric(10,2) NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cagnotte_transactions_description_nonempty CHECK ((length(TRIM(BOTH FROM description)) > 0)),
    CONSTRAINT cagnotte_transactions_montant_bound CHECK ((abs(montant) <= (100)::numeric)),
    CONSTRAINT cagnotte_transactions_montant_nonzero CHECK ((montant <> (0)::numeric))
);

ALTER TABLE ONLY public.cagnotte_transactions FORCE ROW LEVEL SECURITY;


--
-- Name: config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT config_key_nonempty CHECK ((length(TRIM(BOTH FROM key)) > 0))
);

ALTER TABLE ONLY public.config FORCE ROW LEVEL SECURITY;


--
-- Name: jours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jours (
    date_ref date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jours FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jours IS 'Table de référence pour les jours de compétition créés';


--
-- Name: COLUMN jours.date_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jours.date_ref IS 'Date unique identifiant le jour (ex: 2026-05-16)';


--
-- Name: orphan_relances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orphan_relances (
    user_id uuid NOT NULL,
    telephone text
);

ALTER TABLE ONLY public.orphan_relances FORCE ROW LEVEL SECURITY;


--
-- Name: programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programmes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date_ref date NOT NULL,
    heure time without time zone NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.programmes FORCE ROW LEVEL SECURITY;


--
-- Name: public_planning; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_planning AS
 SELECT p.id AS poste_id,
    tp.titre,
    p.periode_debut,
    p.periode_fin,
    p.nb_max,
    p.nb_min,
    per.nom AS periode,
    per.ordre AS periode_ordre,
    tp.description,
    p.referent_id,
    tp.ordre AS type_poste_ordre,
        CASE
            WHEN (p.referent_id IS NOT NULL) THEN public.get_benevole_full_name(p.referent_id)
            ELSE NULL::text
        END AS referent_nom,
        CASE
            WHEN (p.referent_id IS NOT NULL) THEN public.get_benevole_email(p.referent_id)
            ELSE NULL::text
        END AS referent_email,
        CASE
            WHEN (p.referent_id IS NOT NULL) THEN public.get_benevole_phone(p.referent_id)
            ELSE NULL::text
        END AS referent_telephone,
    count(i.id) AS nb_inscrits_actuels,
    array_agg(public.get_benevole_name(i.benevole_id) ORDER BY i.created_at) FILTER (WHERE (i.benevole_id IS NOT NULL)) AS liste_benevoles
   FROM (((public.postes p
     JOIN public.type_postes tp ON ((p.type_poste_id = tp.id)))
     LEFT JOIN public.periodes per ON ((p.periode_id = per.id)))
     LEFT JOIN public.inscriptions i ON ((p.id = i.poste_id)))
  GROUP BY p.id, tp.titre, p.periode_debut, p.periode_fin, p.nb_max, p.nb_min, per.nom, per.ordre, tp.description, p.referent_id, tp.ordre;


--
-- Name: benevole_cagnotte_periodes benevole_cagnotte_periodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevole_cagnotte_periodes
    ADD CONSTRAINT benevole_cagnotte_periodes_pkey PRIMARY KEY (benevole_id, periode_id);


--
-- Name: benevole_repas benevole_repas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevole_repas
    ADD CONSTRAINT benevole_repas_pkey PRIMARY KEY (benevole_id, repas_id);


--
-- Name: benevoles benevoles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevoles
    ADD CONSTRAINT benevoles_pkey PRIMARY KEY (id);


--
-- Name: benevoles benevoles_user_prenom_nom_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevoles
    ADD CONSTRAINT benevoles_user_prenom_nom_uniq UNIQUE (user_id, prenom, nom);


--
-- Name: cagnotte_transactions cagnotte_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cagnotte_transactions
    ADD CONSTRAINT cagnotte_transactions_pkey PRIMARY KEY (id);


--
-- Name: config config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config
    ADD CONSTRAINT config_pkey PRIMARY KEY (key);


--
-- Name: inscriptions inscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscriptions
    ADD CONSTRAINT inscriptions_pkey PRIMARY KEY (id);


--
-- Name: inscriptions inscriptions_poste_id_benevole_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscriptions
    ADD CONSTRAINT inscriptions_poste_id_benevole_id_key UNIQUE (poste_id, benevole_id);


--
-- Name: jours jours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jours
    ADD CONSTRAINT jours_pkey PRIMARY KEY (date_ref);


--
-- Name: orphan_relances orphan_relances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orphan_relances
    ADD CONSTRAINT orphan_relances_pkey PRIMARY KEY (user_id);


--
-- Name: periodes periodes_nom_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodes
    ADD CONSTRAINT periodes_nom_key UNIQUE (nom);


--
-- Name: periodes periodes_ordre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodes
    ADD CONSTRAINT periodes_ordre_key UNIQUE (ordre);


--
-- Name: periodes periodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodes
    ADD CONSTRAINT periodes_pkey PRIMARY KEY (id);


--
-- Name: postes postes_no_overlap_same_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postes
    ADD CONSTRAINT postes_no_overlap_same_type EXCLUDE USING gist (type_poste_id WITH =, tstzrange(periode_debut, periode_fin) WITH &&);


--
-- Name: postes postes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postes
    ADD CONSTRAINT postes_pkey PRIMARY KEY (id);


--
-- Name: programmes programmes_date_heure_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programmes
    ADD CONSTRAINT programmes_date_heure_uniq UNIQUE (date_ref, heure);


--
-- Name: programmes programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programmes
    ADD CONSTRAINT programmes_pkey PRIMARY KEY (id);


--
-- Name: repas repas_nom_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repas
    ADD CONSTRAINT repas_nom_uniq UNIQUE (nom);


--
-- Name: repas repas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repas
    ADD CONSTRAINT repas_pkey PRIMARY KEY (id);


--
-- Name: type_postes type_postes_new_date_ref_titre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.type_postes
    ADD CONSTRAINT type_postes_new_date_ref_titre_key UNIQUE (date_ref, titre);


--
-- Name: type_postes type_postes_new_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.type_postes
    ADD CONSTRAINT type_postes_new_pkey PRIMARY KEY (id);


--
-- Name: idx_benevole_cagnotte_periodes_periode_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benevole_cagnotte_periodes_periode_id ON public.benevole_cagnotte_periodes USING btree (periode_id);


--
-- Name: idx_benevole_repas_repas_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benevole_repas_repas_id ON public.benevole_repas USING btree (repas_id);


--
-- Name: idx_benevoles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benevoles_email ON public.benevoles USING btree (email);


--
-- Name: idx_benevoles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benevoles_role ON public.benevoles USING btree (role);


--
-- Name: idx_benevoles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benevoles_user_id ON public.benevoles USING btree (user_id);


--
-- Name: idx_cagnotte_benevole; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cagnotte_benevole ON public.cagnotte_transactions USING btree (benevole_id);


--
-- Name: idx_cagnotte_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cagnotte_user ON public.cagnotte_transactions USING btree (user_id);


--
-- Name: idx_inscriptions_benevole; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inscriptions_benevole ON public.inscriptions USING btree (benevole_id);


--
-- Name: idx_inscriptions_poste; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inscriptions_poste ON public.inscriptions USING btree (poste_id);


--
-- Name: idx_postes_periode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postes_periode ON public.postes USING btree (periode_debut, periode_fin);


--
-- Name: idx_postes_periode_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postes_periode_id ON public.postes USING btree (periode_id);


--
-- Name: idx_postes_referent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postes_referent_id ON public.postes USING btree (referent_id);


--
-- Name: idx_postes_type_poste_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postes_type_poste_id ON public.postes USING btree (type_poste_id);


--
-- Name: idx_programmes_date_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_programmes_date_ref ON public.programmes USING btree (date_ref);


--
-- Name: inscriptions trg_check_capacity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_capacity BEFORE INSERT ON public.inscriptions FOR EACH ROW EXECUTE FUNCTION public.check_capacity();


--
-- Name: inscriptions trg_check_time_conflict; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_time_conflict BEFORE INSERT OR UPDATE ON public.inscriptions FOR EACH ROW EXECUTE FUNCTION public.check_time_conflict();


--
-- Name: benevoles trg_prevent_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_role_change BEFORE UPDATE ON public.benevoles FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();


--
-- Name: benevole_cagnotte_periodes benevole_cagnotte_periodes_benevole_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevole_cagnotte_periodes
    ADD CONSTRAINT benevole_cagnotte_periodes_benevole_id_fkey FOREIGN KEY (benevole_id) REFERENCES public.benevoles(id) ON DELETE CASCADE;


--
-- Name: benevole_cagnotte_periodes benevole_cagnotte_periodes_periode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevole_cagnotte_periodes
    ADD CONSTRAINT benevole_cagnotte_periodes_periode_id_fkey FOREIGN KEY (periode_id) REFERENCES public.periodes(id) ON DELETE CASCADE;


--
-- Name: benevole_repas benevole_repas_benevole_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevole_repas
    ADD CONSTRAINT benevole_repas_benevole_id_fkey FOREIGN KEY (benevole_id) REFERENCES public.benevoles(id) ON DELETE CASCADE;


--
-- Name: benevole_repas benevole_repas_repas_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevole_repas
    ADD CONSTRAINT benevole_repas_repas_id_fkey FOREIGN KEY (repas_id) REFERENCES public.repas(id) ON DELETE CASCADE;


--
-- Name: benevoles benevoles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benevoles
    ADD CONSTRAINT benevoles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: cagnotte_transactions cagnotte_transactions_benevole_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cagnotte_transactions
    ADD CONSTRAINT cagnotte_transactions_benevole_id_fkey FOREIGN KEY (benevole_id) REFERENCES public.benevoles(id) ON DELETE CASCADE;


--
-- Name: cagnotte_transactions cagnotte_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cagnotte_transactions
    ADD CONSTRAINT cagnotte_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: inscriptions inscriptions_benevole_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscriptions
    ADD CONSTRAINT inscriptions_benevole_id_fkey FOREIGN KEY (benevole_id) REFERENCES public.benevoles(id) ON DELETE CASCADE;


--
-- Name: inscriptions inscriptions_poste_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscriptions
    ADD CONSTRAINT inscriptions_poste_id_fkey FOREIGN KEY (poste_id) REFERENCES public.postes(id) ON DELETE CASCADE;


--
-- Name: orphan_relances orphan_relances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orphan_relances
    ADD CONSTRAINT orphan_relances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: postes postes_new_type_poste_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postes
    ADD CONSTRAINT postes_new_type_poste_id_fkey FOREIGN KEY (type_poste_id) REFERENCES public.type_postes(id) ON DELETE CASCADE;


--
-- Name: postes postes_periode_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postes
    ADD CONSTRAINT postes_periode_id_fkey FOREIGN KEY (periode_id) REFERENCES public.periodes(id) ON DELETE SET NULL;


--
-- Name: postes postes_referent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postes
    ADD CONSTRAINT postes_referent_id_fkey FOREIGN KEY (referent_id) REFERENCES public.benevoles(id) ON DELETE SET NULL;


--
-- Name: type_postes type_postes_new_date_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.type_postes
    ADD CONSTRAINT type_postes_new_date_ref_fkey FOREIGN KEY (date_ref) REFERENCES public.jours(date_ref) ON DELETE CASCADE;


--
-- Name: benevole_cagnotte_periodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.benevole_cagnotte_periodes ENABLE ROW LEVEL SECURITY;

--
-- Name: benevole_cagnotte_periodes benevole_cagnotte_periodes_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_cagnotte_periodes_admin_all ON public.benevole_cagnotte_periodes TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: benevole_cagnotte_periodes benevole_cagnotte_periodes_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_cagnotte_periodes_self_select ON public.benevole_cagnotte_periodes FOR SELECT TO authenticated USING (public.is_own_benevole(benevole_id));


--
-- Name: benevole_repas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.benevole_repas ENABLE ROW LEVEL SECURITY;

--
-- Name: benevole_repas benevole_repas_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_repas_admin_delete ON public.benevole_repas FOR DELETE TO authenticated USING (public.auth_has_role('admin'::public.role_type));


--
-- Name: benevole_repas benevole_repas_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_repas_admin_insert ON public.benevole_repas FOR INSERT TO authenticated WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: benevole_repas benevole_repas_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_repas_admin_select ON public.benevole_repas FOR SELECT TO authenticated USING (public.auth_has_role('admin'::public.role_type));


--
-- Name: benevole_repas benevole_repas_self_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_repas_self_delete ON public.benevole_repas FOR DELETE TO authenticated USING (public.is_own_benevole(benevole_id));


--
-- Name: benevole_repas benevole_repas_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_repas_self_insert ON public.benevole_repas FOR INSERT TO authenticated WITH CHECK (public.is_own_benevole(benevole_id));


--
-- Name: benevole_repas benevole_repas_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevole_repas_self_select ON public.benevole_repas FOR SELECT TO authenticated USING (public.is_own_benevole(benevole_id));


--
-- Name: benevoles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.benevoles ENABLE ROW LEVEL SECURITY;

--
-- Name: benevoles benevoles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevoles_admin_all ON public.benevoles TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: benevoles benevoles_referent_select_managed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevoles_referent_select_managed ON public.benevoles FOR SELECT TO authenticated USING (public.is_referent_for_benevole(id));


--
-- Name: benevoles benevoles_self_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benevoles_self_all ON public.benevoles TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: cagnotte_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cagnotte_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: cagnotte_transactions cagnotte_transactions_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cagnotte_transactions_admin_insert ON public.cagnotte_transactions FOR INSERT TO authenticated WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: cagnotte_transactions cagnotte_transactions_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cagnotte_transactions_admin_select ON public.cagnotte_transactions FOR SELECT TO authenticated USING (public.auth_has_role('admin'::public.role_type));


--
-- Name: cagnotte_transactions cagnotte_transactions_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cagnotte_transactions_self_select ON public.cagnotte_transactions FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;

--
-- Name: config config_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_admin_insert ON public.config FOR INSERT TO authenticated WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: config config_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_admin_update ON public.config FOR UPDATE TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: config config_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_public_select ON public.config FOR SELECT TO authenticated, anon USING (true);


--
-- Name: inscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: inscriptions inscriptions_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_admin_delete ON public.inscriptions FOR DELETE TO authenticated USING (public.auth_has_role('admin'::public.role_type));


--
-- Name: inscriptions inscriptions_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_admin_insert ON public.inscriptions FOR INSERT TO authenticated WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: inscriptions inscriptions_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_admin_select ON public.inscriptions FOR SELECT TO authenticated USING (public.auth_has_role('admin'::public.role_type));


--
-- Name: inscriptions inscriptions_referent_select_managed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_referent_select_managed ON public.inscriptions FOR SELECT TO authenticated USING (public.is_referent_for_poste(poste_id));


--
-- Name: inscriptions inscriptions_self_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_self_delete ON public.inscriptions FOR DELETE TO authenticated USING (public.is_own_benevole(benevole_id));


--
-- Name: inscriptions inscriptions_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_self_insert ON public.inscriptions FOR INSERT TO authenticated WITH CHECK (public.is_own_benevole(benevole_id));


--
-- Name: inscriptions inscriptions_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscriptions_self_select ON public.inscriptions FOR SELECT TO authenticated USING (public.is_own_benevole(benevole_id));


--
-- Name: jours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jours ENABLE ROW LEVEL SECURITY;

--
-- Name: jours jours_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jours_admin_all ON public.jours TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: jours jours_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jours_public_select ON public.jours FOR SELECT TO authenticated, anon USING (true);


--
-- Name: orphan_relances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orphan_relances ENABLE ROW LEVEL SECURITY;

--
-- Name: orphan_relances orphan_relances_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orphan_relances_admin_all ON public.orphan_relances TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: periodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.periodes ENABLE ROW LEVEL SECURITY;

--
-- Name: periodes periodes_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY periodes_admin_all ON public.periodes TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: periodes periodes_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY periodes_public_select ON public.periodes FOR SELECT TO authenticated, anon USING (true);


--
-- Name: postes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.postes ENABLE ROW LEVEL SECURITY;

--
-- Name: postes postes_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY postes_admin_all ON public.postes TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: postes postes_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY postes_public_select ON public.postes FOR SELECT TO authenticated, anon USING (true);


--
-- Name: programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;

--
-- Name: programmes programmes_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY programmes_admin_all ON public.programmes TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: programmes programmes_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY programmes_public_select ON public.programmes FOR SELECT TO authenticated, anon USING (true);


--
-- Name: repas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repas ENABLE ROW LEVEL SECURITY;

--
-- Name: repas repas_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY repas_admin_all ON public.repas TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: repas repas_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY repas_public_select ON public.repas FOR SELECT TO authenticated, anon USING (true);


--
-- Name: type_postes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.type_postes ENABLE ROW LEVEL SECURITY;

--
-- Name: type_postes type_postes_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY type_postes_admin_all ON public.type_postes TO authenticated USING (public.auth_has_role('admin'::public.role_type)) WITH CHECK (public.auth_has_role('admin'::public.role_type));


--
-- Name: type_postes type_postes_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY type_postes_public_select ON public.type_postes FOR SELECT TO authenticated, anon USING (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION auth_has_role(target_role public.role_type); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.auth_has_role(target_role public.role_type) TO anon;
GRANT ALL ON FUNCTION public.auth_has_role(target_role public.role_type) TO authenticated;
GRANT ALL ON FUNCTION public.auth_has_role(target_role public.role_type) TO service_role;


--
-- Name: FUNCTION check_capacity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_capacity() TO anon;
GRANT ALL ON FUNCTION public.check_capacity() TO authenticated;
GRANT ALL ON FUNCTION public.check_capacity() TO service_role;


--
-- Name: FUNCTION check_time_conflict(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_time_conflict() TO anon;
GRANT ALL ON FUNCTION public.check_time_conflict() TO authenticated;
GRANT ALL ON FUNCTION public.check_time_conflict() TO service_role;


--
-- Name: FUNCTION debit_cagnotte_public(target_benevole_id uuid, montant_input numeric, description_input text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debit_cagnotte_public(target_benevole_id uuid, montant_input numeric, description_input text) TO anon;
GRANT ALL ON FUNCTION public.debit_cagnotte_public(target_benevole_id uuid, montant_input numeric, description_input text) TO authenticated;
GRANT ALL ON FUNCTION public.debit_cagnotte_public(target_benevole_id uuid, montant_input numeric, description_input text) TO service_role;


--
-- Name: FUNCTION get_auth_users_without_benevole(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_auth_users_without_benevole() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_auth_users_without_benevole() TO authenticated;
GRANT ALL ON FUNCTION public.get_auth_users_without_benevole() TO service_role;


--
-- Name: FUNCTION get_benevole_email(b_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_benevole_email(b_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_benevole_email(b_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_benevole_email(b_id uuid) TO authenticated;


--
-- Name: FUNCTION get_benevole_full_name(b_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_benevole_full_name(b_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_benevole_full_name(b_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_benevole_full_name(b_id uuid) TO authenticated;


--
-- Name: FUNCTION get_benevole_name(b_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_benevole_name(b_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_benevole_name(b_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_benevole_name(b_id uuid) TO authenticated;


--
-- Name: FUNCTION get_benevole_phone(b_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_benevole_phone(b_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_benevole_phone(b_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_benevole_phone(b_id uuid) TO authenticated;


--
-- Name: FUNCTION get_family_tshirt_info(target_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_family_tshirt_info(target_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_family_tshirt_info(target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_family_tshirt_info(target_user_id uuid) TO service_role;


--
-- Name: FUNCTION get_family_tshirt_info_smart(scan_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_family_tshirt_info_smart(scan_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_family_tshirt_info_smart(scan_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_family_tshirt_info_smart(scan_id uuid) TO service_role;


--
-- Name: FUNCTION get_public_benevole_info(target_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_public_benevole_info(target_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_public_benevole_info(target_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_public_benevole_info(target_id uuid) TO service_role;


--
-- Name: FUNCTION get_public_inscriptions(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_public_inscriptions() TO anon;
GRANT ALL ON FUNCTION public.get_public_inscriptions() TO authenticated;
GRANT ALL ON FUNCTION public.get_public_inscriptions() TO service_role;


--
-- Name: FUNCTION get_public_tshirt_info(target_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_public_tshirt_info(target_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_public_tshirt_info(target_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_public_tshirt_info(target_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_balance(target_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_user_balance(target_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_balance(target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_balance(target_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_own_benevole(target_benevole_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_own_benevole(target_benevole_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_own_benevole(target_benevole_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_own_benevole(target_benevole_id uuid) TO service_role;


--
-- Name: FUNCTION is_referent_for_benevole(target_benevole_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_referent_for_benevole(target_benevole_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_referent_for_benevole(target_benevole_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_referent_for_benevole(target_benevole_id uuid) TO service_role;


--
-- Name: FUNCTION is_referent_for_poste(target_poste_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_referent_for_poste(target_poste_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_referent_for_poste(target_poste_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_referent_for_poste(target_poste_id uuid) TO service_role;


--
-- Name: FUNCTION manage_inscriptions_transaction(target_user_id uuid, modifications jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.manage_inscriptions_transaction(target_user_id uuid, modifications jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.manage_inscriptions_transaction(target_user_id uuid, modifications jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.manage_inscriptions_transaction(target_user_id uuid, modifications jsonb) TO service_role;
GRANT ALL ON FUNCTION public.manage_inscriptions_transaction(target_user_id uuid, modifications jsonb) TO anon;


--
-- Name: FUNCTION prevent_role_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_role_change() TO anon;
GRANT ALL ON FUNCTION public.prevent_role_change() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_role_change() TO service_role;


--
-- Name: FUNCTION save_orphelin_phone(p_auth_user_id uuid, p_telephone text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.save_orphelin_phone(p_auth_user_id uuid, p_telephone text) TO anon;
GRANT ALL ON FUNCTION public.save_orphelin_phone(p_auth_user_id uuid, p_telephone text) TO authenticated;
GRANT ALL ON FUNCTION public.save_orphelin_phone(p_auth_user_id uuid, p_telephone text) TO service_role;


--
-- Name: FUNCTION update_tshirt_status(target_id uuid, new_taille text, mark_collected boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_tshirt_status(target_id uuid, new_taille text, mark_collected boolean) TO anon;
GRANT ALL ON FUNCTION public.update_tshirt_status(target_id uuid, new_taille text, mark_collected boolean) TO authenticated;
GRANT ALL ON FUNCTION public.update_tshirt_status(target_id uuid, new_taille text, mark_collected boolean) TO service_role;


--
-- Name: TABLE benevole_cagnotte_periodes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.benevole_cagnotte_periodes TO anon;
GRANT ALL ON TABLE public.benevole_cagnotte_periodes TO authenticated;
GRANT ALL ON TABLE public.benevole_cagnotte_periodes TO service_role;


--
-- Name: TABLE benevole_repas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.benevole_repas TO anon;
GRANT ALL ON TABLE public.benevole_repas TO authenticated;
GRANT ALL ON TABLE public.benevole_repas TO service_role;


--
-- Name: TABLE benevoles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.benevoles TO anon;
GRANT ALL ON TABLE public.benevoles TO authenticated;
GRANT ALL ON TABLE public.benevoles TO service_role;


--
-- Name: TABLE inscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inscriptions TO anon;
GRANT ALL ON TABLE public.inscriptions TO authenticated;
GRANT ALL ON TABLE public.inscriptions TO service_role;


--
-- Name: TABLE postes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.postes TO anon;
GRANT ALL ON TABLE public.postes TO authenticated;
GRANT ALL ON TABLE public.postes TO service_role;


--
-- Name: TABLE repas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.repas TO anon;
GRANT ALL ON TABLE public.repas TO authenticated;
GRANT ALL ON TABLE public.repas TO service_role;


--
-- Name: TABLE admin_benevoles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_benevoles TO anon;
GRANT ALL ON TABLE public.admin_benevoles TO authenticated;
GRANT ALL ON TABLE public.admin_benevoles TO service_role;


--
-- Name: TABLE periodes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.periodes TO anon;
GRANT ALL ON TABLE public.periodes TO authenticated;
GRANT ALL ON TABLE public.periodes TO service_role;


--
-- Name: TABLE type_postes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.type_postes TO anon;
GRANT ALL ON TABLE public.type_postes TO authenticated;
GRANT ALL ON TABLE public.type_postes TO service_role;


--
-- Name: TABLE admin_inscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_inscriptions TO anon;
GRANT ALL ON TABLE public.admin_inscriptions TO authenticated;
GRANT ALL ON TABLE public.admin_inscriptions TO service_role;


--
-- Name: TABLE admin_periodes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_periodes TO anon;
GRANT ALL ON TABLE public.admin_periodes TO authenticated;
GRANT ALL ON TABLE public.admin_periodes TO service_role;


--
-- Name: TABLE cagnotte_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cagnotte_transactions TO anon;
GRANT ALL ON TABLE public.cagnotte_transactions TO authenticated;
GRANT ALL ON TABLE public.cagnotte_transactions TO service_role;


--
-- Name: TABLE config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config TO anon;
GRANT ALL ON TABLE public.config TO authenticated;
GRANT ALL ON TABLE public.config TO service_role;


--
-- Name: TABLE jours; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.jours TO anon;
GRANT ALL ON TABLE public.jours TO authenticated;
GRANT ALL ON TABLE public.jours TO service_role;


--
-- Name: TABLE orphan_relances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orphan_relances TO anon;
GRANT ALL ON TABLE public.orphan_relances TO authenticated;
GRANT ALL ON TABLE public.orphan_relances TO service_role;


--
-- Name: TABLE programmes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.programmes TO anon;
GRANT ALL ON TABLE public.programmes TO authenticated;
GRANT ALL ON TABLE public.programmes TO service_role;


--
-- Name: TABLE public_planning; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_planning TO authenticated;
GRANT ALL ON TABLE public.public_planning TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Durcissement anon (réinjecté : pg_dump n'émet pas de REVOKE, et au reset
-- Supabase re-grante par défaut à `anon` les objets créés par `postgres`).
-- Sans ces REVOKE, le baseline serait PLUS permissif que la prod : `anon`
-- pourrait lire public_planning (coordonnées référent) et les helpers de
-- coordonnées bénévole. État cible prod = authenticated + service_role only.
--

REVOKE ALL ON TABLE public.public_planning FROM anon;
REVOKE ALL ON FUNCTION public.get_auth_users_without_benevole() FROM anon;
REVOKE ALL ON FUNCTION public.get_benevole_email(b_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_benevole_full_name(b_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_benevole_name(b_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_benevole_phone(b_id uuid) FROM anon;


--
-- PostgreSQL database dump complete
--




-- ============================================================================
-- SEED — Clés de configuration par défaut (table public.config)
-- ----------------------------------------------------------------------------
-- Valeurs initiales lues par le frontend (src/js/modules/store.js). L'admin les
-- modifie ensuite depuis Admin → Configuration. Idempotent (ON CONFLICT DO NOTHING).
--   - event_title / event_address : identité de l'évènement (vides → repli
--     « Appel aux Bénévoles » côté front jusqu'à saisie par l'admin).
--   - cagnotte_active : affichage de la cagnotte côté bénévole (off par défaut).
--   - tshirt_question_active : question taille T-shirt dans le wizard (on).
--   - tarif_cagnotte_journee : montant crédité par journée de cagnotte forcée.
-- ============================================================================

INSERT INTO public.config (key, value) VALUES
  ('event_title', '""'::jsonb),
  ('event_address', '""'::jsonb),
  ('cagnotte_active', 'false'::jsonb),
  ('tshirt_question_active', 'true'::jsonb),
  ('tarif_cagnotte_journee', '15.00'::jsonb)
ON CONFLICT (key) DO NOTHING;
