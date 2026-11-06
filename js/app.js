(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { plan: null, questions: [] };

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  // ---------- Helpers ----------
  function setStatus(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function baseName(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }
  function lines(v) { return String(v || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ---------- Plan ----------
  function fallbackFor(type) { return QTypes.get(type).freeFallback || { type: 'text' }; }

  function applyPlanToQuestion(q) {
    if (state.plan === 'free') {
      if (!QTypes.allowed(q.type, 'free')) {
        var fb = fallbackFor(q.type);
        q.paidType = q.type;
        q.planNote = fb.note || '';
        if (fb.type) q.type = fb.type; else q.planOmitted = true;
      }
    } else if (q.paidType) {
      q.type = q.paidType;
      delete q.paidType; delete q.planNote; delete q.planOmitted;
    } else if (q.planOmitted) {
      delete q.planOmitted;
    }
  }

  function setPlan(plan) {
    state.plan = plan;
    Array.prototype.forEach.call(document.querySelectorAll('.plan'), function (b) {
      var on = b.getAttribute('data-plan') === plan;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('planChoices').hidden = true;
    $('planNote').hidden = true;
    $('changePlan').hidden = false;
    $('planChosen').hidden = false;
    $('planChosen').textContent = plan === 'free'
      ? 'Free account: only question types available on free accounts are offered.'
      : 'Paid or institutional licence: all question types are available.';
    $('step-input').hidden = false;
    state.questions.forEach(applyPlanToQuestion);
    if (state.questions.length) render();
  }

  // ---------- File reading ----------
  function readAs(file, how) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      if (how === 'text') r.readAsText(file); else r.readAsArrayBuffer(file);
    });
  }

  async function parseFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'doc') throw new Error('Old .doc files are not supported. In Word, use File → Save As → Word Document (.docx), then try again.');
    if (ext === 'docx') {
      var res = await mammoth.convertToHtml({ arrayBuffer: await readAs(file) });
      return SurveyParser.parseLines(SurveyParser.htmlToLines(res.value));
    }
    if (ext === 'pdf') {
      var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readAs(file)) }).promise;
      var pages = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        pages.push((await page.getTextContent()).items);
      }
      var ls = SurveyParser.pdfItemsToLines(pages);
      if (!ls.some(function (l) { return l.trim(); })) {
        throw new Error('No text found in this PDF. It may be a scanned image. Try a PDF with selectable text, or a Word file.');
      }
      return SurveyParser.parseLines(ls);
    }
    if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].indexOf(ext) >= 0) {
      var wb = (ext === 'csv' || ext === 'tsv')
        ? XLSX.read(await readAs(file, 'text'), { type: 'string', FS: ext === 'tsv' ? '\t' : ',' })
        : XLSX.read(await readAs(file), { type: 'array' });
      return SurveyParser.parseWorkbook(wb.SheetNames.map(function (n) {
        return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) };
      }));
    }
    return SurveyParser.parseText(await readAs(file, 'text'));
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus('Reading ' + file.name + '…');
    try {
      var qs = await parseFile(file);
      loadQuestions(qs, qs.title || baseName(file.name), file.name);
    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Could not read this file.', 'err');
    }
  }

  function loadQuestions(qs, name, source) {
    if (!qs.length) {
      setStatus('No questions were found' + (source ? ' in ' + source : '') + '. Open “How should my file be formatted?” below for tips.', 'err');
      return;
    }
    state.questions = qs.map(function (q) {
      var c = {};
      for (var k in q) c[k] = q[k];
      c.choices = (q.choices || []).slice();
      c.scale = (q.scale || []).slice();
      c.required = !!q.required;
      applyPlanToQuestion(c);
      return c;
    });
    if (name) $('surveyName').value = name;
    var sections = {};
    state.questions.forEach(function (q) { if (q.section) sections[q.section] = 1; });
    var nSec = Object.keys(sections).length;
    var nWarn = state.questions.filter(function (q) { return warningsFor(q).length; }).length;
    setStatus('Found ' + plural(state.questions.length, 'question') +
      (nSec ? ' in ' + plural(nSec, 'section') : '') + (source ? ' in ' + source : '') +
      (nWarn ? '. ' + nWarn + ' need a quick check.' : '.'), 'ok');
    render();
    $('step-review').hidden = false;
    $('step-export').hidden = false;
    $('step-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Warnings ----------
  function warningsFor(q) {
    var w = [];
    if (q.warning) w.push(q.warning);
    if (q.paidType && state.plan === 'free') {
      if (q.planOmitted) w.push(QTypes.get(q.paidType).label + ' needs a paid plan, so this question will be left out of the download.');
      else w.push(QTypes.get(q.paidType).label + ' needs a paid plan, so this was changed to ' + QTypes.get(q.type).label.toLowerCase() +
        (q.planNote ? ' with the note: “' + q.planNote + '”' : '') + '.');
    }
    QSFBuilder.validate(q).forEach(function (e) { if (w.indexOf(e) < 0 && !(q.warning && /choices|items/i.test(q.warning) && /missing/.test(e))) w.push(e); });
    return w;
  }

  // ---------- Editor ----------
  function typeSelect(select, current) {
    select.innerHTML = '';
    var groups = {};
    QTypes.list.forEach(function (t) {
      if (!groups[t.group]) { groups[t.group] = el('optgroup', { label: t.group }); select.appendChild(groups[t.group]); }
      var locked = !QTypes.allowed(t.id, state.plan);
      var o = el('option', { value: t.id, text: t.label + (locked ? ' (paid plan)' : '') });
      if (locked) o.disabled = true;
      groups[t.group].appendChild(o);
    });
    select.value = current;
  }

  var SCALE_PRESETS = {
    'Agree (5)': ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'],
    'Satisfied (5)': ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
    'Frequency (5)': ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
    '1 to 5': ['1', '2', '3', '4', '5'],
    '1 to 7': ['1', '2', '3', '4', '5', '6', '7']
  };

  var TYPE_NOTES = {
    nps: 'Shows a 0 to 10 scale: “Not at all likely” to “Extremely likely”.',
    date: 'Qualtrics checks that a valid date is entered. Set the format (e.g. DD/MM/YYYY) in Qualtrics after import.',
    email: 'Qualtrics checks that a valid email address is entered.',
    phone: 'A text box for the number. No format check, so international numbers work.',
    signature: 'Respondents draw their signature with a mouse or finger.',
    file: 'One file per question. Set allowed file types and size limits in Qualtrics after import.',
    timing: 'Hidden from respondents. Records how long they spend on this page.',
    captcha: 'Asks respondents to prove they are not a bot.',
    descriptive: 'Text only, no answer. Use it for instructions or headings.'
  };

  function fieldInput(labelText, value, onInput, attrs) {
    var input = el('input', Object.assign({ type: 'text' }, attrs || {}));
    input.value = value == null ? '' : value;
    input.addEventListener('input', function () { onInput(input.value); });
    return el('label', { class: 'mini-field' }, [document.createTextNode(labelText), input]);
  }

  function renderFields(q, box, refreshWarn) {
    box.innerHTML = '';
    var t = QTypes.get(q.type);
    var f = t.fields;
    if (TYPE_NOTES[q.type]) box.appendChild(el('p', { class: 'type-note', text: TYPE_NOTES[q.type] }));
    if (f.indexOf('choices') >= 0) {
      var ta = el('textarea', { class: 'q-choices', rows: String(Math.min(10, Math.max(3, q.choices.length + 1))) });
      ta.value = q.choices.join('\n');
      ta.addEventListener('input', function () { q.choices = lines(ta.value); q.warning = null; refreshWarn(); });
      box.appendChild(el('label', { class: 'list-label' }, [document.createTextNode((t.listLabel || 'Choices') + ' (one per line)'), ta]));
    }
    if (f.indexOf('scale') >= 0) {
      var sc = el('textarea', { class: 'q-scale', rows: String(Math.min(8, Math.max(3, q.scale.length + 1))) });
      sc.value = q.scale.join('\n');
      sc.addEventListener('input', function () { q.scale = lines(sc.value); q.warning = null; refreshWarn(); });
      var presets = el('div', { class: 'presets' }, [el('span', { text: 'Quick scale:' })]);
      Object.keys(SCALE_PRESETS).forEach(function (k) {
        var b = el('button', { type: 'button', class: 'chip', text: k });
        b.addEventListener('click', function () { q.scale = SCALE_PRESETS[k].slice(); sc.value = q.scale.join('\n'); q.warning = null; refreshWarn(); });
        presets.appendChild(b);
      });
      box.appendChild(el('label', { class: 'list-label' }, [document.createTextNode('Scale / columns (one per line)'), sc]));
      box.appendChild(presets);
    }
    var row = el('div', { class: 'mini-row' });
    function set(k) { return function (v) { q[k] = v.trim(); }; }
    if (f.indexOf('range') >= 0) {
      row.appendChild(fieldInput('Minimum', q.min === '' ? '0' : q.min, set('min'), { inputmode: 'numeric' }));
      row.appendChild(fieldInput('Maximum', q.max === '' ? '100' : q.max, set('max'), { inputmode: 'numeric' }));
    }
    if (f.indexOf('number') >= 0) {
      row.appendChild(fieldInput('Minimum (optional)', q.min, set('min'), { inputmode: 'numeric' }));
      row.appendChild(fieldInput('Maximum (optional)', q.max, set('max'), { inputmode: 'numeric' }));
      row.appendChild(fieldInput('Decimal places', q.decimals === '' ? '0' : q.decimals, set('decimals'), { inputmode: 'numeric' }));
    }
    if (f.indexOf('stars') >= 0) row.appendChild(fieldInput('Number of stars', q.stars || '5', set('stars'), { inputmode: 'numeric' }));
    if (f.indexOf('total') >= 0) row.appendChild(fieldInput('Points must add up to', q.total || '100', set('total'), { inputmode: 'numeric' }));
    if (f.indexOf('maxWords') >= 0) row.appendChild(fieldInput('Word limit (shown to respondents)', q.maxWords, set('maxWords'), { inputmode: 'numeric' }));
    if (f.indexOf('file') >= 0) {
      row.appendChild(fieldInput('Allowed file types (shown)', q.fileTypes, set('fileTypes'), { placeholder: 'e.g. PDF' }));
      row.appendChild(fieldInput('Max size in MB (shown)', q.maxSizeMB, set('maxSizeMB'), { inputmode: 'numeric' }));
    }
    if (row.childNodes.length) box.appendChild(row);
    // defaults so the export matches what is displayed
    if (f.indexOf('range') >= 0) { if (q.min === '' || q.min == null) q.min = '0'; if (q.max === '' || q.max == null) q.max = '100'; }
    if (f.indexOf('stars') >= 0 && !q.stars) q.stars = '5';
    if (f.indexOf('total') >= 0 && !q.total) q.total = '100';
  }

  function render() {
    var box = $('questions');
    box.innerHTML = '';
    var tpl = $('qTpl');
    var prevSection = null, sectionNames = {};
    var n = 0;
    state.questions.forEach(function (q, i) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      var eff = q.section ? q.section : prevSection;
      if (q.section) sectionNames[q.section] = 1;
      var head = node.querySelector('.q-section-head');
      if (eff && eff !== prevSection) { head.hidden = false; head.textContent = 'Section: ' + eff; }
      prevSection = eff;

      if (q.type !== 'descriptive') n++;
      node.querySelector('.q-num').textContent = q.type === 'descriptive' ? 'Text' : 'Q' + n;
      if (q.planOmitted) node.classList.add('omitted');
      var type = node.querySelector('.q-type');
      typeSelect(type, q.type);
      var text = node.querySelector('.q-text');
      var help = node.querySelector('.q-help');
      var req = node.querySelector('.q-required');
      var sec = node.querySelector('.q-section');
      var tag = node.querySelector('.q-tag');
      var fields = node.querySelector('.q-fields');
      var warn = node.querySelector('.q-warn');

      text.value = q.text;
      help.value = q.help || '';
      req.checked = !!q.required;
      sec.value = q.section || '';
      tag.value = q.tag || '';
      node.querySelector('.q-req').hidden = q.type === 'descriptive' || q.type === 'timing';

      function refreshWarn() {
        var w = warningsFor(q);
        warn.hidden = !w.length;
        warn.textContent = w.join(' ');
        updateSummary();
      }
      renderFields(q, fields, refreshWarn);
      refreshWarn();

      type.addEventListener('change', function () {
        var was = q.type;
        q.type = type.value;
        delete q.paidType; delete q.planNote; delete q.planOmitted;
        node.classList.remove('omitted');
        q.warning = null;
        // carry list contents sensibly between types
        if ((q.type === 'matrix' || q.type === 'matrixMulti') && !q.scale.length) q.scale = SCALE_PRESETS['Agree (5)'].slice();
        if (q.type === 'single' && was === 'text' && !q.choices.length && /yes|no/i.test(q.text)) q.choices = ['Yes', 'No'];
        node.querySelector('.q-req').hidden = q.type === 'descriptive' || q.type === 'timing';
        renderFields(q, fields, refreshWarn);
        refreshWarn();
        if ((was === 'descriptive') !== (q.type === 'descriptive')) render();
      });
      text.addEventListener('input', function () { q.text = text.value; refreshWarn(); });
      help.addEventListener('input', function () { q.help = help.value; });
      req.addEventListener('change', function () { q.required = req.checked; });
      sec.addEventListener('change', function () { q.section = sec.value.trim() || null; render(); });
      tag.addEventListener('input', function () { q.tag = tag.value.trim(); });
      node.querySelector('.up').addEventListener('click', function () { move(i, -1); });
      node.querySelector('.down').addEventListener('click', function () { move(i, 1); });
      node.querySelector('.dup').addEventListener('click', function () {
        var c = JSON.parse(JSON.stringify(q)); c.tag = '';
        state.questions.splice(i + 1, 0, c); render();
      });
      node.querySelector('.del').addEventListener('click', function () { state.questions.splice(i, 1); render(); });
      box.appendChild(node);
    });
    var dl = $('sectionList'); dl.innerHTML = '';
    Object.keys(sectionNames).forEach(function (s) { dl.appendChild(el('option', { value: s })); });
    $('count').textContent = plural(n, 'question');
    updateSummary();
  }

  function updateSummary() {
    var bad = 0, changed = 0, omitted = 0;
    state.questions.forEach(function (q) {
      if (QSFBuilder.validate(q).length) bad++;
      if (q.paidType && state.plan === 'free') { if (q.planOmitted) omitted++; else changed++; }
    });
    var msg = [];
    if (bad) msg.push(plural(bad, 'question') + ' still need fixing (see the yellow notes).');
    var pw = [];
    if (changed) pw.push(plural(changed, 'paid-only question') + ' will be exported as text boxes because you chose the free plan.');
    if (omitted) pw.push(plural(omitted, 'paid-only question') + ' will be left out.');
    $('warnSummary').hidden = !msg.length;
    $('warnSummary').textContent = msg.join(' ');
    $('planWarn').hidden = !pw.length;
    $('planWarn').textContent = pw.join(' ');
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= state.questions.length) return;
    var t = state.questions[i]; state.questions[i] = state.questions[j]; state.questions[j] = t;
    render();
  }

  // ---------- Export ----------
  function download() {
    var qs = state.questions;
    if (!qs.length) { alert('Add at least one question first.'); return; }
    var problems = [];
    var n = 0;
    qs.forEach(function (q) {
      if (q.type !== 'descriptive') n++;
      var e = QSFBuilder.validate(q);
      if (e.length) problems.push((q.type === 'descriptive' ? 'Text block' : 'Q' + n) + ': ' + e.join(' '));
    });
    if (problems.length) { alert('Please fix these first:\n\n' + problems.join('\n')); return; }

    var exportQs = qs.map(function (q) {
      var c = {};
      for (var k in q) c[k] = q[k];
      if (q.paidType && q.planNote) c.help = [q.help, q.planNote].filter(Boolean).join(' ');
      if (q.planOmitted) c.type = q.paidType;
      return c;
    });
    var qsf = QSFBuilder.build(exportQs, {
      name: $('surveyName').value,
      plan: state.plan || 'free',
      tagPrefix: ($('tagPrefix').value || 'Q').replace(/[^A-Za-z0-9_]/g, '') || 'Q',
      perPage: parseInt($('perPage').value, 10) || 0,
      sectionTitles: $('sectionTitles').checked,
      forceResponse: $('forceResponse').checked,
      horizontal: $('horizontal').checked,
      randomize: $('randomize').checked,
      backButton: $('backButton').checked
    });
    var blob = new Blob([JSON.stringify(qsf)], { type: 'application/json' });
    var a = document.createElement('a');
    var fname = ($('surveyName').value || 'survey').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') || 'survey';
    a.href = URL.createObjectURL(blob);
    a.download = fname + '.qsf';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- Wiring ----------
  Array.prototype.forEach.call(document.querySelectorAll('.plan'), function (b) {
    b.addEventListener('click', function () { setPlan(b.getAttribute('data-plan')); });
  });
  $('changePlan').addEventListener('click', function () {
    $('planChoices').hidden = false; $('planNote').hidden = false;
    $('planChosen').hidden = true; $('changePlan').hidden = true;
  });

  var drop = $('drop');
  $('file').addEventListener('change', function (e) { handleFile(e.target.files[0]); e.target.value = ''; });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); }
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { handleFile(e.dataTransfer && e.dataTransfer.files[0]); });
  $('parsePaste').addEventListener('click', function () {
    var qs = SurveyParser.parseText($('paste').value);
    loadQuestions(qs, qs.title || null, null);
  });
  $('startBlank').addEventListener('click', function () {
    loadQuestions([{ text: '', type: 'single', choices: [], scale: [], help: '', required: false, section: null, tag: '' }], 'New Survey', null);
    setStatus('');
  });
  $('addQ').addEventListener('click', function () {
    state.questions.push({ text: '', type: 'single', choices: [], scale: [], help: '', required: false, section: null, tag: '', min: '', max: '', decimals: '', stars: '', total: '', maxWords: '', fileTypes: '', maxSizeMB: '' });
    render();
    var all = document.querySelectorAll('.q-text');
    all[all.length - 1].focus();
  });
  $('download').addEventListener('click', download);
})();
