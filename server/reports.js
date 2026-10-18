export const BOOKING_STATUSES = ['pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled'];

function dateInRange(value, from, to) {
  const day = String(value || '').slice(0, 10);
  return day >= from && day <= to;
}

export function buildReport(bookings, users, from, to) {
  const created = bookings.filter((booking) => dateInRange(booking.created_at, from, to));
  const userMap = new Map(users.map((user) => [user.id, user]));
  const activeStatuses = new Set(['pending', 'confirmed', 'in_progress', 'ready']);
  const byStatus = Object.fromEntries(BOOKING_STATUSES.map((status) => [status, 0]));
  const byService = new Map();
  const byMethod = new Map();

  for (const booking of bookings) {
    byStatus[booking.status] = (byStatus[booking.status] || 0) + 1;
  }

  const revenueCollected = bookings
    .filter(
      (booking) =>
        booking.payment_status !== 'refunded' &&
        Number(booking.amount_paid) > 0 &&
        booking.paid_at &&
        dateInRange(booking.paid_at, from, to)
    )
    .reduce((sum, booking) => sum + Number(booking.amount_paid || 0), 0);

  const outstanding = bookings
    .filter((booking) => activeStatuses.has(booking.status))
    .reduce(
      (sum, booking) => sum + Math.max(0, Number(booking.total || 0) - Number(booking.amount_paid || 0)),
      0
    );

  for (const booking of created) {
    for (const item of booking.items || []) {
      const key = item.name;
      const current = byService.get(key) || { name: key, units: 0, revenue: 0 };
      current.units += Number(item.pricing_mode === 'area' ? item.area_sqft : item.qty) || 0;
      current.revenue += Number(item.line_total) || 0;
      byService.set(key, current);
    }
  }

  for (const booking of bookings) {
    if (
      booking.payment_status !== 'refunded' &&
      Number(booking.amount_paid) > 0 &&
      booking.paid_at &&
      dateInRange(booking.paid_at, from, to)
    ) {
      const key = booking.payment_method || 'Not recorded';
      byMethod.set(key, (byMethod.get(key) || 0) + Number(booking.amount_paid));
    }
  }

  const staffWorkload = users
    .filter((user) => user.role === 'staff')
    .map((user) => {
      const assigned = bookings.filter((booking) => booking.staff_id === user.id);
      return {
        name: user.name,
        active: assigned.filter((booking) => activeStatuses.has(booking.status)).length,
        completed: assigned.filter((booking) => booking.status === 'completed').length,
      };
    });

  return {
    period: { from, to, generated_at: new Date().toISOString() },
    summary: {
      bookings: created.length,
      completed: created.filter((booking) => booking.status === 'completed').length,
      revenue_collected: Math.round(revenueCollected),
      outstanding: Math.round(outstanding),
      average_booking: created.length
        ? Math.round(created.reduce((sum, booking) => sum + Number(booking.total || 0), 0) / created.length)
        : 0,
    },
    by_status: BOOKING_STATUSES.map((status) => ({ status, count: byStatus[status] || 0 })),
    by_service: [...byService.values()].sort((a, b) => b.revenue - a.revenue),
    by_method: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })).sort(
      (a, b) => b.amount - a.amount
    ),
    staff: staffWorkload,
    created_bookings: created.map((booking) => ({
      ref: booking.ref,
      event_date: booking.event_date,
      customer: userMap.get(booking.customer_id)?.name || 'Customer',
      status: booking.status,
      payment_status: booking.payment_status,
      total: Number(booking.total || 0),
      amount_paid: Number(booking.amount_paid || 0),
      items: (booking.items || []).map((item) => item.name).join('; '),
    })),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  // Guard against spreadsheet formula injection before quoting.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function reportCsv(report) {
  const { period, summary, created_bookings: rows } = report;
  const lines = [
    `"Precious Moments operations report"`,
    `"From",${csvCell(period.from)},"To",${csvCell(period.to)}`,
    `"Generated",${csvCell(period.generated_at)}`,
    '',
    `"Bookings created",${summary.bookings}`,
    `"Completed",${summary.completed}`,
    `"Payments recorded",${summary.revenue_collected}`,
    `"Outstanding balance",${summary.outstanding}`,
    `"Average booking",${summary.average_booking}`,
    '',
    '"Reference","Event date","Customer","Status","Payment status","Total","Paid","Items"',
    ...rows.map((row) =>
      [
        row.ref,
        row.event_date,
        row.customer,
        row.status,
        row.payment_status,
        row.total,
        row.amount_paid,
        row.items,
      ]
        .map(csvCell)
        .join(',')
    ),
  ];
  return `\ufeff${lines.join('\r\n')}\r\n`;
}
