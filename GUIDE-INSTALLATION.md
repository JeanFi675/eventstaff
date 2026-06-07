# 🚀 Guide d'installation complet — EventStaff

Ce guide t'accompagne **de A à Z** pour mettre en ligne ton propre site de gestion de bénévoles, **même si tu n'as jamais touché à du code**. À la fin, tu auras un site web public, ta base de données, et tu seras connecté en **administrateur** prêt à créer ton événement.

**Durée estimée :** 45 min à 1 h 30 selon ton aisance.

**Coût :** 0 € (offres gratuites de GitHub et Supabase). Un service d'envoi d'emails est **requis** mais se trouve en offre gratuite (voir Partie 5.2).

---

## ✅ Avant de commencer — ce qu'il te faut

- Un ordinateur avec un navigateur web (Chrome, Firefox, Edge…).
- Une **adresse email** valide (ce sera ton compte admin).
- 1 heure devant toi.
- **(Requis)** un compte chez un fournisseur d'envoi d'emails (Brevo, Gmail…) — indispensable pour envoyer les codes de connexion. Détaillé en Partie 5.2.

> 💡 **Garde un bloc-notes ouvert.** Tu vas devoir noter quelques informations au fil de l'eau (clés, mots de passe, adresses). Une petite zone « copier-coller » te fera gagner du temps.

---

## 🗺️ Les grandes étapes

1. **GitHub** — créer un compte et récupérer le projet
2. **Supabase** — créer un compte et un projet (la base de données)
3. **Importer la structure** — un seul fichier SQL à coller
4. **Récupérer tes clés** — l'adresse et la clé de ta base
5. **Configurer la connexion & les emails** — code à 6 chiffres, SMTP, modèle d'email
6. **Mettre le site en ligne** — secrets GitHub + activation des Pages
7. **Première connexion + devenir admin**
8. _(Avancé, optionnel)_ Edge Functions — emails de planning
9. **Configurer ton événement** depuis l'admin

---

# Partie 1 — GitHub : compte + récupération du projet

GitHub héberge le code **et** publie gratuitement ton site.

### 1.1 Créer un compte GitHub

1. Va sur **https://github.com/signup**.
2. Renseigne email, mot de passe, et un **nom d'utilisateur** (ex. `marie-dupont`). 👉 **Note ce nom d'utilisateur**, il apparaîtra dans l'adresse de ton site.
3. Valide ton email (GitHub t'envoie un code).

### 1.2 Copier le projet dans ton compte (« Fork »)

1. Ouvre le **lien GitHub du projet** qu'on t'a transmis.
2. En haut à droite de la page, clique sur le bouton **« Fork »**.
3. Sur l'écran qui s'ouvre :
   - **Owner** : ton compte.
   - **Repository name** : choisis un nom court, en minuscules, sans espaces (ex. `benevoles-festival`). 👉 **Note ce nom**, il fait partie de l'adresse de ton site.
   - Laisse **« Copy the main branch only »** coché.
4. Clique sur **« Create fork »**. Au bout de quelques secondes, tu as **ta propre copie** du projet.

> ⚠️ **Important : garde le dépôt PUBLIC.** GitHub Pages n'est gratuit que pour les dépôts publics. C'est sans risque ici : le code ne contient aucun secret, et l'accès aux données est protégé côté base (clé publique + règles de sécurité).

### 1.3 Note l'adresse de ton futur site

Elle suit toujours ce format :

```
https://TON-PSEUDO.github.io/NOM-DU-DEPOT/
```

Exemple : `https://marie-dupont.github.io/benevoles-festival/`

👉 **Note cette adresse complète** (avec le `/` final). On l'appellera **« l'adresse du site »** dans la suite. On l'utilisera aux Parties 5 et 6.

---

# Partie 2 — Supabase : compte + projet

Supabase est la « base de données » : elle stocke les bénévoles, les postes, les inscriptions, et gère la connexion.

### 2.1 Créer un compte

1. Va sur **https://supabase.com** et clique sur **« Start your project »**.
2. Connecte-toi **avec ton compte GitHub** (le plus simple) ou avec un email.

### 2.2 Créer un projet

1. Clique sur **« New project »**.
2. Renseigne :
   - **Name** : ce que tu veux (ex. `benevoles-festival`).
   - **Database Password** : clique sur **« Generate a password »** puis 👉 **NOTE-LE précieusement**. Tu en auras besoin pour les options avancées (Partie 8). Tu ne pourras pas le revoir ensuite.
   - **Region** : choisis la plus proche de tes utilisateurs (ex. **West EU (Paris)** ou **Frankfurt**).
3. Clique sur **« Create new project »** et **patiente ~2 minutes** (Supabase prépare ta base).

---

# Partie 3 — Importer la structure (le fichier SQL unique)

Ta base est vide. On va y créer toutes les tables, règles de sécurité et réglages par défaut, en **une seule opération**.

1. Dans le menu de gauche de Supabase, clique sur **« SQL Editor »** (icône `</>`).
2. Clique sur **« + New query »**.
3. Dans ton fork GitHub, ouvre le fichier :
   **`supabase/migrations/00000000000000_init.sql`**
   Clique sur le bouton **« Copy raw file »** (ou sélectionne tout le contenu : `Ctrl/Cmd + A` puis `Ctrl/Cmd + C`).
4. Reviens dans le **SQL Editor** de Supabase, **colle** tout le contenu (`Ctrl/Cmd + V`).
5. Clique bien sur le bouton **vert « Run »** (en bas à droite, ou `Ctrl/Cmd + Entrée`). ⚠️ **N'utilise pas** le bouton/raccourci **« Explain »** : il n'analyse qu'une seule requête et affichera l'erreur _« EXPLAIN only works on a single SQL statement »_.

> ✅ **Résultat attendu — c'est gagné si tu vois l'un de ces deux cas :**
>
> - le message **« Success. No rows returned »**, **ou**
> - un **petit tableau avec une colonne `set_config` et une ligne vide**. C'est tout aussi bon : c'est la sortie normale du préambule du fichier (`SELECT … set_config(…)`). Tant que tu n'as **pas d'erreur rouge**, la structure est en place.
>
> ⚠️ Si tu vois une **erreur rouge**, c'est presque toujours que **tout le contenu n'a pas été collé**. Recommence en sélectionnant bien **l'intégralité** du fichier.

Pour **vérifier** que tout est créé, colle cette **seule** requête dans une nouvelle query et clique **Run** :

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'public') as nb_tables,
  (select count(*) from public.config) as nb_cles_config;
```

Tu dois obtenir **`nb_tables` = 17** (tables et vues du schéma `public`) et **`nb_cles_config` = 5**. Tu peux aussi ouvrir le menu **« Table Editor »** : la liste des tables doit apparaître (`benevoles`, `postes`, `inscriptions`, `config`…).

---

# Partie 4 — Récupérer tes clés (URL + clé publique)

Ton site a besoin de **deux informations** pour parler à ta base :

- **A.** l'**adresse** de ta base (_Project URL_) ;
- **B.** la **clé publique** de connexion (_anon key_).

> ⚠️ **Attention : ces deux informations ne sont PAS au même endroit** dans le tableau de bord Supabase. Suis les deux sous-sections ci-dessous l'une après l'autre. Garde ton bloc-notes ouvert pour les copier.

### 4.A — L'adresse de la base (Project URL)

1. Dans le menu vertical de gauche, clique sur **« Integrations »**.
2. Dans le sous-menu, ouvre **« Data API »**.
3. Repère le champ **« API URL »**. Il ressemble à :
   `https://votreprojet.supabase.co/rest/v1/`
4. **Copie-le, MAIS supprime le suffixe `/rest/v1/`** à la fin. 👉 Tu dois noter **uniquement la racine** :

   ```
   https://votreprojet.supabase.co
   ```

   _(pas de `/rest/v1/`, pas de `/` final — juste `https://…​.supabase.co`)_

> 📝 C'est cette valeur qui servira de secret **`VITE_SUPABASE_URL`** en Partie 6. Note-la comme **« Project URL »**.

### 4.B — La clé publique (anon key)

1. Dans le menu vertical de gauche, clique sur **« Project Settings »** (la roue dentée).
2. Dans le sous-menu, ouvre **« API keys »**.
3. Clique sur l'onglet **« Legacy anon, service_role API keys »**.
4. Repère la ligne **`anon` `public`** et copie sa valeur : une **longue chaîne** commençant par **`eyJ…`**. 👉 Note-la comme **« clé anon »**.

> 📝 C'est cette valeur qui servira de secret **`VITE_SUPABASE_ANON_KEY`** en Partie 6.

> ✅ La clé `anon public` est **faite pour être publique** : aucun risque à l'utiliser sur le site. La sécurité repose sur les règles de la base (RLS). La mention « Legacy » est normale — c'est exactement la clé attendue par l'application.
>
> 🚫 Sur la même page, tu verras aussi une clé **`service_role`** : **ne l'utilise JAMAIS** sur le site web (elle contourne toute la sécurité). On ne s'en sert qu'en Partie 8 (avancé), côté serveur uniquement.

### Récapitulatif de la Partie 4

| À noter         | Valeur (exemple)                         | Servira de secret GitHub |
| --------------- | ---------------------------------------- | ------------------------ |
| **Project URL** | `https://votreprojet.supabase.co`        | `VITE_SUPABASE_URL`      |
| **clé anon**    | `eyJhbGciOiJIUzI1NiIsInR5cCI6…` (longue) | `VITE_SUPABASE_ANON_KEY` |

---

# Partie 5 — Configurer la connexion & les emails

L'application connecte les gens **sans mot de passe** : on saisit son email, on reçoit un **code à 6 chiffres** par email, on le tape. Voici comment régler ça.

> 🧭 **Ordre important.** On règle d'abord les fournisseurs (5.1), **puis le SMTP (5.2)**, et **seulement après** le modèle d'email (5.3). Pourquoi ? Parce que Supabase **bloque la modification des modèles d'email tant qu'aucun SMTP personnalisé n'est configuré**. Respecte cet ordre pour éviter un blocage.

### 5.1 Configurer la connexion par email

Va dans le menu **« Authentication »** → **« Sign In / Providers »**. La page se règle en **deux temps** : d'abord le bloc **« User Signups »**, puis le bloc **« Auth Providers »**.

#### A. Bloc « User Signups » — désactiver « Confirm email »

1. Repère l'option **« Confirm email »**.
2. Mets-la sur **désactivé (OFF)**.
3. Clique sur **« Save changes »**.

> **Pourquoi ?** Le code à 6 chiffres prouve déjà que la personne possède son adresse email. Un second email de confirmation doublerait les envois et casserait le parcours de connexion.

#### B. Bloc « Auth Providers » — le fournisseur « Email »

1. Dans la liste des fournisseurs, vérifie que **« Email »** est **activé**, puis **clique dessus** pour déployer ses réglages.
2. Règle chaque option comme suit :

| Option (panneau Email)                     | Réglage conseillé                               | Pourquoi                                                                                                |
| ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Enable email provider**                  | ✅ **Activé**                                   | C'est le **seul** mode de connexion de l'application.                                                   |
| **Secure email change**                    | ✅ Activé (valeur par défaut)                   | Sécurité : un changement d'email se confirme sur l'ancienne **et** la nouvelle adresse. Sans impact.    |
| **Secure password change**                 | Laisser par défaut                              | L'app **n'utilise aucun mot de passe** côté utilisateur : ce réglage est sans effet ici.                |
| **Require current password when updating** | Laisser par défaut (OFF)                        | Idem — aucun mot de passe utilisateur dans le parcours.                                                 |
| **Prevent use of leaked passwords**        | ✅ Activer **si disponible**                    | Bonus sécurité, mais **réservé à l'offre Pro**. Sur l'offre gratuite c'est grisé : ignore, sans impact. |
| **Minimum password length**                | **8**                                           | Défense en profondeur pour un éventuel compte créé avec mot de passe (ex. admin via dashboard).         |
| **Password requirements**                  | **« Lowercase, uppercase letters and digits »** | Même raison ; coût nul puisque les utilisateurs ne saisissent jamais de mot de passe.                   |
| **Email OTP expiration**                   | **3600** (soit 1 heure)                         | Durée de validité du code reçu par email.                                                               |
| **Email OTP length**                       | **6**                                           | ⭐ L'application attend un code à **6 chiffres**. **Ne pas changer.**                                   |

3. Clique sur **« Save changes »**.

> 💡 Laisse **tous les autres fournisseurs** (Google, Apple, Phone, etc.) **désactivés** : ils ne sont pas utilisés par l'application.

### 5.2 Configurer l'envoi d'emails (SMTP) — **à faire maintenant**

Pour que les codes à 6 chiffres **partent réellement** vers tes bénévoles — **et** pour pouvoir modifier le modèle d'email à l'étape 5.3 — il faut brancher un service d'envoi d'emails (SMTP).

> ⚠️ **Deux raisons de le faire dès maintenant :**
>
> 1. Le service d'email **intégré** de Supabase est **très limité** (quelques emails/heure, parfois réservés à ta propre adresse) : insuffisant pour un vrai événement.
> 2. Supabase **interdit la modification des modèles d'email tant qu'un SMTP personnalisé n'est pas activé**. Sans cette étape, tu seras **bloqué** en 5.3.

**a) Choisir un fournisseur (gratuit)**

| Fournisseur               | Offre gratuite     | Remarque                                    |
| ------------------------- | ------------------ | ------------------------------------------- |
| **Brevo** (ex-Sendinblue) | ~300 emails/jour   | Simple, recommandé pour débuter             |
| **Mailjet**               | ~6 000 emails/mois | Bonne alternative                           |
| **Gmail** (SMTP)          | usage perso limité | Nécessite un « mot de passe d'application » |

Crée un compte chez l'un d'eux, puis récupère ses **paramètres SMTP** (_Hôte_, _Port_, _Identifiant_, _Mot de passe / clé SMTP_).

**b) Brancher le SMTP dans Supabase**

1. Menu **« Project Settings »** → **« Authentication »** → onglet **« SMTP Settings »** (ou _Authentication → Emails → SMTP_).
2. Active **« Enable Custom SMTP »** et renseigne :

| Champ            | Valeur (exemple Brevo)                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| **Host**         | `smtp-relay.brevo.com`                                                      |
| **Port**         | `587`                                                                       |
| **Username**     | l'identifiant fourni par le service                                         |
| **Password**     | la clé/mot de passe SMTP du service                                         |
| **Sender email** | une adresse **vérifiée** chez le fournisseur (ex. `contact@ton-domaine.fr`) |
| **Sender name**  | le nom affiché (ex. `Bénévoles Festival`)                                   |

3. **Enregistre**.

> 💡 **L'adresse expéditrice doit être validée** chez ton fournisseur (vérification par email ou via ton nom de domaine). Sinon les emails seront refusés ou marqués comme spam.
>
> 💡 **Augmente la limite d'envoi** : dans _Authentication → Rate Limits_, monte la limite d'emails par heure si tu attends beaucoup d'inscriptions simultanées.

### 5.3 ⭐ Étape clé : afficher le code dans l'email

Par défaut, l'email de connexion de Supabase contient **un lien**, mais **pas le code à 6 chiffres**. Comme l'application demande le **code**, il faut modifier le modèle d'email.

> ✅ **Prérequis : le SMTP de l'étape 5.2 doit être activé**, sinon Supabase n'autorise pas la modification des modèles.

1. Menu **« Authentication »** → **« Emails »** (ou _Email Templates_).
2. Ouvre le modèle **« Magic link or OTP »**. _(C'est bien celui utilisé pour la connexion par code.)_
3. Renseigne le champ **« Subject »** (le sujet du mail), par exemple :

   ```
   {{ .Token }} — Votre code de connexion
   ```

   _(Mettre le code dans le sujet permet à l'utilisateur de le voir directement dans la liste de ses emails, sans même ouvrir le message.)_

4. Dans le champ **« Message »** (le corps du mail), **remplace tout son contenu** par ceci :

```html
<h2>Votre code de connexion</h2>
<p>Bonjour,</p>
<p>Voici votre code de connexion à 6 chiffres :</p>
<p
  style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; margin: 24px 0;"
>
  {{ .Token }}
</p>
<p>
  Saisissez ce code dans l'application pour vous connecter. Il expire dans 1
  heure.
</p>
<p style="color:#888; font-size:12px;">
  Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.
</p>
```

5. **Enregistre** (Save).

> ⭐ La balise `{{ .Token }}` est **indispensable** : c'est elle qui insère le code à 6 chiffres. Sans elle, personne ne pourra se connecter.

### 5.4 Déclarer l'adresse de ton site

**Rappel : comment est composée l'adresse de ton site ?** Elle est créée automatiquement par GitHub Pages et suit **toujours** ce format :

```
https://NOM-D-UTILISATEUR.github.io/NOM-DU-DEPOT/
```

- **NOM-D-UTILISATEUR** = ton pseudo GitHub (celui de la Partie 1.1).
- **NOM-DU-DEPOT** = le nom que tu as donné au dépôt (la Partie 1.2).

> Exemple : pseudo `marie-dupont` + dépôt `benevoles-festival` → l'adresse est
> `https://marie-dupont.github.io/benevoles-festival/`
> (tout en minuscules, avec le `/` à la fin).

Une fois l'adresse reconstituée, déclare-la dans Supabase :

1. Menu **« Authentication »** → **« URL Configuration »**.
2. **Site URL** → colle **l'adresse de ton site**, par ex. :
   `https://marie-dupont.github.io/benevoles-festival/`
3. **Redirect URLs** → clique **« Add URL »** et ajoute ces deux entrées (remplace par ta vraie adresse) :
   - `https://marie-dupont.github.io/benevoles-festival/**`
   - `https://marie-dupont.github.io/benevoles-festival/index.html`
4. **Enregistre**.

---

# Partie 6 — Mettre le site en ligne

On va donner tes clés Supabase à GitHub (de façon sécurisée), puis activer la publication.

### 6.1 Ajouter les « secrets » GitHub

Ce sont des informations privées que GitHub utilise pour construire le site, sans les afficher publiquement.

1. Dans **ton dépôt** GitHub → onglet **« Settings »**.
2. Menu de gauche → **« Secrets and variables »** → **« Actions »**.
3. Clique **« New repository secret »** et crée **ces trois secrets**, un par un :

| Name (exactement)         | Secret (valeur)                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| `VITE_SUPABASE_URL`       | ta **Project URL** (Partie 4), ex. `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`  | ta clé **anon public** (Partie 4), la longue chaîne `eyJ…`        |
| `VITE_APP_URL_PRODUCTION` | **l'adresse de ton site** (Partie 1.3)                            |

> ⚠️ Respecte **exactement** les noms (majuscules, underscores). Une faute de frappe et le site ne saura pas se connecter à la base.

### 6.2 Activer GitHub Pages

1. Toujours dans **« Settings »** → menu **« Pages »**.
2. Sous **« Build and deployment »** → **Source** → choisis **« GitHub Actions »**.

### 6.3 Lancer la publication

1. Onglet **« Actions »** de ton dépôt.
2. Si GitHub demande d'activer les workflows, clique pour **autoriser**.
3. Dans la liste à gauche, clique sur **« Deploy to GitHub Pages »** → bouton **« Run workflow »** → **« Run workflow »**.
4. Patiente 1 à 2 minutes : une coche **verte ✅** indique que c'est publié.

> 💡 Le site se republiera **automatiquement** à chaque modification que tu pousses sur la branche `main`.

### 6.4 Vérifier

Ouvre **l'adresse de ton site** dans le navigateur. La page d'accueil de l'application doit s'afficher. 🎉

> ⚠️ **Page blanche ou erreur 404 ?** Attends 1–2 minutes (le temps que GitHub propage), puis recharge. Vérifie aussi que l'adresse se termine bien par `/NOM-DU-DEPOT/`. Voir la partie **Dépannage**.

---

# Partie 7 — Première connexion + devenir administrateur

Ton site fonctionne, mais **personne n'est encore administrateur**. Voici comment le devenir.

### 7.1 Se connecter une première fois

1. Ouvre **l'adresse de ton site**.
2. Lance la connexion, saisis **ton adresse email**, valide.
3. Tu reçois un **email avec un code à 6 chiffres** (vérifie les spams au besoin).
4. Saisis le code dans l'application.

> ✅ Tu es maintenant « connecté », mais comme un visiteur sans profil. Cette étape a créé ton **compte de connexion** dans Supabase. On va maintenant te promouvoir admin.
>
> ⚠️ **Aucun email reçu ?** Le SMTP (Partie 5.2) n'est probablement pas configuré/validé. Voir **Dépannage**.

### 7.2 Te déclarer administrateur (une requête SQL)

1. Retourne dans Supabase → **« SQL Editor »** → **« + New query »**.
2. Colle la requête ci-dessous **en remplaçant les valeurs** entre guillemets par les tiennes (utilise **la même adresse email** que celle de ta connexion à l'étape 8.1) :

```sql
insert into public.benevoles (email, prenom, nom, telephone, role, user_id)
select u.email, 'Marie', 'Dupont', 'INCONNU', 'admin', u.id
from auth.users u
where u.email = 'ton.email@exemple.com';
```

- Remplace `'Marie'` et `'Dupont'` par ton prénom et ton nom.
- Remplace `'ton.email@exemple.com'` par **ton adresse email exacte**.
- Laisse `'INCONNU'` pour le téléphone (tu pourras le compléter plus tard).
- Laisse `'admin'` tel quel.

3. Clique **« Run »**. Tu dois voir **« Success. 1 row affected »** (ou similaire).

> 💡 **Ça affiche « 0 rows » ?** C'est que l'email ne correspond à aucun compte de connexion : refais bien l'étape 8.1 avec **la même adresse**, puis relance la requête.

### 7.3 Profiter de ton accès admin

1. Retourne sur le site et **reconnecte-toi** (ou recharge la page).
2. Ouvre la page d'administration : ajoute **`admin.html`** à l'adresse de ton site, par ex. :
   `https://marie-dupont.github.io/benevoles-festival/admin.html`
3. Tu as désormais accès à l'**espace administrateur**. 🎉

> 💡 **Plus tard, promouvoir quelqu'un d'autre admin** : une fois la personne inscrite, lance dans le SQL Editor :
>
> ```sql
> update public.benevoles set role = 'admin' where email = 'autre@exemple.com';
> ```
>
> Les rôles possibles sont `benevole`, `referent`, `admin`.

---

# Partie 8 — (Avancé, optionnel) Emails de planning & création de comptes

Cette partie active deux fonctionnalités **facultatives** :

- l'**envoi du planning** par email aux bénévoles (`send-planning`, `send-rappel-all`) ;
- la **création de comptes bénévoles directement depuis l'admin** (`create-benevole`).

> ℹ️ **Tu peux ignorer cette partie au début.** Sans elle, tes bénévoles peuvent quand même se connecter eux-mêmes (par code à 6 chiffres) et s'inscrire aux postes. Reviens-y quand tu voudras envoyer des plannings par email.

Ces « Edge Functions » sont de petits programmes qui tournent côté serveur. Leur installation demande quelques commandes dans un **terminal** — c'est la seule étape un peu technique.

### 8.1 Installer les outils

- **Supabase CLI** : suis https://supabase.com/docs/guides/cli (installation en 1 commande selon ton système).
- **Deno** : suis https://deno.com (nécessaire à la CLI pour ces fonctions).

### 8.2 Se connecter et relier ton projet

Ouvre un terminal **dans le dossier du projet** (récupéré via `git clone` de ton fork) :

```bash
supabase login
supabase link --project-ref TON-REF-PROJET
```

> `TON-REF-PROJET` est l'identifiant de ton projet (visible dans l'URL Supabase et dans _Project Settings → General_).

### 8.3 Déployer les fonctions

```bash
supabase functions deploy send-planning
supabase functions deploy send-rappel-all
supabase functions deploy create-benevole
```

### 8.4 Donner au serveur les accès SMTP

Ces fonctions envoient des emails via **leur propre** configuration SMTP (indépendante de la Partie 5.2). Renseigne-la :

```bash
supabase secrets set SMTP_HOST=smtp-relay.brevo.com
supabase secrets set SMTP_PORT=587
supabase secrets set SMTP_USER=ton-identifiant-smtp
supabase secrets set SMTP_PASS=ta-cle-smtp
```

Vérifie :

```bash
supabase secrets list
```

> ✅ `SUPABASE_SERVICE_ROLE_KEY` est fourni **automatiquement** à ces fonctions par Supabase — **ne le configure pas** à la main et ne le mets **jamais** ailleurs.

---

# Partie 9 — Configurer ton événement

Tout est en place ! Connecte-toi sur `…/admin.html` et, dans l'espace admin :

1. **Identité de l'événement** (Configuration) : renseigne le **titre** et l'**adresse/lieu**. _(Tant que le titre est vide, le site affiche « Appel aux Bénévoles ».)_
2. Active/désactive selon tes besoins : la **cagnotte**, la **question taille de T-shirt**.
3. Crée tes **périodes**, **jours**, **postes** (créneaux) et, si besoin, tes **repas**.
4. Ajoute tes **bénévoles** (ou laisse-les s'inscrire eux-mêmes via la page d'accueil).

Ton site est prêt à recevoir des inscriptions. 🙌

---

# 🆘 Dépannage (FAQ)

**Je ne reçois pas le code par email.**

- Vérifie tes **spams**.
- La cause la plus fréquente : le **SMTP** (Partie 5.2) n'est pas activé, ou l'**adresse expéditrice n'est pas validée** chez ton fournisseur.
- Au tout début, le service intégré de Supabase n'envoie parfois qu'à **ta propre** adresse (celle du compte Supabase) et très peu d'emails/heure : configure le SMTP custom.

**Le code est refusé / « invalide ou expiré ».**

- Le code expire (1 h par défaut) : redemande-en un.
- Vérifie l'étape **5.3** : le modèle **« Magic link or OTP »** doit contenir `{{ .Token }}`.
- Sers-toi du **dernier** code reçu (en demander un nouveau invalide les précédents).

**Le site affiche une page blanche ou une erreur 404.**

- Attends 1–2 min après le déploiement, puis recharge.
- Vérifie que l'adresse finit par `/NOM-DU-DEPOT/`.
- Vérifie dans l'onglet **Actions** que le dernier déploiement est **vert ✅**.

**Le site se charge mais « impossible de se connecter à la base ».**

- Vérifie les **trois secrets** (Partie 6.1) : noms **exacts** et valeurs correctes (URL + clé `anon`).
- Après correction d'un secret, **relance** le workflow (Partie 6.3) pour reconstruire le site.

**La requête « devenir admin » affiche « 0 rows ».**

- L'email ne correspond à aucun compte de connexion. Refais l'étape **8.1** avec **la même adresse**, puis relance la requête **8.2**.

**Je me suis trompé dans l'import SQL.**

- Sans incidence si la base est encore vide : tu peux relancer le fichier `00000000000000_init.sql` (il est prévu pour ne pas écraser des réglages déjà saisis). En cas de doute, recrée un projet Supabase propre et recommence la Partie 3.

---

# 📌 Récapitulatif des informations à conserver

| Information                       | Où elle sert                          |
| --------------------------------- | ------------------------------------- |
| Pseudo GitHub + nom du dépôt      | Compose l'adresse du site             |
| Adresse du site (`…github.io/…/`) | Supabase (URL Config) + secret GitHub |
| Project URL Supabase              | Secret `VITE_SUPABASE_URL`            |
| Clé `anon public` Supabase        | Secret `VITE_SUPABASE_ANON_KEY`       |
| Mot de passe base de données      | Options avancées (CLI)                |
| Identifiants SMTP                 | Envoi des emails (Parties 5.2 et 8)   |

Besoin d'aller plus loin sur la technique ? Vois [`README.md`](README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) et [`DATABASE.md`](DATABASE.md).
