/* Lumea — chat bubble for a salon's page and website. Answered by the salon's AI assistant, or by the team.
   Usage: <script src="/js/chat-widget.js" data-salon="slug" data-color="#6d28d9" data-name="Salon" defer></script> */
(function () {
  'use strict';
  const me = document.currentScript;
  const slug = me && me.dataset.salon;
  if (!slug || document.getElementById('lm-chat')) return;
  const color = /^#[0-9a-f]{6}$/i.test(me.dataset.color || '') ? me.dataset.color : '#6d28d9';
  const name = me.dataset.name || 'le salon';
  const base = new URL(me.src).origin;
  const KEY = `lumea-chat-${slug}`;
  let session = null;
  try { session = localStorage.getItem(KEY); } catch { /* private mode */ }
  let messages = [];
  let human = false;
  let timer = null;

  const css = `
#lm-chat{position:fixed;right:18px;bottom:18px;z-index:2147483000;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18151f}
#lm-chat *{box-sizing:border-box}
#lm-chat .lm-fab{width:58px;height:58px;border-radius:50%;border:0;background:${color};color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer;display:grid;place-items:center;margin-left:auto}
#lm-chat .lm-panel{position:absolute;right:0;bottom:72px;width:min(360px,calc(100vw - 36px));height:min(520px,calc(100vh - 110px));background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden}
#lm-chat .lm-panel[hidden]{display:none}
#lm-chat .lm-head{background:${color};color:#fff;padding:14px 16px}
#lm-chat .lm-head b{display:block;font-size:1rem}
#lm-chat .lm-head small{opacity:.85}
#lm-chat .lm-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#faf8f5}
#lm-chat .lm-b{max-width:85%;padding:8px 12px;border-radius:14px;background:#fff;border:1px solid #eee;overflow-wrap:anywhere}
#lm-chat .lm-t{white-space:pre-wrap}
#lm-chat .lm-b.client{align-self:flex-end;background:${color};color:#fff;border:0}
#lm-chat .lm-b.team{border-color:#bbf7d0;background:#f0fdf4}
#lm-chat .lm-who{font-size:.72rem;opacity:.6;margin-bottom:2px}
#lm-chat form{display:flex;gap:6px;padding:10px;border-top:1px solid #eee}
#lm-chat input{flex:1;border:1px solid #ddd;border-radius:10px;padding:10px 12px;font:inherit;min-width:0}
#lm-chat form button{border:0;border-radius:10px;background:${color};color:#fff;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}
${me.dataset.offset ? '@media(max-width:760px){#lm-chat{bottom:86px}}' : ''}
#lm-chat .lm-note{font-size:.75rem;color:#7a7486;text-align:center;padding:0 10px 8px}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'lm-chat';
  root.innerHTML = `<div class="lm-panel" hidden role="dialog" aria-label="Discuter avec ${name.replace(/[<>"&]/g, '')}">
      <div class="lm-head"><b></b><small>Assistant IA · l’équipe peut aussi vous répondre ici</small></div>
      <div class="lm-log" aria-live="polite"></div>
      <form><input placeholder="Votre message…" maxlength="1000" autocomplete="off" aria-label="Votre message"><button>Envoyer</button></form>
      <div class="lm-note">Réponses générées par une IA. Ne partagez pas de données sensibles.</div>
    </div>
    <button class="lm-fab" aria-label="Ouvrir le chat"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg></button>`;
  document.body.appendChild(root);
  const panel = root.querySelector('.lm-panel');
  const log = root.querySelector('.lm-log');
  const input = root.querySelector('input');
  root.querySelector('.lm-head b').textContent = name;

  const WHO = { assistant: 'Assistant IA', team: name };
  function draw(extra) {
    log.innerHTML = '';
    const list = messages.length ? messages : [{ from: 'assistant', text: `Bonjour ! Je suis l’assistant IA de ${name}. Je peux vous proposer un créneau, réserver ou répondre à vos questions.` }];
    for (const m of list.concat(extra || [])) {
      const el = document.createElement('div');
      el.className = `lm-b ${m.from}`;
      if (m.from !== 'client') {
        const who = document.createElement('div');
        who.className = 'lm-who';
        who.textContent = WHO[m.from] || '';
        el.appendChild(who);
      }
      const t = document.createElement('div');
      t.className = 'lm-t';
      t.textContent = m.text;
      el.appendChild(t);
      log.appendChild(el);
    }
    root.querySelector('.lm-note').hidden = human;
    root.querySelector('.lm-head small').textContent = human ? 'L’équipe vous répond ici' : 'Assistant IA · l’équipe peut aussi vous répondre ici';
    log.scrollTop = log.scrollHeight;
  }

  async function poll() {
    if (!session || panel.hidden) return;
    try {
      const r = await (await fetch(`${base}/api/public/salons/${encodeURIComponent(slug)}/chat/${encodeURIComponent(session)}`)).json();
      if (r.messages && r.messages.length !== messages.length) { messages = r.messages; human = r.human; draw(); }
    } catch { /* offline */ }
  }

  root.querySelector('.lm-fab').onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { draw(); poll(); input.focus(); clearInterval(timer); timer = setInterval(poll, 6000); } else clearInterval(timer);
  };
  root.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    messages.push({ from: 'client', text });
    draw([{ from: 'assistant', text: '…' }]);
    try {
      const res = await fetch(`${base}/api/public/salons/${encodeURIComponent(slug)}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, text }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Envoi impossible.');
      session = r.session;
      try { localStorage.setItem(KEY, session); } catch { /* private mode */ }
      messages = r.messages;
      human = r.human;
      draw(r.reply === null && human ? [{ from: 'team', text: 'Message transmis à l’équipe. La réponse s’affichera ici.' }] : undefined);
    } catch (err) {
      draw([{ from: 'assistant', text: err.message }]);
    }
  };
}());
