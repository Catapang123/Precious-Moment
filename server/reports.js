/**
 * Reporting: turn raw bookings into the numbers the owner needs, then into a
 * CSV or PDF that can be filed or sent on.
 *
 * Used by `/api/reports`, `/api/reports.csv`, `/api/reports.pdf`, `npm run
 * report`, and the scheduled GitHub Action. The same builder runs everywhere so
 * the emailed report and the in-app report can never disagree.
 */
import { DEPLOYMENT_LABELS, DEPLOYMENT_STATUSES, assignedUnitsOf, deploymentStatusOf } from './logistics.js';

export const BOOKING_STATUSES = ['pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled'];

function dateInRange(value, from, to) {
  const day = String(value || '').slice(0, 10);
  return day >= from && day <= to;
}

function weekStart(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = (date.getUTCDay() + 6) % 7; // Monday-based week.
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function trendBuckets(bookings, from, to) {
  const buckets = [];
  const byWeek = new Map();
  for (let start = weekStart(from); start <= to; start = addDays(start, 7)) {
    const row = { week_start: start, bookings: 0, revenue: 0 };
    buckets.push(row);
    byWeek.set(start, row);
  }
  for (const booking of bookings) {
    if (dateInRange(booking.created_at, from, to)) {
      const row = byWeek.get(weekStart(booking.created_at));
      if (row) row.bookings += 1;
    }
    if (
      booking.payment_status !== 'refunded' &&
      Number(booking.amount_paid) > 0 &&
      booking.paid_at &&
      dateInRange(booking.paid_at, from, to)
    ) {
      const row = byWeek.get(weekStart(booking.paid_at));
      if (row) row.revenue += Number(booking.amount_paid);
    }
  }
  return buckets.map((row) => ({ ...row, revenue: Math.round(row.revenue) }));
}

/**
 * Aggregates bookings for an inclusive date range.
 *
 * Two different windows are in play: bookings created counts by `created_at`,
 * while money counts by `paid_at`. That is why a payment received this month for
 * last month's event still appears in this month's revenue.
 */
export function buildReport(bookings, users, from, to, branches = []) {
  const created = bookings.filter((booking) => dateInRange(booking.created_at, from, to));
  const userMap = new Map(users.map((user) => [user.id, user]));
  const branchMap = new Map((branches || []).map((branch) => [branch.id, branch]));
  const activeStatuses = new Set(['pending', 'confirmed', 'in_progress', 'ready']);
  const byStatus = Object.fromEntries(BOOKING_STATUSES.map((status) => [status, 0]));
  const byService = new Map();
  const byMethod = new Map();
  const byBranch = new Map();
  const byDeployment = Object.fromEntries(DEPLOYMENT_STATUSES.map((status) => [status, 0]));

  // Status counts describe the same bookings as summary.bookings. An all-time
  // status table inside a one-month report is a data-integrity bug, not a
  // separate metric.
  for (const booking of created) {
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
    const branchKey = booking.branch_id || 'unassigned';
    const branch = branchMap.get(booking.branch_id);
    const branchRow = byBranch.get(branchKey) || {
      branch_id: booking.branch_id || null,
      name: branch ? branch.name : 'Needs review',
      bookings: 0,
      completed: 0,
      value: 0,
    };
    branchRow.bookings += 1;
    branchRow.value += Number(booking.total || 0);
    if (booking.status === 'completed') branchRow.completed += 1;
    byBranch.set(branchKey, branchRow);
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

  // Deployment stats follow the calendar period, not the creation date: a
  // booking created last month for next week's event belongs on the operations
  // graph for next week.
  const scheduledInPeriod = bookings.filter(
    (booking) =>
      booking.booking_type === 'event' &&
      booking.status !== 'cancelled' &&
      dateInRange(booking.event_date, from, to)
  );
  for (const booking of scheduledInPeriod) {
    const status = deploymentStatusOf(booking);
    byDeployment[status] = (byDeployment[status] || 0) + 1;
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
    by_method: [...byMethod.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    by_branch: [...byBranch.values()].sort((a, b) => b.value - a.value),
    by_deployment: DEPLOYMENT_STATUSES.map((status) => ({
      status,
      label: DEPLOYMENT_LABELS[status],
      count: byDeployment[status] || 0,
    })),
    logistics: {
      events_in_period: scheduledInPeriod.length,
      assigned: scheduledInPeriod.filter((booking) => assignedUnitsOf(booking).length > 0).length,
      unassigned: scheduledInPeriod.filter((booking) => deploymentStatusOf(booking) === 'unassigned').length,
      collected: scheduledInPeriod.filter((booking) => deploymentStatusOf(booking) === 'collected').length,
      units_committed: new Set(scheduledInPeriod.flatMap((booking) => assignedUnitsOf(booking))).size,
      setups: scheduledInPeriod.filter((booking) => booking.setup_date).length,
      pickups: scheduledInPeriod.filter((booking) => booking.pickup_schedule_date).length,
    },
    trend: trendBuckets(bookings, from, to),
    staff: staffWorkload,
    created_bookings: created.map((booking) => ({
      ref: booking.ref,
      event_date: booking.event_date,
      customer: userMap.get(booking.customer_id)?.name || 'Customer',
      branch: branchMap.get(booking.branch_id)?.name || 'Needs review',
      status: booking.status,
      payment_status: booking.payment_status,
      deployment_status: deploymentStatusOf(booking),
      assigned_units: assignedUnitsOf(booking),
      setup_date: booking.setup_date || '',
      setup_time: booking.setup_time || '',
      pickup_schedule_date: booking.pickup_schedule_date || '',
      pickup_schedule_time: booking.pickup_schedule_time || '',
      total: Number(booking.total || 0),
      amount_paid: Number(booking.amount_paid || 0),
      items: (booking.items || []).map((item) => item.name).join('; '),
    })),
  };
}

/**
 * Quotes one CSV cell. A leading =, +, -, or @ is prefixed with an apostrophe so
 * a crafted customer name cannot become a spreadsheet formula on open.
 */
function csvCell(value) {
  let text = String(value ?? '');
  // Guard against spreadsheet formula injection before quoting.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Renders a built report as CSV, with a BOM so Excel reads it as UTF-8. */
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
    '"Reference","Event date","Customer","Branch","Status","Payment status","Deployment status","Assigned units","Setup","Pickup schedule","Total","Paid","Items"',
    ...rows.map((row) =>
      [
        row.ref,
        row.event_date,
        row.customer,
        row.branch,
        row.status,
        row.payment_status,
        row.deployment_status,
        (row.assigned_units || []).join('; '),
        [row.setup_date, row.setup_time].filter(Boolean).join(' '),
        [row.pickup_schedule_date, row.pickup_schedule_time].filter(Boolean).join(' '),
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

/* ---------- PDF export ---------- */

const PDF_WIDTH = 612;
const PAGE_HEIGHT = 2200;

function pdfSafe(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/₱/g, 'PHP ')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function pdfText(x, y, size, value, { color = [0.16, 0.08, 0.12], bold = false } = {}) {
  return `BT ${color.join(' ')} rg /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfSafe(value)}) Tj ET`;
}

function pdfRect(x, y, width, height, color) {
  return `${color.join(' ')} rg ${x} ${y} ${width} ${height} re f`;
}

function pdfLine(x1, y1, x2, y2, color = [0.88, 0.82, 0.84]) {
  return `${color.join(' ')} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`;
}

/**
 * A dependency-free PDF for the live report. It is intentionally a compact
 * operational summary (not a pixel copy of the dashboard), and the same report
 * JSON powers the on-screen graph, CSV, PNG, and PDF.
 */
export function reportPdf(report) {
  const ops = [];
  let y = PAGE_HEIGHT - 64;
  const margin = 48;
  const contentWidth = PDF_WIDTH - margin * 2;
  const rose = [0.78, 0.17, 0.36];
  const ink = [0.16, 0.08, 0.12];
  const soft = [0.44, 0.37, 0.41];
  const blush = [0.98, 0.93, 0.94];

  ops.push(pdfText(margin, y, 22, 'PRECIOUS MOMENTS', { bold: true, color: rose }));
  y -= 20;
  ops.push(pdfText(margin, y, 11, 'Operational report', { color: soft }));
  ops.push(
    pdfText(
      PDF_WIDTH - margin - 190,
      y + 20,
      9,
      `${report.period.from} to ${report.period.to}`,
      { color: soft }
    )
  );
  y -= 30;

  ops.push(pdfText(margin, y, 9, 'BOOKINGS', { bold: true, color: soft }));
  ops.push(pdfText(margin + 120, y, 9, 'COMPLETED', { bold: true, color: soft }));
  ops.push(pdfText(margin + 240, y, 9, 'PAYMENTS', { bold: true, color: soft }));
  ops.push(pdfText(margin + 360, y, 9, 'OUTSTANDING', { bold: true, color: soft }));
  y -= 24;
  ops.push(pdfText(margin, y, 18, report.summary.bookings, { bold: true, color: ink }));
  ops.push(pdfText(margin + 120, y, 18, report.summary.completed, { bold: true, color: ink }));
  ops.push(pdfText(margin + 240, y, 14, `PHP ${report.summary.revenue_collected.toLocaleString('en-PH')}`, { bold: true, color: ink }));
  ops.push(pdfText(margin + 360, y, 14, `PHP ${report.summary.outstanding.toLocaleString('en-PH')}`, { bold: true, color: ink }));
  y -= 36;

  ops.push(pdfLine(margin, y, PDF_WIDTH - margin, y));
  y -= 28;
  ops.push(pdfText(margin, y, 13, 'Bookings and payments by week', { bold: true, color: ink }));
  y -= 8;
  const trend = report.trend || [];
  const chartHeight = 130;
  const chartTop = y;
  const chartBottom = chartTop - chartHeight;
  ops.push(pdfRect(margin, chartBottom, contentWidth, chartHeight, [0.99, 0.97, 0.97]));
  const maxRevenue = Math.max(1, ...trend.map((row) => Number(row.revenue) || 0));
  const maxBookings = Math.max(1, ...trend.map((row) => Number(row.bookings) || 0));
  const slot = trend.length ? contentWidth / trend.length : contentWidth;
  trend.forEach((row, index) => {
    const x = margin + index * slot + Math.max(1, slot * 0.15);
    const barWidth = Math.max(2, slot * 0.7);
    const revenueHeight = (Number(row.revenue) / maxRevenue) * (chartHeight - 42);
    const bookingHeight = (Number(row.bookings) / maxBookings) * (chartHeight - 42);
    ops.push(pdfRect(x, chartBottom + 20, barWidth / 2, revenueHeight, [0.78, 0.17, 0.36]));
    ops.push(pdfRect(x + barWidth / 2 + 1, chartBottom + 20, barWidth / 2, bookingHeight, [0.89, 0.67, 0.75]));
    if (index === 0 || index === trend.length - 1 || index % Math.max(1, Math.ceil(trend.length / 6)) === 0) {
      ops.push(pdfText(x, chartBottom + 7, 6, row.week_start.slice(5), { color: soft }));
    }
  });
  ops.push(pdfText(margin, chartTop - 10, 7, 'rose: payments   blush: bookings', { color: soft }));
  y = chartBottom - 28;

  ops.push(pdfText(margin, y, 13, 'Branch performance', { bold: true, color: ink }));
  y -= 18;
  const branches = report.by_branch || [];
  if (!branches.length) {
    ops.push(pdfText(margin, y, 9, 'No bookings were created in this period.', { color: soft }));
    y -= 18;
  } else {
    for (const row of branches.slice(0, 8)) {
      ops.push(pdfText(margin, y, 9, row.name, { color: ink }));
      ops.push(pdfText(margin + 240, y, 9, `${row.bookings} bookings · ${row.completed} completed`, { color: soft }));
      ops.push(
        pdfText(
          margin + 420,
          y,
          9,
          `PHP ${Number(row.value || 0).toLocaleString('en-PH')}`,
          { bold: true, color: ink }
        )
      );
      y -= 17;
    }
  }

  y -= 12;
  ops.push(pdfText(margin, y, 13, 'Deployment and schedule', { bold: true, color: ink }));
  y -= 18;
  ops.push(
    pdfText(
      margin,
      y,
      9,
      `${report.logistics.events_in_period} events · ${report.logistics.assigned} with units · ${report.logistics.unassigned} unassigned · ${report.logistics.setups} setups · ${report.logistics.pickups} pickups`,
      { color: soft }
    )
  );
  y -= 16;
  ops.push(
    pdfText(
      margin,
      y,
      9,
      (report.by_deployment || []).map((row) => `${row.label}: ${row.count}`).join(' · '),
      { color: ink }
    )
  );
  y -= 30;

  ops.push(pdfText(margin, y, 13, 'Bookings created in this period', { bold: true, color: ink }));
  y -= 20;
  ops.push(pdfText(margin, y, 7, 'REFERENCE', { bold: true, color: soft }));
  ops.push(pdfText(margin + 74, y, 7, 'EVENT', { bold: true, color: soft }));
  ops.push(pdfText(margin + 130, y, 7, 'CUSTOMER / BRANCH', { bold: true, color: soft }));
  ops.push(pdfText(margin + 330, y, 7, 'STATUS', { bold: true, color: soft }));
  ops.push(pdfText(margin + 420, y, 7, 'DEPLOYMENT', { bold: true, color: soft }));
  ops.push(pdfText(PDF_WIDTH - margin - 42, y, 7, 'TOTAL', { bold: true, color: soft }));
  y -= 6;
  ops.push(pdfLine(margin, y, PDF_WIDTH - margin, y));
  y -= 14;

  const rows = report.created_bookings || [];
  for (const row of rows.slice(0, 30)) {
    ops.push(pdfText(margin, y, 8, row.ref, { color: ink }));
    ops.push(pdfText(margin + 74, y, 8, row.event_date, { color: soft }));
    ops.push(pdfText(margin + 130, y, 8, `${row.customer} · ${row.branch}`.slice(0, 42), { color: ink }));
    ops.push(pdfText(margin + 330, y, 8, row.status.replace('_', ' '), { color: soft }));
    ops.push(pdfText(margin + 420, y, 8, row.deployment_status.replace('_', ' '), { color: soft }));
    ops.push(pdfText(PDF_WIDTH - margin - 42, y, 8, `PHP ${Number(row.total).toLocaleString('en-PH')}`, { color: ink }));
    y -= 15;
    if (y < 38) break;
  }
  if (rows.length > 30) {
    ops.push(pdfText(margin, y, 8, `... plus ${rows.length - 30} more rows in the CSV export.`, { color: soft }));
  }

  ops.push(pdfText(margin, 20, 7, `Generated ${report.period.generated_at} · Precious Moments live operational records`, { color: soft }));

  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(`${content}\n`, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];

  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
