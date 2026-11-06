/*
 * Rule-based survey parser.
 *
 * Produces questions in the builder model (see qsf.js) plus a `warning`:
 *   { text, type, help, required, section, tag, choices, scale, min, max,
 *     decimals, stars, total, maxWords, fileTypes, maxSizeMB, warning }
 *
 * Inputs:
 *   parseText(text)          plain text (.txt, pasted)
 *   parseLines(lines)        lines from Word / PDF (see htmlToLines, pdfItemsToLines)
 *   parseRows(rows, opts)    spreadsheet rows (first row may be a header)
 *   parseWorkbook(sheets)    [{name, rows}] for multi-sheet files
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SurveyParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Patterns ----------
  // "1." "1)" "Q1" "Q1." "Q.1" "Question 1:" "#1" "F01."
  var QUESTION_RE = /^\s*(?:(?:Q(?:uestion)?\s*\.?\s*(\d+[a-z]?)\s*[.:)\-–]?)|(?:#?(\d{1,3}[a-z]?)\s*[.)]))\s+(.*)$/i;
  // "a)" "a." "(a)" "A)" "i)" "-" "•" "*" "○" "☐" "[ ]" "( )" + symbol-font bullets
  var CHOICE_RE = /^\s*(?:\(([a-zA-Z]|[ivxIVX]{1,4})\)|([a-zA-Z])[.)](?=\s)|([ivxIVX]{1,4})\)|(\[\s?\]|\(\s?\))|([-–—•●◦▪▫■□☐☑☒○◯◻✓✔*>·o-•‣⁃▪-◿])(?=\s|$))\s*(.*)$/;
  var SECTION_RE = /^\s*(?:#{1,3}\s+(.+)|(?:section|part|module|block|chapter)\s+([A-Z0-9IVX]{1,4})\b\s*[:.\-–—]?\s*(.*))$/i;
  var SCALE_LINE_RE = /^\s*(scale|columns?|rating scale|response scale)\s*[:\-–]\s*(.+)$/i;
  var ROWS_LINE_RE = /^\s*(rows|statements|items)\s*[:\-–]\s*(.*)$/i;
  var HELP_LINE_RE = /^\s*(note|hint|help|instructions?|guidance|description)\s*[:\-–]\s*(.+)$/i;
  var MULTI_HINT_RE = /(select|check|choose|tick|mark)\s+(all|any|as many|multiple|one or more|up to)|all that apply|multiple (answers|responses|selections)/i;
  var REQUIRED_RE = /\s*(\((required|mandatory|compulsory)\)|\[(required|mandatory)\]|\*+)\s*$/i;
  var TAG_RE = /\s*\[([^\]]{2,40})\]\s*$/;
  var MULTI_GLYPHS = /[□☐☑☒◻]|\[\s?\]/;
  var MATRIX_MARK = '\u0001MATRIX\u0001';
  var ROWS_MARK = '\u0001ROWS\u0001';
  var SECTION_MARK = '\u0001SECTION\u0001';

  var LIKERT_5 = ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'];
  var CHOICE_TYPES = ['single', 'multi', 'dropdown', 'rank', 'constantSum', 'matrix', 'matrixMulti', 'form'];

  function clean(s) {
    return String(s == null ? '' : s).replace(/ /g, ' ').replace(/^[-]+(?=\S)/, '$& ')
      .replace(/[ \t]+/g, ' ').trim();
  }
  function stripMarker(s) {
    var m = clean(s).match(CHOICE_RE);
    return m && clean(m[6]) ? clean(m[6]) : clean(s);
  }
  function blankQ(text) {
    return {
      text: text || '', type: null, help: '', required: false, section: null, tag: '',
      choices: [], scale: [], min: '', max: '', decimals: '', stars: '', total: '',
      maxWords: '', fileTypes: '', maxSizeMB: '', warning: null
    };
  }

  // ---------- Type names ----------
  /**
   * Interpret a free-text type description such as "Long Text (Max 500 words)",
   * "File Upload (PDF)", "Dropdown", "Rating 1-5", "Yes/No".
   * Returns { type, ...settings } or null when unrecognised.
   */
  function normType(raw) {
    var s = clean(raw).toLowerCase();
    if (!s) return null;
    var out = {};
    var words = s.match(/(\d+)\s*words?/);
    var range = s.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/);
    var paren = clean(raw).match(/\(([^)]+)\)/);

    function t(type) { out.type = type; return out; }

    if (/signature|sign here|e-?sign/.test(s)) return t('signature');
    if (/captcha|bot check/.test(s)) return t('captcha');
    if (/file|upload|attach|document upload/.test(s)) {
      if (paren && !/mb|kb|max/i.test(paren[1])) out.fileTypes = clean(paren[1]).toUpperCase();
      var mb = s.match(/(\d+(?:\.\d+)?)\s*mb/); if (mb) out.maxSizeMB = mb[1];
      return t('file');
    }
    if (/timer|timing/.test(s)) return t('timing');
    if (/\bnps\b|net promoter/.test(s)) return t('nps');
    if (/constant sum|allocate|distribute points|points? total|sum to/.test(s)) {
      var tot = s.match(/(\d+)/); if (tot) out.total = tot[1];
      return t('constantSum');
    }
    if (/rank/.test(s)) return t('rank');
    if (/star/.test(s)) { var st = s.match(/(\d+)/); if (st) out.stars = st[1]; return t('stars'); }
    if (/slider/.test(s)) { if (range) { out.min = range[1]; out.max = range[2]; } return t('slider'); }
    if (/matrix|grid|likert|table/.test(s)) return t(/multi|check|several|many/.test(s) ? 'matrixMulti' : 'matrix');
    if (/\bform\b|form fields|multiple fields/.test(s)) return t('form');
    if (/e-?mail/.test(s)) return t('email');
    if (/phone|mobile|whats ?app|telephone|\btel\b|contact number|cell/.test(s)) return t('phone');
    if (/\bdate\b|dob|calendar|dd\/mm|mm\/dd/.test(s)) return t('date');
    if (/rating|scale/.test(s) && range) {
      var a = parseFloat(range[1]), b = parseFloat(range[2]);
      if (b > a && b - a <= 10 && a === Math.round(a) && b === Math.round(b)) {
        out.choices = []; for (var i = a; i <= b; i++) out.choices.push(String(i));
        out.horizontal = true;
        return t('single');
      }
      out.min = range[1]; out.max = range[2];
      return t('slider');
    }
    if (/numer|number|integer|decimal|\bint\b|amount|currency|\byear\b|\bage\b|count|quantity|percent/.test(s)) {
      if (/integer|\byear\b|\bint\b|\bage\b|count/.test(s)) out.decimals = '0';
      if (range) { out.min = range[1]; out.max = range[2]; }
      return t('number');
    }
    if (/long|essay|paragraph|multi-?line|text ?area|comment box|open[- ]ended long|narrative/.test(s)) {
      if (words) out.maxWords = words[1];
      return t('essay');
    }
    if (/yes\s*\/\s*no|yes or no|boolean|true\s*\/\s*false/.test(s)) {
      out.choices = /true/.test(s) ? ['True', 'False'] : ['Yes', 'No'];
      return t('single');
    }
    if (/drop ?-?down|select ?list|select box|combo|pick ?list|^list$|^select$/.test(s)) return t('dropdown');
    if (/check ?box|multi[- ]?select|multiple (answers?|select|selection|response)|select all|tick all|^multi(ple)?$|\bmaq\b|^ma$/.test(s)) return t('multi');
    if (/radio|single|multiple choice|\bmcq\b|choice|option|^mc$|^sa$/.test(s)) return t('single');
    if (/descriptive|instruction|heading|header|section|^label$|^info|^note$|text\s*\/\s*graphic|display only|static/.test(s)) return t('descriptive');
    if (/text|short|string|name|single line|open|input|free|answer|response/.test(s)) {
      if (words) { out.maxWords = words[1]; return t('essay'); }
      return t('text');
    }
    return null;
  }

  /** Guess a type for a question with no choices from its wording. */
  function inferFromText(text) {
    var s = clean(text).toLowerCase();
    if (/\be-?mail\b/.test(s)) return { type: 'email' };
    if (/phone|mobile number|whats ?app|telephone|contact number/.test(s)) return { type: 'phone' };
    if (/date of birth|\bdob\b|\bdate\b|dd\/mm|mm\/dd/.test(s)) return { type: 'date' };
    if (/upload|attach (a|your)|\bcv\b|resume|résumé/.test(s) && /upload|attach/.test(s)) return { type: 'file' };
    if (/signature|please sign/.test(s)) return { type: 'signature' };
    if (/how many|number of|^age\b|your age|how old|year of|which year|^year\b|graduation year/.test(s)) return { type: 'number', decimals: '0' };
    if (/describe|explain|statement of purpose|comments?\b|feedback|tell us|why\b|elaborate|in your own words|essay/.test(s)) {
      var w = s.match(/(\d+)\s*words?/);
      return { type: 'essay', maxWords: w ? w[1] : '' };
    }
    return { type: 'text' };
  }

  function applyInfo(q, info) {
    if (!info) return q;
    for (var k in info) {
      if (k === 'choices') { if (!q.choices.length) q.choices = info.choices.slice(); }
      else if (k === 'horizontal') q.horizontal = true;
      else if (info[k] !== '' && info[k] != null) q[k] = info[k];
    }
    return q;
  }

  function splitList(s, allowSlash, allowComma) {
    s = String(s == null ? '' : s);
    var parts;
    if (/\n/.test(s)) parts = s.split(/\n/);
    else if (/[;|]/.test(s)) parts = s.split(/[;|]/);
    else if (allowSlash && /\s\/\s|\S\/\S/.test(s) && !/\bdd\/mm|mm\/dd|https?:\/\//i.test(s)) parts = s.split(/\s*\/\s*/);
    else if (allowComma && /,/.test(s)) parts = s.split(/,/);
    else parts = [s];
    return parts.map(stripMarker).filter(Boolean);
  }

  /** Does a help/description cell look like a list of choices? */
  function looksLikeChoiceList(s) {
    var str = clean(s);
    if (!str || /^e\.g\.|^for example|^example|^\(?eg\b/i.test(str)) return false;
    var parts = splitList(str, true, true);
    if (parts.length < 2) return false;
    return parts.every(function (p) { return p.length <= 60; }) && !/[.?]\s*$/.test(str.replace(/etc\.$/, ''));
  }

  // ---------- Finalising ----------
  function finalize(q) {
    // Strip trailing required marker and [type] tags from the question text.
    var text = clean(q.text);
    var guard = 0;
    while (guard++ < 4) {
      var rm = text.match(REQUIRED_RE);
      if (rm) { q.required = true; text = text.slice(0, rm.index).trim(); continue; }
      var tm = text.match(TAG_RE);
      if (tm) {
        var tagText = tm[1];
        if (/^(required|mandatory)$/i.test(tagText)) { q.required = true; text = text.slice(0, tm.index).trim(); continue; }
        var info = normType(tagText);
        if (info) { q._tagType = true; q.type = null; applyInfo(q, info); text = text.slice(0, tm.index).trim(); continue; }
      }
      break;
    }
    q.text = text;
    q.choices = (q.choices || []).map(clean).filter(Boolean);
    q.scale = (q.scale || []).map(clean).filter(Boolean);

    if (!q.type) {
      if (q.scale.length && q.choices.length) q.type = 'matrix';
      else if (q.choices.length) q.type = (MULTI_HINT_RE.test(q.text) || (q._glyphs && q._glyphs.multi)) ? 'multi' : 'single';
      else applyInfo(q, inferFromText(q.text));
    }
    if (q.type === 'single' && MULTI_HINT_RE.test(q.text) && !q._tagType) q.type = 'multi';

    var t = q.type;
    if ((t === 'matrix' || t === 'matrixMulti') && q.scale.length < 2) {
      q.scale = LIKERT_5.slice();
      q.warning = 'No rating scale was found, so a 5-point agree/disagree scale was added. Edit the scale if needed.';
    }
    if (CHOICE_TYPES.indexOf(t) >= 0 && t !== 'form' && q.choices.length === 0) {
      if (t === 'single' || t === 'multi' || t === 'dropdown') {
        q.warning = 'Marked as "' + t + '" but no answer choices were found. Add choices below or change the type.';
      } else {
        q.warning = 'No items were found for this question. Add them below.';
      }
    } else if ((t === 'single' || t === 'multi' || t === 'dropdown') && q.choices.length === 1) {
      q.warning = 'Only one answer choice was found. Check that the choices were detected correctly.';
    }
    if (['single', 'multi', 'dropdown', 'rank', 'constantSum', 'matrix', 'matrixMulti', 'slider', 'stars', 'form'].indexOf(t) < 0) q.choices = [];
    if (t !== 'matrix' && t !== 'matrixMulti') q.scale = [];

    delete q._glyphs; delete q._tagType;
    return q;
  }

  // ---------- Line-based parsing (txt, docx, pdf) ----------
  function parseLines(lines) {
    var items = []; // questions and section markers in order
    var cur = null;
    var blankSince = true;
    var state = 'none'; // 'question' | 'choices' | 'rows'
    var section = null;
    var title = null;
    var extraQuestions = [];

    function push() {
      if (cur && clean(cur.text)) items.push(cur);
      cur = null; state = 'none';
    }
    function start(text, numbered) {
      push();
      cur = blankQ(text);
      cur.section = section;
      cur._numbered = !!numbered;
      cur._glyphs = { multi: false };
      state = 'question';
    }

    for (var i = 0; i < lines.length; i++) {
      var rawLine = String(lines[i] == null ? '' : lines[i]);

      if (rawLine.indexOf(SECTION_MARK) === 0) {
        push();
        section = clean(rawLine.slice(SECTION_MARK.length));
        items.push({ _section: section });
        blankSince = true; continue;
      }
      if (rawLine.indexOf(MATRIX_MARK) === 0) {
        var mx = JSON.parse(rawLine.slice(MATRIX_MARK.length));
        // The matrix belongs to the question right before it, or stands alone.
        if (cur && !cur.choices.length) { cur.choices = mx.rows; cur.scale = mx.scale; cur.type = mx.multi ? 'matrixMulti' : 'matrix'; push(); }
        else { push(); var mq = blankQ(mx.title || 'Please rate each statement.'); mq.section = section; mq.choices = mx.rows; mq.scale = mx.scale; mq.type = 'matrix'; mq._numbered = true; items.push(mq); }
        blankSince = true; continue;
      }
      if (rawLine.indexOf(ROWS_MARK) === 0) {
        push();
        var rq = parseRows(JSON.parse(rawLine.slice(ROWS_MARK.length)), { section: section });
        rq.forEach(function (q) { q._numbered = true; items.push(q); });
        blankSince = true; continue;
      }

      var line = clean(rawLine);
      if (!line) { blankSince = true; continue; }

      var sm = line.match(SECTION_RE);
      if (sm && !(cur && state === 'question' && !blankSince)) {
        push();
        section = clean(sm[1] || (sm[3] ? sm[3] : 'Section ' + sm[2]));
        if (sm[2] && sm[3]) section = clean(sm[3]);
        items.push({ _section: section });
        blankSince = true; continue;
      }

      var qm = line.match(QUESTION_RE);
      var cm = line.match(CHOICE_RE);

      if (cur && SCALE_LINE_RE.test(line)) {
        cur.scale = splitList(line.match(SCALE_LINE_RE)[2], true, true);
        state = 'choices'; blankSince = false; continue;
      }
      if (cur && ROWS_LINE_RE.test(line)) {
        var rest = clean(line.match(ROWS_LINE_RE)[2]);
        if (rest) cur.choices = cur.choices.concat(splitList(rest, false, false));
        state = 'choices'; blankSince = false; continue;
      }
      if (cur && HELP_LINE_RE.test(line) && !cm) {
        cur.help = clean((cur.help ? cur.help + ' ' : '') + line.match(HELP_LINE_RE)[2]);
        blankSince = false; continue;
      }

      if (qm && clean(qm[3])) {
        start(qm[3], true);
        cur.tag = '';
      } else if (cm && clean(cm[6]) && cur) {
        if (MULTI_GLYPHS.test(line.slice(0, 4))) cur._glyphs.multi = true;
        cur.choices.push(cm[6]);
        state = 'choices';
      } else if (cm && clean(cm[6]) && !cur) {
        start(cm[6], false);
      } else if (!cur) {
        start(line, false);
      } else if (state === 'question') {
        var qt = clean(cur.text);
        if (blankSince && !cur._numbered) {
          start(line, false);
        } else if (/[?:]\s*$/.test(qt) || (/[)\]*]\s*$/.test(qt) && (MULTI_HINT_RE.test(qt) || TAG_RE.test(qt) || REQUIRED_RE.test(qt) || /\?\s*\(.*\)\s*$/.test(qt)))) {
          if (blankSince && cur._numbered && /[?:]\s*$/.test(qt) && /[.?]$/.test(line) && line.length > 80) {
            // A long sentence after a blank line is a paragraph, not a choice.
            start(line, false);
          } else {
            cur.choices.push(line);
            state = 'choices';
          }
        } else if (blankSince) {
          start(line, false);
        } else {
          cur.text += ' ' + line;
        }
      } else { // choices
        if (blankSince) start(line, false);
        else cur.choices.push(line);
      }
      blankSince = false;
    }
    push();

    var questions = items.filter(function (it) { return !it._section; });
    var numberedCount = questions.filter(function (q) { return q._numbered; }).length;

    // Leading unnumbered text before the first question: first short line is the title,
    // the rest become instructions.
    if (numberedCount) {
      for (var k = 0; k < questions.length && !questions[k]._numbered; k++) {
        var pre = questions[k];
        if (pre.choices.length) break;
        if (!title && pre.text.length <= 120 && k === 0 && !/[?]$/.test(pre.text)) { pre._drop = true; title = clean(pre.text); }
      }
    }
    var out = questions.filter(function (q) { return !q._drop; }).map(function (q) {
      var wasNumbered = q._numbered; delete q._numbered;
      var f = finalize(q);
      // In a numbered questionnaire, unnumbered paragraphs without choices are instructions.
      if (numberedCount >= 2 && !wasNumbered && !f.choices.length && !/\?\s*$/.test(f.text) &&
          ['text', 'essay'].indexOf(f.type) >= 0) {
        f.type = 'descriptive'; f.warning = null;
      }
      return f;
    }).concat(extraQuestions);
    out.title = title;
    return out;
  }

  function parseText(text) {
    return parseLines(String(text || '').replace(/\r\n?/g, '\n').split('\n'));
  }

  // ---------- Word (mammoth HTML) ----------
  function htmlToLines(html, DOMParserImpl) {
    var Parser = DOMParserImpl || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Parser) throw new Error('DOMParser not available');
    var doc = new Parser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
    var out = [];
    var qCounter = 0;
    var lastWasQuestion = false;
    var headingCount = 0;

    function textOf(node) {
      var s = '';
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && (c.tagName === 'OL' || c.tagName === 'UL')) continue;
        s += c.nodeType === 3 ? c.nodeValue : (c.tagName === 'BR' ? ' ' : c.textContent);
      }
      return clean(s);
    }

    function walkList(list, depth) {
      var ordered = list.tagName === 'OL';
      var items = [];
      for (var c = list.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.tagName === 'LI') items.push(c);
      var asChoices = depth > 0 || !ordered ||
        (lastWasQuestion && items.every(function (li) { return !/\?\s*$/.test(textOf(li)) && textOf(li).length < 120; }));
      items.forEach(function (li) {
        var t = textOf(li);
        if (t) {
          if (asChoices) { out.push('- ' + t); lastWasQuestion = false; }
          else { qCounter++; out.push(''); out.push(qCounter + '. ' + t); lastWasQuestion = true; }
        }
        for (var n = li.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 1 && (n.tagName === 'OL' || n.tagName === 'UL')) walkList(n, depth + 1);
        }
      });
      if (depth === 0) out.push('');
    }

    function tableRows(table) {
      return Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
        return Array.prototype.map.call(tr.querySelectorAll('td,th'), function (td) { return clean(td.textContent); });
      }).filter(function (r) { return r.some(Boolean); });
    }

    function handleTable(table) {
      var rows = tableRows(table);
      if (!rows.length) return;
      // 1) Specification table (Question | Type | Options ...)
      if (rows.length >= 2 && detectColumns(rows).question >= 0 && detectColumns(rows).headerScore >= 2) {
        out.push(ROWS_MARK + JSON.stringify(rows));
        lastWasQuestion = false;
        return;
      }
      // 2) Matrix: header row of scale labels, first column statements, other cells empty/marks.
      var head = rows[0];
      var body = rows.slice(1);
      var isMark = function (v) { return !v || /^[☐□○◯◻●◉○oOxX✓✔\[\]()\s_\-]+$/.test(v) || /^\d{1,2}$/.test(v); };
      if (head.length >= 3 && body.length >= 1 && head.slice(1).filter(Boolean).length >= 2 &&
          body.every(function (r) { return r[0] && r.slice(1).every(isMark); })) {
        out.push(MATRIX_MARK + JSON.stringify({ title: head[0] || '', rows: body.map(function (r) { return r[0]; }), scale: head.slice(1).filter(Boolean) }));
        lastWasQuestion = false;
        return;
      }
      // 3) Otherwise read cell text in order.
      rows.forEach(function (r) { r.filter(Boolean).forEach(function (t) { out.push(t); }); out.push(''); });
    }

    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var tag = c.tagName;
        if (tag === 'OL' || tag === 'UL') walkList(c, 0);
        else if (tag === 'TABLE') handleTable(c);
        else if (/^H[1-6]$/.test(tag)) {
          var ht = clean(c.textContent);
          if (!ht) continue;
          headingCount++;
          // The very first H1 is treated as the survey title (handled by parseLines' title rule).
          if (headingCount === 1 && tag === 'H1') { out.push(ht); out.push(''); }
          else if (QUESTION_RE.test(ht) || /\?\s*$/.test(ht)) { out.push(ht); lastWasQuestion = true; }
          else { out.push(''); out.push(SECTION_MARK + ht); out.push(''); lastWasQuestion = false; }
        } else if (/^(P|DIV|BLOCKQUOTE)$/.test(tag)) {
          if (tag === 'DIV' && c.querySelector('p,ol,ul,table')) { walk(c); continue; }
          var t = clean(c.textContent);
          if (t) {
            // Bold-only short paragraphs that aren't questions are section headings.
            var strong = c.querySelector('strong,b');
            if (strong && clean(strong.textContent) === t && t.length < 80 && !QUESTION_RE.test(t) && !/[?:]\s*$/.test(t) && !CHOICE_RE.test(t)) {
              out.push(''); out.push(SECTION_MARK + t); out.push('');
              lastWasQuestion = false;
            } else {
              out.push(t);
              lastWasQuestion = QUESTION_RE.test(t) || /\?\s*$/.test(t);
            }
          } else out.push('');
        } else walk(c);
      }
    }
    walk(doc.getElementById('root') || doc.body);
    return out;
  }

  // ---------- Spreadsheets ----------
  var ROLE_PATTERNS = {
    id: /^(field|question|item|q|var(iable)?|s\.?\s*no|sl\.?\s*no|sr\.?\s*no)?\s*\.?\s*(id|no\.?|num(ber)?|#|code|ref(erence)?)$|^(variable( name)?|export tag|tag|data export tag|qid)$/,
    question: /^(question|questions|question text|question wording|wording|field name|field label|field|label|item|item text|prompt|title|statement|text|query|questionnaire item|survey question)s?$/,
    type: /^(type|field type|question type|q ?type|input type|answer type|response type|format|data type|kind|control( type)?|question format|response format)$/,
    choices: /^(choices|choice|options|option|answers|answer choices|answer options|response options|responses|values|categories|choice list|value list|answer list|possible answers|dropdown values|list)$/,
    section: /^(category|categories|section|block|group|module|part|page|theme|domain|topic|area)$/,
    required: /^(mandatory|required|compulsory|must answer|obligatory|is required|optional\??|required\?|mandatory\?)$/,
    help: /^(description|guidance|description \/ guidance|help|help text|hint|instructions?|notes?|comments?|placeholder|remarks|explanation|details|guidelines?|validation|description\/guidance)$/,
    scale: /^(scale|scale points|columns|rating scale|response scale)$/,
    min: /^(min|minimum|min value|from)$/,
    max: /^(max|maximum|max value|to)$/
  };

  function detectColumns(rows) {
    var best = { headerRow: -1, headerScore: 0 };
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var header = rows[r].map(function (h) { return clean(h).toLowerCase().replace(/[*:]+$/, '').trim(); });
      var roles = {}, score = 0, choiceCols = [];
      header.forEach(function (h, i) {
        if (!h) return;
        for (var role in ROLE_PATTERNS) {
          if (roles[role] == null && ROLE_PATTERNS[role].test(h)) { roles[role] = i; score++; return; }
        }
        if (/^(choice|option|answer|response|alternative)\s*[\w]{1,3}$/.test(h) || /^[a-h]$/.test(h)) choiceCols.push(i);
        else if (roles.question == null && /question|field name|label/.test(h) && !/(id|no|number|#|type|code)\b/.test(h)) { roles.question = i; score++; }
        else if (roles.type == null && /type|format/.test(h)) { roles.type = i; score++; }
        else if (roles.help == null && /description|guidance|instruction|help|note/.test(h)) { roles.help = i; score++; }
        else if (roles.choices == null && /options|choices|answers/.test(h)) { roles.choices = i; score++; }
        else if (roles.section == null && /section|category|block/.test(h)) { roles.section = i; score++; }
        else if (roles.required == null && /mandatory|required/.test(h)) { roles.required = i; score++; }
      });
      if (choiceCols.length) score++;
      if (roles.question != null && score > best.headerScore) {
        best = { headerRow: r, headerScore: score, choiceCols: choiceCols };
        for (var k in roles) best[k] = roles[k];
      }
    }
    if (best.headerRow < 0) best.question = -1;
    return best;
  }

  function isRequiredValue(v) {
    return /^(y|yes|true|1|required|mandatory|compulsory|x|✓|✔|must)$/i.test(clean(v));
  }
  function isOptionalHeader(h) { return /optional/i.test(h || ''); }

  /**
   * Spreadsheet rows -> questions.
   * opts: { section } default section name (e.g. sheet name)
   */
  function parseRows(rows, opts) {
    opts = opts || {};
    rows = (rows || []).map(function (r) { return (r || []).map(function (c) { return c == null ? '' : String(c); }); })
      .filter(function (r) { return r.some(function (c) { return clean(c); }); });
    if (!rows.length) { var e = []; e.title = null; return e; }

    var cols = detectColumns(rows);
    var title = null;
    var dataRows;
    if (cols.question >= 0) {
      dataRows = rows.slice(cols.headerRow + 1);
      if (cols.headerRow > 0) {
        var t0 = rows.slice(0, cols.headerRow).map(function (r) { return r.filter(function (c) { return clean(c); }).join(' '); }).filter(Boolean)[0];
        if (t0 && t0.length <= 150) title = clean(t0);
      }
    } else {
      // No header: column A = question, other columns = choices.
      cols = { question: 0, choiceCols: [] };
      var maxLen = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      for (var j = 1; j < maxLen; j++) cols.choiceCols.push(j);
      dataRows = rows;
    }
    var optionalHeader = cols.required != null && isOptionalHeader(rows[cols.headerRow] && rows[cols.headerRow][cols.required]);

    var questions = [];
    var last = null;
    dataRows.forEach(function (r) {
      var text = clean(r[cols.question]);
      var cellChoices = [];
      if (cols.choices != null) cellChoices = cellChoices.concat(splitList(r[cols.choices], true, false));
      (cols.choiceCols || []).forEach(function (c) { var v = clean(r[c]); if (v) cellChoices.push(stripMarker(v)); });
      if (cellChoices.length === 1 && cols.choices == null && /[;|\n]/.test(r[(cols.choiceCols || [])[0]] || '')) cellChoices = splitList(r[cols.choiceCols[0]]);

      if (!text) {
        // Continuation row: extra choices for the previous question.
        if (last) last.choices = last.choices.concat(cellChoices);
        return;
      }
      var q = blankQ();
      var m = text.match(QUESTION_RE);
      q.text = m && clean(m[3]) ? clean(m[3]) : text;
      if (cols.id != null) q.tag = clean(r[cols.id]);
      q.section = cols.section != null && clean(r[cols.section]) ? clean(r[cols.section]) : (opts.section || null);
      if (cols.required != null) {
        var rv = isRequiredValue(r[cols.required]);
        q.required = optionalHeader ? !rv && !/^(y|yes|true|1|x)$/i.test(clean(r[cols.required])) : rv;
      }
      var help = cols.help != null ? clean(r[cols.help]) : '';
      q.choices = cellChoices;
      if (cols.scale != null) q.scale = splitList(r[cols.scale], true, true);
      if (cols.min != null) q.min = clean(r[cols.min]);
      if (cols.max != null) q.max = clean(r[cols.max]);

      var info = cols.type != null ? normType(r[cols.type]) : null;
      if (info) applyInfo(q, info);
      else if (cols.type != null && clean(r[cols.type])) q.warning = 'Unknown type "' + clean(r[cols.type]) + '". Please choose one.';

      // Choices hidden in the description column (e.g. "Male / Female / Other").
      var choiceType = !q.type || ['single', 'multi', 'dropdown', 'rank', 'constantSum', 'matrix', 'matrixMulti'].indexOf(q.type) >= 0;
      if (help && !q.choices.length && choiceType && (q.type || cols.choices == null) && looksLikeChoiceList(help)) {
        if (q.type || splitList(help, true, true).length >= 2) {
          q.choices = splitList(help, true, true);
          help = '';
        }
      }
      if ((q.type === 'matrix' || q.type === 'matrixMulti') && help && !q.scale.length && looksLikeChoiceList(help)) {
        q.scale = splitList(help, true, true); help = '';
      }
      // File settings mentioned in the description.
      if (q.type === 'file' && help) {
        var mb = help.match(/(\d+(?:\.\d+)?)\s*mb/i); if (mb && !q.maxSizeMB) q.maxSizeMB = mb[1];
      }
      if (q.type === 'number' && q.decimals === '' && /\byear\b|how many|number of|\bage\b/i.test(q.text + ' ' + help)) q.decimals = '0';
      if (q.type === 'essay' && !q.maxWords) { var w = (help + ' ' + (r[cols.type] || '')).match(/(\d+)\s*words?/i); if (w) q.maxWords = w[1]; }
      q.help = help;
      var prevWarning = q.warning;
      finalize(q);
      if (prevWarning && !q.warning) q.warning = prevWarning;
      questions.push(q);
      last = q;
    });
    questions.title = title;
    return questions;
  }

  /** sheets: [{ name, rows }] -> questions from every sheet that has some. */
  function parseWorkbook(sheets) {
    var nonEmpty = sheets.filter(function (s) { return (s.rows || []).some(function (r) { return (r || []).some(function (c) { return clean(c); }); }); });
    var all = [];
    var title = null;
    nonEmpty.forEach(function (s) {
      var qs = parseRows(s.rows, { section: nonEmpty.length > 1 ? s.name : null });
      if (!title && qs.title) title = qs.title;
      all = all.concat(qs);
    });
    all.title = title;
    return all;
  }

  // ---------- PDF ----------
  function pdfItemsToLines(pages) {
    var lines = [];
    pages.forEach(function (items) {
      var rows = [];
      items.forEach(function (it) {
        if (!it.str && !it.hasEOL) return;
        var y = it.transform ? it.transform[5] : 0;
        var x = it.transform ? it.transform[4] : 0;
        var h = Math.abs(it.height || (it.transform ? it.transform[3] : 10)) || 10;
        var row = rows.find(function (r) { return Math.abs(r.y - y) < Math.max(2, h * 0.4); });
        if (!row) { row = { y: y, h: h, parts: [] }; rows.push(row); }
        row.parts.push({ x: x, s: it.str || '' });
      });
      rows.sort(function (a, b) { return b.y - a.y; });
      var prev = null;
      rows.forEach(function (r) {
        r.parts.sort(function (a, b) { return a.x - b.x; });
        var s = r.parts.map(function (p) { return p.s; }).join('').replace(/\s+/g, ' ').trim();
        if (!s) return;
        if (prev && (prev.y - r.y) > Math.max(prev.h, r.h) * 1.9) lines.push('');
        lines.push(s);
        prev = r;
      });
      lines.push('');
    });
    return lines;
  }

  return {
    parseLines: parseLines,
    parseText: parseText,
    parseRows: parseRows,
    parseWorkbook: parseWorkbook,
    htmlToLines: htmlToLines,
    pdfItemsToLines: pdfItemsToLines,
    normType: normType,
    detectColumns: detectColumns
  };
});
