/* ===== טופס העובד =====
   הקישור האישי הוא f#<טוקן>. הטוקן נמצא אחרי ה-# כדי שלא יישלח בשום Referer
   ולא יירשם ביומני שרתים בדרך. */
(function () {
  'use strict';
  const { el, api, renderQuestion, validateSection, answerText, isEmpty, toast } = window.EP;
  const app = document.getElementById('app');
  const token = location.hash.slice(1).trim();

  let form, answers = {}, name = '', step = -1; // -1 = מסך פתיחה; sections.length = סקירה
  let saveTimer = null, saving = Promise.resolve(), dirty = false;
  const LS_KEY = 'ep-draft-' + token.slice(0, 12);

  function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } }
  function lsSet(v) { try { v ? localStorage.setItem(LS_KEY, JSON.stringify(v)) : localStorage.removeItem(LS_KEY); } catch { /* אחסון חסום */ } }

  function message(title, text, mark) {
    app.replaceChildren(el('div', { class: 'card center hello' },
      mark ? el('div', { class: 'done-mark', 'aria-hidden': 'true' }, mark) : null,
      el('h1', {}, title), text ? el('p', { class: 'muted' }, text) : null));
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return message('הקישור לא תקין', 'בדוק/י שהעתקת את הקישור המלא שקיבלת.');
    try {
      const d = await api('/api/f/' + token);
      form = d.form; name = d.name;
      if (d.submitted) { lsSet(null); return message(`תודה, ${name}`, 'השאלון כבר הוגש. אם צריך לתקן משהו, פנה/י למנהל.', '✓'); }
      answers = d.answers || {};
      // אם במכשיר נשמרה טיוטה מאוחרת יותר שלא הגיעה לשרת (נפלה הקליטה) — משלימים ממנה
      const local = lsGet();
      if (local && local.answers) answers = { ...answers, ...local.answers };
      renderHello();
    } catch (e) {
      message('לא הצלחנו לפתוח את השאלון', e.status === 404 ? e.message : 'בדוק/י את החיבור לאינטרנט ונסה/י שוב.');
    }
  }

  function renderHello() {
    step = -1;
    const started = Object.keys(answers).length > 0;
    app.replaceChildren(el('div', { class: 'card center hello' },
      el('h1', {}, `שלום ${name}`),
      el('p', { class: 'muted' }, form.title),
      form.intro ? el('p', {}, form.intro) : null,
      el('p', { class: 'small muted' }, 'לא ' + name + '? סגור/י את הדף ופנה/י למנהל.'),
      el('button', { class: 'btn primary', onclick: () => go(0) }, started ? 'המשך מאיפה שעצרתי' : 'בוא/י נתחיל')));
  }

  const sections = () => form.definition.sections.filter(s => s.questions.length);

  function go(n) {
    step = n;
    window.scrollTo(0, 0);
    if (n >= sections().length) return renderReview();
    renderSection();
  }

  function progress(label) {
    const total = sections().length;
    const pct = Math.round((Math.min(step, total) / total) * 100);
    const bar = el('i'); bar.style.width = pct + '%';
    return el('div', { class: 'progress' },
      el('div', { class: 'progress-top' }, el('span', {}, label), el('span', { class: 'num' }, `${Math.min(step + 1, total)} / ${total}`)),
      el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar));
  }

  function nav(back, next, nextLabel) {
    return el('div', { class: 'nav' },
      el('div', { class: 'nav-in' },
        el('button', { class: 'btn', onclick: back }, 'הקודם'),
        el('button', { class: 'btn primary', onclick: next }, nextLabel)),
      el('div', { class: 'saved', id: 'saved' }));
  }

  function renderSection() {
    const s = sections()[step];
    const body = el('div', { class: 'card' },
      el('h2', {}, s.title),
      s.description ? el('p', { class: 'sec-desc' }, s.description) : null,
      s.questions.map(q => renderQuestion(q, answers, scheduleSave)));
    app.replaceChildren(progress(s.title), body,
      nav(() => step === 0 ? renderHello() : go(step - 1), () => {
        const bad = validateSection(s, answers, body);
        if (bad.length) {
          body.querySelector('.q.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return toast('יש למלא את השדות המסומנים');
        }
        flush(); go(step + 1);
      }, step === sections().length - 1 ? 'לסיכום' : 'הבא'));
  }

  function renderReview() {
    const dl = el('dl', { class: 'review' });
    for (const s of sections()) {
      dl.append(el('h3', {}, s.title));
      for (const q of s.questions) {
        dl.append(el('dt', {}, q.label), el('dd', {}, answerText(q, answers) || '—'));
      }
    }
    app.replaceChildren(progress('סיכום'),
      el('div', { class: 'card' }, el('h2', {}, 'כמעט סיימנו'), el('p', { class: 'muted' }, 'עבור/י על התשובות. אפשר לחזור אחורה לתקן. אחרי השליחה לא ניתן לערוך.'), dl),
      nav(() => go(step - 1), submit, 'שליחה'));
  }

  async function submit(ev) {
    for (let i = 0; i < sections().length; i++) {
      if (validateSection(sections()[i], answers, null).length) { toast('חסרות תשובות חובה'); return go(i); }
    }
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'שולח…';
    clearTimeout(saveTimer);
    try {
      await saving;
      await api('/api/f/' + token + '/submit', { method: 'POST', body: { answers } });
      lsSet(null);
      message(`תודה, ${name}!`, 'השאלון נשלח בהצלחה.', '✓');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'שליחה';
      toast(e.status === 400 ? 'חסרות תשובות חובה' : (e.message || 'השליחה נכשלה. נסה/י שוב'), 4000);
    }
  }

  /* ===== שמירת טיוטה ===== */
  function setSaved(t) { const s = document.getElementById('saved'); if (s) s.textContent = t; }
  function scheduleSave() {
    dirty = true;
    lsSet({ answers, at: Date.now() });
    setSaved('');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1500);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return saving;
    dirty = false;
    const snapshot = JSON.parse(JSON.stringify(answers));
    saving = saving.then(() => api('/api/f/' + token, { method: 'PUT', body: { answers: snapshot } }))
      .then(() => setSaved('הטיוטה נשמרה'))
      .catch(() => { dirty = true; setSaved('אין חיבור — התשובות שמורות במכשיר'); });
    return saving;
  }
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('hashchange', () => location.reload());

  load();
})();
