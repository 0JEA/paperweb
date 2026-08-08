// React binding. A separate entry point so the core stays dependency-free and a
// vanilla page never pulls React in.
//
//   import { PaperSurface } from 'paperweb/react';
//   <PaperSurface preset="paper" className="card">…</PaperSurface>
//
// Written with createElement rather than JSX so the file needs no build step,
// matching the rest of the library.

import { useEffect, useRef, createElement } from 'react';
import { Paper } from './paper.js';

/**
 * Bind a Paper to a ref'd element for the life of the component.
 *
 * Options that change the *identity* of the surface (preset, content mode,
 * light mode) rebuild the instance. Parameter patches do not: they go through
 * `set()`, which only re-runs the affected passes. Getting that split wrong is
 * the difference between a smooth colour tweak and a full teardown per keystroke.
 *
 * @param {React.RefObject<HTMLElement>} ref
 * @param {object} [opts]
 * @returns {React.MutableRefObject<Paper|null>}
 */
export function usePaper(ref, opts = {}) {
  const paper = useRef(null);
  const { preset, content, light, dpi, maxDpr, watch, lazy, retain, onError, params } = opts;

  // Rebuild on identity changes only.
  useEffect(() => {
    if (!ref.current) return undefined;
    const p = new Paper(ref.current, {
      preset, content, light, dpi, maxDpr, watch, lazy, retain, onError, params,
    });
    paper.current = p;
    return () => { p.destroy(); paper.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, preset, content, light, dpi, maxDpr, watch, lazy, retain]);

  // Params flow through set(). Serialised for the dependency check because a
  // caller writing `params={{ tone: { duotone: 0.6 } }}` inline creates a new
  // object every render, and comparing by reference would re-render forever.
  const paramsKey = params ? JSON.stringify(params) : '';
  useEffect(() => {
    if (paper.current && params) paper.current.set(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  return paper;
}

/**
 * A div with a paper surface behind its children.
 *
 * Every prop that is not a paperweb option is forwarded to the div, so
 * className, style, id, event handlers and ARIA attributes all work normally.
 */
export function PaperSurface(props) {
  const {
    preset, content, light, dpi, maxDpr, watch, lazy, retain, onError, params,
    as = 'div', children, ...rest
  } = props;
  const ref = useRef(null);
  usePaper(ref, { preset, content, light, dpi, maxDpr, watch, lazy, retain, onError, params });
  return createElement(as, { ...rest, ref }, children);
}
