# Base de données — appel-benevoles

Schéma PostgreSQL 17 du projet, hébergé sur Supabase managé. Toutes les tables sont dans le schéma `public`, toutes ont **RLS activée ET forcée** (`FORCE ROW LEVEL SECURITY`).

> **Source de vérité** : `supabase/migrations/00000000000000_init.sql` (schéma complet consolidé). Ce document est la version humainement lisible de ce fichier. En cas de divergence, c'est le SQL qui fait foi.

---

## 1. Vue d'ensemble

Le schéma s'articule autour de quatre noyaux fonctionnels :

| Noyau                    | Tables centrales                                                                 |
| ------------------------ | -------------------------------------------------------------------------------- |
| **Identité utilisateur** | `benevoles` (n:1 avec `auth.users` — support famille), `orphan_relances`         |
| **Planning bénévolat**   | `postes`, `type_postes`, `periodes`, `jours`, `inscriptions`                     |
| **Cagnotte buvette**     | `cagnotte_transactions`, `periodes.montant_credit`, `benevole_cagnotte_periodes` |
| **Évenement / extras**   | `programmes`, `repas`, `benevole_repas`, `config`                                |

Quatre **vues** complètent l'accès :

- `public_planning` (réservée à `authenticated`, anonymisée — utilisée par la page d'accueil et `besoins.html`)
- `admin_benevoles`, `admin_inscriptions`, `admin_periodes` (agrégats pour l'admin)

> **Support famille** : la contrainte `benevoles_user_prenom_nom_uniq UNIQUE (user_id, prenom, nom)` permet à un même compte `auth.users` d'avoir plusieurs profils `benevoles` (parent + enfants). La sémantique "ligne m'appartient" s'évalue donc via `benevole_id IN (SELECT id FROM benevoles WHERE user_id = auth.uid())` — encapsulée par le helper `is_own_benevole()`.

---

## 2. Diagramme ERD

```mermaid
erDiagram
    AUTH_USERS ||--o{ BENEVOLES : "n:1 (user_id, multi-profils)"
    BENEVOLES ||--o{ INSCRIPTIONS : "s'inscrit"
    POSTES ||--o{ INSCRIPTIONS : "reçoit"
    POSTES }o--|| TYPE_POSTES : "est de type"
    POSTES }o--|| PERIODES : "appartient à"
    POSTES }o--o| BENEVOLES : "a référent"
    TYPE_POSTES }o--|| JOURS : "se déroule le"
    AUTH_USERS ||--o{ CAGNOTTE_TRANSACTIONS : "bénéficie (user_id)"
    BENEVOLES ||--o{ CAGNOTTE_TRANSACTIONS : "bénéficie (benevole_id)"
    BENEVOLES ||--o{ BENEVOLE_REPAS : "choisit"
    REPAS ||--o{ BENEVOLE_REPAS : "est choisi"
    BENEVOLES ||--o{ BENEVOLE_CAGNOTTE_PERIODES : "ciblé par"
    PERIODES ||--o{ BENEVOLE_CAGNOTTE_PERIODES : "ciblé par"
    AUTH_USERS ||--o| ORPHAN_RELANCES : "téléphone orphelin"

    BENEVOLES {
        uuid id PK
        uuid user_id FK "auth.users"
        citext email "format email"
        text prenom "non vide"
        text nom "non vide"
        text telephone "format strict OU 'INCONNU'"
        tshirt_size taille_tshirt "SANS|XS..XXL"
        role_type role "benevole|referent|admin"
        bool has_recupere_tshirt
        bool is_cagnotte_forcee
        cagnotte_forced_type cagnotte_forcee_type "journee|periode"
        text_array cagnotte_forcee_jours
    }
    POSTES {
        uuid id PK
        timestamptz periode_debut
        timestamptz periode_fin
        int nb_min "≥ 1"
        int nb_max "≥ nb_min, ≤ 200"
        uuid type_poste_id FK
        uuid periode_id FK
        uuid referent_id FK "nullable"
    }
    INSCRIPTIONS {
        uuid id PK
        uuid poste_id FK
        uuid benevole_id FK
        timestamptz created_at
    }
    TYPE_POSTES {
        uuid id PK
        date date_ref FK
        text titre "UNIQUE (date_ref, titre)"
        text description
        int ordre
    }
    PERIODES {
        uuid id PK
        text nom UK
        int ordre UK "> 0"
        numeric montant_credit "≥ 0"
    }
    JOURS {
        date date_ref PK
    }
    CAGNOTTE_TRANSACTIONS {
        uuid id PK
        uuid user_id "auth.users (NOT NULL)"
        uuid benevole_id FK "NOT NULL"
        numeric montant "signed, ≠ 0, |x| ≤ 100"
        text description "non vide"
        timestamptz created_at
    }
    REPAS {
        uuid id PK
        text nom "non vide"
        bool question_vege_active "défaut true"
    }
    BENEVOLE_REPAS {
        uuid benevole_id PK_FK
        uuid repas_id PK_FK
        bool is_vegetarien
    }
    BENEVOLE_CAGNOTTE_PERIODES {
        uuid benevole_id PK_FK
        uuid periode_id PK_FK
    }
    PROGRAMMES {
        uuid id PK
        date date_ref
        time heure
        text description "UNIQUE (date_ref, heure)"
    }
    CONFIG {
        text key PK
        jsonb value
        timestamptz updated_at
    }
    ORPHAN_RELANCES {
        uuid user_id PK_FK
        text telephone
    }
```

> Légende cardinalités Mermaid : `||` = exactement un, `o|` = zéro ou un, `o{` = zéro ou plusieurs, `|{` = un ou plusieurs.

---

## 3. Tables

### `benevoles` — profils utilisateurs (n:1 avec `auth.users`)

Profil enrichi d'un utilisateur Supabase Auth. **Un même `user_id` peut posséder plusieurs lignes** (support famille : un compte parent peut gérer plusieurs profils bénévoles distingués par `(prenom, nom)`).

| Colonne                    | Type                          | NotNull | Description                                                                                 |
| -------------------------- | ----------------------------- | :-----: | ------------------------------------------------------------------------------------------- |
| `id`                       | uuid (PK)                     |   ✅    | `gen_random_uuid()`                                                                         |
| `user_id`                  | uuid (FK)                     |   ✅    | → `auth.users.id` (un user peut avoir plusieurs profils)                                    |
| `email`                    | `citext`                      |   ✅    | Email case-insensitive, regex `^[^@\s]+@[^@\s]+\.[^@\s]+$`                                  |
| `prenom`, `nom`            | text                          |   ✅    | Trim non vide                                                                               |
| `telephone`                | text                          |   ✅    | Regex `^[+0-9 ().-]{6,}$` ou littéral `'INCONNU'`                                           |
| `taille_tshirt`            | `tshirt_size` (enum)          |         | `SANS, XS, S, M, L, XL, XXL`                                                                |
| `role`                     | `role_type` (enum)            |   ✅    | `benevole` (défaut), `referent`, `admin`                                                    |
| `has_recupere_tshirt`      | bool                          |   ✅    | Marqué `true` au scan distribution (défaut `false`)                                         |
| `is_cagnotte_forcee`       | bool                          |   ✅    | Active l'auto-crédit (défaut `false`)                                                       |
| `cagnotte_forcee_type`     | `cagnotte_forced_type` (enum) |         | `journee` ou `periode`. Cohérent avec `is_cagnotte_forcee` (CHECK)                          |
| `cagnotte_forcee_jours`    | text[]                        |   ✅    | Dates retenues si type = `journee`. Cardinalité > 0 obligatoire si type = `journee` (CHECK) |
| `created_at`, `updated_at` | timestamptz                   |   ✅    | Défaut `now()`                                                                              |

**Contraintes notables** :

- `UNIQUE (user_id, prenom, nom)` — empêche les doublons exacts, autorise les profils famille.
- `CHECK benevoles_cagnotte_consistency` — `(is_cagnotte_forcee=false ↔ cagnotte_forcee_type IS NULL)`.
- `CHECK benevoles_cagnotte_journee_has_days` — mode `journee` ⇒ `cardinality(cagnotte_forcee_jours) > 0`.

### `postes` — créneaux de bénévolat

Un poste = une mission sur une plage horaire avec une fourchette d'effectif.

| Colonne         | Type        | NotNull | Description                          |
| --------------- | ----------- | :-----: | ------------------------------------ |
| `id`            | uuid (PK)   |   ✅    |                                      |
| `periode_debut` | timestamptz |   ✅    | Début du créneau                     |
| `periode_fin`   | timestamptz |   ✅    | Fin du créneau                       |
| `nb_min`        | int         |   ✅    | Effectif minimum (défaut 1, > 0)     |
| `nb_max`        | int         |   ✅    | Effectif maximum (défaut 10, ≤ 200)  |
| `type_poste_id` | uuid (FK)   |   ✅    | → `type_postes.id`                   |
| `periode_id`    | uuid (FK)   |   ✅    | → `periodes.id`                      |
| `referent_id`   | uuid (FK)   |         | → `benevoles.id` (référent du poste) |

**CHECKs** : `capacite_valide` (`nb_max ≥ nb_min AND nb_min > 0`), `periode_valide` (`periode_fin > periode_debut`), `postes_nb_max_bound` (`nb_max ≤ 200`).

### `inscriptions` — jonction `benevoles` ↔ `postes`

Inscription d'un bénévole à un créneau. L'unicité `(poste_id, benevole_id)` interdit les doublons. Les **triggers** `trg_check_capacity` (BEFORE INSERT) et `trg_check_time_conflict` (BEFORE INSERT/UPDATE) appliquent capacité et conflits horaires côté serveur (cf. §6).

| Colonne       | Type        | NotNull | Description      |
| ------------- | ----------- | :-----: | ---------------- |
| `id`          | uuid (PK)   |   ✅    |                  |
| `poste_id`    | uuid (FK)   |   ✅    | → `postes.id`    |
| `benevole_id` | uuid (FK)   |   ✅    | → `benevoles.id` |
| `created_at`  | timestamptz |   ✅    | Défaut `now()`   |

### `type_postes` — catalogue des types de mission

Décrit un type de poste (titre, description) rattaché à un jour de référence.

| Colonne       | Type      | NotNull | Description                    |
| ------------- | --------- | :-----: | ------------------------------ |
| `id`          | uuid (PK) |   ✅    |                                |
| `date_ref`    | date (FK) |   ✅    | → `jours.date_ref`             |
| `titre`       | text      |   ✅    | UNIQUE par `(date_ref, titre)` |
| `description` | text      |         |                                |
| `ordre`       | int       |   ✅    | ≥ 0, défaut 0                  |

### `periodes` — blocs temporels (Qualif Samedi, Finales Dimanche, …)

Regroupement métier des postes. Sert aussi à l'auto-crédit cagnotte.

| Colonne          | Type          | NotNull | Description                           |
| ---------------- | ------------- | :-----: | ------------------------------------- |
| `id`             | uuid (PK)     |   ✅    |                                       |
| `nom`            | text          |   ✅    | UNIQUE — non vide                     |
| `ordre`          | int           |   ✅    | UNIQUE — > 0, ordre d'affichage       |
| `montant_credit` | numeric(10,2) |   ✅    | Crédit cagnotte par inscription (≥ 0) |

### `jours` — jours de référence de l'événement

Table pivot rattachant les `type_postes` à une date.

| Colonne    | Type      | NotNull | Description |
| ---------- | --------- | :-----: | ----------- |
| `date_ref` | date (PK) |   ✅    | Date unique |

### `cagnotte_transactions` — mouvements de la cagnotte

Crédits (positifs) et débits (négatifs). Solde d'un utilisateur = `SUM(montant)` filtré sur `user_id`.

| Colonne       | Type          | NotNull | Description                                         |
| ------------- | ------------- | :-----: | --------------------------------------------------- | ------- | ----------------------------- |
| `id`          | uuid (PK)     |   ✅    |                                                     |
| `user_id`     | uuid          |   ✅    | `auth.users.id` — bénéficiaire (clé du solde)       |
| `benevole_id` | uuid (FK)     |   ✅    | → `benevoles.id` — profil concret (support famille) |
| `montant`     | numeric(10,2) |   ✅    | Signé. `                                            | montant | ≤ 100`et`montant ≠ 0` (CHECK) |
| `description` | text          |   ✅    | Trim non vide                                       |
| `created_at`  | timestamptz   |   ✅    | Défaut `now()`                                      |

> **Pas de colonne `auteur_id`** : l'auteur n'est pas tracké en base ; les INSERT côté admin passent par la policy `cagnotte_transactions_admin_insert` (donc `auth.uid()` au moment de l'INSERT identifie l'auteur via logs/audit).

### `benevole_repas` — choix de repas (n:m bénévole × repas)

| Colonne         | Type         | NotNull | Description              |
| --------------- | ------------ | :-----: | ------------------------ |
| `benevole_id`   | uuid (PK,FK) |   ✅    | → `benevoles.id`         |
| `repas_id`      | uuid (PK,FK) |   ✅    | → `repas.id`             |
| `is_vegetarien` | bool         |   ✅    | Préférence pour ce repas |

### `repas` — catalogue des repas

| Colonne                | Type      | NotNull | Description                                                                                                                                                               |
| ---------------------- | --------- | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | uuid (PK) |   ✅    |                                                                                                                                                                           |
| `nom`                  | text      |   ✅    | Trim non vide                                                                                                                                                             |
| `question_vege_active` | bool      |   ✅    | Défaut `true`. Si `false`, le wizard masque la case « Repas Végétarien » pour ce repas (`is_vegetarien` forcé à false). Édité dans Admin → Configuration → Options Repas. |

### `benevole_cagnotte_periodes` — périodes cagnotte forcée par bénévole

Sélection des périodes pour lesquelles un bénévole reçoit automatiquement le crédit (mode `cagnotte_forcee_type = 'periode'`).

| Colonne       | Type         | NotNull | Description      |
| ------------- | ------------ | :-----: | ---------------- |
| `benevole_id` | uuid (PK,FK) |   ✅    | → `benevoles.id` |
| `periode_id`  | uuid (PK,FK) |   ✅    | → `periodes.id`  |

### `programmes` — programme de l'événement (affichage public)

| Colonne       | Type      | NotNull | Description                        |
| ------------- | --------- | :-----: | ---------------------------------- |
| `id`          | uuid (PK) |   ✅    |                                    |
| `date_ref`    | date      |   ✅    | Jour                               |
| `heure`       | time      |   ✅    | Heure — UNIQUE `(date_ref, heure)` |
| `description` | text      |   ✅    | Libellé de l'événement             |

### `config` — feature flags et paramètres clé/valeur

| Colonne      | Type        | NotNull | Description       |
| ------------ | ----------- | :-----: | ----------------- |
| `key`        | text (PK)   |   ✅    | Trim non vide     |
| `value`      | jsonb       |   ✅    | Valeur arbitraire |
| `updated_at` | timestamptz |   ✅    | Défaut `now()`    |

**Clés connues** :

- `cagnotte_active` (bool) — toggle de l'affichage cagnotte côté UI.
- `tshirt_question_active` (bool) — toggle de la question taille T-shirt dans le wizard.
- `tarif_cagnotte_journee` (number) — montant crédité par journée de cagnotte forcée (défaut 15.00).
- `event_title` (string) — titre de l'évènement (identité générique). Alimente le header public et le `<title>` des pages. Repli front « Appel aux Bénévoles » si vide. Semée par le fichier init.
- `event_address` (string) — adresse / lieu de l'évènement, stockée en config.

### `orphan_relances` — comptes Auth sans profil bénévole

Recense les comptes Supabase Auth qui n'ont pas créé leur profil bénévole. Stocke le téléphone saisi par l'admin (via la RPC `save_orphelin_phone`) pour pouvoir les contacter (WhatsApp / copie du mail depuis `admin-connexions.html`).

| Colonne     | Type         | NotNull | Description                  |
| ----------- | ------------ | :-----: | ---------------------------- |
| `user_id`   | uuid (PK,FK) |   ✅    | → `auth.users.id`            |
| `telephone` | text         |         | Téléphone saisi manuellement |

---

## 4. Vues

### `public_planning` (réservée à `authenticated`, anonymisée)

Source unique du planning affiché aux bénévoles connectés (`index.html`, `besoins.html`). **Les noms des bénévoles inscrits sont anonymisés** via `get_benevole_name()` (prénom + initiale, ex : "Marie D."). Inclut le décompte d'inscrits par poste et les coordonnées du référent, uniquement quand l'utilisateur courant a le droit de les voir.

> **Sécurité** : l'accès `anon` à cette vue est **révoqué**. Les colonnes `referent_nom/email/telephone` ne sont pas anonymisées ; elles passent par `get_benevole_full_name/email/phone`, qui retourne `NULL` si l'appelant n'est pas autorisé. La vue reste volontairement `SECURITY DEFINER` (bypass RLS requis pour les compteurs globaux côté non-admin) — le lint Supabase `security_definer_view` sur cette vue est un faux positif assumé. Ne pas re-`GRANT ... TO anon` sans retirer d'abord les colonnes référent.

Colonnes : `poste_id, titre, periode_debut, periode_fin, nb_min, nb_max, periode, periode_ordre, description, referent_id, type_poste_ordre, referent_nom, referent_email, referent_telephone, nb_inscrits_actuels, liste_benevoles (array)`.

### `admin_benevoles`

Vue agrégée par bénévole : nombre d'inscriptions, nombre de postes dont il est référent, choix de repas (JSON), périodes cagnotte forcée (JSON `cagnotte_forcee_periodes_ids`).

### `admin_inscriptions`

Vue à plat (inscription × poste × période), triée par `periode_debut` puis `benevole.nom`.

### `admin_periodes`

Vue résumée des périodes (id, nom, ordre), triée par `ordre`.

---

## 5. Enums

```sql
role_type            : benevole | referent | admin
tshirt_size          : SANS | XS | S | M | L | XL | XXL
cagnotte_forced_type : journee | periode
```

> **Historique** : les rôles `juge`, `admin-juge`, `officiel` ont été retirés. Seuls 3 rôles applicatifs subsistent en base (`benevole`, `referent`, `admin`).

---

## 6. Triggers et fonctions PL/pgSQL

### Triggers

| Trigger                   | Table          | Événement       | Timing | Logique                                                                                                                       |
| ------------------------- | -------------- | --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `trg_check_capacity`      | `inscriptions` | INSERT          | BEFORE | Refuse l'inscription si `nb_max` du poste est déjà atteint                                                                    |
| `trg_check_time_conflict` | `inscriptions` | INSERT + UPDATE | BEFORE | Refuse l'inscription si le bénévole est déjà inscrit sur un créneau qui chevauche celui-ci                                    |
| `trg_prevent_role_change` | `benevoles`    | INSERT + UPDATE | BEFORE | Empêche un utilisateur authentifié non-admin de s'auto-promouvoir ou de modifier des champs protégés depuis le navigateur/API |

### Fonctions trigger (logique d'arrière-plan)

- `check_capacity()` — appelée par `trg_check_capacity`.
- `check_time_conflict()` — appelée par `trg_check_time_conflict`.
- `prevent_role_change()` — appelée par `trg_prevent_role_change`. Elle bloque les utilisateurs authentifiés non-admin qui tentent de créer un profil avec un rôle autre que `benevole`, de changer un rôle existant, ou de modifier des champs protégés (`has_recupere_tshirt`, cagnotte forcée).

### Helpers d'autorisation RLS

Toutes en `STABLE SECURITY DEFINER SET search_path = public`. Elles sont la **brique unique** utilisée par les policies pour éviter la récursion (une policy ne lit jamais directement une table à RLS — elle passe par un helper DEFINER).

| Fonction                            | Retour | Logique                                                                                      |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `auth_has_role(target role_type)`   | bool   | `true` si `auth.uid()` correspond à un bénévole de rôle donné                                |
| `is_admin()`                        | bool   | Alias de `auth_has_role('admin')` (compat avec vues `admin_*` et anciens RPC)                |
| `is_own_benevole(benevole_id uuid)` | bool   | `true` si la ligne `benevole_id` ciblée appartient à l'utilisateur courant (support famille) |
| `is_referent_for_poste(poste_id)`   | bool   | `true` si `auth.uid()` est le référent de ce poste                                           |
| `is_referent_for_benevole(uuid)`    | bool   | `true` si `auth.uid()` est référent d'un poste auquel le bénévole cible est inscrit          |
| `can_read_benevole_contact(uuid)`   | bool   | `true` si l'appelant peut lire nom complet/email/téléphone : admin, soi-même, référent, ou bénévole concerné par ce référent |

> La fonction `check_referent_access(uuid)` (helper historique) a été **supprimée** ; elle n'existe plus dans le schéma.

### Helpers de présentation (utilisés dans `public_planning` et RPC publiques)

| Fonction                             | Retour | Usage                                                              |
| ------------------------------------ | ------ | ------------------------------------------------------------------ |
| `get_benevole_name(uuid)`            | text   | Prénom + initiale du nom (`Marie D.`) — **anonymisation publique** |
| `get_benevole_full_name(uuid)`       | text   | Prénom + nom complet, filtré par `can_read_benevole_contact()`     |
| `get_benevole_email(uuid)`           | text   | Email, filtré par `can_read_benevole_contact()`                    |
| `get_benevole_phone(uuid)`           | text   | Téléphone, filtré par `can_read_benevole_contact()`                |
| `get_public_benevole_info(uuid)`     | table  | (prenom, nom, solde) pour la borne buvette                         |
| `get_public_tshirt_info(uuid)`       | table  | Statut t-shirt (taille, retrait) — scan public                     |
| `get_family_tshirt_info(uuid)`       | table  | Statut t-shirt pour tous les profils liés à un `user_id`           |
| `get_family_tshirt_info_smart(uuid)` | table  | Variante optimisée pour le scanner                                 |
| `get_public_inscriptions()`          | table  | Inscriptions publiques anonymisées (`poste_id, formatted_name`)    |

### Opérations métier (RPC)

| Fonction                                                               | Sécurité | Logique                                                                                                         |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `manage_inscriptions_transaction(target_user_id, modifications jsonb)` | DEFINER  | Applique un batch d'inscriptions/désinscriptions en transaction (rollback global si un trigger refuse)          |
| `debit_cagnotte_public(target_benevole_id, montant, description)`      | DEFINER  | Débit cagnotte depuis la borne buvette (vérifie solde, INSERT signé négatif dans `cagnotte_transactions`)       |
| `update_tshirt_status(target_id, new_taille, mark_collected)`          | DEFINER  | Met à jour `taille_tshirt` (enum) et `has_recupere_tshirt` après scan                                           |
| `get_user_balance(target_user_id)`                                     | DEFINER  | `SUM(montant)` des transactions de l'utilisateur                                                                |
| `save_orphelin_phone(p_auth_user_id, p_telephone)`                     | DEFINER  | Enregistre le téléphone d'un utilisateur Auth sans profil bénévole (admin uniquement, vérifié dans la fonction) |
| `get_auth_users_without_benevole()`                                    | DEFINER  | Liste des comptes Auth sans ligne `benevoles` (admin uniquement)                                                |

> **Pourquoi `SECURITY DEFINER`** : les RPC publiques et helpers doivent lire ou écrire `benevoles`/`cagnotte_transactions` (tables RLS-forcées). Sans DEFINER, l'utilisateur ne pourrait même pas vérifier son propre rôle (deadlock RLS). Toutes ces fonctions fixent `SET search_path = public` pour éviter le hijack de schéma (cf. `audit/16_rls.md` historique).

> **Durcissement EXECUTE** suite à l'audit du linter Supabase (lints `0028`/`0029`) :
>
> - `get_benevole_email/phone/full_name` : `EXECUTE` **révoqué de `PUBLIC`/`anon`** et filtrage interne via `can_read_benevole_contact()` (empêche l'énumération de PII par UUID via `/rpc`). `authenticated` est conservé pour les vues et les écrans connectés.
> - `get_auth_users_without_benevole()` : garde `is_admin()` **interne** ajoutée (exposait emails/téléphones des comptes Auth orphelins) + `EXECUTE` révoqué d'`anon`.
> - **Non modifiés (faux positifs / par design)** : helpers RLS (`is_admin`, `auth_has_role`, `is_own_benevole`, `is_referent_*`) — exécutables car référencés dans les policies ; RPC borne/QR (`debit_cagnotte_public`, `get_public_benevole_info`, `get_public_inscriptions`, `get_public_tshirt_info`, `get_family_tshirt_info_smart`, `update_tshirt_status`).
>
> **Risque assumé — pages QR publiques** : `debit.html` et `scanner-tshirt.html` restent volontairement sans authentification. Avec l'UUID porté par le QR, on peut utiliser la borne cagnotte ou lire/modifier le statut T-shirt. **Ne pas verrouiller derrière un login sans revoir le workflow des stands.** Les transactions cagnotte restent écrites en lignes immuables (pas d'UPDATE/DELETE).

> **Note `extension_in_public`** (lint `0014`) : `citext` et `btree_gist` sont dans le schéma `public`. Non déplacées : `benevoles.email` est typée `public.citext` (déplacer le type casserait la colonne). Avertissement assumé.

---

## 7. Matrice RLS — qui peut faire quoi ?

> **Note** : toutes les tables ont RLS **activée ET forcée** (`relrowsecurity = true`, `relforcerowsecurity = true`). Les rôles propriétaires (postgres) sont eux-mêmes soumis aux policies — le bypass ne reste possible qu'au travers des fonctions `SECURITY DEFINER`. Le `service_role` (utilisé par les Edge Functions) conserve `BYPASSRLS`.

> **Note** : le fichier init applique `GRANT ALL` sur toutes les tables à `anon`, `authenticated`, `service_role` (convention Supabase). Sans ces GRANTs, RLS n'est même pas évalué — c'est pire qu'une policy permissive.

**Symboles** : ✅ = autorisé, ⛔ = refusé (pas de policy → DENY implicite sous FORCE RLS), 👁️ = SELECT public (anon + authenticated).

| Table                        | Public anon |            Bénévole (soi)            | Référent (postes liés) |          Admin          | Notes                                                                                                          |
| ---------------------------- | :---------: | :----------------------------------: | :--------------------: | :---------------------: | -------------------------------------------------------------------------------------------------------------- |
| `benevoles`                  |     ⛔      | ✅ SELECT/INSERT/UPDATE/DELETE (soi) |  ✅ SELECT (managed)   |         ✅ ALL          | rôle et champs protégés bloqués par trigger pour les non-admins                                               |
| `inscriptions`               |     ⛔      |        ✅ SELECT (siennes)           |  ✅ SELECT (managed)   | ✅ SELECT/INSERT/DELETE | Écriture bénévole via RPC `manage_inscriptions_transaction`; **UPDATE = DENY pour tous**                     |
| `postes`                     |     👁️      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `type_postes`                |     👁️      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `periodes`                   |     👁️      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `programmes`                 |     👁️      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `jours`                      |     👁️      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `repas`                      |     👁️      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `benevole_repas`             |     ⛔      |   ✅ SELECT/INSERT/DELETE (siens)    |           —            | ✅ SELECT/INSERT/DELETE | **UPDATE = DENY pour tous**                                                                                    |
| `benevole_cagnotte_periodes` |     ⛔      |          ✅ SELECT (siens)           |           —            |         ✅ ALL          |                                                                                                                |
| `cagnotte_transactions`      |     ⛔      |  ✅ SELECT (siennes via `user_id`)   |           —            |    ✅ SELECT/INSERT     | **UPDATE/DELETE = DENY pour tous (admin compris)**. INSERT côté bénévole passe par RPC `debit_cagnotte_public` |
| `orphan_relances`            |     ⛔      |                  —                   |           —            |         ✅ ALL          |                                                                                                                |
| `config`                     |     👁️      |                  —                   |           —            |    ✅ INSERT/UPDATE     | **DELETE = DENY pour tous**                                                                                    |

### Détail des policies les plus sensibles

#### `benevoles`

- **`benevoles_self_all`** (FOR ALL) — un utilisateur authentifié manipule ses propres lignes (`auth.uid() = user_id`). Couvre SELECT/INSERT/UPDATE/DELETE.
- **`benevoles_referent_select_managed`** (FOR SELECT) — un référent voit les bénévoles inscrits sur ses postes (`is_referent_for_benevole(id)`).
- **`benevoles_admin_all`** (FOR ALL) — accès complet pour `auth_has_role('admin')`.
- **Garde-fou** : le trigger `trg_prevent_role_change` bloque toute tentative d'auto-promotion et protège les champs t-shirt/cagnotte sensibles pour les non-admins.

#### `inscriptions`

- **Pas de lecture publique anonyme.** Les compteurs/listes anonymisés sont servis par la vue `public_planning` (SECURITY DEFINER, désormais réservée à `authenticated` — cf. § Vues) et, pour l'accès réellement anonyme, par la RPC `get_public_inscriptions()` (SECURITY DEFINER).
- **Bénévole** : `inscriptions_self_select` autorise la lecture de ses propres inscriptions. Les ajouts/suppressions passent par la RPC `manage_inscriptions_transaction`, pour éviter les écritures directes concurrentes depuis le navigateur.
- **Référent** : `inscriptions_referent_select_managed` autorise SELECT sur les inscriptions des postes dont il est référent (`is_referent_for_poste(poste_id)`).
- **Admin** : `inscriptions_admin_select/insert/delete` filtrent par `auth_has_role('admin')`.
- **UPDATE = DENY** : aucune policy UPDATE — une inscription ne se modifie pas, elle se supprime et se recrée.

#### `cagnotte_transactions`

- **Lecture** : un utilisateur voit ses propres transactions (`auth.uid() = user_id`) ; l'admin voit tout.
- **Écriture** : uniquement les admins peuvent INSERT directement. **La borne buvette passe obligatoirement par la RPC `debit_cagnotte_public()`** (SECURITY DEFINER) qui contrôle le solde avant insert signé négatif.
- **UPDATE/DELETE = DENY pour tous, y compris l'admin** : l'historique cagnotte est immuable. Toute correction se fait par une nouvelle transaction compensatoire.

#### `config`

- **Lecture** : `config_public_select` retourne `true` pour anon et authenticated (feature flags lisibles publiquement).
- **Écriture** : `config_admin_insert/update` exigent `auth_has_role('admin')`.
- **DELETE = DENY pour tous** : les clés de config ne se suppriment pas en cours d'événement.

---

## 8. Index & performance

Toutes les colonnes de filtre/jointure chaudes sont déjà indexées (FK, `poste_id`,
`benevole_id`, `user_id`, `role`, …). C'est pourquoi l'`index_advisor` Supabase ne
suggère **aucun** index sur les requêtes du dashboard _Query Performance_.

### Index signalés « inutilisés » (lint `0005_unused_index`) — **conservés volontairement**

Le linter Supabase signale 3 index en `INFO` comme « never used » (`idx_scan = 0`).
Décision (2026-06-05) : **on ne les supprime pas**.

| Index                                       | Raison de le garder                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idx_benevole_cagnotte_periodes_periode_id` | **Couvre la FK** `periode_id → periodes(id) ON DELETE CASCADE`. PostgreSQL n'indexe pas automatiquement les FK ; sans cet index, supprimer une période force un seq-scan + verrou sur la table enfant. |
| `idx_benevole_repas_repas_id`               | **Couvre la FK** `repas_id → repas(id) ON DELETE CASCADE` (même raison).                                                                                                                               |
| `idx_benevoles_email`                       | Recherche admin par email / réconciliation des comptes orphelins. `idx_scan = 0` non fiable (`pg_stat_database.stats_reset = NULL`) ; coût de stockage négligeable à cette échelle.                    |

> Le `idx_scan = 0` reflète l'absence de **SELECT** s'en servant, pas l'inutilité : les 2
> index de FK servent aux opérations `DELETE`/`UPDATE` sur la table parente, pas aux lectures.
> Les supprimer serait un anti-pattern (régression sur les cascades). Faux positifs `INFO` assumés.

---

## 9. Liens utiles

- [`supabase/migrations/00000000000000_init.sql`](supabase/migrations/00000000000000_init.sql) — schéma complet consolidé (source de vérité unique) : extensions, types, tables, vues, fonctions, triggers, helpers et policies RLS (`FORCE`), GRANTs PostgREST.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — vue d'ensemble et flux applicatifs
- [`CLAUDE.md`](CLAUDE.md) — avertissements critiques sur les triggers et RLS
