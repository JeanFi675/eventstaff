# Architecture — EventStaff

Document de référence décrivant l'architecture **réelle** du projet : ce qui existe aujourd'hui. Les limitations connues sont signalées en section 4.

> **Portée** : frontend (Vite + Alpine.js) et intégration backend (Supabase managé). Le schéma de base de données détaillé (tables, RLS, triggers) est documenté dans `DATABASE.md`.

---

## 1. Vue d'ensemble

Application web **statique multi-pages** buildée avec **Vite** et déployée sur **GitHub Pages** via GitHub Actions. Aucun serveur applicatif intermédiaire — le navigateur appelle directement Supabase pour l'authentification, les données et les fonctions serveur.

Toute la logique backend critique (autorisations, contraintes métier) vit dans **Supabase** :

- **PostgreSQL** + **RLS** (Row Level Security) pour les règles d'accès ligne par ligne.
- **Triggers PL/pgSQL** pour les invariants métier (capacités de poste, conflits horaires).
- **Edge Functions Deno** pour les opérations nécessitant un secret serveur (envoi d'emails, création de compte admin avec service role).

### Diagramme d'architecture

```
┌────────────────────────────────────────────────────────────────┐
│                   BUILD (CI — GitHub Actions)                  │
│                                                                │
│  Sources HTML/JS/CSS  ─► Vite 7 + vite-plugin-html (EJS)       │
│  Tailwind CSS         ─► dist/  (minification esbuild,         │
│                                  hash, sourcemaps désactivées, │
│                                  manualChunks :                │
│                                  vendor-supabase /             │
│                                  vendor-alpine /               │
│                                  vendor-qrcode / vendor)       │
│  Secrets VITE_*       ─► injectés dans le bundle               │
└──────────────────────────────┬─────────────────────────────────┘
                               │ upload-pages-artifact
┌──────────────────────────────▼─────────────────────────────────┐
│            GitHub Pages (CDN statique — base "./")             │
│                                                                │
│  6 pages multi-entrypoints :                                   │
│   index.html  admin.html  debit.html                           │
│   scanner-tshirt.html  admin-connexions.html  besoins.html     │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼─────────────────────────────────┐
│                          NAVIGATEUR                            │
│                                                                │
│  Alpine.js 3 (réactivité)  +  Tailwind CSS 3                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Entrypoint /page.js → Alpine.data + Alpine.store        │   │
│  │ Composants Alpine (src/js/components/)                  │   │
│  │ Stores Alpine (src/js/stores/)                          │   │
│  │ Services (src/js/services/) ── seul accès Supabase ──┐  │   │
│  └──────────────────────────────────────────────────────┼──┘   │
│                @supabase/supabase-js (client unique)    │      │
└─────────────────────────────────────────────────────────┼──────┘
                                                          │
                                                  HTTPS   │
              (REST PostgREST / RPC / Realtime WS / Auth) │
                                                          ▼
┌────────────────────────────────────────────────────────────────┐
│                            SUPABASE                            │
│                                                                │
│  ┌──────────┐  ┌───────────────────┐  ┌────────────────────┐   │
│  │   Auth   │  │   PostgreSQL 17   │  │   Edge Functions   │   │
│  │ OTP 6 ch.│  │  + RLS policies   │  │      (Deno 2)      │   │
│  │  (email) │  │  + Triggers       │  │  • send-planning   │   │
│  └──────────┘  │  + Fonctions RPC  │  │  • create-benevole │   │
│                │  + Vues publiques │  │                    │   │
│                └───────────────────┘  └────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Flux typiques

| Action utilisateur              | Chemin technique                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Connexion (OTP email)           | Navigateur → Supabase Auth (OTP 6 chiffres)                                                                            |
| Affichage planning              | Navigateur → vues PostgreSQL anonymisées (REST PostgREST, filtré par RLS)                                              |
| Inscription à un poste          | Navigateur → RPC `manage_inscriptions_transaction` → écriture DB en transaction + triggers capacité/conflit            |
| Envoi du planning par email     | Navigateur → Edge Function `send-planning` → SMTP                                                                      |
| Création de compte par un admin | Navigateur (admin) → Edge Function `create-benevole` (vérifie rôle, utilise service_role pour créer dans `auth.users`) |
| Débit cagnotte (buvette)        | Navigateur → RPC PostgreSQL → INSERT `cagnotte_transactions`                                                           |

---

## 2. Choix techniques et justifications

### Pourquoi Vite ?

| Critère                       | Apport de Vite 7                                            |
| ----------------------------- | ----------------------------------------------------------- |
| Build statique multi-pages    | Support natif `rollupOptions.input` pour 6 entrées HTML     |
| Dev server rapide             | ES modules natifs en dev, pas de bundling                   |
| Tree-shaking & code splitting | `manualChunks` configuré pour isoler les vendors            |
| Templates EJS                 | Via `vite-plugin-html` (factoring des `<head>`, `<header>`) |
| Variables d'env scopées       | Préfixe `VITE_*` pour ce qui entre dans le bundle public    |

### Pourquoi Alpine.js (et pas React/Vue) ?

- **Contrainte d'hébergement** : GitHub Pages = fichiers statiques. Pas de SSR, pas de runtime serveur → un framework lourd avec hydratation est superflu.
- **Volume de logique modeste** : 6 pages d'admin/utilisateur, pas de SPA complexe. Alpine couvre les besoins (réactivité, stores, persist) sans coût d'apprentissage.
- **Performances** : runtime Alpine ~17 KB gzippé vs ~45 KB pour React minimal. Premier paint plus rapide.

### Pourquoi Supabase ?

- **RLS = sécurité dans la base** : les règles d'accès sont vérifiées par PostgreSQL, pas par du code applicatif. Impossible de contourner depuis le navigateur.
- **Auth managée** : OTP 6 chiffres par email, sessions JWT, refresh token. Aucun code de gestion d'auth côté serveur à maintenir.
- **Triggers PL/pgSQL** : invariants métier (capacité, conflits horaires) appliqués atomiquement à l'INSERT/UPDATE.
- **Edge Functions Deno** : runtime serverless pour les cas qui exigent un secret (SMTP, service_role).
- **Free tier suffisant** : événement ponctuel, charge limitée.

### Pourquoi Tailwind CSS ?

- Cohérence visuelle via tokens custom (`brutal-black`, `brutal-ice`, `brutal-white`, `shadow-brutal*`).
- Purge automatique des classes non utilisées (build léger).
- Pas de fichiers CSS éparpillés à maintenir.

### Dépendances majeures (runtime)

| Dépendance              | Version | Rôle                                                                    |
| ----------------------- | ------- | ----------------------------------------------------------------------- |
| `@supabase/supabase-js` | ^2.39.0 | Client unique Auth + REST + Realtime, instancié dans `src/js/config.js` |
| `alpinejs`              | ^3.13.3 | Réactivité DOM, `Alpine.data()` + `Alpine.store()`                      |
| `qrcode`                | ^1.5.4  | **Génération** de QR codes (page bénévole, scanner)                     |

### Dépendances majeures (build)

| Dépendance         | Version  | Rôle                                         |
| ------------------ | -------- | -------------------------------------------- |
| `vite`             | ^7.3.0   | Bundler + dev server                         |
| `vite-plugin-html` | ^3.2.2   | Templates EJS, minification HTML, multi-pages |
| `tailwindcss`      | ^3.3.5   | Framework CSS utility-first                  |
| `postcss`          | ^8.4.31  | Pipeline CSS (utilisé par Tailwind)          |
| `autoprefixer`     | ^10.4.16 | Préfixes vendeurs CSS                        |

---

## 3. Structure des dossiers

### Racine

```
eventstaff/
├── index.html, admin.html, debit.html, scanner-tshirt.html,
│   admin-connexions.html, besoins.html       # 6 pages d'entrée Vite
├── vite.config.js                            # 6 entrypoints, base "./"
├── package.json                              # scripts + deps
├── tailwind.config.js, postcss.config.js     # config CSS
├── .env.example                              # modèle de variables d'env
├── src/                                      # voir détail ci-dessous
├── supabase/                                 # config + schéma SQL + Edge Functions
├── README.md, GUIDE-INSTALLATION.md          # docs (install A→Z)
├── ARCHITECTURE.md, DATABASE.md              # docs techniques
└── .github/workflows/deploy.yml              # déploiement GitHub Pages
```

### `src/` — code source frontend

```
src/
├── js/             # tout le JavaScript
├── partials/       # fragments HTML (EJS)
├── styles/         # CSS / Tailwind entrypoints (main.css)
├── css/            # CSS spécifiques par page
└── data/           # (vide actuellement)
```

### `src/js/` — état réel

```
src/js/
├── config.js              # 🔒 SINGLETON : client Supabase + mécanisme refresh token
├── constants.js           # Re-export VITE_SUPABASE_URL / ANON_KEY + check dev
│
├── main.js                # Entrypoint page index.html
├── admin.js               # Entrypoint page admin.html
├── debit.js               # Entrypoint page debit.html
├── scanner-tshirt.js      # Entrypoint page scanner-tshirt.html
├── admin-connexions.js    # Entrypoint page admin-connexions.html
├── besoins.js             # Entrypoint page besoins.html
├── admin-timeline.js      # ⚠️ Non déclaré comme entrypoint dans vite.config.js
│
├── services/              # Accès Supabase — passage obligé pour tout JS
│   ├── api.js             #   CRUD métier (benevoles, postes, inscriptions, cagnotte)
│   ├── auth.js            #   OTP, session, rôle utilisateur courant
│   └── public-api.js      #   RPC anonymes via client isolé (debit.html et scanner-tshirt.html)
│
├── stores/                # Alpine.store() — état partagé global
│   └── admin-store.js     #   (seul store actuel — autres domaines encore inline)
│
├── components/            # Alpine.data() — composants Alpine isolés
│   ├── admin/             #   7 onglets admin (benevoles, cagnotte-forcee,
│   │                      #     heures, mailing, recap, referents, visual-creator)
│   └── user/              #   Widgets côté bénévole (cagnotte, t-shirt)
│
├── modules/               # (legacy) logique métier héritée de certaines pages
│   ├── store.js
│   └── user/              #   planning.js, profiles.js, wizard.js
│
└── utils/                 # Helpers purs
    ├── admin-shift-validation.js
    ├── admin-time.js
    ├── confirm.js         #   Helper modale de confirmation
    ├── format-date.js     #   Formatage de dates
    └── toast.js           #   Helper toast (succès/erreur)
```

#### Conventions de `src/js/` (résumé)

| Règle                                                                                            | Référence                |
| ------------------------------------------------------------------------------------------------ | ------------------------ |
| **Un seul client Supabase** : `createClient()` uniquement dans `config.js`                       | Convention projet |
| **Pas d'accès `supabase.*` hors `services/`** : composants et stores passent par un service      | Convention projet |
| **Pas de classes JS** : objets littéraux retournés par des fonctions (compatibles `Alpine.data`) | Convention projet |
| **Pas de `x-data` inline > 3 lignes** : extraire dans `components/`                              | Convention projet |
| **Préfixes méthodes** : `load…` pour chargement, `save…` pour persistance, toast après save      | Convention projet |
| **ES modules natifs uniquement**, pas de barrel files (`index.js` ré-exportateurs)               | Convention projet |

### `src/partials/` — fragments HTML EJS

```
src/partials/
├── layout/                # Layout commun (head, header)
│   ├── head.html          #   Balises <head> communes
│   └── header.html        #   En-tête réutilisable
├── components/            # Fragments UI réutilisables
│   ├── cagnotte-widget.html
│   ├── confirm-modal.html
│   ├── post-card-details.html
│   ├── toast.html
│   └── tshirt-widget.html
├── sections/              # Sections spécifiques à une page
│   ├── index/             #   login, planning-calendar, planning-list
│   ├── admin/             #   8 onglets (tabs.html + tab-*.html)
│   └── admin-timeline/    #   chart, day-picker
└── wizard.html            # Wizard d'inscription (utilisé par index)
```

Inclusion via `<%- include('chemin/relatif.html') %>`. Aucune logique métier dans les templates — uniquement des attributs Alpine référençant un `x-data="<nom>"` défini dans `src/js/components/`.

### `src/styles/`

```
src/styles/
└── main.css       # Entrypoint Tailwind (directives @tailwind base/components/utilities)
```

Pas de CSS inline dans les templates. Tokens custom déclarés dans `tailwind.config.js`.

### `src/css/`

```
src/css/
├── debit.css            # CSS spécifique à la page de débit cagnotte
└── scanner-tshirt.css   # CSS spécifique au scanner de QR codes t-shirt
```

Ces feuilles sont importées par leur entrypoint JS respectif (`src/js/debit.js`, `src/js/scanner-tshirt.js`).

### `src/data/`

Vide actuellement. Réservé à d'éventuelles données statiques importées au build (JSON figés, listes de référence).

### `supabase/`

```
supabase/
├── config.toml                          # Config Supabase locale (ports, auth, edge runtime)
├── migrations/
│   └── 00000000000000_init.sql          # Schéma complet + seed config (fichier unique)
└── functions/                           # Edge Functions Deno
    ├── deno.json
    ├── send-planning/
    └── create-benevole/
```

Le fichier `00000000000000_init.sql` (tables, vues, fonctions, triggers, policies RLS en `FORCE`, GRANTs PostgREST + clés `config` par défaut) est la **source de vérité unique** : il reconstruit l'intégralité du schéma `public` from-scratch, soit via `supabase db reset`, soit par copier-coller dans le SQL Editor Supabase (cf. `GUIDE-INSTALLATION.md`).

---

## 4. Limitations connues

Caractéristiques résiduelles de l'architecture, sans impact fonctionnel :

| Élément                                         | Note                                      |
| ----------------------------------------------- | ----------------------------------------- |
| Entrypoints à plat dans `src/js/` (vs `pages/`) | Organisation à plat conservée             |
| `src/js/modules/` (legacy)                      | Logique métier héritée de certaines pages |
| `src/js/constants.js`                           | Séparé de `config.js`                     |
| Stores limités à `admin-store.js`               | Un seul store partagé                     |
| `admin-timeline.js` hors `vite.config.js`       | Chargé hors entrypoint Rollup déclaré     |

---

## 5. Documents liés

| Sujet                                        | Document                                             |
| -------------------------------------------- | ---------------------------------------------------- |
| Installation rapide, dev, build local        | [`README.md`](README.md)                             |
| Installation pas-à-pas (A→Z, non-dev)        | [`GUIDE-INSTALLATION.md`](GUIDE-INSTALLATION.md)     |
| Schéma DB, RLS, triggers, fonctions PL/pgSQL | [`DATABASE.md`](DATABASE.md)                         |
