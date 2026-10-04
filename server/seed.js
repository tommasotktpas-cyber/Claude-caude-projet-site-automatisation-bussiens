'use strict';
const { db, one, all, run, tx } = require('./db');
const { hashPassword, randomToken } = require('./auth');
const { createSalon } = require('./salons');
const T = require('./time');
const { TEMPLATE_PRICING } = require('./plans');

// Swiss price level (CHF), rounded to the franc.
const eur = (n) => Math.round(n * 1.25) * 100;
const wk = (days, open, close) => days.map((weekday) => ({ weekday, open, close }));
const TUE_SAT = [2, 3, 4, 5, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];

const SALONS = [
  {
    name: 'Maison Céleste', category: 'coiffure', city: 'Genève', zip: '1204', address: 'Rue du Rhône 42', accent: '#7c3aed', template: 'elegance', plan: 'premium', phone: '+41 22 310 42 00',
    site_content: { announcement: 'Nouveau : rituel kératine bio — offert le diagnostic en octobre', about_title: 'Une maison de coiffure, pas une usine', socials: { instagram: '@maisonceleste.geneve', whatsapp: '+41 79 310 42 00' } },
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
    name: 'Le Barbier du Quai', category: 'barbier', city: 'Lausanne', zip: '1003', address: 'Rue de Bourg 8', accent: '#b45309', template: 'urbain', plan: 'essentiel', license: 'once', phone: '+41 21 320 08 08',
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
    name: 'Atelier Nacre', category: 'ongles', city: 'Fribourg', zip: '1700', address: 'Rue de Romont 15', accent: '#db2777', template: 'pop', plan: 'essentiel', license: 'monthly', phone: '+41 26 322 15 15',
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
    name: 'Spa Altitude', category: 'spa', city: 'Montreux', zip: '1820', address: 'Grand-Rue 70', accent: '#0d9488', template: 'zen', plan: 'premium', phone: '+41 21 963 70 70',
    description: 'Spa urbain : massages, soins du visage experts et rituels hammam. Une parenthèse de calme face au Léman.',
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
    name: 'Institut Belle Rive', category: 'esthetique', city: 'Neuchâtel', zip: '2000', address: 'Rue du Seyon 12', accent: '#e11d48', template: 'classique', plan: 'essentiel', phone: '+41 32 725 12 12',
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
    name: 'Studio Mèche Rebelle', category: 'coiffure', city: 'Genève', zip: '1205', address: 'Boulevard Carl-Vogt 33', accent: '#2563eb', template: 'minimal', plan: 'trial', phone: '+41 22 329 33 33',
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
    name: 'Zen Massage Sion', category: 'massage', city: 'Sion', zip: '1950', address: 'Rue du Grand-Pont 18', accent: '#16a34a', template: 'nature', plan: 'essentiel', license: 'once', phone: '+41 27 322 18 18',
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
    name: 'Barber Club Lausanne', category: 'barbier', city: 'Lausanne', zip: '1004', address: 'Avenue de France 5', accent: '#475569', template: 'neon', plan: 'trial', phone: '+41 21 624 05 05',
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
      const salon = createSalon(ownerId, { ...def, email });
      run('UPDATE salons SET plan = ? WHERE id = ?', def.plan, salon.id);
      if (def.license) {
        run('INSERT INTO template_licenses (salon_id, template, billing, price_chf) VALUES (?,?,?,?)', salon.id, def.template, def.license, TEMPLATE_PRICING[def.license]);
      }

      if (idx === 0) {
        // Demo employee account (sees only Hugo's agenda).
        const hugo = one("SELECT id FROM staff WHERE salon_id = ? AND name LIKE 'Hugo%'", salon.id);
        run("INSERT INTO users (email, password_hash, name, role, staff_id) VALUES ('hugo@lumea.app', ?, 'Hugo Martin', 'staff', ?)", demoPassword, hugo.id);
        // Hugo rents his chair (independent); Inès earns a share of her services.
        run("UPDATE staff SET employment = 'independant', pay_model = 'loyer', chair_rent_cents = 90000 WHERE id = ?", hugo.id);
        run("UPDATE staff SET pay_model = 'commission', rate_percent = 45 WHERE salon_id = ? AND name LIKE 'Inès%'", salon.id);
      }
      const services = all('SELECT * FROM services WHERE salon_id = ?', salon.id);
      const staff = all('SELECT id FROM staff WHERE salon_id = ?', salon.id).map((s) => s.id);
      const hours = all('SELECT * FROM opening_hours WHERE salon_id = ?', salon.id);
      const clients = Array.from({ length: 24 }, (_, i) => {
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const mail = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}.${i}@exemple.ch`;
        return Number(run('INSERT INTO clients (salon_id, name, email, phone, marketing_opt_in) VALUES (?,?,?,?,?)',
          salon.id, name, mail, `+41 79 ${String(100 + Math.floor(rand() * 899))} ${String(10 + Math.floor(rand() * 89))} ${String(10 + Math.floor(rand() * 89))}`, rand() > 0.5 ? 1 : 0).lastInsertRowid);
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
    // Retail products, a few gift cards, and till history for the demo salon.
    const PRODUCTS = {
      coiffure: [['Shampoing nutritif 250 ml', 'Kérastase', 34, 17], ['Masque réparateur', 'Kérastase', 48, 24], ['Huile sublimatrice', 'Moroccanoil', 42, 21], ['Laque fixation forte', 'L’Oréal Pro', 22, 9]],
      barbier: [['Huile à barbe', 'Proraso', 24, 10], ['Cire coiffante mate', 'Reuzel', 26, 12], ['Baume après-rasage', 'Proraso', 19, 8]],
      ongles: [['Huile cuticules', 'OPI', 18, 7], ['Vernis longue tenue', 'OPI', 21, 9]],
      spa: [['Huile de massage 100 ml', 'Cinq Mondes', 39, 18], ['Crème visage hydratante', 'Decléor', 65, 30]],
      esthetique: [['Sérum éclat', 'Decléor', 59, 27], ['Crème mains', 'Nuxe', 16, 7]],
      massage: [['Bougie de massage', 'Lumea', 29, 11]],
    };
    for (const salon of all('SELECT id, category FROM salons')) {
      for (const [name, brand, price, cost] of PRODUCTS[salon.category] || []) {
        const stock = Math.floor(rand() * 14);
        run('INSERT INTO products (salon_id, name, brand, price_cents, cost_cents, stock, low_stock) VALUES (?,?,?,?,?,?,3)', salon.id, name, brand, eur(price), eur(cost), stock);
      }
      const gift = require('./pos');
      for (const [amount, buyer, to] of [[100, 'Sophie Klein', 'Julie'], [150, 'Marc Weber', 'Anaïs'], [80, 'Paul Muller', '']]) {
        const g = gift.issueGiftCard(salon.id, { amountCents: amount * 100, buyerName: buyer, buyerEmail: `${buyer.split(' ')[0].toLowerCase()}@exemple.ch`, recipientName: to, source: rand() > 0.5 ? 'online' : 'caisse' });
        if (rand() > 0.6) run('UPDATE gift_cards SET balance_cents = balance_cents - 4000 WHERE id = ?', g.id);
      }
    }
    const demo = one('SELECT id FROM salons ORDER BY id LIMIT 1');
    const demoProducts = all('SELECT * FROM products WHERE salon_id = ?', demo.id);
    const methods = ['card', 'card', 'card', 'twint', 'twint', 'cash'];
    for (const b of all("SELECT b.*, sv.name AS service_name FROM bookings b JOIN services sv ON sv.id = b.service_id WHERE b.salon_id = ? AND b.status = 'completed' AND b.start_at >= ?", demo.id, `${T.addDays(today, -14)}T00:00`)) {
      const withProduct = rand() < 0.25 ? demoProducts[Math.floor(rand() * demoProducts.length)] : null;
      const tip = rand() < 0.35 ? [200, 500, 500, 1000][Math.floor(rand() * 4)] : 0;
      const sub = b.price_cents + (withProduct ? withProduct.price_cents : 0);
      const saleId = Number(run(
        `INSERT INTO sales (salon_id, booking_id, client_id, staff_id, subtotal_cents, tip_cents, total_cents, method, day, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        demo.id, b.id, b.client_id, b.staff_id, sub, tip, sub + tip, methods[Math.floor(rand() * methods.length)], b.start_at.slice(0, 10), `${b.start_at.slice(0, 10)} ${b.end_at.slice(11)}:00`,
      ).lastInsertRowid);
      run("INSERT INTO sale_items (sale_id, kind, ref_id, name, qty, unit_cents, total_cents) VALUES (?, 'service', ?, ?, 1, ?, ?)", saleId, b.service_id, b.service_name, b.price_cents, b.price_cents);
      if (withProduct) {
        run("INSERT INTO sale_items (sale_id, kind, ref_id, name, qty, unit_cents, total_cents) VALUES (?, 'product', ?, ?, 1, ?, ?)", saleId, withProduct.id, `${withProduct.brand} — ${withProduct.name}`, withProduct.price_cents, withProduct.price_cents);
      }
    }

    // Past visits are considered already followed up (no burst of "time to rebook" e-mails on first start).
    run('UPDATE bookings SET rebook_sent = 1 WHERE start_at < ?', `${today}T00:00`);
    for (const c of all('SELECT id FROM clients')) {
      if (rand() < 0.6) run('UPDATE clients SET birthday = ? WHERE id = ?', `${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`, c.id);
    }
    run("UPDATE salons SET lastminute_percent = 20, lastminute_hours = 24 WHERE id IN (SELECT id FROM salons ORDER BY id LIMIT 2)");

    run('UPDATE clients SET created_at = (SELECT MIN(created_at) FROM bookings b WHERE b.client_id = clients.id) WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = clients.id)');
  });
}

function reset() {
  db.exec(`DELETE FROM notifications; DELETE FROM sale_items; DELETE FROM sales; DELETE FROM stock_movements; DELETE FROM products; DELETE FROM gift_cards; DELETE FROM design_requests; DELETE FROM template_licenses; DELETE FROM sites; DELETE FROM waitlist; DELETE FROM reviews; DELETE FROM bookings; DELETE FROM clients;
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
