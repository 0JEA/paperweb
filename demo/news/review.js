// Per-component review: yes / no plus a comment, on every component of a
// showcase page, submitted in one go.
//
// Eighty components is too many to describe in prose, and describing them is
// lossy anyway: a note attached to component 07 cannot be misread as being about
// 08. So the verdict lives next to the thing it judges.
//
// The control is appended to the component's SECTION, never inside the papered
// element. Anything inside would be snapshotted by content:'rasterize' and would
// have to fight the canvas for stacking order.

const STORE = `paperweb-review:${location.pathname}`;

/**
 * Find the components on this page.
 *
 * The four showcase pages were written independently and their markup differs
 * (section.bay, section.demo, section.sec, div.demo-head), so a selector would
 * have to be per-page and would rot. What they DO share is a two-digit index
 * marker on every component, which is also the identifier the reviewer uses when
 * they say "desk 07". Anchoring on the marker is both stable and the same key a
 * human would quote.
 */
function findComponents() {
  const marks = [...document.querySelectorAll('*')].filter((n) =>
    n.children.length === 0
    && /^\d{2}$/.test(n.textContent.trim())
    && +n.textContent.trim() >= 1 && +n.textContent.trim() <= 20
    && !n.closest('nav')
    && !n.closest('[class*="contents"],[class*="toc"],[id*="contents"]'));

  const byNumber = new Map();
  for (const m of marks) {
    const n = m.textContent.trim();
    if (byNumber.has(n)) continue;          // first occurrence wins
    const host = m.closest('section') || m.parentElement;
    const heading = host.querySelector('h2, h3');
    const title = (heading ? heading.textContent : '')
      .trim().replace(/\s+/g, ' ').replace(/^\d{2}\s*/, '') || `component ${n}`;
    byNumber.set(n, { n, title, section: host.closest('section') || host });
  }
  return [...byNumber.values()].sort((a, b) => a.n.localeCompare(b.n));
}

const css = `
.rv{margin:22px 0 4px;padding:13px 15px;border:1px solid #34323a;border-radius:8px;
    background:rgba(255,255,255,.025);display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;
    font:13px/1.5 ui-sans-serif,system-ui,sans-serif}
.rv-n{font:600 11px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.08em;color:#6f6a63;
      padding-top:7px;min-width:2.4em}
.rv-btns{display:flex;gap:7px}
.rv-btn{font:600 12px/1 ui-sans-serif,system-ui,sans-serif;padding:8px 15px;border-radius:6px;
        cursor:pointer;color:#a8a29a;background:transparent;border:1px solid #45424d}
.rv-btn:hover{border-color:#5e5a69;color:#d5d0c8}
.rv-btn:focus-visible{outline:2px solid #c8a06a;outline-offset:2px}
.rv-btn[aria-pressed="true"][data-v="yes"]{color:#9fd6a8;border-color:rgba(120,190,130,.6);
        background:rgba(120,190,130,.14)}
.rv-btn[aria-pressed="true"][data-v="no"]{color:#e0876a;border-color:rgba(210,120,100,.55);
        background:rgba(210,120,100,.12)}
.rv-c{flex:1 1 260px;min-width:0}
.rv-c textarea{width:100%;min-height:38px;resize:vertical;padding:8px 10px;border-radius:6px;
        border:1px solid #3d3a45;background:#141319;color:#e8e4dc;
        font:13px/1.5 ui-sans-serif,system-ui,sans-serif}
.rv-c textarea:focus{outline:2px solid #c8a06a;outline-offset:1px;border-color:#5e5a69}
.rv-c textarea::placeholder{color:#5d5850}
section:has(.rv-btn[aria-pressed="true"][data-v="no"]) .rv{border-color:rgba(210,120,100,.32)}
section:has(.rv-btn[aria-pressed="true"][data-v="yes"]) .rv{border-color:rgba(120,190,130,.28)}

#rvbar{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;gap:12px;align-items:center;
       flex-wrap:wrap;padding:12px clamp(12px,4vw,26px);background:rgba(11,10,13,.96);
       border-top:1px solid #34323a;backdrop-filter:blur(8px);
       font:12px/1.4 ui-monospace,Menlo,monospace;color:#a8a29a}
#rvcount{font-weight:600;color:#e8e4dc;min-width:16ch}
#rvbar button{font:600 12px/1 ui-sans-serif,system-ui,sans-serif;padding:9px 15px;border-radius:6px;
       cursor:pointer;color:#cfcac2;background:rgba(255,255,255,.05);border:1px solid #34323a}
#rvbar button:hover{background:rgba(255,255,255,.09)}
#rvbar button:focus-visible{outline:2px solid #c8a06a;outline-offset:2px}
#rvbar button.primary{color:#e5c79a;background:rgba(200,160,106,.16);border-color:rgba(200,160,106,.42)}
#rvnote{margin-left:auto;color:#7d776f}
#rvnote.bad{color:#e0876a}
body{padding-bottom:96px}
@media (max-width:640px){#rvnote{margin-left:0;width:100%}}
`;

function mount() {
  const items = findComponents();
  if (!items.length) return;

  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* first visit */ }

  const state = new Map();
  const persist = () => {
    const o = {};
    for (const [n, v] of state) o[n] = v;
    // Reviewing eighty components is long enough that losing it to a reload
    // would be unforgivable, so every keystroke is kept locally.
    try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* private mode */ }
    refresh();
  };

  for (const item of items) {
    const prev = saved[item.n] || { verdict: null, comment: '' };
    state.set(item.n, { ...prev, title: item.title });

    const row = document.createElement('div');
    row.className = 'rv';

    const num = document.createElement('span');
    num.className = 'rv-n';
    num.textContent = item.n;

    const btns = document.createElement('div');
    btns.className = 'rv-btns';
    const mk = (v, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rv-btn';
      b.dataset.v = v;
      b.textContent = label;
      b.setAttribute('aria-pressed', String(prev.verdict === v));
      b.setAttribute('aria-label', `${label} for component ${item.n}, ${item.title}`);
      b.addEventListener('click', () => {
        const cur = state.get(item.n);
        // Clicking the active verdict clears it, so a misclick is undoable.
        cur.verdict = cur.verdict === v ? null : v;
        for (const other of btns.children) {
          other.setAttribute('aria-pressed', String(other.dataset.v === cur.verdict));
        }
        persist();
      });
      return b;
    };
    btns.append(mk('yes', 'Yes'), mk('no', 'No'));

    const wrap = document.createElement('div');
    wrap.className = 'rv-c';
    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.value = prev.comment || '';
    ta.placeholder = `What works or does not about "${item.title}"`;
    ta.setAttribute('aria-label', `Comment on component ${item.n}, ${item.title}`);
    ta.addEventListener('input', () => {
      state.get(item.n).comment = ta.value;
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
      persist();
    });
    wrap.appendChild(ta);

    row.append(num, btns, wrap);
    item.section.appendChild(row);
  }

  // --- submit bar ---
  const bar = document.createElement('div');
  bar.id = 'rvbar';
  bar.innerHTML =
    '<span id="rvcount"></span>'
    + '<button type="button" id="rvnext">Next unanswered</button>'
    + '<button type="button" id="rvclear">Clear</button>'
    + '<button type="button" class="primary" id="rvsend">Submit review</button>'
    + '<span id="rvnote"></span>';
  document.body.appendChild(bar);

  const countEl = bar.querySelector('#rvcount');
  const noteEl = bar.querySelector('#rvnote');

  function refresh() {
    let yes = 0, no = 0, notes = 0;
    for (const v of state.values()) {
      if (v.verdict === 'yes') yes++;
      else if (v.verdict === 'no') no++;
      if (v.comment && v.comment.trim()) notes++;
    }
    countEl.textContent = `${yes} yes · ${no} no · ${items.length - yes - no} left · ${notes} notes`;
  }

  bar.querySelector('#rvnext').addEventListener('click', () => {
    const next = items.find((it) => !state.get(it.n).verdict);
    if (!next) { noteEl.textContent = 'all answered'; return; }
    next.section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    next.section.querySelector('.rv-btn')?.focus({ preventScroll: true });
  });

  bar.querySelector('#rvclear').addEventListener('click', () => {
    if (!confirm('Clear every verdict and comment on this page?')) return;
    localStorage.removeItem(STORE);
    location.reload();
  });

  bar.querySelector('#rvsend').addEventListener('click', async () => {
    const page = location.pathname.split('/').pop().replace('.html', '');
    const payload = {
      page,
      total: items.length,
      components: items.map((it) => {
        const v = state.get(it.n);
        return { n: it.n, title: it.title, verdict: v.verdict, comment: (v.comment || '').trim() };
      }),
    };
    noteEl.className = '';
    noteEl.textContent = 'saving…';
    try {
      const res = await fetch('/api/review', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const out = await res.json();
      noteEl.textContent = `saved to ${out.path.split('/').pop()}`;
    } catch (e) {
      // Opened from the filesystem, or the dev server is not running. Do not
      // pretend it saved: put it on the clipboard and say so.
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        noteEl.className = 'bad';
        noteEl.textContent = `no server (${e.message}); copied to clipboard instead`;
      } catch {
        noteEl.className = 'bad';
        noteEl.textContent = `could not save: ${e.message}. See the console.`;
        console.log(JSON.stringify(payload, null, 2));
      }
    }
  });

  refresh();
  if (Object.keys(saved).length) noteEl.textContent = 'restored from this browser';
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
else mount();
