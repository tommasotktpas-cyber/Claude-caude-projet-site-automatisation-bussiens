# Lumea — réservation en ligne et gestion de salon, sans commission

Lumea est une plateforme complète pour les **salons de coiffure, barbiers, instituts de beauté, ongleries, spas et masseurs** :

- une **marketplace client** (recherche par ville, catégorie, prestation, note, « ouvert maintenant ») ;
- une **page de réservation par salon**, intégrable sur n'importe quel site (widget iframe) ;
- un **back-office pro** : agenda multi-collaborateurs, CRM, prestations, équipe, avis, automatisations, statistiques, abonnement ;
- une **console d'administration** de la plateforme (MRR, salons, formules, visibilité).

Positionnement : faire mieux que les acteurs du marché (Salonkee, Planity, Treatwell, Fresha) sur les points qui font mal aux salons.

| Problème du marché | Réponse Lumea |
| --- | --- |
| Marketplaces : 20–25 % de commission sur chaque nouveau client | **0 % de commission**, abonnement fixe dès 24 €/mois |
| Logiciels classiques : 50–200 €/mois, engagement, formation | Mise en route en 10 minutes, sans engagement, 30 jours offerts |
| No-shows | **Acompte configurable**, rappel automatique J-1 avec lien de déplacement |
| Créneaux perdus après une annulation | **Liste d'attente** prévenue automatiquement |
| Clients obligés de créer un compte / d'appeler | **Lien magique** : déplacer, annuler, noter sans compte |
| Faux avis | Avis possibles **uniquement après un rendez-vous honoré** |
| Écosystème fermé | **Webhooks** (Make, Zapier, n8n, Twilio, Brevo), flux **iCal**, export CSV |

---

## Démarrage rapide

Prérequis : **Node.js 22.13 ou plus** (SQLite est intégré à Node, aucune base externe).

```bash
npm install
npm start            # http://localhost:3000
```

Au premier lancement, une base de démonstration est créée (8 salons, ~4 000 rendez-vous, avis, clients).

| Accès | Identifiants |
| --- | --- |
| Espace pro (salon « Maison Céleste ») | `demo@lumea.app` / `demo1234` |
| Autres salons de démo | `pro1@lumea.app` … `pro7@lumea.app` / `demo1234` |
| Administration plateforme | `admin@lumea.app` / `admin-lumea-2026` (à changer via `ADMIN_PASSWORD`) |

Autres commandes :

```bash
npm run dev          # rechargement automatique
npm run seed         # réinitialise les données de démonstration
npm test             # tests d'intégration de l'API (9 scénarios)
```

## Pages

| URL | Rôle |
| --- | --- |
| `/` | Marketplace : recherche, filtres, liste des salons |
| `/salon.html?s=<slug>` | Page salon + tunnel de réservation (ajoutez `&embed=1` pour le widget) |
| `/rdv.html?t=<token>` | Gestion du rendez-vous par le client (déplacer, annuler, agenda .ics, avis) |
| `/pro` | Page commerciale B2B : fonctionnalités, comparatif, simulateur de commission, tarifs, FAQ |
| `/connexion` | Connexion, création de compte client, inscription d'un salon |
| `/compte` | Espace client : rendez-vous, historique, points fidélité |
| `/app` | Back-office pro |
| `/admin` | Console d'administration de la plateforme |
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
| `APP_TZ` | Fuseau horaire des salons (défaut `Europe/Luxembourg`) |
| `SESSION_SECRET` | Secret de session (sinon généré dans `data/secret`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte administrateur créé au premier démarrage |
| `NOTIFY_WEBHOOK_URL` | Webhook qui reçoit chaque notification |
| `DB_PATH` | Fichier SQLite (défaut `data/lumea.db`) |
| `SEED_DEMO` | `0` pour démarrer sur une base vide |

## Déploiement

```bash
docker build -t lumea .
docker run -d -p 3000:3000 -v lumea-data:/app/data \
  -e APP_URL=https://reservation.mondomaine.com -e ADMIN_PASSWORD='…' -e SEED_DEMO=0 lumea
```

Fonctionne sur tout hébergeur Node avec disque persistant (Render, Railway, Fly.io, VPS). Sauvegardez le dossier `data/`.

## Avant une commercialisation — ce qu'il reste à brancher

Ce dépôt est un produit fonctionnel de bout en bout ; trois intégrations dépendent de vos comptes fournisseurs :

1. **Paiements** : l'acompte est enregistré mais pas encaissé. Brancher Stripe Checkout (ou Payment Intents) dans `createBooking` (`server/bookings.js`) et Stripe Billing dans `POST /api/pro/plan` (`server/routes/pro.js`).
2. **Envoi réel des e-mails / SMS** : connecter `NOTIFY_WEBHOOK_URL` à Brevo, Postmark ou Twilio (directement ou via Make / n8n).
3. **Juridique** : compléter `public/mentions.html` (éditeur, hébergeur, DPO) et faire valider CGU / CGV.

Pour une montée en charge importante (plusieurs milliers de salons), migrer SQLite vers PostgreSQL : les requêtes SQL sont standard et centralisées dans `server/`.

## Structure

```
server/
  index.js          application Express, flux iCal, démarrage
  db.js             schéma SQLite et helpers
  auth.js           mots de passe, sessions, rôles, rate limiting
  availability.js   moteur de créneaux
  bookings.js       création / annulation / déplacement / statuts
  notifications.js  modèles de messages, webhook, automatisations
  salons.js plans.js ics.js time.js seed.js
  routes/           public, auth, pro, admin
public/             pages HTML, css/app.css, js/common.js, js/app.js (back-office)
tests/api.test.js   tests d'intégration
```
