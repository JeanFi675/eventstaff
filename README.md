# EventStaff

Système **générique** et open-source de gestion de bénévoles pour **tout évènement** : inscriptions des bénévoles, attribution des postes/créneaux, gestion des rôles (bénévole, référent, admin), cagnotte, repas, envoi des plannings par email, suivi t-shirts via QR code.

Le titre et l'adresse de l'évènement se configurent **depuis l'espace admin** (« Identité de l'évènement ») — aucun nom d'évènement n'est écrit en dur dans le code. Tu déploies l'appli, tu crées ton projet Supabase, et tu construis ton évènement entièrement depuis l'interface.

> Frontend statique (Vite + Alpine.js + Tailwind) + backend Supabase (PostgreSQL, Auth, RLS, Edge Functions). Hébergeable gratuitement sur GitHub Pages, Netlify, Vercel, etc.

> 🚀 **Pas développeur ?** Suis le **[Guide d'installation complet (A à Z)](GUIDE-INSTALLATION.md)** — de la création des comptes GitHub/Supabase jusqu'à ta première connexion en admin, sans écrire une ligne de code.

---

## Stack

| Couche   | Outils                                                       |
| -------- | ------------------------------------------------------------ |
| Frontend | Vite 7, Alpine.js 3, Tailwind CSS 3, `vite-plugin-html` (EJS) |
| Backend  | Supabase (PostgreSQL, Auth, RLS, Edge Functions Deno)        |
| Node     | 20+                                                          |

---

## Prérequis

| Outil                                                | Utilité                                           |
| ---------------------------------------------------- | ------------------------------------------------- |
| [Node.js](https://nodejs.org/) 20+                   | Build du frontend (`npm`)                         |
| Un compte [Supabase](https://supabase.com/) (gratuit) | Base de données, Auth, Edge Functions             |
| [Supabase CLI](https://supabase.com/docs/guides/cli) *(optionnel)* | Déploiement des Edge Functions                    |
| Git                                                  | Clonage du dépôt                                  |

---

## Mise en route (from scratch)

### 1. Récupérer le code

```bash
git clone https://github.com/<votre-compte>/eventstaff.git
cd eventstaff
npm install
```

### 2. Créer le projet Supabase

1. Sur [supabase.com](https://supabase.com/), crée un **nouveau projet** (note le mot de passe DB).
2. Ouvre **SQL Editor** dans le tableau de bord Supabase.
3. Copie-colle **l'intégralité** de [`supabase/migrations/00000000000000_init.sql`](supabase/migrations/00000000000000_init.sql) et exécute-le.

   > Ce **fichier unique** crée toute la structure : tables, types, vues, fonctions, triggers, politiques de sécurité (RLS) et les clés de configuration par défaut. C'est la seule étape SQL nécessaire.

   *(Alternative CLI : `supabase link` puis `supabase db push`.)*

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env.local
```

Renseigne **au minimum** dans `.env.local` (valeurs visibles dans Supabase → Settings → API) :

```dotenv
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

> Les variables `VITE_*` sont publiques (injectées dans le bundle) — c'est normal et sûr, la sécurité repose sur les politiques RLS de Supabase. Ne place **jamais** la `service_role` key dans une variable `VITE_*`. Voir `.env.example` pour le détail des trois périmètres (frontend / scripts / Edge Functions).

### 4. Lancer en local

```bash
npm run dev        # http://localhost:5173
```

### 5. Créer le premier compte admin

Connecte-toi une fois via le code à 6 chiffres (ce qui crée ton compte Auth), puis exécute dans le **SQL Editor** de Supabase :

```sql
insert into public.benevoles (email, prenom, nom, telephone, role, user_id)
select u.email, 'Prénom', 'Nom', 'INCONNU', 'admin', u.id
from auth.users u
where u.email = 'ton.email@exemple.com';
```

> 📌 Procédure détaillée (config Auth, modèle d'email avec `{{ .Token }}`, SMTP, secrets) : voir le **[Guide d'installation complet](GUIDE-INSTALLATION.md)**.

### 6. Construire ton évènement

Connecte-toi à `/admin.html` avec le compte admin, puis dans **Configuration** :

- renseigne le **titre** et l'**adresse** de l'évènement ;
- active/désactive la **cagnotte** et la **question taille T-shirt** ;
- crée tes **périodes**, **jours**, **postes** et **bénévoles**.

---

## Build & déploiement

```bash
npm run build      # Génère dist/ optimisé (minification, code-split)
npm run preview    # Sert le build sur http://localhost:4173
```

`vite.config.js` conserve `base: "./"` (chemins relatifs) pour un déploiement statique simple — déposer le contenu de `dist/` sur GitHub Pages, Netlify, Vercel, etc.

> Le `connect-src` de la CSP est dérivé automatiquement de `VITE_SUPABASE_URL` au moment du build : pense à builder **après** avoir renseigné cette variable.

---

## Edge Functions (optionnel — emails & création de comptes)

Trois fonctions Deno dans [`supabase/functions/`](supabase/functions/) :

| Fonction          | Rôle                                                          |
| ----------------- | ------------------------------------------------------------- |
| `send-planning`   | Envoie son planning à un bénévole par email                   |
| `send-rappel-all` | Rappel groupé à tous les bénévoles                            |
| `create-benevole` | Création d'un compte bénévole par un admin (Service Role Key) |

Déploiement (nécessite la CLI Supabase) :

```bash
supabase functions deploy send-planning
supabase secrets set SMTP_HOST=... SMTP_PORT=... SMTP_USER=... SMTP_PASS=...
```

---

## Documentation complémentaire

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — vue d'ensemble, choix techniques, structure des dossiers
- [`DATABASE.md`](DATABASE.md) — schéma, politiques RLS, triggers, fonctions PL/pgSQL

---

## Licence

À définir.
