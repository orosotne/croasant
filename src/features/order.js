// Order-ahead card. Entirely local: nothing here makes a network request.
// Reserving only renders a confirmation that says so.

import { fmtEuro, pad, setText } from '../lib/util.js';

export const PASTRIES = [
  { id: 'pro', name: 'Croissant Pro', price: 4.2 },
  { id: 'promax', name: 'Croissant Pro Max', price: 5.6 },
  { id: 'air', name: 'Pain au Chocolat Air', price: 3.9 },
  { id: 'ultra', name: 'Kouign-Amann Ultra', price: 4.8 },
];

const MAX_QTY = 12;
const OPEN = { h: 7, m: 0 };
const CLOSE = { h: 14, m: 0 };
const SLOT_MIN = 30;
const LEAD_MIN = 20; // a slot must be at least this far away to be bookable
const FIRST_BATCH = { h: 6, m: 15 };
const LAST_BATCH = { h: 13, m: 45 };
const BATCH_EVERY = 45; // minutes

const at = (base, { h, m }, dayOffset = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function slotsFrom(now) {
  for (const day of [0, 1]) {
    const slots = [];
    for (let t = at(now, OPEN, day); t <= at(now, CLOSE, day); t = new Date(t.getTime() + SLOT_MIN * 60000)) {
      slots.push({ time: t, ok: t.getTime() - now.getTime() >= LEAD_MIN * 60000 });
    }
    if (slots.some((s) => s.ok)) return { day, slots };
  }
  return { day: 1, slots: [] };
}

function nextBatch(now) {
  for (const day of [0, 1]) {
    let n = 1;
    for (let t = at(now, FIRST_BATCH, day); t <= at(now, LAST_BATCH, day); t = new Date(t.getTime() + BATCH_EVERY * 60000), n++) {
      if (t > now) return { time: t, number: n };
    }
  }
  return { time: at(now, FIRST_BATCH, 1), number: 1 };
}

export function initOrder(root) {
  const qty = Object.fromEntries(PASTRIES.map((p) => [p.id, p.id === 'pro' ? 2 : 0]));
  const rows = Object.fromEntries([...root.querySelectorAll('[data-item]')].map((el) => [el.dataset.item, el]));
  const slotBox = root.querySelector('[data-slots]');
  const slotDay = root.querySelector('[data-slot-day]');
  const countdown = root.querySelector('[data-countdown]');
  const batchLabel = root.querySelector('[data-batch]');
  const totalEl = root.querySelector('[data-total]');
  const countEl = root.querySelector('[data-count]');
  const button = root.querySelector('[data-reserve]');
  const receipt = root.querySelector('[data-receipt]');
  let slot = null;
  let reserved = false;

  const renderSlots = () => {
    const { day, slots } = slotsFrom(new Date());
    setText(slotDay, day === 0 ? 'Today' : 'Tomorrow');
    const keep = slot && slots.find((s) => s.ok && hhmm(s.time) === slot);
    slot = keep ? slot : hhmm(slots.find((s) => s.ok)?.time ?? new Date());
    slotBox.replaceChildren(
      ...slots.map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot mono';
        b.textContent = hhmm(s.time);
        b.disabled = !s.ok;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(hhmm(s.time) === slot));
        b.addEventListener('click', () => {
          slot = hhmm(s.time);
          slotBox.querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
          invalidate();
        });
        return b;
      }),
    );
  };

  const invalidate = () => {
    if (reserved) {
      reserved = false;
      receipt.hidden = true;
      button.classList.remove('is-done');
    }
    render();
  };

  const render = () => {
    let items = 0;
    let total = 0;
    for (const p of PASTRIES) {
      const n = qty[p.id];
      items += n;
      total += n * p.price;
      const row = rows[p.id];
      setText(row.querySelector('[data-qty]'), String(n));
      row.querySelector('[data-dec]').disabled = n <= 0;
      row.querySelector('[data-inc]').disabled = n >= MAX_QTY;
      row.classList.toggle('is-zero', n === 0);
    }
    setText(totalEl, fmtEuro(total));
    setText(countEl, `${items} ${items === 1 ? 'pastry' : 'pastries'}`);
    button.disabled = items === 0 || !slot;
    setText(button.querySelector('span'), reserved ? 'Reserved · nothing was sent' : items ? `Reserve for ${slot}` : 'Add a pastry to reserve');
    return { items, total };
  };

  for (const p of PASTRIES) {
    const row = rows[p.id];
    row.querySelector('[data-dec]').addEventListener('click', () => {
      qty[p.id] = Math.max(0, qty[p.id] - 1);
      invalidate();
    });
    row.querySelector('[data-inc]').addEventListener('click', () => {
      qty[p.id] = Math.min(MAX_QTY, qty[p.id] + 1);
      invalidate();
    });
  }

  button.addEventListener('click', () => {
    const { items, total } = render();
    if (!items) return;
    reserved = true;
    const code = `LMN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const lines = PASTRIES.filter((p) => qty[p.id]).map((p) => `${qty[p.id]} × ${p.name}`).join(', ');
    receipt.querySelector('[data-receipt-code]').textContent = code;
    receipt.querySelector('[data-receipt-lines]').textContent = `${lines} · pickup ${slotDay.textContent.toLowerCase()} ${slot} · ${fmtEuro(total)}`;
    receipt.hidden = false;
    button.classList.add('is-done');
    render();
  });

  const tick = () => {
    const now = new Date();
    const { time, number } = nextBatch(now);
    const s = Math.max(0, Math.round((time - now) / 1000));
    setText(countdown, `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`);
    setText(batchLabel, `Batch ${pad(number)} · out at ${hhmm(time)}`);
  };

  renderSlots();
  render();
  tick();
  setInterval(tick, 1000);
  setInterval(() => {
    renderSlots();
    render();
  }, 60000);

  return {
    add(id) {
      qty[id] = Math.min(MAX_QTY, (qty[id] || 0) + 1);
      invalidate();
      const row = rows[id];
      row.classList.remove('is-bumped');
      void row.offsetWidth;
      row.classList.add('is-bumped');
    },
  };
}
