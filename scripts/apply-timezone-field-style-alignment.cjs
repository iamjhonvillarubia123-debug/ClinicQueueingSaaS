const fs = require('fs');
const path = require('path');

const tsxFile = path.join(process.cwd(), 'frontend', 'src', 'doctor', 'ClinicTab.tsx');
const cssFile = path.join(process.cwd(), 'frontend', 'src', 'styles', 'clinic.css');

for (const file of [tsxFile, cssFile]) {
  if (!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
}

function readNormalized(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { text: raw.replace(/\r\n/g, '\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}

function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Validation failed for ${label}: expected source was not found. No files were changed.`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Validation failed for ${label}: expected source appeared more than once. No files were changed.`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

const tsx = readNormalized(tsxFile);
const css = readNormalized(cssFile);

const oldTrigger = `      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        style={{
          width: '100%',
          minHeight: 46,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 14px',
          border: '1px solid #d7dce2',
          borderRadius: 8,
          background: '#fff',
          color: '#17191c',
          font: 'inherit',
          lineHeight: 1.2,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >`;

const newTrigger = `      <button
        className="clinic-timezone-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >`;

let nextTsx = replaceOnce(tsx.text, oldTrigger, newTrigger, 'timezone trigger');

const oldCssSelector = `.clinic-form-grid input,
.clinic-form-grid textarea,
.clinic-form-grid select,
.clinic-hours-row select,`;
const newCssSelector = `.clinic-form-grid input,
.clinic-form-grid textarea,
.clinic-form-grid select,
.clinic-form-grid .clinic-timezone-trigger,
.clinic-hours-row select,`;
let nextCss = replaceOnce(css.text, oldCssSelector, newCssSelector, 'shared clinic form control selector');

const anchor = `.clinic-form-grid textarea {
  min-height: 80px;
  resize: vertical;
}`;
const replacement = `${anchor}
.clinic-timezone-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  text-align: left;
  cursor: pointer;
}
.clinic-timezone-trigger:focus-visible {
  outline: 2px solid #111;
  outline-offset: 2px;
}`;
nextCss = replaceOnce(nextCss, anchor, replacement, 'timezone trigger layout styles');

fs.writeFileSync(tsxFile, nextTsx.replace(/\n/g, tsx.eol), 'utf8');
fs.writeFileSync(cssFile, nextCss.replace(/\n/g, css.eol), 'utf8');
fs.unlinkSync(__filename);

console.log('Timezone field style alignment applied successfully.');
console.log('Changed: frontend/src/doctor/ClinicTab.tsx');
console.log('Changed: frontend/src/styles/clinic.css');
console.log('Dropdown behavior, timezone ordering, backend logic, and photo behavior were not changed.');
console.log('One-time helper removed itself after applying.');
