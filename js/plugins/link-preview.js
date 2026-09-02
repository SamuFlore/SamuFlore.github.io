/*
 * Stellar link preview
 *
 * 鼠标停留在站内链接上时，请求目标页面并提取文章正文，展示在可滚动的浮层中。
 * 预览只在浏览器端工作，不改变 Hexo 生成的页面结构。
 */
(function () {
  'use strict';

  window.stellar = window.stellar || {};

  const DEFAULT_CONFIG = {
    delay: 300,
    maxWidth: 520,
    maxHeight: 420,
    siteOrigin: '',
    siteHostname: '',
    sitePort: '',
    gap: 8,
    viewportPadding: 12,
    hideDelay: 180
  };
  const PREVIEW_TRANSITION_MS = 220;
  const previewCache = new Map();
  const pendingRequests = new Map();
  const boundLinks = new Map();
  const reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  const finePointer = window.matchMedia
    ? window.matchMedia('(hover: hover) and (pointer: fine)')
    : { matches: true };

  let config = Object.assign({}, DEFAULT_CONFIG);
  let activeLink = null;
  let activeTarget = null;
  let activePreview = null;
  let hoverTimer = null;
  let hideTimer = null;
  let positionFrame = null;
  let requestToken = 0;
  let previewSerial = 0;
  let lifecycleBound = false;

  function normalizeConfig() {
    const raw = typeof ctx !== 'undefined' && ctx.link_preview ? ctx.link_preview : {};
    const normalized = Object.assign({}, DEFAULT_CONFIG);
    const delay = Number(raw.delay);
    const maxWidth = Number(raw.maxWidth);
    const maxHeight = Number(raw.maxHeight);
    if (Number.isFinite(delay)) normalized.delay = Math.max(0, Math.min(2000, delay));
    if (Number.isFinite(maxWidth)) normalized.maxWidth = Math.max(280, Math.min(900, maxWidth));
    if (Number.isFinite(maxHeight)) normalized.maxHeight = Math.max(180, Math.min(900, maxHeight));
    if (raw.siteOrigin) {
      try {
        const siteUrl = new URL(String(raw.siteOrigin), window.location.href);
        if (/^https?:$/.test(siteUrl.protocol)) {
          normalized.siteOrigin = siteUrl.origin;
          normalized.siteHostname = siteUrl.hostname;
          normalized.sitePort = siteUrl.port;
        }
      } catch (error) {
        normalized.siteOrigin = '';
      }
    }
    return normalized;
  }

  function clearHoverTimer() {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  function clearHideTimer() {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function schedulePosition() {
    if (positionFrame !== null || !activePreview || !activeLink) return;
    positionFrame = window.requestAnimationFrame(function () {
      positionFrame = null;
      positionPreview();
    });
  }

  function isUnsafeUrl(value) {
    return /^(?:javascript|vbscript|file|data):/i.test(String(value || '').trim());
  }

  function resolveUrl(value, base) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('#') || isUnsafeUrl(raw)) return null;
    try {
      return new URL(raw, base);
    } catch (error) {
      return null;
    }
  }

  function getTarget(link) {
    if (!link || link.dataset.noPreview === 'true' || link.dataset.noPopover === 'true' || link.hasAttribute('download')) {
      return null;
    }
    const rawHref = (link.getAttribute('href') || '').trim();
    // 允许指向当前文章标题的锚点（例如 #PCA-Algorithm），但忽略空锚点。
    // 空锚点通常只用于回到页面顶部，不应触发整篇文章预览。
    if (!rawHref || rawHref === '#' || /^(?:mailto|tel|javascript|data):/i.test(rawHref)) return null;

    let url;
    try {
      url = new URL(rawHref, window.location.href);
    } catch (error) {
      return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.origin !== window.location.origin) {
      // Markdown 中可能写了正式站点的绝对 URL；本地开发时将其映射到 localhost，
      // 仍然只允许配置的本站域名，不放行任意跨站请求。
      const sameConfiguredSite = config.siteHostname &&
        url.hostname === config.siteHostname &&
        (config.sitePort ? url.port === config.sitePort : !url.port);
      if (!sameConfiguredSite) return null;
      url = new URL(url.pathname + url.search + url.hash, window.location.href);
    }
    if (url.pathname === window.location.pathname && url.search === window.location.search && !url.hash) return null;

    let hash = url.hash;
    try {
      hash = decodeURIComponent(hash);
    } catch (error) {
      // 保留无法解码的片段，后续找不到对应 id 时不影响正文预览。
    }
    url.hash = '';
    return {
      url: url,
      key: url.pathname + url.search,
      hash: hash
    };
  }

  function createPreview() {
    const preview = document.createElement('div');
    preview.className = 'stellar-link-preview';
    preview.setAttribute('role', 'dialog');
    preview.setAttribute('aria-live', 'polite');
    preview.setAttribute('aria-hidden', 'true');

    const inner = document.createElement('div');
    inner.className = 'stellar-link-preview__inner';
    preview.appendChild(inner);
    document.body.appendChild(preview);

    preview.addEventListener('pointerenter', function () {
      if (activePreview === preview) clearHideTimer();
    });
    preview.addEventListener('pointerleave', function () {
      if (activePreview === preview) scheduleHide();
    });
    preview.addEventListener('focusin', function () {
      if (activePreview === preview) clearHideTimer();
    });
    preview.addEventListener('focusout', function () {
      if (activePreview === preview) scheduleHide();
    });
    return preview;
  }

  function removePreview(preview) {
    if (!preview) return;
    preview.classList.remove('is-visible');
    preview.setAttribute('aria-hidden', 'true');
    window.setTimeout(function () {
      if (!preview.classList.contains('is-visible') && preview.parentNode) {
        preview.parentNode.removeChild(preview);
      }
    }, reducedMotion.matches ? 0 : PREVIEW_TRANSITION_MS);
  }

  function abortActiveRequest() {
    if (!activeTarget) return;
    const pending = pendingRequests.get(activeTarget.key);
    if (!pending) return;
    pendingRequests.delete(activeTarget.key);
    if (pending.controller) pending.controller.abort();
  }

  function closePreview() {
    clearHoverTimer();
    clearHideTimer();
    requestToken += 1;
    abortActiveRequest();
    activeLink = null;
    activeTarget = null;
    const preview = activePreview;
    activePreview = null;
    if (preview) removePreview(preview);
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer = window.setTimeout(function () {
      hideTimer = null;
      if (!activePreview) {
        closePreview();
        return;
      }
      if (activePreview.matches(':hover') || activePreview.contains(document.activeElement) || document.activeElement === activeLink) return;
      closePreview();
    }, config.hideDelay);
  }

  function showLoading(preview) {
    const inner = preview.querySelector('.stellar-link-preview__inner');
    inner.replaceChildren();
    const status = document.createElement('p');
    status.className = 'stellar-link-preview__status';
    status.textContent = '正在加载预览…';
    inner.appendChild(status);
    preview.classList.add('is-visible');
    preview.setAttribute('aria-hidden', 'false');
    schedulePosition();
  }

  function showError(preview) {
    const inner = preview.querySelector('.stellar-link-preview__inner');
    inner.replaceChildren();
    const status = document.createElement('p');
    status.className = 'stellar-link-preview__status';
    status.textContent = '暂时无法加载此页面的预览';
    inner.appendChild(status);
    preview.classList.add('is-visible');
    preview.setAttribute('aria-hidden', 'false');
    schedulePosition();
  }

  function textContentOf(element) {
    return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function rewriteRelativeUrls(container, baseUrl) {
    container.querySelectorAll('[href], [src], [srcset], [poster], [data-src], [data-srcset], [data-bg]').forEach(function (element) {
      ['href', 'src', 'poster'].forEach(function (attribute) {
        const value = element.getAttribute(attribute);
        if (!value || value.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return;
        const resolved = resolveUrl(value, baseUrl);
        if (resolved) element.setAttribute(attribute, resolved.href);
      });

      let resourceReady = false;
      const dataSrc = element.getAttribute('data-src');
      if (dataSrc && element.matches('img,source,video')) {
        const resolved = resolveUrl(dataSrc, baseUrl);
        if (resolved) {
          element.setAttribute('src', resolved.href);
          element.removeAttribute('data-src');
          resourceReady = true;
        }
      }
      const dataSrcset = element.getAttribute('data-srcset');
      if (dataSrcset && element.matches('img,source')) {
        element.setAttribute('srcset', rewriteSrcset(dataSrcset, baseUrl));
        element.removeAttribute('data-srcset');
        resourceReady = true;
      }
      const srcset = element.getAttribute('srcset');
      if (srcset && element.matches('img,source')) {
        element.setAttribute('srcset', rewriteSrcset(srcset, baseUrl));
        resourceReady = true;
      }

      const dataBg = element.getAttribute('data-bg');
      if (dataBg) {
        const resolved = resolveUrl(dataBg, baseUrl);
        if (resolved && element.style) {
          const cssUrl = resolved.href.replace(/(["\\])/g, '\\$1');
          element.style.setProperty('background-image', 'url("' + cssUrl + '")');
          element.removeAttribute('data-bg');
          resourceReady = true;
        }
      }

      if (element.matches('img,source,video') && element.getAttribute('src')) {
        resourceReady = true;
      }
      if (resourceReady) {
        // 保留 .lazy：Stellar 的 .lazy.img 还负责背景图容器的尺寸；用 loaded
        // 解除透明度和模糊效果，等价于 vanilla-lazyload 成功回调。
        element.classList.remove('loading', 'error');
        element.classList.add('loaded');
        element.setAttribute('data-was-processed', 'true');
        if (element.matches('img,video')) {
          // 预览浮层已经主动把资源地址写入 src，避免原页面的 loading=lazy 再次延迟它。
          element.setAttribute('loading', 'eager');
        }
      }
    });
  }

  function rewriteSrcset(value, baseUrl) {
    return String(value).split(',').map(function (part) {
      const chunks = part.trim().split(/\s+/);
      if (chunks.length === 0 || !chunks[0]) return part;
      const resolved = resolveUrl(chunks[0], baseUrl);
      if (resolved) chunks[0] = resolved.href;
      return chunks.join(' ');
    }).join(', ');
  }

  function sanitizeContent(container, baseUrl) {
    container.querySelectorAll('script, style, noscript, template, iframe, object, embed, form, button, .article-footer, .article-tags, #comments, .related-wrap, .loading-wrap, .lazy-icon').forEach(function (element) {
      element.remove();
    });
    container.classList.remove('slide-up');
    container.querySelectorAll('.slide-up').forEach(function (element) {
      element.classList.remove('slide-up');
    });
    container.querySelectorAll('*').forEach(function (element) {
      Array.from(element.attributes).forEach(function (attribute) {
        if (/^on/i.test(attribute.name) || attribute.name.toLowerCase() === 'srcdoc') {
          element.removeAttribute(attribute.name);
        }
      });
      ['href', 'src', 'poster'].forEach(function (attribute) {
        const value = element.getAttribute(attribute);
        if (isUnsafeUrl(value) && !(attribute === 'src' && element.matches('img,source,video'))) {
          element.removeAttribute(attribute);
        }
      });
    });
    rewriteRelativeUrls(container, baseUrl);
  }

  function extractPreview(html, targetUrl) {
    const targetDocument = new DOMParser().parseFromString(html, 'text/html');
    const article = targetDocument.querySelector('article.md-text.content');
    if (!article) return null;

    const body = article.cloneNode(true);
    sanitizeContent(body, targetUrl);
    const title = textContentOf(targetDocument.querySelector('.article-banner-wrap h1.text.title, .article.banner h1.text.title')) || textContentOf(targetDocument.querySelector('title'));
    const meta = textContentOf(targetDocument.querySelector('.article-banner-wrap #post-meta, #post-meta'));
    return {
      title: title,
      meta: meta,
      html: body.innerHTML
    };
  }

  function fetchPreview(target) {
    const cached = previewCache.get(target.key);
    if (cached) return Promise.resolve(cached);
    const pending = pendingRequests.get(target.key);
    if (pending) return pending.promise;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const options = {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' }
    };
    if (controller) options.signal = controller.signal;

    const entry = { promise: null, controller: controller };
    entry.promise = fetch(target.url.href, options).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const responseUrl = response.url ? new URL(response.url, window.location.href) : target.url;
      if (responseUrl.origin !== window.location.origin) throw new Error('Cross-origin response');
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error('Not an HTML page');
      }
      return response.text();
    }).then(function (html) {
      const preview = extractPreview(html, target.url.href);
      if (!preview || !preview.html.trim()) throw new Error('Preview content is empty');
      previewCache.set(target.key, preview);
      return preview;
    }).finally(function () {
      if (pendingRequests.get(target.key) === entry) pendingRequests.delete(target.key);
    });
    pendingRequests.set(target.key, entry);
    return entry.promise;
  }

  function prefixIds(container, hash) {
    const prefix = 'stellar-preview-' + (++previewSerial) + '-';
    const idMap = new Map();
    container.querySelectorAll('[id]').forEach(function (element) {
      const oldId = element.id;
      const newId = prefix + oldId;
      idMap.set(oldId, newId);
      element.id = newId;
    });
    container.querySelectorAll('a[href^="#"]').forEach(function (link) {
      const oldId = link.getAttribute('href').slice(1);
      if (idMap.has(oldId)) link.setAttribute('href', '#' + idMap.get(oldId));
    });

    if (hash) {
      const targetId = hash.slice(1);
      const mappedId = idMap.get(targetId);
      if (mappedId) {
        let targetElement = null;
        container.querySelectorAll('[id]').forEach(function (element) {
          if (!targetElement && element.id === mappedId) targetElement = element;
        });
        if (targetElement) {
          window.setTimeout(function () {
            const inner = container.closest('.stellar-link-preview__inner');
            if (inner && activePreview && activePreview.contains(container)) {
              inner.scrollTop = Math.max(0, targetElement.offsetTop - 12);
            }
          }, 0);
        }
      }
    }
  }

  function renderPreview(preview, data, target) {
    const inner = preview.querySelector('.stellar-link-preview__inner');
    inner.replaceChildren();
    if (data.title) {
      const title = document.createElement('h3');
      title.className = 'stellar-link-preview__title';
      title.textContent = data.title;
      inner.appendChild(title);
    }
    if (data.meta) {
      const meta = document.createElement('p');
      meta.className = 'stellar-link-preview__meta';
      meta.textContent = data.meta;
      inner.appendChild(meta);
    }
    const content = document.createElement('div');
    content.className = 'stellar-link-preview__content md-text';
    content.innerHTML = data.html;
    sanitizeContent(content, target.url.href);
    inner.appendChild(content);
    prefixIds(content, target.hash);
    const hydrateIcons = window.stellar && window.stellar.hydrateIcons;
    if (typeof hydrateIcons === 'function') {
      Promise.resolve(hydrateIcons(content)).then(function () {
        if (activePreview === preview) schedulePosition();
      });
    }
    preview.classList.add('is-visible');
    preview.setAttribute('aria-hidden', 'false');
    schedulePosition();
  }

  function positionPreview() {
    if (!activePreview || !activeLink || !document.documentElement.contains(activeLink)) return;
    const preview = activePreview;
    const inner = preview.querySelector('.stellar-link-preview__inner');
    if (!inner) return;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const width = Math.min(config.maxWidth, Math.max(1, viewportWidth - config.viewportPadding * 2));
    const height = Math.min(config.maxHeight, Math.max(1, viewportHeight - config.viewportPadding * 2));
    preview.style.setProperty('--stellar-link-preview-max-width', width + 'px');
    preview.style.setProperty('--stellar-link-preview-max-height', height + 'px');
    preview.style.visibility = 'hidden';
    preview.style.display = 'block';

    const anchor = activeLink.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    if (anchor.bottom <= 0 || anchor.top >= viewportHeight) {
      preview.style.visibility = '';
      closePreview();
      return;
    }

    const bottomTop = anchor.bottom + config.gap;
    const topTop = anchor.top - config.gap - previewRect.height;
    const fitsBelow = bottomTop + previewRect.height <= viewportHeight - config.viewportPadding;
    const fitsAbove = topTop >= config.viewportPadding;
    const top = fitsBelow || !fitsAbove
      ? Math.min(bottomTop, viewportHeight - config.viewportPadding - previewRect.height)
      : topTop;
    const left = Math.min(
      Math.max(config.viewportPadding, anchor.left),
      Math.max(config.viewportPadding, viewportWidth - config.viewportPadding - previewRect.width)
    );
    preview.style.top = Math.round(Math.max(config.viewportPadding, top)) + 'px';
    preview.style.left = Math.round(left) + 'px';
    preview.style.visibility = '';
  }

  function isCurrent(link, target, token) {
    return activeLink === link && activeTarget === target && requestToken === token && document.documentElement.contains(link);
  }

  function open(link) {
    const target = getTarget(link);
    if (!target) return;
    clearHideTimer();
    if (activeLink === link && activeTarget && activeTarget.key === target.key && (activePreview || hoverTimer !== null)) return;

    clearHoverTimer();
    if (activeLink !== link || !activeTarget || activeTarget.key !== target.key) closePreview();
    activeLink = link;
    activeTarget = target;
    const token = ++requestToken;
    hoverTimer = window.setTimeout(function () {
      hoverTimer = null;
      if (!isCurrent(link, target, token)) return;
      if (!activePreview) activePreview = createPreview();
      showLoading(activePreview);
      fetchPreview(target).then(function (data) {
        if (isCurrent(link, target, token) && activePreview) renderPreview(activePreview, data, target);
      }).catch(function (error) {
        if (error && error.name === 'AbortError') return;
        if (isCurrent(link, target, token) && activePreview) showError(activePreview);
      });
    }, config.delay);
  }

  function bindLink(link) {
    if (!link || boundLinks.has(link)) return;
    const onPointerEnter = function () {
      if (finePointer.matches) open(link);
    };
    const onPointerLeave = function () {
      scheduleHide();
    };
    const onFocusIn = function () {
      open(link);
    };
    const onFocusOut = function () {
      scheduleHide();
    };
    link.addEventListener('pointerenter', onPointerEnter, { passive: true });
    link.addEventListener('pointerleave', onPointerLeave, { passive: true });
    link.addEventListener('focusin', onFocusIn);
    link.addEventListener('focusout', onFocusOut);
    boundLinks.set(link, { onPointerEnter, onPointerLeave, onFocusIn, onFocusOut });
  }

  function unbindAll() {
    boundLinks.forEach(function (handlers, link) {
      link.removeEventListener('pointerenter', handlers.onPointerEnter);
      link.removeEventListener('pointerleave', handlers.onPointerLeave);
      link.removeEventListener('focusin', handlers.onFocusIn);
      link.removeEventListener('focusout', handlers.onFocusOut);
    });
    boundLinks.clear();
  }

  function mountAll(root) {
    config = normalizeConfig();
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const article = scope.matches && scope.matches('article.md-text.content')
      ? scope
      : scope.querySelector('article.md-text.content');
    if (!article) return;
    article.querySelectorAll('a[href]').forEach(bindLink);
    bindLifecycle();
  }

  function handleRenderedMarkdown(event) {
    const target = event.detail && event.detail.target;
    if (target && target.nodeType === 1) {
      mountAll(target.closest('article.md-text.content') || document);
    }
  }

  function handleViewportChange() {
    schedulePosition();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') closePreview();
  }

  function bindLifecycle() {
    if (lifecycleBound) return;
    lifecycleBound = true;
    document.addEventListener('stellar:mdrender', handleRenderedMarkdown);
    window.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
  }

  function destroy() {
    clearHoverTimer();
    clearHideTimer();
    if (positionFrame !== null) {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = null;
    }
    unbindAll();
    closePreview();
    previewCache.clear();
    pendingRequests.clear();
    if (lifecycleBound) {
      document.removeEventListener('stellar:mdrender', handleRenderedMarkdown);
      window.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      document.removeEventListener('keydown', handleKeyDown);
      lifecycleBound = false;
    }
  }

  window.stellar.linkPreview = {
    mountAll: mountAll,
    destroy: destroy
  };
})();
