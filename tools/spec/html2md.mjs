// Conversor HTML -> Markdown sob medida para os artifacts gerados nesta sessão.
// Não altera conteúdo: apenas troca a representação.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const VOID = new Set(['br', 'hr', 'link', 'meta', 'img', 'input', 'col']);
const SKIP = new Set(['style', 'script', 'title', 'nav']);

/* ---------------- tokenizer + tree ---------------- */
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0,
    m;
  const pushText = (t) => {
    if (!t) return;
    stack[stack.length - 1].children.push({ tag: '#text', text: t });
  };
  while ((m = re.exec(html)) !== null) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    const raw = m[0],
      tag = m[1].toLowerCase();
    if (raw.startsWith('</')) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = {};
    const ar = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(m[2] || '')) !== null) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(tag) && !raw.endsWith('/>')) stack.push(node);
  }
  pushText(html.slice(last));
  return root;
}

const cls = (n) => (n.attrs && n.attrs.class ? n.attrs.class.split(/\s+/) : []);
const has = (n, c) => cls(n).includes(c);
const dec = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/* ---------------- inline ---------------- */
function inline(node, opt = {}) {
  if (node.tag === '#text') {
    let t = dec(node.text).replace(/\s+/g, ' ');
    if (opt.table) t = t.replace(/\|/g, '\\|');
    return t;
  }
  const kids = () => node.children.map((c) => inline(c, opt)).join('');
  switch (node.tag) {
    case 'br':
      return opt.table ? '<br>' : opt.blkId ? ' · ' : '  \n';
    case 'b':
    case 'strong': {
      const t = kids().trim();
      return t ? `**${t}**` : '';
    }
    case 'i':
    case 'em': {
      const t = kids().trim();
      return t ? `*${t}*` : '';
    }
    case 'u':
      return kids();
    case 'code':
    case 'kbd': {
      const t = kids().trim();
      return t ? '`' + t.replace(/\\\|/g, '|').replace(/`/g, '') + '`' : '';
    }
    case 'sup':
      return `^${kids().trim()}`;
    case 'a': {
      const t = kids().trim();
      const h = node.attrs.href || '';
      return h && !h.startsWith('#') ? `[${t}](${h})` : t;
    }
    case 'span': {
      const t = kids().trim();
      if (!t) return '';
      if (has(node, 'chip')) return `**${t}**`;
      if (has(node, 'pill')) return t;
      if (has(node, 'num')) return t;
      if (has(node, 'lbl')) return t;
      return t;
    }
    default:
      return kids();
  }
}
const inlineOf = (node, opt) =>
  node.children
    .map((c) => inline(c, opt))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/* ---------------- pre (preserva formatação) ---------------- */
function preText(node) {
  if (node.tag === '#text') return dec(node.text);
  if (node.tag === 'br') return '\n';
  return node.children.map(preText).join('');
}

/* ---------------- tabelas ---------------- */
function renderTable(tbl) {
  const rows = [];
  const collect = (n) => {
    if (n.tag === 'tr') {
      rows.push(n);
      return;
    }
    n.children.forEach((c) => {
      if (c.tag !== '#text') collect(c);
    });
  };
  collect(tbl);
  if (!rows.length) return '';

  const grid = [];
  const pending = []; // {col, rowsLeft, text}
  rows.forEach((tr, ri) => {
    const out = [];
    const cells = tr.children.filter((c) => c.tag === 'th' || c.tag === 'td');
    const createdHere = new Set();
    for (const cell of cells) {
      // preenche colunas ocupadas por rowspan anterior
      while (pending[out.length] && pending[out.length].rowsLeft > 0) out.push(pending[out.length].text);
      const txt = inlineOf(cell, { table: true }) || ' ';
      const colspan = parseInt(cell.attrs.colspan || '1', 10);
      const rowspan = parseInt(cell.attrs.rowspan || '1', 10);
      const col = out.length;
      out.push(txt);
      for (let k = 1; k < colspan; k++) out.push(' ');
      if (rowspan > 1) {
        pending[col] = { rowsLeft: rowspan - 1, text: txt };
        createdHere.add(col);
      }
    }
    while (pending[out.length] && pending[out.length].rowsLeft > 0) out.push(pending[out.length].text);
    // decrementa apenas os spans herdados de linhas anteriores
    pending.forEach((p, i) => {
      if (p && p.rowsLeft > 0 && !createdHere.has(i)) p.rowsLeft--;
    });
    grid.push({ header: cells.length > 0 && cells.every((c) => c.tag === 'th'), cells: out });
  });

  const width = Math.max(...grid.map((r) => r.cells.length));
  grid.forEach((r) => {
    while (r.cells.length < width) r.cells.push(' ');
  });

  const lines = [];
  let headerDone = false;
  grid.forEach((r) => {
    lines.push('| ' + r.cells.map((c) => (c === '' ? ' ' : c)).join(' | ') + ' |');
    if (r.header && !headerDone) {
      lines.push('|' + Array(width).fill(' --- ').join('|') + '|');
      headerDone = true;
    }
  });
  if (!headerDone) {
    lines.splice(1, 0, '|' + Array(width).fill(' --- ').join('|') + '|');
  }
  return lines.join('\n') + '\n';
}

/* ---------------- blocos ---------------- */
function block(node, out, ctx = {}) {
  if (node.tag === '#text') {
    const t = dec(node.text).trim();
    if (t) out.push(t + '\n');
    return;
  }
  if (SKIP.has(node.tag)) return;
  const kids = () => node.children.forEach((c) => block(c, out, ctx));

  switch (node.tag) {
    case 'h1':
      out.push('# ' + inlineOf(node) + '\n');
      return;
    case 'h2': {
      const num = node.children.find((c) => c.tag === 'span' && has(c, 'num'));
      const n = num ? inlineOf(num) : '';
      const rest = node.children
        .filter((c) => c !== num)
        .map((c) => inline(c))
        .join('')
        .trim();
      out.push(`## ${n ? n + '. ' : ''}${rest}\n`);
      return;
    }
    case 'h3':
      out.push('### ' + inlineOf(node) + '\n');
      return;
    case 'h4':
      out.push('#### ' + inlineOf(node) + '\n');
      return;
    case 'h5':
      out.push((ctx.inBlk ? '**' + inlineOf(node) + '**' : '#### ' + inlineOf(node)) + '\n');
      return;
    case 'h6':
      out.push('**' + inlineOf(node) + '**\n');
      return;
    case 'p': {
      const t = inlineOf(node);
      if (t) out.push(t + '\n');
      return;
    }
    case 'ul':
    case 'ol': {
      const ordered = node.tag === 'ol';
      let i = 1;
      node.children
        .filter((c) => c.tag === 'li')
        .forEach((li) => {
          const nested = [];
          li.children.filter((c) => c.tag === 'ul' || c.tag === 'ol').forEach((n2) => block(n2, nested, ctx));
          const own = li.children.filter((c) => c.tag !== 'ul' && c.tag !== 'ol');
          const txt = own
            .map((c) => inline(c))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          out.push(`${ordered ? i++ + '.' : '-'} ${txt}`);
          if (nested.length)
            out.push(
              nested
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((l) => '  ' + l)
                .join('\n')
            );
        });
      out.push('');
      return;
    }
    case 'table':
      out.push(renderTable(node));
      return;
    case 'pre': {
      const body = preText(node).replace(/^\n+/, '').replace(/\s+$/, '');
      out.push('```\n' + body + '\n```\n');
      return;
    }
    case 'hr':
      return;
    case 'footer':
      out.push('---\n');
      kids();
      return;
    case 'div': {
      if (has(node, 'tw')) {
        kids();
        return;
      }
      if (has(node, 'grid')) {
        kids();
        return;
      }
      if (has(node, 'note')) {
        const lbl = node.children.find((c) => c.tag === 'span' && has(c, 'lbl'));
        const inner = [];
        node.children.filter((c) => c !== lbl).forEach((c) => block(c, inner, ctx));
        const body = inner
          .join('\n')
          .split('\n')
          .filter((l) => l.trim() !== '');
        out.push(
          '> **' +
            (lbl ? inlineOf(lbl).toUpperCase() : 'NOTA') +
            '**\n>\n' +
            body.map((l) => '> ' + l).join('\n') +
            '\n'
        );
        return;
      }
      if (has(node, 'gwt')) {
        const body = preText(node).replace(/^\s+/, '').replace(/\s+$/, '');
        out.push('```gherkin\n' + body + '\n```\n');
        return;
      }
      if (has(node, 'blk')) {
        const id = node.children.find((c) => has(c, 'id'));
        const bd = node.children.find((c) => has(c, 'bd'));
        const idTxt = id
          ? id.children
              .map((c) => inline(c, { blkId: true }))
              .join('')
              .replace(/\s+/g, ' ')
              .trim()
          : '';
        const h5 = bd ? bd.children.find((c) => c.tag === 'h5') : null;
        const title = h5 ? inlineOf(h5) : '';
        out.push(`#### ${idTxt}${title ? ' — ' + title : ''}\n`);
        if (bd) bd.children.filter((c) => c !== h5).forEach((c) => block(c, out, { ...ctx, inBlk: true }));
        return;
      }
      if (has(node, 'card')) {
        const k = node.children.find((c) => has(c, 'k'));
        const kl = node.children.find((c) => has(c, 'kl'));
        if (k && kl) {
          out.push(`- **${inlineOf(k)}** — ${inlineOf(kl)}`);
          return;
        }
        const inner = [];
        node.children.forEach((c) => block(c, inner, ctx));
        out.push(inner.join('\n'));
        return;
      }
      if (has(node, 'pill-row')) {
        const parts = [];
        node.children.forEach((c) => {
          if (c.tag === 'span') {
            const t = inline(c).trim();
            if (t) parts.push(t);
          } else if (c.tag === '#text') {
            const t = dec(c.text).trim();
            if (t) parts.push(t);
          }
        });
        out.push(parts.join(' · ') + '\n');
        return;
      }
      if (has(node, 'meta')) {
        const parts = node.children.filter((c) => c.tag === 'span').map((c) => inlineOf(c));
        out.push(parts.join(' · ') + '\n');
        return;
      }
      kids();
      return;
    }
    default:
      kids();
  }
}

/* ---------------- driver ---------------- */
function convert(file) {
  const html = readFileSync(file, 'utf8');
  const tree = parse(html);
  const out = [];
  const walk = (n) => {
    if (n.tag === '#root') {
      n.children.forEach(walk);
      return;
    }
    if (SKIP.has(n.tag)) return;
    if (n.tag === 'div' && has(n, 'wrap')) {
      n.children.forEach(walk);
      return;
    }
    if (n.tag === 'main' || n.tag === 'header' || n.tag === 'section' || n.tag === 'footer') {
      block(n, out, {});
      return;
    }
    if (n.tag === 'div' || n.tag === 'p' || n.tag === 'ol' || n.tag === 'ul' || n.tag === 'hr') {
      block(n, out, {});
      return;
    }
  };
  walk(tree);
  let md = out.join('\n');
  // normalização de espaçamento em blocos Markdown
  md =
    md
      .replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2') // linha em branco antes de heading
      .replace(/([^\n|])\n(\| )/g, '$1\n\n$2') // antes de tabela
      .replace(/(\|)\n([^|\n])/g, '$1\n\n$2') // depois de tabela
      .replace(/([^\n`])\n(```)/g, '$1\n\n$2') // antes de fence
      .replace(/(```)\n([^\n`])/g, '$1\n\n$2') // depois de fence
      .replace(/([^\n>])\n(> )/g, '$1\n\n$2') // antes de blockquote
      .replace(/(^> .*)\n([^>\n])/gm, '$1\n\n$2') // depois de blockquote
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim() + '\n';
  return md;
}

const [, , inFile, outFile] = process.argv;
const md = convert(inFile);
writeFileSync(outFile, md, 'utf8');
console.log(`${outFile}: ${md.length} chars, ${md.split('\n').length} lines`);
