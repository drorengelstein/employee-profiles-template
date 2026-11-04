/* ===== משובים — מסך המשתתף =====
   קישור משותף לאירוע: l#<מפתח>. כניסה בשם מלא + סיסמת האירוע, ואז "חדש" או
   "ההערות שלי". המסכים נשמרים בהיסטוריית הדפדפן כדי שכפתור "חזרה" בנייד יעבוד. */
(function () {
  'use strict';
  const { el, api, toast, formatTs } = window.EP;
  const app = document.getElementById('app');
  const key = location.hash.slice(1).trim();
  const base = '/api/l/' + key;
  const DRAFT = 'ep-lesson-draft-' + key.slice(0, 10);

  let meta = null, me = null, mine = null;
  const catOf = id => meta.categories.find(c => c.id === id) || { id, label: '—' };
  const kindOf = id => meta.kinds.find(k => k.id === id) || { id, label: '—' };
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));

  function draftGet() { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { return null; } }
  function draftSet(v) { try { v ? localStorage.setItem(DRAFT, JSON.stringify(v)) : localStorage.removeItem(DRAFT); } catch { /* אחסון חסום */ } }

  function message(title, text) {
    fill(app, el('div', { class: 'card center', style: 'padding:2rem 1.25rem' }, el('h1', { style: 'font-size:1.4rem' }, title), text ? el('p', { class: 'muted' }, text) : null));
  }

  /* ===== ניווט ===== */
  function go(screen, arg) {
    history.pushState({ s: screen, a: arg ?? null }, '');
    render(screen, arg);
  }
  addEventListener('popstate', e => render(e.state?.s || 'home', e.state?.a));
  addEventListener('hashchange', () => location.reload());

  function render(screen, arg) {
    window.scrollTo(0, 0);
    if (!me) return renderLogin();
    if (screen === 'new' && meta.active) return renderNew();
    if (screen === 'mine') return renderMine();
    if (screen === 'cat') return renderCat(arg);
    return renderHome();
  }

  // 401 באמצע עבודה = הסשן פג. הטיוטה נשמרת, וחוזרים למסך הכניסה.
  function handleErr(e) {
    if (e.status === 401) { me = null; toast('יש להיכנס מחדש'); renderLogin(); return true; }
    toast(e.message || 'משהו השתבש, נסה/י שוב', 4000);
    return false;
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) return message('הקישור לא תקין', 'בדוק/י שהעתקת את הקישור המלא.');
    try {
      meta = await api(base);
      me = meta.me;
      document.title = meta.title + ' — משובים';
      history.replaceState({ s: 'home' }, '');
      render('home');
    } catch (e) {
      message('לא הצלחנו לפתוח', e.status === 404 ? e.message : 'בדוק/י את החיבור לאינטרנט ונסה/י שוב.');
    }
  }

  function header() {
    return el('div', { class: 'l-top' },
      el('h1', { class: 'l-title' }, meta.title),
      me ? el('div', { class: 'l-who' }, me, el('button', { class: 'btn sm ghost', onclick: logout }, 'יציאה')) : null);
  }
  function nav(current) {
    return el('div', { class: 'l-nav' },
      meta.active ? el('button', { class: 'btn' + (current === 'new' ? ' on' : ''), onclick: () => current !== 'new' && go('new') }, '+ חדש') : null,
      el('button', { class: 'btn' + (current === 'mine' ? ' on' : ''), onclick: () => current !== 'mine' && go('mine') }, 'ההערות שלי'));
  }

  async function logout() {
    await api(base + '/logout', { method: 'POST', body: {} }).catch(() => {});
    me = null; mine = null;
    renderLogin();
  }

  /* ===== כניסה ===== */
  function renderLogin() {
    const err = el('div', { class: 'notice error hidden', role: 'alert' });
    const name = el('input', { type: 'text', autocomplete: 'name', required: true });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'כניסה');
    const form = el('form', { class: 'card l-login' },
      el('h1', {}, meta.title),
      el('p', { class: 'muted small' }, 'משובים ולקחים'),
      meta.active ? null : el('div', { class: 'notice' }, 'האירוע נסגר להקלדה. אפשר להיכנס ולצפות בהערות שלך.'),
      err,
      el('label', { class: 'field' }, el('span', {}, 'שם מלא'), name),
      el('label', { class: 'field' }, el('span', {}, 'סיסמה'), pw),
      btn);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await api(base + '/login', { method: 'POST', body: { name: name.value, password: pw.value } });
        me = r.me; mine = null;
        // אם יש טיוטה שלא נשלחה — ממשיכים ישר אליה
        go(draftGet()?.body && meta.active ? 'new' : 'home');
      } catch (er) { err.textContent = er.message; err.classList.remove('hidden'); btn.disabled = false; }
    });
    fill(app, form);
    name.focus();
  }

  /* ===== בית ===== */
  function renderHome() {
    const count = el('small', {}, mine ? `${mine.length} הערות` : '');
    fill(app, header(),
      el('div', { class: 'l-home' },
        meta.active ? el('button', { class: 'l-big primary', onclick: () => go('new') }, '+ חדש', el('small', {}, 'הערה או לקח')) : el('div', { class: 'notice l-closed' }, 'האירוע נסגר להקלדה'),
        el('button', { class: 'l-big', onclick: () => go('mine') }, 'ההערות שלי', count)));
    if (!mine) loadMine().then(() => { if (mine) count.textContent = `${mine.length} הערות`; }).catch(() => {});
  }

  async function loadMine() {
    const r = await api(base + '/mine');
    mine = r.lessons;
    return mine;
  }

  /* ===== הערה חדשה ===== */
  function selects(cur = {}) {
    const cat = el('select', { 'aria-label': 'קטגוריה' }, el('option', { value: '' }, 'קטגוריה…'),
      meta.categories.map(c => el('option', { value: c.id, selected: cur.category === c.id }, c.label)));
    const kind = el('select', { 'aria-label': 'סוג' }, el('option', { value: '' }, 'סוג…'),
      meta.kinds.map(k => el('option', { value: k.id, selected: cur.kind === k.id }, k.label)));
    return { cat, kind };
  }
  function autoGrow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }

  function renderNew() {
    const d = draftGet() || {};
    const { cat, kind } = selects(d);
    const body = el('textarea', { placeholder: 'מה קרה, מה למדנו, מה כדאי לעשות אחרת…', 'aria-label': 'תוכן' }, d.body || '');
    autoGrow(body);
    const save = () => draftSet(body.value.trim() || cat.value || kind.value ? { category: cat.value, kind: kind.value, body: body.value } : null);
    [cat, kind].forEach(s => s.addEventListener('change', save));
    body.addEventListener('input', save);

    const send = el('button', { class: 'btn primary l-send', onclick: async () => {
      if (!cat.value) { cat.focus(); return toast('נא לבחור קטגוריה'); }
      if (!kind.value) { kind.focus(); return toast('נא לבחור סוג'); }
      if (!body.value.trim()) { body.focus(); return toast('אין תוכן לשליחה'); }
      send.disabled = true; send.textContent = 'שולח…';
      try {
        const r = await api(base + '/lessons', { method: 'POST', body: { category: cat.value, kind: kind.value, body: body.value } });
        draftSet(null);
        if (mine) mine.unshift(r.lesson);
        toast('נשלח ✓');
        renderNew(); // מסך נקי להערה הבאה
      } catch (e) {
        send.disabled = false; send.textContent = 'שלח';
        if (e.status === 403) { meta.active = false; message('האירוע נסגר להקלדה', 'ההערה לא נשלחה. הטקסט שמור במכשיר.'); return; }
        handleErr(e);
      }
    } }, 'שלח');

    fill(app, header(), nav('new'),
      el('div', { class: 'card l-form' },
        el('div', { class: 'row' }, el('div', { class: 'grow' }, cat), el('div', { class: 'grow' }, kind)),
        body, send));
    window.scrollTo(0, 0);
  }

  /* ===== ההערות שלי ===== */
  async function renderMine() {
    fill(app, header(), nav('mine'), el('p', { class: 'muted' }, 'טוען…'));
    try { await loadMine(); } catch (e) { return handleErr(e); }
    if (!mine.length) return fill(app, header(), nav('mine'), el('div', { class: 'card center' }, el('p', { class: 'muted', style: 'margin:0' }, 'עוד לא הקלדת הערות.')));
    const cats = meta.categories.map(c => ({ c, n: mine.filter(l => l.category === c.id).length })).filter(x => x.n);
    fill(app, header(), nav('mine'),
      el('p', { class: 'muted small' }, `${mine.length} הערות ב-${cats.length} קטגוריות. בחר/י קטגוריה:`),
      el('div', { class: 'bubbles' }, cats.map(({ c, n }) =>
        el('button', { class: 'bubble cat-' + c.id, onclick: () => go('cat', c.id), 'aria-label': `${c.label}, ${n} הערות` },
          el('span', { class: 'b-count' }, String(n)), el('span', { class: 'b-main' }, c.label)))));
  }

  const snippet = t => { const w = t.trim().split(/\s+/); return w.slice(0, 8).join(' ') + (w.length > 8 ? '…' : ''); };

  async function renderCat(catId) {
    if (!mine) { try { await loadMine(); } catch (e) { return handleErr(e); } }
    const c = catOf(catId);
    const notes = mine.filter(l => l.category === catId);
    fill(app, header(), nav('mine'),
      el('button', { class: 'btn sm ghost', style: 'margin-bottom:.5rem', onclick: () => history.back() }, '→ כל הקטגוריות'),
      el('div', { class: 'l-cat-head cat-' + c.id }, el('span', { class: 'l-dot', 'aria-hidden': 'true' }), el('h2', {}, c.label), el('span', { class: 'muted small' }, `${notes.length} הערות`)),
      notes.length ? el('div', { class: 'bubbles' }, notes.map(n =>
        el('button', { class: 'bubble cat-' + c.id, onclick: () => openNote(n, catId) },
          el('span', { class: 'b-main' }, kindOf(n.kind).label),
          el('span', { class: 'b-snip' }, snippet(n.body)),
          el('span', { class: 'b-date' }, formatTs(n.created_at)))))
        : el('p', { class: 'muted' }, 'אין הערות בקטגוריה הזו.'));
  }

  /* ===== חלון הערה: צפייה ועריכה ===== */
  function openNote(n, fromCat) {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'הערה' });
    back.append(box);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);

    const view = () => fill(box,
      el('div', { class: 'modal-head' },
        el('h2', {}, kindOf(n.kind).label),
        el('div', { class: 'row', style: 'gap:.3rem' },
          meta.active ? el('button', { class: 'btn sm', onclick: edit, 'aria-label': 'עריכה' }, '✏️ עריכה') : null,
          el('button', { class: 'btn ghost icon', onclick: close, 'aria-label': 'סגירה' }, '✕'))),
      el('div', { class: 'l-note-meta' },
        el('span', { class: 'l-chip cat-' + n.category }, catOf(n.category).label),
        el('span', { class: 'muted small' }, formatTs(n.created_at) + (n.updated_at > n.created_at + 1000 ? ` · נערך ${formatTs(n.updated_at)}` : ''))),
      el('div', { class: 'l-note-text' }, n.body));

    function edit() {
      const { cat, kind } = selects(n);
      const body = el('textarea', { 'aria-label': 'תוכן' }, n.body);
      const saveBtn = el('button', { class: 'btn primary', onclick: async () => {
        if (!body.value.trim()) return toast('אין תוכן');
        saveBtn.disabled = true;
        try {
          const r = await api(base + '/lessons/' + n.id, { method: 'PATCH', body: { category: cat.value, kind: kind.value, body: body.value } });
          Object.assign(n, r.lesson);
          toast('נשמר ✓');
          view();
          renderCat(fromCat); // ההערה אולי עברה לקטגוריה אחרת
        } catch (e) { saveBtn.disabled = false; if (handleErr(e)) close(); }
      } }, 'שמירה');
      fill(box,
        el('div', { class: 'modal-head' }, el('h2', {}, 'עריכת הערה'), el('button', { class: 'btn ghost icon', onclick: close, 'aria-label': 'סגירה' }, '✕')),
        el('div', { class: 'l-edit-grid' }, el('div', { class: 'row' }, el('div', { class: 'grow' }, cat), el('div', { class: 'grow' }, kind)), body),
        el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:.75rem' }, el('button', { class: 'btn', onclick: view }, 'ביטול'), saveBtn));
      body.focus();
    }

    view();
    document.body.append(back);
  }

  load();
})();
