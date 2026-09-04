import { useState } from 'react';
import './DoctorBillingPage.css';

type ModalKind = 'manage' | 'plan' | 'credit' | 'refunds' | 'invoices' | 'payment' | 'success' | null;
type HistoryTab = 'payments' | 'credits' | 'refunds' | 'invoices';

const placeholderRows = Array.from({ length: 5 }, (_, index) => ({ id: index + 1 }));

function PlaceholderValue({ suffix }: { suffix?: string }) {
  return <span className="billing-placeholder-value">—{suffix ? ` ${suffix}` : ''}</span>;
}

function Modal({ kind, onClose, onOpen }: { kind: Exclude<ModalKind, null>; onClose: () => void; onOpen: (kind: ModalKind) => void }) {
  const titles: Record<Exclude<ModalKind, null>, string> = {
    manage: 'Manage Subscription',
    plan: 'View Plan Details',
    credit: 'View Credit Details',
    refunds: 'Refunds',
    invoices: 'Invoices',
    payment: 'Select Payment Method',
    success: 'Payment Successful!',
  };

  return <div className="billing-modal-backdrop" role="presentation">
    <section className="billing-modal" role="dialog" aria-modal="true" aria-label={titles[kind]}>
      <button className="billing-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
      <h2>{titles[kind]}</h2>
      {kind === 'manage' ? <>
        <p>View your plan details or change your subscription.</p>
        <div className="billing-modal-summary"><strong>Current Plan</strong><PlaceholderValue /></div>
        <div className="billing-feature-list"><span>✓ Clinic allowance</span><span>✓ Appointments</span><span>✓ Queue management</span><span>✓ Reports & analytics</span></div>
        <div className="billing-modal-actions"><button type="button" onClick={() => onOpen('payment')}>Renew Now</button><button type="button" className="danger" title="Subscription cancellation backend is not connected yet">Cancel Subscription</button></div>
      </> : null}
      {kind === 'plan' ? <>
        <p>Everything included in your current subscription.</p>
        <div className="billing-modal-summary"><strong>Current Plan</strong><PlaceholderValue /></div>
        <div className="billing-feature-list"><span>✓ Clinic allowance</span><span>✓ Appointments</span><span>✓ Queue management</span><span>✓ Reports & analytics</span><span>✓ Export data</span><span>✓ Priority support</span></div>
      </> : null}
      {kind === 'credit' ? <>
        <p>Your available refundable credit.</p>
        <div className="billing-modal-summary"><strong>Available Credit</strong><PlaceholderValue /></div>
        <h3>Credit History</h3><div className="billing-empty-box">Credit history endpoint is not connected yet.</div>
      </> : null}
      {kind === 'refunds' ? <>
        <p>Refunds are available only under the approved financial lifecycle.</p>
        <div className="billing-warning-box">Refund requests and processing remain governed by the protected financial workflow.</div>
        <h3>Refund History</h3><div className="billing-empty-box">Refund history endpoint is not connected yet.</div>
      </> : null}
      {kind === 'invoices' ? <>
        <p>All your subscription invoices.</p>
        <div className="billing-invoice-list">{placeholderRows.map((row) => <div key={row.id}><span>Invoice</span><PlaceholderValue /><button type="button" disabled>⇩</button></div>)}</div>
      </> : null}
      {kind === 'payment' ? <>
        <p>Choose how you want to pay for your subscription.</p>
        <label className="billing-payment-option"><input type="radio" name="payment" defaultChecked /> <strong>GCash</strong><span>Pay securely using your GCash account.</span></label>
        <label className="billing-payment-option"><input type="radio" name="payment" /> <strong>Maya</strong><span>Pay securely using your Maya wallet.</span></label>
        <label className="billing-payment-option"><input type="radio" name="payment" /> <strong>Stripe</strong><span>Pay securely using debit/credit card via Stripe.</span></label>
        <div className="billing-info-box">Payment-provider checkout is not connected to the frontend yet.</div>
        <div className="billing-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" title="Payment-provider checkout is not connected yet">Continue →</button></div>
      </> : null}
      {kind === 'success' ? <>
        <div className="billing-success-mark">✓</div>
        <p>Your payment has been processed successfully.</p>
        <div className="billing-modal-summary"><span>Amount Paid</span><PlaceholderValue /></div>
        <button type="button" onClick={onClose}>Back to Billing</button>
      </> : null}
      {!['manage', 'payment', 'success'].includes(kind) ? <button type="button" className="billing-modal-bottom" onClick={onClose}>Close</button> : null}
    </section>
  </div>;
}

export function DoctorBillingPage() {
  const [modal, setModal] = useState<ModalKind>(null);
  const [tab, setTab] = useState<HistoryTab>('payments');

  return <div className="doctor-billing-page">
    <header className="doctor-billing-heading"><h1>Billing</h1><p>Manage your subscription, payments, credits, and billing history.</p></header>

    <div className="billing-summary-grid">
      <section className="billing-card"><span className="billing-card-label">Current Plan</span><div className="billing-card-value"><span className="billing-round-icon">♕</span><div><strong>Subscription plan</strong><small className="billing-status-pill">Status unavailable</small></div></div><div className="billing-feature-list compact"><span>✓ Clinic allowance</span><span>✓ Appointments</span><span>✓ Queue management</span><span>✓ Reports & analytics</span></div><button type="button" onClick={() => setModal('plan')}>View Plan Details</button></section>
      <section className="billing-card"><span className="billing-card-label">Paid Through</span><div className="billing-card-value"><span className="billing-round-icon">▣</span><div><PlaceholderValue /></div></div><hr/><small>Next Billing Amount</small><PlaceholderValue /><button type="button" onClick={() => setModal('manage')}>Manage Subscription</button></section>
      <section className="billing-card"><span className="billing-card-label">Available Credit</span><div className="billing-card-value"><span className="billing-round-icon">▤</span><div><PlaceholderValue /></div></div><small>Available refundable credit</small><button type="button" onClick={() => setModal('credit')}>View Credit Details</button></section>
      <section className="billing-card"><span className="billing-card-label">Subscription Status</span><div className="billing-card-value"><span className="billing-round-icon green">♢</span><div><strong>Unavailable</strong></div></div><dl><div><dt>Grace Period</dt><dd>—</dd></div><div><dt>Suspension Status</dt><dd>—</dd></div></dl><button type="button" onClick={() => setModal('manage')}>View Status Details</button></section>
    </div>

    <div className="billing-main-grid">
      <div>
        <section className="billing-banner"><strong>Billing controls are ready for integration.</strong><span>Authoritative subscription and payment data is not exposed by a current Doctor billing API yet.</span></section>
        <section className="billing-history-card">
          <nav aria-label="Billing history sections">{([['payments','Payment History'],['credits','Credit Balance'],['refunds','Refunds'],['invoices','Invoices']] as const).map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
          {tab === 'payments' ? <div className="billing-table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Reference</th><th>Receipt</th></tr></thead><tbody>{placeholderRows.map(row => <tr key={row.id}><td>—</td><td>Subscription payment</td><td>—</td><td>—</td><td>—</td><td><button type="button" disabled>⇩</button></td></tr>)}</tbody></table></div> : <div className="billing-empty-history">{tab === 'credits' ? 'Credit balance history' : tab === 'refunds' ? 'Refund history' : 'Invoice history'} is not connected yet.</div>}
          <button type="button" className="billing-link-button" onClick={() => setModal(tab === 'refunds' ? 'refunds' : tab === 'invoices' ? 'invoices' : null)}>View all {tab === 'payments' ? 'payment history' : tab}</button>
        </section>
      </div>
      <aside className="billing-side-column">
        <section className="billing-side-card"><h3>Need Help?</h3><p>Visit our Billing Help Center or contact our support team.</p><button type="button" title="Help center destination is not connected yet">Billing Help Center ↗</button><button type="button" title="Support workflow is not connected yet">Contact Support</button></section>
        <section className="billing-side-card warning"><strong>Refunds are available after your account is permanently deleted.</strong><p>Learn more about our refund policy.</p><button type="button" onClick={() => setModal('refunds')}>View Refund Policy</button></section>
        <section className="billing-side-card"><h3>Secure & Private</h3><p>Financial information must remain protected and encrypted.</p><div className="billing-security-list"><span>🔒 Protected Data</span><span>🔒 Secure Access</span><span>◉ Privacy First</span></div></section>
      </aside>
    </div>
    {modal ? <Modal kind={modal} onClose={() => setModal(null)} onOpen={setModal} /> : null}
  </div>;
}
