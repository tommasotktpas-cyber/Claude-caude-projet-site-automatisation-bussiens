'use strict';
// Salon websites: access rules (plan + template licences), data loading and rendering.
const { one, all, run } = require('./db');
const { TEMPLATES, templateById, renderSite } = require('./templates');
const { CURRENCY } = require('./plans');

function ensureSite(salonId) {
  run('INSERT OR IGNORE INTO sites (salon_id) VALUES (?)', salonId);
  return one('SELECT * FROM sites WHERE salon_id = ?', salonId);
}

const isPremium = (salon) => salon.plan === 'premium';
/** During the free trial every template and Premium option can be tried. */
const hasPremiumFeatures = (salon) => salon.plan === 'premium' || salon.plan === 'trial';

function activeLicenses(salonId) {
  return all('SELECT * FROM template_licenses WHERE salon_id = ? AND active = 1 ORDER BY created_at DESC', salonId);
}

/** Can this salon publish with this template? */
function canUseTemplate(salon, templateId) {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return false;
  if (tpl.free || hasPremiumFeatures(salon)) return true;
  return activeLicenses(salon.id).some((l) => l.template === templateId);
}

function templateCatalog(salon) {
  const licenses = salon ? activeLicenses(salon.id) : [];
  return TEMPLATES.map((t) => {
    const license = licenses.find((l) => l.template === t.id) || null;
    let access = 'locked';
    if (t.free) access = 'free';
    else if (salon && isPremium(salon)) access = 'included';
    else if (salon && salon.plan === 'trial') access = 'trial';
    else if (license) access = 'licensed';
    return {
      id: t.id, name: t.name, description: t.description, free: !!t.free, best_for: t.best_for,
      colors: t.colors, fonts: t.fonts, access, license,
    };
  });
}

function parseContent(site) {
  try { return JSON.parse(site.content || '{}'); } catch { return {}; }
}

function salonPublicData(salon) {
  return {
    services: all('SELECT id, name, category, description, duration_min, price_cents FROM services WHERE salon_id = ? AND active = 1 ORDER BY position, id', salon.id),
    staff: all('SELECT id, name, title, color FROM staff WHERE salon_id = ? AND active = 1 ORDER BY id', salon.id),
    hours: all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ? ORDER BY weekday, open', salon.id),
    reviews: all("SELECT rating, comment, author_name FROM reviews WHERE salon_id = ? AND comment != '' ORDER BY rating DESC, created_at DESC LIMIT 6", salon.id),
    rating: one('SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE salon_id = ?', salon.id),
  };
}

/**
 * Renders a salon website. Locked templates fall back to Classique (e.g. after a licence ends);
 * custom CSS and white-label only apply on Premium.
 */
function renderSalonSite(salon, { templateId, content, customCss, preview = false } = {}) {
  const site = ensureSite(salon.id);
  let tpl = templateId || site.template;
  if (!preview && !canUseTemplate(salon, tpl)) tpl = 'classique';
  const premium = hasPremiumFeatures(salon);
  const finalContent = content ?? parseContent(site);
  return renderSite({
    salon,
    ...salonPublicData(salon),
    content: finalContent,
    templateId: templateById(tpl).id,
    customCss: premium ? (customCss ?? site.custom_css) : '',
    currency: CURRENCY,
    preview,
    // White-label (no « propulsé par Lumea ») is a Premium option.
    showBranding: !(premium && finalContent.hide_branding),
  });
}

function siteByDomain(host) {
  const domain = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  if (!domain) return null;
  const row = one(
    `SELECT s.* FROM sites x JOIN salons s ON s.id = x.salon_id
     WHERE x.custom_domain = ? AND x.published = 1 AND s.published = 1`, domain,
  );
  return row && hasPremiumFeatures(row) ? row : null;
}

module.exports = {
  ensureSite, canUseTemplate, templateCatalog, parseContent, renderSalonSite, siteByDomain,
  activeLicenses, isPremium, hasPremiumFeatures,
};
