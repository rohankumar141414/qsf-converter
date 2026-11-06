/*
 * Builds a Qualtrics Survey Format (.qsf) JSON document from parsed questions.
 * Question objects: { text, type: 'single'|'multi'|'dropdown'|'text', choices: [] }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QSFBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
  function plain(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  function stamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var OTHER_RE = /^(other|others|something else)\b.*(specify|please|describe|\(|:|_{2,})|^other\s*[:(]|^other\s*_{2,}|please specify/i;

  var SELECTORS = {
    single: { QuestionType: 'MC', Selector: 'SAVR', SubSelector: 'TX' },
    singleHorizontal: { QuestionType: 'MC', Selector: 'SAHR', SubSelector: 'TX' },
    multi: { QuestionType: 'MC', Selector: 'MAVR', SubSelector: 'TX' },
    multiHorizontal: { QuestionType: 'MC', Selector: 'MAHR', SubSelector: 'TX' },
    dropdown: { QuestionType: 'MC', Selector: 'DL' },
    text: { QuestionType: 'TE', Selector: 'SL' },
    essay: { QuestionType: 'TE', Selector: 'ML' }
  };

  function buildQuestion(q, index, surveyId, opts) {
    var qid = 'QID' + (index + 1);
    var tag = (opts.tagPrefix || 'Q') + (index + 1);
    var type = q.type || 'single';
    var key = type;
    if (opts.horizontal && (type === 'single' || type === 'multi')) key = type + 'Horizontal';
    if (type === 'text' && opts.essay) key = 'essay';
    var sel = SELECTORS[key] || SELECTORS.single;
    var force = !!(q.required != null ? q.required : opts.forceResponse);

    var payload = {
      QuestionText: esc(q.text).replace(/\n/g, '<br>'),
      DataExportTag: tag,
      QuestionType: sel.QuestionType,
      Selector: sel.Selector,
      Configuration: { QuestionDescriptionOption: 'UseText' },
      QuestionDescription: plain(q.text).slice(0, 200),
      Validation: {
        Settings: { ForceResponse: force ? 'ON' : 'OFF', ForceResponseType: 'ON', Type: 'None' }
      },
      GradingData: [],
      Language: [],
      NextChoiceId: 1,
      NextAnswerId: 1,
      QuestionID: qid,
      DataVisibility: { Private: false, Hidden: false }
    };
    if (sel.SubSelector) payload.SubSelector = sel.SubSelector;

    if (sel.QuestionType === 'MC') {
      var choices = {};
      var order = [];
      (q.choices || []).forEach(function (c, i) {
        var id = String(i + 1);
        var ch = { Display: esc(plain(c)) };
        if (OTHER_RE.test(plain(c))) ch.TextEntry = 'true';
        if (/^(none of the above|none|n\/a|not applicable|prefer not to (say|answer))$/i.test(plain(c)) && type === 'multi') {
          ch.ExclusiveAnswer = true;
        }
        choices[id] = ch;
        order.push(id);
      });
      payload.Choices = choices;
      payload.ChoiceOrder = order;
      payload.NextChoiceId = order.length + 1;
      if (opts.randomize && order.length > 1) {
        payload.Randomization = { Advanced: null, Type: 'All', TotalRandSubset: '' };
      }
    } else {
      payload.DefaultChoices = false;
      payload.SearchSource = { AllowFreeResponse: 'false' };
    }

    return {
      SurveyID: surveyId,
      Element: 'SQ',
      PrimaryAttribute: qid,
      SecondaryAttribute: plain(q.text).slice(0, 100),
      TertiaryAttribute: null,
      Payload: payload
    };
  }

  /**
   * @param {Array} questions
   * @param {Object} opts { name, forceResponse, horizontal, randomize, essay, tagPrefix, perPage }
   * @returns {Object} QSF object (JSON.stringify it to save)
   */
  function build(questions, opts) {
    opts = opts || {};
    var now = stamp(new Date());
    var surveyId = rid('SV_');
    var blockId = rid('BL_');
    var trashId = rid('BL_');
    var rsId = rid('RS_');
    var name = plain(opts.name) || 'Imported Survey';
    var qs = (questions || []).filter(function (q) { return q && plain(q.text); });

    var blockElements = [];
    qs.forEach(function (q, i) {
      if (i > 0 && opts.perPage && i % opts.perPage === 0) blockElements.push({ Type: 'Page Break' });
      blockElements.push({ Type: 'Question', QuestionID: 'QID' + (i + 1) });
    });

    var elements = [
      {
        SurveyID: surveyId, Element: 'BL', PrimaryAttribute: 'Survey Blocks', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: [
          { Type: 'Default', Description: 'Default Question Block', ID: blockId, BlockElements: blockElements },
          { Type: 'Trash', Description: 'Trash / Unused Questions', ID: trashId, BlockElements: [] }
        ]
      },
      {
        SurveyID: surveyId, Element: 'FL', PrimaryAttribute: 'Survey Flow', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: {
          Type: 'Root', FlowID: 'FL_1',
          Flow: [{ Type: 'Block', ID: blockId, FlowID: 'FL_2' }],
          Properties: { Count: 2 }
        }
      },
      {
        SurveyID: surveyId, Element: 'PL', PrimaryAttribute: 'Preview Link', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: { PreviewType: 'Brand', PreviewID: rid('', 8) + '-' + rid('', 4) + '-' + rid('', 4) + '-' + rid('', 4) + '-' + rid('', 12) }
      },
      {
        SurveyID: surveyId, Element: 'QC', PrimaryAttribute: 'Survey Question Count', SecondaryAttribute: String(qs.length), TertiaryAttribute: null,
        Payload: null
      },
      {
        SurveyID: surveyId, Element: 'RS', PrimaryAttribute: rsId, SecondaryAttribute: 'Default Response Set', TertiaryAttribute: null,
        Payload: null
      },
      {
        SurveyID: surveyId, Element: 'SO', PrimaryAttribute: 'Survey Options', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: {
          BackButton: opts.backButton ? 'true' : 'false',
          SaveAndContinue: 'true',
          SurveyProtection: 'PublicSurvey',
          BallotBoxStuffingPrevention: 'false',
          NoIndex: 'Yes',
          SecureResponseFiles: 'true',
          SurveyExpiration: 'None',
          SurveyTermination: 'DefaultMessage',
          Header: '',
          Footer: '',
          ProgressBarDisplay: 'None',
          PartialData: '+1 week',
          ValidationMessage: '',
          PreviousButton: '',
          NextButton: '',
          SurveyTitle: name,
          SurveyMetaDescription: '',
          NewScoring: 1,
          EOSMessage: '',
          ShowExportTags: 'false',
          CollectGeoLocation: 'false',
          SurveyLanguage: 'EN'
        }
      },
      {
        SurveyID: surveyId, Element: 'STAT', PrimaryAttribute: 'Survey Statistics', SecondaryAttribute: null, TertiaryAttribute: null,
        Payload: { MobileCompatible: true, ID: 'Survey Statistics' }
      }
    ];

    qs.forEach(function (q, i) { elements.push(buildQuestion(q, i, surveyId, opts)); });

    return {
      SurveyEntry: {
        SurveyID: surveyId,
        SurveyName: name,
        SurveyDescription: null,
        SurveyOwnerID: 'UR_' + rid('', 15),
        SurveyBrandID: 'default',
        DivisionID: null,
        SurveyLanguage: 'EN',
        SurveyActiveResponseSet: rsId,
        SurveyStatus: 'Inactive',
        SurveyStartDate: '0000-00-00 00:00:00',
        SurveyExpirationDate: '0000-00-00 00:00:00',
        SurveyCreationDate: now,
        CreatorID: 'UR_' + rid('', 15),
        LastModified: now,
        LastAccessed: '0000-00-00 00:00:00',
        LastActivated: '0000-00-00 00:00:00',
        Deleted: null
      },
      SurveyElements: elements
    };
  }

  return { build: build, buildQuestion: buildQuestion };
});
