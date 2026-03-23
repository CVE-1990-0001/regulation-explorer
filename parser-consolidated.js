const cheerio = require('cheerio');
const fs = require('fs');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node parser-consolidated.js <input.html> [output.json]');
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

const shouldCaptureParagraphNode = (node) => {
  if (!node || node.type !== 'tag') {
    return false;
  }

  const className = `${node.attribs?.class || ''}`;
  if (!className) {
    return false;
  }

  if (/\bmodref\b/.test(className)) {
    return false;
  }

  if (/\beli-title\b/.test(className)) {
    return false;
  }

  return /\bnorm\b/.test(className) || /\blist\b/.test(className);
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

  const text = clone.text();
  return normaliseWhitespace(text);
};

const articleTitleNodes = $('p.title-article-norm').toArray();
const articles = [];

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

      if (!heading && /\beli-title\b/.test(className)) {
        heading = normaliseWhitespace($(current).text());
      } else if (shouldCaptureParagraphNode(current)) {
        const text = extractParagraphText(current);
        if (text) {
          paragraphCounter += 1;
          paragraphs.push({
            id: `${articleId}__${paragraphCounter}`,
            text,
            class: paragraphClassFromNode(current, normaliseWhitespace($(current).text())),
          });
        }
      }
    }

    current = current.nextSibling;
  }

  articles.push({
    id: articleId,
    title: titleText || articleId,
    heading,
    paragraphs,
  });
});

fs.writeFileSync(outputFile, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');

console.log(`Found ${articles.length} articles.`);
if (articles[0]) {
  console.log('First article:', JSON.stringify(articles[0], null, 2));
}
if (articles[1]) {
  console.log('Article 2:', JSON.stringify(articles[1], null, 2));
}
console.log(`Wrote ${articles.length} articles to ${outputFile}`);