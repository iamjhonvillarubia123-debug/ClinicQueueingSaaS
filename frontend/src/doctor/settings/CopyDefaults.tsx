import { useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { LoadState, Note, useSettingsData } from './SettingsShared';

type Templates = {
  services: { id: string; name: string }[];
  bookingQuestions: { id: string; questionText: string }[];
};
export function CopyDefaults({
  kind,
  defaults,
  busy,
  setBusy,
}: {
  kind: 'services' | 'questions' | 'both';
  defaults: Templates;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const clinics =
    useSettingsData<{ id: string; name: string; lifecycleStatus: string }[]>(
      '/practice-location',
    );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState('all');
  const [templates, setTemplates] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const attempt = useRef({ body: '', key: '' });
  const choices = [
    ...(kind === 'questions'
      ? []
      : defaults.services.map((item) => ({ id: item.id, label: item.name }))),
    ...(kind === 'services'
      ? []
      : defaults.bookingQuestions.map((item) => ({
          id: item.id,
          label: item.questionText,
        }))),
  ];
  const ids = mode === 'all' ? choices.map((item) => item.id) : templates;
  const body = {
    practiceLocationIds: selected,
    serviceTemplateIds: defaults.services
      .filter((item) => ids.includes(item.id))
      .map((item) => item.id),
    bookingQuestionTemplateIds: defaults.bookingQuestions
      .filter((item) => ids.includes(item.id))
      .map((item) => item.id),
  };
  async function apply() {
    setBusy(true);
    setError('');
    const serialized = JSON.stringify(body);
    if (attempt.current.body !== serialized)
      attempt.current = { body: serialized, key: crypto.randomUUID() };
    try {
      await apiRequest('/doctor/defaults/apply', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': attempt.current.key },
      });
      setMessage(
        'Copy completed. Missing defaults were added; existing clinic entries were not changed.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to copy defaults.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Note>
        Only missing defaults are added. Existing entries, clinic edits, and
        question order stay unchanged. Previously copied defaults are skipped,
        even if you have since edited the template. All selected clinics must
        pass validation before any changes are saved.
      </Note>
      {!message && (
        <>
          <fieldset disabled={busy || review}>
            <label>
              Copy mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="all">Copy all missing defaults</option>
                <option value="selected">Copy selected defaults</option>
              </select>
            </label>
            {mode === 'selected' &&
              choices.map((item) => (
                <label className="ds-checkbox" key={item.id}>
                  <input
                    type="checkbox"
                    checked={templates.includes(item.id)}
                    onChange={(event) =>
                      setTemplates(
                        event.target.checked
                          ? [...templates, item.id]
                          : templates.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
            <label>
              Search clinics
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <LoadState
              error={clinics.error}
              loading={!clinics.data}
              retry={clinics.reload}
            />
            {(clinics.data ?? [])
              .filter(
                (clinic) =>
                  clinic.lifecycleStatus !== 'PERMANENTLY_DELETED' &&
                  clinic.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((clinic) => (
                <label key={clinic.id} className="ds-checkbox ds-soft-row">
                  <input
                    type="checkbox"
                    checked={selected.includes(clinic.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, clinic.id]
                          : selected.filter((id) => id !== clinic.id),
                      )
                    }
                  />
                  {clinic.name}
                </label>
              ))}
          </fieldset>
          {review ? (
            <>
              <p>
                Copy up to {body.serviceTemplateIds.length} services and{' '}
                {body.bookingQuestionTemplateIds.length} questions to{' '}
                {selected.length} clinics. Previously copied entries will be
                skipped. If any clinic would exceed five active questions,
                nothing will be copied.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  setReview(false);
                  setError('');
                }}
              >
                Back
              </button>{' '}
              <button
                className="ds-primary"
                disabled={busy}
                onClick={() => void apply()}
              >
                {busy ? 'Copying…' : 'Confirm Copy'}
              </button>
            </>
          ) : (
            <button
              className="ds-primary"
              disabled={
                !selected.length ||
                !ids.length ||
                !clinics.data ||
                !!clinics.error
              }
              onClick={() => setReview(true)}
            >
              Review Copy
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="ds-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="ds-success">
          {message}
        </p>
      )}
    </>
  );
}
