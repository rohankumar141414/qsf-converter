/*
 * Question type registry.
 *
 * tier: 'free'  -> available on free Qualtrics accounts
 *       'paid'  -> needs a paid / institutional licence (or add-on)
 * Qualtrics does not publish one definitive list and it changes over time.
 * Edit the `tier` values here if your account differs.
 *
 * fields: which inputs the editor shows for this type.
 *   choices   -> list (label from `listLabel`)
 *   scale     -> matrix column labels
 *   range     -> min / max
 *   number    -> min / max / decimals (validation)
 *   stars     -> number of stars
 *   total     -> required total for constant sum
 *   maxWords  -> word limit shown to respondents
 *   file      -> allowed file types / max size (shown to respondents)
 *
 * freeFallback: what a paid-only question becomes on the free plan.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QTypes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = [
    // Choice
    { id: 'single', group: 'Choice', label: 'Multiple choice: single answer', tier: 'free', fields: ['choices'], listLabel: 'Answer choices' },
    { id: 'multi', group: 'Choice', label: 'Multiple choice: multiple answers', tier: 'free', fields: ['choices'], listLabel: 'Answer choices' },
    { id: 'dropdown', group: 'Choice', label: 'Dropdown list', tier: 'free', fields: ['choices'], listLabel: 'Answer choices' },
    // Text
    { id: 'text', group: 'Text entry', label: 'Short text', tier: 'free', fields: [] },
    { id: 'essay', group: 'Text entry', label: 'Long text / essay', tier: 'free', fields: ['maxWords'] },
    { id: 'email', group: 'Text entry', label: 'Email address', tier: 'free', fields: [] },
    { id: 'phone', group: 'Text entry', label: 'Phone number', tier: 'free', fields: [] },
    { id: 'number', group: 'Text entry', label: 'Number', tier: 'free', fields: ['number'] },
    { id: 'date', group: 'Text entry', label: 'Date', tier: 'free', fields: [] },
    { id: 'form', group: 'Text entry', label: 'Form fields (several text boxes)', tier: 'free', fields: ['choices'], listLabel: 'Field labels' },
    // Scales
    { id: 'matrix', group: 'Scales & grids', label: 'Matrix / Likert: one answer per row', tier: 'free', fields: ['choices', 'scale'], listLabel: 'Statements (rows)' },
    { id: 'matrixMulti', group: 'Scales & grids', label: 'Matrix: several answers per row', tier: 'free', fields: ['choices', 'scale'], listLabel: 'Statements (rows)' },
    { id: 'slider', group: 'Scales & grids', label: 'Slider', tier: 'free', fields: ['choices', 'range'], listLabel: 'Slider labels (one slider per line)' },
    { id: 'stars', group: 'Scales & grids', label: 'Star rating', tier: 'free', fields: ['choices', 'stars'], listLabel: 'Items to rate' },
    { id: 'nps', group: 'Scales & grids', label: 'Net Promoter Score (0 to 10)', tier: 'free', fields: [] },
    { id: 'rank', group: 'Scales & grids', label: 'Rank order (drag and drop)', tier: 'free', fields: ['choices'], listLabel: 'Items to rank' },
    { id: 'constantSum', group: 'Scales & grids', label: 'Constant sum (points add up to a total)', tier: 'free', fields: ['choices', 'total'], listLabel: 'Items' },
    // Other
    { id: 'descriptive', group: 'Other', label: 'Descriptive text / instructions', tier: 'free', fields: [] },
    { id: 'timing', group: 'Other', label: 'Page timer (hidden)', tier: 'free', fields: [] },
    // Paid
    {
      id: 'file', group: 'Advanced', label: 'File upload', tier: 'paid', fields: ['file'],
      freeFallback: { type: 'text', note: 'Paste a link to your file (for example Google Drive or Dropbox).' }
    },
    {
      id: 'signature', group: 'Advanced', label: 'Signature', tier: 'paid', fields: [],
      freeFallback: { type: 'text', note: 'Type your full name as your signature.' }
    },
    {
      id: 'captcha', group: 'Advanced', label: 'CAPTCHA (bot check)', tier: 'paid', fields: [],
      freeFallback: { type: null }
    }
  ];

  var BY_ID = {};
  TYPES.forEach(function (t) { BY_ID[t.id] = t; });

  function get(id) { return BY_ID[id] || BY_ID.single; }
  function isChoiceLike(id) { return get(id).fields.indexOf('choices') >= 0; }
  function allowed(id, plan) { return plan === 'paid' || get(id).tier === 'free'; }

  return { list: TYPES, get: get, isChoiceLike: isChoiceLike, allowed: allowed };
});
