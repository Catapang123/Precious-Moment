/**
 * Structured cancellation reasons.
 *
 * One list per actor: customers explain why they no longer need the booking,
 * the branch explains why the studio cannot deliver it. The server is the only
 * authority on what a valid reason is; the browser receives these lists from
 * `/api/cancellation-reasons` so the labels never drift between the two.
 */

export const CUSTOMER_CANCELLATION_REASONS = [
  { code: 'change_of_plans', label: 'Change of plans' },
  { code: 'incorrect_details', label: 'Incorrect booking details' },
  { code: 'wrong_service', label: 'Selected the wrong service or product' },
  { code: 'other_provider', label: 'Found another service provider' },
  { code: 'budget', label: 'Budget or financial constraints' },
  { code: 'event_postponed', label: 'Event postponed' },
  { code: 'event_cancelled', label: 'Event cancelled' },
  { code: 'no_longer_needed', label: 'No longer need the service' },
  { code: 'by_mistake', label: 'Booking made by mistake' },
  { code: 'other', label: 'Other (please specify)', requires_details: true },
];

export const BRANCH_CANCELLATION_REASONS = [
  { code: 'service_unavailable', label: 'Requested service is unavailable' },
  { code: 'out_of_stock', label: 'Product or material is out of stock' },
  { code: 'schedule_unavailable', label: 'Branch cannot accommodate the requested schedule' },
  { code: 'scheduling_conflict', label: 'Scheduling conflict' },
  { code: 'incomplete_info', label: 'Incorrect or incomplete booking information' },
  { code: 'missing_info', label: 'Customer did not provide the required information' },
  { code: 'no_response', label: 'Customer failed to respond or confirm' },
  { code: 'payment_issue', label: 'Payment-related issue' },
  { code: 'operational_issue', label: 'Operational or technical issue' },
  { code: 'other', label: 'Other (please specify)', requires_details: true },
];

/** Staff never cancel; they get the branch list only to render a read-only view. */
export function cancellationReasonsFor(role) {
  return role === 'customer' ? CUSTOMER_CANCELLATION_REASONS : BRANCH_CANCELLATION_REASONS;
}

export function cancellationLabel(role, code) {
  const entry = cancellationReasonsFor(role).find((item) => item.code === code);
  return entry ? entry.label : '';
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * Validates the reason submitted with a cancellation.
 *
 * `role` is 'customer' or 'branch'. Returns the canonical label plus the
 * trimmed explanation, so the caller never stores a client-supplied label.
 */
export function validateCancellationReason({ role, reason, details }) {
  const list = cancellationReasonsFor(role === 'customer' ? 'customer' : 'branch');
  const entry = list.find((item) => item.code === String(reason || ''));
  if (!entry) throw fail('Choose a cancellation reason.');

  const text = String(details || '').trim();
  if (text.length > 1000) throw fail('The cancellation details are too long.');
  if (entry.requires_details && text.length < 5) {
    throw fail('Explain the reason for cancelling — at least a short sentence.');
  }

  return { code: entry.code, label: entry.label, details: text };
}
