import { Marked } from 'marked';
import hljs from 'highlight.js';

const usedIds = new Map();

function uniqueSlug(title) {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
  const count = usedIds.get(base) || 0;
  usedIds.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function plainHeading(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderMarkdown(source) {
  usedIds.clear();
  const outline = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      code(arg) {
        const text = typeof arg === 'string' ? arg : arg?.text || '';
        const lang = typeof arg === 'string' ? '' : arg?.lang || '';
        const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
        const highlighted = hljs.highlight(text, { language }).value;
        return `<pre class="md-code"><code class="hljs language-${language}">${highlighted}</code></pre>`;
      },
      heading(token) {
        const title = plainHeading(token.text);
        const id = uniqueSlug(title);
        outline.push({
          id,
          title: title || 'Untitled',
          depth: Math.max(0, (token.depth || 1) - 1),
        });
        const html = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${id}">${html}</h${token.depth}>\n`;
      },
    },
  });
  const html = marked.parse(String(source || '').replace(/^\uFEFF/, ''));
  return { html, outline };
}
