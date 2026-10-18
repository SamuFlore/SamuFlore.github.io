/* global module */

// Tip bubbles remain in the document so their semantics and styling stay tied
// to the tip text, while the active bubble is positioned against the viewport.
(function (root, factory) {
  'use strict';

  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  root.stellar = root.stellar || {};
  root.stellar.tip = api;
  if (!root.document) {
    return;
  }
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', function () {
      api.mount(root.document);
    }, { once: true });
  } else {
    api.mount(root.document);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (host) {
  const SELECTOR = '.tag-plugin.tip';
  const DEFAULT_GAP = 8;
  const DEFAULT_GUTTER = 8;
  const mounted = new Map();
  let activeState = null;
  let lifecycleBound = false;
  let runtimeDocument = null;
  let runtimeWindow = null;

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function rectMetrics(rect) {
    const source = rect || {};
    const left = finiteNumber(source.left, finiteNumber(source.x, 0));
    const top = finiteNumber(source.top, finiteNumber(source.y, 0));
    const rawWidth = finiteNumber(source.width, NaN);
    const rawHeight = finiteNumber(source.height, NaN);
    const right = finiteNumber(source.right, left + (Number.isFinite(rawWidth) ? rawWidth : 0));
    const bottom = finiteNumber(source.bottom, top + (Number.isFinite(rawHeight) ? rawHeight : 0));
    return {
      left: left,
      top: top,
      width: Math.max(0, Number.isFinite(rawWidth) ? rawWidth : right - left),
      height: Math.max(0, Number.isFinite(rawHeight) ? rawHeight : bottom - top),
      right: right,
      bottom: bottom
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function calculateTipBubblePosition(anchorRect, bubbleRect, viewport, options) {
    const anchor = rectMetrics(anchorRect);
    const bubble = rectMetrics(bubbleRect);
    const visibleArea = rectMetrics(viewport);
    const settings = options || {};
    const gap = Math.max(0, finiteNumber(settings.gap, DEFAULT_GAP));
    const gutter = Math.max(0, finiteNumber(
      settings.gutter,
      finiteNumber(settings.viewportPadding, DEFAULT_GUTTER)
    ));

    const centeredLeft = anchor.left + (anchor.width - bubble.width) / 2;
    const maxLeft = Math.max(gutter, visibleArea.width - gutter - bubble.width);
    const left = clamp(centeredLeft, gutter, maxLeft);

    const aboveTop = anchor.top - gap - bubble.height;
    const belowTop = anchor.bottom + gap;
    const preferredTop = aboveTop >= 0 ? aboveTop : belowTop;
    const maxTop = Math.max(0, visibleArea.height - bubble.height);
    const top = clamp(preferredTop, 0, maxTop);

    return { left: left, top: top };
  }

  function resolveDocument(root) {
    if (root && root.nodeType === 9) {
      return root;
    }
    if (root && root.ownerDocument) {
      return root.ownerDocument;
    }
    return host && host.document ? host.document : null;
  }

  function resolveWindow(doc) {
    return (doc && doc.defaultView) || host || null;
  }

  function viewportDimension(primary, secondary, fallback) {
    const first = finiteNumber(primary, NaN);
    if (first > 0) {
      return first;
    }
    const second = finiteNumber(secondary, NaN);
    if (second > 0) {
      return second;
    }
    return Math.max(0, finiteNumber(fallback, 0));
  }

  function getViewport(doc, win) {
    const visualViewport = win && win.visualViewport;
    const documentElement = doc && doc.documentElement;
    const documentWidth = documentElement && documentElement.clientWidth;
    const documentHeight = documentElement && documentElement.clientHeight;
    return {
      width: viewportDimension(
        visualViewport && visualViewport.width,
        documentWidth,
        win && win.innerWidth
      ),
      height: viewportDimension(
        visualViewport && visualViewport.height,
        documentHeight,
        win && win.innerHeight
      )
    };
  }

  function isConnected(element) {
    if (!runtimeDocument || !runtimeDocument.documentElement ||
      typeof runtimeDocument.documentElement.contains !== 'function') {
      return true;
    }
    return runtimeDocument.documentElement.contains(element);
  }

  function pruneDisconnected() {
    mounted.forEach(function (state, element) {
      if (!isConnected(element)) {
        unbind(state);
        mounted.delete(element);
      }
    });
  }

  function clearPosition(state) {
    state.bubble.classList.remove('is-tip-bubble-positioned');
    state.bubble.style.removeProperty('--tip-bubble-left');
    state.bubble.style.removeProperty('--tip-bubble-top');
  }

  function positionState(state) {
    if (!state.active || !isConnected(state.element)) {
      return;
    }
    const anchorRect = state.element.getBoundingClientRect();
    const bubbleRect = state.bubble.getBoundingClientRect();
    const position = calculateTipBubblePosition(
      anchorRect,
      bubbleRect,
      getViewport(runtimeDocument, runtimeWindow)
    );
    state.bubble.style.setProperty('--tip-bubble-left', position.left + 'px');
    state.bubble.style.setProperty('--tip-bubble-top', position.top + 'px');
  }

  function deactivate(state) {
    if (!state) {
      return;
    }
    state.active = false;
    clearPosition(state);
    if (activeState === state) {
      activeState = null;
    }
  }

  function deactivateIfIdle(state) {
    if (!state.pointerInside && !state.focusInside) {
      deactivate(state);
    }
  }

  function activate(state) {
    if (activeState && activeState !== state) {
      deactivate(activeState);
    }
    activeState = state;
    state.active = true;
    state.bubble.classList.add('is-tip-bubble-positioned');
    positionState(state);
  }

  function bind(element) {
    if (!element || mounted.has(element) || typeof element.querySelector !== 'function') {
      return;
    }
    const bubble = element.querySelector('.tip-bubble');
    if (!bubble || !bubble.classList || !bubble.style) {
      return;
    }

    const state = {
      element: element,
      bubble: bubble,
      active: false,
      pointerInside: false,
      focusInside: false,
      onPointerEnter: null,
      onPointerLeave: null,
      onFocusIn: null,
      onFocusOut: null
    };
    state.onPointerEnter = function () {
      state.pointerInside = true;
      activate(state);
    };
    state.onPointerLeave = function () {
      state.pointerInside = false;
      deactivateIfIdle(state);
    };
    state.onFocusIn = function () {
      state.focusInside = true;
      activate(state);
    };
    state.onFocusOut = function (event) {
      state.focusInside = false;
      if (event.relatedTarget && element.contains && element.contains(event.relatedTarget)) {
        return;
      }
      deactivateIfIdle(state);
    };

    element.addEventListener('pointerenter', state.onPointerEnter, { passive: true });
    element.addEventListener('pointerleave', state.onPointerLeave, { passive: true });
    element.addEventListener('focusin', state.onFocusIn);
    element.addEventListener('focusout', state.onFocusOut);
    mounted.set(element, state);
  }

  function handleRenderedMarkdown(event) {
    const target = event.detail && event.detail.target;
    mount(target && typeof target.querySelectorAll === 'function' ? target : runtimeDocument);
    if (target && target !== runtimeDocument && !isConnected(target)) {
      mount(runtimeDocument);
    }
  }

  function bindLifecycle(doc, win) {
    if (lifecycleBound) {
      return;
    }
    lifecycleBound = true;
    runtimeDocument = doc;
    runtimeWindow = win;

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('stellar:mdrender', handleRenderedMarkdown);
    }
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('resize', positionActive, { passive: true });
      win.addEventListener('scroll', positionActive, { passive: true, capture: true });
      if (win.visualViewport && typeof win.visualViewport.addEventListener === 'function') {
        win.visualViewport.addEventListener('resize', positionActive, { passive: true });
        win.visualViewport.addEventListener('scroll', positionActive, { passive: true });
      }
    }
  }

  function unbindLifecycle() {
    if (!lifecycleBound) {
      return;
    }
    if (runtimeDocument && typeof runtimeDocument.removeEventListener === 'function') {
      runtimeDocument.removeEventListener('stellar:mdrender', handleRenderedMarkdown);
    }
    if (runtimeWindow && typeof runtimeWindow.removeEventListener === 'function') {
      runtimeWindow.removeEventListener('resize', positionActive);
      runtimeWindow.removeEventListener('scroll', positionActive, true);
      if (runtimeWindow.visualViewport && typeof runtimeWindow.visualViewport.removeEventListener === 'function') {
        runtimeWindow.visualViewport.removeEventListener('resize', positionActive);
        runtimeWindow.visualViewport.removeEventListener('scroll', positionActive);
      }
    }
    lifecycleBound = false;
  }

  function positionActive() {
    if (!activeState) {
      return;
    }
    if (!isConnected(activeState.element)) {
      deactivate(activeState);
      return;
    }
    positionState(activeState);
  }

  function matchesSelector(element) {
    return element && typeof element.matches === 'function' && element.matches(SELECTOR);
  }

  function mount(root) {
    const doc = resolveDocument(root);
    if (!doc) {
      return;
    }
    const win = resolveWindow(doc);
    bindLifecycle(doc, win);
    pruneDisconnected();

    const scope = root && typeof root.querySelectorAll === 'function' ? root : doc;
    if (matchesSelector(scope)) {
      bind(scope);
    }
    if (typeof scope.querySelectorAll === 'function') {
      scope.querySelectorAll(SELECTOR).forEach(bind);
    }
  }

  function unbind(state) {
    if (activeState === state) {
      deactivate(state);
    }
    state.element.removeEventListener('pointerenter', state.onPointerEnter);
    state.element.removeEventListener('pointerleave', state.onPointerLeave);
    state.element.removeEventListener('focusin', state.onFocusIn);
    state.element.removeEventListener('focusout', state.onFocusOut);
  }

  function destroy() {
    mounted.forEach(unbind);
    mounted.clear();
    unbindLifecycle();
    activeState = null;
    runtimeDocument = null;
    runtimeWindow = null;
  }

  return {
    calculateTipBubblePosition: calculateTipBubblePosition,
    mount: mount,
    destroy: destroy
  };
});
