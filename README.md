# MDC G1 – Devoirs & Planning

Application web pour le **groupe 1 (G1)** de la promo **MDC 2025-2027 (ISTEF)**. Elle a deux onglets :

- **Devoirs** (onglet par défaut) : alerte « Cette semaine : X rendus », puis tout ce qu'il faut rendre, trié par date,
  avec compte à rebours et code couleur (🔴 < 48 h, 🟠 < 1 semaine, 🟢 au-delà), coche « fait » personnelle,
  **pièces jointes** (sujet, consignes, modèle…), filtres, recherche, archives, corbeille, historique.
- **Planning** (du lundi au vendredi) : aujourd'hui / demain en haut, vues semaine / mois / liste, une couleur par matière,
  jours en entreprise grisés, CC et rendus affichés. **Touchez un cours** pour voir ce qu'il y a à rendre dans
  cette matière et **lui ajouter un devoir** (matière et date de la prochaine séance pré-remplies).
- **Connexion** : à la première visite, chacun choisit **son prénom** dans la liste de la classe et entre **le code du groupe**
  (le même pour tout le monde). C'est mémorisé sur l'appareil. Bouton 👤 en haut pour changer de prénom.
- **Ajout collaboratif** : tout le monde peut ajouter, modifier ou supprimer un devoir. Tout le monde voit les changements en temps réel.
  Chaque devoir affiche **« Ajouté par … »** (le prénom de la personne connectée qui l'a créé).
- **Nouveaux devoirs** : bandeau « 🆕 X nouveaux devoirs depuis ta dernière visite » (jusqu'au clic sur « OK, vu »),
  message dans l'appli, et **notifications push** sur le téléphone **même appli fermée** : bouton
  « 🔔 Me prévenir quand quelqu'un ajoute un devoir » en haut de l'onglet Devoirs.
  Sur **iPhone** (iOS 16.4+), il faut d'abord ajouter le site à l'écran d'accueil (Partager → Sur l'écran d'accueil).
- **Date limite facultative** : sans date = devoir sans échéance (oral, à préparer…), rangé dans « Sans date limite » ;
  sans heure = « à faire dans la journée ».
- **Compléter la consigne** : sous chaque devoir (y compris les CC officiels), n'importe qui peut ajouter un complément
  (« le prof a dit 10 pages max »…). Chacun peut supprimer ses propres compléments.
- **Devoirs de groupe** : bouton **👥 Groupe** sur chaque devoir. On crée son groupe (ou on rejoint celui d'un camarade),
  on ajoute ses camarades d'un geste, et on dépose les **fichiers du groupe**. C'est tout : simple à comprendre.
  Filtre « Mes groupes » dans l'onglet Devoirs.

Fonctionne sur téléphone et sur ordinateur, avec un mode sombre (bouton ◐).

---

## Comment c'est construit (en 3 lignes)

1. **Site statique** (HTML / CSS / JavaScript, sans installation) hébergé gratuitement sur **GitHub Pages**.
2. **Supabase** (offre gratuite) stocke les livrables et les diffuse en temps réel ; le code promo est vérifié par la base.
3. Le **planning** est un simple fichier `data/planning.json`, généré automatiquement à partir du PDF de l'école.

### Les fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page (structure) |
| `css/style.css` | L'apparence (couleurs, mode sombre, mise en page téléphone/ordinateur) |
| `js/config.js` | **La configuration : les clés Supabase** |
| `js/donnees.js` | Lecture/écriture des livrables (Supabase ou mode démo) |
| `js/app.js` | Le fonctionnement de l'application |
| `data/planning.json` | Le planning importé du PDF (modifiable à la main) |
| `data/classe.json` | **Les prénoms de la classe** (liste de connexion et des groupes) |
| `outils/import_planning.py` | Le script qui transforme le PDF en `planning.json` |
| `supabase/schema.sql` | La création de la base (à coller une fois dans Supabase) |
| `supabase/notifications.sql` | Le déclencheur qui appelle la fonction d'envoi des notifications |
| `supabase/functions/notifier/` | La fonction Supabase qui envoie les notifications push |
| `sw.js`, `manifest.webmanifest`, `icons/` | Réception des notifications et installation sur l'écran d'accueil |

### Ce qui est public, ce qui ne l'est pas

| Élément | Public ? | Pourquoi ce n'est pas un problème |
|---|---|---|
| Le code du site, `planning.json` | Oui (dépôt GitHub public) | Pas de donnée sensible ; les noms des intervenants sont déjà sur le planning distribué |
| URL Supabase + clé **anon** (dans `config.js`) | Oui | Elle est faite pour être dans le navigateur. Elle ne permet que de **lire**. Les écritures directes sont interdites par la base |
| Pièces jointes, groupes | Oui, pour qui a le lien du site | Comme les livrables : à réserver aux documents de cours (pas de document personnel ou confidentiel). Ajout et suppression uniquement avec le code |
| **Code promo** | **Non** | Il n'est écrit nulle part dans le code. Il est stocké **haché** (illisible) dans une table que le site ne peut pas lire. Chaque écriture passe par une fonction de la base qui vérifie le code |
| Clé **service_role** de Supabase | **Non, jamais** | Elle donne tous les droits. Elle ne doit **jamais** être copiée dans le projet |
| Coches « fait » personnelles, prénom connecté, thème | Restent sur le téléphone de l'étudiant | Stockés dans le navigateur, jamais envoyés |

Aucun compte, aucun e-mail n'est demandé aux étudiants. Seul le **prénom** saisi librement apparaît dans l'historique.

> ⚠️ Limite à connaître : quiconque connaît le code promo peut modifier ou supprimer.
> La **corbeille** (restauration en un clic) et l'**historique** permettent de réparer une erreur ou un abus.
> Si le code fuite, changez-le (étape 4).

---

## 0. Tester dans le Codespace (sans base de données)

Tant que `js/config.js` n'est pas rempli, l'application tourne en **mode démo**. Un bandeau orange l'indique,
et les livrables sont enregistrés seulement dans votre navigateur. N'importe quel code promo est accepté.

1. Dans le terminal du Codespace, tapez :
   ```bash
   python3 -m http.server 8000
   ```
2. Une notification « Your application running on port 8000 is available » apparaît : cliquez sur **Open in Browser**.
   Sinon : onglet **PORTS** (à côté de TERMINAL), ligne **8000**, cliquez sur l'icône 🌐 (« Open in Browser »).
3. Pour l'ouvrir sur votre téléphone pendant les tests : onglet **PORTS**, clic droit sur 8000,
   **Port Visibility → Public**, puis copiez l'adresse (clic droit → *Copy Local Address*).
4. Pour arrêter le serveur : `Ctrl + C` dans le terminal.

> Ne double-cliquez pas sur `index.html` : le planning ne se charge pas sans serveur web.

---

## 1. Créer la base de données gratuite (Supabase)

1. Allez sur **https://supabase.com** → **Start your project** → connectez-vous avec **GitHub** (pas besoin d'un autre compte).
2. **New project** :
   - *Name* : `mdc-livrables`
   - *Database Password* : cliquez sur **Generate a password** et gardez-le dans un coin (il ne sert presque jamais)
   - *Region* : **Europe (Paris)** si elle est proposée, sinon une région Europe
   - Plan **Free** → **Create new project**. Attendez 1 à 2 minutes.
3. Menu de gauche → **SQL Editor** → **New query**. Ouvrez le fichier `supabase/schema.sql` du projet,
   copiez **tout** son contenu, collez-le, puis cliquez sur **Run**. Le message « Success » doit s'afficher.
   Cela crée les tables, les règles de sécurité et le temps réel. (Facultatif : `supabase/exemples.sql` ajoute 3 devoirs d'exemple.)
4. **Définir le code promo** : nouvelle requête SQL (**New query**), collez ceci en remplaçant `VOTRE_CODE`, puis **Run** :
   ```sql
   insert into public.config_privee (id, code_hash)
   values (1, extensions.crypt('VOTRE_CODE', extensions.gen_salt('bf')))
   on conflict (id) do update set code_hash = excluded.code_hash;
   ```
   > Ne collez **jamais** le code promo dans un fichier du projet : le dépôt GitHub est public.
   > Une fois la requête exécutée, vous pouvez effacer le texte de l'éditeur SQL.

> ℹ️ Les projets gratuits Supabase sont mis **en pause après une période sans aucune visite** (environ une semaine).
> Si l'appli affiche « Impossible de charger les livrables », ouvrez le tableau de bord Supabase et cliquez sur **Restore project**.
> Pendant l'année scolaire, les visites régulières de la promo suffisent à le garder actif.

---

## 2. Où coller les clés

1. Dans Supabase : bouton **Connect** en haut de la page, ou menu **Project Settings** → **API Keys** / **Data API**.
2. Copiez :
   - le **Project URL** (de la forme `https://xxxxxxxx.supabase.co`) ;
   - la clé **anon / public** (appelée aussi *publishable key*).
   - ❌ **PAS** la clé `service_role` / *secret*.
3. Dans le Codespace, ouvrez `js/config.js` et collez-les entre les guillemets :
   ```js
   SUPABASE_URL: "https://xxxxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```
4. Enregistrez (`Ctrl + S`) et rechargez la page : le bandeau « Mode démo » disparaît et les 3 exemples de la base s'affichent.

---

## 3. Mettre le site en ligne et obtenir le lien à partager

1. **Envoyer le code sur GitHub** : dans le Codespace, icône **Source Control** (3e icône à gauche) → écrivez un message
   (ex. « Mise en ligne ») → **Commit** → **Sync Changes** (ou **Push**).
   En ligne de commande, l'équivalent est :
   ```bash
   git add -A && git commit -m "Mise en ligne" && git push
   ```
2. **Rendre le dépôt public** (obligatoire pour GitHub Pages gratuit) : sur github.com, ouvrez le dépôt `mdc` →
   **Settings** → tout en bas, **Danger Zone** → **Change repository visibility** → **Public**.
3. **Activer GitHub Pages** : **Settings** → **Pages** → *Source* : **Deploy from a branch** →
   *Branch* : **main**, dossier **/ (root)** → **Save**.
4. Attendez 1 à 2 minutes et rechargez la page **Settings → Pages** : le lien apparaît en haut, de la forme
   **`https://VOTRE-PSEUDO-GITHUB.github.io/mdc/`**. C'est **le lien à partager** avec la promo
   (groupe WhatsApp, Teams…).
5. Sur téléphone, les étudiants peuvent faire **Partager → Sur l'écran d'accueil** pour l'avoir comme une appli.

À chaque nouveau *commit + push*, le site se met à jour tout seul en 1 à 2 minutes.
Si vous modifiez `css/` ou `js/`, augmentez le numéro `?v=2` (→ `?v=3`…) dans `index.html` :
cela oblige les téléphones à charger la nouvelle version au lieu de garder l'ancienne en mémoire.

---

## 4. Changer le code promo

Dans Supabase → **SQL Editor** → **New query**, collez ceci avec le nouveau code, puis **Run** :
```sql
update public.config_privee
set code_hash = extensions.crypt('NOUVEAU_CODE', extensions.gen_salt('bf'))
where id = 1;
```
Il n'y a rien à modifier sur le site. Les étudiants qui avaient l'ancien code devront saisir le nouveau
à leur prochaine modification : l'appli le leur redemande automatiquement.

---

## 5. Mettre à jour le planning quand l'école envoie un nouveau PDF

1. Glissez le nouveau PDF dans l'explorateur de fichiers du Codespace, à la racine du projet.
   Supprimez l'ancien PDF, ou donnez le nom exact du nouveau à l'étape 2.
2. Dans le terminal :
   ```bash
   pip install -r outils/requirements.txt      # seulement la première fois
   python3 outils/import_planning.py "NOM DU NOUVEAU FICHIER.pdf"
   ```
3. Lisez le **contrôle** affiché, par exemple :
   ```
   Jours d'école : 62   |   Créneaux : 124 (attendu : 124)
   Matières : 23   |   Évaluations / rendus : 25
   ```
   Comparez avec le PDF : nombre de lignes de dates, nombre de mentions rouges (CC, rendus). Un message ⚠ signale
   une ligne qui n'a pas pu être lue.
4. Vérifiez dans l'appli (étape 0), puis faites **Commit + Push** (étape 3.1). C'est en ligne.

**Bon à savoir :**
- Les couleurs des matières déjà connues sont **conservées** d'une version à l'autre.
- Les **CC** (texte rouge sous la date) deviennent automatiquement des livrables « Partiel / examen » marqués
  « Planning officiel », rattachés au créneau de la matière ce jour-là.
- Pour corriger un détail à la main (une salle, une heure…), modifiez directement `data/planning.json` avec l'éditeur.
  Attention : un nouvel import écrasera ces corrections.
- Les **livrables** ajoutés par les étudiants ne sont pas touchés par l'import : ils sont dans la base.

---

## Supprimer les 3 livrables d'exemple

Leurs titres commencent par **[Exemple]**.

- **Depuis l'appli** : bouton **Supprimer** sur chacun. Ils vont dans la corbeille, où on peut encore les restaurer.
- **Définitivement**, depuis Supabase → **SQL Editor** :
  ```sql
  delete from public.livrables where titre like '[Exemple]%';
  ```
- En **mode démo** (avant d'avoir branché Supabase), ils ne sont que dans votre navigateur.
  Utilisez le bouton Supprimer, ou videz les données du site dans le navigateur.

## Vider la corbeille définitivement

```sql
delete from public.livrables where supprime_le is not null and supprime_le < now() - interval '30 days';
```
(supprime ce qui est dans la corbeille depuis plus de 30 jours)

## Mode administrateur

Les prénoms listés dans `js/config.js` (`ADMINS: ["Farid"]`) peuvent activer le mode admin : 👤 en haut → code admin.
Le code admin est **différent** du code du groupe et vérifié par la base (choisir le prénom « Farid » ne suffit pas).
En mode admin (🛡️) : supprimer définitivement un devoir de la corbeille, **vider la corbeille**, supprimer n'importe quel
complément, retirer quelqu'un d'un groupe ou supprimer un groupe. Ces actions sont notées dans l'historique.

Définir ou changer le code admin (Supabase → SQL Editor) :
```sql
update public.config_privee set admin_hash = extensions.crypt('NOUVEAU_CODE_ADMIN', extensions.gen_salt('bf')) where id = 1;
```

## Notifications push : comment ça marche

1. Un étudiant touche 🔔 : son appareil s'abonne (table `abonnements_push`, illisible depuis le site).
2. Quand un devoir est ajouté, la base appelle la fonction Supabase **notifier** (déclencheur de `notifications.sql`).
3. La fonction envoie la notification à tous les abonnés, sauf à la personne qui a ajouté le devoir.

**Clés** : la clé publique VAPID est dans `js/config.js`. La clé privée et le secret ne sont **que** dans
Supabase (Edge Functions → notifier → Secrets) et dans le fichier local non publié `.cles-notifications.json`.

**Republier la fonction** après une modification (depuis le Codespace, une fois connecté avec `npx supabase@2.20.12 login`) :
```bash
npx supabase@2.20.12 functions deploy notifier --project-ref wfnddfzbsgkidvztukhk --no-verify-jwt --use-api
```
**Si ça ne marche plus** : Supabase → Edge Functions → notifier → **Logs** affiche les erreurs.

## Pièces jointes

- Dans le formulaire d'un livrable : **📎 Joindre un fichier** (PDF, Word, Excel, PowerPoint, images, zip…).
  **5 Mo maximum par fichier**, 10 fichiers maximum par livrable. En mode démo : 2 Mo, car le navigateur a peu de place.
- Les fichiers sont enregistrés **dans la base Supabase** (offre gratuite : 500 Mo au total, largement assez pour des consignes).
  Pour voir la place utilisée : Supabase → **Database** → **Usage**/**Reports**.
- Pour retirer un fichier : **Modifier** le livrable → **✕ Retirer** → **Enregistrer**.
- Pour faire de la place en fin d'année :
  ```sql
  delete from public.pieces_jointes where cree_le < now() - interval '6 months';
  ```

## Mettre à jour la base après une nouvelle version de l'appli

Si `supabase/schema.sql` a changé (nouvelles fonctions : groupes, pièces jointes…), **réexécutez-le en entier**
dans Supabase → **SQL Editor**. Il est prévu pour être relancé : les données existantes sont conservées,
et les exemples ne sont pas recréés.

## Ajouter ou corriger un prénom

Modifiez `data/classe.json` (un prénom par ligne entre guillemets, séparés par des virgules), puis faites Commit + Push.
Un étudiant absent de la liste peut aussi choisir « Autre prénom… » à la connexion.

## Questions fréquentes

- **« Mode démo » s'affiche alors que j'ai mis les clés** → vérifiez les guillemets dans `config.js`,
  enregistrez, puis rechargez la page en vidant le cache (`Ctrl + Maj + R`).
- **« Code promo incorrect » alors qu'il est bon** → refaites l'étape 1.4 (le code est sensible aux majuscules).
- **Un ajout n'apparaît pas chez les autres** → vérifiez que la dernière ligne « Temps réel » du `schema.sql`
  a bien été exécutée. Sinon, les autres le verront au prochain rechargement de la page.
- **Un téléchargement de pièce jointe ne démarre pas sur iPhone** → appuyez longuement sur le bouton 📎,
  ou ouvrez le site dans Safari plutôt que dans l'aperçu d'une autre appli (WhatsApp…).
