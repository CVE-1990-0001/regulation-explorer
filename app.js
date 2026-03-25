const articleListElement = document.getElementById('articleList');
const listMessage = document.getElementById('listMessage');
const statusMessage = document.getElementById('statusMessage');
const searchInput = document.getElementById('searchInput');
const clearSearchButton = document.getElementById('clearSearch');
const articleNumberElement = document.getElementById('articleNumber');
const articleTitleElement = document.getElementById('articleTitle');
const articleSubtitleElement = document.getElementById('articleSubtitle');
const paragraphsContainer = document.getElementById('paragraphsContainer');
const prevButton = document.getElementById('prevArticle');
const nextButton = document.getElementById('nextArticle');

let allArticles = [];
let visibleArticles = [];
let allSidebarItems = [];
let visibleSidebarItems = [];
let articleButtons = new Map();
let currentArticleId = null;
let currentArticleSelectionKey = null;
let currentSidebarSelectionKey = null;
let expandedActIds = new Set();
let isUpdatingHash = false;
let currentHighlightedParagraphId = null;
let allActs = [];
let allBundles = [];
let lastSearchQuery = '';

const legalTooltipSelectors = '.legal-reference, .legal-link';
let legalTooltipElement = null;
let legalTooltipContent = null;
let legalTooltipTarget = null;
let legalTooltipHideTimer = null;

const getClosestLegalTooltipTarget = (node) => {
  if (!node || typeof node.closest !== 'function') {
    return null;
  }
  return node.closest(legalTooltipSelectors);
};

const ensureLegalTooltipElement = () => {
  if (legalTooltipElement) {
    return;
  }

  legalTooltipElement = document.createElement('div');
  legalTooltipElement.className = 'legal-tooltip';
  legalTooltipElement.setAttribute('role', 'tooltip');
  legalTooltipElement.setAttribute('aria-hidden', 'true');

  legalTooltipContent = document.createElement('div');
  legalTooltipContent.className = 'legal-tooltip-content';
  legalTooltipElement.appendChild(legalTooltipContent);

  legalTooltipElement.addEventListener('mouseover', () => {
    if (legalTooltipHideTimer) {
      clearTimeout(legalTooltipHideTimer);
      legalTooltipHideTimer = null;
    }
  });

  legalTooltipElement.addEventListener('mouseout', (event) => {
    const related = event.relatedTarget;
    if (related && legalTooltipTarget && legalTooltipTarget.contains(related)) {
      return;
    }
    scheduleLegalTooltipHide();
  });

  document.body.appendChild(legalTooltipElement);
};

const getLegalTooltipText = (element) => {
  if (!element) {
    return '';
  }
  const preview = element.getAttribute('data-preview');
  if (preview && preview.trim()) {
    return preview.trim();
  }
  return element.textContent ? element.textContent.trim() : '';
};

const positionLegalTooltip = () => {
  if (!legalTooltipElement || !legalTooltipTarget) {
    return;
  }

  const spacing = 12;
  const viewportPadding = 8;
  const targetRect = legalTooltipTarget.getBoundingClientRect();
  const tooltipRect = legalTooltipElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let placement = 'top';

  const topPlacement = targetRect.top - tooltipRect.height - spacing;
  const bottomPlacement = targetRect.bottom + spacing;

  let top = topPlacement;

  if (topPlacement < viewportPadding && (bottomPlacement + tooltipRect.height) <= (viewportHeight - viewportPadding)) {
    placement = 'bottom';
    top = bottomPlacement;
  } else if (topPlacement < viewportPadding) {
    top = viewportPadding;
  } else if (topPlacement + tooltipRect.height > viewportHeight - viewportPadding) {
    if ((bottomPlacement + tooltipRect.height) <= (viewportHeight - viewportPadding)) {
      placement = 'bottom';
      top = bottomPlacement;
    } else {
      top = Math.max(viewportPadding, viewportHeight - tooltipRect.height - viewportPadding);
    }
  }

  if (placement === 'bottom' && (top + tooltipRect.height) > (viewportHeight - viewportPadding)) {
    top = Math.max(viewportPadding, viewportHeight - tooltipRect.height - viewportPadding);
  }

  let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
  const minLeft = viewportPadding;
  const maxLeft = viewportWidth - tooltipRect.width - viewportPadding;

  if (left < minLeft) {
    left = minLeft;
  }

  if (left > maxLeft) {
    left = Math.max(minLeft, maxLeft);
  }

  const tooltipWidth = tooltipRect.width;
  const targetCenter = targetRect.left + (targetRect.width / 2);
  let arrowLeft = targetCenter - left;
  const arrowPadding = 14;
  const arrowMax = tooltipWidth - arrowPadding;

  if (arrowLeft < arrowPadding) {
    arrowLeft = arrowPadding;
  } else if (arrowLeft > arrowMax) {
    arrowLeft = arrowMax;
  }

  legalTooltipElement.dataset.placement = placement;
  legalTooltipElement.style.top = `${Math.round(top)}px`;
  legalTooltipElement.style.left = `${Math.round(left)}px`;
  legalTooltipElement.style.setProperty('--arrow-left', `${Math.round(arrowLeft)}px`);
};

const scheduleLegalTooltipHide = (delay = 120) => {
  if (legalTooltipHideTimer) {
    clearTimeout(legalTooltipHideTimer);
  }
  legalTooltipHideTimer = setTimeout(() => {
    if (!legalTooltipElement) {
      return;
    }
    legalTooltipElement.classList.remove('is-visible');
    legalTooltipElement.setAttribute('aria-hidden', 'true');
    legalTooltipTarget = null;
  }, delay);
};

const hideLegalTooltipImmediate = () => {
  if (legalTooltipHideTimer) {
    clearTimeout(legalTooltipHideTimer);
    legalTooltipHideTimer = null;
  }
  if (!legalTooltipElement) {
    return;
  }
  legalTooltipElement.classList.remove('is-visible');
  legalTooltipElement.setAttribute('aria-hidden', 'true');
  legalTooltipTarget = null;
};

const showLegalTooltip = (target) => {
  if (!target) {
    return;
  }

  ensureLegalTooltipElement();

  if (legalTooltipHideTimer) {
    clearTimeout(legalTooltipHideTimer);
    legalTooltipHideTimer = null;
  }

  const text = getLegalTooltipText(target);
  if (!text) {
    hideLegalTooltipImmediate();
    return;
  }

  legalTooltipTarget = target;
  legalTooltipContent.textContent = text;
  legalTooltipContent.scrollTop = 0;

  legalTooltipElement.style.visibility = 'hidden';
  legalTooltipElement.classList.add('is-visible');
  legalTooltipElement.setAttribute('aria-hidden', 'false');

  // Force layout to ensure accurate measurements before positioning.
  positionLegalTooltip();

  legalTooltipElement.style.visibility = 'visible';
};

const handleLegalTooltipMouseOver = (event) => {
  const target = getClosestLegalTooltipTarget(event.target);
  if (!target) {
    return;
  }
  showLegalTooltip(target);
};

const handleLegalTooltipMouseOut = (event) => {
  const target = getClosestLegalTooltipTarget(event.target);
  if (!target) {
    return;
  }

  const related = event.relatedTarget;
  if (related && (related === legalTooltipElement || (legalTooltipElement && legalTooltipElement.contains(related)))) {
    return;
  }

  if (related && target.contains(related)) {
    return;
  }

  scheduleLegalTooltipHide();
};

const handleLegalTooltipFocusIn = (event) => {
  const target = getClosestLegalTooltipTarget(event.target);
  if (!target) {
    return;
  }
  showLegalTooltip(target);
};

const handleLegalTooltipFocusOut = (event) => {
  const target = getClosestLegalTooltipTarget(event.target);
  if (!target) {
    return;
  }

  const related = event.relatedTarget;
  if (related && (related === legalTooltipElement || (legalTooltipElement && legalTooltipElement.contains(related)))) {
    return;
  }

  hideLegalTooltipImmediate();
};

const initialiseLegalTooltips = () => {
  document.addEventListener('mouseover', handleLegalTooltipMouseOver);
  document.addEventListener('mouseout', handleLegalTooltipMouseOut);
  document.addEventListener('focusin', handleLegalTooltipFocusIn);
  document.addEventListener('focusout', handleLegalTooltipFocusOut);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideLegalTooltipImmediate();
    }
  });

  window.addEventListener('scroll', () => {
    if (!legalTooltipElement || !legalTooltipTarget || !legalTooltipElement.classList.contains('is-visible')) {
      return;
    }
    positionLegalTooltip();
  }, true);

  window.addEventListener('resize', () => {
    if (!legalTooltipElement || !legalTooltipTarget || !legalTooltipElement.classList.contains('is-visible')) {
      return;
    }
    positionLegalTooltip();
  });
};

const getSummaryText = (article) => (article?.summary || article?.summaryTitle || '').trim();
const getHeadingText = (article) => (article?.heading || '').trim();
const stripHtml = (value) => (value || '').replace(/<[^>]*>/g, ' ');
const normaliseForSearch = (value) => (
  `${value || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
);
const getSidebarItemKey = (item) => `${item?.type || 'article'}:${item?.id || ''}`;
const getArticleSelectionKey = (articleId, parentActId = null) => (
  parentActId ? `article:${parentActId}:${articleId}` : `article:${articleId}`
);

const setExpandedAct = (actId, { allowCollapse = false } = {}) => {
  if (!actId) {
    expandedActIds = new Set();
    return;
  }

  const isAlreadyExpanded = expandedActIds.has(actId);
  if (isAlreadyExpanded && allowCollapse) {
    expandedActIds = new Set();
    return;
  }

  expandedActIds = new Set([actId]);
};

const updateLocationHash = (targetId) => {
  const targetHash = targetId ? `#${targetId}` : '';
  if (window.location.hash === targetHash) {
    return;
  }
  isUpdatingHash = true;
  if (targetId) {
    window.location.hash = targetId;
  } else {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
};

const parseHashTarget = (hashValue) => {
  const rawValue = `${hashValue || ''}`.trim();
  if (!rawValue) {
    return { articleId: null, paragraphId: null, parentActId: null };
  }

  const scopedArticleMatch = rawValue.match(/^a:([^:]+):(.+)$/);
  if (scopedArticleMatch) {
    const parentActId = scopedArticleMatch[1];
    const scopedTarget = scopedArticleMatch[2];
    const separatorIndex = scopedTarget.indexOf('__');
    const articleId = separatorIndex === -1 ? scopedTarget : scopedTarget.slice(0, separatorIndex);
    const paragraphId = separatorIndex === -1 ? null : scopedTarget;

    if (allArticles.some((article) => article.id === articleId && article._actId === parentActId)) {
      return { articleId, paragraphId, parentActId };
    }
  }

  if (allArticles.some((article) => article.id === rawValue)) {
    return { articleId: rawValue, paragraphId: null, parentActId: null };
  }

  const separatorIndex = rawValue.indexOf('__');
  if (separatorIndex !== -1) {
    const candidateArticleId = rawValue.slice(0, separatorIndex);
    if (allArticles.some((article) => article.id === candidateArticleId)) {
      return { articleId: candidateArticleId, paragraphId: rawValue, parentActId: null };
    }
  }

  return { articleId: null, paragraphId: null, parentActId: null };
};

const clearParagraphHighlight = () => {
  if (!currentHighlightedParagraphId) {
    return;
  }

  const previous = document.getElementById(currentHighlightedParagraphId);
  if (previous) {
    previous.classList.remove('is-highlighted');
  }

  currentHighlightedParagraphId = null;
};

const highlightParagraph = (paragraphId, options = {}) => {
  const { behavior = 'smooth', focus = true } = options;

  if (!paragraphId) {
    clearParagraphHighlight();
    return false;
  }

  const target = document.getElementById(paragraphId);
  if (!target) {
    clearParagraphHighlight();
    return false;
  }

  clearParagraphHighlight();
  target.classList.add('is-highlighted');
  currentHighlightedParagraphId = paragraphId;

  try {
    target.scrollIntoView({ block: 'center', behavior });
  } catch (error) {
    target.scrollIntoView({ block: 'center' });
  }

  if (focus) {
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    try {
      target.focus({ preventScroll: true });
    } catch (error) {
      target.focus();
    }
  }

  return true;
};

const createParagraphElement = (paragraphData, article) => {
  if (!paragraphData) {
    return null;
  }

  const rawText = typeof paragraphData === 'string'
    ? paragraphData
    : (paragraphData.text || '');

  const text = rawText.trim();
  if (!text) {
    return null;
  }

  const paragraph = document.createElement('p');
  paragraph.className = 'article-paragraph';
  paragraph.innerHTML = text;

  if (typeof paragraphData === 'object' && paragraphData.id) {
    paragraph.id = paragraphData.id;
  }

  if (typeof paragraphData === 'object' && paragraphData.class) {
    paragraph.classList.add(paragraphData.class);
  }

  attachParagraphTools(paragraph, article, paragraphData);

  return paragraph;
};

const getCurrentIndex = () => visibleArticles.findIndex((article) => article.id === currentArticleId);

const updateListMessage = () => {
  if (!allSidebarItems.length) {
    listMessage.textContent = '';
    return;
  }

  if (!visibleSidebarItems.length) {
    listMessage.textContent = 'No items match your search.';
    return;
  }

  if (!searchInput.value.trim()) {
    listMessage.textContent = `${visibleSidebarItems.length} items`;
    return;
  }

  listMessage.textContent = `${visibleSidebarItems.length} of ${allSidebarItems.length} items`;
};

const highlightActiveLink = () => {
  articleButtons.forEach((button, id) => {
    const isActive = id === currentSidebarSelectionKey || (currentArticleSelectionKey && id === currentArticleSelectionKey);
    button.classList.toggle('is-active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'true');
    } else {
      button.removeAttribute('aria-current');
    }
  });
};

const updateNavigationButtons = () => {
  const index = getCurrentIndex();

  if (!visibleArticles.length || index === -1) {
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  prevButton.disabled = index <= 0;
  nextButton.disabled = index >= visibleArticles.length - 1;
};

const updateStatus = () => {
  if (!allSidebarItems.length) {
    statusMessage.textContent = '';
    return;
  }

  if (!visibleSidebarItems.length) {
    statusMessage.textContent = 'No items match your search.';
    return;
  }

  if (!currentSidebarSelectionKey) {
    statusMessage.textContent = 'Select an act or bundle from the navigation.';
    return;
  }

  const index = visibleSidebarItems.findIndex((item) => getSidebarItemKey(item) === currentSidebarSelectionKey);
  if (index === -1) {
    statusMessage.textContent = 'Viewing selected item.';
    return;
  }

  const selectedItem = visibleSidebarItems[index];
  const itemKind = selectedItem?.type === 'bundle' ? 'Bundle' : 'Act';
  const selectedType = selectedItem?.type === 'bundle' ? 'bundle' : 'act';

  const visibleOfType = visibleSidebarItems.filter((item) => (item?.type || 'act') === selectedType);
  const allOfType = allSidebarItems.filter((item) => (item?.type || 'act') === selectedType);

  const indexWithinType = visibleOfType.findIndex((item) => getSidebarItemKey(item) === currentSidebarSelectionKey);
  const total = visibleOfType.length;
  const filteredSuffix = visibleOfType.length !== allOfType.length
    ? ` (filtered from ${allOfType.length})`
    : '';

  statusMessage.textContent = `${itemKind} ${indexWithinType + 1} of ${total}${filteredSuffix}`;
};

const renderArticleDetail = (article) => {
  hideLegalTooltipImmediate();

  if (!article) {
    if (currentSidebarSelectionKey && currentSidebarSelectionKey.startsWith('act:')) {
      const selectedActId = currentSidebarSelectionKey.slice(4);
      const selectedAct = allActs.find((item) => item.id === selectedActId);
      if (selectedAct) {
        renderAct(selectedAct);
        return;
      }
    }

    articleNumberElement.textContent = '';
    articleTitleElement.textContent = '';
    articleSubtitleElement.textContent = '';
    paragraphsContainer.innerHTML = '';
    return;
  }

  const headingText = getHeadingText(article);
  const numberText = (article.title || article.id || '').trim();

  articleNumberElement.textContent = numberText;
  articleTitleElement.textContent = headingText || numberText;
  articleSubtitleElement.textContent = '';

  paragraphsContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  (article.paragraphs || []).forEach((paragraph) => {
    const paragraphElement = createParagraphElement(paragraph, article);
    if (paragraphElement) {
      fragment.appendChild(paragraphElement);
    }
  });

  paragraphsContainer.appendChild(fragment);
  // Apply search highlighting for the current query
  highlightSearchMatches(lastSearchQuery);
};

// Render an item by type (act or bundle)
const renderItem = (item) => {
  if (!item) {
    renderArticleDetail(null);
    return;
  }

  if (item.type === 'bundle') {
    renderBundle(item);
    return;
  }

  if (item.type === 'act') {
    renderAct(item);
    return;
  }

  // Fallback: if item looks like an article, render it
  renderArticleDetail(item);
};

// Render an act-level object (may contain `articles` or `paragraphs`)
const renderAct = (act) => {
  hideLegalTooltipImmediate();

  if (!act) {
    renderArticleDetail(null);
    return;
  }

  articleNumberElement.textContent = 'Act';
  articleTitleElement.textContent = act.title || act.id || '';
  articleSubtitleElement.textContent = act.heading || '';

  paragraphsContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  // If act has articles, render each with heading then paragraphs
  if (Array.isArray(act.articles)) {
    act.articles.forEach((article) => {
      const h = document.createElement('h3');
      h.className = 'act-article-title';
      h.textContent = article.title || article.id || '';
      fragment.appendChild(h);

      (article.paragraphs || []).forEach((p) => {
        const paragraphElement = createParagraphElement(p, article);
        if (paragraphElement) {
          fragment.appendChild(paragraphElement);
        }
      });
    });
  } else if (Array.isArray(act.paragraphs)) {
    (act.paragraphs || []).forEach((p) => {
      const paragraphElement = createParagraphElement(p, act);
      if (paragraphElement) {
        fragment.appendChild(paragraphElement);
      }
    });
  }

  paragraphsContainer.appendChild(fragment);
  // Highlight search matches inside the act view as well
  highlightSearchMatches(lastSearchQuery);
};

// Render a bundle: title, description, and member list linking to acts
const renderBundle = (bundle) => {
  hideLegalTooltipImmediate();

  if (!bundle) {
    renderArticleDetail(null);
    return;
  }

  articleNumberElement.textContent = bundle.id || '';
  articleTitleElement.textContent = bundle.title || bundle.id || '';
  articleSubtitleElement.textContent = '';

  paragraphsContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  if (bundle.description) {
    const p = document.createElement('p');
    p.className = 'bundle-description';
    p.textContent = bundle.description;
    fragment.appendChild(p);
  }

  if (Array.isArray(bundle.members) && bundle.members.length) {
    const list = document.createElement('ul');
    list.className = 'bundle-members';
    bundle.members.forEach((m) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#act:${m.ref}`;
      a.textContent = m.label || m.ref;
      a.addEventListener('click', (ev) => {
        // set hash to act:<ID> and allow route handler to pick up
        ev.preventDefault();
        try {
          window.location.hash = `act:${m.ref}`;
        } catch (e) {
          window.location.href = `${window.location.pathname}${window.location.search}#act:${m.ref}`;
        }
      });
      li.appendChild(a);
      list.appendChild(li);
    });
    fragment.appendChild(list);
  }

  paragraphsContainer.appendChild(fragment);
  // highlight any query terms in the bundle view (applies to description)
  highlightSearchMatches(lastSearchQuery);
};

const renderArticleList = () => {
  renderSidebarList(visibleSidebarItems);
};

// Render the sidebar list with a small type chip and hash-based routing
const renderSidebarList = (items = []) => {
  articleButtons = new Map();
  articleListElement.innerHTML = '';

  if (!items.length) {
    updateListMessage();
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const listItem = document.createElement('li');
    listItem.className = 'article-list-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'article-link';

    // Determine kind for chip and target hash
    const kind = item.type === 'bundle' ? 'bundle' : 'act';

    const chip = document.createElement('span');
    chip.className = 'item-chip';
    chip.classList.add(kind);
    chip.textContent = kind;
    button.appendChild(chip);

    const numberSpan = document.createElement('span');
    numberSpan.className = 'list-article-number';
    numberSpan.textContent = item.title || item.id;
    button.appendChild(numberSpan);

    const headingText = getHeadingText(item);
    if (headingText) {
      const headingSpan = document.createElement('span');
      headingSpan.className = 'list-article-heading';
      headingSpan.textContent = headingText;
      button.appendChild(headingSpan);
    }

    // Clicking updates the view: toggle expand/collapse and open act, or open bundle
    button.addEventListener('click', () => {
      if (item.type === 'bundle') {
        try {
          window.location.hash = `bundle:${item.id}`;
        } catch (e) {
          window.location.href = `${window.location.pathname}${window.location.search}#bundle:${item.id}`;
        }
        return;
      }

      const actId = item.id;
      const hasActiveSearch = Boolean(lastSearchQuery && lastSearchQuery.trim());
      setExpandedAct(actId, { allowCollapse: !hasActiveSearch });
      renderArticleList();
      handleRoute(`act:${actId}`);
      updateLocationHash(`act:${actId}`);
    });

    listItem.appendChild(button);

    const visibleChildArticles = Array.isArray(item.articles)
      ? item.articles.filter((article) => (!lastSearchQuery || matchesItem(article, lastSearchQuery)))
      : [];

    const showChildren = expandedActIds.has(item.id) || Boolean(lastSearchQuery && lastSearchQuery.trim());

    if (item.type === 'act' && visibleChildArticles.length && showChildren) {
      const childList = document.createElement('ul');
      childList.className = 'act-article-list';

      visibleChildArticles.forEach((article) => {
        if (!article || !article.id) {
          return;
        }

        const childItem = document.createElement('li');
        childItem.className = 'act-article-list-item';

        const childButton = document.createElement('button');
        childButton.type = 'button';
        childButton.className = 'article-link article-child-link';

        const childTitle = document.createElement('span');
        childTitle.className = 'list-article-number';
        childTitle.textContent = article.title || article.id;
        childButton.appendChild(childTitle);

        const childHeading = getHeadingText(article);
        if (childHeading) {
          const childHeadingSpan = document.createElement('span');
          childHeadingSpan.className = 'list-article-heading';
          childHeadingSpan.textContent = childHeading;
          childButton.appendChild(childHeadingSpan);
        }

        childButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();

          const parentActId = item.id;
          const wasExpanded = expandedActIds.has(parentActId);
          setExpandedAct(parentActId);
          if (!wasExpanded) {
            renderArticleList();
          }

          selectArticle(article.id, {
            updateHash: true,
            focus: false,
            parentActId,
            hashTarget: `a:${parentActId}:${article.id}`,
          });
        });

        childItem.appendChild(childButton);
        childList.appendChild(childItem);
        articleButtons.set(getArticleSelectionKey(article.id, item.id), childButton);
      });

      listItem.appendChild(childList);
    }

    fragment.appendChild(listItem);

    // Keep reference for potential highlighting (legacy behavior)
    articleButtons.set(getSidebarItemKey(item), button);
  });

  articleListElement.appendChild(fragment);
  updateListMessage();
  highlightActiveLink();
};

const selectArticle = (articleId, options = {}) => {
  if (!articleId) {
    currentArticleId = null;
    currentArticleSelectionKey = null;
    currentSidebarSelectionKey = null;
    renderArticleDetail(null);
    clearParagraphHighlight();
    updateNavigationButtons();
    updateStatus();
    highlightActiveLink();
    return;
  }

  const preferredParentActId = options.parentActId || null;
  const article = preferredParentActId
    ? allArticles.find((item) => item.id === articleId && item._actId === preferredParentActId)
    : allArticles.find((item) => item.id === articleId);
  if (!article) {
    return;
  }

  const parentActId = preferredParentActId || article._actId || article.id;
  currentArticleSelectionKey = getArticleSelectionKey(article.id, parentActId);
  const hasParentAct = allActs.some((act) => act.id === parentActId);
  currentSidebarSelectionKey = hasParentAct ? `act:${parentActId}` : null;
  if (hasParentAct) {
    const wasExpanded = expandedActIds.has(parentActId);
    setExpandedAct(parentActId);
    if (!wasExpanded) {
      renderArticleList();
    }
  }

  if (!visibleArticles.some((item) => item.id === articleId)) {
    visibleArticles = [...allArticles];
    searchInput.value = '';
    renderArticleList();
  }

  currentArticleId = articleId;
  renderArticleDetail(article);

  const targetParagraphId = options.targetParagraphId || null;
  let hashTarget = options.hashTarget || null;
  let paragraphHighlighted = false;

  if (targetParagraphId) {
    paragraphHighlighted = highlightParagraph(targetParagraphId, {
      behavior: options.highlightBehavior || 'smooth',
      focus: options.focusParagraph !== false,
    });
    if (!hashTarget) {
      hashTarget = paragraphHighlighted ? targetParagraphId : articleId;
    }
  } else {
    clearParagraphHighlight();
    if (!hashTarget) {
      hashTarget = articleId;
    }
  }

  highlightActiveLink();
  updateNavigationButtons();
  updateStatus();

  const button = articleButtons.get(currentArticleSelectionKey) || articleButtons.get(getArticleSelectionKey(articleId));
  if (button && options.scrollIntoView !== false) {
    button.scrollIntoView({ block: 'nearest' });
  }

  if (options.updateHash !== false) {
    updateLocationHash(hashTarget || articleId);
  }

  if (options.focus !== false && !targetParagraphId) {
    try {
      articleTitleElement.focus({ preventScroll: true });
    } catch (error) {
      articleTitleElement.focus();
    }
  }
};

const handleHashNavigation = (hashId, options = {}) => {
  if (!hashId) {
    return false;
  }

  const { behavior = 'smooth', scrollIntoView = true, focusParagraph = true } = options;
  const { articleId, paragraphId, parentActId } = parseHashTarget(hashId);

  if (!articleId) {
    return false;
  }

  selectArticle(articleId, {
    updateHash: false,
    focus: !paragraphId,
    scrollIntoView,
    targetParagraphId: paragraphId,
    highlightBehavior: behavior,
    focusParagraph,
    parentActId,
  });

  return true;
};

// Unified route handler: supports `act:<ID>`, `bundle:<ID>`, and legacy article ids
const handleRoute = (hashId) => {
  const raw = `${hashId || ''}`.trim();

  if (!raw) {
    return false;
  }

  // act:<ID>
  if (raw.startsWith('act:')) {
    const id = raw.slice(4);
    const act = allActs.find((a) => a.id === id);
    if (!act) {
      statusMessage.textContent = `Act ${id} not found.`;
      return true;
    }
    // render act-level view
    renderItem(act);
    currentSidebarSelectionKey = `act:${id}`;
    highlightActiveLink();
    // clear article selection state
    currentArticleId = null;
    updateNavigationButtons();
    updateStatus();
    return true;
  }

  // bundle:<ID>
  if (raw.startsWith('bundle:')) {
    const id = raw.slice(7);
    const bundle = allBundles.find((b) => b.id === id);
    if (!bundle) {
      statusMessage.textContent = `Bundle ${id} not found.`;
      return true;
    }
    renderItem(bundle);
    currentSidebarSelectionKey = `bundle:${id}`;
    highlightActiveLink();
    currentArticleId = null;
    updateNavigationButtons();
    updateStatus();
    return true;
  }

  // Fallback to legacy article/paragraph handling
  return handleHashNavigation(raw, { behavior: 'auto', scrollIntoView: true, focusParagraph: false });
};

const handleInternalLinkClick = (event) => {
  const link = event.target.closest('a.internal-article-link');
  if (!link) {
    return;
  }

  const href = link.getAttribute('href') || '';
  if (!href.startsWith('#')) {
    return;
  }

  event.preventDefault();

  const targetId = href.slice(1);
  const { articleId, paragraphId, parentActId } = parseHashTarget(targetId);

  if (!articleId) {
    return;
  }

  const currentActId = currentSidebarSelectionKey && currentSidebarSelectionKey.startsWith('act:')
    ? currentSidebarSelectionKey.slice(4)
    : null;
  const scopedParentActId = parentActId || currentActId;

  selectArticle(articleId, {
    updateHash: false,
    focus: !paragraphId,
    targetParagraphId: paragraphId,
    parentActId: scopedParentActId,
  });

  const hashTarget = scopedParentActId
    ? `a:${scopedParentActId}:${paragraphId || articleId}`
    : (paragraphId || articleId);
  updateLocationHash(hashTarget);
};

const goToPrevious = () => {
  const index = getCurrentIndex();
  if (index > 0) {
    selectArticle(visibleArticles[index - 1].id);
  }
};

const goToNext = () => {
  const index = getCurrentIndex();
  if (index !== -1 && index < visibleArticles.length - 1) {
    selectArticle(visibleArticles[index + 1].id);
  }
};

// Returns true if the given item (article-like or bundle) matches the query
const matchesItem = (item, query) => {
  const q = normaliseForSearch(`${query || ''}`.trim());
  if (!q) return true;

  if (item && item.type === 'bundle') {
    const title = normaliseForSearch(item.title || '');
    const desc = normaliseForSearch(item.description || '');
    const membersText = (item.members || [])
      .map((m) => ((m && (m.label || m.ref)) || ''))
      .join(' ')
      .replace(/<[^>]*>/g, ' ');
    const normalisedMembersText = normaliseForSearch(membersText);

    return title.includes(q) || desc.includes(q) || normalisedMembersText.includes(q);
  }

  if (item && item.type === 'act') {
    const title = normaliseForSearch(item.title || '');
    const heading = normaliseForSearch(getHeadingText(item));
    const articleText = (item.articles || [])
      .map((article) => {
        const articleTitle = normaliseForSearch(article?.title || '');
        const paragraphs = (article?.paragraphs || [])
          .map((paragraph) => {
            if (!paragraph) return '';
            if (typeof paragraph === 'string') return stripHtml(paragraph);
            return stripHtml(paragraph.text || '');
          })
          .join(' ')
          .replace(/\s+/g, ' ');
        const normalisedParagraphs = normaliseForSearch(paragraphs);
        return `${articleTitle} ${normalisedParagraphs}`;
      })
      .join(' ')
      .replace(/\s+/g, ' ');
    const normalisedArticleText = normaliseForSearch(articleText);

    const paragraphs = (item.paragraphs || [])
      .map((paragraph) => {
        if (!paragraph) return '';
        if (typeof paragraph === 'string') return stripHtml(paragraph);
        return stripHtml(paragraph.text || '');
      })
      .join(' ')
      .replace(/\s+/g, ' ');
    const normalisedParagraphs = normaliseForSearch(paragraphs);

    return title.includes(q) || heading.includes(q) || normalisedArticleText.includes(q) || normalisedParagraphs.includes(q);
  }

  // Treat as article-like
  const title = normaliseForSearch(item.title || '');
  const heading = normaliseForSearch(getHeadingText(item));
  const summary = normaliseForSearch(getSummaryText(item));
  const paragraphs = (item.paragraphs || [])
    .map((paragraph) => {
      if (!paragraph) return '';
      if (typeof paragraph === 'string') return stripHtml(paragraph);
      return stripHtml(paragraph.text || '');
    })
    .join(' ')
    .replace(/\s+/g, ' ');
  const normalisedParagraphs = normaliseForSearch(paragraphs);

  return title.includes(q) || heading.includes(q) || summary.includes(q) || normalisedParagraphs.includes(q);
};

const applyFilter = (query) => {
  const normalisedQuery = `${query || ''}`.trim().toLowerCase();
  lastSearchQuery = normalisedQuery;

  if (!normalisedQuery) {
    visibleSidebarItems = allSidebarItems.slice();
  } else {
    visibleSidebarItems = allActs.filter((item) => matchesItem(item, normalisedQuery));
  }

  renderArticleList();

  if (!visibleSidebarItems.length) {
    currentArticleId = null;
    currentSidebarSelectionKey = null;
    renderArticleDetail(null);
    updateNavigationButtons();
    updateStatus();
    highlightActiveLink();
    return;
  }

  const hasVisibleSelectedSidebarItem = visibleSidebarItems.some((item) => getSidebarItemKey(item) === currentSidebarSelectionKey);

  if (!hasVisibleSelectedSidebarItem) {
    const first = visibleSidebarItems[0];
    if (first.type === 'bundle') {
      try {
        window.location.hash = `bundle:${first.id}`;
      } catch (e) {
        window.location.href = `${window.location.pathname}${window.location.search}#bundle:${first.id}`;
      }
    } else if (first.type === 'act') {
      try {
        window.location.hash = `act:${first.id}`;
      } catch (e) {
        window.location.href = `${window.location.pathname}${window.location.search}#act:${first.id}`;
      }
    } else {
      selectArticle(first.id, { updateHash: true, focus: false });
    }
  } else {
    updateNavigationButtons();
    updateStatus();
  }

  // Always refresh highlights in the currently rendered view so typing
  // or deleting characters updates visible highlights immediately.
  highlightSearchMatches(lastSearchQuery);
};

const handleSearchInput = (event) => {
  applyFilter(event.target.value);
};

const clearSearch = () => {
  if (searchInput.value) {
    searchInput.value = '';
  }
  applyFilter('');
  searchInput.focus();
};

// Load registry listing acts and bundles
const loadRegistry = async () => {
  const res = await fetch('data/index.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load registry: ${res.status}`);
  }
  return res.json();
};

// Load each act and bundle referenced by the registry. Returns { acts, bundles }.
const loadAllData = async () => {
  const registry = await loadRegistry();

  const acts = [];
  const bundles = [];

  const actFetches = (registry.acts || []).map(async (entry) => {
    const res = await fetch(entry.path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch act ${entry.id} (${entry.path}): ${res.status}`);
    }
    const json = await res.json();

    if (Array.isArray(json)) {
      acts.push({
        type: 'act',
        id: entry.id,
        title: entry.label || entry.id,
        heading: 'Consolidated',
        source: {
          uri: '',
          label: 'EUR-Lex',
        },
        meta: {
          jurisdiction: 'EU',
        },
        articles: json,
      });
      return;
    }

    if (!json || json.type !== 'act') {
      console.warn('Skipped non-act file', entry);
      return;
    }

    // Keep the raw act-level object for renderAct
    acts.push(json);
  });

  const bundleFetches = (registry.bundles || []).map(async (entry) => {
    const res = await fetch(entry.path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch bundle ${entry.id} (${entry.path}): ${res.status}`);
    }
    const json = await res.json();
    if (!json || json.type !== 'bundle') {
      console.warn('Skipped non-bundle file', entry);
      return;
    }
    bundles.push(json);
  });

  await Promise.all([...actFetches, ...bundleFetches]);

  // Flatten acts into article-level entries for the sidebar/list UI
  const flattenedArticles = [];
  acts.forEach((act) => {
    if (Array.isArray(act.articles)) {
      act.articles.forEach((a) => {
        const article = Object.assign({}, a);
        // link back to parent act
        article._actId = act.id || null;
        article._actTitle = act.title || '';
        flattenedArticles.push(article);
      });
    } else if (Array.isArray(act.paragraphs)) {
      const article = {
        id: act.id,
        title: act.title || act.id,
        heading: act.heading || '',
        paragraphs: act.paragraphs,
        _actId: act.id,
        _actTitle: act.title || '',
      };
      flattenedArticles.push(article);
    }
  });

  return { acts, bundles, articles: flattenedArticles };
};

const fetchArticles = async () => {
  statusMessage.textContent = 'Loading articles...';
  listMessage.textContent = 'Loading articles...';

  try {
    const { acts, bundles, articles } = await loadAllData();

    allActs = acts;
    allBundles = bundles;

    // Maintain the old `allArticles` array used by the UI by using the flattened articles
    allArticles = Array.isArray(articles) ? articles : [];

    allSidebarItems = [...allActs, ...allBundles];
    expandedActIds = new Set();

    if (!allSidebarItems.length) {
      statusMessage.textContent = 'No acts available at this time.';
      listMessage.textContent = 'No acts available at this time.';
      renderArticleDetail(null);
      updateNavigationButtons();
      return;
    }

    visibleArticles = [...allArticles];
    visibleSidebarItems = [...allSidebarItems];
    renderArticleList();

    const hashId = window.location.hash ? window.location.hash.replace('#', '') : '';
    const handled = handleRoute(hashId);

    if (!handled) {
      // Default to first act if available
      const firstActId = allActs?.[0]?.id;
      if (firstActId) {
        try {
          window.location.hash = `act:${firstActId}`;
        } catch (e) {
          window.location.href = `${window.location.pathname}${window.location.search}#act:${firstActId}`;
        }
      } else {
        // Fallback: select first flattened article
        const fallbackId = visibleArticles[0]?.id;
        if (fallbackId) {
          selectArticle(fallbackId, {
            updateHash: false,
            focus: false,
          });
        }
      }
    }

    updateStatus();
  } catch (error) {
    console.error('Failed to load data', error);
    statusMessage.textContent = 'We were unable to load the data. Please try again later.';
    listMessage.textContent = 'Unable to load articles.';
    renderArticleDetail(null);
    updateNavigationButtons();
  }
};

searchInput.addEventListener('input', handleSearchInput);
clearSearchButton.addEventListener('click', clearSearch);
prevButton.addEventListener('click', goToPrevious);
nextButton.addEventListener('click', goToNext);

window.addEventListener('hashchange', () => {
  if (isUpdatingHash) {
    isUpdatingHash = false;
    return;
  }

  const hashId = window.location.hash ? window.location.hash.replace('#', '') : '';
  // delegate to unified route handler
  handleRoute(hashId);
});

document.addEventListener('DOMContentLoaded', fetchArticles);

initialiseLegalTooltips();
document.addEventListener('click', handleInternalLinkClick);

const regulationShortName = 'EMIR';

const copyToClipboard = async (value) => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    // Intentionally fall through to legacy fallback.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
};

const showCopyConfirmation = (button, label, { isSuccess = true } = {}) => {
  if (!button) {
    return;
  }

  const finalLabel = label || 'Copied';
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel;

  if (button._copyTimeoutId) {
    clearTimeout(button._copyTimeoutId);
    button._copyTimeoutId = null;
  }

  button.textContent = finalLabel;
  if (isSuccess) {
    button.classList.add('is-copied');
    button.classList.remove('has-copy-error');
  } else {
    button.classList.add('has-copy-error');
    button.classList.remove('is-copied');
  }

  button._copyTimeoutId = window.setTimeout(() => {
    button.textContent = button.dataset.originalLabel;
    button.classList.remove('is-copied');
    button.classList.remove('has-copy-error');
    button._copyTimeoutId = null;
  }, 1600);
};

const parseParagraphToken = (token = '') => {
  const trimmed = token.trim();
  if (!trimmed) {
    return { value: '', suffix: '' };
  }

  const match = trimmed.match(/^p?(\d+)([a-z]*)$/i);
  if (!match) {
    return { value: trimmed, suffix: '' };
  }

  const [, digits, suffix] = match;
  return { value: digits, suffix: suffix.toLowerCase() };
};

const formatParagraphDescriptor = (paragraphId) => {
  if (!paragraphId) {
    return '';
  }

  const [, detail] = paragraphId.split('__');
  if (!detail) {
    return '';
  }

  const segments = detail.split('_').filter(Boolean);
  if (!segments.length) {
    return '';
  }

  const [{ value: primaryValue, suffix: primarySuffix }] = [parseParagraphToken(segments[0])];
  if (!primaryValue) {
    return '';
  }

  const descriptorParts = [`paragraph ${primaryValue}`];
  if (primarySuffix) {
    descriptorParts.push(`(${primarySuffix})`);
  }

  segments.slice(1).forEach((segment) => {
    const { value, suffix } = parseParagraphToken(segment);
    if (value) {
      const suffixPortion = suffix ? ` ${suffix}` : '';
      descriptorParts.push(`(${value}${suffixPortion})`);
    } else {
      descriptorParts.push(`(${segment})`);
    }
  });

  return descriptorParts.join(' ');
};

const getParagraphCitation = (article, paragraphData) => {
  const articleTitle = (article?.title || article?.id || '').trim();
  if (!articleTitle) {
    return regulationShortName;
  }

  const paragraphId = typeof paragraphData === 'object' ? (paragraphData?.id || '') : '';
  const paragraphDescriptor = formatParagraphDescriptor(paragraphId);
  const baseCitation = `${regulationShortName} ${articleTitle}`;

  return paragraphDescriptor
    ? `${baseCitation}, ${paragraphDescriptor}`
    : baseCitation;
};

const getParagraphPlainText = (paragraphElement) => {
  if (!paragraphElement) {
    return '';
  }

  const clone = paragraphElement.cloneNode(true);
  clone.querySelectorAll('.paragraph-tools').forEach((node) => node.remove());

  return clone.textContent
    .replace(/\s+\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const getParagraphPermalink = (paragraphId) => {
  if (!paragraphId) {
    return window.location.href;
  }

  try {
    return new URL(`#${paragraphId}`, window.location.href).href;
  } catch (error) {
    return `${window.location.origin}${window.location.pathname}${window.location.search}#${paragraphId}`;
  }
};

// --- Search highlighting helpers ---
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const removeExistingHighlights = (container) => {
  if (!container) return;
  const marks = container.querySelectorAll('mark.search-hit');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
};

const highlightMatchesInNode = (node, regex) => {
  if (!node || node.nodeType === Node.COMMENT_NODE) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue;
    const match = regex.exec(text);
    if (!match) return;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, m.index);
      if (before) frag.appendChild(document.createTextNode(before));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = m[0];
      frag.appendChild(mark);
      lastIndex = m.index + m[0].length;
      if (m[0].length === 0) break; // avoid infinite loop
    }
    const after = text.slice(lastIndex);
    if (after) frag.appendChild(document.createTextNode(after));
    node.parentNode.replaceChild(frag, node);
    return;
  }

  // Do not descend into paragraph tools or existing marks
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'mark' || node.classList.contains('paragraph-tools')) return;
    // copy childNodes into array because live NodeList will change
    const children = Array.from(node.childNodes);
    children.forEach((child) => highlightMatchesInNode(child, regex));
  }
};

const highlightSearchMatches = (query) => {
  const container = paragraphsContainer;
  if (!container) return;
  removeExistingHighlights(container);

  const q = `${query || ''}`.trim();
  if (!q) return;

  // Use the whole query as a contiguous phrase so typing/removing letters
  // updates highlights exactly for the current input string.
  const phrase = q; // already trimmed
  if (!phrase) return;

  const pattern = escapeRegExp(phrase);
  let regex;
  try {
    regex = new RegExp(pattern, 'gi');
  } catch (e) {
    return;
  }

  // Highlight in paragraphs and bundle descriptions
  const paragraphs = container.querySelectorAll('.article-paragraph, .bundle-description');
  paragraphs.forEach((p) => {
    highlightMatchesInNode(p, regex);
  });

  // Highlight in article number, title, and subtitle
  [articleNumberElement, articleTitleElement, articleSubtitleElement].forEach((el) => {
    if (el && el.textContent) {
      // Remove previous highlights
      removeExistingHighlights(el);
      highlightMatchesInNode(el, regex);
    }
  });
};

const attachParagraphTools = (paragraphElement, article, paragraphData) => {
  if (!paragraphElement || typeof paragraphData !== 'object') {
    return;
  }

  const paragraphId = paragraphData.id || paragraphElement.id;
  if (!paragraphId) {
    return;
  }

  paragraphElement.classList.add('has-paragraph-tools');

  const toolsWrapper = document.createElement('span');
  toolsWrapper.className = 'paragraph-tools';
  toolsWrapper.setAttribute('role', 'group');
  toolsWrapper.setAttribute('aria-label', 'Paragraph tools');

  const actions = [
    {
      key: 'text',
      label: 'Text',
      ariaLabel: 'Copy paragraph text to clipboard',
      getContent: () => getParagraphPlainText(paragraphElement),
    },
    {
      key: 'link',
      label: 'Link',
      ariaLabel: 'Copy direct link to this paragraph',
      getContent: () => getParagraphPermalink(paragraphId),
    },
    {
      key: 'citation',
      label: 'Citation',
      ariaLabel: 'Copy citation for this paragraph',
      getContent: () => getParagraphCitation(article, paragraphData),
    },
  ];

  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'paragraph-tool-button';
    button.textContent = action.label;
    button.setAttribute('aria-label', action.ariaLabel);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const content = action.getContent();
      if (!content) {
        showCopyConfirmation(button, 'Error', { isSuccess: false });
        return;
      }

      const succeeded = await copyToClipboard(content);
      showCopyConfirmation(button, succeeded ? 'Copied' : 'Error', { isSuccess: succeeded });
    });

    toolsWrapper.appendChild(button);
  });

  paragraphElement.appendChild(toolsWrapper);
};
