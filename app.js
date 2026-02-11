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
let articleButtons = new Map();
let currentArticleId = null;
let isUpdatingHash = false;
let currentHighlightedParagraphId = null;

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
    return { articleId: null, paragraphId: null };
  }

  if (allArticles.some((article) => article.id === rawValue)) {
    return { articleId: rawValue, paragraphId: null };
  }

  const separatorIndex = rawValue.indexOf('__');
  if (separatorIndex !== -1) {
    const candidateArticleId = rawValue.slice(0, separatorIndex);
    if (allArticles.some((article) => article.id === candidateArticleId)) {
      return { articleId: candidateArticleId, paragraphId: rawValue };
    }
  }

  return { articleId: null, paragraphId: null };
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
  if (!allArticles.length) {
    listMessage.textContent = '';
    return;
  }

  if (!visibleArticles.length) {
    listMessage.textContent = 'No articles match your search.';
    return;
  }

  if (!searchInput.value.trim()) {
    listMessage.textContent = `${visibleArticles.length} articles`;
    return;
  }

  listMessage.textContent = `${visibleArticles.length} of ${allArticles.length} articles`;
};

const highlightActiveLink = () => {
  articleButtons.forEach((button, id) => {
    const isActive = id === currentArticleId;
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
  if (!allArticles.length) {
    statusMessage.textContent = '';
    return;
  }

  if (!visibleArticles.length) {
    statusMessage.textContent = 'No articles match your search.';
    return;
  }

  if (!currentArticleId) {
    statusMessage.textContent = 'Select an article from the navigation.';
    return;
  }

  const index = getCurrentIndex();
  if (index === -1) {
    statusMessage.textContent = 'Select an article from the navigation.';
    return;
  }

  const total = visibleArticles.length;
  const filteredSuffix = visibleArticles.length !== allArticles.length
    ? ` (filtered from ${allArticles.length})`
    : '';

  statusMessage.textContent = `Article ${index + 1} of ${total}${filteredSuffix}`;
};

const renderArticleDetail = (article) => {
  hideLegalTooltipImmediate();

  if (!article) {
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
};

const renderArticleList = () => {
  articleButtons = new Map();
  articleListElement.innerHTML = '';

  if (!visibleArticles.length) {
    updateListMessage();
    return;
  }

  const fragment = document.createDocumentFragment();

  visibleArticles.forEach((article) => {
    const listItem = document.createElement('li');
    listItem.className = 'article-list-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'article-link';
    button.dataset.articleId = article.id;

    const numberSpan = document.createElement('span');
    numberSpan.className = 'list-article-number';
    numberSpan.textContent = article.title || article.id;
    button.appendChild(numberSpan);

    const headingText = getHeadingText(article);
    if (headingText) {
      const headingSpan = document.createElement('span');
      headingSpan.className = 'list-article-heading';
      headingSpan.textContent = headingText;
      button.appendChild(headingSpan);
    }

    button.addEventListener('click', () => {
      selectArticle(article.id);
    });

    listItem.appendChild(button);
    fragment.appendChild(listItem);
    articleButtons.set(article.id, button);
  });

  articleListElement.appendChild(fragment);
  updateListMessage();
  highlightActiveLink();
};

const selectArticle = (articleId, options = {}) => {
  if (!articleId) {
    currentArticleId = null;
    renderArticleDetail(null);
    clearParagraphHighlight();
    updateNavigationButtons();
    updateStatus();
    highlightActiveLink();
    return;
  }

  const article = allArticles.find((item) => item.id === articleId);
  if (!article) {
    return;
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

  const button = articleButtons.get(articleId);
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
  const { articleId, paragraphId } = parseHashTarget(hashId);

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
  });

  return true;
};

const handleInternalLinkClick = (event) => {
  const link = event.target.closest('a.internal-article-link');
  if (!link) {
    return;
  }

  const target = (link.getAttribute('target') || '').toLowerCase();
  if (target === '_blank') {
    return;
  }

  const href = link.getAttribute('href') || '';
  if (!href.startsWith('#')) {
    return;
  }

  event.preventDefault();

  const targetId = href.slice(1);
  const { articleId, paragraphId } = parseHashTarget(targetId);

  if (!articleId) {
    return;
  }

  selectArticle(articleId, {
    updateHash: false,
    focus: !paragraphId,
    targetParagraphId: paragraphId,
  });

  const hashTarget = paragraphId || articleId;
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

const applyFilter = (query) => {
  const normalisedQuery = query.trim().toLowerCase();

  if (!allArticles.length) {
    return;
  }

  if (!normalisedQuery) {
    visibleArticles = [...allArticles];
  } else {
    visibleArticles = allArticles.filter((article) => {
      const title = (article.title || '').toLowerCase();
      const heading = getHeadingText(article).toLowerCase();
      const summary = getSummaryText(article).toLowerCase();
      const paragraphs = (article.paragraphs || [])
        .map((paragraph) => {
          if (!paragraph) {
            return '';
          }
          if (typeof paragraph === 'string') {
            return stripHtml(paragraph);
          }
          return stripHtml(paragraph.text || '');
        })
        .join(' ')
        .toLowerCase();

      return title.includes(normalisedQuery)
        || heading.includes(normalisedQuery)
        || summary.includes(normalisedQuery)
        || paragraphs.includes(normalisedQuery);
    });
  }

  renderArticleList();

  if (!visibleArticles.length) {
    currentArticleId = null;
    renderArticleDetail(null);
    updateNavigationButtons();
    updateStatus();
    return;
  }

  if (!currentArticleId || !visibleArticles.some((article) => article.id === currentArticleId)) {
    selectArticle(visibleArticles[0].id, { updateHash: true, focus: false });
  } else {
    updateNavigationButtons();
    updateStatus();
  }
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

const fetchArticles = async () => {
  statusMessage.textContent = 'Loading articles...';
  listMessage.textContent = 'Loading articles...';

  try {
    const response = await fetch('emir-regulation.json');

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    allArticles = Array.isArray(data) ? data : [];

    if (!allArticles.length) {
      statusMessage.textContent = 'No articles available at this time.';
      listMessage.textContent = 'No articles available at this time.';
      renderArticleDetail(null);
      updateNavigationButtons();
      return;
    }

    visibleArticles = [...allArticles];
    renderArticleList();

    const hashId = window.location.hash ? window.location.hash.replace('#', '') : '';
    const handledByHash = handleHashNavigation(hashId, {
      behavior: 'auto',
      scrollIntoView: Boolean(hashId),
      focusParagraph: false,
    });

    if (!handledByHash) {
      const fallbackId = visibleArticles[0]?.id;
      if (fallbackId) {
        selectArticle(fallbackId, {
          updateHash: false,
          focus: false,
        });
      }
    }

    updateStatus();
  } catch (error) {
    console.error('Failed to load articles', error);
    statusMessage.textContent = 'We were unable to load the articles. Please try again later.';
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
  if (!hashId) {
    return;
  }

  handleHashNavigation(hashId);
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
