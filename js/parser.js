/*
 * Rule-based survey parser.
 * Turns plain lines of text (from .txt, .docx, .pdf) or spreadsheet rows
 * (from .xlsx / .csv) into a list of questions:
 *   { text: string, type: 'single'|'multi'|'dropdown'|'text', choices: string[] }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SurveyParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "1." "1)" "Q1" "Q1." "Q.1" "Question 1:" "#1"
  var QUESTION_RE = /^\s*(?:(?:Q(?:uestion)?\s*\.?\s*(\d+)\s*[.:)\-–]?)|(?:#?(\d{1,3})\s*[.)]))\s*(.*)$/i;
  // "a)" "a." "(a)" "A)" "i)" "-" "•" "*" "○" "☐" "[ ]" "( )"
  var CHOICE_RE = /^\s*(?:\(([a-zA-Z]|[ivxIVX]{1,4})\)|([a-zA-Z])[.)](?=\s)|([ivxIVX]{1,4})\)|(\[\s?\]|\(\s?\))|([-–—•●◦▪▫■□☐☑☒○◯◻✓✔*>·o\uE000-\uF8FF\u2022\u2023\u2043\u25AA-\u25FF])(?=\s|$))\s*(.*)$/;
  var MULTI_HINT_RE = /(select|check|choose|tick|mark)\s+(all|any|as many|multiple|one or more)|all that apply|multiple (answers|responses|selections)|\[\s*multi(ple)?\s*\]/i;
  var DROPDOWN_HINT_RE = /\[\s*drop\s*-?\s*down\s*\]/i;
  var TEXT_HINT_RE = /\[\s*(text|open|open[- ]ended|essay)\s*\]/i;
  var SINGLE_HINT_RE = /\[\s*single\s*\]/i;
  var TAG_STRIP_RE = /\s*\[\s*(multi(ple)?|single|drop\s*-?\s*down|text|open|open[- ]ended|essay)\s*\]\s*/ig;
  var TAG_TEST_RE = /\[\s*(multi(ple)?|single|drop\s*-?\s*down|text|open|open[- ]ended|essay)\s*\]/i;
  var MULTI_GLYPHS = /[□☐☑☒◻]|\[\s?\]/;

  function clean(s) {
    return String(s == null ? '' : s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function detectType(text, glyphHints) {
    if (TEXT_HINT_RE.test(text)) return 'text';
    if (DROPDOWN_HINT_RE.test(text)) return 'dropdown';
    if (SINGLE_HINT_RE.test(text)) return 'single';
    if (MULTI_HINT_RE.test(text)) return 'multi';
    if (glyphHints && glyphHints.multi) return 'multi';
    return 'single';
  }

  function finalize(q) {
    var forced = TEXT_HINT_RE.test(q.text) ? 'text' : null;
    var type = forced || detectType(q.text, q._glyphs);
    var text = clean(q.text.replace(TAG_STRIP_RE, ' '));
    var choices = q.choices.map(clean).filter(Boolean);
    var warning = null;
    if (type !== 'text' && choices.length === 0) {
      type = 'text';
      warning = 'No answer choices found, so this was set to Text entry. Change the type and add choices if needed.';
    } else if (type !== 'text' && choices.length === 1) {
      warning = 'Only one answer choice was found. Check that the choices were detected correctly.';
    }
    return { text: text, type: type, choices: type === 'text' ? [] : choices, warning: warning };
  }

  /**
   * Parse an array of text lines into questions.
   * Rules:
   *  - A numbered line ("1.", "Q1", "Question 1:") starts a new question.
   *  - A lettered or bulleted line ("a)", "(b)", "-", "•", "☐") is an answer choice.
   *  - An unmarked line right after a question that ends in "?" or ":" is a choice;
   *    otherwise it continues the question text (handles wrapped lines).
   *  - An unmarked line after choices is another choice, unless a blank line came
   *    first, in which case it starts a new (unnumbered) question.
   */
  function parseLines(lines) {
    var questions = [];
    var cur = null;
    var blankSince = true; // blank line seen since last content
    var state = 'none'; // 'question' | 'choices'

    function push() {
      if (cur && clean(cur.text)) {
        var f = finalize(cur);
        f._numbered = cur._numbered;
        f._hadChoices = cur.choices.length > 0;
        questions.push(f);
      }
      cur = null;
      state = 'none';
    }
    function startQuestion(text, numbered) {
      push();
      cur = { text: text, choices: [], _glyphs: { multi: false }, _numbered: !!numbered };
      state = 'question';
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = String(lines[i] == null ? '' : lines[i]).replace(/ /g, ' ');
      var line = clean(raw);
      if (!line) { blankSince = true; continue; }

      var qm = line.match(QUESTION_RE);
      var cm = line.match(CHOICE_RE);

      // A numbered item inside an "(1)"-style choice list is unlikely; numbered => question.
      if (qm && clean(qm[3])) {
        startQuestion(qm[3], true);
      } else if (cm && clean(cm[6]) && (cur || !qm)) {
        if (!cur) {
          // Bullet with no question yet: treat as a question.
          startQuestion(cm[6]);
        } else {
          if (MULTI_GLYPHS.test(line.slice(0, 4))) cur._glyphs.multi = true;
          cur.choices.push(cm[6]);
          state = 'choices';
        }
      } else if (!cur) {
        startQuestion(line);
      } else if (state === 'question') {
        // Question text "finished" (ends in ? or :, or with a "(select all...)" / "[tag]" note)
        var qt = clean(cur.text);
        if (/[?:]\s*$/.test(qt) || (/[)\]]\s*$/.test(qt) && (MULTI_HINT_RE.test(qt) || TAG_TEST_RE.test(qt) || /\?\s*\(.*\)\s*$/.test(qt)))) {
          cur.choices.push(line);
          state = 'choices';
        } else {
          cur.text += ' ' + line;
        }
      } else { // choices
        if (blankSince) startQuestion(line);
        else cur.choices.push(line);
      }
      blankSince = false;
    }
    push();
    // Leading unnumbered lines without choices (titles, instructions) before
    // numbered questions are treated as a preamble, not as questions.
    var title = null;
    if (questions.some(function (q) { return q._numbered; })) {
      while (questions.length && !questions[0]._numbered && !questions[0]._hadChoices) {
        var pre = questions.shift();
        if (!title && pre.text.length <= 120) title = pre.text;
      }
    }
    var result = questions.map(function (q) { delete q._numbered; delete q._hadChoices; return q; });
    result.title = title;
    return result;
  }

  function parseText(text) {
    return parseLines(String(text || '').replace(/\r\n?/g, '\n').split('\n'));
  }

  /**
   * Convert mammoth HTML into marked text lines so Word auto-numbered lists keep
   * their structure: top-level numbered items become "N. ", nested or bulleted
   * items become "- ".
   */
  function htmlToLines(html, DOMParserImpl) {
    var Parser = DOMParserImpl || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Parser) throw new Error('DOMParser not available');
    var doc = new Parser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
    var out = [];
    var qCounter = 0;
    var lastWasQuestion = false;

    function textOf(node) {
      // Text of an <li> excluding nested lists
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
      // Heuristic: a top-level numbered list directly after a question whose text
      // ends with "?" and whose items don't look like questions => choices.
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

    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var tag = c.tagName;
        if (tag === 'OL' || tag === 'UL') { walkList(c, 0); }
        else if (tag === 'TABLE') {
          Array.prototype.forEach.call(c.querySelectorAll('tr'), function (tr) {
            var cells = Array.prototype.map.call(tr.querySelectorAll('td,th'), function (td) { return clean(td.textContent); }).filter(Boolean);
            cells.forEach(function (t) { out.push(t); });
          });
          out.push('');
        } else if (/^(P|H[1-6]|DIV|BLOCKQUOTE)$/.test(tag)) {
          if (tag === 'DIV' && c.querySelector('p,ol,ul,table')) { walk(c); continue; }
          var t = clean(c.textContent);
          if (t) {
            out.push(t);
            lastWasQuestion = QUESTION_RE.test(t) || /\?\s*$/.test(t);
          } else out.push('');
        } else walk(c);
      }
    }
    walk(doc.getElementById('root') || doc.body);
    return out;
  }

  // ---------- Spreadsheet rows ----------
  var TYPE_ALIASES = {
    single: 'single', 'single choice': 'single', 'single answer': 'single', mc: 'single', radio: 'single',
    'multiple choice': 'single', sa: 'single', savr: 'single', one: 'single',
    multi: 'multi', multiple: 'multi', 'multiple answer': 'multi', 'multi select': 'multi', 'multi-select': 'multi',
    checkbox: 'multi', checkboxes: 'multi', ma: 'multi', mavr: 'multi', 'select all': 'multi', 'check all': 'multi',
    dropdown: 'dropdown', 'drop down': 'dropdown', 'drop-down': 'dropdown', dl: 'dropdown', select: 'dropdown',
    text: 'text', 'text entry': 'text', open: 'text', 'open ended': 'text', 'open-ended': 'text', essay: 'text', te: 'text'
  };

  function normType(v) {
    var k = clean(v).toLowerCase();
    if (!k) return null;
    if (TYPE_ALIASES[k]) return TYPE_ALIASES[k];
    if (/multi|check|all/.test(k)) return 'multi';
    if (/drop/.test(k)) return 'dropdown';
    if (/text|open|essay/.test(k)) return 'text';
    if (/single|radio|one/.test(k)) return 'single';
    return null;
  }

  function splitChoices(cell) {
    var s = String(cell == null ? '' : cell);
    var parts = /\n/.test(s) ? s.split(/\n/) : (/[;|]/.test(s) ? s.split(/[;|]/) : [s]);
    return parts.map(function (p) {
      var m = clean(p).match(CHOICE_RE);
      return m && clean(m[6]) ? clean(m[6]) : clean(p);
    }).filter(Boolean);
  }

  /**
   * rows: array of arrays (first sheet). Supports:
   *  - Header row with "Question" column, optional "Type" column, and either a
   *    "Choices"/"Options"/"Answers" column (separated by ; | or new lines) or
   *    several columns like "Choice 1", "Option A", ...
   *  - No header: column A = question, remaining columns = choices.
   *  - Long format: rows with an empty question cell add choices to the previous question.
   */
  function parseRows(rows) {
    rows = (rows || []).map(function (r) { return (r || []).map(function (c) { return c == null ? '' : String(c); }); })
      .filter(function (r) { return r.some(function (c) { return clean(c); }); });
    if (!rows.length) return [];

    var header = rows[0].map(function (h) { return clean(h).toLowerCase(); });
    var qCol = header.findIndex(function (h) { return /^(question|questions|question text|item|prompt|q)$/.test(h) || /question\s*text/.test(h); });
    if (qCol < 0) qCol = header.findIndex(function (h) { return /question/.test(h) && !/(id|no|number|#|type)/.test(h); });
    var hasHeader = qCol >= 0;
    var typeCol = -1, choicesCol = -1, choiceCols = [], skipCols = [];
    if (hasHeader) {
      header.forEach(function (h, i) {
        if (i === qCol) return;
        if (/^(type|question type|qtype|format|answer type|response type)$/.test(h)) typeCol = i;
        else if (/^(choices|options|answers|answer choices|responses|response options|answer options)$/.test(h)) choicesCol = i;
        else if (/(choice|option|answer|response)\s*[\w]*$/.test(h) || /^[a-z]$/.test(h)) choiceCols.push(i);
        else skipCols.push(i);
      });
    } else {
      qCol = 0;
      for (var i = 1; i < rows[0].length; i++) choiceCols.push(i);
    }

    var questions = [];
    var dataRows = hasHeader ? rows.slice(1) : rows;
    var maxLen = dataRows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    if (!hasHeader) { choiceCols = []; for (var j = 1; j < maxLen; j++) choiceCols.push(j); }

    var last = null;
    dataRows.forEach(function (r) {
      var qText = clean(r[qCol]);
      var choices = [];
      if (choicesCol >= 0) choices = choices.concat(splitChoices(r[choicesCol]));
      choiceCols.forEach(function (c) { var v = clean(r[c]); if (v) choices.push(v); });
      if (choices.length === 1 && /[;|\n]/.test(r[choiceCols[0]] || '')) choices = splitChoices(r[choiceCols[0]]);
      if (!qText) {
        if (last) last.choices = last.choices.concat(choices);
        return;
      }
      var m = qText.match(QUESTION_RE);
      if (m && clean(m[3])) qText = clean(m[3]);
      last = { text: qText, choices: choices, _type: typeCol >= 0 ? normType(r[typeCol]) : null };
      questions.push(last);
    });

    return questions.map(function (q) {
      var t = q._type;
      var fin = finalize({ text: q.text, choices: q.choices, _glyphs: {} });
      if (t) {
        fin.type = t;
        if (t !== 'text' && !q.choices.length) {
          fin.type = 'text';
          fin.warning = 'Type was "' + t + '" but no choices were found, so it was set to Text entry.';
        } else if (t === 'text') { fin.choices = []; fin.warning = null; }
        else { fin.choices = q.choices.map(clean).filter(Boolean); fin.warning = fin.choices.length === 1 ? 'Only one answer choice was found.' : null; }
      }
      return fin;
    });
  }

  /** Rebuild text lines from pdf.js text items, using y positions. */
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
    htmlToLines: htmlToLines,
    pdfItemsToLines: pdfItemsToLines,
    normType: normType
  };
});
