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
8. **Activer les emails & la création de comptes** — Edge Functions (dans le navigateur)
9. **Configurer ton événement** depuis l'admin
10. **(Optionnel mais recommandé)** Activer les **sauvegardes automatiques** de la base

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
   - **Database Password** : clique sur **« Generate a password »** puis 👉 **NOTE-LE précieusement** et garde-le en lieu sûr (utile si tu dois un jour te connecter directement à la base). Tu ne pourras pas le revoir ensuite.
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

1. Va sur la page de **ton dépôt** GitHub. Tout en **haut**, repère la **barre d'onglets** (`Code`, `Issues`, `Pull requests`, `Actions`…) et clique sur **« Settings »** — c'est le **dernier onglet, à droite** (icône d'engrenage ⚙️).
2. Une fois dans Settings, un **menu vertical apparaît à gauche**. Descends jusqu'à la section _Security_ et clique sur **« Secrets and variables »** : un petit sous-menu se déplie → clique sur **« Actions »**.
3. En **haut à droite** de la page, clique sur le bouton vert **« New repository secret »**.
4. Un formulaire s'ouvre : remplis le champ **« Name »** (le nom exact), puis le grand champ **« Secret »** (la valeur), et clique sur le bouton vert **« Add secret »** en bas.
5. **Répète** l'opération (re-clique « New repository secret ») pour **chacun** de ces **trois** secrets :

| Name (exactement)         | Secret (valeur)                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| `VITE_SUPABASE_URL`       | ta **Project URL** (Partie 4), ex. `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`  | ta clé **anon public** (Partie 4), la longue chaîne `eyJ…`        |
| `VITE_APP_URL_PRODUCTION` | **l'adresse de ton site** (Partie 1.3)                            |

> ⚠️ Respecte **exactement** les noms (majuscules, underscores). Une faute de frappe et le site ne saura pas se connecter à la base.
>
> ✅ Une fois les 3 ajoutés, ils apparaissent dans la liste **« Repository secrets »** (leur valeur reste masquée, c'est normal).

### 6.2 Activer GitHub Pages

1. Reste dans **« Settings »**. Dans le **menu vertical de gauche**, section _Code and automation_, clique sur **« Pages »**.
2. Au centre de la page, sous le titre **« Build and deployment »**, repère la ligne **« Source »** : c'est un **menu déroulant**. Ouvre-le et choisis **« GitHub Actions »**. _(La sélection est prise en compte immédiatement, il n'y a pas de bouton « Save » ici.)_

### 6.3 Lancer la publication

1. Retourne en **haut** sur la **barre d'onglets** du dépôt et clique sur l'onglet **« Actions »**.
2. ⚠️ Sur un dépôt copié (fork), les workflows sont désactivés par défaut : si un **bandeau jaune** s'affiche au centre, clique sur le bouton vert **« I understand my workflows, go ahead and enable them »**.
3. Dans le **menu de gauche** (« Workflows »), clique sur **« Deploy to GitHub Pages »**.
4. À **droite**, au-dessus de la liste des exécutions, clique sur le bouton **« Run workflow »** : un petit panneau s'ouvre → laisse la branche `main` sélectionnée et clique sur le bouton vert **« Run workflow »** à l'intérieur.
5. Patiente 1 à 2 minutes, puis **recharge la page** : une **coche verte ✅** à côté de l'exécution indique que le site est publié.

> 💡 Le site se republiera **automatiquement** à chaque modification que tu pousses sur la branche `main`.

### 6.4 Vérifier

Ouvre **l'adresse de ton site** dans le navigateur. La page d'accueil de l'application doit s'afficher. 🎉

> ⚠️ **Page blanche ou erreur 404 ?** Attends 1–2 minutes (le temps que GitHub propage), puis recharge. Vérifie aussi que l'adresse se termine bien par `/NOM-DU-DEPOT/`. Voir la partie **Dépannage**.

---

# Partie 7 — Première connexion + devenir administrateur

Ton site fonctionne, mais **personne n'est encore administrateur**. Voici comment le devenir.

### 7.1 Se connecter et créer ton profil

1. Ouvre **l'adresse de ton site**.
2. Lance la connexion, saisis **ton adresse email**, valide.
3. Tu reçois un **email avec un code à 6 chiffres** (vérifie les spams au besoin). Saisis-le dans l'application.
4. À la première connexion, le site te propose de **créer ton profil** : renseigne **prénom, nom, téléphone** (et taille de T-shirt si la question est activée), puis **valide** le formulaire.

> ✅ Ça y est : ton **compte de connexion** **et** ta **fiche bénévole** existent maintenant dans la base. Par défaut ton rôle est `benevole` — on va le passer en `admin` juste après.
>
> ⚠️ **Aucun email reçu ?** Le SMTP (Partie 5.2) n'est probablement pas configuré/validé. Voir **Dépannage**.

### 7.2 Te déclarer administrateur

Le plus simple : changer ton rôle directement dans la base, **sans écrire de requête**.

1. Dans Supabase, menu de gauche → **« Table Editor »**.
2. En haut de la liste des tables, sélectionne **`benevoles`**.
3. Repère **ta ligne** (celle qui porte **ton email**).
4. **Double-clique** sur la cellule de la colonne **`role`** (sa valeur affichée est `benevole`).
5. Choisis **`admin`** dans la liste déroulante, puis valide (la modification est enregistrée ; clique sur **« Save »** si un bouton apparaît).

> ✅ C'est fait : **tu es administrateur**.
>
> 💡 **Tu ne vois pas ta ligne dans `benevoles` ?** C'est que le formulaire de profil de l'étape 7.1 n'a pas été validé. Retourne sur le site, complète et valide ton inscription, puis reviens.

<details>
<summary><strong>Alternative : par requête SQL</strong> (si tu préfères le SQL)</summary>

Dans **SQL Editor → + New query**, colle ceci en remplaçant par **ton adresse email exacte**, puis clique **Run** :

```sql
update public.benevoles
set role = 'admin'
where email = 'ton.email@exemple.com';
```

`Success. Rows: 1` = c'est bon. Si tu obtiens **0 ligne**, l'email ne correspond à aucune fiche : termine d'abord ton inscription (étape 7.1) avec **la même adresse**, puis relance.

</details>

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

# Partie 8 — Activer les emails de planning & la création de comptes

Cette partie installe les deux **« Edge Functions »** (petits programmes côté serveur) qui complètent l'outil :

- **`send-planning`** — envoie à un bénévole son **planning personnalisé** par email ;
- **`create-benevole`** — permet à un admin de **créer un compte bénévole** directement depuis l'interface d'admin.

> ✅ **Tout se fait dans le navigateur**, depuis le tableau de bord Supabase — **aucun terminal ni outil à installer.**

### 8.1 Créer la fonction `send-planning`

1. Dans Supabase, menu de gauche → **« Edge Functions »**.
2. Clique sur **« Deploy a new function »** (ou **« Create a function »**), puis choisis l'option **« Via Editor »** (l'éditeur de code dans le navigateur).
3. **Nom de la fonction** : saisis exactement `send-planning`.
4. Dans ton dépôt GitHub, ouvre le fichier **`supabase/functions/send-planning/index.ts`** et clique sur **« Copy raw file »** (copie **tout** le contenu).
5. Dans l'éditeur Supabase, **efface le code d'exemple** affiché et **colle** le contenu copié à la place.
6. Clique sur **« Deploy »** (en haut à droite). Patiente quelques secondes : la fonction passe à l'état **déployé** ✅.

### 8.2 Créer la fonction `create-benevole`

Refais **exactement** les mêmes étapes que la 8.1, mais avec :

- **Nom** : `create-benevole`
- **Code** : le contenu de **`supabase/functions/create-benevole/index.ts`**

### 8.3 Renseigner les secrets (accès SMTP)

La fonction `send-planning` envoie les emails via **ton service SMTP** (le même qu'en Partie 5.2). Il faut lui transmettre ces accès sous forme de **secrets** :

1. Toujours dans **« Edge Functions »**, ouvre la section **« Secrets »** (ou _Project Settings → Edge Functions_).
2. Ajoute ces **quatre** secrets (bouton **« Add new secret »**), un par un :

| Nom (exactement) | Valeur (exemple Brevo)     |
| ---------------- | -------------------------- |
| `SMTP_HOST`      | `smtp-relay.brevo.com`     |
| `SMTP_PORT`      | `587`                      |
| `SMTP_USER`      | ton identifiant SMTP       |
| `SMTP_PASS`      | ta clé / mot de passe SMTP |

3. **Enregistre**.

> ✅ Les clés `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournies **automatiquement** par Supabase à tes fonctions — **ne les ajoute pas** à la main, et ne mets **jamais** la `service_role` ailleurs.
>
> ℹ️ Le SMTP configuré dans **Authentication** (Partie 5.2) **n'est pas partagé** avec les Edge Functions : il faut bien re-saisir ces secrets ici (une seule fois).
>
> ⚠️ **Gmail / Google Workspace** : `SMTP_PASS` doit être un **mot de passe d'application** (16 caractères) **collé SANS les espaces** affichés par Google ; le mot de passe habituel du compte est refusé (erreur `535-5.7.8`). `SMTP_USER` = ton adresse Google complète, et `SMTP_PORT` = `465`.
>
> 💡 **Fournisseur exigeant un expéditeur vérifié** (Brevo, etc.) : ajoute un 5ᵉ secret `SMTP_FROM` = l'adresse expéditrice **validée** chez ton fournisseur (sinon l'envoi est rejeté).

---

# Partie 9 — Configurer ton événement

Tout est en place ! Connecte-toi sur `…/admin.html` et, dans l'espace admin :

1. **Identité de l'événement** (Configuration) : renseigne le **titre** et l'**adresse/lieu**. _(Tant que le titre est vide, le site affiche « Appel aux Bénévoles ».)_
2. Active/désactive selon tes besoins : la **cagnotte**, la **question taille de T-shirt**.
3. Crée tes **périodes**, **jours**, **postes** (créneaux) et, si besoin, tes **repas**.
4. Ajoute tes **bénévoles** (ou laisse-les s'inscrire eux-mêmes via la page d'accueil).

Ton site est prêt à recevoir des inscriptions. 🙌

---

# Partie 10 — (Optionnel mais recommandé) Sauvegardes automatiques de la base

L'offre **gratuite de Supabase n'inclut aucune sauvegarde automatique** : si tu effaces une donnée par erreur, elle est perdue. Le projet fournit une **tâche planifiée GitHub** (le fichier `.github/workflows/backup.yml`) qui, **chaque nuit**, fait une copie complète de ta base, la **chiffre**, et la range dans un espace privé de ton dépôt.

> 💡 **Double bénéfice — ça garde ton projet en vie.** Sur l'offre gratuite, Supabase **met un projet en pause** après environ **7 jours sans aucune activité**. Comme cette sauvegarde se connecte à ta base **tous les jours**, elle compte comme une activité et **évite cette mise en pause automatique**. (Voir l'encadré ⚠️ en fin de partie pour une limite à connaître.)

Cette sauvegarde a besoin de **deux secrets GitHub** (comme en Partie 6) :

| Name (exactement)       | À quoi ça sert                                                       |
| ----------------------- | ------------------------------------------------------------------- |
| `SUPABASE_DB_URL`       | L'adresse de connexion directe à ta base (contient son mot de passe) |
| `BACKUP_GPG_PASSPHRASE` | Le mot de passe qui **chiffre** chaque sauvegarde                    |

### 10.1 Récupérer l'adresse de connexion (`SUPABASE_DB_URL`)

1. Dans ton projet Supabase, clique sur le bouton **« Connect »** (en haut de la page, près du nom du projet).
2. La fenêtre affiche d'abord **« Direct connection string »** : clique dessus pour ouvrir la liste des modes de connexion, puis choisis **« Session pooler »** _(et non « Direct connection » ni « Transaction pooler »)._
3. Copie la chaîne affichée. Elle ressemble à :

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
   ```

4. **Remplace `[YOUR-PASSWORD]`** par le **mot de passe de la base** que tu as noté en **Partie 2.2** (à la création du projet). 👉 La chaîne finale ne doit plus contenir de crochets.

> 💡 **Tu as perdu ce mot de passe ?** Tu peux en générer un nouveau dans **Database → Settings → Reset password**, puis l'utiliser ici.

### 10.2 Choisir le mot de passe de chiffrement (`BACKUP_GPG_PASSPHRASE`)

Invente une **phrase longue et unique** (par ex. 4–5 mots au hasard, ou une phrase de passe). C'est elle qui protège tes sauvegardes.

> 🔐 **Conserve-la en lieu sûr, EN DEHORS de GitHub** (gestionnaire de mots de passe, papier…). **Sans cette phrase, tes sauvegardes sont définitivement illisibles** — personne, pas même toi, ne pourra les restaurer.

### 10.3 Ajouter les deux secrets

Exactement comme en **Partie 6.1** : dépôt GitHub → **Settings** → **Secrets and variables** → **Actions** → **« New repository secret »**. Crée les **deux** secrets ci-dessus (noms **exacts**).

### 10.4 Tester tout de suite (sans attendre la nuit)

1. Onglet **« Actions »** de ton dépôt.
2. Dans le menu de gauche, clique sur **« Backup database »**.
3. À droite, bouton **« Run workflow »** → laisse `main` → **« Run workflow »**.
4. Au bout d'1–2 min, une **coche verte ✅** confirme que la sauvegarde a réussi. En cliquant sur l'exécution, tu verras un fichier téléchargeable **`db-backup-…`** (c'est ta sauvegarde chiffrée). Les sauvegardes sont conservées **30 jours**.

> ❌ **Échec (croix rouge) ?** Le plus souvent : `SUPABASE_DB_URL` mal recopiée (crochets `[ ]` oubliés, mauvais mot de passe) ou `BACKUP_GPG_PASSPHRASE` absente. Corrige le secret et relance.

### 10.5 Restaurer une sauvegarde (le jour où c'est nécessaire)

1. Onglet **« Actions »** → ouvre l'exécution voulue → dans la section **« Artifacts »**, télécharge **`db-backup-…`**. GitHub te donne un **`.zip`** : **dézippe-le**. Tu obtiens à l'intérieur le fichier chiffré **`backup_….sql.gpg`**.

2. **Installe l'outil GPG** s'il n'est pas déjà présent (il fournit la commande `gpg`).
   - **Windows** (dans PowerShell) :

     ```powershell
     winget install --id GnuPG.GnuPG -e --source winget
     ```

     Puis **ferme et rouvre PowerShell**, et vérifie avec `gpg --version`.
   - **macOS** : `brew install gnupg` — **Linux** : `sudo apt install gnupg`.

3. **Déchiffre** le fichier avec **ta** phrase de passe (`BACKUP_GPG_PASSPHRASE`). Place-toi d'abord dans le dossier dézippé, puis lance :

   ```powershell
   gpg --decrypt --output backup.sql backup_XXXXXXXX.sql.gpg
   ```

   > ⚠️ **Ordre des fichiers important** : après `--output`, le **fichier à créer** (`backup.sql`, déchiffré) ; **ensuite** le **fichier chiffré** d'entrée (`…​.sql.gpg`). Ne mets **pas** le même nom des deux côtés, sinon tu écrases ta sauvegarde. GPG te demandera alors la phrase de passe.

4. **Réimporte** `backup.sql` dans une base Supabase (via un client PostgreSQL comme `psql`). _C'est une opération technique : en cas de doute, fais-toi aider._

> ⚠️ **À savoir (important pour le « garde en vie ») :** GitHub **désactive automatiquement les tâches planifiées d'un dépôt après 60 jours sans aucune modification (commit)**. Si plus personne ne touche au dépôt pendant 60 jours, la sauvegarde nocturne s'arrête — et ton projet Supabase pourrait alors être mis en pause. Pour réactiver : refais un **« Run workflow »** manuel (étape 10.4) ou pousse une petite modification. Pendant la période active de ton événement, tu n'auras aucun souci.

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

**Je ne trouve pas ma ligne dans la table `benevoles` (étape 7.2).**

- C'est que ton **profil n'a pas encore été créé**. Retourne sur le site, connecte-toi et **valide le formulaire d'inscription** (prénom, nom, téléphone) de l'étape **7.1** avec **la même adresse email**, puis reviens dans le Table Editor.

**L'envoi du planning échoue avec `535-5.7.8 Username and Password not accepted` (Gmail).**

- Google a refusé tes identifiants SMTP. Utilise un **mot de passe d'application** (validation en 2 étapes activée), **collé sans espaces**, et `SMTP_USER` = ton adresse Google complète. Corrige le secret dans **Edge Functions → Secrets** (inutile de redéployer la fonction), puis réessaie.
- ⚠️ Le SMTP de **Authentication** (OTP) n'est **pas** réutilisé par les Edge Functions : ce sont des secrets distincts. Que l'OTP fonctionne ne garantit donc pas que les secrets de la fonction soient corrects.

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
| Mot de passe base de données      | Connexion directe à la base + secret `SUPABASE_DB_URL` (Partie 10) |
| Identifiants SMTP                 | Envoi des emails (Parties 5.2 et 8)   |
| Phrase de chiffrement des sauvegardes | Secret `BACKUP_GPG_PASSPHRASE` — **indispensable pour restaurer** (Partie 10) |

Besoin d'aller plus loin sur la technique ? Vois [`README.md`](README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) et [`DATABASE.md`](DATABASE.md).
