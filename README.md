# QSF Converter

Convert a questionnaire written in **Word (.docx), PDF, plain text, or Excel/CSV** into a **Qualtrics Survey Format (.qsf)** file that you can import straight into Qualtrics.

**Live app:** https://rohankumar141414.github.io/qsf-converter/

Everything runs in your browser. Files are never uploaded to a server.

## How to use

1. Choose your Qualtrics account type: **Free** or **Paid / institutional licence**. On the free plan, paid-only question types are swapped for text boxes (file upload becomes "paste a link", signature becomes "type your name"). You can switch at any time.
2. Drop in your file, paste text, or start from scratch.
3. Review the detected questions. Change any type, text, help text, section, export tag or required setting; reorder, duplicate or delete questions.
4. Set the survey options and click **Download .qsf**.
5. In Qualtrics: **Create a new project → Survey → From a file**, then upload the `.qsf`.

## Question types

| Group | Types | Plan |
| --- | --- | --- |
| Choice | Single answer, multiple answers, dropdown | Free |
| Text entry | Short text, long text / essay (with word limit note), email (validated), phone, number (min / max / decimals), date (validated), form fields | Free |
| Scales & grids | Matrix / Likert (single or multiple answers per row), slider, star rating, Net Promoter Score, rank order, constant sum | Free |
| Other | Descriptive text / instructions, page timer | Free |
| Advanced | File upload, signature, CAPTCHA | Paid |

"Other (please specify)" choices get a text box, and "None of the above" is exclusive in multiple-answer questions. Sections become separate Qualtrics blocks (each on its own page), with an optional heading shown to respondents.

Which types count as paid-only is set in `js/types.js`. Qualtrics changes its plans over time, so edit the `tier` values there if your account differs.

## How to format your file

**Excel / CSV: one row per question.** Column names are flexible:

| Column | Also recognised as |
| --- | --- |
| Question | Field Name, Label, Item, Prompt |
| Type | Field Type, Question Type, Format: free text like `Long Text (Max 500 words)`, `File Upload (PDF)`, `Rating 1-5`, `Yes/No`, `Slider 0-10` works |
| Choices | Options, Answers, Values: separated by `;` `\|` `/` or new lines, or one column per choice |
| Section | Category, Block, Group, Part |
| Required | Mandatory, Compulsory (Yes/No) |
| Help text | Description, Guidance, Hint, Notes. A list like `Male / Female / Other` is read as the choices for choice questions |
| ID | Field ID, Variable, Code (becomes the export tag) |
| Scale | Columns (matrix column labels) |

**Word / PDF / text**

```
Section A: About you

1. Email address *

2. Which devices do you own? (Select all that apply)
- Phone
- Laptop
- Other (please specify)

3. How much do you agree with each statement? [matrix]
Scale: Disagree / Neutral / Agree
- The app is easy to use
- Prices are fair

4. How likely are you to recommend us? [nps]
```

- Questions start with `1.`, `1)`, `Q1`, or `Question 1:`. Word's automatic numbering also works.
- Choices start with `a)`, `(a)`, `-`, `•`, or `☐`, or have no marker if the question ends with `?` or `:`.
- Sections: `Section A: ...`, `Part 2 - ...`, Word headings, or bold lines.
- `*` or `(required)` at the end marks a required question.
- Type tags: `[dropdown]` `[multi]` `[email]` `[phone]` `[date]` `[number]` `[long text max 300 words]` `[matrix]` `[rank]` `[nps]` `[slider 0-10]` `[stars]` `[constant sum 100]` `[form]` `[file]` `[signature]`.
- In Word, a table with a scale across the top row and statements down the first column becomes a matrix. A table with a Question/Type/Options header is read like a spreadsheet.
- Questions without choices are guessed from their wording (email, phone, date, number, long answer).

The `samples/` folder has an example of each format, including an application-form spreadsheet.

## Limitations

- Old `.doc` files are not supported. Save them as `.docx` first.
- Scanned PDFs (images without selectable text) can't be read.
- Detection is rule-based, so check the review step before downloading.
- Tables inside PDFs can't be detected (the PDF loses the table structure); use the Word or Excel original for matrix grids.
- Date format (e.g. DD/MM/YYYY), allowed upload file types and upload size limits are shown to respondents as help text; set the matching validation in Qualtrics after import.
- Display/skip logic, piped text and quotas are not generated.

## Development

It's a static site with no build step. Libraries (mammoth.js, pdf.js, SheetJS) are bundled in `vendor/`. Code: `js/types.js` (question types and plan tiers), `js/parser.js` (file → questions), `js/qsf.js` (questions → QSF), `js/app.js` (interface).

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node test/run.js              # unit tests
```
