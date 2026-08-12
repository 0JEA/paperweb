// paperweb: paperlab's paper-rendering pipeline, applied to DOM elements.
//
//   import { Paper } from 'paperweb';
//   new Paper(document.querySelector('.card'), { preset: 'paper' });
//
// or, with no per-element JavaScript at all:
//
//   <div data-paper="worn">…</div>
//   <script type="module">
//     import { scan } from 'paperweb'; scan();
//   </script>

export { Paper, destroyAll, surfaces } from './paper.js';
export { scan, unscan, boundTo } from './scan.js';
export { presets, presetNames, preset } from './presets.js';
export { defaults, resolve, merge, pxPerMm, pxPerPt } from './params.js';
export { kmConstants } from './km.js';
export { capabilities } from './gl/context.js';
export { destroyPrograms } from './pipeline.js';
export { drainPool } from './gl/fbo.js';
