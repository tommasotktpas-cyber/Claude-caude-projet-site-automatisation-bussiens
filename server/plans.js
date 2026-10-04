'use strict';
// Public pricing. 0 % commission on every plan — the core argument against marketplaces (Treatwell 25 %, Fresha 20 %).
const PLANS = [
  { id: 'starter', name: 'Solo', price_eur: 24, max_staff: 1, features: ['Réservation en ligne 24/7', 'Agenda & fiches clients', 'Rappels e-mail automatiques', 'Page salon + widget site web'] },
  { id: 'pro', name: 'Pro', price_eur: 49, max_staff: 8, popular: true, features: ['Tout Solo', "Jusqu'à 8 collaborateurs", 'Acompte anti no-show', "Liste d'attente intelligente", 'Statistiques avancées', 'Programme de fidélité'] },
  { id: 'business', name: 'Business', price_eur: 89, max_staff: 0, features: ['Tout Pro', 'Collaborateurs illimités', 'Webhooks & automatisations (Zapier, Make, n8n)', 'Export comptable', 'Support prioritaire'] },
];
module.exports = { PLANS };
