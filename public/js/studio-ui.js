/* Lumea — Studio coupe 3D: controls around the 3D head (used in the booking flow and the pro settings). */
'use strict';

window.LumeaStudio = (() => {
  const SKINS = ['#f3d2bd', '#e0ac8b', '#c68863', '#9a6545', '#6b4430', '#47301f'];
  const SLIDERS = [
    ['top', 'Dessus', 0, 20, 0.5, 'cm'],
    ['sides', 'Côtés', 0, 45, 0.5, 'cm'],
    ['back', 'Nuque', 0, 45, 0.5, 'cm'],
    ['fringe', 'Frange', 0, 15, 0.5, 'cm'],
    ['volume', 'Volume', 0, 1, 0.05, '%'],
    ['curl', 'Boucles', 0, 1, 0.05, '%'],
  ];

  const fmtVal = (v, unit) => (unit === '%' ? `${Math.round(v * 100)} %` : `${String(v).replace('.', ',')} ${unit}`);

  /**
   * @param {HTMLElement} el
   * @param {{styles:Array, colors:Array, fades:Object, beards:Object, initial?:Object, compact?:boolean}} cfg
   * @returns {Promise<{getState:Function, snapshot:Function, dispose:Function}>}
   */
  async function mount(el, cfg) {
    const first = cfg.initial?.style ? cfg.styles.find((s) => s.id === cfg.initial.style) || cfg.styles[0] : cfg.styles[0];
    const state = {
      style: first.id,
      params: { ...first.p, beard: 'none', color: cfg.colors[1].hex, ...(cfg.initial?.params || {}) },
      note: cfg.initial?.note || '',
    };
    const groups = {};
    for (const s of cfg.styles) (groups[s.group] ||= []).push(s);

    el.innerHTML = `
      <div class="studio">
        <div class="studio-stage">
          <div class="studio-canvas" aria-label="Aperçu 3D de la coupe (faites glisser pour tourner)"></div>
          <div class="studio-loading">Chargement du studio 3D…</div>
          <div class="studio-views">${['face', 'troisquarts', 'profil', 'dos'].map((v) => `<button type="button" class="chip" data-view="${v}">${{ face: 'Face', troisquarts: '¾', profil: 'Profil', dos: 'Dos' }[v]}</button>`).join('')}</div>
          <div class="studio-skins" title="Teint (aperçu uniquement)">${SKINS.map((c, i) => `<button type="button" class="swatch sm ${i === 1 ? 'on' : ''}" data-skin="${c}" style="--sw:${c}" aria-label="Teint ${i + 1}"></button>`).join('')}</div>
        </div>
        <div class="studio-controls">
          <div class="studio-block"><div class="studio-label">Coupe proposée par le salon</div>
            ${Object.entries(groups).map(([g, list]) => `<div class="studio-group"><span class="small muted">${esc(g)}</span><div class="row" style="gap:6px">${list.map((s) => `<button type="button" class="chip ${s.id === state.style ? 'active' : ''}" data-style="${s.id}">${esc(s.name)}</button>`).join('')}</div></div>`).join('')}
          </div>
          <div class="studio-block studio-sliders">
            ${SLIDERS.map(([k, label, min, max, step, unit]) => `<label class="studio-slider"><span>${label} <b data-out="${k}">${fmtVal(state.params[k], unit)}</b></span><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${state.params[k]}"></label>`).join('')}
          </div>
          <div class="studio-block"><div class="studio-label">Dégradé</div><div class="row" style="gap:6px">${Object.entries(cfg.fades).map(([k, l]) => `<button type="button" class="chip ${k === state.params.fade ? 'active' : ''}" data-fade="${k}">${esc(l)}</button>`).join('')}</div></div>
          <div class="studio-block"><div class="studio-label">Barbe</div><div class="row" style="gap:6px">${Object.entries(cfg.beards).map(([k, l]) => `<button type="button" class="chip ${k === state.params.beard ? 'active' : ''}" data-beard="${k}">${esc(l)}</button>`).join('')}</div></div>
          <div class="studio-block"><div class="studio-label">Couleur <span class="small muted" data-colorname></span></div>
            <div class="row" style="gap:8px">${cfg.colors.map((c) => `<button type="button" class="swatch ${c.hex === state.params.color ? 'on' : ''}" data-color="${c.hex}" data-name="${esc(c.name)}" style="--sw:${c.hex}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('')}
              <label class="swatch custom" title="Couleur personnalisée"><input type="color" data-customcolor value="${state.params.color}" aria-label="Couleur personnalisée"></label></div></div>
          ${cfg.compact ? '' : `<div class="studio-block"><label class="studio-label" for="studio-note">Précisions pour votre coiffeur</label><textarea id="studio-note" placeholder="Ex. : garder de la longueur devant, raie à gauche, épi derrière…">${esc(state.note)}</textarea></div>`}
        </div>
      </div>`;

    const q = (sel) => el.querySelector(sel);
    const qa = (sel) => [...el.querySelectorAll(sel)];
    let studio = null;
    try {
      const { createStudio } = await import('/js/studio3d.js');
      studio = createStudio(q('.studio-canvas'), { params: state.params, skin: SKINS[1] });
      q('.studio-loading').remove();
    } catch (err) {
      q('.studio-loading').textContent = 'La 3D n’est pas disponible sur cet appareil. Vous pouvez quand même décrire votre coupe ci-dessous.';
      console.error(err);
    }
    const refresh = () => studio?.update(state.params);
    const syncSliders = () => SLIDERS.forEach(([k, , , , , unit]) => {
      q(`[data-p="${k}"]`).value = state.params[k];
      q(`[data-out="${k}"]`).textContent = fmtVal(state.params[k], unit);
    });
    const colorName = () => { const c = cfg.colors.find((x) => x.hex.toLowerCase() === state.params.color.toLowerCase()); q('[data-colorname]').textContent = c ? `· ${c.name}` : '· personnalisée'; };
    colorName();

    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.p) {
        state.params[t.dataset.p] = Number(t.value);
        const unit = SLIDERS.find(([k]) => k === t.dataset.p)[5];
        q(`[data-out="${t.dataset.p}"]`).textContent = fmtVal(Number(t.value), unit);
        refresh();
      } else if (t.hasAttribute('data-customcolor')) {
        state.params.color = t.value;
        qa('[data-color]').forEach((b) => b.classList.remove('on'));
        colorName(); refresh();
      } else if (t.id === 'studio-note') state.note = t.value;
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.style) {
        const s = cfg.styles.find((x) => x.id === b.dataset.style);
        state.style = s.id;
        state.params = { ...state.params, ...s.p };
        qa('[data-style]').forEach((x) => x.classList.toggle('active', x === b));
        qa('[data-fade]').forEach((x) => x.classList.toggle('active', x.dataset.fade === state.params.fade));
        syncSliders(); refresh();
      } else if (b.dataset.fade) {
        state.params.fade = b.dataset.fade;
        qa('[data-fade]').forEach((x) => x.classList.toggle('active', x === b)); refresh();
      } else if (b.dataset.beard) {
        state.params.beard = b.dataset.beard;
        qa('[data-beard]').forEach((x) => x.classList.toggle('active', x === b)); refresh();
      } else if (b.dataset.color) {
        state.params.color = b.dataset.color;
        qa('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
        q('[data-customcolor]').value = b.dataset.color;
        colorName(); refresh();
      } else if (b.dataset.skin) {
        qa('[data-skin]').forEach((x) => x.classList.toggle('on', x === b));
        studio?.setSkin(b.dataset.skin);
      } else if (b.dataset.view) studio?.view(b.dataset.view);
    });

    return {
      getState: () => JSON.parse(JSON.stringify(state)),
      snapshot: () => { try { return studio ? studio.snapshot(320) : ''; } catch { return ''; } },
      dispose: () => studio?.dispose(),
    };
  }

  return { mount };
})();
