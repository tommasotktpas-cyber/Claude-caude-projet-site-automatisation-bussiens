# Mettre Lumea en ligne

## Où héberger ?

| Option | Coût | Verdict |
| --- | --- | --- |
| **Petit serveur VPS en Suisse** (Infomaniak, Exoscale) | env. 10–20 CHF/mois | **Recommandé.** Données en Suisse (argument LPD), disponibilité 99,9 %, IP fixe, sauvegardes de l’hébergeur. |
| VPS en Europe (Hetzner…) | env. 5–10 €/mois | Très bon rapport qualité/prix, données dans l’UE. |
| NAS à la maison | électricité | **Déconseillé pour la production** : coupure de courant ou d’Internet = salons injoignables, assistant téléphonique muet, webhooks Stripe et Twilio perdus ; IP souvent dynamique, port 443 parfois bloqué par l’opérateur. Parfait en revanche pour les **copies de sauvegarde**. |

Pour démarrer (jusqu’à plusieurs dizaines de salons), 2 vCPU / 4 Go de RAM / 40 Go de disque suffisent : SQLite tient sans problème quelques centaines de réservations par minute.

## Installation (≈ 20 minutes)

1. **Créer le serveur** : Ubuntu 24.04, ajoutez votre clé SSH.
2. **DNS** chez votre registraire : un enregistrement `A` pour `lumea.ch` et `www.lumea.ch` vers l’IP du serveur.
3. **Installer Docker** sur le serveur :
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
4. **Récupérer le code et configurer** :
   ```bash
   git clone <votre dépôt> lumea && cd lumea
   cp .env.example .env
   nano .env   # DOMAIN, ACME_EMAIL, APP_URL=https://lumea.ch, ADMIN_EMAIL, ADMIN_PASSWORD, SEED_DEMO=0, clés…
   ```
5. **Lancer** :
   ```bash
   docker compose up -d --build
   ```
   Caddy obtient seul le certificat HTTPS. Le site répond sur `https://lumea.ch`, l’admin sur `/admin`.
6. **Mettre à jour** plus tard : `git pull && docker compose up -d --build` (les données dans `./data` sont conservées).

## Domaines des salons (offre Premium)

Le salon ajoute chez son registraire un `CNAME www → lumea.ch` et saisit `www.son-salon.ch` dans « Mon site ».
Au premier visiteur, Caddy demande à Lumea si ce domaine appartient bien à un site Premium publié (`/api/internal/domain-check`), puis émet le certificat automatiquement. Aucune intervention de votre part.

## Sauvegardes

- Chaque nuit après 3 h, l’application écrit une copie cohérente de la base dans `data/backups/` (14 dernières conservées, réglable avec `BACKUP_KEEP`). Copie manuelle : `docker compose exec app npm run backup`.
- **Copiez ce dossier hors du serveur** (une sauvegarde sur le même disque ne protège de rien). Par exemple chaque nuit vers votre NAS ou un stockage cloud suisse avec `rclone` :
  ```bash
  # crontab -e sur le serveur
  30 3 * * * rclone sync /root/lumea/data/backups kdrive:lumea-backups
  ```
- Restaurer : arrêter (`docker compose stop app`), remplacer `data/lumea.db` par une copie, relancer.

## Services externes à brancher

| Service | Pour quoi | Variables |
| --- | --- | --- |
| Stripe | abonnements, acomptes, cartes cadeaux, frais plateforme | `STRIPE_*`, `PLATFORM_FEE_PERCENT` |
| Brevo | e-mails et SMS | `BREVO_API_KEY`, `MAIL_FROM`… |
| Anthropic (Claude) | assistant téléphonique, chat, tri des e-mails, résumés | `ANTHROPIC_API_KEY` |
| Twilio | numéro de téléphone de l’assistant IA | `TWILIO_AUTH_TOKEN` + webhook `https://lumea.ch/api/voice/incoming` |
| Google Cloud | « Continuer avec Google » + lecture Gmail | `GOOGLE_CLIENT_ID/SECRET` |
| Apple Developer | « Continuer avec Apple » | `APPLE_*` |
| Microsoft Entra | lecture Outlook | `MS_CLIENT_ID/SECRET` |

Chaque fonction se désactive proprement tant que sa clé est absente (mode démonstration ou message clair dans l’espace pro).

### Bon à savoir

- **Gmail** : l’accès en lecture est un scope « restreint ». Jusqu’à 100 comptes de test, il fonctionne tout de suite ; au-delà, Google exige une vérification de l’application avec un audit de sécurité annuel payant (plusieurs milliers de dollars). Outlook n’a pas cette contrainte. Prévoyez l’audit Gmail quand vous aurez assez de salons clients.
- **Assistant téléphonique** : coût par appel = minutes Twilio + reconnaissance vocale + appels à l’IA (quelques centimes à quelques dizaines de centimes par appel selon la durée). Facturez-le dans l’abonnement Premium ou en option.
- **Sécurité** : changez `ADMIN_PASSWORD` avant le premier démarrage, gardez `.env` hors de Git, activez la double authentification chez Stripe, Twilio et votre hébergeur.
