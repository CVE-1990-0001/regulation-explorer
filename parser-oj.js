const cheerio = require('cheerio');
const fs = require('fs');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node parser-oj.js <input.html> [output.json]');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const outputFile = process.argv[3] || inputFile.replace(/\.html$/i, '.json');

const html = fs.readFileSync(inputFile, 'utf8');
const $ = cheerio.load(html);

const normaliseWhitespace = (value) => `${value || ''}`
  .replace(/\u00A0/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const getArticleIdFromTitle = (titleText, fallbackIndex) => {
  const match = normaliseWhitespace(titleText).match(/^Article\s+([0-9]+[a-z]?)/i);
  if (!match) {
    return `art_${fallbackIndex + 1}`;
  }
  return `art_${match[1].toLowerCase()}`;
};

const articleNumberToId = new Map();

const registerArticleNumber = (titleText, articleId) => {
  const match = normaliseWhitespace(titleText).match(/^Article\s+([0-9]+[a-z]?)/i);
  if (!match || !articleId) {
    return;
  }
  articleNumberToId.set(match[1].toLowerCase(), articleId);
};

const escapeHtml = (value) => `${value || ''}`
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildInternalLink = (displayText, articleNumberToken) => {
  const key = `${articleNumberToken || ''}`.toLowerCase();
  const articleId = articleNumberToId.get(key);
  if (!articleId) {
    return escapeHtml(displayText);
  }
  const safeText = escapeHtml(displayText);
  return `<a href="#${articleId}" class="internal-article-link" target="_blank" rel="noopener">${safeText}</a>`;
};

const padNumber = (value) => `${value || ''}`.replace(/\D/g, '').padStart(4, '0');

const buildEurLexUrlFromCelex = (celexId) => `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celexId}`;

const buildDirectiveCelex = (year, number) => `3${year}L${padNumber(number)}`;

const buildRegulationCelex = (year, number) => `3${year}R${padNumber(number)}`;

const wrapLegalLink = (displayText, celexId, previewLabel) => {
  const href = buildEurLexUrlFromCelex(celexId);
  const safeText = displayText;
  const safePreview = escapeHtml(`${previewLabel} – opens on EUR-Lex`);
  return `<a href="${href}" class="legal-link" target="_blank" rel="noopener noreferrer" data-preview="${safePreview}">${safeText}</a>`;
};

const linkExternalLegalReferences = (text) => {
  let output = text;

  output = output.replace(/\bDirective\s+(\d{4})\/(\d{2,4})\/(EU|EC)\b/g, (match, year, number, region) => {
    const celexId = buildDirectiveCelex(year, number);
    return wrapLegalLink(match, celexId, `Directive ${year}/${number}/${region}`);
  });

  output = output.replace(/\bRegulation\s*\((EU|EC)\)\s*(?:No\s*)?(\d{1,4})\/(\d{4})\b/g, (match, region, number, year) => {
    const celexId = buildRegulationCelex(year, number);
    return wrapLegalLink(match, celexId, `Regulation (${region}) ${number}/${year}`);
  });

  // Handle Decision No X/YYYY/EC format
  output = output.replace(/\bDecision\s+No\s+(\d+)\/(\d{4})\/E[CU]\b/g, (match, number, year) => {
    const celexId = `3${year}D${padNumber(number)}`;
    return wrapLegalLink(match, celexId, match);
  });

  return output;
};

const linkInternalArticleReferences = (text) => {
  if (!text) {
    return '';
  }

  const escaped = escapeHtml(text);

  const replaceArticleList = (value) => {
    const numberTokenPattern = /\b[0-9]+[a-z]?\b/gi;
    return value.replace(numberTokenPattern, (token) => buildInternalLink(token, token));
  };

  let linked = escaped.replace(/\bArticles\s+([0-9a-z\s,\-–toandor]+)/gi, (fullMatch, listPart) => {
    const replacedList = replaceArticleList(listPart);
    return fullMatch.replace(listPart, replacedList);
  });

  linked = linked.replace(/\bArticle\s+([0-9]+[a-z]?)(\([0-9]+\))?/gi, (fullMatch, articleNumber) => {
    return fullMatch.replace(articleNumber, buildInternalLink(articleNumber, articleNumber));
  });

  return linkExternalLegalReferences(linked);
};

const shouldCaptureParagraphNode = (node) => {
  if (!node || node.type !== 'tag') {
    return false;
  }

  const className = `${node.attribs?.class || ''}`;
  const tagName = node.name;

  // In OJ format, paragraphs are typically in p tags with oj-normal
  if (tagName === 'p' && (/\boj-normal\b/.test(className) || /\beli-preamble-ind\b/.test(className))) {
    return true;
  }

  // Also capture divs that contain paragraph content (e.g., <div id="001.001"><p class="oj-normal">...)
  if (tagName === 'div' && !className) {
    // Check if this div contains oj-normal paragraphs
    const children = node.children || [];
    for (let child of children) {
      if (child.type === 'tag' && child.name === 'p') {
        const childClass = `${child.attribs?.class || ''}`;
        if (/\boj-normal\b/.test(childClass)) {
          return true;
        }
      }
    }
  }

  // Also capture tables that contain oj-normal paragraphs (e.g., definition lists)
  if (tagName === 'table') {
    // Check if this table contains any oj-normal paragraphs
    const allDescendants = (n) => {
      let result = [];
      if (n.children) {
        for (let child of n.children) {
          result.push(child);
          result.push(...allDescendants(child));
        }
      }
      return result;
    };
    const descendants = allDescendants(node);
    for (let desc of descendants) {
      if (desc.type === 'tag' && desc.name === 'p') {
        const descClass = `${desc.attribs?.class || ''}`;
        if (/\boj-normal\b/.test(descClass)) {
          return true;
        }
      }
    }
  }

  return false;
};

const paragraphClassFromNode = (node, paragraphText) => {
  const className = `${node.attribs?.class || ''}`;
  if (/\blist\b/.test(className)) {
    return 'list-item-l1';
  }

  if (/^\([a-z0-9ivxlcdm]+\)/i.test(paragraphText)) {
    return 'list-item-l1';
  }

  return '';
};

const extractParagraphText = (node) => {
  const clone = $(node).clone();

  clone.find('.modref').remove();

  // For tables, extract text from all oj-normal paragraphs
  if (node.name === 'table') {
    const paragraphs = clone.find('p.oj-normal').toArray();
    const texts = paragraphs.map(p => normaliseWhitespace($(p).text())).filter(t => t.length > 0);
    return texts.join(' ');
  }

  const text = clone.text();
  return normaliseWhitespace(text);
};

// Find all article title nodes using OJ format selectors
const articleTitleNodes = $('p.oj-ti-art').toArray();
const articles = [];

// First pass: register article numbers
articleTitleNodes.forEach((titleNode, index) => {
  const titleText = normaliseWhitespace($(titleNode).text());
  const articleId = getArticleIdFromTitle(titleText, index);
  registerArticleNumber(titleText, articleId);
});

// Second pass: extract articles with their content
articleTitleNodes.forEach((titleNode, index) => {
  const titleText = normaliseWhitespace($(titleNode).text());
  const articleId = getArticleIdFromTitle(titleText, index);

  let heading = '';
  const paragraphs = [];
  let paragraphCounter = 0;

  const nextArticleNode = articleTitleNodes[index + 1] || null;
  let current = titleNode.nextSibling;

  while (current) {
    if (current === nextArticleNode) {
      break;
    }

    if (current.type === 'tag') {
      const className = `${current.attribs?.class || ''}`;
      const tagName = current.name;

      // Capture heading from eli-title div
      if (!heading && /\beli-title\b/.test(className)) {
        heading = normaliseWhitespace($(current).text());
      }
      // Capture paragraphs from oj-normal and similar
      else if (shouldCaptureParagraphNode(current)) {
        const text = extractParagraphText(current);
        if (text && text.length > 0) {
          paragraphCounter += 1;
          paragraphs.push({
            id: `${articleId}__${paragraphCounter}`,
            text: linkInternalArticleReferences(text),
            class: paragraphClassFromNode(current, normaliseWhitespace($(current).text())),
          });
        }
      }
    }

    current = current.nextSibling;
  }

  if (paragraphs.length > 0) {
    articles.push({
      id: articleId,
      title: titleText || articleId,
      heading,
      paragraphs,
    });
  }
});

fs.writeFileSync(outputFile, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');

console.log(`Found ${articles.length} articles.`);
if (articles[0]) {
  console.log('First article:', JSON.stringify(articles[0], null, 2).substring(0, 500));
}
if (articles[1]) {
  console.log('Article 2:', JSON.stringify(articles[1], null, 2).substring(0, 500));
}
console.log(`Wrote ${articles.length} articles to ${outputFile}`);
