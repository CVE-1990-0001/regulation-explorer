const articleListElement = document.getElementById('articleList');
const listMessage = document.getElementById('listMessage');
const statusMessage = document.getElementById('statusMessage');
const searchInput = document.getElementById('searchInput');
const articleNumberElement = document.getElementById('articleNumber');
const articleTitleElement = document.getElementById('articleTitle');
const articleSubtitleElement = document.getElementById('articleSubtitle');
const actDossierMetaElement = document.getElementById('actDossierMeta');
const actTopicTagsElement = document.getElementById('actTopicTags');
const legalEntityApplicabilityElement = document.getElementById('legalEntityApplicability');
const breadcrumbElement = document.getElementById('breadcrumb');
const paragraphsContainer = document.getElementById('paragraphsContainer');
const prevButton = document.getElementById('prevArticle');
const nextButton = document.getElementById('nextArticle');
const articleNav = document.querySelector('.article-navigation');
const sidePanel = document.querySelector('.side-panel');
const collapseAllButton = document.getElementById('collapseAllButton');
const activeFilterPillsElement = document.getElementById('activeFilterPills');
const tagFilterButton = document.getElementById('tagFilterButton');
const tagFilterCountElement = document.getElementById('tagFilterCount');
const tagFilterPopover = document.getElementById('tagFilterPopover');
const searchShortcutHintElement = document.getElementById('searchShortcutHint');
const searchMatchStepperElement = document.getElementById('searchMatchStepper');
const searchMatchCountElement = document.getElementById('searchMatchCount');
const searchPrevMatchButton = document.getElementById('searchPrevMatch');
const searchNextMatchButton = document.getElementById('searchNextMatch');
const stickyContextBarElement = document.getElementById('stickyContextBar');
const stickyContextTrailElement = document.getElementById('stickyContextTrail');
const stickyContextActionsElement = document.getElementById('stickyContextActions');
const articleHeaderElement = document.getElementById('articleHeader');
const scrollTopButton = document.getElementById('scrollTopButton');
const copyToastElement = document.getElementById('copyToast');
const searchBarElement = document.querySelector('.search-bar');
const mobileNavToggleButton = document.getElementById('mobileNavToggle');
const mobileDrawerBackdrop = document.getElementById('mobileDrawerBackdrop');
const mobileDrawerCloseButton = document.getElementById('mobileDrawerClose');

const MOBILE_DRAWER_BREAKPOINT = 1080;
let isMobileDrawerOpen = false;
let activeTouchParagraph = null;

const isMobileDrawerViewport = () => window.innerWidth <= MOBILE_DRAWER_BREAKPOINT;

const syncTopbarHeightVar = () => {
  if (!searchBarElement) return 56;
  const h = Math.round(searchBarElement.getBoundingClientRect().height) || 56;
  document.documentElement.style.setProperty('--topbar-height', `${h}px`);
  return h;
};

const setMobileDrawerOpen = (open) => {
  const nextState = Boolean(open) && isMobileDrawerViewport();
  isMobileDrawerOpen = nextState;
  if (sidePanel) {
    sidePanel.classList.toggle('is-drawer-open', nextState);
  }
  if (mobileDrawerBackdrop) {
    mobileDrawerBackdrop.hidden = !nextState;
  }
  if (mobileNavToggleButton) {
    mobileNavToggleButton.setAttribute('aria-expanded', String(nextState));
  }
  document.body.classList.toggle('has-open-drawer', nextState);
};

const closeMobileDrawer = () => setMobileDrawerOpen(false);
const toggleMobileDrawer = () => setMobileDrawerOpen(!isMobileDrawerOpen);

const setTouchSelectedParagraph = (paragraphEl) => {
  if (activeTouchParagraph === paragraphEl) return;
  if (activeTouchParagraph) {
    activeTouchParagraph.classList.remove('is-touch-selected');
  }
  activeTouchParagraph = paragraphEl || null;
  if (activeTouchParagraph) {
    activeTouchParagraph.classList.add('is-touch-selected');
  }
};

let allArticles = [];
let visibleArticles = [];
let allSidebarItems = [];
let visibleSidebarItems = [];
let articleButtons = new Map();
let currentArticleId = null;
let currentArticleSelectionKey = null;
let currentSidebarSelectionKey = null;
let expandedActIds = new Set();
// Acts the user has explicitly collapsed while a search is active (search would
// otherwise force every matching act open).
let searchCollapsedActIds = new Set();
let expandedBundleIds = new Set();
let expandedBundleActIds = new Set(); // composite keys: "bundleId::actId"
let isUpdatingHash = false;
let currentHighlightedParagraphId = null;
let sidePanelScrollPosition = 0;
let allActs = [];
let allBundles = [];
let lastSearchQuery = '';
let authToActId = {};
let legalEntitiesByItemId = {};
let definitionsByActId = {};
const compiledDefinitionMatchers = new Map();
let tagCatalog = [];
let tagLabelsById = new Map();
let actTagsById = {};
let availableJurisdictions = [];
let selectedJurisdictions = new Set();
let selectedTags = new Set();
let selectedLegalEntities = new Set();
let actRegistryEntriesById = {};
let activeSearchMarks = [];
let currentSearchHitIndex = -1;
let currentScrollSpyKey = null;
let currentScrollSpyArticleLabel = '';
let scrollSpyObserver = null;
let copyToastTimer = null;

const JURISDICTION_NAMES = {
  EU: 'European Union',
  DE: 'Germany',
};

const hasActiveTagFilters = () => (
  selectedJurisdictions.size > 0 || selectedTags.size > 0 || selectedLegalEntities.size > 0
);

const clearSelectedFilters = () => {
  selectedJurisdictions.clear();
  selectedTags.clear();
  selectedLegalEntities.clear();
};

const getActTags = (actId) => (actId && actTagsById[actId]) ? actTagsById[actId] : [];

const itemAppliesToLegalEntity = (itemId, shortName) => (
  (legalEntitiesByItemId[itemId] || []).some((entity) => entity.shortName === shortName)
);

const actMatchesTagCriteria = (
  act,
  jurisdictions = selectedJurisdictions,
  tags = selectedTags,
  legalEntities = selectedLegalEntities,
) => {
  if (!act) return false;
  if (jurisdictions.size > 0 && !jurisdictions.has(getJurisdiction(act))) {
    return false;
  }
  for (const shortName of legalEntities) {
    if (!itemAppliesToLegalEntity(act.id, shortName)) {
      return false;
    }
  }
  if (tags.size > 0) {
    const actTags = getActTags(act.id);
    for (const tagId of tags) {
      if (!actTags.includes(tagId)) {
        return false;
      }
    }
  }
  return true;
};

// Recursively prune a bundle tree so only member acts matching `predicate` and
// non-empty sub-folders remain.
const pruneBundleByActPredicate = (bundle, predicate) => {
  if (!bundle || !Array.isArray(bundle.members)) return null;
  const prunedMembers = [];

  bundle.members.forEach((member) => {
    if (!member) return;
    if (member.type === 'bundle') {
      const prunedChild = pruneBundleByActPredicate(member, predicate);
      if (prunedChild) prunedMembers.push(prunedChild);
      return;
    }
    if (member.ref) {
      const act = allActs.find((a) => a.id === member.ref);
      if (act && predicate(act)) {
        prunedMembers.push(member);
      }
    }
  });

  if (!prunedMembers.length) return null;
  return { ...bundle, members: prunedMembers };
};

const getOfficialSourceInfo = (act) => {
  if (!act) return null;
  const entry = actRegistryEntriesById[act.id] || {};
  const sourceUri = act.source && typeof act.source.uri === 'string' && act.source.uri.trim();
  if (sourceUri) {
    return { url: sourceUri, label: (act.source && act.source.label) || 'Official source' };
  }
  const authId = entry.authId || '';
  if (authId.startsWith('celex:')) {
    const cx = authId.slice(6);
    return {
      url: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${cx}`,
      label: 'EUR-Lex',
    };
  }
  const updateUrl = entry.update && entry.update.url;
  const firstUrl = Array.isArray(updateUrl) ? updateUrl[0] : updateUrl;
  if (typeof firstUrl === 'string' && firstUrl.startsWith('http')) {
    let label = 'Official source';
    if (firstUrl.includes('gesetze-im-internet.de')) label = 'Gesetze im Internet';
    else if (firstUrl.includes('recht.bund.de')) label = 'BGBl.';
    else if (firstUrl.includes('bsi.bund.de')) label = 'BSI';
    return { url: firstUrl, label };
  }
  return null;
};

const renderActDossierMeta = (act = null) => {
  if (!actDossierMetaElement) return;
  actDossierMetaElement.innerHTML = '';
  if (!act || act.type !== 'act') {
    actDossierMetaElement.hidden = true;
    return;
  }

  const pills = [];
  const articleCount = Array.isArray(act.articles) ? act.articles.length : 0;
  if (articleCount > 0) {
    const stat = document.createElement('span');
    stat.className = 'dossier-stat';
    stat.textContent = `${articleCount} ${articleCount === 1 ? 'section' : 'articles'}`;
    pills.push(stat);
  }

  const defInfo = definitionsByActId[act.id];
  const localDefCount = defInfo && Array.isArray(defInfo.entries) ? defInfo.entries.length : 0;
  const firstDefArtId = defInfo && Array.isArray(defInfo.definitionArticleIds)
    ? defInfo.definitionArticleIds[0]
    : null;
  const inheritedFrom = defInfo && defInfo.inheritedFrom ? defInfo.inheritedFrom : null;

  if (localDefCount > 0 && firstDefArtId) {
    const defBtn = document.createElement('button');
    defBtn.type = 'button';
    defBtn.className = 'dossier-stat dossier-stat-link';
    defBtn.textContent = `${localDefCount} defined ${localDefCount === 1 ? 'term' : 'terms'}`;
    defBtn.title = 'Jump to Definitions section';
    defBtn.addEventListener('click', () => {
      selectArticle(firstDefArtId, {
        updateHash: true,
        focus: true,
        parentActId: act.id,
        hashTarget: `a:${act.id}:${firstDefArtId}`,
      });
    });
    pills.push(defBtn);
  }

  if (inheritedFrom && inheritedFrom.actId) {
    const parentDefInfo = definitionsByActId[inheritedFrom.actId];
    const parentDefArtId = (inheritedFrom.definitionArticleIds && inheritedFrom.definitionArticleIds[0])
      || (parentDefInfo && parentDefInfo.definitionArticleIds && parentDefInfo.definitionArticleIds[0])
      || null;
    if (parentDefArtId) {
      const inhBtn = document.createElement('button');
      inhBtn.type = 'button';
      inhBtn.className = 'dossier-stat dossier-stat-link';
      const parentLabel = inheritedFrom.actLabel || inheritedFrom.actId;
      inhBtn.textContent = localDefCount > 0
        ? `+ ${parentLabel} definitions`
        : `Uses ${parentLabel} definitions`;
      inhBtn.title = `Jump to ${parentLabel} Definitions`;
      inhBtn.addEventListener('click', () => {
        selectArticle(parentDefArtId, {
          updateHash: true,
          focus: true,
          parentActId: inheritedFrom.actId,
          hashTarget: `a:${inheritedFrom.actId}:${parentDefArtId}`,
        });
      });
      pills.push(inhBtn);
    }
  }

  const sourceInfo = getOfficialSourceInfo(act);
  if (sourceInfo) {
    const srcLink = document.createElement('a');
    srcLink.className = 'dossier-stat dossier-stat-link';
    srcLink.href = sourceInfo.url;
    srcLink.target = '_blank';
    srcLink.rel = 'noopener noreferrer';
    srcLink.textContent = `${sourceInfo.label} \u2197`;
    srcLink.title = `Open official publication on ${sourceInfo.label}`;
    pills.push(srcLink);
  }

  pills.forEach((p) => actDossierMetaElement.appendChild(p));
  actDossierMetaElement.hidden = pills.length === 0;
};

const renderActTopicTags = (actId = null) => {
  if (!actTopicTagsElement) return;
  const act = actId ? allActs.find((a) => a.id === actId) : null;
  const tags = actId ? getActTags(actId) : [];
  const jurisdiction = act ? getJurisdiction(act) : '';

  actTopicTagsElement.innerHTML = '';
  if (!actId || (!tags.length && !jurisdiction)) {
    actTopicTagsElement.hidden = true;
    return;
  }
  actTopicTagsElement.hidden = false;

  if (jurisdiction) {
    const jurBtn = document.createElement('button');
    jurBtn.type = 'button';
    jurBtn.className = 'act-topic-tag is-jurisdiction';
    const jurSelected = selectedJurisdictions.has(jurisdiction);
    jurBtn.classList.toggle('is-active', jurSelected);
    jurBtn.setAttribute('aria-pressed', String(jurSelected));
    jurBtn.dataset.jurisdiction = jurisdiction;
    jurBtn.textContent = jurisdiction;
    jurBtn.title = jurSelected
      ? `Remove ${JURISDICTION_NAMES[jurisdiction] || jurisdiction} filter`
      : `Filter by ${JURISDICTION_NAMES[jurisdiction] || jurisdiction}`;
    jurBtn.addEventListener('click', () => {
      toggleJurisdictionTag(jurisdiction);
    });
    actTopicTagsElement.appendChild(jurBtn);
  }

  tags.forEach((tagId) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'act-topic-tag';
    const isSelected = selectedTags.has(tagId);
    btn.classList.toggle('is-active', isSelected);
    btn.setAttribute('aria-pressed', String(isSelected));
    btn.dataset.tagId = tagId;
    btn.textContent = tagLabelsById.get(tagId) || tagId;
    btn.title = isSelected ? 'Remove tag filter' : 'Filter regulations by this tag';
    btn.addEventListener('click', () => {
      toggleTopicTag(tagId);
    });
    actTopicTagsElement.appendChild(btn);
  });
};

// Every legal entity named in the applicability data, sorted by short name.
const getKnownLegalEntities = () => {
  const byShortName = new Map();
  Object.values(legalEntitiesByItemId).forEach((entities) => {
    (entities || []).forEach((entity) => {
      if (entity?.shortName && !byShortName.has(entity.shortName)) {
        byShortName.set(entity.shortName, entity);
      }
    });
  });
  return [...byShortName.values()].sort((a, b) => a.shortName.localeCompare(b.shortName));
};

// Clicking an entity toggles the "LE:<short name>" filter, like the topic tags.
const createLegalEntityChip = (entity) => {
  const isSelected = selectedLegalEntities.has(entity.shortName);
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'legal-entity-chip';
  chip.classList.toggle('is-active', isSelected);
  chip.textContent = entity.shortName;
  chip.title = entity.name;
  chip.setAttribute('aria-pressed', String(isSelected));
  chip.setAttribute('aria-label', isSelected
    ? `${entity.name}: remove legal entity filter`
    : `${entity.name}: show only regulations applicable to this entity`);
  chip.addEventListener('click', () => toggleLegalEntityTag(entity.shortName));
  return chip;
};
const renderLegalEntityApplicability = (itemId = null) => {
  if (!legalEntityApplicabilityElement) return;

  const entities = itemId ? legalEntitiesByItemId[itemId] || [] : [];
  legalEntityApplicabilityElement.innerHTML = '';
  legalEntityApplicabilityElement.classList.toggle('is-unavailable', Boolean(itemId) && !entities.length);
  legalEntityApplicabilityElement.hidden = !itemId;
  if (!itemId) return;

  const label = document.createElement('span');
  label.className = 'legal-entity-label';
  label.textContent = entities.length ? 'Applies to' : 'Applicability data not available';
  legalEntityApplicabilityElement.appendChild(label);

  entities.forEach((entity) => {
    legalEntityApplicabilityElement.appendChild(createLegalEntityChip(entity));
  });
};

const legalTooltipSelectors = '.defined-term, .legal-reference, .legal-link, .internal-article-link, .ref';
const LEGAL_TOOLTIP_MAX_CHARS = 1000;
let legalTooltipElement = null;
let legalTooltipContent = null;
let legalTooltipTarget = null;
let legalTooltipHideTimer = null;

const getClosestLegalTooltipTarget = (node) => {
  if (!node || typeof node.closest !== 'function') {
    return null;
  }
  if (legalTooltipElement && legalTooltipElement.contains(node)) {
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
    if (related && (legalTooltipElement.contains(related) || (legalTooltipTarget && legalTooltipTarget.contains(related)))) {
      return;
    }
    scheduleLegalTooltipHide();
  });

  document.body.appendChild(legalTooltipElement);
};

const getDefinitionEntry = (element) => {
  if (!element || !element.dataset) return null;
  const sourceActId = element.dataset.actId;
  const idx = Number(element.dataset.defIdx);
  const actDefs = sourceActId ? definitionsByActId[sourceActId] : null;
  if (!actDefs || !Array.isArray(actDefs.entries) || !Number.isInteger(idx)) {
    return null;
  }
  const entry = actDefs.entries[idx];
  if (!entry) return null;
  const inheritedLabel = element.dataset.inheritedLabel || '';
  if (inheritedLabel) {
    return { ...entry, inheritedActLabel: inheritedLabel };
  }
  return entry;
};

const createSourceBadgeElement = (label, sourceHash, extraClass = '') => {
  if (sourceHash) {
    const link = document.createElement('a');
    link.className = ['legal-tooltip-source', 'ref', extraClass].filter(Boolean).join(' ');
    link.href = `#${sourceHash}`;
    link.textContent = label;
    return link;
  }
  const span = document.createElement('span');
  span.className = ['legal-tooltip-source', extraClass].filter(Boolean).join(' ');
  span.textContent = label;
  return span;
};

const markExternalReferenceAnchors = (rootElement) => {
  if (!rootElement) return;
  rootElement.querySelectorAll('a.ref').forEach((anchor) => {
    const refId = refIdOf(anchor);
    const isExternal = Boolean(refId && !authToActId[refId]);
    anchor.classList.toggle('is-external-ref', isExternal);
  });
};

const populateTooltipDefinitionBody = (element, definitionText, definitionHtml) => {
  const plain = (definitionText || '').trim();
  if (definitionHtml && plain.length <= LEGAL_TOOLTIP_MAX_CHARS) {
    element.innerHTML = definitionHtml;
    markExternalReferenceAnchors(element);
    return;
  }
  element.textContent = plain.length > LEGAL_TOOLTIP_MAX_CHARS
    ? `${plain.slice(0, LEGAL_TOOLTIP_MAX_CHARS).trimEnd()}...`
    : plain;
};

const renderDefinitionTooltipContent = (container, entry) => {
  container.textContent = '';

  const header = document.createElement('div');
  header.className = 'legal-tooltip-header';

  const termSpan = document.createElement('span');
  termSpan.className = 'legal-tooltip-term';
  termSpan.textContent = entry.term || '';
  header.appendChild(termSpan);

  if (entry.source || entry.inheritedActLabel) {
    const badgeLabel = [entry.inheritedActLabel, entry.source].filter(Boolean).join(' · ');
    header.appendChild(
      createSourceBadgeElement(
        badgeLabel,
        entry.sourceHash,
        entry.inheritedActLabel ? 'is-inherited-source' : '',
      ),
    );
  }

  const body = document.createElement('div');
  body.className = 'legal-tooltip-body';
  populateTooltipDefinitionBody(body, entry.definition, entry.definitionHtml);

  container.appendChild(header);
  container.appendChild(body);

  if (entry.resolved && entry.resolved.definition) {
    const resolvedWrap = document.createElement('div');
    resolvedWrap.className = 'legal-tooltip-resolved';

    const resolvedHeader = document.createElement('div');
    resolvedHeader.className = 'legal-tooltip-resolved-header';
    const resolvedLabel = [entry.resolved.actLabel, entry.resolved.source].filter(Boolean).join(' · ');
    resolvedHeader.appendChild(
      createSourceBadgeElement(`↳ ${resolvedLabel}`, entry.resolved.sourceHash, 'is-resolved-source'),
    );
    resolvedWrap.appendChild(resolvedHeader);

    const resolvedBody = document.createElement('div');
    resolvedBody.className = 'legal-tooltip-resolved-body';
    populateTooltipDefinitionBody(
      resolvedBody,
      entry.resolved.definition,
      entry.resolved.definitionHtml,
    );
    resolvedWrap.appendChild(resolvedBody);

    container.appendChild(resolvedWrap);
  }
};

const getLegalTooltipText = (element) => {
  if (!element) {
    return '';
  }
  let text;
  const preview = element.getAttribute('data-preview');
  if (preview && preview.trim()) {
    text = preview.trim();
  } else if (element.matches && element.matches('.defined-term')) {
    const entry = getDefinitionEntry(element);
    if (!entry) return '';
    const sourceLabel = [entry.inheritedActLabel, entry.source].filter(Boolean).join(' · ');
    const head = [entry.term, sourceLabel].filter(Boolean).join(' — ');
    text = [head, entry.definition].filter(Boolean).join('\n\n').trim();
  } else if (element.matches && element.matches('.internal-article-link, .ref')) {
    text = getReferencePreview(element);
  } else {
    text = element.textContent ? element.textContent.trim() : '';
  }
  if (text.length > LEGAL_TOOLTIP_MAX_CHARS) {
    text = `${text.slice(0, LEGAL_TOOLTIP_MAX_CHARS).trimEnd()}...`;
  }
  return text;
};

// Convert an HTML fragment to readable plain text (strips tags, decodes entities).
const htmlToPlainText = (html) => {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
};

// Build a preview for a reference anchor. Handles both cross-act references
// (data-ref [+ data-article]) and same-act hash references (#a:act:art).
const getReferencePreview = (element) => {
  const refId = refIdOf(element);
  const articleAttr = element.dataset ? element.dataset.article : null;
  const fallback = element.textContent ? element.textContent.trim() : '';

  let targetActId = null;
  let articleId = null;
  let paragraphId = null;

  if (refId) {
    // Cross-act: resolve to a hosted act, else it opens externally.
    targetActId = authToActId[refId];
    if (!targetActId) {
      const scheme = refId.split(':')[0];
      return `${fallback} — opens ${scheme === 'celex' ? 'on EUR-Lex' : 'externally'}`;
    }
    articleId = articleAttr ? artIdOf(articleAttr) : null;
  } else {
    // Same-act: read the in-app hash href.
    const href = element.getAttribute('href') || '';
    if (!href.startsWith('#')) {
      return fallback;
    }
    const parsed = parseHashTarget(href.slice(1));
    if (!parsed.articleId) {
      return fallback;
    }
    targetActId = parsed.parentActId || getCurrentActId();
    articleId = parsed.articleId;
    paragraphId = parsed.paragraphId;
  }

  // Act-level reference (no article): preview the act itself.
  if (!articleId) {
    const act = allActs.find((a) => a.id === targetActId);
    return act ? [act.title, getHeadingText(act)].filter(Boolean).join(' — ') : fallback;
  }

  const article = (targetActId
    ? allArticles.find((item) => item.id === articleId && item._actId === targetActId)
    : null) || allArticles.find((item) => item.id === articleId);
  if (!article) {
    return fallback;
  }

  const titleLine = [article.title, getHeadingText(article)].filter(Boolean).join(' — ');

  let body = '';
  const paragraphs = Array.isArray(article.paragraphs) ? article.paragraphs : [];

  if (paragraphId) {
    const para = paragraphs.find((p) => p && p.id === paragraphId);
    if (para) {
      body = htmlToPlainText(para.text || '');
    }
  }

  if (!body) {
    body = paragraphs
      .map((p) => htmlToPlainText((p && p.text) || ''))
      .filter(Boolean)
      .join('\n\n');
  }

  if (!body) {
    body = htmlToPlainText(getSummaryText(article));
  }

  return [titleLine, body].filter(Boolean).join('\n\n').trim();
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

  const defEntry = target.matches && target.matches('.defined-term')
    ? getDefinitionEntry(target)
    : null;

  if (defEntry) {
    legalTooltipTarget = target;
    renderDefinitionTooltipContent(legalTooltipContent, defEntry);
  } else {
    const text = getLegalTooltipText(target);
    if (!text) {
      hideLegalTooltipImmediate();
      return;
    }
    legalTooltipTarget = target;
    legalTooltipContent.textContent = text;
  }
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
  if (
    target === legalTooltipTarget
    && legalTooltipElement
    && legalTooltipElement.classList.contains('is-visible')
  ) {
    if (legalTooltipHideTimer) {
      clearTimeout(legalTooltipHideTimer);
      legalTooltipHideTimer = null;
    }
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
  document.addEventListener('click', (event) => {
    const target = getClosestLegalTooltipTarget(event.target);
    // Tapping a non-navigating defined term toggles/shows its tooltip cleanly on touchscreens
    if (target && target.matches && target.matches('.defined-term')) {
      if (
        legalTooltipElement
        && legalTooltipElement.classList.contains('is-visible')
        && legalTooltipTarget === target
        && event.detail > 0
        && window.matchMedia
        && window.matchMedia('(hover: none)').matches
      ) {
        hideLegalTooltipImmediate();
      } else {
        showLegalTooltip(target);
      }
      return;
    }

    // Tapping anywhere outside both the tooltip and a tooltip target dismisses an open tooltip
    if (
      legalTooltipElement
      && legalTooltipElement.classList.contains('is-visible')
      && !legalTooltipElement.contains(event.target)
      && !target
    ) {
      hideLegalTooltipImmediate();
    }
  });
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
const getSubtitleText = (item) => ((item?.meta && item.meta.subtitle) ? `${item.meta.subtitle}`.trim() : '');
// Article id from a printed article number (mirrors the converter's art_id_of).
const artIdOf = (n) => 'art_' + String(n == null ? '' : n)
  .replace(/[^0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
// Scheme-qualified identifier of a cross-act ref anchor (e.g. "celex:32022R2554").
// Falls back to the legacy data-celex attribute.
const refIdOf = (el) => {
  if (!el || !el.dataset) return null;
  if (el.dataset.ref) return el.dataset.ref;
  if (el.dataset.celex) return `celex:${el.dataset.celex}`;
  return null;
};
// The act currently open in the reading pane, if any.
const getCurrentActId = () => (currentSidebarSelectionKey && currentSidebarSelectionKey.startsWith('act:'))
  ? currentSidebarSelectionKey.slice(4)
  : null;
const stripHtml = (value) => (value || '').replace(/<[^>]*>/g, ' ');
const normaliseForSearch = (value) => (
  `${value || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
);
const getSidebarItemKey = (item) => `${item?.type || 'article'}:${item?.id || ''}`;

// Jurisdiction code shown as a prefix on act rows (EU, DE, ...).
const getJurisdiction = (item) => {
  if (!item || item.type !== 'act') return '';
  return (item.meta && item.meta.jurisdiction) || 'EU';
};

// Fill a sidebar title span: optional jurisdiction badge + the item's title.
const setListTitle = (span, item) => {
  span.textContent = '';
  const jurisdiction = getJurisdiction(item);
  if (jurisdiction) {
    const badge = document.createElement('span');
    badge.className = 'list-jurisdiction';
    badge.textContent = jurisdiction;
    span.appendChild(badge);
  }
  span.appendChild(document.createTextNode(item.title || item.id || ''));
};

// Alphabetical comparator for sidebar items (case/accent-insensitive, numeric-aware).
const compareByTitle = (a, b) => `${a.title || a.id || ''}`
  .localeCompare(`${b.title || b.id || ''}`, undefined, { sensitivity: 'base', numeric: true });

// Find a bundle by id, searching top-level bundles and their nested sub-folders.
const findBundleById = (id, bundles = allBundles) => {
  for (const b of bundles) {
    if (!b) continue;
    if (b.id === id) return b;
    if (Array.isArray(b.members)) {
      const nested = b.members.filter((m) => m && m.type === 'bundle');
      const found = findBundleById(id, nested);
      if (found) return found;
    }
  }
  return null;
};
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

const HANGING_LABEL_RE = /^([‘'“"„]?(?:\([0-9a-z]+\)|[0-9]+(?:\.[0-9]+)*[a-z]?\.|[a-z]\)|[\-\u2013\u2014]))\s+/i;

const wrapHangingListLabel = (paragraphElement) => {
  if (!paragraphElement) return;
  if (
    paragraphElement.classList.contains('legal-footnote')
    || paragraphElement.classList.contains('quoted-amendment-heading')
  ) {
    return;
  }
  const isListItem = paragraphElement.classList.contains('list-item-l1')
    || paragraphElement.classList.contains('list-item-l2')
    || paragraphElement.classList.contains('list-item-l3');
  if (!isListItem) return;

  const firstChild = paragraphElement.firstChild;
  if (!firstChild || firstChild.nodeType !== Node.TEXT_NODE) return;

  const match = HANGING_LABEL_RE.exec(firstChild.nodeValue || '');
  if (!match) return;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'list-item-marker';
  labelSpan.textContent = match[1];
  if (match[1].length >= 6) {
    labelSpan.classList.add('is-wide-marker');
  }

  const remainder = (firstChild.nodeValue || '').slice(match[0].length);
  firstChild.nodeValue = remainder;
  paragraphElement.insertBefore(labelSpan, firstChild);
  paragraphElement.classList.add('has-hanging-marker');
};

const resolveParagraphTargetElement = (paragraphId) => {
  if (!paragraphId) return null;
  const direct = document.getElementById(paragraphId);
  if (direct) return direct;

  // Fallback for legacy positional links (#a:act:art_6__3) opened against structural IDs:
  // map 1-based positional index N within that article's rendered paragraphs.
  const legacyMatch = `${paragraphId}`.match(/^(art_[a-z0-9_]+)__(\d+)$/i);
  if (!legacyMatch || !paragraphsContainer) return null;

  const [, artPrefix, posStr] = legacyMatch;
  const posIndex = Number(posStr) - 1;
  if (posIndex < 0) return null;

  const articleParas = [...paragraphsContainer.querySelectorAll(`.article-paragraph[id^="${artPrefix}__"]`)];
  return articleParas[posIndex] || null;
};

const highlightParagraph = (paragraphId, options = {}) => {
  const { behavior = 'smooth', focus = true } = options;

  if (!paragraphId) {
    clearParagraphHighlight();
    return false;
  }

  const target = resolveParagraphTargetElement(paragraphId);
  if (!target) {
    clearParagraphHighlight();
    return false;
  }

  clearParagraphHighlight();
  target.classList.add('is-highlighted');
  currentHighlightedParagraphId = target.id || paragraphId;

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

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getDefinitionMatcher = (actId) => {
  if (!actId) return null;
  if (compiledDefinitionMatchers.has(actId)) {
    return compiledDefinitionMatchers.get(actId);
  }

  const actDefs = definitionsByActId[actId];
  if (!actDefs) {
    compiledDefinitionMatchers.set(actId, null);
    return null;
  }

  const sources = [];
  if (Array.isArray(actDefs.entries) && actDefs.entries.length) {
    sources.push({ sourceActId: actId, inheritedLabel: '', entries: actDefs.entries });
  }
  const inherited = actDefs.inheritedFrom;
  if (inherited && inherited.actId && inherited.actId !== actId) {
    const parentDefs = definitionsByActId[inherited.actId];
    if (parentDefs && Array.isArray(parentDefs.entries) && parentDefs.entries.length) {
      sources.push({
        sourceActId: inherited.actId,
        inheritedLabel: inherited.actLabel || inherited.actId,
        entries: parentDefs.entries,
      });
    }
  }

  if (!sources.length) {
    compiledDefinitionMatchers.set(actId, null);
    return null;
  }

  const exactForms = new Map();
  const foldedForms = new Map();
  const uniqueForms = new Map();

  // Local definitions are registered first so they always take precedence over inherited parent terms.
  sources.forEach(({ sourceActId, inheritedLabel, entries }) => {
    entries.forEach((entry, idx) => {
      const targetRef = { sourceActId, idx, inheritedLabel };
      const forms = Array.isArray(entry.forms) && entry.forms.length ? entry.forms : [entry.term];
      forms.forEach((rawForm) => {
        const form = `${rawForm || ''}`.replace(/\s+/g, ' ').trim();
        if (!form) return;
        if (entry.caseSensitive) {
          if (!exactForms.has(form)) exactForms.set(form, targetRef);
        } else {
          const folded = form.toLowerCase();
          if (!foldedForms.has(folded)) foldedForms.set(folded, targetRef);
        }
        const key = form.toLowerCase();
        if (!uniqueForms.has(key)) {
          uniqueForms.set(key, form);
        }
      });
    });
  });

  const sortedForms = Array.from(uniqueForms.values()).sort((a, b) => b.length - a.length);
  if (!sortedForms.length) {
    compiledDefinitionMatchers.set(actId, null);
    return null;
  }

  const alternation = sortedForms
    .map((form) => escapeRegExp(form).replace(/\s+/g, '\\s+'))
    .join('|');

  let regex = null;
  try {
    regex = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${alternation})(?![\\p{L}\\p{N}-])`, 'giu');
  } catch (error) {
    compiledDefinitionMatchers.set(actId, null);
    return null;
  }

  const matcher = {
    definitionArticleIds: new Set(actDefs.definitionArticleIds || []),
    exactForms,
    foldedForms,
    regex,
  };
  compiledDefinitionMatchers.set(actId, matcher);
  return matcher;
};

const annotateTermsInNode = (node, actId, matcher) => {
  if (!node || node.nodeType === Node.COMMENT_NODE) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;

    matcher.regex.lastIndex = 0;
    let m;
    let lastIndex = 0;
    let frag = null;

    while ((m = matcher.regex.exec(text)) !== null) {
      const matched = m[0];
      if (!matched) break;
      const normalised = matched.replace(/\s+/g, ' ');
      let targetRef = matcher.exactForms.get(normalised);
      if (targetRef === undefined) {
        targetRef = matcher.foldedForms.get(normalised.toLowerCase());
      }
      if (targetRef === undefined) {
        continue;
      }

      if (!frag) {
        frag = document.createDocumentFragment();
      }
      if (m.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      }
      const span = document.createElement('span');
      span.className = 'defined-term';
      if (targetRef.inheritedLabel) {
        span.classList.add('is-inherited-term');
      }
      span.tabIndex = 0;
      span.dataset.actId = targetRef.sourceActId;
      span.dataset.defIdx = String(targetRef.idx);
      if (targetRef.inheritedLabel) {
        span.dataset.inheritedLabel = targetRef.inheritedLabel;
      }
      span.textContent = matched;
      frag.appendChild(span);
      lastIndex = m.index + matched.length;
    }

    if (frag && node.parentNode) {
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      node.parentNode.replaceChild(frag, node);
    }
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (
      tag === 'a'
      || tag === 'mark'
      || tag === 'button'
      || tag === 'script'
      || tag === 'style'
      || node.classList.contains('paragraph-tools')
      || node.classList.contains('defined-term')
    ) {
      return;
    }
    Array.from(node.childNodes).forEach((child) => annotateTermsInNode(child, actId, matcher));
  }
};

const annotateDefinedTermsInElement = (element, actId, articleId = null) => {
  if (!element || !actId) return;
  const matcher = getDefinitionMatcher(actId);
  if (!matcher) return;
  if (articleId && matcher.definitionArticleIds.has(articleId)) return;
  annotateTermsInNode(element, actId, matcher);
};

const createParagraphElement = (paragraphData, article, actId = null) => {
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
    paragraphData.class
      .split(/\s+/)
      .filter(Boolean)
      .forEach((cls) => paragraph.classList.add(cls));
  }

  wrapHangingListLabel(paragraph);

  const resolvedActId = actId || article?._actId || getCurrentActId();
  markExternalReferenceAnchors(paragraph);
  annotateDefinedTermsInElement(paragraph, resolvedActId, article?.id || null);

  attachParagraphTools(paragraph, article, paragraphData);

  return paragraph;
};

const getCurrentIndex = () => {
  const actId = getCurrentActId();
  if (actId) {
    const scopedIdx = visibleArticles.findIndex(
      (article) => article.id === currentArticleId && article._actId === actId,
    );
    if (scopedIdx !== -1) return scopedIdx;
  }
  return visibleArticles.findIndex((article) => article.id === currentArticleId);
};

const updateListMessage = () => {
  if (!allSidebarItems.length) {
    listMessage.textContent = '';
    return;
  }

  if (!visibleSidebarItems.length) {
    listMessage.textContent = hasActiveTagFilters() && !searchInput.value.trim()
      ? 'No regulations match the selected tags.'
      : 'No items match your search.';
    return;
  }

  const hasQuery = Boolean(searchInput.value.trim());
  if (!hasQuery && !hasActiveTagFilters()) {
    listMessage.textContent = '';
    return;
  }

  const matchingActCount = allActs.filter((act) => (
    actMatchesTagCriteria(act) && (!hasQuery || matchesItem(act, lastSearchQuery))
  )).length;
  listMessage.textContent = `${matchingActCount} of ${allActs.length} regulations`;
};

const highlightActiveLink = () => {
  articleButtons.forEach((button, id) => {
    const isActive = id === currentSidebarSelectionKey || (currentArticleSelectionKey && id === currentArticleSelectionKey);
    const isScrollSpy = !currentArticleSelectionKey && Boolean(currentScrollSpyKey) && id === currentScrollSpyKey;
    button.classList.toggle('is-active', isActive);
    button.classList.toggle('is-scroll-spy', isScrollSpy);
    if (isActive) {
      button.setAttribute('aria-current', 'true');
    } else {
      button.removeAttribute('aria-current');
    }
  });
};

const formatNavArticleLabel = (article, currentActId = null) => {
  if (!article) return '';
  const num = (article.title || article.id || '').trim();
  const heading = getHeadingText(article);
  const base = heading && heading !== num ? `${num} · ${heading}` : num;
  if (currentActId && article._actId && article._actId !== currentActId && article._actTitle) {
    return `${article._actTitle} — ${base}`;
  }
  return base;
};

const setNavButtonCard = (button, directionLabel, targetLabel, fallbackText) => {
  if (!button) return;
  button.innerHTML = '';
  const dirSpan = document.createElement('span');
  dirSpan.className = 'nav-button-dir';
  dirSpan.textContent = directionLabel;
  button.appendChild(dirSpan);

  const targetSpan = document.createElement('span');
  targetSpan.className = 'nav-button-target';
  targetSpan.textContent = targetLabel || fallbackText;
  button.appendChild(targetSpan);
};

const updateNavigationButtons = () => {
  const index = getCurrentIndex();

  if (!visibleArticles.length || index === -1) {
    prevButton.disabled = true;
    nextButton.disabled = true;
    if (articleNav) articleNav.hidden = true;
    return;
  }

  if (articleNav) articleNav.hidden = false;
  const hasPrev = index > 0;
  const hasNext = index < visibleArticles.length - 1;
  prevButton.disabled = !hasPrev;
  nextButton.disabled = !hasNext;

  const activeActId = getCurrentActId();
  const prevArticleObj = hasPrev ? visibleArticles[index - 1] : null;
  const nextArticleObj = hasNext ? visibleArticles[index + 1] : null;
  setNavButtonCard(
    prevButton,
    '\u2190 Previous',
    formatNavArticleLabel(prevArticleObj, activeActId),
    'Start of list',
  );
  setNavButtonCard(
    nextButton,
    'Next \u2192',
    formatNavArticleLabel(nextArticleObj, activeActId),
    'End of list',
  );
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
    statusMessage.textContent = 'Select an act or folder from the navigation.';
    return;
  }

  const index = visibleSidebarItems.findIndex((item) => getSidebarItemKey(item) === currentSidebarSelectionKey);
  if (index === -1) {
    statusMessage.textContent = '';
    return;
  }

  const selectedItem = visibleSidebarItems[index];
  if (!selectedItem) {
    statusMessage.textContent = '';
    return;
  }

  statusMessage.textContent = '';
};

// Find the folder path (root -> target) for a bundle id, including nested folders.
const findBundlePath = (id, bundles = allBundles, trail = []) => {
  for (const b of bundles) {
    if (!b) continue;
    const nextTrail = [...trail, b];
    if (b.id === id) return nextTrail;
    if (Array.isArray(b.members)) {
      const nested = b.members.filter((m) => m && m.type === 'bundle');
      const found = findBundlePath(id, nested, nextTrail);
      if (found) return found;
    }
  }
  return null;
};

// Find the folder chain (root -> containing folder) for an act id.
const findActFolderPath = (actId, bundles = allBundles, trail = []) => {
  for (const b of bundles) {
    if (!b) continue;
    const members = b.members || [];
    if (members.some((m) => m && m.ref === actId)) {
      return [...trail, b];
    }
    const nested = members.filter((m) => m && m.type === 'bundle');
    const found = findActFolderPath(actId, nested, [...trail, b]);
    if (found) return found;
  }
  return null;
};

// Small type-indicator icon for sidebar rows (folder vs. document).
const chipIcon = (kind) => {
  if (kind === 'bundle') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
};

// Render a breadcrumb (path of ancestors). Crumbs with a hash are links.
const renderBreadcrumb = (crumbs) => {
  if (!breadcrumbElement) return;
  breadcrumbElement.innerHTML = '';
  if (!Array.isArray(crumbs) || !crumbs.length) return;

  crumbs.forEach((crumb, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '\u203a';
      sep.setAttribute('aria-hidden', 'true');
      breadcrumbElement.appendChild(sep);
    }

    if (!crumb.hash) {
      const current = document.createElement('span');
      current.className = 'crumb is-current';
      current.textContent = crumb.label;
      breadcrumbElement.appendChild(current);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crumb';
    btn.textContent = crumb.label;
    btn.addEventListener('click', () => {
      try {
        window.location.hash = crumb.hash;
      } catch (e) {
        window.location.href = `${window.location.pathname}${window.location.search}#${crumb.hash}`;
      }
    });
    breadcrumbElement.appendChild(btn);
  });
};

const buildEmptyState = () => {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const icon = document.createElement('span');
  icon.className = 'empty-state-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>';
  wrap.appendChild(icon);

  const text = document.createElement('p');
  text.className = 'empty-state-text';
  text.textContent = 'Select a regulation to begin';
  wrap.appendChild(text);

  return wrap;
};

// Content-area skeleton: a title bar + a few paragraph blocks of shimmer lines.
const buildLoadingState = () => {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton-article';
  wrap.setAttribute('aria-hidden', 'true');

  const title = document.createElement('div');
  title.className = 'skeleton skeleton-title';
  wrap.appendChild(title);

  for (let block = 0; block < 4; block += 1) {
    const para = document.createElement('div');
    para.className = 'skeleton-para';
    const lines = block % 2 === 0 ? 4 : 3;
    for (let i = 0; i < lines; i += 1) {
      const line = document.createElement('div');
      line.className = i === lines - 1 ? 'skeleton skeleton-line short' : 'skeleton skeleton-line';
      para.appendChild(line);
    }
    wrap.appendChild(para);
  }

  return wrap;
};

// Sidebar skeleton: shimmer rows standing in for the act/folder list.
const buildSidebarSkeleton = (count = 7) => {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const li = document.createElement('li');
    li.className = 'skeleton-row';
    li.setAttribute('aria-hidden', 'true');
    const pill = document.createElement('span');
    pill.className = 'skeleton skeleton-pill';
    li.appendChild(pill);
    frag.appendChild(li);
  }
  return frag;
};

const teardownScrollSpy = () => {
  if (scrollSpyObserver) {
    scrollSpyObserver.disconnect();
    scrollSpyObserver = null;
  }
  currentScrollSpyKey = null;
  currentScrollSpyArticleLabel = '';
};

const updateStickyContextBar = () => {
  if (!stickyContextBarElement || !articleHeaderElement) return;
  const topbarBottom = searchBarElement
    ? (Math.round(searchBarElement.getBoundingClientRect().height) || 56)
    : 56;
  const headerRect = articleHeaderElement.getBoundingClientRect();
  const shouldShow = headerRect.bottom < topbarBottom && Boolean(currentSidebarSelectionKey);

  stickyContextBarElement.hidden = !shouldShow;
  stickyContextBarElement.setAttribute('aria-hidden', String(!shouldShow));
  if (!shouldShow) return;

  stickyContextTrailElement.innerHTML = '';
  stickyContextActionsElement.innerHTML = '';

  if (isMobileDrawerViewport()) {
    const browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'sticky-context-btn sticky-context-browse';
    browseBtn.textContent = 'Articles';
    browseBtn.setAttribute('aria-label', 'Open article navigation');
    browseBtn.addEventListener('click', () => {
      setMobileDrawerOpen(true);
    });
    stickyContextActionsElement.appendChild(browseBtn);
  }

  const activeActId = getCurrentActId();
  const activeAct = activeActId ? allActs.find((a) => a.id === activeActId) : null;

  if (activeAct) {
    const actBtn = document.createElement('button');
    actBtn.type = 'button';
    actBtn.className = 'sticky-context-act';
    actBtn.textContent = activeAct.title || activeAct.id;
    actBtn.addEventListener('click', () => {
      if (currentArticleId) {
        window.location.hash = `act:${activeAct.id}`;
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    stickyContextTrailElement.appendChild(actBtn);

    let subLabel = '';
    if (currentArticleId) {
      const art = allArticles.find((a) => a.id === currentArticleId && a._actId === activeAct.id);
      subLabel = formatNavArticleLabel(art);
    } else if (currentScrollSpyArticleLabel) {
      subLabel = currentScrollSpyArticleLabel;
    }

    if (subLabel) {
      const sep = document.createElement('span');
      sep.textContent = '\u203a';
      sep.setAttribute('aria-hidden', 'true');
      stickyContextTrailElement.appendChild(sep);

      const cur = document.createElement('span');
      cur.className = 'sticky-context-current';
      cur.textContent = subLabel;
      stickyContextTrailElement.appendChild(cur);
    }

    const defInfo = definitionsByActId[activeAct.id];
    const localDefId = defInfo && defInfo.definitionArticleIds && defInfo.definitionArticleIds[0];
    const inheritedFrom = defInfo && defInfo.inheritedFrom ? defInfo.inheritedFrom : null;
    const inheritedDefId = inheritedFrom
      && inheritedFrom.definitionArticleIds
      && inheritedFrom.definitionArticleIds[0];
    const targetDefActId = localDefId ? activeAct.id : (inheritedFrom && inheritedFrom.actId);
    const targetDefArtId = localDefId || inheritedDefId;

    if (targetDefActId && targetDefArtId && !(targetDefActId === activeAct.id && currentArticleId === targetDefArtId)) {
      const defJump = document.createElement('button');
      defJump.type = 'button';
      defJump.className = 'sticky-context-btn';
      defJump.textContent = localDefId
        ? 'Definitions'
        : `${inheritedFrom.actLabel || 'Parent'} definitions`;
      defJump.addEventListener('click', () => {
        selectArticle(targetDefArtId, {
          updateHash: true,
          focus: true,
          parentActId: targetDefActId,
          hashTarget: `a:${targetDefActId}:${targetDefArtId}`,
        });
      });
      stickyContextActionsElement.appendChild(defJump);
    }
  } else {
    const cur = document.createElement('span');
    cur.className = 'sticky-context-current';
    cur.textContent = (articleTitleElement.textContent || '').trim();
    stickyContextTrailElement.appendChild(cur);
  }
};

const setupActScrollSpy = (actId) => {
  teardownScrollSpy();
  if (typeof IntersectionObserver !== 'function' || !paragraphsContainer) return;

  const headings = [...paragraphsContainer.querySelectorAll('.act-article-title[data-article-id]')];
  if (!headings.length) return;

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (!visible.length) return;

      const topHeading = visible[0].target;
      const artId = topHeading.dataset.articleId;
      const nextKey = getArticleSelectionKey(artId, actId);
      if (nextKey !== currentScrollSpyKey) {
        currentScrollSpyKey = nextKey;
        currentScrollSpyArticleLabel = topHeading.dataset.articleLabel || '';
        highlightActiveLink();
        updateStickyContextBar();
      }
    },
    { rootMargin: '-75px 0px -70% 0px', threshold: 0 },
  );

  headings.forEach((h) => scrollSpyObserver.observe(h));
};

const renderArticleDetail = (article) => {
  hideLegalTooltipImmediate();
  teardownScrollSpy();

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
    renderBreadcrumb([]);
    articleTitleElement.textContent = '';
    articleSubtitleElement.textContent = '';
    renderActDossierMeta(null);
    renderActTopicTags();
    renderLegalEntityApplicability();
    paragraphsContainer.innerHTML = '';
    paragraphsContainer.appendChild(buildEmptyState());
    highlightSearchMatches('');
    updateStickyContextBar();
    return;
  }

  const headingText = getHeadingText(article);
  const numberText = (article.title || article.id || '').trim();

  articleNumberElement.textContent = numberText;
  const parentAct = allActs.find((item) => item.id === article._actId);
  renderBreadcrumb(parentAct
    ? [{ label: parentAct.title || parentAct.id, hash: `act:${parentAct.id}` }]
    : []);
  articleTitleElement.textContent = headingText || numberText;
  attachHeadingTools(articleTitleElement, {
    getText: () => getArticleHeadingText(article),
    getLink: () => getArticlePermalink(article._actId || getCurrentActId(), article.id),
    getCitation: () => getArticleCitation(article, article._actId || getCurrentActId()),
  });
  articleSubtitleElement.textContent = '';
  renderActDossierMeta(null);
  renderActTopicTags();
  renderLegalEntityApplicability();

  paragraphsContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  (article.paragraphs || []).forEach((paragraph) => {
    const paragraphElement = createParagraphElement(paragraph, article);
    if (paragraphElement) {
      fragment.appendChild(paragraphElement);
    }
  });

  paragraphsContainer.appendChild(fragment);
  highlightSearchMatches(lastSearchQuery);
  updateStickyContextBar();
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
  teardownScrollSpy();

  if (!act) {
    renderArticleDetail(null);
    return;
  }

  articleNumberElement.textContent = '';
  const folderChain = findActFolderPath(act.id) || [];
  renderBreadcrumb(folderChain.map((b) => ({ label: b.title || b.id, hash: `bundle:${b.id}` })));
  articleTitleElement.textContent = act.title || act.id || '';
  attachHeadingTools(articleTitleElement, {
    getText: () => getActHeadingText(act),
    getLink: () => getActPermalink(act.id),
    getCitation: () => getActCitation(act),
  });
  articleSubtitleElement.textContent = [getSubtitleText(act), act.heading].filter(Boolean).join(' — ');
  renderActDossierMeta(act);
  renderActTopicTags(act.id);
  renderLegalEntityApplicability(act.id);

  paragraphsContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  // If act has articles, render each with clickable number + descriptive heading then paragraphs
  if (Array.isArray(act.articles)) {
    act.articles.forEach((article) => {
      const h = document.createElement('h3');
      h.className = 'act-article-title';
      const numLabel = (article.title || article.id || '').trim();
      const subHeading = getHeadingText(article);
      h.dataset.articleId = article.id || '';
      h.dataset.articleLabel = formatNavArticleLabel(article);

      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'act-article-title-link';
      titleBtn.title = `Open ${formatNavArticleLabel(article)}`;

      const numSpan = document.createElement('span');
      numSpan.className = 'act-article-heading-num';
      numSpan.textContent = numLabel;
      titleBtn.appendChild(numSpan);

      if (subHeading && subHeading !== numLabel) {
        const subSpan = document.createElement('span');
        subSpan.className = 'act-article-heading-sub';
        subSpan.textContent = `— ${subHeading}`;
        titleBtn.appendChild(subSpan);
      }

      titleBtn.addEventListener('click', () => {
        selectArticle(article.id, {
          updateHash: true,
          focus: true,
          parentActId: act.id,
          hashTarget: `a:${act.id}:${article.id}`,
        });
      });

      h.appendChild(titleBtn);
      attachHeadingTools(h, {
        getText: () => getArticleHeadingText(article),
        getLink: () => getArticlePermalink(act.id, article.id),
        getCitation: () => getArticleCitation(article, act.id),
      });
      fragment.appendChild(h);

      (article.paragraphs || []).forEach((p) => {
        const paragraphElement = createParagraphElement(p, article, act.id);
        if (paragraphElement) {
          fragment.appendChild(paragraphElement);
        }
      });
    });
  } else if (Array.isArray(act.paragraphs)) {
    (act.paragraphs || []).forEach((p) => {
      const paragraphElement = createParagraphElement(p, act, act.id);
      if (paragraphElement) {
        fragment.appendChild(paragraphElement);
      }
    });
  }

  paragraphsContainer.appendChild(fragment);
  highlightSearchMatches(lastSearchQuery);
  setupActScrollSpy(act.id);
  updateStickyContextBar();
};

const countBundleRegulations = (bundleObj) => {
  if (!bundleObj || !Array.isArray(bundleObj.members)) return 0;
  let total = 0;
  bundleObj.members.forEach((m) => {
    if (!m) return;
    if (m.type === 'bundle') total += countBundleRegulations(m);
    else if (m.ref) total += 1;
  });
  return total;
};

// Render a bundle: title, description, and enriched member cards linking to acts/sub-folders
const renderBundle = (bundle) => {
  hideLegalTooltipImmediate();
  teardownScrollSpy();

  if (!bundle) {
    renderArticleDetail(null);
    return;
  }

  articleNumberElement.textContent = '';
  const bundlePath = findBundlePath(bundle.id) || [bundle];
  const ancestors = bundlePath.slice(0, -1);
  renderBreadcrumb(ancestors.map((b) => ({ label: b.title || b.id, hash: `bundle:${b.id}` })));
  articleTitleElement.textContent = bundle.title || bundle.id || '';
  attachHeadingTools(articleTitleElement, {
    getText: () => getBundleHeadingText(bundle),
    getLink: () => getBundlePermalink(bundle.id),
    getCitation: () => getBundleHeadingText(bundle),
  });
  articleSubtitleElement.textContent = '';
  renderActDossierMeta(null);
  renderActTopicTags();
  renderLegalEntityApplicability(bundle.id);

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
      if (!m) {
        return;
      }
      const li = document.createElement('li');

      // Nested sub-folder: card shows folder title, description, and member count
      if (m.type === 'bundle') {
        const a = document.createElement('a');
        a.href = `#bundle:${m.id}`;

        const topRow = document.createElement('span');
        topRow.className = 'bundle-card-top';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'bundle-card-title';
        titleSpan.textContent = m.title || m.id;
        topRow.appendChild(titleSpan);

        const regCount = countBundleRegulations(m);
        if (regCount > 0) {
          const metaSpan = document.createElement('span');
          metaSpan.className = 'bundle-card-meta';
          metaSpan.textContent = `${regCount} ${regCount === 1 ? 'act' : 'acts'}`;
          topRow.appendChild(metaSpan);
        }
        a.appendChild(topRow);

        if (m.description) {
          const sub = document.createElement('span');
          sub.className = 'bundle-card-subtitle';
          sub.textContent = m.description;
          a.appendChild(sub);
        }

        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          expandedBundleIds.add(m.id);
          renderArticleList();
          try {
            window.location.hash = `bundle:${m.id}`;
          } catch (e) {
            window.location.href = `${window.location.pathname}${window.location.search}#bundle:${m.id}`;
          }
        });
        li.appendChild(a);
        list.appendChild(li);
        return;
      }

      const memberAct = allActs.find((act) => act.id === m.ref);
      const a = document.createElement('a');
      a.href = `#act:${m.ref}`;

      const topRow = document.createElement('span');
      topRow.className = 'bundle-card-top';
      if (memberAct) {
        const jurBadge = document.createElement('span');
        jurBadge.className = 'list-jurisdiction';
        jurBadge.textContent = getJurisdiction(memberAct);
        topRow.appendChild(jurBadge);
      }
      const titleSpan = document.createElement('span');
      titleSpan.className = 'bundle-card-title';
      titleSpan.textContent = m.label || (memberAct && memberAct.title) || m.ref;
      topRow.appendChild(titleSpan);

      const artCount = memberAct && Array.isArray(memberAct.articles) ? memberAct.articles.length : 0;
      if (artCount > 0) {
        const metaSpan = document.createElement('span');
        metaSpan.className = 'bundle-card-meta';
        metaSpan.textContent = `${artCount} art.`;
        topRow.appendChild(metaSpan);
      }
      a.appendChild(topRow);

      const subText = memberAct ? (getSubtitleText(memberAct) || getHeadingText(memberAct)) : '';
      if (subText) {
        const sub = document.createElement('span');
        sub.className = 'bundle-card-subtitle';
        sub.textContent = subText;
        a.appendChild(sub);
      }

      a.addEventListener('click', (ev) => {
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
  highlightSearchMatches(lastSearchQuery);
  updateStickyContextBar();
};

const renderArticleList = () => {
  renderSidebarList(visibleSidebarItems);
};

// Show the collapse-all control only when something is manually expanded
// (during an active search expansion is forced, so the control is hidden).
const updateCollapseAllButton = () => {
  if (!collapseAllButton) return;
  const searchActive = Boolean(lastSearchQuery && lastSearchQuery.trim());
  const anyExpanded = expandedActIds.size > 0
    || expandedBundleIds.size > 0
    || expandedBundleActIds.size > 0;
  collapseAllButton.hidden = searchActive || !anyExpanded;
};

// Collapse every expanded folder and act, then re-render the sidebar
const collapseAll = () => {
  expandedActIds.clear();
  expandedBundleIds.clear();
  expandedBundleActIds.clear();
  renderArticleList();
};

const countSubstringOccurrences = (haystack, needle) => {
  if (!haystack || !needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
};

const getArticleSearchText = (article) => {
  if (!article) return '';
  if (article._normalisedSearchText !== undefined) {
    return article._normalisedSearchText;
  }
  const parts = [
    article.title || '',
    getHeadingText(article),
    getSummaryText(article),
    ...(article.paragraphs || []).map((p) => {
      if (!p) return '';
      return typeof p === 'string' ? stripHtml(p) : stripHtml(p.text || '');
    }),
  ];
  article._normalisedSearchText = normaliseForSearch(parts.join(' ').replace(/\s+/g, ' '));
  return article._normalisedSearchText;
};

const countItemSearchHits = (item, rawQuery) => {
  const q = normaliseForSearch(`${rawQuery || ''}`.trim());
  if (!q || !item) return 0;

  if (item.type === 'act') {
    const headerHits = countSubstringOccurrences(
      normaliseForSearch([item.title || '', getHeadingText(item), getSubtitleText(item)].join(' ')),
      q,
    );
    const articleHits = Array.isArray(item.articles)
      ? item.articles.reduce((sum, art) => sum + countSubstringOccurrences(getArticleSearchText(art), q), 0)
      : countSubstringOccurrences(getArticleSearchText(item), q);
    return headerHits + articleHits;
  }

  return countSubstringOccurrences(getArticleSearchText(item), q);
};

const appendHitBadge = (button, count) => {
  if (!button || !count || count <= 0) return;
  const badge = document.createElement('span');
  badge.className = 'list-hit-badge';
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.title = `${count} ${count === 1 ? 'match' : 'matches'}`;
  button.appendChild(badge);
};

// Render the sidebar list with a small type chip and hash-based routing
const renderSidebarList = (items = []) => {
  articleButtons = new Map();

  // Adds a rotating disclosure chevron to expandable rows (folders / acts)
  const appendDisclosure = (btn, expanded) => {
    const chev = document.createElement('span');
    chev.className = 'disclosure';
    chev.setAttribute('aria-hidden', 'true');
    if (expanded) {
      btn.classList.add('is-expanded');
    }
    btn.appendChild(chev);
  };

  // Build a single article row under an act (used at top level and when nested).
  const createArticleRow = (article, actId, onActivate) => {
    const rowItem = document.createElement('li');
    rowItem.className = 'act-article-list-item';

    const rowButton = document.createElement('button');
    rowButton.type = 'button';
    rowButton.className = 'article-link article-child-link';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'list-article-number';
    rowTitle.textContent = article.title || article.id;
    rowButton.appendChild(rowTitle);

    const rowHeading = getHeadingText(article);
    if (rowHeading) {
      const rowHeadingSpan = document.createElement('span');
      rowHeadingSpan.className = 'list-article-heading';
      rowHeadingSpan.textContent = rowHeading;
      rowButton.appendChild(rowHeadingSpan);
    }

    if (lastSearchQuery) {
      appendHitBadge(rowButton, countItemSearchHits(article, lastSearchQuery));
    }

    rowButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    });

    rowItem.appendChild(rowButton);
    articleButtons.set(getArticleSelectionKey(article.id, actId), rowButton);
    return rowItem;
  };

  // Build an act row nested inside a folder, with its expandable article list.
  const createNestedActRow = (act, parentBundleId) => {
    const actItem = document.createElement('li');
    actItem.className = 'act-article-list-item';

    const actButton = document.createElement('button');
    actButton.type = 'button';
    actButton.className = 'article-link article-child-link';

    const actTitle = document.createElement('span');
    actTitle.className = 'list-article-number';
    setListTitle(actTitle, act);
    actButton.appendChild(actTitle);

    const actSubtitleText = getSubtitleText(act);
    if (actSubtitleText) {
      const actSubtitleSpan = document.createElement('span');
      actSubtitleSpan.className = 'list-article-subtitle';
      actSubtitleSpan.textContent = actSubtitleText;
      actButton.appendChild(actSubtitleSpan);
    }

    const actHeadingText = getHeadingText(act);
    if (actHeadingText) {
      const actHeadingSpan = document.createElement('span');
      actHeadingSpan.className = 'list-article-heading';
      actHeadingSpan.textContent = actHeadingText;
      actButton.appendChild(actHeadingSpan);
    }

    const bundleActKey = `${parentBundleId}::${act.id}`;
    const hasArticles = Array.isArray(act.articles) && act.articles.length > 0;
    if (hasArticles) {
      appendDisclosure(actButton, expandedBundleActIds.has(bundleActKey));
    }

    actButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (expandedBundleActIds.has(bundleActKey)) {
        expandedBundleActIds.delete(bundleActKey);
      } else {
        expandedBundleActIds.add(bundleActKey);
      }
      renderArticleList();
      handleRoute(`act:${act.id}`);
      updateLocationHash(`act:${act.id}`);
      if (!hasArticles) {
        closeMobileDrawer();
      }
    });

    actItem.appendChild(actButton);
    articleButtons.set(`act:${act.id}`, actButton);

    if (hasArticles && expandedBundleActIds.has(bundleActKey)) {
      const childList = document.createElement('ul');
      childList.className = 'act-article-list';
      act.articles.forEach((article) => {
        if (!article || !article.id) {
          return;
        }
        childList.appendChild(createArticleRow(article, act.id, () => {
          selectArticle(article.id, {
            updateHash: true,
            focus: false,
            parentActId: act.id,
            hashTarget: `a:${act.id}:${article.id}`,
          });
        }));
      });
      actItem.appendChild(childList);
    }

    return actItem;
  };

  // Build a sub-folder row that recursively renders its own children.
  const createFolderRow = (folder) => {
    const subItem = document.createElement('li');
    subItem.className = 'act-article-list-item';

    const subButton = document.createElement('button');
    subButton.type = 'button';
    subButton.className = 'article-link article-child-link';

    const subChip = document.createElement('span');
    subChip.className = 'item-chip bundle';
        subChip.innerHTML = chipIcon('bundle');
    const subTitle = document.createElement('span');
    subTitle.className = 'list-article-number';
    subTitle.textContent = folder.title || folder.id;
    subButton.appendChild(subTitle);

    appendDisclosure(subButton, expandedBundleIds.has(folder.id));

    subButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (expandedBundleIds.has(folder.id)) {
        expandedBundleIds.delete(folder.id);
      } else {
        expandedBundleIds.add(folder.id);
      }
      renderArticleList();
      handleRoute(`bundle:${folder.id}`);
      updateLocationHash(`bundle:${folder.id}`);
    });

    subItem.appendChild(subButton);
    articleButtons.set(getSidebarItemKey(folder), subButton);

    if (expandedBundleIds.has(folder.id)) {
      const childList = buildMemberList(folder);
      if (childList) {
        subItem.appendChild(childList);
      } else {
        const emptyNote = document.createElement('p');
        emptyNote.className = 'folder-empty-note';
        emptyNote.textContent = 'No regulations yet';
        subItem.appendChild(emptyNote);
      }
    }

    return subItem;
  };

  // Recursively build a folder's children: nested sub-folders and member acts.
  function buildMemberList(bundleItem) {
    const members = Array.isArray(bundleItem.members) ? bundleItem.members : [];
    if (!members.length) {
      return null;
    }

    const list = document.createElement('ul');
    list.className = 'act-article-list bundle-child-acts';
    let rendered = 0;

    members.forEach((member) => {
      if (member && member.type === 'bundle') {
        list.appendChild(createFolderRow(member));
        rendered += 1;
        return;
      }

      const act = member && member.ref ? allActs.find((a) => a.id === member.ref) : null;
      if (!act) {
        return;
      }
      list.appendChild(createNestedActRow(act, bundleItem.id));
      rendered += 1;
    });

    return rendered ? list : null;
  }

  // Save current scroll position and the list's offset so we can compensate
  // for anything above it (collapse button / message) toggling on re-render.
  const savedScrollPosition = sidePanel ? sidePanel.scrollTop : 0;
  const listOffsetBefore = articleListElement.offsetTop;

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
    chip.innerHTML = chipIcon(kind);
    button.appendChild(chip);

    const numberSpan = document.createElement('span');
    numberSpan.className = 'list-article-number';
    setListTitle(numberSpan, item);
    button.appendChild(numberSpan);

    const headingText = getHeadingText(item);
    if (headingText) {
      const headingSpan = document.createElement('span');
      headingSpan.className = 'list-article-heading';
      headingSpan.textContent = headingText;
      button.appendChild(headingSpan);
    }

    if (item.type === 'bundle') {
      appendDisclosure(button, expandedBundleIds.has(item.id));
    } else if (Array.isArray(item.articles) && item.articles.length) {
      const searchActive = Boolean(lastSearchQuery && lastSearchQuery.trim());
      const actExpanded = searchActive
        ? !searchCollapsedActIds.has(item.id)
        : expandedActIds.has(item.id);
      if (searchActive) {
        appendHitBadge(button, countItemSearchHits(item, lastSearchQuery));
      }
      appendDisclosure(button, actExpanded);
    } else if (lastSearchQuery) {
      appendHitBadge(button, countItemSearchHits(item, lastSearchQuery));
    }

    // Clicking updates the view: toggle expand/collapse and open act, or expand bundle
    button.addEventListener('click', () => {
      if (item.type === 'bundle') {
        if (expandedBundleIds.has(item.id)) {
          expandedBundleIds.delete(item.id);
        } else {
          expandedBundleIds.add(item.id);
        }
        renderArticleList();
        handleRoute(`bundle:${item.id}`);
        updateLocationHash(`bundle:${item.id}`);
        return;
      }

      const actId = item.id;
      const hasActiveSearch = Boolean(lastSearchQuery && lastSearchQuery.trim());
      if (hasActiveSearch) {
        // During search, toggle this act's collapsed state directly.
        if (searchCollapsedActIds.has(actId)) {
          searchCollapsedActIds.delete(actId);
        } else {
          searchCollapsedActIds.add(actId);
        }
      } else {
        setExpandedAct(actId, { allowCollapse: true });
      }
      renderArticleList();
      handleRoute(`act:${actId}`);
      updateLocationHash(`act:${actId}`);
      if (!Array.isArray(item.articles) || !item.articles.length) {
        closeMobileDrawer();
      }
    });

    listItem.appendChild(button);

    // Bundle: render members (nested sub-folders and acts) as expandable children
    if (item.type === 'bundle' && expandedBundleIds.has(item.id)) {
      const memberList = buildMemberList(item);
      if (memberList) {
        listItem.appendChild(memberList);
      }
    }

    const visibleChildArticles = Array.isArray(item.articles)
      ? item.articles.filter((article) => (!lastSearchQuery || matchesItem(article, lastSearchQuery)))
      : [];

    const searchActive = Boolean(lastSearchQuery && lastSearchQuery.trim());
    const showChildren = searchActive
      ? !searchCollapsedActIds.has(item.id)
      : expandedActIds.has(item.id);

    if (item.type === 'act' && visibleChildArticles.length && showChildren) {
      const childList = document.createElement('ul');
      childList.className = 'act-article-list';

      visibleChildArticles.forEach((article) => {
        if (!article || !article.id) {
          return;
        }
        childList.appendChild(createArticleRow(article, item.id, () => {
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
        }));
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
  updateCollapseAllButton();
  if (sidePanel) {
    // Restore scroll synchronously, before the browser paints, so the full
    // list rebuild never yanks the panel to a different position (the previous
    // rAF restore painted at the wrong scroll first, causing a visible jump).
    // Adjust by the list's offset delta so a collapse button / message that
    // appears or disappears above the list doesn't shift the rows either.
    const listOffsetDelta = articleListElement.offsetTop - listOffsetBefore;
    sidePanel.scrollTop = savedScrollPosition + listOffsetDelta;

    // After layout settles, only nudge the active item into view if it ended up
    // outside the panel (e.g. breadcrumb, hash link, or keyboard navigation).
    requestAnimationFrame(() => {
      const activeKey = currentArticleSelectionKey || currentSidebarSelectionKey;
      const activeButton = activeKey ? articleButtons.get(activeKey) : null;
      if (activeButton) {
        const panelRect = sidePanel.getBoundingClientRect();
        const itemRect = activeButton.getBoundingClientRect();
        // Only pull the active item in when it's entirely out of view (e.g. hash
        // or keyboard navigation). If any part is already visible — like the row
        // the user just clicked — leave the scroll alone to avoid a jump.
        if (itemRect.bottom <= panelRect.top || itemRect.top >= panelRect.bottom) {
          activeButton.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }
    });
  }
};

const selectArticle = (articleId, options = {}) => {
  closeMobileDrawer();
  setTouchSelectedParagraph(null);
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
    const folderPath = findActFolderPath(parentActId) || [];
    if (folderPath.length) {
      // Act lives inside folder(s): expand the whole chain and the act's
      // article list so the paragraph is revealed and highlighted on the left.
      folderPath.forEach((b) => expandedBundleIds.add(b.id));
      const containing = folderPath[folderPath.length - 1];
      expandedBundleActIds.add(`${containing.id}::${parentActId}`);
      renderArticleList();
    } else {
      const wasExpanded = expandedActIds.has(parentActId);
      setExpandedAct(parentActId);
      if (!wasExpanded) {
        renderArticleList();
      }
    }
  }

  if (!visibleArticles.some((item) => item.id === articleId && item._actId === parentActId)) {
    const targetAct = allActs.find((a) => a.id === parentActId);
    if (targetAct && !actMatchesTagCriteria(targetAct)) {
      clearSelectedFilters();
    }
    searchInput.value = '';
    lastSearchQuery = '';
    visibleSidebarItems = computeVisibleSidebarItems('');
    visibleArticles = allArticles.filter((a) => {
      const pAct = allActs.find((act) => act.id === a._actId);
      return !pAct || actMatchesTagCriteria(pAct);
    });
    renderTagFilterUI();
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
    if (!actMatchesTagCriteria(act)) {
      clearSelectedFilters();
      visibleSidebarItems = computeVisibleSidebarItems(lastSearchQuery);
      visibleArticles = allArticles.filter((a) => !lastSearchQuery || matchesItem(a, lastSearchQuery));
      renderTagFilterUI();
    }
    const changedSelection = currentSidebarSelectionKey !== `act:${id}`;
    // Expand the folder chain that contains this act so it shows on the left.
    const folderPath = findActFolderPath(id) || [];
    folderPath.forEach((b) => expandedBundleIds.add(b.id));
    // render act-level view
    renderItem(act);
    currentSidebarSelectionKey = `act:${id}`;
    currentArticleSelectionKey = null;
    // clear article selection state
    currentArticleId = null;
    renderArticleList();
    updateNavigationButtons();
    updateStatus();
    // Show a newly opened act from the top (also fixes the initial load offset).
    if (changedSelection) window.scrollTo({ top: 0 });
    return true;
  }

  // bundle:<ID>
  if (raw.startsWith('bundle:')) {
    const id = raw.slice(7);
    const rawBundle = findBundleById(id);
    const bundle = (rawBundle && hasActiveTagFilters())
      ? (pruneBundleByActPredicate(rawBundle, (act) => actMatchesTagCriteria(act)) || rawBundle)
      : rawBundle;
    if (!bundle) {
      statusMessage.textContent = `Bundle ${id} not found.`;
      return true;
    }
    // Expand the containing folders so the sidebar reflects where we are.
    const ancestors = (findBundlePath(id) || [bundle]).slice(0, -1);
    ancestors.forEach((b) => expandedBundleIds.add(b.id));
    const changedSelection = currentSidebarSelectionKey !== `bundle:${id}`;
    renderItem(bundle);
    currentSidebarSelectionKey = `bundle:${id}`;
    currentArticleSelectionKey = null;
    currentArticleId = null;
    renderArticleList();
    updateNavigationButtons();
    updateStatus();
    if (changedSelection) window.scrollTo({ top: 0 });
    return true;
  }

  // Fallback to legacy article/paragraph handling
  return handleHashNavigation(raw, { behavior: 'auto', scrollIntoView: true, focusParagraph: false });
};

const handleInternalLinkClick = (event) => {
  const link = event.target.closest('a.ref, a.internal-article-link');
  if (!link) {
    return;
  }

  if (legalTooltipElement && legalTooltipElement.contains(link)) {
    hideLegalTooltipImmediate();
  }

  // Cross-act reference: resolve the id to a hosted act, else fall through
  // and let the anchor's external href open in a new tab.
  const refId = refIdOf(link);
  if (refId) {
    const targetActId = authToActId[refId];
    if (!targetActId) {
      return;
    }
    event.preventDefault();
    const articleAttr = link.dataset.article;
    if (articleAttr) {
      const articleId = artIdOf(articleAttr);
      selectArticle(articleId, {
        updateHash: false,
        focus: true,
        parentActId: targetActId,
      });
      updateLocationHash(`a:${targetActId}:${articleId}`);
    } else {
      handleRoute(`act:${targetActId}`);
      updateLocationHash(`act:${targetActId}`);
    }
    return;
  }

  // Same-act (or legacy) reference: an in-app hash target.
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

  const scopedParentActId = parentActId || getCurrentActId();

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
    const prev = visibleArticles[index - 1];
    selectArticle(prev.id, {
      parentActId: prev._actId || null,
      hashTarget: prev._actId ? `a:${prev._actId}:${prev.id}` : prev.id,
    });
  }
};

const goToNext = () => {
  const index = getCurrentIndex();
  if (index !== -1 && index < visibleArticles.length - 1) {
    const next = visibleArticles[index + 1];
    selectArticle(next.id, {
      parentActId: next._actId || null,
      hashTarget: next._actId ? `a:${next._actId}:${next.id}` : next.id,
    });
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
      .map((m) => ((m && (m.label || m.title || m.ref)) || ''))
      .join(' ')
      .replace(/<[^>]*>/g, ' ');
    const normalisedMembersText = normaliseForSearch(membersText);

    return title.includes(q) || desc.includes(q) || normalisedMembersText.includes(q);
  }

  if (item && item.type === 'act') {
    const title = normaliseForSearch(item.title || '');
    const heading = normaliseForSearch(getHeadingText(item));
    const subtitle = normaliseForSearch(getSubtitleText(item));
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

    return title.includes(q) || heading.includes(q) || subtitle.includes(q) || normalisedArticleText.includes(q) || normalisedParagraphs.includes(q);
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

const sidebarContainsSelectionKey = (items, targetKey) => {
  if (!targetKey || !Array.isArray(items)) return false;
  for (const item of items) {
    if (!item) continue;
    if (getSidebarItemKey(item) === targetKey) return true;
    if (item.type === 'bundle' && Array.isArray(item.members)) {
      for (const m of item.members) {
        if (!m) continue;
        if (m.type === 'bundle' && sidebarContainsSelectionKey([m], targetKey)) {
          return true;
        }
        if (m.ref && `act:${m.ref}` === targetKey) {
          return true;
        }
      }
    }
  }
  return false;
};

const computeVisibleSidebarItems = (normalisedQuery) => {
  const matchingActs = allActs.filter((act) => (
    actMatchesTagCriteria(act) && (!normalisedQuery || matchesItem(act, normalisedQuery))
  ));

  if (normalisedQuery) {
    return matchingActs.sort(compareByTitle);
  }

  if (!hasActiveTagFilters()) {
    return allSidebarItems.slice();
  }

  const matchingActIds = new Set(matchingActs.map((a) => a.id));
  const items = [];
  allSidebarItems.forEach((item) => {
    if (!item) return;
    if (item.type === 'bundle') {
      const pruned = pruneBundleByActPredicate(item, (act) => matchingActIds.has(act.id));
      if (pruned) items.push(pruned);
      return;
    }
    if (matchingActIds.has(item.id)) {
      items.push(item);
    }
  });
  return items;
};

const countActsForProspectiveJurisdiction = (jurCode) => {
  const nextJurisdictions = new Set(selectedJurisdictions);
  if (nextJurisdictions.has(jurCode)) {
    nextJurisdictions.delete(jurCode);
  } else {
    nextJurisdictions.add(jurCode);
  }
  return allActs.filter((act) => (
    actMatchesTagCriteria(act, nextJurisdictions, selectedTags)
    && (!lastSearchQuery || matchesItem(act, lastSearchQuery))
  )).length;
};

const countActsForProspectiveTopic = (tagId) => {
  const nextTags = new Set(selectedTags);
  nextTags.add(tagId);
  return allActs.filter((act) => (
    actMatchesTagCriteria(act, selectedJurisdictions, nextTags)
    && (!lastSearchQuery || matchesItem(act, lastSearchQuery))
  )).length;
};

const renderTagFilterUI = () => {
  const totalSelected = selectedJurisdictions.size + selectedTags.size + selectedLegalEntities.size;

  if (tagFilterCountElement) {
    tagFilterCountElement.textContent = String(totalSelected);
    tagFilterCountElement.hidden = totalSelected === 0;
  }
  if (tagFilterButton) {
    tagFilterButton.classList.toggle('has-active-filters', totalSelected > 0);
  }

  // Inline removable pills inside the search bar
  if (activeFilterPillsElement) {
    activeFilterPillsElement.innerHTML = '';
    activeFilterPillsElement.hidden = totalSelected === 0;

    const createPill = (label, onRemove, ariaRemoveLabel) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'active-filter-pill';
      pill.setAttribute('aria-label', ariaRemoveLabel);

      const textSpan = document.createElement('span');
      textSpan.className = 'active-filter-pill-label';
      textSpan.textContent = label;
      pill.appendChild(textSpan);

      const closeSpan = document.createElement('span');
      closeSpan.className = 'active-filter-pill-remove';
      closeSpan.setAttribute('aria-hidden', 'true');
      closeSpan.textContent = '\u00d7';
      pill.appendChild(closeSpan);

      pill.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onRemove();
      });
      return pill;
    };

    selectedJurisdictions.forEach((jur) => {
      activeFilterPillsElement.appendChild(
        createPill(jur, () => toggleJurisdictionTag(jur), `Remove jurisdiction filter ${jur}`),
      );
    });
    selectedTags.forEach((tagId) => {
      const label = tagLabelsById.get(tagId) || tagId;
      activeFilterPillsElement.appendChild(
        createPill(label, () => toggleTopicTag(tagId), `Remove tag filter ${label}`),
      );
    });
    selectedLegalEntities.forEach((shortName) => {
      activeFilterPillsElement.appendChild(
        createPill(
          `LE: ${shortName}`,
          () => toggleLegalEntityTag(shortName),
          `Remove legal entity filter ${shortName}`,
        ),
      );
    });
  }

  if (searchInput) {
    searchInput.placeholder = totalSelected > 0
      ? 'Search within filtered regulations...'
      : 'Search articles or keywords...';
  }

  // Popover content
  if (tagFilterPopover) {
    tagFilterPopover.innerHTML = '';

    const buildSection = (headingText, chips) => {
      const section = document.createElement('div');
      section.className = 'tag-popover-section';
      const title = document.createElement('div');
      title.className = 'tag-popover-heading';
      title.textContent = headingText;
      section.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'tag-popover-chips';
      chips.forEach((chip) => grid.appendChild(chip));
      section.appendChild(grid);
      return section;
    };

    const buildOptionButton = ({ id, label, title, count, active, kind, onClick }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-option-chip';
      btn.dataset.filterKind = kind;
      btn.dataset.filterValue = id;
      btn.classList.toggle('is-active', active);
      btn.classList.toggle('is-empty', !active && count === 0);
      btn.setAttribute('aria-pressed', String(active));
      if (title) btn.title = title;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tag-option-label';
      nameSpan.textContent = label;
      btn.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'tag-option-count';
      countSpan.textContent = String(count);
      btn.appendChild(countSpan);

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick();
      });
      return btn;
    };

    if (availableJurisdictions.length > 0) {
      const jurChips = availableJurisdictions.map((jur) => {
        const active = selectedJurisdictions.has(jur);
        const count = allActs.filter((act) => (
          getJurisdiction(act) === jur
          && actMatchesTagCriteria(act, new Set(), selectedTags)
          && (!lastSearchQuery || matchesItem(act, lastSearchQuery))
        )).length;
        return buildOptionButton({
          id: jur,
          label: jur,
          title: JURISDICTION_NAMES[jur] || jur,
          count,
          active,
          kind: 'jurisdiction',
          onClick: () => toggleJurisdictionTag(jur),
        });
      });
      tagFilterPopover.appendChild(buildSection('Jurisdiction', jurChips));
    }

    if (tagCatalog.length > 0) {
      const topicChips = tagCatalog.map((tag) => {
        const active = selectedTags.has(tag.id);
        const count = countActsForProspectiveTopic(tag.id);
        return buildOptionButton({
          id: tag.id,
          label: tag.label,
          title: '',
          count,
          active,
          kind: 'topic',
          onClick: () => toggleTopicTag(tag.id),
        });
      });
      tagFilterPopover.appendChild(buildSection('Topics', topicChips));
    }

    const legalEntities = getKnownLegalEntities();
    if (legalEntities.length > 0) {
      const entityChips = legalEntities.map((entity) => {
        const nextEntities = new Set(selectedLegalEntities).add(entity.shortName);
        const count = allActs.filter((act) => (
          actMatchesTagCriteria(act, selectedJurisdictions, selectedTags, nextEntities)
          && (!lastSearchQuery || matchesItem(act, lastSearchQuery))
        )).length;
        return buildOptionButton({
          id: entity.shortName,
          label: entity.shortName,
          title: entity.name,
          count,
          active: selectedLegalEntities.has(entity.shortName),
          kind: 'legal-entity',
          onClick: () => toggleLegalEntityTag(entity.shortName),
        });
      });
      tagFilterPopover.appendChild(buildSection('Legal entity', entityChips));
    }

    if (totalSelected > 0) {
      const footer = document.createElement('div');
      footer.className = 'tag-popover-footer';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'tag-clear-button';
      clearBtn.textContent = 'Clear all filters';
      clearBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        clearTagFilters();
      });
      footer.appendChild(clearBtn);
      tagFilterPopover.appendChild(footer);
    }
  }

  // Keep current act header tag state synced if an act overview is open
  if (currentSidebarSelectionKey && currentSidebarSelectionKey.startsWith('act:') && !currentArticleId) {
    renderActTopicTags(currentSidebarSelectionKey.slice(4));
  }
  // ...and the legal-entity chips' active state on act and folder overviews
  if (currentSidebarSelectionKey && !currentArticleId) {
    const [kind, ...rest] = currentSidebarSelectionKey.split(':');
    if (kind === 'act' || kind === 'bundle') renderLegalEntityApplicability(rest.join(':'));
  }
};

const closeTagPopover = () => {
  if (!tagFilterPopover || !tagFilterButton) return;
  tagFilterPopover.hidden = true;
  tagFilterButton.setAttribute('aria-expanded', 'false');
};

const toggleTagPopover = () => {
  if (!tagFilterPopover || !tagFilterButton) return;
  const willOpen = tagFilterPopover.hidden;
  if (willOpen) {
    renderTagFilterUI();
  }
  tagFilterPopover.hidden = !willOpen;
  tagFilterButton.setAttribute('aria-expanded', String(willOpen));
};

const toggleJurisdictionTag = (jurCode) => {
  if (!jurCode) return;
  if (selectedJurisdictions.has(jurCode)) {
    selectedJurisdictions.delete(jurCode);
  } else {
    selectedJurisdictions.add(jurCode);
  }
  applyFilter(searchInput ? searchInput.value : lastSearchQuery);
};

const toggleTopicTag = (tagId) => {
  if (!tagId) return;
  if (selectedTags.has(tagId)) {
    selectedTags.delete(tagId);
  } else {
    selectedTags.add(tagId);
  }
  applyFilter(searchInput ? searchInput.value : lastSearchQuery);
};

const toggleLegalEntityTag = (shortName) => {
  if (!shortName) return;
  if (selectedLegalEntities.has(shortName)) {
    selectedLegalEntities.delete(shortName);
  } else {
    selectedLegalEntities.add(shortName);
  }
  applyFilter(searchInput ? searchInput.value : lastSearchQuery);
};

const clearTagFilters = () => {
  if (!hasActiveTagFilters()) return;
  clearSelectedFilters();
  applyFilter(searchInput ? searchInput.value : lastSearchQuery);
};

const applyFilter = (query) => {
  const normalisedQuery = `${query || ''}`.trim().toLowerCase();
  if (normalisedQuery !== lastSearchQuery) {
    // A new/changed query starts fresh with every matching act expanded.
    searchCollapsedActIds = new Set();
    if (normalisedQuery && isMobileDrawerViewport() && document.activeElement === searchInput) {
      setMobileDrawerOpen(true);
    }
  }
  lastSearchQuery = normalisedQuery;

  visibleSidebarItems = computeVisibleSidebarItems(normalisedQuery);
  visibleArticles = allArticles.filter((article) => {
    const parentAct = allActs.find((a) => a.id === article._actId);
    return (!parentAct || actMatchesTagCriteria(parentAct))
      && (!normalisedQuery || matchesItem(article, normalisedQuery));
  });

  renderTagFilterUI();
  renderArticleList();
  requestAnimationFrame(syncTopbarHeightVar);

  if (!visibleSidebarItems.length) {
    currentArticleId = null;
    currentSidebarSelectionKey = null;
    currentArticleSelectionKey = null;
    renderArticleDetail(null);
    updateNavigationButtons();
    updateStatus();
    highlightActiveLink();
    return;
  }

  const hasVisibleSelectedSidebarItem = sidebarContainsSelectionKey(
    visibleSidebarItems,
    currentSidebarSelectionKey,
  );

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
  } else if (currentSidebarSelectionKey && currentSidebarSelectionKey.startsWith('bundle:')) {
    // Re-render open bundle view so its member cards reflect pruned members immediately
    const bundleId = currentSidebarSelectionKey.slice(7);
    const rawBundle = findBundleById(bundleId);
    if (rawBundle) {
      const pruned = hasActiveTagFilters()
        ? (pruneBundleByActPredicate(rawBundle, (act) => actMatchesTagCriteria(act)) || rawBundle)
        : rawBundle;
      renderBundle(pruned);
    }
    updateNavigationButtons();
    updateStatus();
  } else {
    updateNavigationButtons();
    updateStatus();
  }

  // Always refresh highlights in the currently rendered view so typing
  // or deleting characters updates visible highlights immediately.
  highlightSearchMatches(lastSearchQuery);
};

let searchDebounceTimer = null;

const handleSearchInput = (event) => {
  const value = event.target.value;
  if (searchDebounceTimer) {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // Clearing the field should feel instant; typing is debounced.
  if (!value.trim()) {
    applyFilter(value);
    return;
  }

  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = null;
    applyFilter(value);
  }, 180);
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

// Lightweight CELEX metadata generated by tools/build_index_db.py.
const loadIndexMeta = async () => {
  const res = await fetch('data/index_meta.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load index meta: ${res.status}`);
  }
  return res.json();
};

const loadLegalEntityApplicability = async () => {
  const res = await fetch('data/legal_entity_applicability.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load legal entity applicability: ${res.status}`);
  }
  return res.json();
};

const loadDefinitions = async () => {
  const res = await fetch('data/definitions.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load definitions: ${res.status}`);
  }
  return res.json();
};

// Load each act and bundle referenced by the registry. Returns { acts, bundles }.
const loadAllData = async () => {
  const registry = await loadRegistry();

  tagCatalog = Array.isArray(registry.tagCatalog) ? registry.tagCatalog : [];
  tagLabelsById = new Map(tagCatalog.map((t) => [t.id, t.label || t.id]));
  actTagsById = {};
  actRegistryEntriesById = {};
  const catalogIds = new Set(tagCatalog.map((t) => t.id));
  (registry.acts || []).forEach((entry) => {
    if (!entry || !entry.id) return;
    actRegistryEntriesById[entry.id] = entry;
    const validTags = Array.isArray(entry.tags)
      ? entry.tags.filter((t) => typeof t === 'string' && (!catalogIds.size || catalogIds.has(t)))
      : [];
    actTagsById[entry.id] = validTags;
  });

  legalEntitiesByItemId = {};
  try {
    const applicability = await loadLegalEntityApplicability();
    legalEntitiesByItemId = {
      ...((applicability && applicability.actEntities) || {}),
      ...((applicability && applicability.bundleEntities) || {}),
      ...((applicability && applicability.familyEntities) || {}),
    };
  } catch (error) {
    console.warn('Legal entity applicability is unavailable:', error);
  }

  definitionsByActId = {};
  compiledDefinitionMatchers.clear();
  try {
    definitionsByActId = (await loadDefinitions()) || {};
  } catch (error) {
    console.warn('Term definitions are unavailable:', error);
  }

  // Scheme-qualified id -> app act id: the runtime bridge for cross-act references.
  // data/index.json remains the source of truth for app content; index_meta.json is
  // just a compact id->celex map for this runtime lookup.
  authToActId = {};
  try {
    const indexMeta = await loadIndexMeta();
    const idToCelex = (indexMeta && indexMeta.idToCelex) || {};
    Object.entries(idToCelex).forEach(([id, celex]) => {
      if (!id || !celex) return;
      authToActId[`celex:${celex}`] = id;
    });
  } catch (error) {
    console.warn('Falling back to registry authId map:', error);
    (registry.acts || []).forEach((entry) => {
      if (!entry) return;
      if (entry.authId) {
        authToActId[entry.authId] = entry.id;
      } else if (entry.celex) {
        authToActId[`celex:${entry.celex}`] = entry.id;   // legacy registry entries
      }
    });
  }

  const actFetches = (registry.acts || []).map(async (entry) => {
    const res = await fetch(entry.path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch act ${entry.id} (${entry.path}): ${res.status}`);
    }
    const json = await res.json();

    if (Array.isArray(json)) {
      return {
        type: 'act',
        id: entry.id,
        title: entry.label || entry.id,
        heading: entry.heading || '',
        source: {
          uri: '',
          label: 'EUR-Lex',
        },
        meta: {
          jurisdiction: entry.jurisdiction || 'EU',
        },
        articles: json,
      };
    }

    if (!json || json.type !== 'act') {
      console.warn('Skipped non-act file', entry);
      return null;
    }

    return json;
  });

  const bundleFetches = (registry.bundles || []).map(async (entry) => {
    const res = await fetch(entry.path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch bundle ${entry.id} (${entry.path}): ${res.status}`);
    }
    const json = await res.json();
    if (!json || json.type !== 'bundle') {
      console.warn('Skipped non-bundle file', entry);
      return null;
    }
    return json;
  });

  const [fetchedActs, fetchedBundles] = await Promise.all([
    Promise.all(actFetches),
    Promise.all(bundleFetches),
  ]);

  const rawActs = fetchedActs.filter(Boolean);
  const bundles = fetchedBundles.filter(Boolean).sort(compareByTitle);
  const actsById = new Map(rawActs.map((a) => [a.id, a]));

  // Order `acts` deterministically to match the visual sidebar tree:
  // 1. Folders (alphabetical) and their members in exact depth-first order
  // 2. Remaining standalone acts (alphabetical)
  const orderedActs = [];
  const seenActIds = new Set();
  const appendBundleActsInOrder = (bundleList) => {
    (bundleList || []).forEach((b) => {
      ((b && b.members) || []).forEach((m) => {
        if (!m) return;
        if (m.type === 'bundle') {
          appendBundleActsInOrder([m]);
        } else if (m.ref && !seenActIds.has(m.ref) && actsById.has(m.ref)) {
          seenActIds.add(m.ref);
          orderedActs.push(actsById.get(m.ref));
        }
      });
    });
  };
  appendBundleActsInOrder(bundles);

  rawActs
    .filter((a) => !seenActIds.has(a.id))
    .sort(compareByTitle)
    .forEach((a) => {
      seenActIds.add(a.id);
      orderedActs.push(a);
    });

  // Flatten acts into article-level entries in exact sidebar navigation order
  const flattenedArticles = [];
  orderedActs.forEach((act) => {
    if (Array.isArray(act.articles)) {
      act.articles.forEach((a) => {
        const article = Object.assign({}, a);
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

  return { acts: orderedActs, bundles, articles: flattenedArticles };
};

const fetchArticles = async () => {
  const articleContent = document.querySelector('.article-content');
  if (articleContent) articleContent.classList.add('is-loading');
  if (articleNav) articleNav.hidden = true;
  listMessage.textContent = '';
  if (articleListElement) {
    articleListElement.innerHTML = '';
    articleListElement.appendChild(buildSidebarSkeleton());
  }
  if (paragraphsContainer) {
    paragraphsContainer.innerHTML = '';
    paragraphsContainer.appendChild(buildLoadingState());
  }

  try {
    const { acts, bundles, articles } = await loadAllData();

    allActs = acts;
    allBundles = bundles;

    const jurSet = new Set(allActs.map((a) => getJurisdiction(a)).filter(Boolean));
    availableJurisdictions = ['EU', 'DE', ...Array.from(jurSet).filter((j) => j !== 'EU' && j !== 'DE').sort()]
      .filter((j) => jurSet.has(j));

    // Maintain the old `allArticles` array used by the UI by using the flattened articles
    allArticles = Array.isArray(articles) ? articles : [];

    // Acts that live inside a folder are shown within that folder only, not
    // duplicated as top-level sidebar entries.
    const collectBundleActRefs = (bundleList, acc = new Set()) => {
      (bundleList || []).forEach((b) => {
        (b && b.members || []).forEach((m) => {
          if (!m) return;
          if (m.type === 'bundle') collectBundleActRefs([m], acc);
          else if (m.ref) acc.add(m.ref);
        });
      });
      return acc;
    };
    const foldered = collectBundleActRefs(allBundles);
    const topLevelActs = allActs.filter((a) => !foldered.has(a.id));

    // Folders first (alphabetical), then acts (alphabetical).
    allSidebarItems = [
      ...allBundles.slice().sort(compareByTitle),
      ...topLevelActs.sort(compareByTitle),
    ];
    expandedActIds = new Set();
    expandedBundleIds = new Set();
    expandedBundleActIds = new Set();

    if (!allSidebarItems.length) {
      statusMessage.textContent = 'No acts available at this time.';
      listMessage.textContent = 'No acts available at this time.';
      renderArticleDetail(null);
      updateNavigationButtons();
      return;
    }

    visibleArticles = [...allArticles];
    visibleSidebarItems = [...allSidebarItems];
    renderTagFilterUI();
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
  } finally {
    if (articleContent) articleContent.classList.remove('is-loading');
  }
};

// Clicking the box around the pills/text focuses the field (pill clicks stop propagation).
const searchInputShell = searchInput.closest('.search-input-shell');
if (searchInputShell) {
  searchInputShell.addEventListener('click', (event) => {
    if (event.target === searchInputShell || event.target.id === 'activeFilterPills') {
      searchInput.focus();
    }
  });
}

searchInput.addEventListener('input', (event) => {
  updateSearchShortcutHint();
  handleSearchInput(event);
});
searchInput.addEventListener('focus', () => updateSearchShortcutHint());
searchInput.addEventListener('blur', () => updateSearchShortcutHint());
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && searchInput.value.trim()) {
    event.preventDefault();
    if (searchDebounceTimer) {
      window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
      applyFilter(searchInput.value);
    } else {
      stepSearchMatch(event.shiftKey ? -1 : 1);
    }
    return;
  }
  if (event.key === 'Escape') {
    if (searchInput.value) {
      event.preventDefault();
      searchInput.value = '';
      updateSearchShortcutHint();
      applyFilter('');
    } else {
      searchInput.blur();
    }
    return;
  }
  if (event.key === 'Backspace' && !searchInput.value && hasActiveTagFilters()) {
    // Remove the most recently added entity filter, then topic tags, then jurisdictions
    if (selectedLegalEntities.size > 0) {
      toggleLegalEntityTag(Array.from(selectedLegalEntities).pop());
    } else if (selectedTags.size > 0) {
      const lastTag = Array.from(selectedTags).pop();
      toggleTopicTag(lastTag);
    } else if (selectedJurisdictions.size > 0) {
      const lastJur = Array.from(selectedJurisdictions).pop();
      toggleJurisdictionTag(lastJur);
    }
  }
});

if (searchPrevMatchButton) {
  searchPrevMatchButton.addEventListener('click', () => stepSearchMatch(-1));
}
if (searchNextMatchButton) {
  searchNextMatchButton.addEventListener('click', () => stepSearchMatch(1));
}

if (tagFilterButton) {
  tagFilterButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleTagPopover();
  });
}

if (mobileNavToggleButton) {
  mobileNavToggleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    closeTagPopover();
    toggleMobileDrawer();
  });
}

if (mobileDrawerBackdrop) {
  mobileDrawerBackdrop.addEventListener('click', () => {
    closeMobileDrawer();
  });
}

if (mobileDrawerCloseButton) {
  mobileDrawerCloseButton.addEventListener('click', () => {
    closeMobileDrawer();
  });
}

document.addEventListener('click', (event) => {
  // Tap-to-reveal paragraph copy tools on touch / narrow viewports without interfering with links or defined terms
  const interactiveHit = event.target && typeof event.target.closest === 'function'
    ? event.target.closest('a, button, .defined-term, .paragraph-tools')
    : null;
  const tappedParagraph = !interactiveHit && event.target && typeof event.target.closest === 'function'
    ? event.target.closest('.article-paragraph.has-paragraph-tools')
    : null;
  if (tappedParagraph && isMobileDrawerViewport()) {
    setTouchSelectedParagraph(
      activeTouchParagraph === tappedParagraph ? null : tappedParagraph,
    );
  } else if (!event.target?.closest?.('.paragraph-tools')) {
    setTouchSelectedParagraph(null);
  }

  if (!tagFilterPopover || tagFilterPopover.hidden) return;
  if (
    tagFilterPopover.contains(event.target)
    || (tagFilterButton && tagFilterButton.contains(event.target))
  ) {
    return;
  }
  closeTagPopover();
});

const isEditableElement = (el) => Boolean(
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable),
);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isMobileDrawerOpen) {
    closeMobileDrawer();
    if (mobileNavToggleButton) mobileNavToggleButton.focus();
    return;
  }
  if (event.key === 'Escape' && tagFilterPopover && !tagFilterPopover.hidden) {
    closeTagPopover();
    if (tagFilterButton) tagFilterButton.focus();
    return;
  }

  // Global Ctrl+K / Cmd+K or '/' focuses search
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  if (isEditableElement(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === '/') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  // '[' and ']' navigate previous/next article when in single-article view
  if (event.key === '[' && articleNav && !articleNav.hidden && !prevButton.disabled) {
    event.preventDefault();
    goToPrevious();
  } else if (event.key === ']' && articleNav && !articleNav.hidden && !nextButton.disabled) {
    event.preventDefault();
    goToNext();
  }
});

if (scrollTopButton) {
  scrollTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

window.addEventListener('scroll', () => {
  if (scrollTopButton) {
    scrollTopButton.hidden = window.scrollY < 520;
  }
  updateStickyContextBar();
}, { passive: true });

prevButton.addEventListener('click', goToPrevious);
nextButton.addEventListener('click', goToNext);
if (collapseAllButton) {
  collapseAllButton.addEventListener('click', collapseAll);
}

const pageHeader = document.getElementById('pageHeader');
const headerToggle = document.getElementById('headerToggle');
if (pageHeader && headerToggle) {
  headerToggle.addEventListener('click', () => {
    const collapsed = pageHeader.classList.toggle('is-collapsed');
    headerToggle.setAttribute('aria-expanded', String(!collapsed));
    headerToggle.setAttribute('aria-label', collapsed ? 'Expand header' : 'Collapse header');
  });
}

window.addEventListener('hashchange', () => {
  if (isUpdatingHash) {
    isUpdatingHash = false;
    return;
  }

  const hashId = window.location.hash ? window.location.hash.replace('#', '') : '';
  // delegate to unified route handler
  handleRoute(hashId);
});

// Don't let the browser restore a previous scroll position on load.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

window.addEventListener('resize', () => {
  syncTopbarHeightVar();
  if (!isMobileDrawerViewport() && isMobileDrawerOpen) {
    closeMobileDrawer();
  }
  updateStickyContextBar();
});

if (typeof ResizeObserver === 'function' && searchBarElement) {
  const topbarObserver = new ResizeObserver(() => {
    syncTopbarHeightVar();
  });
  topbarObserver.observe(searchBarElement);
}
syncTopbarHeightVar();

document.addEventListener('DOMContentLoaded', fetchArticles);

initialiseLegalTooltips();
document.addEventListener('click', handleInternalLinkClick);

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

// Inline SVG icons for the copy tools (Feather/Lucide, 24x24 stroke).
const TOOL_SVG = (inner) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

const TOOL_ICONS = {
  text: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
  citation: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path>',
  success: '<polyline points="20 6 9 17 4 12"></polyline>',
  error: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
};

const showCopyConfirmation = (button, label, { isSuccess = true } = {}) => {
  if (!button) {
    return;
  }

  if (button.dataset.originalHtml === undefined) {
    button.dataset.originalHtml = button.innerHTML;
  }

  if (button._copyTimeoutId) {
    clearTimeout(button._copyTimeoutId);
    button._copyTimeoutId = null;
  }

  button.innerHTML = TOOL_SVG(isSuccess ? TOOL_ICONS.success : TOOL_ICONS.error);
  if (isSuccess) {
    button.classList.add('is-copied');
    button.classList.remove('has-copy-error');
  } else {
    button.classList.add('has-copy-error');
    button.classList.remove('is-copied');
  }

  button._copyTimeoutId = window.setTimeout(() => {
    button.innerHTML = button.dataset.originalHtml;
    button.classList.remove('is-copied');
    button.classList.remove('has-copy-error');
    button._copyTimeoutId = null;
  }, 1400);
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

  const descriptorParts = [`paragraph ${primaryValue}${primarySuffix || ''}`];

  segments.slice(1).forEach((segment) => {
    const subparaMatch = segment.match(/^s(\d+)$/i);
    if (subparaMatch) {
      descriptorParts.push(`subparagraph ${subparaMatch[1]}`);
      return;
    }
    if (segment === 'dash') {
      return;
    }
    const { value, suffix } = parseParagraphToken(segment);
    if (value) {
      descriptorParts.push(`(${value}${suffix || ''})`);
    } else {
      descriptorParts.push(`(${segment})`);
    }
  });

  return descriptorParts.join(' ');
};

const getParagraphCitation = (article, paragraphData) => {
  const articleTitle = (article?.title || article?.id || '').trim();
  const actId = article?._actId || getCurrentActId();
  const act = allActs.find((item) => item.id === actId);
  const regulationName = (act?.title || '').trim();

  const paragraphId = typeof paragraphData === 'object' ? (paragraphData?.id || '') : '';
  const paragraphDescriptor = formatParagraphDescriptor(paragraphId);
  const baseCitation = [regulationName, articleTitle].filter(Boolean).join(' ');

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
  clone.querySelectorAll('.list-item-marker').forEach((marker) => {
    marker.textContent = `${marker.textContent} `;
  });

  return clone.textContent
    .replace(/\s+\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const buildPermalink = (hash) => {
  try {
    return new URL(`#${hash}`, window.location.href).href;
  } catch (error) {
    return `${window.location.origin}${window.location.pathname}${window.location.search}#${hash}`;
  }
};

const getParagraphPermalink = (paragraphId) => {
  if (!paragraphId) {
    return window.location.href;
  }

  // Scope the permalink to the act currently being viewed so the same paragraph
  // id shared across multiple acts (e.g. "art_6") resolves to the correct one
  // when the link is opened in a new tab.
  const currentActId = currentSidebarSelectionKey && currentSidebarSelectionKey.startsWith('act:')
    ? currentSidebarSelectionKey.slice(4)
    : null;
  return buildPermalink(currentActId ? `a:${currentActId}:${paragraphId}` : paragraphId);
};

const getArticlePermalink = (actId, articleId) =>
  buildPermalink(actId ? `a:${actId}:${articleId}` : articleId);

const getActPermalink = (actId) => buildPermalink(`act:${actId}`);

const getArticleHeadingText = (article) =>
  [article?.title, getHeadingText(article)].filter(Boolean).join(' — ').trim();

const getArticleCitation = (article, actId) => {
  const act = allActs.find((item) => item.id === actId);
  const regulationName = (act?.title || '').trim();
  const articleTitle = (article?.title || article?.id || '').trim();
  return [regulationName, articleTitle].filter(Boolean).join(' ');
};

const getActHeadingText = (act) =>
  [act?.title, act?.heading].filter(Boolean).join(' — ').trim();

const getActCitation = (act) => (act?.title || act?.id || '').trim();

const getBundlePermalink = (bundleId) => buildPermalink(`bundle:${bundleId}`);

const getBundleHeadingText = (bundle) => (bundle?.title || bundle?.id || '').trim();


// --- Search highlighting helpers ---
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

const updateSearchShortcutHint = () => {
  if (!searchShortcutHintElement || !searchInput) return;
  const hideHint = Boolean(searchInput.value) || document.activeElement === searchInput;
  searchShortcutHintElement.classList.toggle('is-hidden', hideHint);
};

const updateSearchMatchStepperUI = () => {
  if (!searchMatchStepperElement || !searchMatchCountElement) return;
  const hasQuery = Boolean(lastSearchQuery && lastSearchQuery.trim());
  if (!hasQuery) {
    searchMatchStepperElement.hidden = true;
    return;
  }

  const total = activeSearchMarks.length;
  searchMatchStepperElement.hidden = false;
  if (total === 0) {
    searchMatchCountElement.textContent = '0 matches';
    if (searchPrevMatchButton) searchPrevMatchButton.disabled = true;
    if (searchNextMatchButton) searchNextMatchButton.disabled = true;
    return;
  }

  const displayIdx = currentSearchHitIndex >= 0 ? currentSearchHitIndex + 1 : 1;
  searchMatchCountElement.textContent = `${displayIdx} / ${total}`;
  if (searchPrevMatchButton) searchPrevMatchButton.disabled = total <= 1;
  if (searchNextMatchButton) searchNextMatchButton.disabled = total <= 1;
};

const focusSearchMatchAt = (targetIndex, { scroll = true } = {}) => {
  const total = activeSearchMarks.length;
  if (!total) {
    currentSearchHitIndex = -1;
    updateSearchMatchStepperUI();
    return;
  }

  activeSearchMarks.forEach((mark) => mark.classList.remove('is-current-hit'));
  const wrapped = ((targetIndex % total) + total) % total;
  currentSearchHitIndex = wrapped;
  const currentMark = activeSearchMarks[wrapped];
  if (currentMark) {
    currentMark.classList.add('is-current-hit');
    if (scroll) {
      try {
        currentMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (error) {
        currentMark.scrollIntoView();
      }
    }
  }
  updateSearchMatchStepperUI();
};

const stepSearchMatch = (delta) => {
  if (!activeSearchMarks.length) return;
  const base = currentSearchHitIndex >= 0 ? currentSearchHitIndex : 0;
  focusSearchMatchAt(base + delta, { scroll: true });
};

const highlightSearchMatches = (query) => {
  const container = paragraphsContainer;
  if (!container) return;
  removeExistingHighlights(container);
  [articleNumberElement, articleTitleElement, articleSubtitleElement].forEach((el) => {
    if (el) removeExistingHighlights(el);
  });

  activeSearchMarks = [];
  currentSearchHitIndex = -1;

  const q = `${query || ''}`.trim();
  if (!q) {
    updateSearchMatchStepperUI();
    return;
  }

  const pattern = escapeRegExp(q);
  let regex;
  try {
    regex = new RegExp(pattern, 'gi');
  } catch (e) {
    updateSearchMatchStepperUI();
    return;
  }

  // Highlight in article number, title, and subtitle
  [articleNumberElement, articleTitleElement, articleSubtitleElement].forEach((el) => {
    if (el && el.textContent) {
      highlightMatchesInNode(el, regex);
    }
  });

  // Highlight in per-article headings, paragraphs, and bundle descriptions
  const targets = container.querySelectorAll(
    '.act-article-title-link, .article-paragraph, .bundle-description',
  );
  targets.forEach((p) => {
    highlightMatchesInNode(p, regex);
  });

  activeSearchMarks = [
    ...(articleHeaderElement ? articleHeaderElement.querySelectorAll('mark.search-hit') : []),
    ...container.querySelectorAll('mark.search-hit'),
  ];

  if (activeSearchMarks.length > 0) {
    focusSearchMatchAt(0, { scroll: false });
  } else {
    updateSearchMatchStepperUI();
  }
};

const showCopyToast = (message, { isSuccess = true } = {}) => {
  if (!copyToastElement || !message) return;
  if (copyToastTimer) {
    clearTimeout(copyToastTimer);
    copyToastTimer = null;
  }

  copyToastElement.innerHTML = '';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'copy-toast-accent';
  iconSpan.textContent = isSuccess ? '\u2713' : '\u2715';
  copyToastElement.appendChild(iconSpan);

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  copyToastElement.appendChild(textSpan);

  copyToastElement.hidden = false;
  copyToastTimer = window.setTimeout(() => {
    copyToastElement.hidden = true;
    copyToastTimer = null;
  }, 1900);
};

const createToolsWrapper = (actions, ariaLabel = 'Tools') => {
  const toolsWrapper = document.createElement('span');
  toolsWrapper.className = 'paragraph-tools';
  toolsWrapper.setAttribute('role', 'group');
  toolsWrapper.setAttribute('aria-label', ariaLabel);

  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'paragraph-tool-button';
    button.innerHTML = TOOL_SVG(TOOL_ICONS[action.key] || '');
    button.title = `Copy ${action.label.toLowerCase()}`;
    button.setAttribute('aria-label', action.ariaLabel);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const content = action.getContent();
      if (!content) {
        showCopyConfirmation(button, 'Error', { isSuccess: false });
        showCopyToast('Unable to copy to clipboard', { isSuccess: false });
        return;
      }

      const succeeded = await copyToClipboard(content);
      showCopyConfirmation(button, succeeded ? 'Copied' : 'Error', { isSuccess: succeeded });
      if (succeeded) {
        const preview = action.key === 'citation' && content.length <= 64
          ? `Copied citation: ${content}`
          : `Copied ${action.label.toLowerCase()} to clipboard`;
        showCopyToast(preview, { isSuccess: true });
      } else {
        showCopyToast('Unable to copy to clipboard', { isSuccess: false });
      }
    });

    toolsWrapper.appendChild(button);
  });

  return toolsWrapper;
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

  paragraphElement.appendChild(createToolsWrapper(actions, 'Paragraph tools'));
};

// Copy/link/citation tools for a heading element (article heading or act root title).
const attachHeadingTools = (element, { getText, getLink, getCitation }) => {
  if (!element) {
    return;
  }

  element.classList.add('has-paragraph-tools');

  const actions = [
    { key: 'text', label: 'Text', ariaLabel: 'Copy heading text to clipboard', getContent: getText },
    { key: 'link', label: 'Link', ariaLabel: 'Copy direct link', getContent: getLink },
    { key: 'citation', label: 'Citation', ariaLabel: 'Copy citation', getContent: getCitation },
  ];

  element.appendChild(createToolsWrapper(actions, 'Heading tools'));
};
