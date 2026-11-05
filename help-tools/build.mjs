// Builds the help pages. Plain English version: reads the Markdown articles in help-source/,
// writes finished web pages to help/, then checks links and images. Run: npm run help
// Each article starts with a small header:
//   title, summary, group, order, status, checked (date), keywords (optional)
// status: live = public | unlisted = page exists, hidden from lists, search and Google | draft = no page
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'help-source'), out = join(root, 'help')
const GUIDES = [
  { key: 'coaches', title: 'For coaches', blurb: 'Set up, add clients, build programmes and run your week.', open: true },
  { key: 'athletes', title: 'For athletes', blurb: 'Join your coach, log your sessions and see your progress.', open: true },
  { key: 'solo', title: 'Training on your own', blurb: 'Get a programme, log and track without a coach.', open: false }, // opens with SOLO_SIGNUP_OPEN
  { key: 'faq', title: 'FAQ and troubleshooting', blurb: 'Invite links, sign-in, notifications and time zones.', open: true },
]
const CONTACT = 'hello@entrayn.app'
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const errors = []

function parse(file, guide) {
  const raw = readFileSync(file, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) { errors.push(`${file}: no header`); return null }
  const meta = Object.fromEntries(m[1].split('\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  for (const k of ['title', 'summary', 'group', 'order', 'status', 'checked']) if (!meta[k]) errors.push(`${file}: missing ${k}`)
  if (!['live', 'unlisted', 'draft'].includes(meta.status)) errors.push(`${file}: bad status ${meta.status}`)
  const slug = file.split('/').pop().replace(/\.md$/, '')
  return { ...meta, order: Number(meta.order), slug, guide, body: m[2], url: `/help/${guide}/${slug}` }
}

const articles = GUIDES.flatMap(g => {
  const d = join(src, g.key)
  return existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.md')).map(f => parse(join(d, f), g.key)).filter(Boolean) : []
})
const listed = a => a.status === 'live' && GUIDES.find(g => g.key === a.guide).open
const css = readFileSync(join(root, 'help-tools/help.css'), 'utf8')
const bars = readFileSync(join(root, 'brand/entrayn-logo.svg'), 'utf8').replace(/<\?xml[^>]*\?>/, '').replace('<svg', '<svg class="logo"')

const page = ({ title, description, body, noindex, crumbs = [] }) => `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Entrayn Help</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/entrayn-icon-only.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script src="https://app.termly.io/resource-blocker/a99b93a9-1b7b-4818-bd18-06ebfd9cb36d?autoBlock=on"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap">
<style>${css}</style>
</head>
<body>
<header class="top"><div class="wrap top-in">
  <a href="/help" aria-label="Entrayn Help home">${bars}</a>
  <nav aria-label="Main"><a href="/help">Help</a><a href="https://entrayn.app/login">Sign in</a></nav>
</div></header>
<main class="wrap">
${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(c => `<a href="${c.href}">${esc(c.label)}</a>`).join('<span aria-hidden="true">/</span>')}</nav>` : ''}
${body}
</main>
<footer><div class="wrap foot-in">
  <span>© 2026 Entrayn Pty Ltd</span>
  <span class="foot-links"><a href="/">entrayn.io</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cookies">Cookies</a></span>
</div></footer>
</body>
</html>
`

function write(path, html) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, html) }
const fresh = () => { rmSync(join(out), { recursive: true, force: true }); mkdirSync(out, { recursive: true }) }
const keepImg = join(root, 'help-tools/.img-keep')
if (existsSync(join(out, 'img'))) cpSync(join(out, 'img'), keepImg, { recursive: true })
fresh()
if (existsSync(keepImg)) { cpSync(keepImg, join(out, 'img'), { recursive: true }); rmSync(keepImg, { recursive: true }) }

const groupsOf = list => [...new Set(list.sort((a, b) => a.order - b.order).map(a => a.group))]
const articleLink = a => `<li><a href="${a.url}">${esc(a.title)}</a></li>`

// Articles
for (const a of articles.filter(x => x.status !== 'draft')) {
  const g = GUIDES.find(x => x.key === a.guide)
  const noindex = !listed(a)
  const date = new Date(a.checked + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  write(join(out, a.guide, a.slug + '.html'), page({
    title: a.title, description: a.summary, noindex,
    crumbs: [{ href: '/help', label: 'Help' }, ...(g.open ? [{ href: `/help/${g.key}`, label: g.title }] : [])],
    body: `<article class="article">
<h1>${esc(a.title)}</h1>
<p class="lead">${esc(a.summary)}</p>
${marked.parse(a.body)}
<p class="checked">Last checked ${date}</p>
<aside class="stuck"><strong>Still stuck?</strong> Email <a href="mailto:${CONTACT}">${CONTACT}</a> and we'll help.</aside>
</article>`,
  }))
}

// Guide pages
for (const g of GUIDES) {
  const list = articles.filter(a => a.guide === g.key && a.status === 'live')
  write(join(out, g.key, 'index.html'), page({
    title: g.title, description: g.blurb, noindex: !g.open,
    crumbs: [{ href: '/help', label: 'Help' }],
    body: `<h1>${esc(g.title)}</h1><p class="lead">${esc(g.blurb)}</p>
${groupsOf(list).map(n => `<section class="group"><h2>${esc(n)}</h2><ul class="links">${list.filter(a => a.group === n).map(articleLink).join('')}</ul></section>`).join('\n') || '<p>Articles are on their way.</p>'}`,
  }))
}

// Landing page, with a small search over listed articles only
const index = articles.filter(listed).map(a => ({ t: a.title, s: a.summary, k: a.keywords || '', u: a.url, g: GUIDES.find(g => g.key === a.guide).title }))
const doors = GUIDES.filter(g => g.open)
write(join(out, 'index.html'), page({
  title: 'Help', description: 'Short how-to guides for coaches and athletes using Entrayn.',
  body: `<section class="hero"><h1>How can we help?</h1>
<label class="search"><span class="sr">Search help</span><input id="q" type="search" placeholder="Search, for example invite link" autocomplete="off"></label>
<ul id="results" class="links results" hidden></ul><p id="none" class="none" hidden>Nothing found. Try another word, or email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p></section>
<section class="doors">${doors.map(g => `<a class="door" href="/help/${g.key}"><h2>${esc(g.title)}</h2><p>${esc(g.blurb)}</p></a>`).join('')}</section>
<script>
const A=${JSON.stringify(index).replace(/</g, '\\u003c')};
const q=document.getElementById('q'),r=document.getElementById('results'),n=document.getElementById('none');
q.addEventListener('input',()=>{const w=q.value.toLowerCase().split(/\\s+/).filter(Boolean);r.replaceChildren();
if(!w.length){r.hidden=n.hidden=true;return}
const f=A.filter(a=>{const h=(a.t+' '+a.s+' '+a.k).toLowerCase();return w.every(x=>h.includes(x))});
f.forEach(a=>{const l=document.createElement('li'),e=document.createElement('a');e.href=a.u;e.textContent=a.t;const s=document.createElement('span');s.textContent=a.g;l.append(e,s);r.append(l)});
r.hidden=!f.length;n.hidden=!!f.length})
</script>`,
}))

// Checks
const known = new Set(['/help', ...GUIDES.map(g => `/help/${g.key}`), ...articles.filter(a => a.status !== 'draft').map(a => a.url)])
const used = new Set()
for (const a of articles) {
  if (a.status === 'draft') continue
  for (const [, href] of a.body.matchAll(/\]\((\/[^)\s]+)\)/g)) {
    const path = href.split('#')[0]
    if (path.startsWith('/help/img/')) { used.add(path); if (!existsSync(join(root, path))) errors.push(`${a.slug}: missing image ${path}`) }
    else if (!known.has(path)) errors.push(`${a.slug}: broken link ${href}`)
    else { const t = articles.find(x => x.url === path); if (t && listed(a) && !listed(t)) errors.push(`${a.slug}: public article links to hidden ${href}`) }
  }
  if (/mjcarpenter|@(?!entrayn\.app)[a-z0-9-]+\.[a-z]/i.test(a.body)) errors.push(`${a.slug}: contains an email address other than Entrayn's`)
  if (a.body.split(/\s+/).length > 260) console.warn(`  note: ${a.slug} is over 260 words`)
}
if (existsSync(join(out, 'img'))) for (const f of readdirSync(join(out, 'img'))) if (!used.has(`/help/img/${f}`)) console.warn(`  note: unused image ${f}`)

const count = s => articles.filter(a => a.status === s).length
console.log(`Built ${count('live')} live, ${count('unlisted')} unlisted, ${count('draft')} draft articles.`)
if (errors.length) { console.error('Problems:\n- ' + errors.join('\n- ')); process.exit(1) }
console.log('Checks passed.')
