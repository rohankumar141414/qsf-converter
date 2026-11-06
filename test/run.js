// Run with: node test/run.js
const P = require('../js/parser.js'), Q = require('../js/qsf.js'), T = require('../js/types.js');
const assert = require('assert'), fs = require('fs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const sq = (qsf) => qsf.SurveyElements.filter(e => e.Element === 'SQ').map(e => e.Payload);

// ---------- Spreadsheet form specification ----------
const spec = [
  ['Field ID', 'Field Name', 'Field Type', 'Category', 'Mandatory', 'Description / Guidance'],
  ['F01', 'Full Name', 'Text', 'Personal Information', 'Yes', 'Full legal name as per Passport'],
  ['F02', 'Gender', 'Dropdown', 'Personal Information', 'Yes', 'Male / Female / Other / Prefer not to say'],
  ['F03', 'Date of Birth', 'Date', 'Personal Information', 'Yes', 'DD/MM/YYYY'],
  ['F07', 'Email Address', 'Email', 'Contact Information', 'Yes', 'Primary official/academic email'],
  ['F08', 'Contact Phone / WhatsApp Number', 'Phone', 'Contact Information', 'Yes', 'Include country code'],
  ['F09', 'Current Academic Enrolment Status', 'Dropdown', 'Academic Profile', 'Yes', "Master's Degree / Doctoral (PhD) Degree"],
  ['F10', 'Programme / Field of Study', 'Text', 'Academic Profile', 'Yes', 'e.g., Political Science, Public Policy, Law, Governance'],
  ['F13', 'Expected Year of Graduation', 'Number', 'Academic Profile', 'Yes', 'Year (e.g. 2027)'],
  ['F14', 'Statement of Purpose (SOP)', 'Long Text (Max 500 words)', 'Application Assessment', 'Yes', 'Explain your background.'],
  ['F15', 'CV / Resume Upload', 'File Upload (PDF)', 'Supporting Documents', 'No', 'Max file size 5 MB']
];

t('form spec: columns, types, choices from guidance', () => {
  const r = P.parseRows(spec);
  assert.deepStrictEqual(r.map(q => q.type), ['text', 'dropdown', 'date', 'email', 'phone', 'dropdown', 'text', 'number', 'essay', 'file']);
  assert.deepStrictEqual(r[1].choices, ['Male', 'Female', 'Other', 'Prefer not to say']);
  assert.strictEqual(r[1].help, '');
  assert.deepStrictEqual(r[5].choices, ["Master's Degree", 'Doctoral (PhD) Degree']);
  assert.strictEqual(r[6].help, 'e.g., Political Science, Public Policy, Law, Governance'); // examples stay as help
  assert.strictEqual(r[0].tag, 'F01');
  assert.strictEqual(r[0].section, 'Personal Information');
  assert.ok(r[0].required); assert.ok(!r[9].required);
  assert.strictEqual(r[7].decimals, '0');
  assert.strictEqual(r[8].maxWords, '500');
  assert.strictEqual(r[9].fileTypes, 'PDF'); assert.strictEqual(r[9].maxSizeMB, '5');
});

t('form spec QSF: sections become blocks, tags kept, validation set', () => {
  const qsf = Q.build(P.parseRows(spec), { plan: 'paid', name: 'Form' });
  const bl = qsf.SurveyElements.find(e => e.Element === 'BL').Payload;
  assert.deepStrictEqual(bl.filter(b => b.Type !== 'Trash').map(b => b.Description),
    ['Personal Information', 'Contact Information', 'Academic Profile', 'Application Assessment', 'Supporting Documents']);
  const fl = qsf.SurveyElements.find(e => e.Element === 'FL').Payload;
  assert.strictEqual(fl.Flow.length, 5);
  assert.deepStrictEqual(fl.Flow.map(f => f.Type), ['Block', 'Standard', 'Standard', 'Standard', 'Standard']);
  const p = sq(qsf).filter(x => x.QuestionType !== 'DB');
  assert.deepStrictEqual(p.map(x => x.DataExportTag), ['F01', 'F02', 'F03', 'F07', 'F08', 'F09', 'F10', 'F13', 'F14', 'F15']);
  assert.strictEqual(p[1].Selector, 'DL');
  assert.strictEqual(p[2].Validation.Settings.ContentType, 'ValidDate');
  assert.strictEqual(p[3].Validation.Settings.ContentType, 'ValidEmail');
  assert.strictEqual(p[7].Validation.Settings.ValidNumber.NumDecimals, '0');
  assert.strictEqual(p[8].Selector, 'ESTB');
  assert.ok(/Maximum 500 words/.test(p[8].QuestionText));
  assert.strictEqual(p[9].QuestionType, 'FileUpload');
  assert.ok(/Max file size 5 MB/.test(p[9].QuestionText) && /PDF/.test(p[9].QuestionText));
  assert.strictEqual(p[0].Validation.Settings.ForceResponse, 'ON');
  assert.strictEqual(p[9].Validation.Settings.ForceResponse, 'OFF');
  // section headings shown as descriptive text
  assert.strictEqual(sq(qsf).filter(x => x.QuestionType === 'DB').length, 5);
  assert.strictEqual(qsf.SurveyElements.find(e => e.Element === 'QC').SecondaryAttribute, String(sq(qsf).length));
});

t('free plan swaps paid-only types', () => {
  const qs = P.parseRows(spec);
  const free = sq(Q.build(qs, { plan: 'free', sectionTitles: false }));
  const f15 = free.find(x => x.DataExportTag === 'F15');
  assert.strictEqual(f15.QuestionType, 'TE');
  assert.ok(/Paste a link/.test(f15.QuestionText));
  assert.strictEqual(Q.applyPlan({ type: 'captcha', text: 'x' }, 'free'), null);
  assert.ok(T.allowed('matrix', 'free') && !T.allowed('signature', 'free') && T.allowed('signature', 'paid'));
});

t('spreadsheet with choices column and no header', () => {
  const r = P.parseRows([['Question', 'Type', 'Choices'], ['Fav colour?', 'multi', 'Red; Blue|Green'], ['Name?', 'text', '']]);
  assert.deepStrictEqual(r.map(q => q.type), ['multi', 'text']);
  assert.deepStrictEqual(r[0].choices, ['Red', 'Blue', 'Green']);
  const r2 = P.parseRows([['Fav colour?', 'Red', 'Blue'], ['Age?', 'Young', 'Old']]);
  assert.strictEqual(r2.length, 2); assert.deepStrictEqual(r2[1].choices, ['Young', 'Old']);
});

t('type names', () => {
  const nt = s => (P.normType(s) || {}).type;
  assert.strictEqual(nt('Long Text (Max 500 words)'), 'essay');
  assert.strictEqual(nt('File Upload (PDF)'), 'file');
  assert.strictEqual(nt('Yes/No'), 'single');
  assert.deepStrictEqual(P.normType('Rating 1-5').choices, ['1', '2', '3', '4', '5']);
  assert.strictEqual(nt('Slider 0-100'), 'slider');
  assert.strictEqual(nt('Likert'), 'matrix');
  assert.strictEqual(nt('Checkbox'), 'multi');
  assert.strictEqual(nt('Multiple choice'), 'single');
  assert.strictEqual(nt('Radio'), 'single');
  assert.strictEqual(nt('NPS'), 'nps');
  assert.strictEqual(nt('Constant sum 100'), 'constantSum');
  assert.strictEqual(nt('Signature'), 'signature');
  assert.strictEqual(nt('Instructions'), 'descriptive');
  assert.strictEqual(nt('Phone'), 'phone');
  assert.strictEqual(P.normType('banana'), null);
});

// ---------- Text ----------
const txt = fs.readFileSync(__dirname + '/../samples/sample-survey.txt', 'utf8');
t('text sample: sections, tags, required, matrix', () => {
  const r = P.parseText(txt);
  assert.strictEqual(r.title, 'Customer Feedback Survey');
  assert.deepStrictEqual(r.map(q => q.type),
    ['descriptive', 'text', 'email', 'date', 'single', 'dropdown', 'multi', 'matrix', 'rank', 'nps', 'slider', 'essay', 'file']);
  assert.ok(r[1].required && r[2].required && !r[3].required);
  assert.strictEqual(r[1].section, 'About you');
  assert.strictEqual(r[6].section, 'Your experience');
  assert.strictEqual(r[7].scale.length, 5); assert.strictEqual(r[7].choices.length, 3);
  assert.strictEqual(r[10].max, '10');
  assert.strictEqual(r[11].maxWords, '200');
  assert.strictEqual(r[5].text, 'Which country do you live in?');
});
t('wrapped question lines are joined', () => {
  const r = P.parseText('Q1. How satisfied are you with our\nservice overall?\n(a) Good\n(b) Bad');
  assert.strictEqual(r[0].text, 'How satisfied are you with our service overall?');
  assert.deepStrictEqual(r[0].choices, ['Good', 'Bad']);
});
t('checkbox glyphs mean multiple answers', () => {
  assert.strictEqual(P.parseText('1. Pets you own\n☐ Dog\n☐ Cat')[0].type, 'multi');
});
t('unnumbered questions separated by blank lines', () => {
  assert.strictEqual(P.parseText('Do you smoke?\nYes\nNo\n\nDo you drink?\nYes\nNo').length, 2);
});
t('symbol-font bullets from PDFs are stripped', () => {
  assert.deepStrictEqual(P.parseText('1. Pick one?\n Apple\nBanana')[0].choices, ['Apple', 'Banana']);
});

// ---------- Every type builds ----------
t('every type produces a payload', () => {
  const base = { text: 'Q?', choices: ['A', 'B'], scale: ['1', '2', '3'], min: '0', max: '10', stars: '5', total: '100' };
  const qs = T.list.map(x => Object.assign({}, base, { type: x.id }));
  const p = sq(Q.build(qs, { plan: 'paid', sectionTitles: false }));
  const got = p.map(x => [x.QuestionType, x.Selector, x.SubSelector || ''].join('/'));
  assert.deepStrictEqual(got, [
    'MC/SAVR/TX', 'MC/MAVR/TX', 'MC/DL/', 'TE/SL/', 'TE/ESTB/', 'TE/SL/', 'TE/SL/', 'TE/SL/', 'TE/SL/', 'TE/FORM/',
    'Matrix/Likert/SingleAnswer', 'Matrix/Likert/MultipleAnswer', 'Slider/HSLIDER/', 'Slider/STAR/', 'MC/NPS/', 'RO/DND/TX',
    'CS/VRTL/', 'DB/TB/', 'Timing/PageTimer/', 'FileUpload/FileUpload/', 'Draw/Signature/', 'Captcha/V2/']);
  const m = p[10]; assert.deepStrictEqual(m.AnswerOrder, ['1', '2', '3']); assert.strictEqual(Object.keys(m.Choices).length, 2);
  assert.strictEqual(p[16].Validation.Settings.ChoiceTotal, '100');
  assert.strictEqual(Object.keys(p[14].Choices).length, 11);
  assert.strictEqual(p[12].Configuration.CSSliderMax, 10);
  // unique export tags
  const tags = p.map(x => x.DataExportTag); assert.strictEqual(new Set(tags).size, tags.length);
});
t('validate flags missing pieces', () => {
  assert.ok(Q.validate({ type: 'single', text: 'x', choices: [] }).length);
  assert.ok(Q.validate({ type: 'matrix', text: 'x', choices: ['a'], scale: ['1'] }).length);
  assert.strictEqual(Q.validate({ type: 'nps', text: 'x' }).length, 0);
});
t('escapes HTML in text', () => {
  const p = sq(Q.build([{ text: 'A <b> & C?', type: 'single', choices: ['<x>', 'y'] }]))[0];
  assert.strictEqual(p.QuestionText, 'A &lt;b&gt; &amp; C?');
  assert.strictEqual(p.Choices['1'].Display, '&lt;x&gt;');
});
t('other-specify and exclusive choices', () => {
  const p = sq(Q.build([{ text: 'Pick', type: 'multi', choices: ['A', 'Other (please specify)', 'None of the above'] }]))[0];
  assert.strictEqual(p.Choices['2'].TextEntry, 'true');
  assert.strictEqual(p.Choices['3'].ExclusiveAnswer, true);
});
console.log(`\n${n} tests passed`);
