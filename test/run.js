// Run with: node test/run.js
const P = require('../js/parser.js'), Q = require('../js/qsf.js'), assert = require('assert'), fs = require('fs');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

const txt = fs.readFileSync(__dirname + '/../samples/sample-survey.txt', 'utf8');
t('parses sample text', () => {
  const r = P.parseText(txt);
  assert.strictEqual(r.title, 'Customer Feedback Survey');
  assert.deepStrictEqual(r.map(q => q.type), ['single', 'multi', 'single', 'single', 'dropdown', 'text']);
  assert.deepStrictEqual(r[0].choices, ['Search engine', 'Social media', 'Friend or colleague', 'Other (please specify)']);
  assert.strictEqual(r[4].text, 'Which country do you live in?');
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
  const r = P.parseText('Do you smoke?\nYes\nNo\n\nDo you drink?\nYes\nNo');
  assert.strictEqual(r.length, 2);
});
t('spreadsheet with choices column', () => {
  const r = P.parseRows([['Question', 'Type', 'Choices'], ['Fav colour?', 'multi', 'Red; Blue|Green'], ['Name?', 'text', '']]);
  assert.deepStrictEqual(r.map(q => q.type), ['multi', 'text']);
  assert.deepStrictEqual(r[0].choices, ['Red', 'Blue', 'Green']);
});
t('spreadsheet without header', () => {
  const r = P.parseRows([['Fav colour?', 'Red', 'Blue'], ['Age?', 'Young', 'Old']]);
  assert.strictEqual(r.length, 2); assert.deepStrictEqual(r[1].choices, ['Young', 'Old']);
});
t('builds a valid QSF', () => {
  const qsf = Q.build(P.parseText(txt), { name: 'Test', perPage: 2, forceResponse: true });
  const els = qsf.SurveyElements;
  for (const k of ['BL', 'FL', 'SO', 'QC', 'RS']) assert.ok(els.find(e => e.Element === k), k);
  const sq = els.filter(e => e.Element === 'SQ');
  assert.strictEqual(sq.length, 6);
  assert.strictEqual(els.find(e => e.Element === 'QC').SecondaryAttribute, '6');
  const bl = els.find(e => e.Element === 'BL').Payload[0];
  assert.strictEqual(bl.BlockElements.filter(b => b.Type === 'Question').length, 6);
  assert.strictEqual(bl.BlockElements.filter(b => b.Type === 'Page Break').length, 2);
  assert.strictEqual(els.find(e => e.Element === 'FL').Payload.Flow[0].ID, bl.ID);
  assert.strictEqual(sq[0].Payload.Choices['4'].TextEntry, 'true');
  assert.strictEqual(sq[1].Payload.Selector, 'MAVR');
  assert.strictEqual(sq[1].Payload.Choices['4'].ExclusiveAnswer, true);
  assert.strictEqual(sq[5].Payload.QuestionType, 'TE');
  assert.strictEqual(sq[0].Payload.Validation.Settings.ForceResponse, 'ON');
  assert.deepStrictEqual(sq[0].Payload.ChoiceOrder, ['1', '2', '3', '4']);
});
t('escapes HTML in text', () => {
  const qsf = Q.build([{ text: 'A <b> & C?', type: 'single', choices: ['<x>', 'y'] }]);
  const p = qsf.SurveyElements.find(e => e.Element === 'SQ').Payload;
  assert.strictEqual(p.QuestionText, 'A &lt;b&gt; &amp; C?');
  assert.strictEqual(p.Choices['1'].Display, '&lt;x&gt;');
});
console.log(`\n${n} tests passed`);
