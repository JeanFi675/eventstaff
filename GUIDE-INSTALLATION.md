# 🚀 Guide d'installation complet — EventStaff

Ce guide t'accompagne **de A à Z** pour mettre en ligne ton propre site de gestion de bénévoles, **même si tu n'as jamais touché à du code**. À la fin, tu auras un site web public, ta base de données, et tu seras connecté en **administrateur** prêt à créer ton événement.

> **Pour qui ?** Tu es à l'aise avec un ordinateur et le web, mais tu n'es pas développeur. Suis les étapes **dans l'ordre**, en copiant-collant ce qui est indiqué. Aucune connaissance en programmation n'est nécessaire pour le parcours principal.

---

## 🧭 Ce que tu vas obtenir

- Un **site web** en ligne (hébergé gratuitement sur GitHub Pages).
- Une **base de données** sécurisée (Supabase, offre gratuite).
- Une **connexion par code à 6 chiffres** envoyé par email (pas de mot de passe à retenir).
- Un **espace administrateur** pour créer ton événement, tes postes, tes bénévoles.

**Durée estimée :** 45 min à 1 h 30 selon ton aisance.

**Coût :** 0 € (offres gratuites de GitHub et Supabase). Un service d'envoi d'emails gratuit est recommandé (voir Partie 6).

---

## ✅ Avant de commencer — ce qu'il te faut

- Un ordinateur avec un navigateur web (Chrome, Firefox, Edge…).
- Une **adresse email** valide (ce sera ton compte admin).
- 1 heure devant toi, au calme.
- **(Optionnel, pour les emails)** un compte chez un fournisseur d'envoi d'emails (Brevo, Gmail…). Détaillé en Partie 6.

> 💡 **Garde un bloc-notes ouvert.** Tu vas devoir noter quelques informations au fil de l'eau (clés, mots de passe, adresses). Une petite zone « copier-coller » te fera gagner du temps.

---

## 🗺️ Les grandes étapes

1. **GitHub** — créer un compte et récupérer le projet
2. **Supabase** — créer un compte et un projet (la base de données)
3. **Importer la structure** — un seul fichier SQL à coller
4. **Récupérer tes clés** — l'adresse et la clé de ta base
5. **Configurer la connexion** — code à 6 chiffres + email
6. **Configurer l'envoi d'emails (SMTP)** — pour que les codes partent
7. **Mettre le site en ligne** — secrets GitHub + activation des Pages
8. **Première connexion + devenir admin**
9. *(Avancé, optionnel)* Edge Functions — emails de planning
10. **Configurer ton événement** depuis l'admin

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

👉 **Note cette adresse complète** (avec le `/` final). On l'appellera **« l'adresse du site »** dans la suite. On l'utilisera aux Parties 5 et 7.

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
   - **Database Password** : clique sur **« Generate a password »** puis 👉 **NOTE-LE précieusement**. Tu en auras besoin pour les options avancées (Partie 9). Tu ne pourras pas le revoir ensuite.
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
5. Clique sur **« Run »** (en bas à droite, ou `Ctrl/Cmd + Entrée`).

> ✅ Tu dois voir **« Success. No rows returned »**. C'est normal et c'est **gagné** : toute la structure est en place.
>
> ⚠️ Si tu vois une erreur, c'est presque toujours que **tout le contenu n'a pas été collé**. Recommence en sélectionnant bien **l'intégralité** du fichier.

Pour vérifier : menu **« Table Editor »** → tu dois voir une liste de tables (`benevoles`, `postes`, `inscriptions`, `config`…).

---

# Partie 4 — Récupérer tes clés (URL + clé publique)

Ton site a besoin de savoir **où** est ta base et avec **quelle clé** lui parler.

1. Dans Supabase, menu de gauche → **« Project Settings »** (la roue dentée) → **« API »**.
2. Repère et 👉 **note ces deux valeurs** :

| Information         | Où la trouver                          | Exemple                                  |
| ------------------- | -------------------------------------- | ---------------------------------------- |
| **Project URL**     | Section *Project URL*                  | `https://abcdefgh.supabase.co`           |
| **anon public key** | Section *Project API keys* → `anon` `public` | une longue chaîne commençant par `eyJ…` |

> ✅ La clé `anon public` est **faite pour être publique** : pas d'inquiétude à l'utiliser sur le site. La sécurité repose sur les règles de la base.
>
> 🚫 **N'utilise JAMAIS** la clé `service_role` (la « secrète ») sur le site web. On ne s'en servira qu'en Partie 9 (avancé), côté serveur uniquement.

---

# Partie 5 — Configurer la connexion (code à 6 chiffres)

L'application connecte les gens **sans mot de passe** : on saisit son email, on reçoit un **code à 6 chiffres** par email, on le tape. Voici comment régler ça.

### 5.1 N'autoriser que la connexion par email

1. Menu **« Authentication »** → **« Sign In / Providers »**.
2. Vérifie que **« Email »** est **activé (Enabled)**.
3. Sous Email, règle :
   - **« Confirm email »** → **désactivé (OFF)**. *(Le code à 6 chiffres prouve déjà que la personne possède l'adresse ; un second email de confirmation casserait le parcours.)*
   - **« Secure email change »** → tu peux laisser activé.
4. Laisse tous les autres fournisseurs (Google, Apple, Phone…) **désactivés**.

### 5.2 Régler le code à 6 chiffres

Toujours dans **Authentication**, cherche les réglages **« Email OTP »** (souvent dans *Providers → Email*, ou *Auth → Settings*) :

- **Email OTP Length** → **6**.
- **Email OTP Expiration** → **3600** secondes (1 heure) convient bien.

### 5.3 ⭐ Étape clé : afficher le code dans l'email

Par défaut, l'email de connexion de Supabase contient **un lien**, mais **pas le code à 6 chiffres**. Comme l'application demande le **code**, il faut modifier le modèle d'email.

1. Menu **« Authentication »** → **« Emails »** (ou *Email Templates*).
2. Ouvre le modèle **« Magic Link »**. *(C'est bien celui-ci qui est utilisé pour la connexion par code.)*
3. **Remplace tout son contenu** par ceci :

```html
<h2>Votre code de connexion</h2>
<p>Bonjour,</p>
<p>Voici votre code de connexion à 6 chiffres :</p>
<p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; margin: 24px 0;">
  {{ .Token }}
</p>
<p>Saisissez ce code dans l'application pour vous connecter. Il expire dans 1 heure.</p>
<p style="color:#888; font-size:12px;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
```

4. **Enregistre** (Save).

> ⭐ La balise `{{ .Token }}` est **indispensable** : c'est elle qui insère le code à 6 chiffres. Sans elle, personne ne pourra se connecter.

### 5.4 Déclarer l'adresse de ton site

1. Menu **« Authentication »** → **« URL Configuration »**.
2. **Site URL** → colle **l'adresse de ton site** (Partie 1.3), par ex. :
   `https://marie-dupont.github.io/benevoles-festival/`
3. **Redirect URLs** → clique **« Add URL »** et ajoute ces deux entrées :
   - `https://marie-dupont.github.io/benevoles-festival/**`
   - `https://marie-dupont.github.io/benevoles-festival/index.html`
   *(remplace par ta vraie adresse)*
4. **Enregistre**.

---

# Partie 6 — Configurer l'envoi d'emails (SMTP)

Pour que les codes à 6 chiffres **partent réellement** vers tes bénévoles, il faut brancher un service d'envoi d'emails.

> ⚠️ **Pourquoi c'est nécessaire ?** Le service d'email **intégré** de Supabase est **très limité** (quelques emails par heure, parfois réservés à ton propre compte). Il dépanne pour tester, mais **pas pour un vrai événement**. Branche un service SMTP pour des envois fiables.

### 6.1 Choisir un fournisseur (gratuit)

Quelques options courantes avec une offre gratuite :

| Fournisseur          | Offre gratuite         | Remarque                                          |
| -------------------- | ---------------------- | ------------------------------------------------- |
| **Brevo** (ex-Sendinblue) | ~300 emails/jour   | Simple, recommandé pour débuter                   |
| **Mailjet**          | ~6 000 emails/mois     | Bonne alternative                                 |
| **Gmail** (SMTP)     | usage perso limité     | Nécessite un « mot de passe d'application »       |

Crée un compte chez l'un d'eux, puis récupère ses **paramètres SMTP** (généralement : *Hôte*, *Port*, *Identifiant*, *Mot de passe / clé SMTP*).

### 6.2 Brancher le SMTP dans Supabase

1. Menu **« Project Settings »** → **« Authentication »** → section **« SMTP Settings »** (ou *Authentication → Emails → SMTP*).
2. Active **« Enable Custom SMTP »** et renseigne :

| Champ                  | Valeur (exemple Brevo)               |
| ---------------------- | ------------------------------------ |
| **Host**               | `smtp-relay.brevo.com`               |
| **Port**               | `587`                                |
| **Username**           | l'identifiant fourni par le service  |
| **Password**           | la clé/mot de passe SMTP du service  |
| **Sender email**       | une adresse **vérifiée** chez le fournisseur (ex. `contact@ton-domaine.fr`) |
| **Sender name**        | le nom affiché (ex. `Bénévoles Festival`) |

3. **Enregistre**.

> 💡 **L'adresse expéditrice doit être validée** chez ton fournisseur (vérification par email ou via ton nom de domaine). Sinon les emails seront refusés ou marqués comme spam.
>
> 💡 **Augmente la limite d'envoi** : dans *Authentication → Rate Limits*, monte la limite d'emails par heure si tu attends beaucoup d'inscriptions simultanées.

---

# Partie 7 — Mettre le site en ligne

On va donner tes clés Supabase à GitHub (de façon sécurisée), puis activer la publication.

### 7.1 Ajouter les « secrets » GitHub

Ce sont des informations privées que GitHub utilise pour construire le site, sans les afficher publiquement.

1. Dans **ton dépôt** GitHub → onglet **« Settings »**.
2. Menu de gauche → **« Secrets and variables »** → **« Actions »**.
3. Clique **« New repository secret »** et crée **ces trois secrets**, un par un :

| Name (exactement)         | Secret (valeur)                                              |
| ------------------------- | ----------------------------------------------------------- |
| `VITE_SUPABASE_URL`       | ta **Project URL** (Partie 4), ex. `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`  | ta clé **anon public** (Partie 4), la longue chaîne `eyJ…`   |
| `VITE_APP_URL_PRODUCTION` | **l'adresse de ton site** (Partie 1.3)                       |

> ⚠️ Respecte **exactement** les noms (majuscules, underscores). Une faute de frappe et le site ne saura pas se connecter à la base.

### 7.2 Activer GitHub Pages

1. Toujours dans **« Settings »** → menu **« Pages »**.
2. Sous **« Build and deployment »** → **Source** → choisis **« GitHub Actions »**.

### 7.3 Lancer la publication

1. Onglet **« Actions »** de ton dépôt.
2. Si GitHub demande d'activer les workflows, clique pour **autoriser**.
3. Dans la liste à gauche, clique sur **« Deploy to GitHub Pages »** → bouton **« Run workflow »** → **« Run workflow »**.
4. Patiente 1 à 2 minutes : une coche **verte ✅** indique que c'est publié.

> 💡 Le site se republiera **automatiquement** à chaque modification que tu pousses sur la branche `main`.

### 7.4 Vérifier

Ouvre **l'adresse de ton site** dans le navigateur. La page d'accueil de l'application doit s'afficher. 🎉

> ⚠️ **Page blanche ou erreur 404 ?** Attends 1–2 minutes (le temps que GitHub propage), puis recharge. Vérifie aussi que l'adresse se termine bien par `/NOM-DU-DEPOT/`. Voir la partie **Dépannage**.

---

# Partie 8 — Première connexion + devenir administrateur

Ton site fonctionne, mais **personne n'est encore administrateur**. Voici comment le devenir.

### 8.1 Se connecter une première fois

1. Ouvre **l'adresse de ton site**.
2. Lance la connexion, saisis **ton adresse email**, valide.
3. Tu reçois un **email avec un code à 6 chiffres** (vérifie les spams au besoin).
4. Saisis le code dans l'application.

> ✅ Tu es maintenant « connecté », mais comme un visiteur sans profil. Cette étape a créé ton **compte de connexion** dans Supabase. On va maintenant te promouvoir admin.
>
> ⚠️ **Aucun email reçu ?** Le SMTP (Partie 6) n'est probablement pas configuré/validé. Voir **Dépannage**.

### 8.2 Te déclarer administrateur (une requête SQL)

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

### 8.3 Profiter de ton accès admin

1. Retourne sur le site et **reconnecte-toi** (ou recharge la page).
2. Ouvre la page d'administration : ajoute **`admin.html`** à l'adresse de ton site, par ex. :
   `https://marie-dupont.github.io/benevoles-festival/admin.html`
3. Tu as désormais accès à l'**espace administrateur**. 🎉

> 💡 **Plus tard, promouvoir quelqu'un d'autre admin** : une fois la personne inscrite, lance dans le SQL Editor :
> ```sql
> update public.benevoles set role = 'admin' where email = 'autre@exemple.com';
> ```
> Les rôles possibles sont `benevole`, `referent`, `admin`.

---

# Partie 9 — (Avancé, optionnel) Emails de planning & création de comptes

Cette partie active deux fonctionnalités **facultatives** :

- l'**envoi du planning** par email aux bénévoles (`send-planning`, `send-rappel-all`) ;
- la **création de comptes bénévoles directement depuis l'admin** (`create-benevole`).

> ℹ️ **Tu peux ignorer cette partie au début.** Sans elle, tes bénévoles peuvent quand même se connecter eux-mêmes (par code à 6 chiffres) et s'inscrire aux postes. Reviens-y quand tu voudras envoyer des plannings par email.

Ces « Edge Functions » sont de petits programmes qui tournent côté serveur. Leur installation demande quelques commandes dans un **terminal** — c'est la seule étape un peu technique.

### 9.1 Installer les outils

- **Supabase CLI** : suis https://supabase.com/docs/guides/cli (installation en 1 commande selon ton système).
- **Deno** : suis https://deno.com (nécessaire à la CLI pour ces fonctions).

### 9.2 Se connecter et relier ton projet

Ouvre un terminal **dans le dossier du projet** (récupéré via `git clone` de ton fork) :

```bash
supabase login
supabase link --project-ref TON-REF-PROJET
```

> `TON-REF-PROJET` est l'identifiant de ton projet (visible dans l'URL Supabase et dans *Project Settings → General*).

### 9.3 Déployer les fonctions

```bash
supabase functions deploy send-planning
supabase functions deploy send-rappel-all
supabase functions deploy create-benevole
```

### 9.4 Donner au serveur les accès SMTP

Ces fonctions envoient des emails via **leur propre** configuration SMTP (indépendante de la Partie 6). Renseigne-la :

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

# Partie 10 — Configurer ton événement

Tout est en place ! Connecte-toi sur `…/admin.html` et, dans l'espace admin :

1. **Identité de l'événement** (Configuration) : renseigne le **titre** et l'**adresse/lieu**. *(Tant que le titre est vide, le site affiche « Appel aux Bénévoles ».)*
2. Active/désactive selon tes besoins : la **cagnotte**, la **question taille de T-shirt**.
3. Crée tes **périodes**, **jours**, **postes** (créneaux) et, si besoin, tes **repas**.
4. Ajoute tes **bénévoles** (ou laisse-les s'inscrire eux-mêmes via la page d'accueil).

Ton site est prêt à recevoir des inscriptions. 🙌

---

# 🆘 Dépannage (FAQ)

**Je ne reçois pas le code par email.**
- Vérifie tes **spams**.
- La cause la plus fréquente : le **SMTP** (Partie 6) n'est pas activé, ou l'**adresse expéditrice n'est pas validée** chez ton fournisseur.
- Au tout début, le service intégré de Supabase n'envoie parfois qu'à **ta propre** adresse (celle du compte Supabase) et très peu d'emails/heure : configure le SMTP custom.

**Le code est refusé / « invalide ou expiré ».**
- Le code expire (1 h par défaut) : redemande-en un.
- Vérifie l'étape **5.3** : le modèle **« Magic Link »** doit contenir `{{ .Token }}`.
- Sers-toi du **dernier** code reçu (en demander un nouveau invalide les précédents).

**Le site affiche une page blanche ou une erreur 404.**
- Attends 1–2 min après le déploiement, puis recharge.
- Vérifie que l'adresse finit par `/NOM-DU-DEPOT/`.
- Vérifie dans l'onglet **Actions** que le dernier déploiement est **vert ✅**.

**Le site se charge mais « impossible de se connecter à la base ».**
- Vérifie les **trois secrets** (Partie 7.1) : noms **exacts** et valeurs correctes (URL + clé `anon`).
- Après correction d'un secret, **relance** le workflow (Partie 7.3) pour reconstruire le site.

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
| Identifiants SMTP                 | Envoi des emails (Parties 6 et 9)     |

Besoin d'aller plus loin sur la technique ? Vois [`README.md`](README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) et [`DATABASE.md`](DATABASE.md).
