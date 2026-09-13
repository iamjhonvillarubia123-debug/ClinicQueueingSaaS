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

const oldTriggerContents = `      >\n        <span>{timeZoneLabel(value)}</span>\n        <span aria-hidden="true" style={{ fontSize: 14 }}>\n          {open ? '⌃' : '⌄'}\n        </span>\n      </button>`;
const newTriggerContents = `      >\n        <span className="clinic-timezone-trigger-value">\n          <span className="clinic-timezone-clock" aria-hidden="true">\n            ◷\n          </span>\n          <span>{timeZoneLabel(value)}</span>\n        </span>\n        <span className="clinic-timezone-chevron" aria-hidden="true">\n          {open ? '⌃' : '⌄'}\n        </span>\n      </button>`;

let nextTsx = replaceOnce(tsx.text, oldTriggerContents, newTriggerContents, 'timezone trigger contents');

const oldStyles = `.clinic-timezone-trigger {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  min-height: 44px;\n  text-align: left;\n  cursor: pointer;\n}\n.clinic-timezone-trigger:focus-visible {\n  outline: 2px solid #111;\n  outline-offset: 2px;\n}`;

const newStyles = `.clinic-timezone-trigger {\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  width: 100%;\n  margin: 0;\n  padding: 12px 13px;\n  border: 1px solid #d5dae0;\n  border-radius: 9px;\n  background: #fff;\n  color: #171717;\n  font: inherit;\n  font-weight: 400;\n  line-height: normal;\n  text-align: left;\n  cursor: pointer;\n  appearance: none;\n}\n.clinic-timezone-trigger-value {\n  display: inline-flex;\n  min-width: 0;\n  align-items: center;\n  gap: 12px;\n}\n.clinic-timezone-clock {\n  flex: 0 0 auto;\n  color: #727986;\n  font-size: 18px;\n  line-height: 1;\n}\n.clinic-timezone-chevron {\n  flex: 0 0 auto;\n  color: #171717;\n  font-size: 14px;\n  line-height: 1;\n}\n.clinic-timezone-trigger:focus-visible {\n  outline: 2px solid #111;\n  outline-offset: 2px;\n}`;

let nextCss = replaceOnce(css.text, oldStyles, newStyles, 'timezone trigger visual styles');

fs.writeFileSync(tsxFile, nextTsx.replace(/\n/g, tsx.eol), 'utf8');
fs.writeFileSync(cssFile, nextCss.replace(/\n/g, css.eol), 'utf8');
fs.unlinkSync(__filename);

console.log('Timezone reference alignment applied successfully.');
console.log('Changed: frontend/src/doctor/ClinicTab.tsx');
console.log('Changed: frontend/src/styles/clinic.css');
console.log('Matched the standard clinic field border, background, padding, font treatment, and top alignment.');
console.log('Timezone behavior, ordering, search, persistence, backend logic, and photo behavior were not changed.');
console.log('One-time helper removed itself after applying.');
