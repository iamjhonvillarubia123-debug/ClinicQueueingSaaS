import { useState } from 'react';

export type QueueDrawerMode = 'walkin' | 'adjust' | 'delay';
type AdjustFlow = 'move' | 'return' | 'same-day' | 'correct';

type Props = {
  mode: QueueDrawerMode;
  onClose: () => void;
  onComplete: (message: string) => void;
};

const services = [
  ['General Consultation', '15 min'],
  ['Dental Cleaning', '20 min'],
  ['Laboratory Test', '10 min'],
];

function DrawerHeader({ icon, title, subtitle, onClose }: { icon: string; title: string; subtitle: string; onClose: () => void }) {
  return <header className="queue-drawer-header"><span>{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>;
}

function DrawerFooter({ onClose, primary, onPrimary, back, disabled }: { onClose: () => void; primary: string; onPrimary: () => void; back?: () => void; disabled?: boolean }) {
  return <footer className="queue-drawer-footer"><button type="button" onClick={back ?? onClose}>{back ? 'Back' : 'Cancel'}</button><button className="is-primary" type="button" onClick={onPrimary} disabled={disabled}>{primary}</button></footer>;
}

function ServiceFields() {
  const [selected, setSelected] = useState(['General Consultation']);
  return <><fieldset className="queue-service-field"><legend>Select Service(s) <em>*</em></legend><small>You can select more than one if needed.</small>{services.map(([name, duration]) => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={() => setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])} /><span>{name}</span><small>Est. {duration}</small></label>)}</fieldset><fieldset className="queue-question-field"><legend>Booking Questions</legend><label>1. Reason for visit <em>*</em><select defaultValue="Toothache"><option>Toothache</option><option>Routine check-up</option><option>Follow-up</option></select></label><label>2. Are you experiencing any fever?<span><input type="radio" name="fever" /> Yes <input type="radio" name="fever" defaultChecked /> No</span></label><label>3. Have you been to this clinic before?<span><input type="radio" name="prior" defaultChecked /> Yes <input type="radio" name="prior" /> No</span></label></fieldset></>;
}

function PatientFields() {
  return <><section className="queue-patient-fields"><h3>Patient name</h3><label>First name <em>*</em><input defaultValue="Angela" /></label><label>Last name <em>*</em><input defaultValue="Reyes" /></label></section><label className="queue-full-field">Mobile number <em>*</em><span><select defaultValue="PH +63"><option>PH +63</option></select><input defaultValue="0917 123 4567" /></span><small>For SMS updates about their queue</small></label></>;
}

function SuccessState({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return <div className="queue-success"><span>✓</span><h3>{title}</h3><p>{message}</p><button type="button" onClick={onClose}>Done</button></div>;
}

function WalkInDrawer({ onClose, onComplete }: Omit<Props, 'mode'>) {
  const [done, setDone] = useState(false);
  return <aside className="queue-action-drawer"> <DrawerHeader icon="♙+" title="Add Walk-in" subtitle="Create a same-day appointment for North Clinic" onClose={onClose} />{done ? <SuccessState title="Patient added to queue" message="Angela Reyes was added as queue #18 with General Consultation." onClose={() => { onComplete('Walk-in patient added to the queue.'); onClose(); }} /> : <div className="queue-drawer-body"><div className="queue-date-banner">▣ Service Date: <strong>Tue, Aug 25, 2026</strong></div><PatientFields /><ServiceFields /><div className="queue-drawer-info">ⓘ The appointment will be added to today’s queue with the next available queue number.</div></div>} {!done ? <DrawerFooter onClose={onClose} primary="ADD TO QUEUE" onPrimary={() => setDone(true)} /> : null}</aside>;
}

const adjustChoices: Array<{ id: AdjustFlow; icon: string; title: string; copy: string; tone: string }> = [
  { id: 'move', icon: '♙⇄', title: '1. Move a waiting patient', copy: 'Change the position of a patient who is currently waiting.', tone: 'blue' },
  { id: 'return', icon: '♙↪', title: '2. Return a temporarily absent patient', copy: 'Bring a patient who returned after missing their call back into the queue.', tone: 'orange' },
  { id: 'same-day', icon: '♙+', title: '3. Add a new same-day patient', copy: 'Create a new appointment and place the patient in the queue.', tone: 'purple' },
  { id: 'correct', icon: '↻', title: '4. Correct the queue', copy: 'Fix an accidental queue action such as an over-clicked Call Next or wrong outcome.', tone: 'green' },
];

function AdjustQueueDrawer({ onClose, onComplete }: Omit<Props, 'mode'>) {
  const [flow, setFlow] = useState<AdjustFlow | null>(null);
  const [step, setStep] = useState(1);
  const selected = adjustChoices.find((choice) => choice.id === flow);
  function finish() { setStep(3); }
  return <aside className="queue-action-drawer"><DrawerHeader icon="♙+" title="Adjust Queue" subtitle="Queue corrections and special placement" onClose={onClose} /><div className="queue-drawer-body"><small>Step {step} of 3</small>{!flow ? <><h3>What do you want to do?</h3><div className="queue-adjust-choices">{adjustChoices.map((choice) => <button className={`is-${choice.tone}`} type="button" key={choice.id} onClick={() => setFlow(choice.id)}><span>{choice.icon}</span><div><strong>{choice.title}</strong><small>{choice.copy}</small></div>›</button>)}</div><div className="queue-drawer-info">ⓘ Protected Next and Return-to-Queue patients will remain in their protected positions. Queue numbers and serving order are calculated automatically.</div></> : null}{flow && step === 1 ? <><h3>{selected?.title.replace(/^\d\. /, '')}</h3>{flow === 'same-day' ? <><PatientFields /><ServiceFields /></> : flow === 'return' ? <div className="queue-select-list"><label>Temporarily absent (1)</label><button className="is-selected"><b>#10</b><span><strong>Liza Morales</strong><small>General Consultation · Missed at 9:40 AM</small></span>✓</button></div> : flow === 'correct' ? <><div className="queue-recent-action"><small>Most recent call</small><strong>#08 Anna Garcia</strong><p>General Consultation · Called at 10:14 AM</p></div><fieldset><legend>What needs correcting?</legend><label><input type="radio" name="correction" defaultChecked /> I accidentally called the next patient</label><label><input type="radio" name="correction" /> I selected the wrong outcome for the previous patient</label></fieldset></> : <div className="queue-select-list"><input placeholder="Search by name or Queue #" /><label>Waiting patients (10)</label>{['#08 Anna Garcia', '#09 Juan Dela Cruz', '#10 Liza Morales', '#11 Ramon Bautista', '#12 Sofia Lim'].map((patient, index) => <button className={index === 2 ? 'is-selected' : ''} key={patient}><b>{patient.slice(0, 3)}</b><span><strong>{patient.slice(4)}</strong><small>General Consultation · Waiting since 9:{20 + index * 7} AM</small></span>{index === 2 ? '✓' : 'SELECT'}</button>)}</div>}</> : null}{flow && step === 2 ? <div className={`queue-review is-${selected?.tone}`}><h3>Review {flow === 'move' ? 'move' : flow === 'return' ? 'return to queue' : flow === 'same-day' ? 'placement' : 'correction'}</h3><strong>{flow === 'move' ? 'Move #10 Liza Morales after #07 Pedro Reyes' : flow === 'return' ? 'Return Liza Morales after all protected patients' : flow === 'same-day' ? 'Angela Reyes will receive the next available position' : 'Restore #07 Pedro Reyes as Now Serving'}</strong><p>Queue numbers will not change. This action will be reflected in the queue immediately.</p></div> : null}{flow && step === 3 ? <SuccessState title={flow === 'correct' ? 'Queue corrected' : 'Queue updated'} message={`${selected?.title.replace(/^\d\. /, '')} completed successfully.`} onClose={() => { onComplete('Queue adjustment completed.'); onClose(); }} /> : null}</div>{!flow ? <DrawerFooter onClose={onClose} primary="Select an option" onPrimary={() => undefined} disabled /> : step < 3 ? <DrawerFooter onClose={onClose} primary={step === 1 ? 'REVIEW' : 'CONFIRM'} onPrimary={() => step === 1 ? setStep(2) : finish()} back={() => step === 1 ? setFlow(null) : setStep(1)} /> : null}</aside>;
}

function DelayDrawer({ onClose, onComplete }: Omit<Props, 'mode'>) {
  const [kind, setKind] = useState<'delay' | 'break'>('break');
  const [step, setStep] = useState(1);
  const title = kind === 'delay' ? 'Delay clinic opening' : 'Pause patient serving';
  const timeLabel = kind === 'delay' ? 'New expected opening time' : 'Expected resume time';
  return <aside className="queue-action-drawer"><DrawerHeader icon="♨" title="DELAY / BREAK" subtitle="Temporarily stop or delay patient serving." onClose={onClose} /><div className="queue-delay-switch"><button className={kind === 'delay' ? 'is-active' : ''} onClick={() => setKind('delay')}>Delay opening</button><button className={kind === 'break' ? 'is-active' : ''} onClick={() => setKind('break')}>Take a break</button></div><div className="queue-drawer-body"><small>Step {step} of 3</small>{step === 1 ? <><h3>{title}</h3><p>The clinic is currently {kind === 'delay' ? 'not started yet' : 'open'}.</p><fieldset className="queue-duration"><legend>{kind === 'delay' ? 'Set new expected opening time' : 'Expected resume time'} <em>*</em></legend>{['15 min', '30 min', '45 min', '1 hour'].map((value) => <button className={value === '30 min' ? 'is-active' : ''} key={value}>{value}</button>)}</fieldset><label className="queue-full-field">Reason for {kind}<select defaultValue={kind === 'delay' ? 'Doctor delayed' : 'Lunch break'}><option>Doctor delayed</option><option>Lunch break</option><option>Emergency</option></select></label><label className="queue-full-field">Message to patients (optional)<textarea defaultValue={kind === 'delay' ? 'The doctor is running late this morning. Thank you for your patience.' : 'The doctor is taking a short break. Serving will resume shortly.'} /></label><div className="queue-patient-preview"><small>◉ What patients will see</small><strong>{kind === 'delay' ? 'Clinic opening delayed' : 'Patient serving temporarily paused'}</strong><p>{timeLabel}: <b>{kind === 'delay' ? '8:30 AM' : '11:30 AM'}</b></p></div></> : null}{step === 2 ? <div className="queue-review"><h3>Review {kind}</h3><strong>{timeLabel}: {kind === 'delay' ? '8:30 AM' : '11:30 AM'}</strong><p>Patients will see the notice and receive the updated expected time.</p></div> : null}{step === 3 ? <SuccessState title={kind === 'delay' ? 'The delay has been set' : 'The break has started'} message="Patients will be notified when backend messaging is connected." onClose={() => { onComplete(kind === 'delay' ? 'Clinic opening delay set.' : 'Clinic break started.'); onClose(); }} /> : null}</div>{step < 3 ? <DrawerFooter onClose={onClose} primary={step === 1 ? (kind === 'delay' ? 'CONFIRM DELAY' : 'START BREAK') : 'CONFIRM'} onPrimary={() => setStep((current) => current + 1)} back={step === 2 ? () => setStep(1) : undefined} /> : null}</aside>;
}

export function QueueActionDrawer(props: Props) {
  if (props.mode === 'walkin') return <WalkInDrawer onClose={props.onClose} onComplete={props.onComplete} />;
  if (props.mode === 'adjust') return <AdjustQueueDrawer onClose={props.onClose} onComplete={props.onComplete} />;
  return <DelayDrawer onClose={props.onClose} onComplete={props.onComplete} />;
}
