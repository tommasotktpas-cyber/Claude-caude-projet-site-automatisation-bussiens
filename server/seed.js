'use strict';
const { db, one, all, run, tx } = require('./db');
const { hashPassword, randomToken } = require('./auth');
const { createSalon } = require('./salons');
const T = require('./time');

const eur = (n) => Math.round(n * 100);
const wk = (days, open, close) => days.map((weekday) => ({ weekday, open, close }));
const TUE_SAT = [2, 3, 4, 5, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];

const SALONS = [
  {
    name: 'Maison Céleste', category: 'coiffure', city: 'Luxembourg', zip: 'L-1450', address: '12 Grand-Rue', accent: '#7c3aed',
    description: 'Salon de coiffure haut de gamme au cœur de la ville. Coupes sur-mesure, balayages naturels et soins profonds à la kératine, dans un cadre lumineux et apaisant.',
    deposit_percent: 20, hours: wk(TUE_SAT, '09:00', '19:00'),
    services: [
      { name: 'Coupe & brushing femme', category: 'Coupes', duration_min: 60, price_cents: eur(58) },
      { name: 'Coupe homme', category: 'Coupes', duration_min: 30, price_cents: eur(32) },
      { name: 'Coupe enfant (-12 ans)', category: 'Coupes', duration_min: 30, price_cents: eur(22) },
      { name: 'Balayage naturel', category: 'Couleur', duration_min: 150, price_cents: eur(145), description: 'Effet soleil, patine incluse.' },
      { name: 'Couleur racines', category: 'Couleur', duration_min: 90, price_cents: eur(68) },
      { name: 'Soin kératine', category: 'Soins', duration_min: 120, price_cents: eur(180) },
      { name: 'Chignon / coiffure événement', category: 'Coiffage', duration_min: 60, price_cents: eur(75) },
    ],
    staff: [
      { name: 'Camille Laurent', title: 'Directrice artistique' },
      { name: 'Hugo Martin', title: 'Coloriste', services: [0, 1, 3, 4, 5] },
      { name: 'Inès Moreau', title: 'Coiffeuse', services: [0, 1, 2, 6], hours: wk([3, 4, 5, 6], '10:00', '18:00') },
    ],
  },
  {
    name: 'Le Barbier du Quai', category: 'barbier', city: 'Luxembourg', zip: 'L-2240', address: '3 Rue Notre-Dame', accent: '#b45309',
    description: 'Barbier traditionnel : taille de barbe à l’ancienne, rasage serviette chaude, dégradés précis. Café offert.',
    hours: wk(MON_SAT, '09:30', '20:00'),
    services: [
      { name: 'Coupe dégradé', category: 'Coupes', duration_min: 30, price_cents: eur(28) },
      { name: 'Taille de barbe', category: 'Barbe', duration_min: 20, price_cents: eur(18) },
      { name: 'Coupe + barbe', category: 'Formules', duration_min: 45, price_cents: eur(42) },
      { name: 'Rasage traditionnel serviette chaude', category: 'Barbe', duration_min: 30, price_cents: eur(30) },
    ],
    staff: [{ name: 'Karim Benali', title: 'Maître barbier' }, { name: 'Lucas Weber', title: 'Barbier' }],
  },
  {
    name: 'Atelier Nacre', category: 'ongles', city: 'Esch-sur-Alzette', zip: 'L-4002', address: '45 Rue de l’Alzette', accent: '#db2777',
    description: 'Onglerie & nail art. Semi-permanent, gainage, extensions gel et soins des mains, avec des produits vegan.',
    hours: wk(TUE_SAT, '10:00', '19:00'),
    services: [
      { name: 'Semi-permanent mains', category: 'Mains', duration_min: 45, price_cents: eur(38) },
      { name: 'Gainage + semi', category: 'Mains', duration_min: 75, price_cents: eur(55) },
      { name: 'Extensions gel', category: 'Mains', duration_min: 120, price_cents: eur(85) },
      { name: 'Beauté des pieds + semi', category: 'Pieds', duration_min: 60, price_cents: eur(48) },
      { name: 'Nail art (par ongle)', category: 'Options', duration_min: 10, price_cents: eur(4) },
    ],
    staff: [{ name: 'Sofia Ricci', title: 'Prothésiste ongulaire' }, { name: 'Léa Schmit', title: 'Nail artist' }],
  },
  {
    name: 'Spa Altitude', category: 'spa', city: 'Bruxelles', zip: '1050', address: '210 Avenue Louise', accent: '#0d9488',
    description: 'Spa urbain : massages, soins du visage experts et rituels hammam. Une parenthèse de calme en plein Ixelles.',
    deposit_percent: 30, hours: wk([1, 2, 3, 4, 5, 6, 0], '10:00', '21:00'),
    services: [
      { name: 'Massage relaxant 60 min', category: 'Massages', duration_min: 60, price_cents: eur(85) },
      { name: 'Massage deep tissue 60 min', category: 'Massages', duration_min: 60, price_cents: eur(95) },
      { name: 'Massage duo 60 min', category: 'Massages', duration_min: 60, price_cents: eur(170) },
      { name: 'Soin visage éclat', category: 'Visage', duration_min: 50, price_cents: eur(79) },
      { name: 'Rituel hammam & gommage', category: 'Rituels', duration_min: 90, price_cents: eur(120) },
    ],
    staff: [{ name: 'Nora El Amrani', title: 'Praticienne bien-être' }, { name: 'Julien Dubois', title: 'Masseur' }, { name: 'Emma Peeters', title: 'Esthéticienne', services: [3, 4] }],
  },
  {
    name: 'Institut Belle Rive', category: 'esthetique', city: 'Liège', zip: '4000', address: '8 Quai de la Batte', accent: '#e11d48',
    description: 'Institut de beauté : épilations, soins visage, rehaussement de cils et maquillage. Accueil chaleureux depuis 2012.',
    hours: wk(TUE_SAT, '09:00', '18:30'),
    services: [
      { name: 'Épilation sourcils', category: 'Épilations', duration_min: 15, price_cents: eur(12) },
      { name: 'Épilation jambes complètes', category: 'Épilations', duration_min: 45, price_cents: eur(35) },
      { name: 'Rehaussement de cils', category: 'Regard', duration_min: 60, price_cents: eur(59) },
      { name: 'Soin visage hydratant', category: 'Visage', duration_min: 60, price_cents: eur(65) },
      { name: 'Maquillage soirée', category: 'Maquillage', duration_min: 45, price_cents: eur(45) },
    ],
    staff: [{ name: 'Charlotte Lambert', title: 'Esthéticienne' }],
  },
  {
    name: 'Studio Mèche Rebelle', category: 'coiffure', city: 'Bruxelles', zip: '1000', address: '27 Rue Antoine Dansaert', accent: '#2563eb',
    description: 'Coiffure créative et engagée : couleurs vives, coupes texturées, coiffage afro et bouclé. Tarifs non genrés.',
    hours: wk([2, 3, 4, 5, 6], '10:00', '20:00'),
    services: [
      { name: 'Coupe cheveux courts', category: 'Coupes', duration_min: 45, price_cents: eur(40) },
      { name: 'Coupe cheveux longs', category: 'Coupes', duration_min: 60, price_cents: eur(55) },
      { name: 'Coupe boucles (méthode sèche)', category: 'Coupes', duration_min: 75, price_cents: eur(70) },
      { name: 'Couleur fantaisie', category: 'Couleur', duration_min: 180, price_cents: eur(160) },
    ],
    staff: [{ name: 'Alex Janssens', title: 'Coiffeur·euse' }, { name: 'Maya Diallo', title: 'Spécialiste boucles' }],
  },
  {
    name: 'Zen Massage Namur', category: 'massage', city: 'Namur', zip: '5000', address: '15 Rue de Fer', accent: '#16a34a',
    description: 'Massages bien-être : californien, suédois, réflexologie plantaire et massage femme enceinte.',
    hours: wk([1, 2, 3, 4, 5], '09:00', '20:00'),
    services: [
      { name: 'Massage californien 60 min', category: 'Massages', duration_min: 60, price_cents: eur(70) },
      { name: 'Massage suédois 90 min', category: 'Massages', duration_min: 90, price_cents: eur(95) },
      { name: 'Réflexologie plantaire', category: 'Réflexologie', duration_min: 45, price_cents: eur(50) },
    ],
    staff: [{ name: 'Thomas Lejeune', title: 'Praticien certifié' }],
  },
  {
    name: 'Barber Club Esch', category: 'barbier', city: 'Esch-sur-Alzette', zip: 'L-4040', address: '2 Place de la Résistance', accent: '#475569',
    description: 'Barber shop moderne, dégradés américains et designs. Sans rendez-vous le samedi matin, ou réservez en ligne.',
    hours: wk(MON_SAT, '10:00', '19:00'),
    services: [
      { name: 'Coupe', category: 'Coupes', duration_min: 30, price_cents: eur(25) },
      { name: 'Coupe + barbe', category: 'Formules', duration_min: 45, price_cents: eur(38) },
      { name: 'Design / motif', category: 'Options', duration_min: 15, price_cents: eur(10) },
    ],
    staff: [{ name: 'Dylan Ferreira', title: 'Barbier' }, { name: 'Marco Rossi', title: 'Barbier' }],
  },
];

const FIRST = ['Julie', 'Sarah', 'Thomas', 'Nicolas', 'Marie', 'Laura', 'Antoine', 'Chloé', 'Maxime', 'Léa', 'Paul', 'Manon', 'Lucie', 'Kevin', 'Anaïs', 'Mehdi', 'Elena', 'Noah', 'Zoé', 'Louis'];
const LAST = ['Muller', 'Schmit', 'Dupont', 'Leroy', 'Hoffmann', 'Weber', 'Klein', 'Martins', 'Bernard', 'Lemaire', 'Fontaine', 'Wagner', 'Petit', 'Girard', 'Simon'];
const COMMENTS = [
  [5, 'Accueil top, résultat exactement comme je voulais. Je reviens sans hésiter !'],
  [5, 'Très professionnel, à l’écoute et ponctuel. La réservation en ligne est super pratique.'],
  [4, 'Très bon moment, juste un peu d’attente à l’arrivée.'],
  [5, 'Le meilleur de la ville, rien à redire.'],
  [5, 'Ambiance agréable, conseils personnalisés. Merci !'],
  [4, 'Prestation de qualité, prix corrects.'],
  [3, 'Correct mais j’attendais un peu plus de conseils.'],
  [5, 'Rappel SMS la veille et possibilité de décaler en un clic, génial.'],
];

/** Deterministic PRNG so demo data is identical on every reset. */
function rng(seed) {
  let a = seed >>> 0; // mulberry32
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seed() {
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const today = T.now().date;

  tx(() => {
    const demoPassword = hashPassword('demo1234');
    SALONS.forEach((def, idx) => {
      const email = idx === 0 ? 'demo@lumea.app' : `pro${idx}@lumea.app`;
      const ownerId = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?, 'pro')", email, demoPassword, def.staff[0].name).lastInsertRowid);
      const salon = createSalon(ownerId, { ...def, email, phone: '+352 26 00 00 0' + idx });
      run('UPDATE salons SET plan = ? WHERE id = ?', idx === 0 ? 'pro' : ['pro', 'starter', 'business', 'trial'][idx % 4], salon.id);

      const services = all('SELECT * FROM services WHERE salon_id = ?', salon.id);
      const staff = all('SELECT id FROM staff WHERE salon_id = ?', salon.id).map((s) => s.id);
      const hours = all('SELECT * FROM opening_hours WHERE salon_id = ?', salon.id);
      const clients = Array.from({ length: 24 }, (_, i) => {
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const mail = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}.${i}@exemple.lu`;
        return Number(run('INSERT INTO clients (salon_id, name, email, phone, marketing_opt_in) VALUES (?,?,?,?,?)',
          salon.id, name, mail, `+352 691 ${String(100000 + Math.floor(rand() * 899999))}`, rand() > 0.5 ? 1 : 0).lastInsertRowid);
      });

      // Bookings from 60 days ago to 14 days ahead, without overlaps per staff member.
      const occupied = new Map();
      const density = idx === 0 ? 0.62 : 0.4;
      for (let d = -60; d <= 14; d++) {
        const date = T.addDays(today, d);
        const wd = T.weekday(date);
        const h = hours.find((x) => x.weekday === wd);
        if (!h) continue;
        for (const sid of staff) {
          const offered = all('SELECT service_id FROM staff_services WHERE staff_id = ?', sid).map((r) => r.service_id);
          let t = T.toMin(h.open);
          while (t < T.toMin(h.close)) {
            const pickedId = pick(offered);
            const svc = services.find((s) => s.id === pickedId);
            if (!svc || t + svc.duration_min > T.toMin(h.close)) break;
            if (rand() < density) {
              const start = `${date}T${T.fromMin(t)}`;
              const end = T.addMinutes(start, svc.duration_min);
              const key = `${sid}${start}`;
              if (!occupied.has(key)) {
                occupied.set(key, 1);
                const past = d < 0 || (d === 0 && t < T.now().min);
                const r = rand();
                const status = past ? (r < 0.06 ? 'no_show' : r < 0.11 ? 'cancelled' : 'completed') : (r < 0.05 ? 'cancelled' : 'confirmed');
                const src = rand() < 0.72 ? 'online' : rand() < 0.5 ? 'widget' : 'pro';
                const createdAt = `${T.addDays(date, -Math.floor(rand() * 10) - 1)} 10:00:00`;
                const bid = Number(run(
                  `INSERT INTO bookings (salon_id, service_id, staff_id, client_id, start_at, end_at, status, price_cents, paid_cents, source, token,
                     reminder_sent, review_requested, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                  salon.id, svc.id, sid, pick(clients), start, end, status, svc.price_cents,
                  status === 'completed' ? svc.price_cents : 0, src, randomToken(), past ? 1 : 0, past ? 1 : 0, createdAt,
                ).lastInsertRowid);
                if (status === 'completed' && rand() < 0.3) {
                  const [rating, comment] = pick(COMMENTS);
                  const cname = one('SELECT c.name FROM clients c JOIN bookings b ON b.client_id = c.id WHERE b.id = ?', bid).name.split(' ');
                  run('INSERT INTO reviews (booking_id, salon_id, rating, comment, author_name, created_at) VALUES (?,?,?,?,?,?)',
                    bid, salon.id, rating, comment, `${cname[0]} ${cname[1][0]}.`, `${date} 20:00:00`);
                }
              }
            }
            t += svc.duration_min + (rand() < 0.4 ? 15 : 0);
          }
        }
      }
    });
    run('UPDATE clients SET created_at = (SELECT MIN(created_at) FROM bookings b WHERE b.client_id = clients.id) WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = clients.id)');
  });
}

function reset() {
  db.exec(`DELETE FROM notifications; DELETE FROM waitlist; DELETE FROM reviews; DELETE FROM bookings; DELETE FROM clients;
           DELETE FROM time_off; DELETE FROM staff_services; DELETE FROM staff_hours; DELETE FROM staff; DELETE FROM services;
           DELETE FROM opening_hours; DELETE FROM salons; DELETE FROM users WHERE role != 'admin';`);
}

if (require.main === module) {
  if (process.argv.includes('--reset')) reset();
  require('./index').ensureAdmin();
  seed();
  console.log('Démo prête : demo@lumea.app / demo1234');
}

module.exports = { seed, reset };
