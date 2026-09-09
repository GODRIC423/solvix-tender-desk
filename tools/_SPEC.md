# Solvix Toolkit — build contract

Every tool is ONE self-contained `.html` file that a non-technical person can open
and immediately get value from. These are products people pay for, not demos.

## Hard requirements

1. **Self-contained and offline.** No network of any kind. No CDN, no Google Fonts,
   no external images, no fetch. System fonts only (the kit sets them). Everything
   inline. The tool must work permanently from a USB stick on a laptop with no wifi.
2. **Inline `_kit.css` verbatim** inside `<style>`, then add your own tool-specific
   CSS after it. Set `--accent` (and `--accent-ink`, `--accent-wash`) for your
   category at the top of your own block, overriding the kit default:
   - Trades & Construction `#B45309` / `#8F4207` / `#FBF0DC`
   - Freight & Logistics `#1F5FA8` / `#17497F` / `#E6EEF8`
   - Business Admin `#3F4A9E` / `#31397B` / `#EAECF8`
   - Contracts & Documents `#5B4794` / `#463774` / `#EFEBF8`
   - Scheduling & Workforce `#0F6E75` / `#0B555A` / `#E1F0F1`
   - Compliance & Safety `#B3261E` / `#8D1E17` / `#FBE7E5`
   - Finance & Pricing `#1B7A4B` / `#145C39` / `#E3F2EA`
   - Retail & Hospitality `#A8434F` / `#82333C` / `#F8EAEC`
   - Property & Field Service `#7A5C1E` / `#5E4717` / `#F6F0DF`
   - Personal & Household `#8A3A6B` / `#6C2D54` / `#F7E9F1`
   In dark mode lighten the accent (roughly +25% lightness) inside BOTH the
   `@media (prefers-color-scheme:dark)` and `[data-theme="dark"]` blocks, and check
   `--on-accent` still contrasts against it.
3. **`<head>`:** `<!doctype html>`, `<html lang="en">`, charset, viewport,
   a unique `<title>`, `<meta name="description">`, `<meta name="theme-color">`,
   and an inline SVG favicon (`data:image/svg+xml,...`) in the accent colour.
4. **Working, not mocked.** Every calculation in the brief's `logic` field must be
   genuinely implemented and correct. No hardcoded results. No "coming soon".
   If the brief names a formula, standard or table, implement that exact thing.
5. **Opens in a working state.** Load with a realistic worked example already filled
   in, plainly labelled as sample data, and a single obvious control to clear it.
   Never an empty form. A first-time user must see what the tool does in two seconds.
6. **Persistence.** Save to `localStorage` on every change, restore on load, wrapped
   in try/catch so a blocked storage API never breaks the tool. Namespace the key
   (`solvix.<slug>.v1`). Include a visible "Clear all data" control that confirms first.
7. **Export.** Implement everything the brief's `out` field lists.
   - **Print:** the kit's print stylesheet must yield a clean document. Add a
     `.printonly` header block with the business/job details so the printout stands
     alone. Test mentally at A4 and Letter.
   - **CSV:** build with proper escaping (quote fields containing `,` `"` or newline,
     double internal quotes) and trigger via a Blob + `URL.createObjectURL` +
     a temporary `<a download>`. Prefix a UTF-8 BOM so Excel opens it correctly.
   - **JSON:** full state in, full state out — import must restore exactly.
8. **Input discipline.** Validate on blur, show the error next to the field, never
   `alert()`. Guard every division by zero. Never render `NaN`, `undefined`,
   `Infinity` or `-0` — show `—` instead. Currency to 2dp, quantities sensibly
   rounded, and say which way (up for materials, always).
9. **Accessible and keyboard-usable.** Real `<label for>` on every input, `<table>`
   for tabular data with `<th scope>`, buttons are `<button type="button">`, focus
   visible, contrast ≥4.5:1 for body text. Tab order must be sane in table rows.
10. **Responsive 360px → 1920px.** No horizontal page overflow. Tables scroll inside
    `.tw`. On mobile the primary result stays visible without hunting.
11. **Under 110 KB.** Zero console errors, zero page errors, zero failed requests.
12. **Currency and units.** Where money appears, a currency selector (£ $ € plus a
    custom symbol) persisted with the data. Where measurements appear and the brief
    implies both, an imperial/metric toggle that converts correctly rather than
    relabelling.

## Structure to follow

```
.appbar   → mark + tool name + a one-line sub, then actions (Print, CSV, Clear) on the right
.app      → the working area, usually .split: inputs left, live results right in a .sticky card
.card>.ft → totals or the primary answer, always visible
footer    → one line: what the tool assumes, and any standard/source it implements
```

The primary answer is the point of the page. Put it in a `.stat.hero` where the eye
lands first, and update it live as the user types — never behind a "Calculate" button.

## Where the brief says a disclaimer is needed

Contracts, medical, safety, tax and code-compliance tools carry real risk if misused.
Where the brief calls for a notice, put it in a `.note.warn` or `.note.bad` that is
visible on screen without scrolling AND printed on the document. Write it plainly:
what the tool does, what it does not do, and who to consult. Never bury it.

## Verify before you finish

Run: `SCRATCH/shot.sh <file.html> SCRATCH/shots/<prefix>`
Then Read the PNGs and look. Check the QA report is `"ok": true`. Then hand-check
your arithmetic against the brief's stated formula with one worked example you
compute yourself — a tool that looks right and calculates wrong is worthless.
