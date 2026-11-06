# QSF Converter

Convert a questionnaire written in **Word (.docx), PDF, plain text, or Excel/CSV** into a **Qualtrics Survey Format (.qsf)** file that you can import straight into Qualtrics.

**Live app:** https://rohankumar141414.github.io/qsf-converter/

Everything runs in your browser. Files are never uploaded to a server.

## How to use

1. Open the app and drop in your file (or paste text).
2. Review the detected questions. You can fix text, change the type, edit choices, reorder or delete questions.
3. Set the survey name and options, then click **Download .qsf**.
4. In Qualtrics: **Create a new project → Survey → From a file**, then upload the `.qsf`.

## Supported question types

| Type | Qualtrics equivalent |
| --- | --- |
| Single answer | Multiple choice, single answer (vertical or horizontal) |
| Multiple answers | Multiple choice, multiple answer (vertical or horizontal) |
| Dropdown | Multiple choice, dropdown list |
| Text entry | Text entry, single line or essay box (used for questions with no choices) |

Choices like "Other (please specify)" get a text box, and "None of the above" is made exclusive in multiple-answer questions.

## How to format your file

**Word / PDF / text**

```
1. How did you hear about us?
a) Search engine
b) Social media
c) Other (please specify)

2. Which products have you used? (Select all that apply)
- Mobile app
- Website
```

- Questions start with `1.`, `1)`, `Q1`, or `Question 1:`. Word's automatic numbering also works.
- Choices start with `a)`, `(a)`, `a.`, `-`, `•`, or `☐`, or have no marker if the question ends with `?` or `:`.
- "Select all that apply", "check all", or `☐` boxes make a multiple-answer question.
- Optional tags: `[multi]`, `[single]`, `[dropdown]`, `[text]`.

**Excel / CSV:** use a header row with a `Question` column, an optional `Type` column (`single`, `multi`, `dropdown`, `text`), and either a `Choices` column (separated by `;` or `|`) or one column per choice (`Choice 1`, `Choice 2`, …). Without a header row, column A is the question and the other columns are choices.

The `samples/` folder has an example of each format.

## Limitations

- Old `.doc` files are not supported. Save them as `.docx` first.
- Scanned PDFs (images without selectable text) can't be read.
- Detection is rule-based, so check the review step before downloading.

## Development

It's a static site with no build step. Libraries (mammoth.js, pdf.js, SheetJS) are bundled in `vendor/`.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node test/run.js              # unit tests
```
