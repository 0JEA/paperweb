// Keep/discard picker for the demo gallery.
//
// Wraps every paper surface with a toggle and collects the answers into a single
// submission, so a review pass over 35 surfaces produces one list instead of 35
// separate remarks.
//
// The toggle deliberately lives OUTSIDE the paper element rather than inside it.
// An inside control would be snapshotted by content:'rasterize' and baked into
// the sheet, and it would have to fight the canvas for stacking order. A sibling
// inside a wrapper has neither problem.

const registered = [];

/**
 * Wrap an element so it can be kept or discarded.
 * Call BEFORE binding a Paper to it: the wrap changes the element's parent, and
 * doing that after bind would fire the ResizeObserver for no reason.
 *
 * @param {HTMLElement} el
 * @param {string} label   what the reviewer is judging
 * @param {string} group   section heading, for grouping the submitted result
 */
export function registerSurface(el, label, group) {
  const wrap = document.createElement('div');
  wrap.className = 'pickwrap';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);

  const id = `s${registered.length}`;
  const bar = document.createElement('label');
  bar.className = 'pick';
  bar.htmlFor = id;

  // Built node by node rather than with innerHTML: `label` comes from page
  // text, and interpolating page text into markup is how an escaping bug turns
  // into script execution. textContent cannot.
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = true;
  const box = document.createElement('span');
  box.className = 'pick-box';
  box.setAttribute('aria-hidden', 'true');
  const state = document.createElement('span');
  state.className = 'pick-state';
  state.textContent = 'keep';
  const name = document.createElement('span');
  name.className = 'pick-name';
  name.textContent = label;
  bar.append(input, box, state, name);
  wrap.appendChild(bar);
  const entry = { id, label, group, el, wrap, input };
  registered.push(entry);

  input.addEventListener('change', () => {
    wrap.classList.toggle('discarded', !input.checked);
    state.textContent = input.checked ? 'keep' : 'discard';
    refresh();
  });

  return entry;
}

/** Label a surface from its own `.tag` text, falling back to a preset name. */
export function labelOf(el) {
  const tag = el.querySelector('.tag');
  if (tag) return tag.textContent.trim();
  return el.dataset.paper ? `preset "${el.dataset.paper}"` : 'surface';
}

// --- the submit bar ---------------------------------------------------------

let bar = null;
let counts = null;
let note = null;

function refresh() {
  if (!counts) return;
  const keep = registered.filter((r) => r.input.checked).length;
  counts.textContent = `${keep} keep · ${registered.length - keep} discard`;
}

function setAll(checked) {
  for (const r of registered) {
    r.input.checked = checked;
    r.input.dispatchEvent(new Event('change'));
  }
}

/** Build the fixed submit bar. Call once, after every surface is registered. */
export function mountSubmitBar(statusText) {
  bar = document.createElement('div');
  bar.id = 'pickbar';
  // Static markup only; statusText is set separately with textContent because
  // it can carry a driver-supplied WebGL failure string.
  bar.innerHTML =
    '<span id="pickcount"></span>' +
    '<span class="pickbar-sep"></span>' +
    '<button type="button" class="pickbtn" data-all="1">keep all</button>' +
    '<button type="button" class="pickbtn" data-all="0">discard all</button>' +
    '<button type="button" class="pickbtn primary" id="picksubmit">Submit selections</button>' +
    '<span id="picknote"></span>';
  document.body.appendChild(bar);
  counts = bar.querySelector('#pickcount');
  note = bar.querySelector('#picknote');
  note.textContent = statusText || '';

  for (const b of bar.querySelectorAll('[data-all]')) {
    b.addEventListener('click', () => setAll(b.dataset.all === '1'));
  }
  bar.querySelector('#picksubmit').addEventListener('click', submit);
  refresh();
}

export function setNote(text, ok = true) {
  if (!note) return;
  note.textContent = text;
  note.className = ok ? '' : 'fail';
}

async function submit() {
  const keep = registered.filter((r) => r.input.checked);
  const discard = registered.filter((r) => !r.input.checked);
  const shape = (r) => ({ group: r.group, label: r.label });
  const payload = {
    total: registered.length,
    keep: keep.map(shape),
    discard: discard.map(shape),
  };

  setNote('saving…');
  try {
    const res = await fetch('/api/selections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const out = await res.json();
    setNote(`saved ${keep.length} keep, ${discard.length} discard`);
    console.log('paperweb selections written to', out.path, payload);
  } catch (e) {
    // The demo is also usable straight off the filesystem, where there is no
    // server to post to. Fall back to a clipboard copy so the answers are not
    // lost, and say so rather than pretending it saved.
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setNote(`no server (${e.message}); copied to clipboard instead`, false);
    } catch {
      setNote(`could not save: ${e.message}. See the console.`, false);
    }
    console.log(text);
  }
}
