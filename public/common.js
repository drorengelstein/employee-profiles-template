/* ===== קוד משותף: טופס העובד, ממשק המנהל =====
   הצגת השאלות נמצאת כאן כדי שהתצוגה המקדימה בבונה תהיה זהה בדיוק למה
   שהעובד רואה. */
(function () {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(c));
    return e;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* תגובה ריקה */ }
    if (!res.ok) {
      const e = new Error((data && data.error) || `שגיאה (${res.status})`);
      e.status = res.status; e.data = data;
      throw e;
    }
    return data;
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  const uid = (p = 'q') => p + '_' + Math.random().toString(36).slice(2, 8);

  const TYPE_LABELS = {
    short: 'טקסט קצר', long: 'טקסט פתוח (פסקה)', single: 'בחירה אחת', multi: 'בחירה מרובה',
    dropdown: 'רשימה נפתחת', yesno: 'רשימת כן / לא', scale: 'מדד / סולם', date: 'תאריך', number: 'מספר', phone: 'טלפון', email: 'דוא"ל',
  };

  function scaleRange(q) {
    const min = q.scale?.min ?? 1, max = q.scale?.max ?? 5;
    const out = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }
  function scaleLabel(q, n) {
    const i = n - (q.scale?.min ?? 1);
    return (q.scale?.labels || [])[i] || '';
  }

  /* ===== הצגת שאלה למילוי ===== */
  // answers הוא אובייקט שמשתנה במקום; onChange נקרא אחרי כל שינוי.
  function renderQuestion(q, answers, onChange, opts = {}) {
    const name = (opts.prefix || 'f') + '_' + q.id;
    const wrap = el('div', { class: 'q', 'data-qid': q.id });
    const labelId = name + '_lbl';
    wrap.append(el('span', { class: 'q-label', id: labelId }, q.label || 'שאלה ללא כותרת', q.required ? el('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null));
    if (q.help) wrap.append(el('div', { class: 'q-help' }, q.help));
    const set = v => { if (v === '' || v === null || (Array.isArray(v) && !v.length)) delete answers[q.id]; else answers[q.id] = v; wrap.classList.remove('invalid'); wrap.querySelector('.q-error')?.remove(); onChange && onChange(); };
    const cur = answers[q.id];

    const inputAttrs = { id: name, 'aria-labelledby': labelId, required: q.required || undefined };
    switch (q.type) {
      case 'long':
        wrap.append(el('textarea', { ...inputAttrs, oninput: e => set(e.target.value) }, cur ?? ''));
        break;
      case 'single': case 'multi': {
        const multi = q.type === 'multi';
        const box = el('div', { class: 'choices', role: multi ? 'group' : 'radiogroup', 'aria-labelledby': labelId });
        const opts2 = [...(q.options || [])];
        if (q.allowOther) opts2.push({ id: '__other', label: 'אחר' });
        for (const o of opts2) {
          const checked = multi ? (Array.isArray(cur) && cur.includes(o.id)) : cur === o.id;
          const inp = el('input', { type: multi ? 'checkbox' : 'radio', name, value: o.id, checked });
          inp.addEventListener('change', () => {
            if (multi) {
              const vals = [...box.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
              set(vals);
            } else set(o.id);
            otherInput && (otherInput.disabled = !box.querySelector('input[value="__other"]:checked'));
          });
          const lab = el('label', { class: 'choice' }, inp, el('span', {}, o.label));
          var otherInput;
          if (o.id === '__other') {
            otherInput = el('input', { type: 'text', class: 'other-input', placeholder: 'פרט/י', 'aria-label': 'אחר — פירוט', value: answers[q.id + '::other'] || '', disabled: !checked });
            otherInput.addEventListener('input', e => { if (e.target.value) answers[q.id + '::other'] = e.target.value; else delete answers[q.id + '::other']; onChange && onChange(); });
            lab.append(otherInput);
          }
          box.append(lab);
        }
        wrap.append(box);
        break;
      }
      case 'dropdown': {
        const sel = el('select', { ...inputAttrs, onchange: e => set(e.target.value) },
          el('option', { value: '' }, 'בחר/י…'),
          (q.options || []).map(o => el('option', { value: o.id, selected: cur === o.id }, o.label)));
        wrap.append(sel);
        break;
      }
      case 'yesno': {
        // התשובה היא אובייקט { מזהה פריט: 'yes' | 'no' }
        const box = el('div', { class: 'yn', role: 'group', 'aria-labelledby': labelId });
        const curObj = isObj(cur) ? cur : {};
        for (const it of q.items || []) {
          const opt = (v, t) => {
            const inp = el('input', { type: 'radio', name: name + '_' + it.id, value: v, checked: curObj[it.id] === v });
            inp.addEventListener('change', () => set({ ...(isObj(answers[q.id]) ? answers[q.id] : {}), [it.id]: v }));
            return el('label', { class: 'yn-opt' }, inp, el('span', {}, t));
          };
          box.append(el('div', { class: 'yn-row', role: 'radiogroup', 'aria-label': it.label },
            el('span', { class: 'yn-label' }, it.label),
            el('div', { class: 'yn-btns' }, opt('yes', 'כן'), opt('no', 'לא'))));
        }
        wrap.append(box);
        break;
      }
      case 'scale': {
        const range = scaleRange(q);
        const box = el('div', { class: 'scale', role: 'radiogroup', 'aria-labelledby': labelId });
        box.style.setProperty('--n', range.length);
        for (const n of range) {
          const t = scaleLabel(q, n);
          const inp = el('input', { type: 'radio', name, value: n, checked: cur === n, 'aria-label': t ? `${n} — ${t}` : String(n) });
          inp.addEventListener('change', () => set(n));
          box.append(el('label', {}, inp, el('span', { class: 'n' }, String(n)), t ? el('span', { class: 't' }, t) : null));
        }
        wrap.append(box);
        break;
      }
      case 'number':
        wrap.append(el('input', { ...inputAttrs, type: 'number', inputmode: 'decimal', value: cur ?? '', oninput: e => set(e.target.value === '' ? '' : Number(e.target.value)) }));
        break;
      case 'date':
        wrap.append(el('input', { ...inputAttrs, type: 'date', value: cur ?? '', max: q.isBirthdate ? new Date().toISOString().slice(0, 10) : undefined, oninput: e => set(e.target.value) }));
        break;
      case 'phone':
        wrap.append(el('input', { ...inputAttrs, type: 'tel', inputmode: 'tel', autocomplete: 'tel', dir: 'ltr', value: cur ?? '', oninput: e => set(e.target.value) }));
        break;
      case 'email':
        wrap.append(el('input', { ...inputAttrs, type: 'email', autocomplete: 'email', dir: 'ltr', value: cur ?? '', oninput: e => set(e.target.value) }));
        break;
      default:
        wrap.append(el('input', { ...inputAttrs, type: 'text', value: cur ?? '', oninput: e => set(e.target.value) }));
    }
    return wrap;
  }

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function isEmpty(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length); }

  // מחזיר את רשימת השאלות שחסרה בהן תשובת חובה, ומסמן אותן בדף
  function validateSection(section, answers, root) {
    const bad = [];
    for (const q of section.questions) {
      const v = answers[q.id];
      let msg = null;
      if (q.required && isEmpty(v)) msg = 'שדה חובה';
      else if (q.required && q.type === 'yesno' && (q.items || []).some(it => !v[it.id])) msg = 'יש לסמן כן או לא בכל הפריטים';
      else if ((v === '__other' || (Array.isArray(v) && v.includes('__other'))) && isEmpty(answers[q.id + '::other'])) msg = 'נא לפרט את "אחר"';
      else if (q.type === 'email' && !isEmpty(v) && !/^\S+@\S+\.\S+$/.test(v)) msg = 'כתובת דוא"ל לא תקינה';
      if (msg) {
        bad.push(q);
        const w = root && root.querySelector(`[data-qid="${CSS.escape(q.id)}"]`);
        if (w && !w.querySelector('.q-error')) { w.classList.add('invalid'); w.append(el('div', { class: 'q-error' }, msg)); }
      }
    }
    return bad;
  }

  /* ===== הצגת תשובה כטקסט (תיק אישי, ייצוא) ===== */
  function optionLabel(q, id, answers) {
    if (id === '__other') return 'אחר' + (answers[q.id + '::other'] ? `: ${answers[q.id + '::other']}` : '');
    return (q.options || []).find(o => o.id === id)?.label ?? '(אפשרות שנמחקה)';
  }
  function answerText(q, answers) {
    const v = answers[q.id];
    if (isEmpty(v)) return '';
    switch (q.type) {
      case 'single': case 'dropdown': return optionLabel(q, v, answers);
      case 'multi': return (Array.isArray(v) ? v : []).map(id => optionLabel(q, id, answers)).join(', ');
      case 'scale': { const t = scaleLabel(q, v); return t ? `${v} — ${t}` : String(v); }
      case 'yesno': {
        if (!isObj(v)) return '';
        const by = k => (q.items || []).filter(it => v[it.id] === k).map(it => it.label);
        const yes = by('yes'), no = by('no'), none = (q.items || []).filter(it => !v[it.id]).map(it => it.label);
        return [yes.length && `כן: ${yes.join(', ')}`, no.length && `לא: ${no.join(', ')}`, none.length && `לא סומן: ${none.join(', ')}`].filter(Boolean).join('\n');
      }
      case 'date': {
        const s = formatDate(v);
        return q.isBirthdate ? `${s} (גיל ${ageFrom(v)})` : s;
      }
      default: return String(v);
    }
  }
  function formatDate(iso) {
    const [y, m, d] = String(iso).split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(iso);
  }
  function formatTs(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }
  function ageFrom(iso, now = new Date()) {
    const b = new Date(iso + 'T00:00:00');
    if (isNaN(b)) return null;
    let a = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  }

  /* ===== טולטיפ =====
     מאזין אחד לכל הדף: כל אלמנט עם data-tip מקבל טולטיפ בריחוף ובלחיצה (נייד). */
  function initTips() {
    const tip = el('div', { class: 'tip hidden', role: 'tooltip' });
    document.body.append(tip);
    const show = (target, x, y) => {
      tip.textContent = target.getAttribute('data-tip');
      tip.classList.remove('hidden');
      const r = tip.getBoundingClientRect();
      let left = x - r.width / 2, top = y - r.height - 12;
      left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
      if (top < 8) top = y + 16;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    };
    document.addEventListener('pointermove', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t && e.pointerType === 'mouse') show(t, e.clientX, e.clientY);
      else if (e.pointerType === 'mouse') tip.classList.add('hidden');
    });
    document.addEventListener('pointerdown', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t && e.pointerType !== 'mouse') { const r = t.getBoundingClientRect(); show(t, r.left + r.width / 2, r.top); }
      else if (e.pointerType !== 'mouse') tip.classList.add('hidden');
    });
    addEventListener('scroll', () => tip.classList.add('hidden'), { passive: true });
  }

  window.EP = { esc, el, api, toast, uid, TYPE_LABELS, scaleRange, scaleLabel, renderQuestion, validateSection, isEmpty, answerText, optionLabel, formatDate, formatTs, ageFrom, initTips };
})();
