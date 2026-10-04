'use strict';
// Public pricing (CHF, per establishment). 0 % commission on every plan —
// the core argument against marketplaces (Treatwell 25 %, Fresha 20 %).
const CURRENCY = process.env.CURRENCY || 'CHF';

const PLANS = [
  {
    id: 'essentiel', name: 'Essentiel', price: 100, max_staff: 0,
    tagline: 'Tout pour gérer et remplir votre salon.',
    features: [
      'Réservation en ligne 24/7, sans commission sur les rendez-vous',
      'Agenda multi-collaborateurs illimité',
      'Rappels automatiques, liste d’attente, avis vérifiés',
      'Acompte anti no-show & programme de fidélité',
      'Fichier clients, statistiques, export',
      'Studio coupe 3D à la réservation',
      'Caisse, stock et cartes cadeaux',
      'Dernière minute, rappels de retour, anniversaires',
      'Accès individuel pour chaque employé',
      'Votre propre site (modèle Classique inclus)',
      'Modèles premium : 300 CHF une fois ou 20 CHF / mois',
    ],
  },
  {
    id: 'premium', name: 'Premium', price: 158, max_staff: 0, popular: true,
    tagline: 'Un site personnalisé à votre image, en plus.',
    features: [
      'Tout Essentiel',
      'Site personnalisé conçu pour vous par notre équipe',
      'Tous les modèles premium inclus',
      'Votre nom de domaine (www.votre-salon.ch)',
      'Personnalisation avancée (CSS, sections)',
      'Support prioritaire',
    ],
  },
];

/** Premium templates on the Essentiel plan. */
const TEMPLATE_PRICING = { once: 300, monthly: 20 };

/** Website made for the salon by a designer (one-off), available on every plan. */
const CUSTOM_SITE_PRICE = Number(process.env.CUSTOM_SITE_PRICE || 250);

/** Sponsored placement on the marketplace home page (never ads on the salons' own pages). */
const BOOST_PRICE = Number(process.env.BOOST_PRICE || 29);

/**
 * Platform fee on online payments (deposits, gift cards), in percent. 0 by default:
 * "0 % commission" is the core sales argument. The public pages adapt their wording to this value.
 */
const PLATFORM_FEE_PERCENT = Math.max(0, Math.min(20, Number(process.env.PLATFORM_FEE_PERCENT || 0)));
const platformFee = (amountCents) => Math.round((amountCents * PLATFORM_FEE_PERCENT) / 100);

const planById = (id) => PLANS.find((p) => p.id === id);

module.exports = { PLANS, TEMPLATE_PRICING, CURRENCY, CUSTOM_SITE_PRICE, BOOST_PRICE, PLATFORM_FEE_PERCENT, platformFee, planById };
