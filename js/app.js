(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { questions: [] };

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  function setStatus(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function baseName(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  // ---------- File reading ----------
  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }
  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  async function parseFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'doc') throw new Error('Old .doc files are not supported. In Word, use File → Save As → Word Document (.docx), then try again.');
    if (ext === 'docx') {
      var buf = await readAsArrayBuffer(file);
      var res = await mammoth.convertToHtml({ arrayBuffer: buf });
      return SurveyParser.parseLines(SurveyParser.htmlToLines(res.value));
    }
    if (ext === 'pdf') {
      var data = new Uint8Array(await readAsArrayBuffer(file));
      var pdf = await pdfjsLib.getDocument({ data: data }).promise;
      var pages = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        var tc = await page.getTextContent();
        pages.push(tc.items);
      }
      var lines = SurveyParser.pdfItemsToLines(pages);
      if (!lines.some(function (l) { return l.trim(); })) {
        throw new Error('No text found in this PDF. It may be a scanned image — try a PDF with selectable text, or a Word file.');
      }
      return SurveyParser.parseLines(lines);
    }
    if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].indexOf(ext) >= 0) {
      var wb;
      if (ext === 'csv' || ext === 'tsv') {
        wb = XLSX.read(await readAsText(file), { type: 'string', FS: ext === 'tsv' ? '\t' : ',' });
      } else {
        wb = XLSX.read(await readAsArrayBuffer(file), { type: 'array' });
      }
      var rows = [];
      for (var i = 0; i < wb.SheetNames.length; i++) {
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[i]], { header: 1, raw: false, defval: '' });
        if (rows.some(function (r) { return r.some(function (c) { return String(c).trim(); }); })) break;
      }
      return SurveyParser.parseRows(rows);
    }
    // txt, md, anything else: treat as text
    return SurveyParser.parseText(await readAsText(file));
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus('Reading ' + file.name + '…');
    try {
      var qs = await parseFile(file);
      var name = qs.title || baseName(file.name);
      loadQuestions(qs, name, file.name);
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
      return { text: q.text, type: q.type, choices: q.choices.slice(), warning: q.warning, required: false };
    });
    if (name) $('surveyName').value = name;
    var warnCount = qs.filter(function (q) { return q.warning; }).length;
    setStatus('Found ' + qs.length + ' question' + (qs.length === 1 ? '' : 's') +
      (source ? ' in ' + source : '') + (warnCount ? ' — ' + warnCount + ' need a quick check.' : '.'), 'ok');
    render();
    $('step-review').hidden = false;
    $('step-export').hidden = false;
    $('step-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Editor ----------
  function render() {
    var box = $('questions');
    box.innerHTML = '';
    var tpl = $('qTpl');
    state.questions.forEach(function (q, i) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.q-num').textContent = 'Q' + (i + 1);
      var type = node.querySelector('.q-type');
      var text = node.querySelector('.q-text');
      var choices = node.querySelector('.q-choices');
      var choicesLabel = node.querySelector('.q-choices-label');
      var req = node.querySelector('.q-required');
      var warn = node.querySelector('.q-warn');

      type.value = q.type;
      text.value = q.text;
      choices.value = q.choices.join('\n');
      choices.rows = Math.min(10, Math.max(3, q.choices.length + 1));
      req.checked = !!q.required;
      choicesLabel.hidden = q.type === 'text';
      if (q.warning) { warn.hidden = false; warn.textContent = q.warning; }

      type.addEventListener('change', function () {
        q.type = type.value;
        choicesLabel.hidden = q.type === 'text';
        q.warning = null; warn.hidden = true;
        if (q.type !== 'text' && !q.choices.length) choices.focus();
      });
      text.addEventListener('input', function () { q.text = text.value; });
      choices.addEventListener('input', function () {
        q.choices = choices.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      });
      req.addEventListener('change', function () { q.required = req.checked; });
      node.querySelector('.up').addEventListener('click', function () { move(i, -1); });
      node.querySelector('.down').addEventListener('click', function () { move(i, 1); });
      node.querySelector('.del').addEventListener('click', function () {
        state.questions.splice(i, 1); render();
      });
      box.appendChild(node);
    });
    $('count').textContent = state.questions.length + ' question' + (state.questions.length === 1 ? '' : 's');
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= state.questions.length) return;
    var t = state.questions[i]; state.questions[i] = state.questions[j]; state.questions[j] = t;
    render();
  }

  // ---------- Export ----------
  function download() {
    var problems = [];
    var qs = state.questions.filter(function (q) { return q.text.trim(); });
    qs.forEach(function (q, i) {
      if (q.type !== 'text' && q.choices.length === 0) problems.push('Q' + (i + 1));
    });
    if (!qs.length) { alert('Add at least one question first.'); return; }
    if (problems.length) {
      alert('These choice questions have no answer choices: ' + problems.join(', ') + '.\nAdd choices or change their type to Text entry.');
      return;
    }
    var forceAll = $('forceResponse').checked;
    var qsf = QSFBuilder.build(qs.map(function (q) {
      return { text: q.text.trim(), type: q.type, choices: q.choices, required: forceAll || q.required };
    }), {
      name: $('surveyName').value,
      tagPrefix: ($('tagPrefix').value || 'Q').replace(/[^A-Za-z0-9_]/g, '') || 'Q',
      perPage: parseInt($('perPage').value, 10) || 0,
      horizontal: $('horizontal').checked,
      randomize: $('randomize').checked,
      essay: $('essay').checked,
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
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files[0];
    handleFile(f);
  });
  $('parsePaste').addEventListener('click', function () {
    var qs = SurveyParser.parseText($('paste').value);
    loadQuestions(qs, qs.title || null, null);
  });
  $('addQ').addEventListener('click', function () {
    state.questions.push({ text: '', type: 'single', choices: [], warning: null, required: false });
    render();
    var all = document.querySelectorAll('.q-text');
    all[all.length - 1].focus();
  });
  $('download').addEventListener('click', download);
})();
