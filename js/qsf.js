/*
 * Builds a Qualtrics Survey Format (.qsf) document.
 *
 * Question model:
 * {
 *   text, type, help, required, section, tag,
 *   choices: [],          // choices / rows / items / form fields
 *   scale: [],            // matrix columns
 *   min, max, decimals,   // slider range or number validation
 *   stars, total, maxWords, fileTypes, maxSizeMB
 * }
 * Payload shapes follow real Qualtrics exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./types.js'));
  else root.QSFBuilder = factory(root.QTypes);
})(typeof self !== 'undefined' ? self : this, function (QTypes) {
  'use strict';

  var ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function rid(prefix, n) {
    var s = '';
    for (var i = 0; i < (n || 15); i++) s += ALNUM.charAt(Math.floor(Math.random() * ALNUM.length));
    return prefix + s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function plain(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function stamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function num(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }
  function list(a) { return (a || []).map(plain).filter(Boolean); }

  var OTHER_RE = /^(other|others|something else)\b.*(specify|please|describe|\(|:|_{2,})|^other\s*[:(]|^other\s*_{2,}|please specify/i;
  var EXCLUSIVE_RE = /^(none of the above|none|n\/a|not applicable|prefer not to (say|answer)|don'?t know)$/i;

  /** Apply the account plan: paid-only types become their free fallback (or are dropped). */
  function applyPlan(q, plan) {
    if (QTypes.allowed(q.type, plan)) return q;
    var fb = QTypes.get(q.type).freeFallback || { type: 'text' };
    if (!fb.type) return null;
    var copy = {};
    for (var k in q) copy[k] = q[k];
    copy.type = fb.type;
    copy.help = [q.help, fb.note].filter(Boolean).join(' ');
    return copy;
  }

  function autoHints(q) {
    var help = plain(q.help);
    var extra = [];
    var low = help.toLowerCase();
    if (q.type === 'essay' && q.maxWords && low.indexOf('word') < 0) extra.push('Maximum ' + q.maxWords + ' words.');
    if (q.type === 'date' && !/dd|mm|yyyy|format/i.test(help)) extra.push('Format: ' + (q.dateFormat || 'DD/MM/YYYY'));
    if (q.type === 'file') {
      if (q.fileTypes && low.indexOf(String(q.fileTypes).toLowerCase()) < 0) extra.push('Allowed file type: ' + q.fileTypes + '.');
      if (q.maxSizeMB && !/\bmb\b/i.test(help)) extra.push('Maximum size ' + q.maxSizeMB + ' MB.');
    }
    return [help].concat(extra).filter(Boolean).join(' ');
  }

  function questionHtml(q) {
    var html = esc(plain(q.text) ? String(q.text).trim() : '').replace(/\n/g, '<br>');
    var help = autoHints(q);
    if (help) html += '<br><span style="font-size: 0.85em; color: #6b7280;">' + esc(help) + '</span>';
    return html;
  }

  function choiceSet(items, opts) {
    var choices = {}, order = [];
    items.forEach(function (c, i) {
      var id = String(i + 1);
      var ch = { Display: esc(c) };
      if (opts && opts.other && OTHER_RE.test(c)) ch.TextEntry = 'true';
      if (opts && opts.exclusive && EXCLUSIVE_RE.test(c)) ch.ExclusiveAnswer = true;
      choices[id] = ch;
      order.push(id);
    });
    return { Choices: choices, ChoiceOrder: order };
  }

  function settings(required, extra) {
    var s = { ForceResponse: required ? 'ON' : 'OFF', ForceResponseType: 'ON', Type: 'None' };
    for (var k in (extra || {})) s[k] = extra[k];
    return { Settings: s };
  }

  function buildPayload(q, qid, tag, opts) {
    var t = q.type;
    var required = !!(opts.forceResponse || q.required);
    var choices = list(q.choices);
    var p = {
      QuestionText: questionHtml(q),
      DefaultChoices: false,
      DataExportTag: tag,
      QuestionType: 'TE',
      Selector: 'SL',
      Configuration: { QuestionDescriptionOption: 'UseText' },
      QuestionDescription: plain(q.text).slice(0, 200),
      Validation: settings(required),
      GradingData: [],
      Language: [],
      NextChoiceId: 1,
      NextAnswerId: 1,
      QuestionID: qid,
      DataVisibility: { Private: false, Hidden: false }
    };
    function setChoices(items, o) {
      var cs = choiceSet(items, o);
      p.Choices = cs.Choices; p.ChoiceOrder = cs.ChoiceOrder; p.NextChoiceId = items.length + 1;
    }
    function rand() {
      if (opts.randomize && choices.length > 1) p.Randomization = { Advanced: null, Type: 'All', TotalRandSubset: '' };
    }

    switch (t) {
      case 'single':
      case 'multi':
        p.QuestionType = 'MC';
        p.Selector = (t === 'single' ? 'SA' : 'MA') + (opts.horizontal ? 'HR' : 'VR');
        p.SubSelector = 'TX';
        setChoices(choices, { other: true, exclusive: t === 'multi' });
        rand();
        break;
      case 'dropdown':
        p.QuestionType = 'MC'; p.Selector = 'DL';
        setChoices(choices);
        break;
      case 'text':
      case 'phone':
        p.SearchSource = { AllowFreeResponse: 'false' };
        break;
      case 'essay':
        p.Selector = 'ESTB';
        p.SearchSource = { AllowFreeResponse: 'false' };
        break;
      case 'email':
        p.SearchSource = { AllowFreeResponse: 'false' };
        p.Validation = settings(required, { Type: 'ContentType', ContentType: 'ValidEmail' });
        break;
      case 'number':
        p.SearchSource = { AllowFreeResponse: 'false' };
        p.Validation = settings(required, {
          Type: 'ContentType', ContentType: 'ValidNumber',
          ValidNumber: {
            Min: q.min === '' || q.min == null ? '' : String(q.min),
            Max: q.max === '' || q.max == null ? '' : String(q.max),
            NumDecimals: String(q.decimals == null || q.decimals === '' ? 0 : q.decimals)
          }
        });
        break;
      case 'date':
        p.SearchSource = { AllowFreeResponse: 'false' };
        p.Validation = settings(required, { Type: 'ContentType', ContentType: 'ValidDate', ValidDateType: 'DateWithFormat' });
        break;
      case 'form':
        p.Selector = 'FORM';
        setChoices(choices.length ? choices : ['Answer']);
        p.SearchSource = { AllowFreeResponse: 'false' };
        break;
      case 'matrix':
      case 'matrixMulti':
        var scale = list(q.scale);
        p.QuestionType = 'Matrix'; p.Selector = 'Likert';
        p.SubSelector = t === 'matrix' ? 'SingleAnswer' : 'MultipleAnswer';
        p.Configuration = {
          QuestionDescriptionOption: 'UseText', TextPosition: 'inline', ChoiceColumnWidth: 25,
          RepeatHeaders: 'none', WhiteSpace: 'OFF', MobileFirst: true
        };
        setChoices(choices);
        var ans = choiceSet(scale);
        p.Answers = ans.Choices; p.AnswerOrder = ans.ChoiceOrder; p.NextAnswerId = scale.length + 1;
        p.ChoiceDataExportTags = false;
        rand();
        break;
      case 'slider':
        var mn = num(q.min, 0), mx = num(q.max, 100);
        if (mx <= mn) mx = mn + 10;
        p.QuestionType = 'Slider'; p.Selector = 'HSLIDER';
        p.Configuration = {
          QuestionDescriptionOption: 'UseText', CSSliderMin: mn, CSSliderMax: mx,
          GridLines: Math.min(10, Math.max(1, Math.round(mx - mn))), NumDecimals: '0',
          CustomStart: false, MobileFirst: true, NotApplicable: false, ShowValue: true, SnapToGrid: false
        };
        setChoices(choices.length ? choices : [' ']);
        break;
      case 'stars':
        var n = Math.max(2, Math.min(10, Math.round(num(q.stars, 5))));
        p.QuestionType = 'Slider'; p.Selector = 'STAR';
        p.Configuration = { QuestionDescriptionOption: 'UseText', CSSliderMin: 0, CSSliderMax: n, NumStars: n, StarType: 'discrete', MobileFirst: true };
        setChoices(choices.length ? choices : [' ']);
        break;
      case 'nps':
        p.QuestionType = 'MC'; p.Selector = 'NPS';
        p.Choices = {}; p.ChoiceOrder = [];
        for (var i = 0; i <= 10; i++) { p.Choices[String(i)] = { Display: String(i) }; p.ChoiceOrder.push(String(i)); }
        p.NextChoiceId = 11;
        break;
      case 'rank':
        p.QuestionType = 'RO'; p.Selector = 'DND'; p.SubSelector = 'TX';
        setChoices(choices);
        rand();
        break;
      case 'constantSum':
        p.QuestionType = 'CS'; p.Selector = 'VRTL';
        setChoices(choices);
        var total = num(q.total, NaN);
        if (isFinite(total)) p.Validation = settings(required, { Type: 'ChoicesTotal', ChoiceTotal: String(total) });
        break;
      case 'descriptive':
        p.QuestionType = 'DB'; p.Selector = 'TB';
        p.ChoiceOrder = [];
        p.Validation = { Settings: { Type: 'None' } };
        break;
      case 'timing':
        p.QuestionType = 'Timing'; p.Selector = 'PageTimer';
        if (!plain(q.text)) p.QuestionText = 'Timing';
        p.Configuration = { QuestionDescriptionOption: 'UseText', MinSeconds: '0', MaxSeconds: '0' };
        p.Choices = { 1: { Display: 'First Click' }, 2: { Display: 'Last Click' }, 3: { Display: 'Page Submit' }, 4: { Display: 'Click Count' } };
        p.NextChoiceId = 5;
        delete p.Validation;
        break;
      case 'file':
        p.QuestionType = 'FileUpload'; p.Selector = 'FileUpload';
        p.Validation = { Settings: { ForceResponse: required ? 'ON' : 'OFF', Type: 'None' } };
        break;
      case 'signature':
        p.QuestionType = 'Draw'; p.Selector = 'Signature';
        break;
      case 'captcha':
        p.QuestionType = 'Captcha'; p.Selector = 'V2';
        p.Configuration = { QuestionDescriptionOption: 'UseText', Align: 'left', Theme: 'light' };
        delete p.Validation;
        break;
      default:
        p.SearchSource = { AllowFreeResponse: 'false' };
    }
    return p;
  }

  function cleanTag(tag) {
    return String(tag || '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.\-]/g, '').slice(0, 40);
  }

  /** Problems that would make a question unusable. Returns array of strings. */
  function validate(q) {
    var t = q.type, n = list(q.choices).length, errs = [];
    if (t !== 'timing' && t !== 'captcha' && !plain(q.text)) errs.push('Question text is empty.');
    if (['single', 'multi', 'dropdown', 'rank', 'constantSum', 'matrix', 'matrixMulti'].indexOf(t) >= 0 && n === 0) {
      errs.push(QTypes.get(t).listLabel + ' are missing.');
    }
    if ((t === 'matrix' || t === 'matrixMulti') && list(q.scale).length < 2) errs.push('A matrix needs at least two scale points (columns).');
    return errs;
  }

  /**
   * @param {Array} questions
   * @param {Object} opts { name, plan, forceResponse, horizontal, randomize, tagPrefix,
   *                        perPage, backButton, sectionTitles }
   */
  function build(questions, opts) {
    opts = opts || {};
    var plan = opts.plan || 'paid';
    var now = stamp(new Date());
    var surveyId = rid('SV_');
    var rsId = rid('RS_');
    var name = plain(opts.name) || 'Imported Survey';
    var prefix = cleanTag(opts.tagPrefix) || 'Q';

    var qs = (questions || []).map(function (q) { return q && applyPlan(q, plan); })
      .filter(function (q) { return q && (plain(q.text) || q.type === 'timing' || q.type === 'captcha'); });

    // Group into sections (blocks), keeping first-appearance order.
    var sections = [];
    var bySection = {};
    var current = '';
    qs.forEach(function (q) {
      var s = q.section != null && plain(q.section) !== '' ? plain(q.section) : current;
      current = s;
      if (!(s in bySection)) { bySection[s] = { name: s, questions: [] }; sections.push(bySection[s]); }
      bySection[s].questions.push(q);
    });

    var sqElements = [];
    var blocks = [];
    var usedTags = {};
    var qn = 0, tagN = 0;

    function nextQid() { qn++; return 'QID' + qn; }
    function uniqueTag(t) {
      var base = t, k = 2;
      while (usedTags[t.toLowerCase()]) t = base + '_' + (k++);
      usedTags[t.toLowerCase()] = true;
      return t;
    }

    sections.forEach(function (sec, si) {
      var elems = [];
      var showTitle = opts.sectionTitles !== false && sec.name && sections.length > 0;
      if (showTitle) {
        var hq = nextQid();
        var hp = buildPayload({ text: '', type: 'descriptive' }, hq, uniqueTag(cleanTag('Section_' + (si + 1))), opts);
        hp.QuestionText = '<h3 style="margin:0;">' + esc(sec.name) + '</h3>';
        hp.QuestionDescription = sec.name;
        sqElements.push(sqElement(surveyId, hp));
        elems.push({ Type: 'Question', QuestionID: hq });
      }
      var countOnPage = 0;
      sec.questions.forEach(function (q) {
        if (opts.perPage && countOnPage === opts.perPage) { elems.push({ Type: 'Page Break' }); countOnPage = 0; }
        var qid = nextQid();
        var tag;
        if (q.type === 'descriptive') tag = cleanTag(q.tag) || ('Text' + qn);
        else { tagN++; tag = cleanTag(q.tag) || (prefix + tagN); }
        tag = uniqueTag(tag);
        sqElements.push(sqElement(surveyId, buildPayload(q, qid, tag, opts)));
        elems.push({ Type: 'Question', QuestionID: qid });
        if (q.type !== 'descriptive' && q.type !== 'timing') countOnPage++;
      });
      blocks.push({
        Type: si === 0 ? 'Default' : 'Standard',
        SubType: '',
        Description: sec.name || (si === 0 ? 'Default Question Block' : 'Block ' + (si + 1)),
        ID: rid('BL_'),
        BlockElements: elems
      });
    });
    if (!blocks.length) blocks.push({ Type: 'Default', SubType: '', Description: 'Default Question Block', ID: rid('BL_'), BlockElements: [] });
    var trash = { Type: 'Trash', Description: 'Trash / Unused Questions', ID: rid('BL_'), BlockElements: [] };

    var flow = blocks.map(function (b, i) { return { Type: b.Type === 'Default' ? 'Block' : 'Standard', ID: b.ID, FlowID: 'FL_' + (i + 2) }; });

    var elements = [
      { SurveyID: surveyId, Element: 'BL', PrimaryAttribute: 'Survey Blocks', SecondaryAttribute: null, TertiaryAttribute: null, Payload: blocks.concat([trash]) },
      {
        SurveyID: surveyId, Element: 'FL', PrimaryAttribute: 'Survey Flow', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: { Type: 'Root', FlowID: 'FL_1', Flow: flow, Properties: { Count: flow.length + 1 } }
      },
      { SurveyID: surveyId, Element: 'QC', PrimaryAttribute: 'Survey Question Count', SecondaryAttribute: String(sqElements.length), TertiaryAttribute: null, Payload: null },
      { SurveyID: surveyId, Element: 'RS', PrimaryAttribute: rsId, SecondaryAttribute: 'Default Response Set', TertiaryAttribute: null, Payload: null },
      {
        SurveyID: surveyId, Element: 'SO', PrimaryAttribute: 'Survey Options', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: {
          BackButton: opts.backButton ? 'true' : 'false', SaveAndContinue: 'true', SurveyProtection: 'PublicSurvey',
          BallotBoxStuffingPrevention: 'false', NoIndex: 'Yes', SecureResponseFiles: 'true', SurveyExpiration: 'None',
          SurveyTermination: 'DefaultMessage', Header: '', Footer: '', ProgressBarDisplay: 'None', PartialData: '+1 week',
          ValidationMessage: '', PreviousButton: '', NextButton: '', SurveyTitle: name, SurveyMetaDescription: '',
          NewScoring: 1, EOSMessage: '', ShowExportTags: 'false', CollectGeoLocation: 'false', SurveyLanguage: 'EN'
        }
      },
      { SurveyID: surveyId, Element: 'STAT', PrimaryAttribute: 'Survey Statistics', SecondaryAttribute: null, TertiaryAttribute: null, Payload: { MobileCompatible: true, ID: 'Survey Statistics' } }
    ].concat(sqElements);

    return {
      SurveyEntry: {
        SurveyID: surveyId, SurveyName: name, SurveyDescription: null, SurveyOwnerID: 'UR_' + rid('', 15),
        SurveyBrandID: 'default', DivisionID: null, SurveyLanguage: 'EN', SurveyActiveResponseSet: rsId,
        SurveyStatus: 'Inactive', SurveyStartDate: '0000-00-00 00:00:00', SurveyExpirationDate: '0000-00-00 00:00:00',
        SurveyCreationDate: now, CreatorID: 'UR_' + rid('', 15), LastModified: now,
        LastAccessed: '0000-00-00 00:00:00', LastActivated: '0000-00-00 00:00:00', Deleted: null
      },
      SurveyElements: elements
    };
  }

  function sqElement(surveyId, p) {
    return {
      SurveyID: surveyId, Element: 'SQ', PrimaryAttribute: p.QuestionID,
      SecondaryAttribute: plain(p.QuestionDescription || p.DataExportTag).slice(0, 100) || p.DataExportTag,
      TertiaryAttribute: null, Payload: p
    };
  }

  return { build: build, buildPayload: buildPayload, applyPlan: applyPlan, validate: validate };
});
