# Lumea — réservation en ligne et gestion de salon, sans commission

Lumea est une plateforme complète pour les **salons de coiffure, barbiers, instituts de beauté, ongleries, spas et masseurs** :

- une **marketplace client** (recherche par ville, catégorie, prestation, note, « ouvert maintenant ») ;
- **un site internet propre à chaque salon** (`/s/<slug>` ou son propre domaine), avec **10 modèles** et un éditeur visuel ;
- une **page de réservation par salon**, intégrable sur n'importe quel site (widget iframe) ;
- un **back-office pro** : agenda multi-collaborateurs, CRM, prestations, équipe, avis, automatisations, statistiques, abonnement ;
- une **console d'administration** de la plateforme (MRR, salons, formules, visibilité).

Positionnement : faire mieux que les acteurs du marché (Salonkee, Planity, Treatwell, Fresha) sur les points qui font mal aux salons.

| Problème du marché | Réponse Lumea |
| --- | --- |
| Marketplaces : 20–25 % de commission sur chaque nouveau client | **0 % de commission**, abonnement fixe |
| Logiciels classiques : modules payants, engagement, pas de site | Tout inclus + **site internet du salon**, sans engagement, 30 jours offerts |
| No-shows | **Acompte configurable**, rappel automatique J-1 avec lien de déplacement |
| Créneaux perdus après une annulation | **Liste d'attente** prévenue automatiquement |
| Clients obligés de créer un compte / d'appeler | **Lien magique** : déplacer, annuler, noter sans compte |
| Faux avis | Avis possibles **uniquement après un rendez-vous honoré** |
| Écosystème fermé | **Webhooks** (Make, Zapier, n8n, Twilio, Brevo), flux **iCal**, export CSV |

---

## Offre commerciale (CHF, par établissement)

| Formule | Prix | Contenu |
| --- | --- | --- |
| **Essentiel** | 100 CHF / mois | Toute la gestion (agenda, réservation, rappels, CRM, stats, avis, fidélité…) + son propre site avec le modèle **Classique** |
| **Premium** | 158 CHF / mois | Tout Essentiel + **site personnalisé** par votre équipe (demande de design suivie dans l'admin), **tous les modèles**, **nom de domaine propre**, CSS personnalisé, suppression de la mention Lumea |
| **Modèle premium** (option Essentiel) | 300 CHF une fois **ou** 20 CHF / mois | Débloque un des 9 modèles premium ; à la fin d'une location, le site repasse automatiquement sur Classique |

Prix modifiables dans `server/plans.js`. Devise : variable `CURRENCY` (CHF par défaut).

### Les 10 modèles de site

Classique (gratuit), Élégance, Minimal, Urbain, Zen, Pop, Nature, Riviera, Atelier, Néon — définis dans `server/templates.js`
(polices, palette, mise en page du hero, style de la carte des prestations). Ajouter un modèle = ajouter un objet au tableau `TEMPLATES`.
Chaque site est rendu côté serveur (rapide, référencement Google avec données structurées `BeautySalon`) et intègre la réservation dans une fenêtre, aux couleurs du site.

Dans l'espace pro, **Mon site** permet de : choisir et prévisualiser tous les modèles avec ses propres données, acheter / louer un modèle, éditer textes, photos, galerie, réseaux sociaux, couleur, sections, publier, et en Premium : domaine, CSS, marque blanche, demande de site sur mesure.

## Ce qui fait la différence auprès des salons

| Fonction | Où | Détail |
| --- | --- | --- |
| **Studio coupe 3D** | Réservation (coiffure / barbier) | Le client règle sa coupe sur une tête 3D (15 coupes, longueurs en cm, dégradé, barbe, couleur, teint). Le salon choisit les coupes qu'il propose (*Paramètres › Studio coupe 3D*) et active le studio par prestation. La fiche (image + longueurs + précisions) arrive dans l'agenda. Moteur : `public/js/studio3d.js` (three.js servi localement). |
| **Caisse** | *Caisse* | Encaissement d'un RDV ou vente de passage, prestations (prix ajustable), produits, remise, pourboire, espèces avec rendu, carte, TWINT, carte cadeau, acompte en ligne déduit. Journée, clôture de caisse, export comptable CSV, annulation. |
| **Stock** | *Stock* | Produits, prix d'achat / marge, alertes de rupture, réassort, mouvements tracés. |
| **Cartes cadeaux** | `/carte-cadeau.html?s=<slug>` | Achat en ligne (Stripe sur le compte du salon) ou en caisse, code `LUM-XXXX-XXXX`, solde utilisable en plusieurs fois, valable 2 ans. |
| **Dernière minute** | *Paramètres* | Remise automatique sur les créneaux libres dans les N prochaines heures, visible sur la marketplace et les créneaux. |
| **C'est l'heure de revenir** | *Prestations* | Rappel X semaines après une visite (valeurs par défaut : coupe 5, barbe 3, ongles 3, couleur 7), seulement si le client n'a rien réservé depuis. |
| **Anniversaire** | *Paramètres* | Message avec l'offre du salon le jour J (date demandée, facultative, à la réservation). |
| **Petites attentions** | Partout | « Dispo aujourd'hui à 14h30 » sur la marketplace, « Reprendre ce rendez-vous » en un clic, confettis à la confirmation. |

## Démarrage rapide

Prérequis : **Node.js 22.13 ou plus** (SQLite est intégré à Node, aucune base externe).

```bash
npm install
npm start            # http://localhost:3000
```

Au premier lancement, une base de démonstration est créée : 8 salons suisses (Genève, Lausanne, Fribourg, Montreux, Neuchâtel, Sion), chacun avec son site et un modèle différent, ~4 000 rendez-vous, avis et clients.

| Accès | Identifiants |
| --- | --- |
| Espace pro — Maison Céleste (Premium, modèle Élégance) | `demo@lumea.app` / `demo1234` |
| Espace pro — Le Barbier du Quai (Essentiel + modèle Urbain acheté) | `pro1@lumea.app` / `demo1234` |
| Employé de Maison Céleste (voit seulement son agenda) | `hugo@lumea.app` / `demo1234` |
| Autres salons de démo | `pro2@lumea.app` … `pro7@lumea.app` / `demo1234` |
| Administration plateforme | `admin@lumea.app` / `admin-lumea-2026` (à changer via `ADMIN_PASSWORD`) |

Autres commandes :

```bash
npm run dev          # rechargement automatique
npm run seed         # réinitialise les données de démonstration
npm test             # tests d'intégration (20 scénarios, dont paiements Stripe simulés)
```

## Pages

| URL | Rôle |
| --- | --- |
| `/` | Marketplace : recherche, filtres, liste des salons |
| `/s/<slug>` | **Site internet du salon** (ou `https://son-domaine.ch/` en Premium) |
| `/modeles/<id>` | Démonstration publique d'un modèle de site |
| `/salon.html?s=<slug>` | Page salon + tunnel de réservation (ajoutez `&embed=1` pour le widget) |
| `/rdv.html?t=<token>` | Gestion du rendez-vous par le client (déplacer, annuler, agenda .ics, avis) |
| `/pro` | Page commerciale B2B : fonctionnalités, comparatif, simulateur de commission, tarifs, FAQ |
| `/connexion` | Connexion, création de compte client, inscription d'un salon |
| `/compte` | Espace client : rendez-vous, historique, points fidélité |
| `/app` | Back-office pro |
| `/admin` | Console d'administration : revenus (abonnements + modèles), salons, formules, sites, demandes de design sur mesure |
| `/mentions` | Mentions légales, CGU, RGPD (modèle à compléter) |

## Fonctionnalités détaillées

**Moteur de disponibilités** (`server/availability.js`)
- Intersection horaires du salon × horaires de chaque collaborateur, moins les rendez-vous, les absences et le temps de battement.
- Pas des créneaux, délai minimum de réservation, horizon de réservation configurables.
- « Sans préférence » : le rendez-vous est attribué au collaborateur le moins chargé de la journée.
- Réservation **atomique** (transaction `BEGIN IMMEDIATE`) : impossible de réserver deux fois le même créneau.

**Automatisations** (`server/notifications.js`, tâche toutes les minutes)
- Confirmation (e-mail + SMS), alerte au salon, rappel 24 h avant, demande d'avis 2 h après, déplacement, annulation, liste d'attente.
- Chaque message est journalisé (visible dans le back-office) et envoyé en JSON au webhook `NOTIFY_WEBHOOK_URL`.

**Back-office**
- Tableau de bord : CA, taux de remplissage, panier moyen, part de réservations en ligne, taux de no-show, CA à venir, graphique quotidien, top prestations, performance par collaborateur.
- Agenda jour (colonnes par collaborateur, création par clic sur un créneau) et semaine ; encaissement, absent, annulation, déplacement, notes.
- CRM : recherche, visites, dépenses, absences, fiche technique privée, export CSV (protégé contre l'injection de formules).
- Prestations (archivage automatique si déjà réservées), équipe (horaires, prestations, absences), réponses publiques aux avis.
- Paramètres : identité, couleur de marque, acompte, délai d'annulation, battement, horaires, lien de partage, widget, flux iCal.
- Limites par formule (nombre de collaborateurs) appliquées côté serveur.

**Sécurité**
- Mots de passe hachés en scrypt, sessions signées HMAC en cookie `HttpOnly; SameSite=Lax` (`Secure` en production).
- Cloisonnement strict des données par salon (vérifié par les tests), limitation de débit sur l'authentification et la réservation.
- Échappement systématique côté client, en-têtes `nosniff` / `X-Frame-Options` (sauf mode widget).

## Configuration

Copiez `.env.example` et renseignez les variables (via votre hébergeur ou `node --env-file=.env server/index.js`).

| Variable | Rôle |
| --- | --- |
| `APP_URL` | URL publique utilisée dans les e-mails, le widget et le flux iCal |
| `APP_TZ` | Fuseau horaire des salons (défaut `Europe/Zurich`) |
| `CURRENCY` | Devise affichée (défaut `CHF`) |
| `SESSION_SECRET` | Secret de session (sinon généré dans `data/secret`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte administrateur créé au premier démarrage |
| `STRIPE_SECRET_KEY` | Active les paiements réels (sinon mode démonstration) |
| `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET` | Secrets de signature des deux webhooks Stripe |
| `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME`, `SMS_SENDER` | Envoi réel des e-mails et SMS |
| `NOTIFY_WEBHOOK_URL` | Webhook qui reçoit aussi chaque notification (Make, Zapier, n8n) |
| `DB_PATH` | Fichier SQLite (défaut `data/lumea.db`) |
| `SEED_DEMO` | `0` pour démarrer sur une base vide |

## Déploiement

```bash
docker build -t lumea .
docker run -d -p 3000:3000 -v lumea-data:/app/data \
  -e APP_URL=https://reservation.mondomaine.com -e ADMIN_PASSWORD='…' -e SEED_DEMO=0 lumea
```

Fonctionne sur tout hébergeur Node avec disque persistant (Render, Railway, Fly.io, VPS). Sauvegardez le dossier `data/`.

**Domaines des salons (Premium)** : le salon crée un CNAME `www` vers votre serveur et saisit son domaine dans « Mon site ». Il faut aussi un certificat HTTPS pour ce domaine : utilisez un reverse-proxy à certificats automatiques (Caddy « on-demand TLS », Cloudflare for SaaS, ou Render / Fly custom domains).

## Mise en production — étapes à suivre

Tout le code est prêt ; il reste à créer vos comptes chez les fournisseurs et à renseigner les clés.

### 1. Stripe (paiements) — environ 1 h

1. Créez un compte sur stripe.com avec votre entreprise suisse (devise CHF), activez **TWINT** dans *Paramètres › Moyens de paiement*.
2. Activez **Connect** (*Connect › Démarrer*), type de compte **Express**. C'est ce qui permet aux salons d'encaisser les acomptes **directement sur leur compte** : Lumea ne prend **aucune commission**, le salon paie uniquement les frais Stripe (≈ 2,9 % + 0.30 CHF par carte, ≈ 1,3 % TWINT).
3. Activez le **portail client** (*Paramètres › Billing › Portail client*) : vos salons y gèrent carte, factures et résiliation.
4. Créez deux webhooks vers `https://VOTRE-DOMAINE/api/stripe/webhook` :
   - « Votre compte » : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.deleted` → secret dans `STRIPE_WEBHOOK_SECRET` ;
   - « Comptes connectés » : `checkout.session.completed`, `account.updated` → secret dans `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. Renseignez `STRIPE_SECRET_KEY` (commencez par la clé **test** `sk_test_…` pour tout essayer avec la carte 4242 4242 4242 4242).

Ce qui se passe ensuite automatiquement :

| Action | Résultat |
| --- | --- |
| Le salon choisit Essentiel / Premium | Paiement Stripe Checkout, abonnement mensuel, formule activée au paiement |
| Le salon achète / loue un modèle | 300 CHF une fois ou 20 CHF/mois ; une location résiliée reste active jusqu'à la fin du mois payé |
| Abonnement impayé ou résilié | Réservation en ligne en pause, données conservées, bandeau « Réactiver » dans l'espace pro |
| Le salon connecte Stripe (Paramètres › Paiements en ligne) | Les acomptes deviennent réels |
| Un client réserve avec acompte | Créneau bloqué 30 min, paiement (carte, TWINT, Apple / Google Pay), confirmation envoyée après paiement ; sinon le créneau est libéré |
| Le client annule dans les délais / le salon annule | Acompte remboursé automatiquement |

Sans `STRIPE_SECRET_KEY`, la plateforme reste en **mode démonstration** : tout fonctionne, rien n'est encaissé.

### 2. Brevo (e-mails et SMS) — environ 30 min

1. Créez un compte sur brevo.com, validez votre domaine d'envoi (enregistrements DNS SPF / DKIM fournis par Brevo).
2. Renseignez `BREVO_API_KEY`, `MAIL_FROM` (ex. `rendez-vous@votre-domaine.ch`), `MAIL_FROM_NAME`, et pour les SMS `SMS_SENDER` (11 caractères max) après avoir acheté des crédits SMS.
3. Les e-mails partent au nom du salon (réponse directe au salon) ; les numéros suisses (`079 …`) sont convertis automatiquement au format international.

`NOTIFY_WEBHOOK_URL` reste disponible pour brancher Make, Zapier ou n8n en plus.

### 3. Juridique

Compléter `public/mentions.html` (éditeur, hébergeur, contact protection des données) et faire valider CGU / CGV par un juriste. Ajouter Stripe et Brevo à la liste des sous-traitants.

### 4. Montée en charge

SQLite tient confortablement plusieurs centaines de salons. Au-delà de quelques milliers, migrer vers PostgreSQL : les requêtes SQL sont standard et centralisées dans `server/`.

## Changer de logiciel (argument de vente)

- **Import des clients** : *Clients › Importer* accepte les exports CSV de Salonkee, Planity, Excel ou Google Contacts (colonnes détectées automatiquement : nom / prénom, e-mail, téléphone / natel, notes ; doublons ignorés).
- **Comptes employés** : *Équipe › Donner un accès* envoie une invitation ; l'employé voit uniquement son agenda et les fiches clients.
- **Page commerciale** : calculateur « Combien payez-vous aujourd'hui ? » (158 CHF par défaut) → économie avec Essentiel, ou même prix avec le site en plus en Premium.

## Structure

```
server/
  index.js          application Express, flux iCal, démarrage
  db.js             schéma SQLite et helpers
  auth.js           mots de passe, sessions, rôles, rate limiting
  availability.js   moteur de créneaux
  bookings.js       création / annulation / déplacement / statuts
  notifications.js  modèles de messages, webhook, automatisations
  payments.js       appels Stripe (Checkout, Connect, remboursements, webhooks signés)
  billing.js        effets des paiements : formules, licences, acomptes, fin d'essai
  mailer.js         envoi e-mail / SMS (Brevo) + webhook
  csv.js            lecture des fichiers clients importés
  styles.js         catalogue des coupes du Studio 3D, validation des fiches coupe
  pos.js            caisse, cartes cadeaux, clôture de caisse
  templates.js      les 10 modèles de site + moteur de rendu
  sites.js          règles d'accès (formule, licences), domaines, rendu des sites
  salons.js plans.js ics.js time.js seed.js
  routes/           public, auth, pro, admin
public/             pages HTML, css/app.css, js/common.js, js/app.js (back-office)
tests/api.test.js   tests d'intégration
```
