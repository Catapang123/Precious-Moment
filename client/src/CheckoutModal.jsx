import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { cartCompatibility, estimateLine, money, todayISO, tomorrowISO } from './lib';

function fieldValue(event) {
  return event.target.value;
}

export default function CheckoutModal({ open, cart, user, onClose, onSuccess }) {
  const compatibility = useMemo(() => cartCompatibility(cart), [cart]);
  const [type, setType] = useState('pickup');
  const [branches, setBranches] = useState([]);
  const [branchesError, setBranchesError] = useState('');
  const [form, setForm] = useState({
    branch_id: '',
    pickup_date: tomorrowISO(),
    pickup_time: '10:00',
    event_date: tomorrowISO(),
    event_time: '10:00',
    duration_hours: 3,
    venue: '',
    address: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    setType(compatibility.pickup ? 'pickup' : 'event');
    setError('');
    setBusy(false);
    setForm((current) => ({
      ...current,
      pickup_date: current.pickup_date >= todayISO() ? current.pickup_date : tomorrowISO(),
      event_date: current.event_date >= todayISO() ? current.event_date : tomorrowISO(),
    }));
  }, [open, compatibility.pickup]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    api('/api/branches')
      .then((result) => {
        if (cancelled) return;
        const rows = result.branches || [];
        setBranches(rows);
        setBranchesError('');
        setForm((current) => ({
          ...current,
          branch_id: current.branch_id || rows[0]?.id || '',
        }));
      })
      .catch((problem) => {
        if (!cancelled) setBranchesError(problem.message || 'Branches could not load.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: fieldValue(event) }));
    setError('');
  };

  const estimate = cart.reduce((sum, line) => sum + (Number(line.estimate) || 0), 0);
  const hasEventItems = cart.some((line) => line.booking_availability === 'event');
  const hasPickupItems = cart.some((line) => line.booking_availability === 'pickup');
  const canSubmitRole = user?.role === 'customer' || user?.role === 'admin';

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!user) return setError('Please sign in again to finish the booking.');
    if (!canSubmitRole) {
      return setError('Branch-head accounts manage bookings from the studio dashboard. Sign in as a customer to place a new request.');
    }
    if (!compatibility.ok) return setError(compatibility.reason);
    if (type === 'pickup') {
      if (!form.branch_id) return setError('Choose the branch where you will pick up.');
      if (!form.pickup_date || form.pickup_date < todayISO()) return setError('Choose a valid pickup date.');
    } else {
      if (!form.event_date || form.event_date < todayISO()) return setError('Choose a valid event date.');
      if (!form.event_time) return setError('Choose the event start time.');
      const duration = Number(form.duration_hours);
      if (!Number.isFinite(duration) || duration < 1 || duration > 12) {
        return setError('Choose an event duration between 1 and 12 hours.');
      }
      if (form.venue.trim().length < 3) return setError('Enter the event venue.');
      if (form.address.trim().length < 8) {
        return setError('Enter the full event address, including the barangay and city.');
      }
    }

    const items = cart.map((line) => ({
      service_id: line.service_id,
      qty: line.qty,
      ...(line.pricing_mode === 'area'
        ? { length_ft: line.length_ft, height_ft: line.height_ft }
        : {}),
    }));

    const payload =
      type === 'pickup'
        ? {
            booking_type: type,
            branch_id: form.branch_id,
            pickup_date: form.pickup_date,
            pickup_time: form.pickup_time,
            notes: form.notes.trim(),
            items,
          }
        : {
            booking_type: type,
            branch_id: form.branch_id || undefined,
            event_date: form.event_date,
            event_time: form.event_time,
            duration_hours: Number(form.duration_hours),
            venue: form.venue.trim(),
            address: form.address.trim(),
            notes: form.notes.trim(),
            items,
          };

    setBusy(true);
    try {
      const result = await api('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!result.booking) throw new Error('The booking was saved but no confirmation was returned.');
      onSuccess(result.booking);
    } catch (problem) {
      setError(problem.message || 'We could not send that booking. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shop-overlay shop-overlay--center" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" ref={dialog}>
        <header className="checkout-head">
          <div>
            <p className="eyebrow">Final step</p>
            <h2 id="checkout-title">Send your booking request.</h2>
            <p>No payment is taken here. The studio checks the date and sends the reservation details.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close checkout">×</button>
        </header>

        {!compatibility.ok ? (
          <div className="shop-error shop-error--panel" role="alert">
            {compatibility.reason}
          </div>
        ) : null}

        <div className="checkout-grid">
          <form className="checkout-form" onSubmit={submit}>
            <section className="checkout-section">
              <div className="section-heading">
                <span>01</span>
                <div><h3>How should we handle this?</h3><p>Choose the flow that matches every item in your cart.</p></div>
              </div>
              <div className="shop-segmented" role="group" aria-label="Booking type">
                <button
                  type="button"
                  className={type === 'pickup' ? 'active' : ''}
                  onClick={() => setType('pickup')}
                  disabled={!compatibility.pickup}
                >
                  Pickup
                </button>
                <button
                  type="button"
                  className={type === 'event' ? 'active' : ''}
                  onClick={() => setType('event')}
                  disabled={!compatibility.event}
                >
                  Event booking
                </button>
              </div>
              {hasPickupItems && hasEventItems ? (
                <p className="shop-hint">This cart has both pickup-only and event-only items. Check them out separately.</p>
              ) : null}
            </section>

            <section className="checkout-section">
              <div className="section-heading">
                <span>02</span>
                <div>
                  <h3>{type === 'pickup' ? 'Pickup details' : 'Event details'}</h3>
                  <p>{type === 'pickup' ? 'Choose a branch and the day you want to collect.' : 'Tell us where the team should set up.'}</p>
                </div>
              </div>

              {type === 'pickup' ? (
                <div className="checkout-fields">
                  <label className="shop-field">
                    <span>Pickup branch</span>
                    <select className="shop-input" value={form.branch_id} onChange={update('branch_id')} disabled={!branches.length}>
                      {!branches.length ? <option value="">Loading branches…</option> : null}
                      {branches.map((branch) => (
                        <option value={branch.id} key={branch.id}>{branch.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="shop-field">
                    <span>Pickup date</span>
                    <input className="shop-input" type="date" min={todayISO()} value={form.pickup_date} onChange={update('pickup_date')} />
                  </label>
                  <label className="shop-field">
                    <span>Preferred time <small>optional</small></span>
                    <input className="shop-input" type="time" value={form.pickup_time} onChange={update('pickup_time')} />
                  </label>
                </div>
              ) : (
                <div className="checkout-fields">
                  <label className="shop-field checkout-span-2">
                    <span>Event venue</span>
                    <input className="shop-input" value={form.venue} onChange={update('venue')} placeholder="e.g. Santuario de Batangas garden" />
                  </label>
                  <label className="shop-field checkout-span-2">
                    <span>Full service address</span>
                    <input className="shop-input" value={form.address} onChange={update('address')} placeholder="Street, barangay, city, province" />
                  </label>
                  <label className="shop-field">
                    <span>Event date</span>
                    <input className="shop-input" type="date" min={todayISO()} value={form.event_date} onChange={update('event_date')} />
                  </label>
                  <label className="shop-field">
                    <span>Start time</span>
                    <input className="shop-input" type="time" value={form.event_time} onChange={update('event_time')} />
                  </label>
                  <label className="shop-field">
                    <span>Duration (hours)</span>
                    <input className="shop-input" type="number" min="1" max="12" step="0.5" value={form.duration_hours} onChange={update('duration_hours')} />
                  </label>
                  <label className="shop-field">
                    <span>Branch <small>optional</small></span>
                    <select className="shop-input" value={form.branch_id} onChange={update('branch_id')}>
                      <option value="">Assign the nearest branch</option>
                      {branches.map((branch) => (
                        <option value={branch.id} key={branch.id}>{branch.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {branchesError ? <p className="shop-hint shop-hint--warning">{branchesError}</p> : null}
            </section>

            <section className="checkout-section">
              <div className="section-heading">
                <span>03</span>
                <div><h3>Anything we should know?</h3><p>Theme, sizes, call time, or design notes.</p></div>
              </div>
              <label className="shop-field">
                <span>Notes <small>optional</small></span>
                <textarea className="shop-input" rows="3" value={form.notes} onChange={update('notes')} maxLength="2000" placeholder="Tell the studio about your celebration." />
              </label>
            </section>

            {error ? <p className="shop-error" role="alert">{error}</p> : null}
            <div className="checkout-actions">
              <button className="shop-button" type="button" onClick={onClose} disabled={busy}>Back to cart</button>
              <button className="shop-button shop-button--primary" type="submit" disabled={busy || !compatibility.ok || !canSubmitRole}>
                {busy ? 'Sending request…' : 'Send booking request'}
              </button>
            </div>
            {!canSubmitRole ? (
              <p className="shop-hint shop-hint--warning">
                This account manages the studio. New customer requests need a customer account.
              </p>
            ) : null}
          </form>

          <aside className="checkout-summary" aria-label="Booking summary">
            <h3>Your selection</h3>
            <div className="checkout-lines">
              {cart.map((line) => (
                <div className="checkout-line" key={line.key}>
                  <div>
                    <strong>{line.name}</strong>
                    <span>
                      {line.pricing_mode === 'area'
                        ? `${line.length_ft} × ${line.height_ft} ${line.dimension_unit || 'ft'}`
                        : `Qty ${line.qty}`}
                    </span>
                  </div>
                  <span>{money(line.estimate)}</span>
                </div>
              ))}
            </div>
            <div className="checkout-total">
              <span>Estimated total</span>
              <strong>{money(estimate)}</strong>
            </div>
            <p className="shop-hint">The studio confirms the final price and reservation fee after checking the calendar.</p>
            <div className="checkout-assurance">
              <span aria-hidden="true">✦</span>
              <p>Your cart stays saved if you need to step away. Prices are recalculated securely on the server.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
