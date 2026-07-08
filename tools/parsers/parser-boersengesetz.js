const cheerio = require('cheerio');
const fs = require('fs');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node parser-boersengesetz.js <input.html> [output.json]');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const outputFile = process.argv[3] || inputFile.replace(/\.html$/i, '.json');

const html = fs.readFileSync(inputFile, 'latin1');
const $ = cheerio.load(html);

const normaliseWhitespace = (value) => `${value || ''}`
  .replace(/\u00A0/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const paragraphClassFromText = (text) => {
  if (/^\([0-9]+[a-z]?\)/i.test(text)) {
    return 'list-item-l1';
  }
  if (/^[0-9]+\./.test(text)) {
    return 'list-item-l1';
  }
  if (/^[a-z]\)/i.test(text)) {
    return 'list-item-l1';
  }
  if (/^[\-–]\s/.test(text)) {
    return 'list-item-l1';
  }
  return '';
};

const extractArticleToken = (rawLabel) => {
  const cleanLabel = normaliseWhitespace(rawLabel)
    .replace(/[§\u00A7�]/g, ' ')
    .replace(/[^0-9a-zA-Z\s]/g, ' ')
    .trim();

  const match = cleanLabel.match(/\b([0-9]+[a-z]?)\b/i);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
};

// ── Linkification helpers ────────────────────────────────────────────────────

const escapeHtml = (raw) => `${raw || ''}`
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const padNum4 = (n) => `${n || ''}`.replace(/\D/g, '').padStart(4, '0');

const eurLexUrl = (celexId) =>
  `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(celexId)}`;

const wrapExternalLink = (matchedText, celexId, previewLabel) => {
  const href = eurLexUrl(celexId);
  const safePreview = escapeHtml(`${previewLabel} – opens on EUR-Lex`);
  return `<a href="${href}" class="legal-link" target="_blank" rel="noopener noreferrer" data-preview="${safePreview}">${matchedText}</a>`;
};

const wrapInternalLink = (matchedText, articleToken, knownTokens) => {
  const key = `${articleToken}`.toLowerCase();
  if (!knownTokens.has(key)) {
    return matchedText; // unknown token → plain escaped text (references another act)
  }
  return `<a href="#art_${key}" class="internal-article-link" rel="noopener">${matchedText}</a>`;
};

// Detects "des/der <CapitalLawName>" within a window after a § match,
// handling patterns like "§ N Absatz M des OtherLaw" and "§ N Abs. M des OtherLaw".
// Stops scanning at the next § sign or real sentence end (". Capital"), not abbreviation dots.
const isExternalLawRef = (afterText) => {
  // Stop at: another § reference, or a sentence-ending period (". " + capital letter),
  // or ";" which often separates clauses. Do NOT stop at abbreviation dots (Abs., Nr., etc.).
  const windowEnd = afterText.search(/§|\.\s+[A-ZÄÖÜ]|[;!?]/);
  const window = windowEnd >= 0
    ? afterText.slice(0, Math.min(windowEnd, 90))
    : afterText.slice(0, 90);
  return /\b(?:des|der)\s+[A-ZÄÖÜ]/.test(window);
};

const linkifyText = (rawText, knownTokens) => {
  // HTML-escape the entire text once; subsequent replacements insert trusted HTML.
  let s = escapeHtml(rawText);

  // 1. EU Regulations (German: "Verordnung (EU) [Nr.] N/YYYY" or "YYYY/N")
  s = s.replace(
    /Verordnung\s+\(EU\)\s+(?:Nr\.\s*)?(\d+)\/(\d+)\b/g,
    (match, a, b) => {
      // Determine which is year (4-digit ≥ 2000) and which is the regulation number.
      let year, num;
      if (a.length === 4 && parseInt(a, 10) >= 2000) {
        year = a; num = b; // YYYY/N format
      } else {
        num = a; year = b; // N/YYYY format
      }
      const celex = `3${year}R${padNum4(num)}`;
      return wrapExternalLink(match, celex, `Regulation (EU) ${a}/${b}`);
    }
  );

  // 2. EU Directives (German: "Richtlinie YYYY/N/EU" or "/EG")
  s = s.replace(
    /Richtlinie\s+(\d{4})\/(\d{1,4})\/(EU|EG)\b/g,
    (match, year, num, suffix) => {
      const celex = `3${year}L${padNum4(num)}`;
      return wrapExternalLink(match, celex, `Directive ${year}/${num}/${suffix}`);
    }
  );

  // 3. §§ plural references (e.g. "§§ 22 bis 24", "§§ 4a und 4c")
  //    Processed BEFORE the single-§ pattern to correctly consume double-§ form.
  s = s.replace(
    /§§\s*(\d+[a-z]?(?:\s+(?:bis|und|oder|,)\s+\d+[a-z]?)*)/g,
    (match, numPart, offset, str) => {
      // Skip if a "des/der <CapitalLawName>" pattern appears nearby → another act.
      if (isExternalLawRef(str.slice(offset + match.length))) {
        return match;
      }
      const linkedNums = numPart.replace(/\b(\d+[a-z]?)\b/g, (tok) => {
        const key = tok.toLowerCase();
        return knownTokens.has(key)
          ? `<a href="#art_${key}" class="internal-article-link" rel="noopener">${tok}</a>`
          : tok;
      });
      return '§§ ' + linkedNums;
    }
  );

  // 4. Single § references (e.g. "§ 19", "§ 4a", "§ 25 Absatz 1")
  //    Skipped if followed by "des/der <CapitalLawName>" = external law reference.
  s = s.replace(
    /§\s*(\d+[a-z]?)/g,
    (match, num, offset, str) => {
      if (isExternalLawRef(str.slice(offset + match.length))) {
        return match;
      }
      return wrapInternalLink(match, num, knownTokens);
    }
  );

  return s;
};

// ── Pass 1: collect known article tokens ────────────────────────────────────

const knownArticleTokens = new Set();

$('div.jnnorm[title="Einzelnorm"]').each((_, node) => {
  const rawLabel = normaliseWhitespace($(node).find('.jnheader .jnenbez').first().text());
  const token = extractArticleToken(rawLabel);
  if (token) {
    knownArticleTokens.add(token.toLowerCase());
  }
});

// ── Pass 2: parse articles with linkification ────────────────────────────────

const articles = [];

$('div.jnnorm[title="Einzelnorm"]').each((_, node) => {
  const header = $(node).find('.jnheader').first();
  const rawLabel = normaliseWhitespace(header.find('.jnenbez').first().text());
  const heading = normaliseWhitespace(header.find('.jnentitel').first().text());

  const articleToken = extractArticleToken(rawLabel);
  if (!articleToken) {
    return;
  }

  const articleId = `art_${articleToken}`;
  const title = rawLabel || `§ ${articleToken}`;

  let paragraphCounter = 0;
  const paragraphs = [];

  $(node).find('div.jurAbsatz').each((__, paragraphNode) => {
    const rawText = normaliseWhitespace($(paragraphNode).text());
    if (!rawText || rawText === '-') {
      return;
    }

    paragraphCounter += 1;
    paragraphs.push({
      id: `${articleId}__${paragraphCounter}`,
      text: linkifyText(rawText, knownArticleTokens),
      class: paragraphClassFromText(rawText),
    });
  });

  if (!paragraphs.length) {
    return;
  }

  articles.push({
    id: articleId,
    title,
    heading,
    paragraphs,
  });
});

fs.writeFileSync(outputFile, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');

console.log(`Found ${articles.length} articles.`);
console.log(`Wrote ${articles.length} articles to ${outputFile}`);