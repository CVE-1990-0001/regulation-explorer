const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const snippetCache = new Map();

const MAX_SNIPPET_LENGTH = 450;

const inputFile = process.argv[2];
if (!inputFile) {
    console.error('Usage: node parser.js <input.html> [output.json]');
    process.exit(1);
}
if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
}

const outputFile = process.argv[3] || inputFile.replace(/\.html$/i, '.json');

const html = fs.readFileSync(inputFile, 'utf8');

const $ = cheerio.load(html);

const articles = [];
const internalArticleIds = new Map();
const processedTables = new WeakSet();

const bulletSpacingPattern = /^(\([a-z0-9ivxlcdm]+\))(\S)/i;

const springlexMappings = {
    'Regulation (EU) 2022/2554': {
        baseUrl: 'https://www.springlex.eu/en/packages/dora/dora-regulation/',
        articlePath: (articleSlug) => `article-${articleSlug}/`,
        label: 'Digital Operational Resilience Act (DORA)',
    },
};

const escapeAttribute = (value) => (value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeHtml = (value) => (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const padDocumentNumber = (numberString) => {
    const clean = `${numberString || ''}`.replace(/\D/g, '');
    if (!clean) {
        return '';
    }
    return clean.padStart(4, '0');
};

const normaliseYear = (value) => {
    const numeric = parseInt(value, 10);
    if (Number.isNaN(numeric)) {
        return null;
    }
    if (numeric > 1900) {
        return numeric;
    }
    if (numeric >= 100) {
        return 1900 + (numeric % 100);
    }
    return numeric >= 50 ? 1900 + numeric : 2000 + numeric;
};

const celexLetterForType = (type) => {
    if (!type) {
        return 'R';
    }
    const lower = type.toLowerCase();
    if (lower.includes('directive')) {
        return 'L';
    }
    if (lower.includes('decision')) {
        return 'D';
    }
    return 'R';
};

const buildEurLexUrl = (docType, year, docNumber) => {
    const letter = celexLetterForType(docType);
    const paddedNumber = padDocumentNumber(docNumber);
    if (!year || !paddedNumber) {
        return null;
    }
    return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:3${year}${letter}${paddedNumber}`;
};

const buildCelexId = (docType, year, docNumber) => {
    const letter = celexLetterForType(docType);
    const paddedNumber = padDocumentNumber(docNumber);
    if (!year || !paddedNumber) {
        return null;
    }
    return `3${year}${letter}${paddedNumber}`;
};

const normaliseArticleIdentifier = (value) => {
    if (!value) {
        return null;
    }
    return value
        .replace(/\s+/g, '')
        .replace(/[A-Z]+/g, (match) => match.toLowerCase());
};

const truncateSnippet = (value, maxLength = MAX_SNIPPET_LENGTH) => {
    if (!value || value.length <= maxLength) {
        return value;
    }
    const truncated = value.slice(0, maxLength);
    const safe = truncated.replace(/\s+\S*$/, '');
    return `${safe}...`;
};

const articleSlugFromReference = (articleNumber) => {
    if (!articleNumber) {
        return null;
    }
    const slug = `${articleNumber}`
        .toLowerCase()
        .replace(/[^a-z0-9()/\s-]+/g, '')
        .replace(/[()]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^-/, '')
        .replace(/-$/, '');
    if (!slug) {
        return null;
    }
    return slug;
};

const getSpringlexUrl = (key, articleNumber) => {
    const mapping = springlexMappings[key];
    if (!mapping) {
        return null;
    }

    if (articleNumber) {
        const articleSlug = articleSlugFromReference(articleNumber);
        if (articleSlug) {
            return `${mapping.baseUrl}${mapping.articlePath(articleSlug)}`;
        }
    }

    return mapping.baseUrl;
};

const registerInternalArticle = (articleLabel, articleId) => {
    if (!articleLabel || !articleId) {
        return;
    }

    const match = `${articleLabel}`.match(/Article\s+([0-9]+[a-z]*)/i);
    if (!match) {
        return;
    }

    const key = match[1].toLowerCase();
    if (!internalArticleIds.has(key)) {
        internalArticleIds.set(key, articleId);
    }
};

const extractInternalArticleKey = (identifier) => {
    if (!identifier) {
        return null;
    }

    const trimmed = `${identifier}`.trim();
    if (!trimmed) {
        return null;
    }

    const match = trimmed.match(/^([0-9]+[a-z]*)/i);
    if (!match) {
        return null;
    }

    return match[1].toLowerCase();
};

const buildInternalArticleLink = (displayText, identifier) => {
    if (!displayText || !identifier) {
        return null;
    }

    const segments = splitIdentifierSegments(identifier);
    if (!segments.length) {
        return null;
    }

    const articleKey = `${segments[0]}`.toLowerCase();
    const articleId = internalArticleIds.get(articleKey);
    if (!articleId) {
        return null;
    }

    let href = `#${articleId}`;

    if (segments.length > 1) {
        const paragraphId = buildParagraphAnchorId(articleId, segments.slice(1));
        if (paragraphId) {
            href = `#${paragraphId}`;
        }
    }

    const safeHref = escapeAttribute(href);
    const safeDisplay = escapeHtml(displayText);
    return `<a href="${safeHref}" class="internal-article-link" target="_blank" rel="noopener">${safeDisplay}</a>`;
};

const articleIdentifierPatternSource = '[0-9][0-9a-z]*(?:\\([^)]+\\))*';
const pluralInternalArticlePattern = new RegExp(
    `\\bArticles\\s+((?:${articleIdentifierPatternSource})(?:\\s*(?:,|and|or|to|-)\\s*(?:${articleIdentifierPatternSource}))*)`,
    'gi',
);
const singularInternalArticlePattern = new RegExp(
    `\\bArticle\\s+(${articleIdentifierPatternSource})`,
    'gi',
);
const internalArticleIdentifierPattern = new RegExp(articleIdentifierPatternSource, 'gi');

const shouldSkipInternalLink = (source, offset, matchLength, additionalRemainder = '') => {
    if (typeof source !== 'string' || typeof offset !== 'number' || typeof matchLength !== 'number') {
        return false;
    }

    const remainderWithinNode = source.slice(offset + matchLength);
    const remainder = `${remainderWithinNode}${additionalRemainder || ''}`;
    if (!remainder) {
        return false;
    }

    const trimmed = remainder.trimStart().toLowerCase();
    if (!trimmed) {
        return false;
    }

    let sanitised = trimmed;
    const leadingPattern = /^(?:[,;\s]*(?:and|or|to|-)\s*|\([^)]+\)\s*)/;
    while (leadingPattern.test(sanitised)) {
        sanitised = sanitised.replace(leadingPattern, '').trimStart();
    }

    const allowPatterns = [
        /^of\s+this\s+regulation\b/,
        /^of\s+the\s+regulation\b/,
    ];
    if (allowPatterns.some((pattern) => pattern.test(trimmed) || pattern.test(sanitised))) {
        return false;
    }

    const externalInstrumentPattern = /^of\s+(?:the\s+)?(?:[a-z]+\s+){0,6}(directive|regulation|decision|treaty)(?=\s|[0-9(,.;:])/;
    if (externalInstrumentPattern.test(trimmed) || externalInstrumentPattern.test(sanitised)) {
        return true;
    }

    const skipPatterns = [
        /^of\s+(this|that)\s+directive\b/,
        /^of\s+the\s+directive\b/,
        /^of\s+directive\b/,
        /^of\s+(this|that)\s+decision\b/,
        /^of\s+decision\b/,
        /^of\s+(this|that)\s+regulation\b/,
        /^of\s+that\s+regulation\b/,
        /^of\s+regulation\b/,
        /^(thereof|thereto|therein)\b/,
    ];

    return skipPatterns.some((pattern) => pattern.test(trimmed) || pattern.test(sanitised));
};

const transformInternalReferenceText = (input, contextProvider = null) => {
    if (!input || !internalArticleIds.size) {
        return input;
    }

    let output = input;

    output = output.replace(pluralInternalArticlePattern, (match, list, offset, source) => {
        const extraContext = contextProvider ? contextProvider(offset + match.length, match, source) : '';
        if (shouldSkipInternalLink(source, offset, match.length, extraContext)) {
            return match;
        }

        if (!list) {
            return match;
        }

        const transformedList = list.replace(internalArticleIdentifierPattern, (identifier) => {
            const linked = buildInternalArticleLink(identifier, identifier);
            return linked || identifier;
        });

        if (transformedList === list) {
            return match;
        }

        return match.replace(list, transformedList);
    });

    output = output.replace(singularInternalArticlePattern, (match, identifier, offset, source) => {
        const extraContext = contextProvider ? contextProvider(offset + match.length, match, source) : '';
        if (shouldSkipInternalLink(source, offset, match.length, extraContext)) {
            return match;
        }

        const linked = buildInternalArticleLink(match, identifier);
        return linked || match;
    });

    return output;
};

const linkifyInternalArticleReferences = (content) => {
    if (!content || typeof content !== 'string') {
        return content;
    }

    if (!internalArticleIds.size) {
        return content;
    }

    const $fragment = cheerio.load(`<span data-internal-wrapper="true">${content}</span>`, {
        decodeEntities: false,
    });

    const $wrapper = $fragment('span[data-internal-wrapper="true"]');

    const collectFollowingPlainText = (startNode, maxLength = 120) => {
        if (!startNode) {
            return '';
        }

        let text = '';
        let current = startNode.next;

        while (current && text.length < maxLength) {
            if (current.type === 'text' && current.data) {
                text += current.data;
            } else if (current.type === 'tag') {
                const $current = $fragment(current);
                if ($current && $current.length) {
                    text += $current.text();
                }
            }

            if (text.length >= maxLength) {
                break;
            }

            current = current.next;
        }

        if (text.length > maxLength) {
            return text.slice(0, maxLength);
        }

        return text;
    };

    const traverse = (node) => {
        const $node = $fragment(node);

        if (node.type === 'tag') {
            if ($node.is('a') || $node.is('.legal-reference')) {
                return;
            }

            $node.contents().each((_, child) => traverse(child));
            return;
        }

        if (node.type === 'text') {
            const $parent = $node.parent();
            if ($parent && $parent.length && ($parent.is('a') || $parent.is('.legal-reference'))) {
                return;
            }

            const original = node.data;
            const trailingSupplier = (() => {
                let cached = null;
                return () => {
                    if (cached === null) {
                        cached = collectFollowingPlainText(node);
                    }
                    return cached;
                };
            })();

            const transformed = transformInternalReferenceText(original, () => trailingSupplier());
            if (transformed !== original) {
                $node.replaceWith(transformed);
            }
        }
    };

    $wrapper.contents().each((_, child) => traverse(child));

    return $wrapper.html();
};

const identifierSegmentPattern = /[0-9ivxlcdm]+|\([^)]+\)/gi;

const splitIdentifierSegments = (value) => {
    if (!value) {
        return [];
    }
    const matches = `${value}`.match(identifierSegmentPattern);
    if (!matches) {
        return [];
    }
    return matches;
};

const createHierarchyTracker = () => ({
    stack: [],
    levels: [],
});

const detectLeadingToken = (text) => {
    if (!text) {
        return null;
    }

    const numberDotMatch = text.match(/^([0-9]+)\./);
    if (numberDotMatch) {
        return {
            segment: `(${numberDotMatch[1]})`,
            level: 0,
        };
    }

    const numberStandaloneMatch = text.match(/^([0-9]+)\b/);
    if (numberStandaloneMatch) {
        return {
            segment: `(${numberStandaloneMatch[1]})`,
            level: 0,
        };
    }

    const parenMatch = text.match(/^\(([0-9a-zivxlcdm]+)\)/i);
    if (parenMatch) {
        const raw = parenMatch[1];
        if (/^[0-9]+$/.test(raw)) {
            return {
                segment: `(${raw})`,
                level: 0,
            };
        }

        if (/^[ivxlcdm]+$/i.test(raw)) {
            return {
                segment: `(${raw.toLowerCase()})`,
                level: 2,
            };
        }

        return {
            segment: `(${raw.toLowerCase()})`,
            level: 1,
        };
    }

    return null;
};

const updateHierarchyTracker = (tracker, text) => {
    if (!tracker) {
        return [];
    }

    const token = detectLeadingToken(text);
    if (!token) {
        return [];
    }

    const { level, segment } = token;

    while (tracker.levels.length && tracker.levels[tracker.levels.length - 1] >= level) {
        tracker.levels.pop();
        tracker.stack.pop();
    }

    tracker.levels.push(level);
    tracker.stack.push(segment);

    return tracker.stack.slice();
};

const buildParagraphAnchorId = (articleId, segments, fallbackIndex = null) => {
    if (!articleId) {
        return null;
    }

    if (!segments || !segments.length) {
        if (fallbackIndex == null) {
            return null;
        }
        return `${articleId}__p${fallbackIndex + 1}`;
    }

    const slug = segments
        .map((segment) => `${segment}`
            .replace(/[()]/g, '')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, ''))
        .filter(Boolean)
        .join('_')
        .toLowerCase();

    const base = slug || (fallbackIndex != null ? `p${fallbackIndex + 1}` : null);

    if (!base) {
        return null;
    }

    return `${articleId}__${base}`;
};

const isSkippableHierarchySegment = (segment) => {
    if (!segment) {
        return false;
    }
    return /^\([0-9ivxlcdm]+\)$/i.test(segment);
};

const hierarchySegmentsMatch = (targetSegments, candidateSegments) => {
    if (!targetSegments.length || !candidateSegments.length) {
        return false;
    }

    let targetIndex = 0;

    for (let i = 0; i < candidateSegments.length; i += 1) {
        const candidateSegment = candidateSegments[i].toLowerCase();
        const currentTarget = targetSegments[targetIndex];

        if (currentTarget && candidateSegment === currentTarget) {
            targetIndex += 1;
            continue;
        }

        if (isSkippableHierarchySegment(candidateSegment)) {
            continue;
        }

        return false;
    }

    return targetIndex === targetSegments.length;
};

const findClosestIdentifierKey = (storeKeys, identifier) => {
    if (!storeKeys || !storeKeys.length || !identifier) {
        return null;
    }

    const targetSegmentsRaw = splitIdentifierSegments(identifier);
    if (!targetSegmentsRaw.length) {
        return null;
    }

    const targetSegments = targetSegmentsRaw.map((segment) => segment.toLowerCase());
    let bestMatch = null;

    storeKeys.forEach((candidateKey) => {
        const candidateSegmentsRaw = splitIdentifierSegments(candidateKey);
        if (!candidateSegmentsRaw.length) {
            return;
        }

        if (candidateSegmentsRaw[0].toLowerCase() !== targetSegments[0]) {
            return;
        }

        if (!hierarchySegmentsMatch(targetSegments, candidateSegmentsRaw)) {
            return;
        }

        if (!bestMatch || candidateSegmentsRaw.length < bestMatch.length || (
            candidateSegmentsRaw.length === bestMatch.length && candidateKey < bestMatch.key
        )) {
            bestMatch = {
                key: candidateKey,
                length: candidateSegmentsRaw.length,
            };
        }
    });

    return bestMatch ? bestMatch.key : null;
};

const getDirectiveSnippet = (celexId, articleIdentifier) => {
    if (!celexId || !articleIdentifier) {
        return null;
    }

    let store;
    if (snippetCache.has(celexId)) {
        store = snippetCache.get(celexId);
    } else {
        const snippetPath = path.join(__dirname, 'data', `${celexId}.json`);
        if (fs.existsSync(snippetPath)) {
            try {
                store = JSON.parse(fs.readFileSync(snippetPath, 'utf8'));
            } catch (error) {
                console.warn(`Failed to load snippet file for ${celexId}: ${error.message}`);
                store = null;
            }
        } else {
            store = null;
        }
        snippetCache.set(celexId, store);
    }

    if (!store) {
        return null;
    }

    const key = normaliseArticleIdentifier(articleIdentifier);
    if (!key) {
        return null;
    }

    const storeKeys = Object.keys(store);

    let resolvedKey = null;
    if (Object.prototype.hasOwnProperty.call(store, key)) {
        resolvedKey = key;
    } else {
        resolvedKey = findClosestIdentifierKey(storeKeys, key);
    }

    if (resolvedKey) {
        const baseText = store[resolvedKey] || '';
        const childKeys = storeKeys
            .filter((entryKey) => entryKey.startsWith(`${resolvedKey}(`))
            .sort();

        if (!childKeys.length) {
            if (!baseText) {
                return null;
            }
            return {
                text: baseText,
                allowTruncate: true,
            };
        }

        const childText = childKeys
            .map((entryKey) => store[entryKey])
            .filter(Boolean)
            .join('\n\n')
            .trim();

        const combined = [baseText, childText]
            .filter(Boolean)
            .join('\n\n');

        if (!combined) {
            return null;
        }

        return {
            text: combined,
            allowTruncate: false,
        };
    }

    if (key.includes('(')) {
        return null;
    }

    const candidateKeys = storeKeys
        .filter((entryKey) => entryKey.startsWith(`${key}(`))
        .sort();

    if (!candidateKeys.length) {
        return null;
    }

    const aggregatedText = candidateKeys
        .map((entryKey) => store[entryKey])
        .filter(Boolean)
        .join('\n\n')
        .trim();

    if (!aggregatedText) {
        return null;
    }

    return {
        text: aggregatedText,
        allowTruncate: false,
    };
};

const decorateArticleReferences = (articlePart, celexId, docLabel, sourceLabel) => {
    if (!articlePart) {
        return {
            html: '',
            references: [],
        };
    }

    const tokens = [];
    const referenceTokens = [];
    const articleWordTokens = [];
    let currentArticleWordToken = null;
    let lastHierarchy = null;

    const classifySegment = (segment) => {
        if (!segment) {
            return 'other';
        }
        const inner = segment.slice(1, -1);
        if (/^[0-9]+$/i.test(inner)) {
            return 'numeric';
        }
        if (/^[ivxlcdm]+$/i.test(inner)) {
            return 'roman';
        }
        if (/^[a-z]+$/i.test(inner)) {
            return 'letter';
        }
        return 'other';
    };

    const splitReference = (referenceText) => {
        if (!referenceText) {
            return [];
        }
        const headMatch = referenceText.match(/^[0-9ivxlcdm]+/i);
        if (!headMatch) {
            return [];
        }
        const segments = [headMatch[0]];
        const parens = referenceText.match(/\([^)]+\)/g);
        if (parens) {
            parens.forEach((part) => segments.push(part));
        }
        return segments;
    };

    const buildReferencePreview = (identifier, snippetText) => {
        const articleLabel = identifier ? `Article ${identifier}` : 'Article';
        if (snippetText) {
            return `${docLabel} – ${articleLabel}\n${snippetText}\nSource: ${sourceLabel}`;
        }
        return `${docLabel} – ${articleLabel}\nOpens on ${sourceLabel}`;
    };

    const buildAggregateSection = (identifier, snippetText) => {
        const articleLabel = `Article ${identifier}`;
        if (snippetText) {
            return `${articleLabel}\n${snippetText}`;
        }
        return `${articleLabel}\nOpens on ${sourceLabel}`;
    };

    const createTooltipSpan = (text, preview) => {
        const safePreview = escapeAttribute(preview || `${docLabel} – opens on ${sourceLabel}`);
        return `<span class="legal-reference" data-preview="${safePreview}">${escapeHtml(text)}</span>`;
    };

    const appendReferenceToken = (displayText, hierarchy) => {
        if (!hierarchy || !hierarchy.length) {
            tokens.push({ type: 'text', text: displayText });
            return null;
        }
        const identifier = hierarchy.join('');
        const snippetInfo = getDirectiveSnippet(celexId, identifier);
        const snippetText = snippetInfo
            ? (snippetInfo.allowTruncate ? truncateSnippet(snippetInfo.text) : snippetInfo.text)
            : null;
        const referenceToken = {
            type: 'reference',
            text: displayText,
            identifier,
            snippetText,
            preview: buildReferencePreview(identifier, snippetText),
            aggregateSection: buildAggregateSection(identifier, snippetText),
            toHtml() {
                return createTooltipSpan(this.text, this.preview);
            },
        };
        tokens.push(referenceToken);
        referenceTokens.push(referenceToken);

        if (currentArticleWordToken) {
            if (!currentArticleWordToken.referenceIndices) {
                currentArticleWordToken.referenceIndices = [];
            }
            currentArticleWordToken.referenceIndices.push(referenceTokens.length - 1);
        }

        lastHierarchy = hierarchy;
        return referenceToken;
    };

    const pushArticleWordToken = (word) => {
        const token = {
            type: 'article-word',
            text: word,
            referenceIndices: [],
            preview: null,
            toHtml() {
                const safePreview = escapeAttribute(this.preview || `${docLabel} – ${this.text.trim()}\nOpens on ${sourceLabel}`);
                return `<span class="legal-reference" data-preview="${safePreview}">${escapeHtml(this.text)}</span>`;
            },
        };
        tokens.push(token);
        articleWordTokens.push(token);
        currentArticleWordToken = token;
    };

    const pushTextToken = (text) => {
        if (text) {
            tokens.push({ type: 'text', text, toHtml() { return escapeHtml(text); } });
        }
    };

    const deriveSiblingHierarchy = (parenthesisText) => {
        if (!lastHierarchy || !lastHierarchy.length) {
            return null;
        }

        const newType = classifySegment(parenthesisText);
        const hierarchy = lastHierarchy.slice();

        if (hierarchy.length === 1) {
            hierarchy.push(parenthesisText);
            return hierarchy;
        }

        const lastSegment = hierarchy[hierarchy.length - 1];
        const lastType = classifySegment(lastSegment);

        if (lastType === newType) {
            hierarchy[hierarchy.length - 1] = parenthesisText;
        } else {
            hierarchy.push(parenthesisText);
        }

        return hierarchy;
    };

    let index = 0;
    while (index < articlePart.length) {
        const remainder = articlePart.slice(index);
        const previousChar = index > 0 ? articlePart[index - 1] : '';
        const canStartReference = index === 0 || /[^0-9a-z]/i.test(previousChar);

        const articlesMatch = remainder.match(/^Articles\b/i);
        if (articlesMatch) {
            pushArticleWordToken(articlesMatch[0]);
            index += articlesMatch[0].length;
            continue;
        }

        const articleMatch = remainder.match(/^Article\b/i);
        if (articleMatch) {
            pushArticleWordToken(articleMatch[0]);
            index += articleMatch[0].length;
            continue;
        }

        const numericMatch = canStartReference ? remainder.match(/^[0-9ivxlcdm]+(?:\([0-9a-zivxlcdm]+\))*/i) : null;
        if (numericMatch) {
            const referenceText = numericMatch[0];
            const hierarchy = splitReference(referenceText);
            appendReferenceToken(referenceText, hierarchy);
            index += referenceText.length;
            continue;
        }

        const parenMatch = canStartReference ? remainder.match(/^\([0-9a-zivxlcdm]+\)/i) : null;
        if (parenMatch) {
            const parenText = parenMatch[0];
            const hierarchy = deriveSiblingHierarchy(parenText);
            if (hierarchy) {
                appendReferenceToken(parenText, hierarchy);
            } else {
                pushTextToken(parenText);
                lastHierarchy = null;
            }
            index += parenText.length;
            continue;
        }

        const currentChar = articlePart[index];
        pushTextToken(currentChar);
        index += 1;
    }

    articleWordTokens.forEach((token) => {
        const indices = token.referenceIndices || [];
        if (!indices.length) {
            token.preview = `${docLabel} – ${token.text.trim()}\nOpens on ${sourceLabel}`;
            return;
        }

        if (indices.length === 1) {
            token.preview = referenceTokens[indices[0]].preview;
            return;
        }

        const refs = indices.map((idx) => referenceTokens[idx]);
        const identifierList = refs.map((ref) => ref.identifier).join(', ');
        const sections = refs.map((ref) => ref.aggregateSection).join('\n\n');
        token.preview = `${docLabel} – ${token.text.trim()} ${identifierList}\n${sections}\nSource: ${sourceLabel}`;
    });

    const html = tokens.map((token) => {
        if (token.type === 'text') {
            return escapeHtml(token.text);
        }
        if (token.type === 'reference' || token.type === 'article-word') {
            return token.toHtml();
        }
        return '';
    }).join('');

    return {
        html,
        references: referenceTokens,
    };
};

const linkifyLegalReferences = (text) => {
    if (!text || typeof text !== 'string') {
        return text;
    }

    const citationRegex = /((?:Article|Articles)[^,;]*?\s+of\s+)?(Regulation|Directive|Decision)\s*(\((?:EU|EC|EEC|EURATOM)\))?\s*(No\s*)?(\d{1,4})\/(\d{2,4})(?:\/([A-Z]{2,}))?/gi;

    return text.replace(citationRegex, (match, articlePart, docType, legalBasis, noToken, number1, number2, suffix) => {
        const articleReferenceRaw = articlePart || '';
        let articleNumberForLink = null;

        if (articleReferenceRaw) {
            const articleMatch = articleReferenceRaw.match(/Article(?:s)?\s+([0-9ivxlcdm]+(?:\([0-9a-zivxlcdm]+\))*)/i);
            if (articleMatch) {
                articleNumberForLink = articleMatch[1];
            }
        }

        const cleanedLegalBasis = (legalBasis || '').replace(/[()]/g, '') || null;
        const hasNo = Boolean(noToken);

        let year;
        let documentNumber;

        if (hasNo) {
            documentNumber = number1;
            year = normaliseYear(number2);
        } else if ((suffix && suffix.length) || (!suffix && number1.length === 4 && parseInt(number1, 10) > 1900)) {
            year = normaliseYear(number1);
            documentNumber = number2;
        } else if (!suffix && parseInt(number2, 10) > 1900) {
            year = normaliseYear(number2);
            documentNumber = number1;
        } else {
            year = normaliseYear(number1);
            documentNumber = number2;
        }

        if (!year || !documentNumber) {
            return match;
        }

        const docLabel = `${docType}${legalBasis ? ` ${legalBasis}` : ''} ${noToken || ''}${number1}/${number2}${suffix ? `/${suffix}` : ''}`.trim();
        const mappingKey = `${docType} (${cleanedLegalBasis || 'EU'}) ${year}/${parseInt(documentNumber, 10)}`;
        const celexId = buildCelexId(docType, year, documentNumber);

        let url = getSpringlexUrl(mappingKey, articleNumberForLink);
        let sourceLabel = 'Springlex';

        if (!url) {
            url = buildEurLexUrl(docType, year, documentNumber);
            sourceLabel = 'EUR-Lex';
        }

        if (!url) {
            return match;
        }

        const decorated = articleReferenceRaw
            ? decorateArticleReferences(articleReferenceRaw, celexId, docLabel, sourceLabel)
            : { html: articleReferenceRaw, references: [] };

        const firstReference = decorated.references && decorated.references.length
            ? decorated.references[0]
            : null;

        if (!articleNumberForLink && firstReference) {
            articleNumberForLink = firstReference.identifier;
        }

        const anchorPreview = `${docLabel} – opens on ${sourceLabel}`;
        const escapedPreview = escapeAttribute(anchorPreview);
        const escapedUrl = escapeAttribute(url);

        const articlePrefix = decorated.html || articleReferenceRaw || '';
        const docAnchor = `<a href="${escapedUrl}" class="legal-link" target="_blank" rel="noopener noreferrer" data-preview="${escapedPreview}">${docLabel}</a>`;

        return `${articlePrefix}${docAnchor}`;
    });
};

const normalizeWhitespace = (text) => {
    if (typeof text !== 'string') {
        return '';
    }
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const ensureBulletSpacing = (text) => {
    if (bulletSpacingPattern.test(text)) {
        return text.replace(bulletSpacingPattern, '$1 $2');
    }
    return text;
};

const extractCellText = ($cells) => {
    if (!$cells || !$cells.length) {
        return '';
    }

    const $clone = $cells.clone();
    $clone.find('table').remove();

    return $clone.text();
};

const classifyParagraph = (text) => {
    if (/^\([ivx]+\)/i.test(text)) {
        return 'list-item-l2';
    }
    if (/^\([a-z]{1,2}\)/.test(text)) {
        return 'list-item-l1';
    }
    if (/^\([0-9]+\)/.test(text)) {
        return 'list-item-l1';
    }
    return '';
};

const addParagraph = (article, context, rawText) => {
    if (!context) {
        return;
    }

    const normalized = ensureBulletSpacing(normalizeWhitespace(rawText));
    if (!normalized) {
        return;
    }

    const hierarchySegments = updateHierarchyTracker(context.hierarchy, normalized);
    const anchorId = buildParagraphAnchorId(article.id, hierarchySegments, context.paragraphCounter);
    const paragraphId = anchorId || `${article.id}__p${context.paragraphCounter + 1}`;

    const enriched = linkifyLegalReferences(normalized);
    const hyperlinked = linkifyInternalArticleReferences(enriched);

    article.paragraphs.push({
        id: paragraphId,
        text: hyperlinked,
        class: classifyParagraph(normalized),
    });

    context.paragraphCounter += 1;
};

const stripHtmlTags = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/<[^>]*>/g, ' ');
};

const dedupeConsecutiveParagraphs = (paragraphs) => {
    if (!Array.isArray(paragraphs) || paragraphs.length < 2) {
        return paragraphs;
    }

    const output = [];
    let lastKey = null;
    const recentKeys = [];
    const RECENT_LIMIT = 10;

    paragraphs.forEach((paragraph) => {
        if (!paragraph || typeof paragraph.text !== 'string') {
            return;
        }

        const normalisedForKey = normalizeWhitespace(stripHtmlTags(paragraph.text)).toLowerCase();
        const key = `${paragraph.class || ''}:::${normalisedForKey}`;

        if (key && key === lastKey) {
            return;
        }

        if (key && recentKeys.includes(key)) {
            return;
        }

        output.push(paragraph);
        lastKey = key;

        if (key) {
            recentKeys.push(key);
            if (recentKeys.length > RECENT_LIMIT) {
                recentKeys.shift();
            }
        }
    });

    return output;
};

const processTable = ($table, article, context) => {
    if (!$table || !$table.length) {
        return;
    }

    const tableElement = $table[0];
    if (!tableElement || processedTables.has(tableElement)) {
        return;
    }

    processedTables.add(tableElement);

    $table.find('tr').each((_, row) => {
        const $row = $(row);
        const $cells = $row.children('td');

        if (!$cells.length) {
            return;
        }

        const cellArray = $cells.toArray();
        const enumerator = extractCellText($(cellArray[0]));
        const bodyText = extractCellText($(cellArray.slice(1)));

        const combined = [enumerator, bodyText]
            .filter(Boolean)
            .join(' ');

        if (combined && combined.trim()) {
            addParagraph(article, context, combined);
        }

        cellArray.forEach((cell) => {
            $(cell)
                .find('table')
                .each((__, nested) => {
                    processTable($(nested), article, context);
                });
        });
    });
};

const processNode = (node, article, context) => {
    const $node = $(node);

    if ($node.is('div.eli-title') || $node.is('p.oj-ti-art')) {
        return;
    }

    if ($node.is('table')) {
        processTable($node, article, context);
        return;
    }

    if ($node.is('p') && $node.hasClass('oj-normal')) {
        addParagraph(article, context, $node.text());
        return;
    }

    $node.children().each((_, child) => processNode(child, article, context));
};
const articleElements = $('div.eli-subdivision[id^="art_"]').toArray();

articleElements.forEach((el) => {
    const $element = $(el);
    const id = $element.attr('id');
    const articleNumber = normalizeWhitespace($element.find('p.oj-ti-art').first().text());
    registerInternalArticle(articleNumber, id);
});

articleElements.forEach((el) => {
    const $element = $(el);
    const id = $element.attr('id');
    const articleNumber = normalizeWhitespace($element.find('p.oj-ti-art').first().text());
    const articleHeading = normalizeWhitespace($element.find('div.eli-title p.oj-sti-art').first().text());

    const article = {
        id,
        title: articleNumber || id,
        heading: articleHeading,
        paragraphs: [],
    };

    const context = {
        hierarchy: createHierarchyTracker(),
        paragraphCounter: 0,
    };

    $element.children().each((_, child) => processNode(child, article, context));

    article.paragraphs = dedupeConsecutiveParagraphs(article.paragraphs);

    articles.push(article);
});

console.log(`Found ${articles.length} articles.`);
if (articles.length > 0) {
    console.log('First article:', JSON.stringify(articles[0], null, 2));
    console.log('Article 2:', JSON.stringify(articles.find((a) => a.id === 'art_2'), null, 2));
}

fs.writeFileSync(outputFile, JSON.stringify(articles, null, 2));
console.log(`Wrote ${articles.length} articles to ${outputFile}`);