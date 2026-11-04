/* ===== ממשק המנהל =====
   אפליקציה של עמוד אחד עם ניתוב ב-hash. כל הנתונים מגיעים מ-/api/data
   בטעינה אחת, והחישובים לדשבורד נעשים כאן — בצוות של עשרות עובדים זה
   מיידי, ואין צורך בשאילתות מצרפיות בשרת. */
(function () {
  'use strict';
  const { el, api, toast, uid, TYPE_LABELS, scaleRange, scaleLabel, renderQuestion, answerText, optionLabel, isEmpty, formatTs, ageFrom } = window.EP;

  const $auth = document.getElementById('auth');
  const $shell = document.getElementById('shell');
  const $view = document.getElementById('view');
  const $tabs = document.getElementById('tabs');

  let me = null, data = null;
  let draft = null, draftDirty = false, openQs = new Set();
  const dash = { includeDrafts: false, role: '', team: '', sortByAvg: false };
  const empFilter = { team: '' };

  const STATUS = {
    invited: { t: 'טרם נפתח', c: '' },
    opened: { t: 'נפתח', c: 'info' },
    in_progress: { t: 'בתהליך', c: 'warn' },
    submitted: { t: 'הוגש', c: 'good' },
  };
  const isAdmin = () => me && me.role === 'admin';
  const allQs = form => form.definition.sections.flatMap(s => s.questions.map(q => ({ q, s })));
  const linkFor = e => `${location.origin}/f#${e.token}`;
  const byName = (a, b) => a.name.localeCompare(b.name, 'he');
  const heSort = (a, b) => a.localeCompare(b, 'he');
  const distinct = key => [...new Set(data.employees.map(e => e[key]).filter(Boolean))].sort(heSort);
  const roleLine = e => [e.role_title, e.team].filter(Boolean).join(' · ');
  // רשימת השלמה אוטומטית — כדי שצוות ייכתב תמיד באותו אופן ("צוות אייל" ולא "אייל")
  function suggest(input, key) {
    const id = 'dl-' + key + '-' + Math.random().toString(36).slice(2, 7);
    input.setAttribute('list', id);
    return el('datalist', { id }, distinct(key).map(v => el('option', { value: v })));
  }
  // replaceChildren הופך null למחרוזת "null" — מסננים לפני
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));

  /* ===== דיאלוג ===== */
  function dialog({ title, body, okText = 'אישור', cancelText = 'ביטול', danger = false, onOk }) {
    return new Promise(resolve => {
      // Safari (במיוחד באייפון) גולל את הדף כשמתמקדים בשדה בתוך שכבה קבועה; שומרים ומחזירים
      const keepY = scrollY;
      const err = el('div', { class: 'notice error hidden' });
      const ok = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary') }, okText);
      const close = v => { back.remove(); document.removeEventListener('keydown', onKey); scrollTo(0, keepY); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(false); };
      ok.addEventListener('click', async () => {
        try { const v = onOk ? await onOk() : true; close(v === undefined ? true : v); }
        catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
      });
      const back = el('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(false); } },
        el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          el('div', { class: 'modal-head' }, el('h2', {}, title), el('button', { class: 'btn ghost icon', 'aria-label': 'סגירה', onclick: () => close(false) }, '✕')),
          err, body || null,
          el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
            cancelText ? el('button', { class: 'btn', onclick: () => close(false) }, cancelText) : null, ok)));
      document.body.append(back);
      document.addEventListener('keydown', onKey);
      (back.querySelector('input,textarea,select') || ok).focus({ preventScroll: true });
    });
  }
  const confirmDlg = (title, text, okText = 'אישור', danger = false) =>
    dialog({ title, body: el('p', {}, text), okText, danger });

  async function copy(text, msg = 'הקישור הועתק') {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { dialog({ title: 'העתקה ידנית', body: el('input', { type: 'text', value: text, readonly: true, dir: 'ltr', onfocus: e => e.target.select() }), cancelText: null, okText: 'סגירה' }); }
  }

  /* ===== כניסה והקמה ===== */
  async function boot() {
    try { me = (await api('/api/me')).user; }
    catch (e) {
      if (e.status === 401) return showAuth();
      return showFatal(e);
    }
    await startApp();
  }

  function showFatal(e) {
    $auth.classList.remove('hidden');
    $auth.replaceChildren(el('div', { class: 'card' }, el('h1', {}, 'אין חיבור לשרת'), el('p', { class: 'muted' }, e.message), el('button', { class: 'btn', onclick: () => location.reload() }, 'נסה שוב')));
  }

  async function showAuth() {
    $shell.classList.add('hidden'); $auth.classList.remove('hidden');
    let setup = { needed: false };
    try { setup = await api('/api/setup'); } catch { /* נמשיך למסך כניסה */ }
    const msg = el('div', { class: 'notice error hidden', role: 'alert' });
    const f = {};
    const field = (key, label, type = 'text', extra = {}) =>
      el('label', { class: 'field' }, el('span', {}, label), f[key] = el('input', { type, dir: type === 'password' || key === 'username' || key === 'code' ? 'ltr' : undefined, ...extra }));

    if (setup.needed) {
      const form = el('form', { class: 'card' },
        el('h1', {}, 'הקמת המערכת'),
        el('p', { class: 'muted small' }, 'יצירת חשבון המנהל הראשון. קוד ההקמה הוא הערך שהוגדר בשרת (SETUP_CODE).'),
        msg,
        setup.configured ? null : el('div', { class: 'notice error' }, 'בשרת לא הוגדר SETUP_CODE — אי אפשר להשלים הקמה עד שיוגדר.'),
        field('code', 'קוד הקמה', 'password', { autocomplete: 'off' }),
        field('display_name', 'השם שלך', 'text', { autocomplete: 'name' }),
        field('username', 'שם משתמש (באנגלית)', 'text', { autocomplete: 'username', autocapitalize: 'none' }),
        field('password', 'סיסמה (8 תווים לפחות)', 'password', { autocomplete: 'new-password' }),
        el('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'יצירת חשבון וכניסה'));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await api('/api/setup', { method: 'POST', body: { code: f.code.value, display_name: f.display_name.value, username: f.username.value, password: f.password.value } });
          boot();
        } catch (er) { msg.textContent = er.message; msg.classList.remove('hidden'); }
      });
      return $auth.replaceChildren(form);
    }

    const form = el('form', { class: 'card' },
      el('h1', {}, 'כניסה'),
      el('p', { class: 'muted small' }, 'ממשק ניהול — שאלון פרטים אישיים'),
      msg,
      field('username', 'שם משתמש', 'text', { autocomplete: 'username', autocapitalize: 'none', required: true }),
      field('password', 'סיסמה', 'password', { autocomplete: 'current-password', required: true }),
      el('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'כניסה'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const b = form.querySelector('button'); b.disabled = true;
      try {
        await api('/api/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
        boot();
      } catch (er) { msg.textContent = er.message; msg.classList.remove('hidden'); b.disabled = false; }
    });
    $auth.replaceChildren(form);
    f.username.focus();
  }

  async function reload() {
    data = await api('/api/data');
    data.employees.sort(byName);
  }

  async function startApp() {
    await reload();
    $auth.classList.add('hidden'); $shell.classList.remove('hidden');
    document.getElementById('who').textContent = `${me.display_name} · ${me.role === 'admin' ? 'מנהל' : 'צפייה'}`;
    const tabs = [['dashboard', 'דשבורד'], ['employees', 'עובדים'], ['feedback', 'משובים']];
    if (isAdmin()) tabs.push(['interviews', 'ראיונות'], ['builder', 'בונה השאלון'], ['users', 'משתמשים'], ['backup', 'גיבוי']);
    $tabs.replaceChildren(...tabs.map(([k, t]) => el('a', { href: '#/' + k, 'data-k': k }, t)));
    route();
  }

  document.getElementById('logout').addEventListener('click', async () => {
    if (draftDirty && !(await confirmDlg('יציאה', 'יש שינויים בשאלון שלא נשמרו. לצאת בכל זאת?', 'יציאה', true))) return;
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
    location.hash = ''; location.reload();
  });

  /* ===== ניתוב ===== */
  let lastHash = location.hash, ignoreHash = false;
  addEventListener('hashchange', async () => {
    if (ignoreHash) { ignoreHash = false; return; }
    if (draftDirty && lastHash.startsWith('#/builder') && !location.hash.startsWith('#/builder')) {
      const target = location.hash;
      ignoreHash = true; location.hash = lastHash;
      if (!(await confirmDlg('שינויים שלא נשמרו', 'יש שינויים בשאלון שלא נשמרו. לעזוב בלי לשמור?', 'לעזוב בלי לשמור', true))) return;
      draftDirty = false; draft = null;
      location.hash = target; return;
    }
    route();
  });
  addEventListener('beforeunload', e => { if (draftDirty) { e.preventDefault(); e.returnValue = ''; } });

  function route() {
    lastHash = location.hash;
    if (!me) return;
    const [name, arg, arg2] = location.hash.replace(/^#\/?/, '').split('/');
    const k = name || 'dashboard';
    for (const a of $tabs.children) a.classList.toggle('on', a.dataset.k === k || (k === 'employee' && a.dataset.k === 'employees'));
    window.scrollTo(0, 0);
    const views = { dashboard: viewDashboard, employees: viewEmployees, employee: () => viewDossier(Number(arg)), feedback: viewFeedback };
    if (isAdmin()) Object.assign(views, { interviews: () => viewInterview(arg, arg2), builder: viewBuilder, users: viewUsers, backup: viewBackup });
    (views[k] || viewDashboard)();
  }

  function pageHead(title, sub, ...actions) {
    return el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, title), sub ? el('div', { class: 'muted small' }, sub) : null),
      actions.length ? el('div', { class: 'row' }, actions) : null);
  }

  /* ===== עובדים ===== */
  function answeredCount(e) {
    const a = e.response?.answers || {};
    const qs = allQs(data.form);
    return { done: qs.filter(({ q }) => !isEmpty(a[q.id])).length, total: qs.length };
  }

  function viewEmployees() {
    const search = el('input', { type: 'text', placeholder: 'חיפוש לפי שם, תפקיד או צוות', 'aria-label': 'חיפוש', style: 'max-width:320px' });
    const teams = distinct('team');
    const teamSel = el('select', { 'aria-label': 'סינון לפי צוות', style: 'width:auto' },
      el('option', { value: '' }, 'כל הצוותים'), teams.map(t => el('option', { value: t, selected: empFilter.team === t }, t)),
      teams.length ? el('option', { value: '__none', selected: empFilter.team === '__none' }, 'ללא צוות') : null);
    const list = el('div', { class: 'emp-list' });
    const counts = Object.keys(STATUS).map(s => [s, data.employees.filter(e => e.status === s).length]);

    const draw = () => {
      const t = search.value.trim();
      empFilter.team = teamSel.value;
      const emps = data.employees.filter(e =>
        (!t || e.name.includes(t) || (e.role_title || '').includes(t) || (e.team || '').includes(t)) &&
        (!empFilter.team || (empFilter.team === '__none' ? !e.team : e.team === empFilter.team)));
      if (!emps.length) return list.replaceChildren(el('div', { class: 'notice' }, data.employees.length ? 'לא נמצאו עובדים' : 'עדיין לא נוספו עובדים.' + (isAdmin() ? ' הוסף עובד כדי לקבל קישור אישי לשאלון.' : '')));
      // כשיש צוותים — מציגים בקבוצות לפי צוות, עם מצב המילוי של כל צוות
      if (!teams.length || empFilter.team) return list.replaceChildren(...emps.map(empRow));
      const groups = [...teams, ''].map(tm => [tm, emps.filter(e => (e.team || '') === tm)]).filter(([, g]) => g.length);
      list.replaceChildren(...groups.flatMap(([tm, g]) => [
        el('h3', { class: 'team-head' }, tm || 'ללא צוות', el('span', { class: 'muted small' }, ` ${g.length} · הגישו ${g.filter(e => e.status === 'submitted').length}`)),
        ...g.map(empRow)]));
    };
    search.addEventListener('input', draw);
    teamSel.addEventListener('change', draw);

    const nodes = [pageHead('עובדים', counts.map(([s, n]) => `${STATUS[s].t}: ${n}`).join(' · '))];
    if (isAdmin()) nodes.push(addEmployeeCard(draw));
    nodes.push(el('div', { class: 'row', style: 'margin:1rem 0 .75rem' }, search, teams.length ? teamSel : null), list);
    $view.replaceChildren(...nodes);
    draw();
  }

  function addEmployeeCard(redraw) {
    const name = el('input', { type: 'text', placeholder: 'שם מלא', 'aria-label': 'שם העובד' });
    const role = el('input', { type: 'text', placeholder: 'תפקיד (לא חובה)', 'aria-label': 'תפקיד' });
    const team = el('input', { type: 'text', placeholder: 'צוות (לא חובה)', 'aria-label': 'צוות' });
    const lists = [suggest(role, 'role_title'), suggest(team, 'team')];
    const bulk = el('textarea', { placeholder: 'שם אחד בכל שורה. אפשר להוסיף תפקיד וצוות אחרי פסיקים:\nדנה כהן, מנהלת משרד, צוות אייל\nיוסי לוי, , צוות אריאל\nמשה לוי', 'aria-label': 'הוספה מרובה', class: 'hidden', rows: 5 });
    const add = async () => {
      const list = bulk.classList.contains('hidden')
        ? [{ name: name.value, role_title: role.value, team: team.value }]
        : bulk.value.split('\n').map(l => { const [n, r = '', t = ''] = l.split(',').map(x => x.trim()); return { name: n, role_title: r, team: t }; }).filter(x => x.name);
      if (!list.length || !list[0].name.trim()) return toast('נא להקליד שם');
      try {
        const r = await api('/api/employees', { method: 'POST', body: { employees: list } });
        name.value = role.value = bulk.value = '';  // הצוות נשאר — נוח להוספת כמה אנשים לאותו צוות
        await reload(); redraw();
        if (r.created.length === 1) {
          const e = data.employees.find(x => x.id === r.created[0].id);
          linkDialog(e);
        } else toast(`נוספו ${r.created.length} עובדים`);
      } catch (e) { toast(e.message); }
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    role.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    team.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    const toggle = el('button', { class: 'btn ghost sm', onclick: () => {
      const on = bulk.classList.toggle('hidden');
      single.classList.toggle('hidden', !on);
      toggle.textContent = on ? 'הוספה מרובה' : 'הוספת עובד יחיד';
    } }, 'הוספה מרובה');
    const single = el('div', { class: 'row' }, el('div', { class: 'grow' }, name), el('div', { class: 'grow' }, role), el('div', { class: 'grow' }, team), lists);
    return el('div', { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:.6rem' }, el('h3', { style: 'margin:0' }, 'הוספת עובד'), toggle),
      single,
      bulk,
      el('div', { style: 'margin-top:.75rem' }, el('button', { class: 'btn primary', onclick: add }, 'הוספה וקבלת קישור')));
  }

  function shareText(e) {
    return `שלום ${e.name}, זה הקישור האישי שלך לשאלון פרטים אישיים:\n${linkFor(e)}`;
  }
  function linkDialog(e) {
    const link = linkFor(e);
    dialog({
      title: `קישור אישי — ${e.name}`,
      cancelText: null, okText: 'סגירה',
      body: el('div', {},
        el('p', { class: 'muted small' }, 'הקישור הזה פותח את השאלון רק עבור העובד הזה. שלח אותו לעובד בלבד.'),
        el('input', { type: 'text', value: link, readonly: true, dir: 'ltr', onfocus: x => x.target.select() }),
        el('div', { class: 'row', style: 'margin-top:.75rem' },
          el('button', { class: 'btn primary', onclick: () => copy(link) }, 'העתקת קישור'),
          el('button', { class: 'btn', onclick: () => copy(shareText(e), 'ההודעה הועתקה') }, 'העתקת הודעה מוכנה'),
          el('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(shareText(e)), target: '_blank', rel: 'noopener noreferrer' }, 'שליחה בוואטסאפ'))),
    });
  }

  function empRow(e) {
    const st = STATUS[e.status] || STATUS.invited;
    const { done, total } = answeredCount(e);
    const pct = total ? Math.round(done / total * 100) : 0;
    const fill = el('i'); fill.style.width = pct + '%';
    const actions = el('div', { class: 'emp-actions' },
      el('a', { class: 'btn sm', href: '#/employee/' + e.id }, 'תיק אישי'));
    if (isAdmin()) {
      actions.append(el('button', { class: 'btn sm', onclick: () => linkDialog(e) }, 'קישור'), moreMenu(e));
    }
    return el('div', { class: 'emp' },
      el('div', {}, el('div', { class: 'emp-name' }, el('a', { href: '#/employee/' + e.id }, e.name)), roleLine(e) ? el('div', { class: 'muted small' }, roleLine(e)) : null),
      el('span', { class: 'row', style: 'gap:.3rem' }, el('span', { class: 'chip ' + st.c }, st.t),
        interviewsOf(e.id).length ? el('span', { class: 'chip info', title: 'יש ראיון אישי' }, 'רואיין') : null),
      el('div', { class: 'emp-progress small muted' }, `${done} מתוך ${total} תשובות`, el('div', { class: 'mini-bar' }, fill)),
      actions);
  }

  function moreMenu(e) {
    const pop = el('div', { class: 'menu-pop hidden', role: 'menu' });
    const item = (t, fn, danger) => el('button', { role: 'menuitem', class: danger ? 'danger' : '', onclick: () => { pop.classList.add('hidden'); fn(); } }, t);
    pop.append(
      item('עריכת שם ותפקיד', () => editEmployee(e)),
      e.status === 'submitted' ? item('פתיחה מחדש לעריכה', async () => {
        if (!(await confirmDlg('פתיחה מחדש', `${e.name} יוכל/תוכל לערוך שוב את השאלון דרך אותו קישור. התשובות הקיימות נשמרות.`, 'פתיחה מחדש'))) return;
        await patchEmp(e, { reopen: true }, 'השאלון נפתח מחדש');
      }) : null,
      item('יצירת קישור חדש', async () => {
        if (!(await confirmDlg('קישור חדש', 'הקישור הקודם יפסיק לעבוד מיד. השתמש בזה אם הקישור הגיע לאדם הלא נכון.', 'יצירת קישור חדש'))) return;
        await patchEmp(e, { regenerate: true }, 'נוצר קישור חדש');
        linkDialog(data.employees.find(x => x.id === e.id));
      }),
      item('מחיקת העובד', async () => {
        if (!(await confirmDlg('מחיקת עובד', `למחוק את ${e.name} ואת כל התשובות שלו/ה? לא ניתן לבטל — מומלץ לגבות לפני כן.`, 'מחיקה', true))) return;
        try { await api('/api/employees/' + e.id, { method: 'DELETE', body: {} }); await reload(); route(); toast('העובד נמחק'); }
        catch (er) { toast(er.message); }
      }, true));
    const btn = el('button', { class: 'btn sm icon', 'aria-label': 'פעולות נוספות', 'aria-haspopup': 'menu', onclick: ev => {
      ev.stopPropagation();
      document.querySelectorAll('.menu-pop').forEach(p => p !== pop && p.classList.add('hidden'));
      pop.classList.toggle('hidden');
    } }, '⋯');
    return el('div', { class: 'menu' }, btn, pop);
  }
  document.addEventListener('click', () => document.querySelectorAll('.menu-pop').forEach(p => p.classList.add('hidden')));

  async function patchEmp(e, body, msg) {
    try { await api('/api/employees/' + e.id, { method: 'PATCH', body }); await reload(); route(); toast(msg); }
    catch (er) { toast(er.message); }
  }
  function editEmployee(e) {
    const n = el('input', { type: 'text', value: e.name }), r = el('input', { type: 'text', value: e.role_title || '' }), t = el('input', { type: 'text', value: e.team || '' });
    dialog({
      title: 'עריכת עובד', okText: 'שמירה',
      body: el('div', {}, el('label', { class: 'field' }, el('span', {}, 'שם'), n), el('label', { class: 'field' }, el('span', {}, 'תפקיד'), r), el('label', { class: 'field' }, el('span', {}, 'צוות'), t), suggest(r, 'role_title'), suggest(t, 'team')),
      onOk: async () => { await api('/api/employees/' + e.id, { method: 'PATCH', body: { name: n.value, role_title: r.value, team: t.value } }); await reload(); route(); },
    });
  }

  /* ===== תיק אישי ===== */
  function teamAvg(qid) {
    const vals = data.employees.map(e => e.response?.answers?.[qid]).filter(v => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  function viewDossier(id) {
    const list = data.employees;
    const i = list.findIndex(e => e.id === id);
    const e = list[i];
    if (!e) { $view.replaceChildren(el('div', { class: 'notice' }, 'העובד לא נמצא. ', el('a', { href: '#/employees' }, 'חזרה לרשימה'))); return; }
    const a = e.response?.answers || {};
    const st = STATUS[e.status] || STATUS.invited;
    const prev = list[i - 1], next = list[i + 1];

    const head = el('div', { class: 'card' },
      el('div', { class: 'dossier-head' },
        el('div', {},
          el('h1', {}, e.name),
          el('div', { class: 'meta' },
            e.role_title ? el('span', {}, e.role_title) : null,
            e.team ? el('span', {}, e.team) : null,
            el('span', { class: 'chip ' + st.c }, st.t),
            e.submitted_at ? el('span', {}, 'הוגש: ' + formatTs(e.submitted_at)) : e.response ? el('span', {}, 'עודכן: ' + formatTs(e.response.updated_at)) : null,
            el('span', {}, 'נוסף: ' + formatTs(e.created_at)))),
        el('div', { class: 'row no-print' },
          prev ? el('a', { class: 'btn sm', href: '#/employee/' + prev.id, title: prev.name }, '→ הקודם') : null,
          next ? el('a', { class: 'btn sm', href: '#/employee/' + next.id, title: next.name }, 'הבא ←') : null,
          el('button', { class: 'btn sm', onclick: () => print() }, 'הדפסה / PDF'),
          isAdmin() ? el('button', { class: 'btn sm', onclick: () => linkDialog(e) }, 'קישור') : null)));

    const cards = data.form.definition.sections.filter(s => s.questions.length).map(s =>
      el('div', { class: 'card' }, el('h2', {}, s.title),
        s.questions.map(q => {
          const v = a[q.id];
          let val;
          if (isEmpty(v)) val = el('div', { class: 'ans-v empty' }, 'לא נענה');
          else if (q.type === 'scale') {
            const range = scaleRange(q);
            const avg = teamAvg(q.id);
            val = el('div', { class: 'ans-v' },
              el('span', { class: 'pips', 'aria-hidden': 'true' }, range.map(n => el('i', { class: n <= v ? 'on' : '' }))),
              answerText(q, a),
              avg !== null ? el('span', { class: 'vs-team' }, `(ממוצע הצוות ${avg.toFixed(1)})`) : null);
          } else val = el('div', { class: 'ans-v' }, answerText(q, a));
          return el('div', { class: 'ans-row' }, el('div', { class: 'ans-q' }, q.label), val);
        })));

    fill($view,
      el('div', { class: 'no-print', style: 'margin-bottom:.75rem' }, el('a', { href: '#/employees', class: 'small' }, '→ כל העובדים')),
      head, isAdmin() ? interviewsCard(e) : null, ...cards);
    if (justSaved) { document.getElementById('iv-' + justSaved)?.scrollIntoView({ block: 'center' }); justSaved = null; }
  }

  /* ===== ראיונות אישיים ===== */
  let justSaved = null;
  const interviewsOf = id => (data.interviews || []).filter(iv => iv.employee_id === id);
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  function interviewsCard(e) {
    const ivs = interviewsOf(e.id);
    return el('div', { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:.5rem' },
        el('h2', { style: 'margin:0' }, 'ראיונות אישיים'),
        el('a', { class: 'btn sm primary no-print', href: '#/interviews/' + e.id }, '+ ראיון חדש')),
      ivs.length ? ivs.map(iv => el('div', { class: 'iv' + (iv.id === justSaved ? ' fresh' : ''), id: 'iv-' + iv.id },
        el('div', { class: 'iv-head' },
          el('b', {}, EP.formatDate(iv.interview_date)),
          el('span', { class: 'muted small' }, `ראיין/ה: ${iv.author || '—'}${iv.updated_at > iv.created_at + 1000 ? ' · עודכן ' + formatTs(iv.updated_at) : ''}`),
          el('span', { class: 'row no-print', style: 'gap:.3rem;margin-inline-start:auto' },
            el('a', { class: 'btn sm', href: '#/interviews/edit/' + iv.id }, 'עריכה'),
            el('button', { class: 'btn sm danger', onclick: async () => {
              if (!(await confirmDlg('מחיקת ראיון', `למחוק את הראיון מ-${EP.formatDate(iv.interview_date)}? לא ניתן לבטל.`, 'מחיקה', true))) return;
              try { await api('/api/interviews/' + iv.id, { method: 'DELETE', body: {} }); await reload(); route(); toast('הראיון נמחק'); } catch (er) { toast(er.message); }
            } }, 'מחיקה'))),
        el('div', { class: 'iv-text' }, iv.summary)))
        : el('p', { class: 'muted', style: 'margin:0' }, 'עדיין לא נערך ראיון.'));
  }

  // תמונת מצב מרוכזת של עובד — לצד טופס הראיון
  function employeeSnapshot(e, excludeIv) {
    const a = e.response?.answers || {};
    const st = STATUS[e.status] || STATUS.invited;
    const qs = allQs(data.form);
    const bq = qs.find(({ q }) => q.type === 'date' && q.isBirthdate)?.q;
    const age = bq && a[bq.id] ? ageFrom(a[bq.id]) : null;
    const facts = [e.role_title, e.team, Number.isFinite(age) ? `גיל ${age}` : null,
      ...qs.filter(({ q }) => q.groupInDashboard && !isEmpty(a[q.id])).map(({ q }) => a[q.id])].filter(Boolean);
    const out = [el('div', { class: 'snap-head' },
      el('h2', {}, e.name),
      el('div', { class: 'meta' }, facts.map(f => el('span', {}, f)), el('span', { class: 'chip ' + st.c }, st.t)),
      el('a', { class: 'small', href: '#/employee/' + e.id }, 'לתיק האישי המלא ←'))];

    if (!e.response) out.push(el('div', { class: 'notice', style: 'margin:0' }, 'העובד עדיין לא מילא את השאלון.'));
    const scales = qs.filter(({ q }) => q.type === 'scale' && typeof a[q.id] === 'number');
    if (scales.length) out.push(el('div', { class: 'snap-sec' },
      el('h3', {}, 'כישורים מול ממוצע הצוות'),
      el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'l3' }), 'העובד'), el('span', {}, el('i', { class: 'cmp-key' }), 'ממוצע הצוות')),
      scales.map(({ q }) => cmpRow(q, a[q.id]))));
    for (const s of data.form.definition.sections) {
      const items = s.questions.filter(q => q.type !== 'scale' && !isEmpty(a[q.id]));
      if (!items.length) continue;
      out.push(el('div', { class: 'snap-sec' }, el('h3', {}, s.title),
        el('dl', { class: 'snap-dl' }, items.flatMap(q => [el('dt', {}, q.label), el('dd', {}, answerText(q, a))]))));
    }
    const prev = interviewsOf(e.id).filter(iv => iv.id !== excludeIv);
    if (prev.length) out.push(el('div', { class: 'snap-sec' }, el('h3', {}, `ראיונות קודמים (${prev.length})`),
      prev.map((iv, i) => el('details', { class: 'snap-iv', open: i === 0 },
        el('summary', {}, `${EP.formatDate(iv.interview_date)} · ${iv.author || ''}`), el('div', { class: 'iv-text' }, iv.summary)))));
    return out;
  }

  // פס אחד לשאלת סולם: מילוי = העובד, קו = ממוצע הצוות; רמה 1 מתוך 5 = 20%
  function cmpRow(q, v) {
    const min = q.scale?.min ?? 1, max = q.scale?.max ?? 5;
    const pos = x => (x - min + 1) / (max - min + 1) * 100;
    const avg = teamAvg(q.id);
    const fillBar = el('div', { class: 'cmp-fill ' + levelClass(q, v) }); fillBar.style.width = pos(v) + '%';
    const track = el('div', { class: 'cmp-track', 'data-tip': `${q.label}: ${answerText(q, { [q.id]: v })}${avg !== null ? ` · ממוצע הצוות ${avg.toFixed(1)}` : ''}` }, fillBar);
    if (avg !== null) { const tick = el('i', { class: 'cmp-avg' }); tick.style.insetInlineStart = `calc(${pos(avg)}% - 1px)`; track.append(tick); }
    const diff = avg === null ? 0 : v - avg;
    return el('div', { class: 'cmp' },
      el('div', { class: 'cmp-top' }, el('span', {}, q.label),
        el('span', { class: 'num' }, el('b', {}, String(v)), avg !== null ? el('span', { class: 'muted small' }, ` / צוות ${avg.toFixed(1)}`) : null,
          diff >= 1 ? el('span', { class: 'chip good', style: 'margin-inline-start:.35rem' }, 'מעל') : diff <= -1 ? el('span', { class: 'chip warn', style: 'margin-inline-start:.35rem' }, 'מתחת') : null)),
      track);
  }

  // הטקסט נשמר במכשיר תוך כדי הקלדה — כדי שראיון ארוך לא יאבד אם פג תוקף ההתחברות או נסגר הדף
  const IV_DRAFT = key => 'ep-iv-draft:' + key;
  const ivDraftGet = key => { try { return JSON.parse(localStorage.getItem(IV_DRAFT(key)) || 'null'); } catch { return null; } };
  const ivDraftSet = (key, v) => { try { v ? localStorage.setItem(IV_DRAFT(key), JSON.stringify(v)) : localStorage.removeItem(IV_DRAFT(key)); } catch { /* אחסון חסום */ } };

  function viewInterview(arg, arg2) {
    const editing = arg === 'edit' ? (data.interviews || []).find(iv => iv.id === Number(arg2)) : null;
    if (arg === 'edit' && !editing) return $view.replaceChildren(el('div', { class: 'notice' }, 'הראיון לא נמצא.'));
    const key = editing ? 'edit-' + editing.id : 'new';
    const draft = ivDraftGet(key);
    const pre = editing ? { emp: editing.employee_id, date: editing.interview_date, text: editing.summary }
                        : { emp: Number(arg) || null, date: today(), text: '' };
    const restored = draft && draft.text && draft.text !== pre.text;
    const cur = restored ? { ...pre, ...draft } : pre;

    // רשימת העובדים מקובצת לפי צוות
    const teams = [...distinct('team'), ''];
    const sel = el('select', { 'aria-label': 'בחירת עובד', disabled: !!editing },
      el('option', { value: '' }, 'בחר/י עובד…'),
      teams.map(t => {
        const g = data.employees.filter(e => (e.team || '') === t);
        if (!g.length) return null;
        const opts = g.map(e => el('option', { value: e.id, selected: e.id === cur.emp }, e.name + (e.role_title ? ` — ${e.role_title}` : '') + (interviewsOf(e.id).length ? ' ✓' : '')));
        return teams.length > 1 ? el('optgroup', { label: t || 'ללא צוות' }, opts) : opts;
      }));
    const date = el('input', { type: 'date', value: cur.date, max: today(), 'aria-label': 'תאריך הראיון', style: 'width:auto' });
    const text = el('textarea', { class: 'iv-input', placeholder: 'סיכום הראיון…', 'aria-label': 'סיכום הראיון' }, cur.text);
    const saveDraft = () => ivDraftSet(key, text.value.trim() ? { emp: Number(sel.value) || null, date: date.value, text: text.value } : null);
    text.addEventListener('input', saveDraft); sel.addEventListener('change', saveDraft); date.addEventListener('change', saveDraft);

    const save = async ev => {
      const empId = Number(sel.value);
      if (!empId) { sel.focus(); return toast('נא לבחור עובד'); }
      if (!text.value.trim()) { text.focus(); return toast('סיכום הראיון ריק'); }
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const body = { employee_id: empId, date: date.value, summary: text.value };
        const r = editing ? await api('/api/interviews/' + editing.id, { method: 'PATCH', body })
                          : await api('/api/interviews', { method: 'POST', body });
        ivDraftSet(key, null);
        await reload();
        justSaved = r.interview.id;
        toast('הראיון נשמר');
        location.hash = '#/employee/' + empId;
      } catch (e) {
        btn.disabled = false;
        if (e.status === 401) { toast('פג תוקף ההתחברות. הטקסט שמור במכשיר — התחבר/י מחדש וחזור/י ללשונית הראיונות', 6000); setTimeout(() => location.reload(), 2500); }
        else toast(e.message, 4000);
      }
    };
    const cancel = () => {
      ivDraftSet(key, null);
      location.hash = editing ? '#/employee/' + editing.employee_id : (cur.emp ? '#/employee/' + cur.emp : '#/employees');
    };

    const recent = (data.interviews || []).slice(0, 15);
    const empName = id => data.employees.find(e => e.id === id)?.name || '—';
    // לוח נתוני העובד ליד הטופס — מתעדכן כשמחליפים עובד
    const side = el('aside', { class: 'card iv-side', 'aria-label': 'נתוני העובד' });
    const drawSide = () => {
      const e = data.employees.find(x => x.id === Number(sel.value));
      fill(side, e ? employeeSnapshot(e, editing?.id) : el('p', { class: 'muted', style: 'margin:0' }, 'בחר/י עובד כדי לראות כאן את כל הנתונים שלו מהתיק האישי.'));
      side.scrollTop = 0;
    };
    sel.addEventListener('change', drawSide);
    drawSide();
    fill($view,
      pageHead(editing ? 'עריכת ראיון' : 'ראיון אישי', editing ? empName(editing.employee_id) : 'בחר/י עובד, הקלד/י את סיכום הראיון ושמור/י. הראיון יישמר בתיק האישי.'),
      restored ? el('div', { class: 'notice' }, 'שוחזרה טיוטה שלא נשמרה' + (cur.emp && !editing ? ` (${empName(cur.emp)})` : '') + '. ',
        el('button', { class: 'btn sm ghost', onclick: () => { ivDraftSet(key, null); viewInterview(arg, arg2); } }, 'מחיקת הטיוטה')) : null,
      el('div', { class: 'iv-layout' },
        el('div', { class: 'card iv-form' },
          el('div', { class: 'row', style: 'margin-bottom:.75rem' },
            el('label', { class: 'grow' }, el('span', { class: 'small muted' }, 'עובד'), sel),
            el('label', {}, el('span', { class: 'small muted' }, 'תאריך הראיון'), date)),
          el('label', {}, el('span', { class: 'small muted' }, 'סיכום הראיון'), text),
          el('div', { class: 'row', style: 'margin-top:.75rem' },
            el('button', { class: 'btn primary', onclick: save }, editing ? 'שמירת שינויים' : 'שמירה ומעבר לתיק האישי'),
            el('button', { class: 'btn ghost', onclick: cancel }, 'ביטול'),
            el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'הטקסט נשמר במכשיר תוך כדי הקלדה'))),
        side),
      !editing && recent.length ? el('div', { class: 'card' }, el('h3', {}, 'ראיונות אחרונים'),
        el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'תאריך'), el('th', {}, 'עובד'), el('th', {}, 'ראיין/ה'), el('th', {}, ''))),
          el('tbody', {}, recent.map(iv => el('tr', {},
            el('td', { class: 'num' }, EP.formatDate(iv.interview_date)),
            el('td', {}, el('a', { href: '#/employee/' + iv.employee_id }, empName(iv.employee_id))),
            el('td', { class: 'muted' }, iv.author || '—'),
            el('td', { class: 'muted small iv-snip' }, iv.summary.split('\n')[0].slice(0, 80)))))))) : null);
    if (!editing && !cur.emp) sel.focus(); else text.focus();
  }

  /* ===== משובים: אירועים, לקחים וטבלאות ===== */
  const fb = { selected: null, cat: null, sort: { key: 'created_at', dir: -1 }, q: '', kind: '', author: '', event: '' };
  let fbMeta = { categories: [], kinds: [] };
  const fbCat = id => fbMeta.categories.find(c => c.id === id)?.label || '—';
  const fbKind = id => fbMeta.kinds.find(k => k.id === id)?.label || '—';
  const eventLink = ev => `${location.origin}/l#${ev.link_key}`;

  async function viewFeedback() {
    fill($view, pageHead('משובים'), el('p', { class: 'muted' }, 'טוען…'));
    let events, lessons;
    try {
      const r = await api('/api/events');
      events = r.events; fbMeta = { categories: r.categories, kinds: r.kinds };
      if (fb.selected) fb.selected = new Set([...fb.selected].filter(id => events.some(e => e.id === id)));
      const ids = fb.selected ? [...fb.selected] : [];
      lessons = fb.selected && !ids.length ? [] : (await api('/api/lessons' + (ids.length ? '?events=' + ids.join(',') : ''))).lessons;
    } catch (e) { return fill($view, pageHead('משובים'), el('div', { class: 'notice error' }, e.message)); }

    const nodes = [pageHead('משובים', 'לקחים והערות שהוקלדו באירועים')];
    if (isAdmin()) nodes.push(eventsCard(events));
    if (!events.length) { nodes.push(el('div', { class: 'notice' }, 'עדיין אין אירועים.' + (isAdmin() ? ' צור/י אירוע כדי לקבל קישור משותף.' : ''))); return fill($view, nodes); }

    // בחירת אירועים להצגה
    const chips = el('div', { class: 'fb-chips' },
      el('button', { class: 'btn sm' + (fb.selected ? '' : ' on'), onclick: () => { fb.selected = null; viewFeedback(); } }, 'כל האירועים'),
      events.map(ev => {
        const on = !fb.selected || fb.selected.has(ev.id);
        const cb = el('input', { type: 'checkbox', checked: on });
        cb.addEventListener('change', () => {
          const s = fb.selected ? new Set(fb.selected) : new Set(events.map(e => e.id));
          cb.checked ? s.add(ev.id) : s.delete(ev.id);
          fb.selected = s.size === events.length ? null : s;
          viewFeedback();
        });
        return el('label', { class: 'fb-chip' + (on ? ' on' : '') }, cb, ev.title, el('span', { class: 'muted small' }, ` (${ev.lessons})`));
      }));
    nodes.push(el('div', { class: 'card' }, el('h3', {}, 'הצגת לקחים מ:'), chips));

    if (!lessons.length) { nodes.push(el('div', { class: 'notice' }, fb.selected && !fb.selected.size ? 'בחר/י לפחות אירוע אחד.' : 'עדיין לא הוקלדו לקחים באירועים שנבחרו.')); return fill($view, nodes); }

    const authors = new Set(lessons.map(l => l.event_id + ':' + l.author));
    nodes.push(el('div', { class: 'kpis' },
      kpi(lessons.length, 'לקחים והערות'),
      kpi(authors.size, 'משתתפים שהקלידו'),
      fbMeta.kinds.map(k => kpi(lessons.filter(l => l.kind === k.id).length, k.label))));

    // כרטיס לכל קטגוריה, עם פילוח לפי סוג
    const cards = el('div', { class: 'fb-cats' },
      [{ id: '__all', label: 'כל הקטגוריות' }, ...fbMeta.categories].map(c => {
        const ls = c.id === '__all' ? lessons : lessons.filter(l => l.category === c.id);
        return el('button', { class: `fb-cat cat-${c.id}` + (fb.cat === c.id ? ' on' : '') + (ls.length ? '' : ' empty'), onclick: () => {
          fb.cat = fb.cat === c.id ? null : c.id; fb.q = fb.kind = fb.author = fb.event = '';
          viewFeedback().then(() => document.getElementById('fb-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        } },
          el('div', { class: 'fb-cat-head' }, el('span', {}, c.label), el('b', { class: 'num' }, String(ls.length))),
          el('div', { class: 'fb-kinds' }, fbMeta.kinds.map(k => {
            const n = ls.filter(l => l.kind === k.id).length;
            return el('div', { class: n ? '' : 'zero' }, el('span', {}, k.label), el('span', { class: 'num' }, String(n)));
          })));
      }));
    nodes.push(el('div', { class: 'dash-sec' }, el('h2', {}, 'לפי קטגוריה'), el('p', { class: 'muted small' }, 'לחיצה על קטגוריה פותחת טבלה עם כל ההקלדות.'), cards));

    if (fb.cat) nodes.push(lessonsTable(fb.cat === '__all' ? lessons : lessons.filter(l => l.category === fb.cat), events));
    fill($view, nodes);
  }

  function eventsCard(events) {
    const title = el('input', { type: 'text', placeholder: 'כותרת האירוע, למשל "אימון נובמבר 2026"', 'aria-label': 'כותרת האירוע' });
    const pw = el('input', { type: 'text', placeholder: 'סיסמה משותפת (4 תווים לפחות)', dir: 'ltr', autocomplete: 'off', 'aria-label': 'סיסמת האירוע' });
    const create = async () => {
      try {
        const r = await api('/api/events', { method: 'POST', body: { title: title.value, password: pw.value } });
        toast('האירוע נוצר');
        await viewFeedback();
        eventLinkDialog(r.event, pw.value);
      } catch (e) { toast(e.message, 4000); }
    };
    return el('div', { class: 'card' },
      el('h3', {}, 'אירועים'),
      el('div', { class: 'row' }, el('div', { class: 'grow' }, title), el('div', { class: 'grow' }, pw),
        el('button', { class: 'btn primary', onclick: create }, 'יצירת אירוע וקישור')),
      events.length ? el('div', { class: 'fb-events' }, events.map(ev => el('div', { class: 'fb-ev' },
        el('div', { class: 'grow' }, el('b', {}, ev.title), ' ',
          el('span', { class: 'chip ' + (ev.active ? 'good' : '') }, ev.active ? 'פתוח להקלדה' : 'סגור'),
          el('div', { class: 'muted small' }, `${ev.lessons} לקחים · ${ev.authors} משתתפים · נוצר ${formatTs(ev.created_at)}${ev.last_at ? ' · הקלדה אחרונה ' + formatTs(ev.last_at) : ''}`)),
        el('button', { class: 'btn sm', onclick: () => eventLinkDialog(ev) }, 'קישור'),
        eventMenu(ev)))) : null);
  }

  function eventLinkDialog(ev, password) {
    const link = eventLink(ev);
    const msg = `קישור להקלדת לקחים והערות — ${ev.title}:\n${link}\nכניסה עם השם המלא שלך והסיסמה המשותפת.`;
    dialog({
      title: `קישור לאירוע — ${ev.title}`, cancelText: null, okText: 'סגירה',
      body: el('div', {},
        el('p', { class: 'muted small' }, 'קישור אחד משותף לכל המשתתפים. כל אחד נכנס עם השם המלא שלו והסיסמה שקבעת.'),
        el('input', { type: 'text', value: link, readonly: true, dir: 'ltr', onfocus: x => x.target.select() }),
        password ? el('p', { class: 'small', style: 'margin-top:.6rem' }, 'הסיסמה: ', el('b', { dir: 'ltr' }, password), el('span', { class: 'muted' }, ' — רשום/י אותה. אחרי סגירת החלון אפשר רק להחליף אותה.')) : null,
        el('div', { class: 'row', style: 'margin-top:.75rem' },
          el('button', { class: 'btn primary', onclick: () => copy(link) }, 'העתקת קישור'),
          el('button', { class: 'btn', onclick: () => copy(msg, 'ההודעה הועתקה') }, 'העתקת הודעה מוכנה'),
          el('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener noreferrer' }, 'שליחה בוואטסאפ'))),
    });
  }

  function eventMenu(ev) {
    const pop = el('div', { class: 'menu-pop hidden', role: 'menu' });
    const patch = async (body, msg) => { try { await api('/api/events/' + ev.id, { method: 'PATCH', body }); toast(msg); viewFeedback(); } catch (e) { toast(e.message, 4000); } };
    const item = (t, fn, danger) => el('button', { role: 'menuitem', class: danger ? 'danger' : '', onclick: () => { pop.classList.add('hidden'); fn(); } }, t);
    pop.append(
      item('שינוי כותרת', () => {
        const t = el('input', { type: 'text', value: ev.title });
        dialog({ title: 'שינוי כותרת', okText: 'שמירה', body: el('label', { class: 'field' }, el('span', {}, 'כותרת'), t),
          onOk: async () => { await api('/api/events/' + ev.id, { method: 'PATCH', body: { title: t.value } }); viewFeedback(); } });
      }),
      item('שינוי סיסמה', () => {
        const p = el('input', { type: 'text', dir: 'ltr', autocomplete: 'off' });
        dialog({ title: 'סיסמה חדשה לאירוע', okText: 'שמירה', body: el('div', {}, el('label', { class: 'field' }, el('span', {}, 'סיסמה חדשה'), p), el('p', { class: 'small muted' }, 'מי שכבר מחובר ממשיך לעבוד. כניסות חדשות ידרשו את הסיסמה החדשה.')),
          onOk: async () => { await api('/api/events/' + ev.id, { method: 'PATCH', body: { password: p.value } }); toast('הסיסמה עודכנה'); } });
      }),
      item(ev.active ? 'סגירה להקלדה' : 'פתיחה מחדש להקלדה', () => patch({ active: !ev.active }, ev.active ? 'האירוע נסגר להקלדה' : 'האירוע נפתח מחדש')),
      item('יצירת קישור חדש', async () => {
        if (!(await confirmDlg('קישור חדש', 'הקישור הקודם יפסיק לעבוד מיד, וכל המחוברים ינותקו. ההערות שכבר הוקלדו נשמרות.', 'יצירת קישור חדש'))) return;
        patch({ regenerate: true }, 'נוצר קישור חדש');
      }),
      item('מחיקת האירוע', async () => {
        if (!(await confirmDlg('מחיקת אירוע', `למחוק את "${ev.title}" ואת כל ${ev.lessons} הלקחים שהוקלדו בו? לא ניתן לבטל.`, 'מחיקה', true))) return;
        try { await api('/api/events/' + ev.id, { method: 'DELETE', body: {} }); toast('האירוע נמחק'); viewFeedback(); } catch (e) { toast(e.message); }
      }, true));
    const btn = el('button', { class: 'btn sm icon', 'aria-label': 'פעולות נוספות', 'aria-haspopup': 'menu', onclick: e => {
      e.stopPropagation();
      document.querySelectorAll('.menu-pop').forEach(p => p !== pop && p.classList.add('hidden'));
      pop.classList.toggle('hidden');
    } }, '⋯');
    return el('div', { class: 'menu' }, btn, pop);
  }

  // טבלת לקחים עם סינון, מיון וייצוא. רק גוף הטבלה נבנה מחדש בשינוי סינון — כדי שהפוקוס לא יקפוץ מתיבת החיפוש.
  function lessonsTable(rows, events) {
    const multiEvent = new Set(rows.map(l => l.event_id)).size > 1;
    const allCats = fb.cat === '__all';
    const catTitle = allCats ? 'כל הקטגוריות' : fbCat(fb.cat);
    const cols = [
      { key: 'kind', label: 'סוג', val: l => fbKind(l.kind) },
      allCats ? { key: 'category', label: 'קטגוריה', val: l => fbCat(l.category) } : null,
      { key: 'author', label: 'שם המשתמש', val: l => l.author },
      { key: 'created_at', label: 'תאריך ושעה', val: l => formatTs(l.created_at), sortVal: l => l.created_at },
      multiEvent ? { key: 'event_title', label: 'אירוע', val: l => l.event_title } : null,
      { key: 'body', label: 'תוכן ההקלדה', val: l => l.body },
    ].filter(Boolean);

    const q = el('input', { type: 'search', placeholder: 'חיפוש בתוכן או בשם', value: fb.q, 'aria-label': 'חיפוש' });
    const sel = (key, label, values) => {
      const s = el('select', { 'aria-label': label }, el('option', { value: '' }, label + ': הכול'), values.map(([v, t]) => el('option', { value: v, selected: fb[key] === v }, t)));
      s.addEventListener('change', () => { fb[key] = s.value; draw(); });
      return s;
    };
    const kindSel = sel('kind', 'סוג', fbMeta.kinds.map(k => [k.id, k.label]));
    const authorSel = sel('author', 'משתמש', [...new Set(rows.map(l => l.author))].sort(heSort).map(a => [a, a]));
    const eventSel = multiEvent ? sel('event', 'אירוע', [...new Map(rows.map(l => [String(l.event_id), l.event_title]))]) : null;
    q.addEventListener('input', () => { fb.q = q.value; draw(); });

    const count = el('span', { class: 'muted small' });
    const thead = el('thead');
    const tbody = el('tbody');
    const visible = () => {
      const t = fb.q.trim();
      const out = rows.filter(l => (!fb.kind || l.kind === fb.kind) && (!fb.author || l.author === fb.author) &&
        (!fb.event || String(l.event_id) === fb.event) && (!t || l.body.includes(t) || l.author.includes(t)));
      const col = cols.find(c => c.key === fb.sort.key) || cols.find(c => c.key === 'created_at');
      const sv = col.sortVal || col.val;
      return out.sort((a, b) => { const x = sv(a), y = sv(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'he')) * fb.sort.dir; });
    };
    function draw() {
      fill(thead, el('tr', {}, cols.map(c => el('th', { scope: 'col' },
        el('button', { class: 'th-sort', onclick: () => { fb.sort = { key: c.key, dir: fb.sort.key === c.key ? -fb.sort.dir : 1 }; draw(); },
          'aria-sort': fb.sort.key === c.key ? (fb.sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
          c.label, fb.sort.key === c.key ? (fb.sort.dir > 0 ? ' ▲' : ' ▼') : ''))),
        isAdmin() ? el('th', { class: 'no-print' }) : null));
      const v = visible();
      count.textContent = `${v.length} מתוך ${rows.length}`;
      fill(tbody, v.length ? v.map(l => el('tr', {},
        cols.map(c => el('td', { class: c.key === 'body' ? 'fb-body' : c.key === 'created_at' ? 'num nowrap' : c.key === 'kind' ? 'nowrap' : '' }, c.val(l))),
        isAdmin() ? el('td', { class: 'no-print' }, el('button', { class: 'btn sm ghost icon', 'aria-label': 'מחיקה', title: 'מחיקה', onclick: async () => {
          if (!(await confirmDlg('מחיקת לקח', `למחוק את ההקלדה של ${l.author}?`, 'מחיקה', true))) return;
          try { await api('/api/lessons/' + l.id, { method: 'DELETE', body: {} }); toast('נמחק'); viewFeedback(); } catch (e) { toast(e.message); }
        } }, '🗑')) : null))
        : el('tr', {}, el('td', { colspan: cols.length + 1, class: 'muted' }, 'אין תוצאות')));
    }
    draw();

    const evNames = [...new Set(rows.map(l => l.event_title))].join(', ');
    const exportCsv = () => {
      const cell = x => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [cols.map(c => c.label), ...visible().map(l => cols.map(c => c.val(l)))];
      download(`לקחים-${catTitle}-${stamp()}.csv`, '﻿' + lines.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    };
    const card = el('div', { class: 'card fb-table-card', id: 'fb-table' },
      el('div', { class: 'fb-print-head' }, el('h2', {}, `לקחים — ${catTitle}`), el('div', {}, `${evNames} · הופק ${formatTs(Date.now())}`)),
      el('div', { class: 'row no-print', style: 'justify-content:space-between;margin-bottom:.75rem' },
        el('h2', { style: 'margin:0' }, catTitle),
        el('div', { class: 'row', style: 'gap:.4rem' },
          el('button', { class: 'btn sm', onclick: exportCsv }, 'ייצוא לאקסל'),
          el('button', { class: 'btn sm', onclick: () => printOnly(card) }, 'ייצוא ל-PDF'),
          el('button', { class: 'btn sm ghost', onclick: () => { fb.cat = null; viewFeedback(); } }, 'סגירה'))),
      el('div', { class: 'row no-print fb-filters' }, el('div', { class: 'grow' }, q), kindSel, authorSel, eventSel, count),
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl fb-tbl' }, thead, tbody)));
    return card;
  }

  // הדפסה של כרטיס אחד בלבד (PDF דרך "שמירה כ-PDF" בחלון ההדפסה)
  function printOnly(node) {
    document.body.classList.add('print-one'); node.classList.add('print-target');
    const done = () => { document.body.classList.remove('print-one'); node.classList.remove('print-target'); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done);
    print();
  }

  /* ===== דשבורד ===== */
  function pool() {
    return data.employees.filter(e => e.response && (e.status === 'submitted' || dash.includeDrafts) && (!dash.role || e.role_title === dash.role) && (!dash.team || e.team === dash.team));
  }
  function levelClass(q, v) {
    const min = q.scale?.min ?? 1, max = q.scale?.max ?? 5;
    const t = max === min ? 1 : (v - min) / (max - min);
    return 'l' + (1 + Math.round(t * 4));
  }
  function band(q, v) {
    const min = q.scale?.min ?? 1, max = q.scale?.max ?? 5;
    const t = max === min ? 1 : (v - min) / (max - min);
    return t < 0.4 ? 'low' : t > 0.6 ? 'high' : 'mid';
  }
  const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
  // טווח מספרים מבודד כ-LTR, אחרת בעמוד RTL "31–46" מוצג הפוך כ-"46–31"
  const span = (a, b) => `\u2066${a}–${b}\u2069`;
  const names = list => list.map(e => e.name).join(', ');

  function viewDashboard() {
    const emps = pool();
    const roles = distinct('role_title'), teams = distinct('team');

    const filters = el('div', { class: 'filters no-print' },
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: dash.includeDrafts, onchange: e => { dash.includeDrafts = e.target.checked; viewDashboard(); } }), 'לכלול שאלונים שטרם הוגשו'),
      teams.length ? el('label', {}, 'צוות:', el('select', { onchange: e => { dash.team = e.target.value; viewDashboard(); } },
        el('option', { value: '' }, 'כל הצוותים'), teams.map(t => el('option', { value: t, selected: dash.team === t }, t)))) : null,
      roles.length ? el('label', {}, 'תפקיד:', el('select', { onchange: e => { dash.role = e.target.value; viewDashboard(); } },
        el('option', { value: '' }, 'כולם'), roles.map(r => el('option', { value: r, selected: dash.role === r }, r)))) : null,
      el('button', { class: 'btn sm', onclick: () => print() }, 'הדפסה / PDF'));

    // מספרי המילוי מתייחסים לצוות/לתפקיד שנבחרו בסינון
    const scope = data.employees.filter(e => (!dash.role || e.role_title === dash.role) && (!dash.team || e.team === dash.team));
    const total = scope.length;
    const submitted = scope.filter(e => e.status === 'submitted').length;
    const inProg = scope.filter(e => e.status === 'in_progress' || e.status === 'opened').length;
    const qs = allQs(data.form);
    const bq = qs.find(({ q }) => q.type === 'date' && q.isBirthdate)?.q;
    const ages = bq ? emps.map(e => ageFrom(e.response.answers[bq.id] || '')).filter(a => Number.isFinite(a)) : [];

    const kpis = el('div', { class: 'kpis' },
      kpi(total, dash.team || dash.role ? 'עובדים בסינון' : 'עובדים במערכת'),
      kpi(submitted, 'הגישו', total ? `${pct(submitted, total)}% מהצוות` : ''),
      kpi(inProg, 'בתהליך מילוי'),
      kpi(total - submitted - inProg, 'טרם פתחו'),
      ages.length ? kpi((ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1), 'גיל ממוצע', `טווח ${span(Math.min(...ages), Math.max(...ages))}`) : null);

    const nodes = [pageHead('דשבורד צוות', `מבוסס על ${emps.length} עובדים${dash.team ? ' · ' + dash.team : ''}${dash.role ? ' · ' + dash.role : ''}`), filters, kpis];

    if (!emps.length) {
      nodes.push(el('div', { class: 'notice' }, submitted || !scope.some(e => e.response)
        ? 'אין עדיין נתונים להצגה. כשעובדים יגישו את השאלון, הניתוח יופיע כאן.'
        : 'אף עובד לא הגיש עדיין. סמן "לכלול שאלונים שטרם הוגשו" כדי לראות את מה שמולא עד כה.'));
      return $view.replaceChildren(...nodes.filter(Boolean));
    }

    const scaleQs = qs.filter(({ q }) => q.type === 'scale');
    if (scaleQs.length) nodes.push(skillsSection(scaleQs, emps), heatSection(scaleQs.map(x => x.q), emps));

    const cards = [];
    for (const { q } of qs) {
      if (q.type === 'single' || q.type === 'dropdown' || q.type === 'multi') cards.push(choiceCard(q, emps));
      else if (q.type === 'date' && q.isBirthdate) cards.push(ageCard(q, emps));
      else if (q.type === 'short' && q.groupInDashboard) cards.push(groupCard(q, emps));
      else if (q.type === 'number') cards.push(numberCard(q, emps));
      else if (q.type === 'yesno') cards.push(yesnoCard(q, emps));
    }
    if (cards.length) nodes.push(el('div', { class: 'dash-sec' }, el('h2', {}, 'פילוח נתונים'), el('div', { class: 'grid2' }, cards)));

    const longs = qs.filter(({ q }) => q.type === 'long').map(({ q }) => textCard(q, emps)).filter(Boolean);
    if (longs.length) nodes.push(el('div', { class: 'dash-sec' }, el('h2', {}, 'תשובות פתוחות'), el('div', { class: 'grid2' }, longs)));

    $view.replaceChildren(...nodes.filter(Boolean));
  }

  function kpi(v, l, s) {
    return el('div', { class: 'kpi' }, el('div', { class: 'v' }, String(v)), el('div', { class: 'l' }, l), s ? el('div', { class: 's' }, s) : null);
  }

  function scaleStats(q, emps) {
    const range = scaleRange(q);
    const by = Object.fromEntries(range.map(n => [n, []]));
    for (const e of emps) { const v = e.response.answers[q.id]; if (by[v]) by[v].push(e); }
    const answered = range.reduce((s, n) => s + by[n].length, 0);
    const avg = answered ? range.reduce((s, n) => s + n * by[n].length, 0) / answered : null;
    const bands = { low: [], mid: [], high: [] };
    for (const n of range) bands[band(q, n)].push(...by[n]);
    return { range, by, answered, avg, bands };
  }

  function skillsSection(scaleQs, emps) {
    const first = scaleQs[0].q;
    const legend = el('div', { class: 'legend' }, scaleRange(first).map(n => el('span', {}, el('i', { class: levelClass(first, n) }), `${n}${scaleLabel(first, n) ? ' ' + scaleLabel(first, n) : ''}`)));
    const groups = [];
    for (const s of data.form.definition.sections) {
      let items = scaleQs.filter(x => x.s === s).map(({ q }) => ({ q, st: scaleStats(q, emps) }));
      if (!items.length) continue;
      if (dash.sortByAvg) items = items.sort((a, b) => (b.st.avg ?? -1) - (a.st.avg ?? -1));
      // ממוצע המקטע מנורמל ל-0–100 כדי שאפשר יהיה לשלב סולמות בטווחים שונים
      const norm = items.filter(x => x.st.avg !== null).map(x => (x.st.avg - (x.q.scale?.min ?? 1)) / ((x.q.scale?.max ?? 5) - (x.q.scale?.min ?? 1)));
      const secScore = norm.length ? Math.round(norm.reduce((a, b) => a + b, 0) / norm.length * 100) : null;
      groups.push(el('div', { class: 'sk-group' },
        el('div', { class: 'sk-group-head' }, el('h3', {}, s.title), secScore !== null ? el('span', { class: 'muted small', 'data-tip': 'ממוצע כל הסולמות במקטע, מנורמל ל-0 עד 100' }, `ציון מקטע ${secScore}/100`) : null),
        items.map(({ q, st }) => skillRow(q, st))));
    }
    const sortBtn = el('button', { class: 'btn sm no-print', onclick: () => { dash.sortByAvg = !dash.sortByAvg; viewDashboard(); } }, dash.sortByAvg ? 'לפי סדר השאלון' : 'מיון לפי חוזק');
    return el('div', { class: 'dash-sec' },
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:.75rem' }, el('h2', { style: 'margin:0' }, 'חוזקות הצוות'), sortBtn),
      el('div', { class: 'card' }, el('div', { class: 'sub' }, 'כל פס מראה כמה עובדים בחרו בכל רמה. לחיצה על שורה מציגה מי בכל רמה.'), legend, groups));
  }

  function skillRow(q, st) {
    const stack = el('div', { class: 'stack', role: 'img', 'aria-label': st.range.map(n => `רמה ${n}: ${st.by[n].length}`).join(', ') });
    for (const n of st.range) {
      const c = st.by[n].length;
      if (!c) continue;
      const seg = el('span', { class: levelClass(q, n), 'data-tip': `רמה ${n}${scaleLabel(q, n) ? ' — ' + scaleLabel(q, n) : ''}: ${c} עובדים (${pct(c, st.answered)}%)` });
      seg.style.flex = String(c);
      stack.append(seg);
    }
    const B = st.bands;
    const split = `נמוכה ${B.low.length} · בינונית ${B.mid.length} · גבוהה ${B.high.length}`;
    return el('details', { class: 'sk' },
      el('summary', {},
        el('div', {}, el('div', { class: 'sk-label' }, q.label), el('div', { class: 'sk-split' }, split)),
        st.answered ? stack : el('div', { class: 'muted small' }, 'אין תשובות'),
        el('div', { class: 'avg', 'data-tip': `ממוצע מתוך ${st.answered} תשובות` }, st.avg !== null ? st.avg.toFixed(1) : '—')),
      el('div', { class: 'sk-who' },
        [['high', 'שליטה גבוהה'], ['mid', 'בינונית'], ['low', 'נמוכה']].map(([k, t]) =>
          el('div', {}, el('b', {}, `${t} (${B[k].length}): `), B[k].length ? names(B[k].sort(byName)) : '—'))));
  }

  function heatSection(scaleQs, emps) {
    const rows = emps.filter(e => scaleQs.some(q => typeof e.response.answers[q.id] === 'number'));
    if (!rows.length) return null;
    const table = el('table', { class: 'heat' },
      el('thead', {}, el('tr', {}, el('th', {}, 'עובד'), scaleQs.map(q => el('th', { scope: 'col', title: q.label }, q.label)))),
      el('tbody', {},
        rows.map(e => el('tr', {},
          el('th', { scope: 'row' }, el('a', { href: '#/employee/' + e.id }, e.name)),
          scaleQs.map(q => {
            const v = e.response.answers[q.id];
            return typeof v === 'number'
              ? el('td', { class: levelClass(q, v), 'data-tip': `${e.name} · ${q.label}: ${answerText(q, e.response.answers)}` }, String(v))
              : el('td', { class: 'e', 'data-tip': `${e.name} · ${q.label}: לא נענה` }, '–');
          }))),
        el('tr', {}, el('th', { scope: 'row' }, 'ממוצע'), scaleQs.map(q => {
          const st = scaleStats(q, rows);
          return el('td', { class: 'avgc' }, st.avg !== null ? st.avg.toFixed(1) : '–');
        }))));
    return el('div', { class: 'dash-sec' }, el('h2', {}, 'מפת יכולות'),
      el('div', { class: 'card' }, el('div', { class: 'sub' }, 'כל שורה היא עובד, כל עמודה היא שאלת סולם. כהה יותר = רמה גבוהה יותר.'), el('div', { class: 'heat-wrap' }, table)));
  }

  // פס אופקי אחד לכל קטגוריה; לחיצה פותחת את שמות העובדים
  // absolute: אורך הפס = אחוז מתוך הבסיס של אותה שורה (ולא יחסית לשורה הגדולה)
  function hbars(items, totalBase, absolute = false) {
    const max = Math.max(1, ...items.map(x => x.list.length));
    return items.map(x => {
      const base = x.base ?? totalBase;
      const fill = el('div', { class: 'hbar-fill' + (x.list.length ? '' : ' hidden') });
      fill.style.width = (absolute ? pct(x.list.length, base) : x.list.length / max * 100) + '%';
      return el('details', { class: 'hbar' },
        el('summary', { 'data-tip': x.tip || `${x.label}: ${x.list.length} (${pct(x.list.length, base)}%)` },
          el('span', {}, x.label), el('div', { class: 'hbar-track' }, fill),
          el('span', { class: 'hbar-n' }, String(x.list.length), ' ', el('small', {}, `${pct(x.list.length, base)}%`))),
        el('div', { class: 'hbar-who' }, x.who || (x.list.length ? names(x.list.sort(byName)) : '—')));
    });
  }

  function choiceCard(q, emps) {
    const opts = [...(q.options || [])];
    if (q.allowOther) opts.push({ id: '__other', label: 'אחר' });
    const answered = emps.filter(e => !isEmpty(e.response.answers[q.id]));
    const items = opts.map(o => ({
      label: o.label,
      list: answered.filter(e => { const v = e.response.answers[q.id]; return Array.isArray(v) ? v.includes(o.id) : v === o.id; }),
    })).sort((a, b) => b.list.length - a.list.length);
    const others = q.allowOther ? answered.map(e => e.response.answers[q.id + '::other']).filter(Boolean) : [];
    return el('div', { class: 'card' },
      el('h3', {}, q.label),
      el('div', { class: 'sub' }, `${answered.length} השיבו${q.type === 'multi' ? ' · אפשר היה לבחור כמה תשובות' : ''}`),
      hbars(items, answered.length),
      others.length ? el('div', { class: 'small muted', style: 'margin-top:.5rem' }, 'פירוט "אחר": ' + [...new Set(others)].join(', ')) : null);
  }

  // רשימת כן/לא: לכל פריט, כמה ענו "כן" מתוך מי שסימן אותו. לחיצה מציגה מי כן ומי לא —
  // "לא" הוא בדרך כלל מה שהמנהל צריך (למי חסר ציוד).
  function yesnoCard(q, emps) {
    const answered = emps.filter(e => !isEmpty(e.response.answers[q.id]));
    const items = (q.items || []).map(it => {
      const pick = v => answered.filter(e => e.response.answers[q.id]?.[it.id] === v).sort(byName);
      const yes = pick('yes'), no = pick('no');
      return {
        label: it.label, list: yes, base: yes.length + no.length,
        tip: `${it.label}: כן ${yes.length}, לא ${no.length}`,
        who: el('div', {},
          el('div', {}, el('b', {}, `כן (${yes.length}): `), yes.length ? names(yes) : '—'),
          el('div', {}, el('b', {}, `לא (${no.length}): `), no.length ? names(no) : '—')),
      };
    });
    const missing = items.filter(x => x.base > x.list.length).map(x => `${x.label} (${x.base - x.list.length})`);
    return el('div', { class: 'card' },
      el('h3', {}, q.label),
      el('div', { class: 'sub' }, `${answered.length} השיבו · הפס מראה כמה ענו "כן". לחיצה על פריט מציגה מי ענה כן ומי לא`),
      hbars(items, answered.length, true),
      missing.length ? el('div', { class: 'small muted', style: 'margin-top:.5rem' }, 'ענו "לא": ' + missing.join(', ')) : null);
  }

  function groupCard(q, emps) {
    // איחוד וריאציות כתיב פשוטות (רווחים, מקפים) כדי ש"תל-אביב" ו"תל אביב" ייספרו יחד
    const norm = s => String(s).trim().replace(/[\s\-־]+/g, ' ').replace(/["'״׳]/g, '');
    const groups = new Map();
    for (const e of emps) {
      const v = e.response.answers[q.id];
      if (isEmpty(v)) continue;
      const k = norm(v);
      if (!groups.has(k)) groups.set(k, { label: String(v).trim(), list: [] });
      groups.get(k).list.push(e);
    }
    const answered = [...groups.values()].reduce((s, g) => s + g.list.length, 0);
    const items = [...groups.values()].sort((a, b) => b.list.length - a.list.length);
    const top = items.slice(0, 12), rest = items.slice(12);
    if (rest.length) top.push({ label: `אחרים (${rest.length})`, list: rest.flatMap(g => g.list) });
    return el('div', { class: 'card' }, el('h3', {}, q.label), el('div', { class: 'sub' }, `${answered} השיבו · ${groups.size} ערכים שונים`), hbars(top, answered));
  }

  function ageCard(q, emps) {
    const buckets = [['עד 24', 0, 24], [span(25, 34), 25, 34], [span(35, 44), 35, 44], [span(45, 54), 45, 54], [span(55, 64), 55, 64], ['65+', 65, 200]];
    const withAge = emps.map(e => ({ e, a: ageFrom(e.response.answers[q.id] || '') })).filter(x => Number.isFinite(x.a));
    const ages = withAge.map(x => x.a).sort((a, b) => a - b);
    const items = buckets.map(([label, lo, hi]) => ({ label, list: withAge.filter(x => x.a >= lo && x.a <= hi).map(x => x.e) }));
    const median = ages.length ? (ages.length % 2 ? ages[(ages.length - 1) / 2] : (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2) : null;
    return el('div', { class: 'card' },
      el('h3', {}, 'פילוח גילאים'),
      el('div', { class: 'sub' }, `לפי "${q.label}" · ${ages.length} השיבו`),
      ages.length ? el('div', { class: 'stats' },
        el('div', {}, el('b', {}, (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)), el('span', {}, 'ממוצע')),
        el('div', {}, el('b', {}, String(median)), el('span', {}, 'חציון')),
        el('div', {}, el('b', {}, span(ages[0], ages[ages.length - 1])), el('span', {}, 'טווח'))) : null,
      hbars(items, ages.length));
  }

  function numberCard(q, emps) {
    const xs = emps.map(e => ({ e, v: e.response.answers[q.id] })).filter(x => typeof x.v === 'number');
    if (!xs.length) return el('div', { class: 'card' }, el('h3', {}, q.label), el('div', { class: 'sub' }, 'אין תשובות'));
    const vs = xs.map(x => x.v).sort((a, b) => a - b);
    const min = vs[0], max = vs[vs.length - 1];
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    let items = [];
    if (max > min) {
      // עד 5 טווחים שווים; עם מספרים שלמים הגבולות מעוגלים
      const step = Math.max(1, Math.ceil((max - min + 1) / 5));
      for (let lo = min; lo <= max; lo += step) {
        const hi = lo + step - 1;
        items.push({ label: step === 1 ? String(lo) : span(lo, hi), list: xs.filter(x => x.v >= lo && x.v <= hi).map(x => x.e) });
      }
    }
    return el('div', { class: 'card' },
      el('h3', {}, q.label), el('div', { class: 'sub' }, `${xs.length} השיבו`),
      el('div', { class: 'stats' },
        el('div', {}, el('b', {}, avg.toFixed(1)), el('span', {}, 'ממוצע')),
        el('div', {}, el('b', {}, span(min, max)), el('span', {}, 'טווח'))),
      items.length ? hbars(items, xs.length) : null);
  }

  function textCard(q, emps) {
    const xs = emps.filter(e => !isEmpty(e.response.answers[q.id]));
    return el('div', { class: 'card' }, el('h3', {}, q.label), el('div', { class: 'sub' }, `${xs.length} השיבו`),
      xs.length ? el('div', { class: 'texts' }, xs.sort(byName).map(e => el('div', {}, el('b', {}, e.name), e.response.answers[q.id]))) : el('div', { class: 'muted small' }, 'אין תשובות'));
  }

  /* ===== בונה השאלון ===== */
  const SCALE_PRESETS = {
    'רמת שליטה': ['אין שליטה', 'בסיסית', 'בינונית', 'טובה', 'מומחה/ית'],
    'הסכמה': ['לא מסכים/ה כלל', 'לא מסכים/ה', 'ניטרלי', 'מסכים/ה', 'מסכים/ה מאוד'],
    'תדירות': ['אף פעם', 'לעיתים רחוקות', 'לפעמים', 'לעיתים קרובות', 'תמיד'],
    'שביעות רצון': ['גרועה', 'לא טובה', 'סבירה', 'טובה', 'מצוינת'],
  };
  const answersFor = qid => data.employees.filter(e => !isEmpty(e.response?.answers?.[qid])).length;

  function setDirty(v = true) {
    draftDirty = v;
    const s = document.getElementById('b-state');
    if (s) { s.textContent = v ? 'יש שינויים שלא נשמרו' : 'הכול שמור'; s.classList.toggle('dirty', v); }
  }

  function newQuestion(type) {
    const q = { id: uid('q'), type, label: '', required: false };
    if (['single', 'multi', 'dropdown'].includes(type)) q.options = [{ id: uid('o'), label: 'אפשרות 1' }, { id: uid('o'), label: 'אפשרות 2' }];
    if (type === 'yesno') q.items = [{ id: uid('o'), label: 'פריט 1' }, { id: uid('o'), label: 'פריט 2' }];
    if (type === 'scale') q.scale = { min: 1, max: 5, labels: [...SCALE_PRESETS['רמת שליטה']] };
    return q;
  }

  function viewBuilder() {
    // טיוטה בלי שינויים נבנית מחדש מהגרסה השמורה, כדי לא להציג גרסה ישנה
    if (!draft || !draftDirty) { draft = JSON.parse(JSON.stringify({ title: data.form.title, intro: data.form.intro, definition: data.form.definition })); setDirty(false); }
    const save = async () => {
      for (const s of draft.definition.sections) for (const q of s.questions) {
        if (!q.label.trim()) { openQs.add(q.id); drawBuilder(); return toast('יש שאלה בלי כותרת — היא מסומנת פתוחה'); }
        if (['single', 'multi', 'dropdown'].includes(q.type) && !(q.options || []).some(o => o.label.trim())) { openQs.add(q.id); drawBuilder(); return toast(`לשאלה "${q.label}" אין אפשרויות`); }
        if (q.type === 'yesno' && !(q.items || []).some(o => o.label.trim())) { openQs.add(q.id); drawBuilder(); return toast(`לשאלה "${q.label}" אין פריטים`); }
        if (q.options) q.options = q.options.filter(o => o.label.trim());
        if (q.items) q.items = q.items.filter(o => o.label.trim());
      }
      try {
        const r = await api('/api/form', { method: 'PUT', body: draft });
        data.form = r.form; setDirty(false); toast('השאלון נשמר');
      } catch (e) { toast(e.message, 4000); }
    };
    const preview = () => {
      const tmp = {};
      dialog({
        title: 'תצוגה מקדימה — כך העובד יראה', cancelText: null, okText: 'סגירה',
        body: el('div', {}, draft.intro ? el('p', {}, draft.intro) : null,
          draft.definition.sections.filter(s => s.questions.length).map(s => el('div', { style: 'margin-bottom:1.5rem' },
            el('h2', {}, s.title), s.description ? el('p', { class: 'muted' }, s.description) : null,
            s.questions.map(q => renderQuestion(q, tmp, null, { prefix: 'pv' }))))),
      });
    };
    const discard = async () => {
      if (!draftDirty) return;
      if (!(await confirmDlg('ביטול שינויים', 'לחזור לגרסה השמורה של השאלון?', 'ביטול השינויים', true))) return;
      draft = null; viewBuilder();
    };

    $view.replaceChildren(
      pageHead('בונה השאלון', `${allQs({ definition: draft.definition }).length} שאלות · ${data.employees.filter(e => e.response).length} עובדים כבר התחילו למלא`),
      el('div', { class: 'b-toolbar' },
        el('button', { class: 'btn primary', onclick: save }, 'שמירה'),
        el('button', { class: 'btn', onclick: preview }, 'תצוגה מקדימה'),
        el('button', { class: 'btn ghost', onclick: discard }, 'ביטול שינויים'),
        el('span', { class: 'state', id: 'b-state' })),
      el('div', { id: 'b-body' }));
    setDirty(draftDirty);
    drawBuilder();
  }

  // כל שינוי מבני בונה את הבונה מחדש. כדי שהדף לא יקפוץ (Safari לא שומר את הגלילה
  // כשהתוכן מוחלף), מעגנים את השאלה או המקטע שעליהם לחצו לאותו מקום על המסך.
  let lastTarget = null;
  document.addEventListener('pointerdown', e => { lastTarget = e.target; }, true);
  document.addEventListener('keydown', e => { lastTarget = e.target; }, true);

  function builderAnchors() {
    const t = lastTarget && lastTarget.isConnected ? lastTarget : document.activeElement;
    const out = [];
    const q = t && t.closest && t.closest('[data-bq]');
    const sec = t && t.closest && t.closest('[data-bs]');
    if (q) out.push(`[data-bq="${CSS.escape(q.dataset.bq)}"]`);
    if (sec) out.push(`[data-bs="${CSS.escape(sec.dataset.bs)}"]`);
    return out.map(sel => ({ sel, top: document.querySelector(sel)?.getBoundingClientRect().top }));
  }
  function restoreAnchor(anchors, y) {
    for (const a of anchors) {
      const n = document.querySelector(a.sel);
      if (n && a.top !== undefined) { scrollTo(0, scrollY + n.getBoundingClientRect().top - a.top); return; }
    }
    scrollTo(0, y);
  }

  function drawBuilder() {
    const body = document.getElementById('b-body');
    if (!body) return;
    const anchors = builderAnchors(), keepY = scrollY;
    const secs = draft.definition.sections;
    const bind = (obj, key, input, after) => input.addEventListener('input', () => { obj[key] = input.value; setDirty(); after && after(); });

    const title = el('input', { type: 'text', value: draft.title, 'aria-label': 'שם השאלון' });
    bind(draft, 'title', title);
    const intro = el('textarea', { rows: 2, placeholder: 'לא חובה. מוצג לעובד במסך הפתיחה, מתחת לשמו', 'aria-label': 'טקסט פתיחה' }, draft.intro || '');
    bind(draft, 'intro', intro);

    let qNum = 0;
    body.replaceChildren(
      el('div', { class: 'card', style: 'margin-bottom:1rem' },
        el('label', { class: 'field' }, el('span', {}, 'שם השאלון'), title),
        el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'טקסט פתיחה'), intro)),
      ...secs.map((s, si) => {
        const st = el('input', { type: 'text', value: s.title, placeholder: 'שם המקטע', 'aria-label': 'שם המקטע' });
        bind(s, 'title', st);
        const sd = el('input', { type: 'text', value: s.description || '', placeholder: 'הסבר קצר למקטע (לא חובה)', 'aria-label': 'הסבר למקטע' });
        bind(s, 'description', sd);
        const move = d => { secs.splice(si + d, 0, secs.splice(si, 1)[0]); setDirty(); drawBuilder(); };
        const delSec = async () => {
          const n = s.questions.reduce((c, q) => c + answersFor(q.id), 0);
          if (!(await confirmDlg('מחיקת מקטע', `למחוק את המקטע "${s.title}" ואת ${s.questions.length} השאלות שבו?` + (n ? ` יש ${n} תשובות קיימות לשאלות אלה — הן יוסתרו.` : ''), 'מחיקה', true))) return;
          secs.splice(si, 1); setDirty(); drawBuilder();
        };
        return el('section', { class: 'b-sec', 'data-bs': s.id },
          el('div', { class: 'b-sec-head' },
            el('div', { class: 'row' }, el('div', { class: 'grow' }, st),
              el('button', { class: 'btn sm icon', 'aria-label': 'הזזת מקטע למעלה', disabled: si === 0, onclick: () => move(-1) }, '↑'),
              el('button', { class: 'btn sm icon', 'aria-label': 'הזזת מקטע למטה', disabled: si === secs.length - 1, onclick: () => move(1) }, '↓'),
              el('button', { class: 'btn sm danger', onclick: delSec }, 'מחיקה')),
            sd),
          el('div', { class: 'b-qs' }, s.questions.map((q, qi) => questionEditor(s, q, qi, ++qNum))),
          el('div', { class: 'b-add' }, el('span', { class: 'muted small', style: 'align-self:center' }, 'הוספת שאלה:'),
            Object.entries(TYPE_LABELS).map(([t, l]) => el('button', { class: 'btn sm', onclick: () => {
              const q = newQuestion(t); s.questions.push(q); openQs.add(q.id); setDirty(); drawBuilder();
              setTimeout(() => document.querySelector(`[data-bq="${q.id}"] input[type=text]`)?.focus({ preventScroll: true }), 0);
            } }, '+ ' + l))));
      }),
      el('button', { class: 'btn', onclick: () => { secs.push({ id: uid('s'), title: 'מקטע חדש', description: '', questions: [] }); setDirty(); drawBuilder(); } }, '+ הוספת מקטע'));
    restoreAnchor(anchors, keepY);
  }

  function questionEditor(s, q, qi, num) {
    const open = openQs.has(q.id);
    const secs = draft.definition.sections;
    const nAns = answersFor(q.id);
    const toggle = () => { open ? openQs.delete(q.id) : openQs.add(q.id); drawBuilder(); };
    const rowLabel = el('span', { class: 't' }, q.label || el('i', { class: 'muted' }, 'שאלה ללא כותרת'));
    const row = el('div', { class: 'b-q-row', onclick: toggle, role: 'button', tabindex: 0, 'aria-expanded': String(open), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
      el('span', { class: 'idx' }, num + '.'), rowLabel,
      el('span', { class: 'chip' }, TYPE_LABELS[q.type]),
      q.required ? el('span', { class: 'chip warn' }, 'חובה') : null,
      nAns ? el('span', { class: 'chip info', title: 'מספר עובדים שענו' }, `${nAns} תשובות`) : null,
      el('span', { 'aria-hidden': 'true' }, open ? '▴' : '▾'));
    const wrap = el('div', { class: 'b-q' + (open ? ' open' : ''), 'data-bq': q.id }, row);
    if (!open) return wrap;

    const label = el('input', { type: 'text', value: q.label, placeholder: 'נוסח השאלה' });
    label.addEventListener('input', () => { q.label = label.value; rowLabel.textContent = q.label || 'שאלה ללא כותרת'; setDirty(); });
    const help = el('input', { type: 'text', value: q.help || '', placeholder: 'טקסט עזר מתחת לשאלה (לא חובה)' });
    help.addEventListener('input', () => { q.help = help.value; setDirty(); });
    const type = el('select', { 'aria-label': 'סוג שאלה' }, Object.entries(TYPE_LABELS).map(([t, l]) => el('option', { value: t, selected: q.type === t }, l)));
    type.addEventListener('change', async () => {
      if (nAns && !(await confirmDlg('שינוי סוג שאלה', `ל-${nAns} עובדים יש כבר תשובה לשאלה הזו. שינוי הסוג עלול להפוך אותן ללא קריאות. להמשיך?`, 'שינוי הסוג', true))) { type.value = q.type; return; }
      q.type = type.value;
      if (['single', 'multi', 'dropdown'].includes(q.type) && !q.options) q.options = newQuestion('single').options;
      if (q.type === 'yesno' && !q.items) q.items = newQuestion('yesno').items;
      if (q.type === 'scale' && !q.scale) q.scale = newQuestion('scale').scale;
      setDirty(); drawBuilder();
    });
    const req = el('input', { type: 'checkbox', checked: q.required });
    req.addEventListener('change', () => { q.required = req.checked; setDirty(); drawBuilder(); });

    const extra = [];
    if (['single', 'multi', 'dropdown'].includes(q.type)) extra.push(optionsEditor(q));
    if (q.type === 'yesno') extra.push(optionsEditor(q, 'items', 'פריטים — העובד יסמן כן או לא ליד כל אחד', 'פריט'));
    if (q.type === 'scale') extra.push(scaleEditor(q, nAns));
    if (q.type === 'date') extra.push(flag(q, 'isBirthdate', 'זהו תאריך לידה — לחישוב גיל ולפילוח גילאים בדשבורד'));
    if (q.type === 'short') extra.push(flag(q, 'groupInDashboard', 'לקבץ את התשובות בדשבורד (למשל מקום מגורים, מחלקה)'));

    const si = secs.indexOf(s);
    const moveQ = d => { s.questions.splice(qi + d, 0, s.questions.splice(qi, 1)[0]); setDirty(); drawBuilder(); };
    const toSec = el('select', { 'aria-label': 'העברה למקטע', style: 'width:auto;min-height:32px;padding:.15rem .4rem' },
      el('option', { value: '' }, 'העברה למקטע…'), secs.map((x, i) => i === si ? null : el('option', { value: i }, x.title || `מקטע ${i + 1}`)));
    toSec.addEventListener('change', () => {
      if (toSec.value === '') return;
      secs[Number(toSec.value)].questions.push(s.questions.splice(qi, 1)[0]); setDirty(); drawBuilder();
    });
    const del = async () => {
      if (nAns && !(await confirmDlg('מחיקת שאלה', `ל-${nAns} עובדים יש תשובה לשאלה הזו. אחרי המחיקה התשובות לא יוצגו (הן נשמרות בגיבוי). למחוק?`, 'מחיקה', true))) return;
      s.questions.splice(qi, 1); openQs.delete(q.id); setDirty(); drawBuilder();
    };
    const dup = () => {
      const c = JSON.parse(JSON.stringify(q)); c.id = uid('q'); c.label = q.label + ' (עותק)';
      if (c.options) c.options.forEach(o => o.id = uid('o'));
      if (c.items) c.items.forEach(o => o.id = uid('o'));
      s.questions.splice(qi + 1, 0, c); openQs.add(c.id); setDirty(); drawBuilder();
    };

    wrap.append(el('div', { class: 'b-q-edit' },
      el('div', { class: 'two' }, el('label', {}, el('span', { class: 'small muted' }, 'נוסח השאלה'), label), el('label', {}, el('span', { class: 'small muted' }, 'סוג'), type)),
      help,
      el('label', { class: 'check' }, req, 'שאלת חובה'),
      extra,
      el('div', { class: 'row' },
        el('button', { class: 'btn sm icon', 'aria-label': 'הזזה למעלה', disabled: qi === 0, onclick: () => moveQ(-1) }, '↑'),
        el('button', { class: 'btn sm icon', 'aria-label': 'הזזה למטה', disabled: qi === s.questions.length - 1, onclick: () => moveQ(1) }, '↓'),
        secs.length > 1 ? toSec : null,
        el('button', { class: 'btn sm', onclick: dup }, 'שכפול'),
        el('button', { class: 'btn sm danger', onclick: del }, 'מחיקה'))));
    return wrap;
  }

  function flag(q, key, text) {
    const c = el('input', { type: 'checkbox', checked: !!q[key] });
    c.addEventListener('change', () => { q[key] = c.checked; setDirty(); });
    return el('label', { class: 'check' }, c, text);
  }

  // משמש גם לאפשרויות של שאלות בחירה וגם לפריטים של רשימת כן/לא (key = 'items')
  function optionsEditor(q, key = 'options', title = 'אפשרויות', word = 'אפשרות') {
    const box = el('div', { class: 'b-opts' });
    const list = () => q[key];
    const draw = () => fill(box,
      el('span', { class: 'small muted' }, title),
      ...list().map((o, i) => {
        const inp = el('input', { type: 'text', value: o.label, 'aria-label': `${word} ${i + 1}` });
        inp.addEventListener('input', () => { o.label = inp.value; setDirty(); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); list().splice(i + 1, 0, { id: uid('o'), label: '' }); setDirty(); draw(); box.querySelectorAll('input[type=text]')[i + 1]?.focus(); } });
        const mv = d => { list().splice(i + d, 0, list().splice(i, 1)[0]); setDirty(); draw(); };
        return el('div', { class: 'b-opt' }, el('span', { class: 'muted small', style: 'min-width:1.4rem' }, (i + 1) + '.'), inp,
          el('button', { class: 'btn sm icon ghost', 'aria-label': 'למעלה', disabled: i === 0, onclick: () => mv(-1) }, '↑'),
          el('button', { class: 'btn sm icon ghost', 'aria-label': 'למטה', disabled: i === list().length - 1, onclick: () => mv(1) }, '↓'),
          el('button', { class: 'btn sm icon ghost', 'aria-label': `הסרת ${word}`, onclick: () => { list().splice(i, 1); setDirty(); draw(); } }, '✕'));
      }),
      el('div', { class: 'row' },
        el('button', { class: 'btn sm', onclick: () => { list().push({ id: uid('o'), label: '' }); setDirty(); draw(); box.querySelectorAll('input[type=text]')[list().length - 1]?.focus(); } }, '+ ' + word),
        el('button', { class: 'btn sm ghost', onclick: () => pasteOptions(q, draw, key, word) }, 'הדבקת רשימה')),
      ['single', 'multi'].includes(q.type) ? flag(q, 'allowOther', 'להוסיף אפשרות "אחר" עם פירוט') : null);
    draw();
    return box;
  }

  function pasteOptions(q, redraw, key, word) {
    const ta = el('textarea', { rows: 8, placeholder: `${word} אחד/ת בכל שורה` });
    dialog({
      title: 'הדבקת רשימה', okText: 'הוספה', body: el('div', {}, ta),
      onOk: () => {
        const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
        q[key] = q[key].filter(o => o.label.trim()).concat(lines.map(label => ({ id: uid('o'), label })));
        setDirty(); redraw();
      },
    });
  }

  function scaleEditor(q, nAns) {
    const box = el('div', { class: 'b-opts' });
    const draw = () => {
      const range = scaleRange(q);
      q.scale.labels = range.map((n, i) => q.scale.labels?.[i] ?? '');
      const num = (key, lo, hi) => {
        const s = el('select', { style: 'width:auto' });
        for (let i = lo; i <= hi; i++) s.append(el('option', { value: i, selected: q.scale[key] === i }, String(i)));
        s.addEventListener('change', () => { q.scale[key] = Number(s.value); setDirty(); draw(); });
        return s;
      };
      const preset = el('select', { style: 'width:auto', 'aria-label': 'תבנית תוויות' }, el('option', { value: '' }, 'תבנית תוויות…'),
        Object.keys(SCALE_PRESETS).map(k => el('option', { value: k }, k)), el('option', { value: '__none' }, 'ללא תוויות'));
      preset.addEventListener('change', () => {
        if (!preset.value) return;
        if (preset.value === '__none') q.scale.labels = [];
        else { q.scale.min = 1; q.scale.max = 5; q.scale.labels = [...SCALE_PRESETS[preset.value]]; }
        setDirty(); draw();
      });
      fill(box,
        el('div', { class: 'row' }, el('label', { class: 'check' }, 'מ-', num('min', 0, 1)), el('label', { class: 'check' }, 'עד', num('max', 2, 10)), preset),
        nAns ? el('div', { class: 'warn-note' }, `ל-${nAns} עובדים יש תשובה — שינוי הטווח ישפיע על ההשוואה ביניהם.`) : null,
        el('span', { class: 'small muted' }, 'תווית לכל רמה (לא חובה)'),
        el('div', { class: 'scale-labels' }, range.map((n, i) => {
          const inp = el('input', { type: 'text', value: q.scale.labels[i] || '', 'aria-label': `תווית לרמה ${n}` });
          inp.addEventListener('input', () => { q.scale.labels[i] = inp.value; setDirty(); });
          return el('label', {}, el('b', {}, String(n)), inp);
        })));
    };
    draw();
    return box;
  }

  /* ===== משתמשים ===== */
  async function viewUsers() {
    $view.replaceChildren(pageHead('משתמשים והרשאות'), el('p', { class: 'muted' }, 'טוען…'));
    let users;
    try { users = (await api('/api/users')).users; } catch (e) { return $view.replaceChildren(el('div', { class: 'notice error' }, e.message)); }
    const f = {
      display_name: el('input', { type: 'text', placeholder: 'שם לתצוגה' }),
      username: el('input', { type: 'text', placeholder: 'שם משתמש (באנגלית)', dir: 'ltr', autocapitalize: 'none', autocomplete: 'off' }),
      password: el('input', { type: 'text', placeholder: 'סיסמה (8 תווים לפחות)', dir: 'ltr', autocomplete: 'off' }),
      role: el('select', {}, el('option', { value: 'viewer' }, 'צפייה בלבד'), el('option', { value: 'admin' }, 'מנהל')),
    };
    const add = async () => {
      try {
        await api('/api/users', { method: 'POST', body: { display_name: f.display_name.value, username: f.username.value, password: f.password.value, role: f.role.value } });
        toast('המשתמש נוסף. מסור לו את שם המשתמש והסיסמה בעל-פה או בהודעה נפרדת');
        viewUsers();
      } catch (e) { toast(e.message, 4000); }
    };
    const roleSel = u => {
      const s = el('select', { style: 'width:auto;min-height:34px;padding:.2rem .4rem', 'aria-label': 'הרשאה' }, el('option', { value: 'viewer', selected: u.role === 'viewer' }, 'צפייה בלבד'), el('option', { value: 'admin', selected: u.role === 'admin' }, 'מנהל'));
      s.addEventListener('change', async () => { try { await api('/api/users/' + u.id, { method: 'PATCH', body: { role: s.value } }); toast('ההרשאה עודכנה'); } catch (e) { toast(e.message); s.value = u.role; } });
      return s;
    };
    const resetPw = u => {
      const p = el('input', { type: 'text', dir: 'ltr', value: genPassword(), autocomplete: 'off' });
      dialog({ title: `סיסמה חדשה — ${u.display_name}`, okText: 'שמירה', body: el('div', {}, el('label', { class: 'field' }, el('span', {}, 'סיסמה חדשה'), p), el('p', { class: 'small muted' }, 'המשתמש ינותק מכל המכשירים ויצטרך להתחבר מחדש.')),
        onOk: async () => { await api('/api/users/' + u.id, { method: 'PATCH', body: { password: p.value } }); toast('הסיסמה עודכנה'); } });
    };
    const del = async u => {
      if (!(await confirmDlg('מחיקת משתמש', `למחוק את המשתמש ${u.username}? הגישה שלו תיחסם מיד.`, 'מחיקה', true))) return;
      try { await api('/api/users/' + u.id, { method: 'DELETE', body: {} }); viewUsers(); } catch (e) { toast(e.message); }
    };
    $view.replaceChildren(
      pageHead('משתמשים והרשאות', '"מנהל" יכול לערוך את השאלון, לנהל עובדים ומשתמשים. "צפייה בלבד" רואה את הדשבורד והתיקים האישיים בלבד.'),
      el('div', { class: 'card' }, el('h3', {}, 'הוספת משתמש'),
        el('div', { class: 'row' }, el('div', { class: 'grow' }, f.display_name), el('div', { class: 'grow' }, f.username)),
        el('div', { class: 'row', style: 'margin-top:.6rem' }, el('div', { class: 'grow' }, f.password),
          el('button', { class: 'btn sm ghost', onclick: () => { f.password.value = genPassword(); } }, 'יצירת סיסמה'), f.role),
        el('div', { style: 'margin-top:.75rem' }, el('button', { class: 'btn primary', onclick: add }, 'הוספה'))),
      el('div', { class: 'card tbl-wrap' }, el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'שם'), el('th', {}, 'שם משתמש'), el('th', {}, 'הרשאה'), el('th', {}, ''))),
        el('tbody', {}, users.map(u => el('tr', {},
          el('td', {}, u.display_name, u.id === me.id ? el('span', { class: 'chip info', style: 'margin-inline-start:.4rem' }, 'את/ה') : null),
          el('td', { dir: 'ltr', style: 'text-align:end' }, u.username),
          el('td', {}, u.id === me.id ? (u.role === 'admin' ? 'מנהל' : 'צפייה') : roleSel(u)),
          el('td', {}, el('div', { class: 'row', style: 'justify-content:flex-end;gap:.35rem' },
            el('button', { class: 'btn sm', onclick: () => resetPw(u) }, 'סיסמה חדשה'),
            u.id !== me.id ? el('button', { class: 'btn sm danger', onclick: () => del(u) }, 'מחיקה') : null))))))));
  }

  function genPassword() {
    // בלי תווים שמתבלבלים בהקלדה (0/O, 1/l/I)
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint32Array(12));
    return Array.from(r, n => abc[n % abc.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
  }

  /* ===== גיבוי ===== */
  function download(name, content, type) {
    const a = el('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  function csvExport() {
    const qs = allQs(data.form).map(x => x.q);
    const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['שם', 'תפקיד', 'צוות', 'סטטוס', 'תאריך הגשה', ...qs.map(q => q.label)]];
    for (const e of data.employees) {
      const a = e.response?.answers || {};
      rows.push([e.name, e.role_title, e.team, STATUS[e.status]?.t, e.submitted_at ? formatTs(e.submitted_at) : '',
        ...qs.map(q => q.type === 'scale' || q.type === 'number' ? (a[q.id] ?? '') : answerText(q, a))]);
    }
    // BOM כדי שאקסל יזהה UTF-8 ויציג עברית תקינה
    download(`עובדים-${stamp()}.csv`, '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  function viewBackup() {
    const jsonBackup = async () => {
      await reload();
      const b = { kind: 'employee-profiles-backup', version: 1, exported_at: new Date().toISOString(), form: data.form, employees: data.employees, interviews: data.interviews || [] };
      download(`גיבוי-שאלון-פרטים-אישיים-${stamp()}.json`, JSON.stringify(b, null, 2), 'application/json');
      toast('הגיבוי ירד לתיקיית ההורדות');
    };
    const file = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      let b;
      try { b = JSON.parse(await f.text()); } catch { return toast('הקובץ אינו JSON תקין'); }
      if (b.kind !== 'employee-profiles-backup') return toast('זה לא קובץ גיבוי של המערכת');
      if (!(await confirmDlg('שחזור מגיבוי', `השחזור יחליף את השאלון, את כל העובדים ואת כל התשובות בתוכן הגיבוי מ-${new Date(b.exported_at).toLocaleDateString('he-IL')} (${b.employees.length} עובדים). המשתמשים והסיסמאות לא משתנים. להמשיך?`, 'שחזור', true))) return;
      try { await api('/api/import', { method: 'POST', body: b }); draft = null; await reload(); toast('השחזור הושלם'); }
      catch (e) { toast(e.message, 4000); }
    });
    $view.replaceChildren(
      pageHead('גיבוי ושחזור'),
      el('div', { class: 'card' }, el('h3', {}, 'גיבוי מלא למחשב'),
        el('p', { class: 'muted' }, 'קובץ אחד עם השאלון, כל העובדים וכל התשובות. כדאי לשמור אותו בתיקייה מוגנת במחשב, ולגבות אחרי כל סבב מילוי. הקובץ כולל את הקישורים האישיים — שמור אותו בהתאם.'),
        el('button', { class: 'btn primary', onclick: jsonBackup }, 'הורדת גיבוי (JSON)')),
      el('div', { class: 'card' }, el('h3', {}, 'ייצוא לאקסל'),
        el('p', { class: 'muted' }, 'טבלה עם שורה לכל עובד ועמודה לכל שאלה. מתאים לעבודה באקסל, לא לשחזור.'),
        el('button', { class: 'btn', onclick: csvExport }, 'הורדת קובץ אקסל (CSV)')),
      el('div', { class: 'card' }, el('h3', {}, 'שחזור מגיבוי'),
        el('p', { class: 'muted' }, 'מחליף את כל הנתונים במערכת בתוכן קובץ גיבוי שהורדת קודם.'),
        el('button', { class: 'btn danger', onclick: () => file.click() }, 'בחירת קובץ גיבוי…'), file));
  }

  window.EP.initTips();
  boot();
})();
