const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'frontend', 'src', 'doctor', 'ClinicTab.tsx');

if (!fs.existsSync(file)) {
  throw new Error(`Required file not found: ${file}`);
}

const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) {
    throw new Error(`Validation failed for ${label}: exact source text was not found. No files were changed.`);
  }
  const second = source.indexOf(oldText, first + oldText.length);
  if (second >= 0) {
    throw new Error(`Validation failed for ${label}: source text appeared more than once. No files were changed.`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

const oldBlock = `type TimeZoneChoice = {
  value: string;
  city: string;
  region: string;
};

const CURATED_TIME_ZONES: TimeZoneChoice[] = [
  { value: 'Asia/Manila', city: 'Manila', region: 'Philippines' },
  { value: 'Asia/Bangkok', city: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Singapore', city: 'Singapore', region: 'Asia' },
  { value: 'Asia/Hong_Kong', city: 'Hong Kong', region: 'Asia' },
  { value: 'Asia/Kuala_Lumpur', city: 'Kuala Lumpur', region: 'Asia' },
  { value: 'Asia/Taipei', city: 'Taipei', region: 'Asia' },
  { value: 'Asia/Tokyo', city: 'Tokyo', region: 'Asia' },
  { value: 'Asia/Seoul', city: 'Seoul', region: 'Asia' },
  { value: 'Asia/Kolkata', city: 'New Delhi', region: 'Asia' },
  { value: 'Asia/Dubai', city: 'Dubai', region: 'Asia' },
  { value: 'Australia/Brisbane', city: 'Brisbane', region: 'Australia & Pacific' },
  { value: 'Australia/Sydney', city: 'Sydney', region: 'Australia & Pacific' },
  { value: 'Pacific/Auckland', city: 'Auckland', region: 'Australia & Pacific' },
  { value: 'Europe/London', city: 'London', region: 'Europe' },
  { value: 'Europe/Paris', city: 'Paris', region: 'Europe' },
  { value: 'Europe/Berlin', city: 'Berlin', region: 'Europe' },
  { value: 'America/New_York', city: 'New York', region: 'North America' },
  { value: 'America/Chicago', city: 'Chicago', region: 'North America' },
  { value: 'America/Denver', city: 'Denver', region: 'North America' },
  { value: 'America/Los_Angeles', city: 'Los Angeles', region: 'North America' },
  { value: 'America/Toronto', city: 'Toronto', region: 'North America' },
  { value: 'America/Vancouver', city: 'Vancouver', region: 'North America' },
];

function timeZoneOffset(timeZone: string) {
  try {
    const timeZoneName = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!timeZoneName || timeZoneName === 'GMT') return '+00:00';
    return timeZoneName.replace('GMT', '');
  } catch {
    return '';
  }
}

function timeZoneCity(timeZone: string) {
  return (
    CURATED_TIME_ZONES.find((choice) => choice.value === timeZone)?.city ??
    timeZone.split('/').at(-1)?.replaceAll('_', ' ') ??
    timeZone
  );
}

function timeZoneLabel(timeZone: string, city = timeZoneCity(timeZone)) {
  const offset = timeZoneOffset(timeZone);
  return offset ? \`(GMT\${offset}) \${city}\` : city;
}`;

const newBlock = `type TimeZoneChoice = {
  value: string;
};

const CURATED_TIME_ZONES: TimeZoneChoice[] = [
  { value: 'America/Los_Angeles' },
  { value: 'America/Denver' },
  { value: 'America/Chicago' },
  { value: 'America/New_York' },
  { value: 'America/Toronto' },
  { value: 'Europe/London' },
  { value: 'Europe/Paris' },
  { value: 'Europe/Berlin' },
  { value: 'Asia/Dubai' },
  { value: 'Asia/Kolkata' },
  { value: 'Asia/Bangkok' },
  { value: 'Asia/Hong_Kong' },
  { value: 'Asia/Kuala_Lumpur' },
  { value: 'Asia/Manila' },
  { value: 'Asia/Singapore' },
  { value: 'Asia/Taipei' },
  { value: 'Asia/Seoul' },
  { value: 'Asia/Tokyo' },
  { value: 'Australia/Brisbane' },
  { value: 'Australia/Sydney' },
  { value: 'Pacific/Auckland' },
];

function timeZoneOffset(timeZone: string) {
  try {
    const timeZoneName = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!timeZoneName || timeZoneName === 'GMT') return '+00:00';
    return timeZoneName.replace('GMT', '');
  } catch {
    return '';
  }
}

function timeZoneOffsetMinutes(timeZone: string) {
  const offset = timeZoneOffset(timeZone);
  const match = offset.match(/^([+-])(\\d{2}):(\\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function timeZoneLabel(timeZone: string) {
  const offset = timeZoneOffset(timeZone);
  return offset ? \`(GMT\${offset}) \${timeZone}\` : timeZone;
}

function sortedTimeZoneChoices(choices: TimeZoneChoice[]) {
  return [...choices].sort((left, right) => {
    const offsetDifference =
      timeZoneOffsetMinutes(left.value) - timeZoneOffsetMinutes(right.value);
    if (offsetDifference !== 0) return offsetDifference;
    return left.value.localeCompare(right.value);
  });
}`;

text = replaceOnce(text, oldBlock, newBlock, 'timezone curated list');

const oldChoices = `  const choices = useMemo(() => {
    const currentIsCurated = CURATED_TIME_ZONES.some(
      (choice) => choice.value === value,
    );
    return currentIsCurated || !value
      ? CURATED_TIME_ZONES
      : [
          {
            value,
            city: timeZoneCity(value),
            region: 'Current clinic timezone',
          },
          ...CURATED_TIME_ZONES,
        ];
  }, [value]);

  const filteredChoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter((choice) =>
      [choice.city, choice.region, choice.value].some((candidate) =>
        candidate.toLowerCase().includes(needle),
      ),
    );
  }, [choices, query]);`;

const newChoices = `  const choices = useMemo(() => {
    const currentIsCurated = CURATED_TIME_ZONES.some(
      (choice) => choice.value === value,
    );
    const allChoices =
      currentIsCurated || !value
        ? CURATED_TIME_ZONES
        : [{ value }, ...CURATED_TIME_ZONES];
    return sortedTimeZoneChoices(allChoices);
  }, [value]);

  const filteredChoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter((choice) =>
      [choice.value, timeZoneLabel(choice.value)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [choices, query]);`;

text = replaceOnce(text, oldChoices, newChoices, 'timezone choice sorting');

const oldButtonStyle = `        style={{
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
          textAlign: 'left',
          cursor: 'pointer',
        }}`;

const newButtonStyle = `        style={{
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
        }}`;

text = replaceOnce(text, oldButtonStyle, newButtonStyle, 'timezone field alignment');

const oldOptions = `            {filteredChoices.length ? (
              filteredChoices.map((choice, index) => {
                const previous = filteredChoices[index - 1];
                const showRegion = !previous || previous.region !== choice.region;
                const selected = choice.value === value;
                return (
                  <div key={choice.value}>
                    {showRegion ? (
                      <div
                        style={{
                          padding: '9px 10px 5px',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#6b7280',
                        }}
                      >
                        {choice.region}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => selectTimeZone(choice.value)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '9px 10px',
                        border: 0,
                        borderRadius: 7,
                        background: selected ? '#f2f4f6' : '#fff',
                        color: '#17191c',
                        font: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span>{timeZoneLabel(choice.value, choice.city)}</span>
                      {selected ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  </div>
                );
              })
            ) : (`;

const newOptions = `            {filteredChoices.length ? (
              filteredChoices.map((choice) => {
                const selected = choice.value === value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectTimeZone(choice.value)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '9px 10px',
                      border: 0,
                      borderRadius: 7,
                      background: selected ? '#f2f4f6' : '#fff',
                      color: '#17191c',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{timeZoneLabel(choice.value)}</span>
                    {selected ? <span aria-hidden="true">✓</span> : null}
                  </button>
                );
              })
            ) : (`;

text = replaceOnce(text, oldOptions, newOptions, 'timezone flat option list');

fs.writeFileSync(file, text.replace(/\n/g, eol), 'utf8');
fs.unlinkSync(__filename);

console.log('Final timezone picker refinement applied successfully.');
console.log('Changed file: frontend/src/doctor/ClinicTab.tsx');
console.log('One-time helper removed itself after applying.');
