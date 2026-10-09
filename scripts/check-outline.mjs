import { renderMarkdown } from '../src/markdownDoc.js';

const source = `# Harbor

## Lamps

\`\`\`js
# not a heading
\`\`\`

## Lamps

Setext title
===========

Subsection
-----------

## <a id="s1-9"></a>1.9 Present Perfect &amp; Continuous
`;

const { html, outline } = renderMarkdown(source);
console.log(outline);
if (!html.includes('id="harbor"')) throw new Error(html);
if (outline.some((item) => item.title.includes('not a heading'))) throw new Error('fence leaked');
if (outline.map((item) => item.title).join('|') !== 'Harbor|Lamps|Lamps|Setext title|Subsection|1.9 Present Perfect & Continuous') {
  throw new Error(outline.map((item) => item.title).join('|'));
}
if (outline[2].id !== 'lamps-2') throw new Error(outline[2].id);
if (outline[3].depth !== 0 || outline[4].depth !== 1) throw new Error('setext depth');
console.log('markdown outline ok');
