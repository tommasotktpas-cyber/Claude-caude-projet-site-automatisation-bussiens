'use strict';
// Public pricing (CHF, per establishment). 0 % commission on every plan —
// the core argument against marketplaces (Treatwell 25 %, Fresha 20 %).
const CURRENCY = process.env.CURRENCY || 'CHF';

const PLANS = [
  {
    id: 'essentiel', name: 'Essentiel', price: 100, max_staff: 0,
    tagline: 'Tout pour gérer et remplir votre salon.',
    features: [
      'Réservation en ligne 24/7, 0 % de commission',
      'Agenda multi-collaborateurs illimité',
      'Rappels automatiques, liste d’attente, avis vérifiés',
      'Acompte anti no-show & programme de fidélité',
      'Fichier clients, statistiques, export',
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

const planById = (id) => PLANS.find((p) => p.id === id);

module.exports = { PLANS, TEMPLATE_PRICING, CURRENCY, planById };
