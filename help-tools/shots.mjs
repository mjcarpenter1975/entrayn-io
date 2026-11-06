// Retakes the help screenshots from the demo account. Plain English:
//   npm run shots                 → every shot in shots.json
//   npm run shots -- athlete-home-phone coach-today-desktop   → just those
// The demo password is asked for each run (or read from ENTRAYN_DEMO_PASSWORD for that one
// command). It is kept in memory only and never written to any file.
//
// Safety rules, all enforced here:
//  - Only @demo.entrayn.app logins. Ruby (rehab) is never used.
//  - Anything that would save data is blocked, unless the shot says "writes": true.
//  - Screens showing Run (Running tab, + New run, run plans) are left out until Run launches.
//  - The page fails if it shows an email address outside the demo domain, or the word "rehab".
//  - Athlete screens show Entrayn green unless the shot says "brand": "coach". Only this
//    browser's copy of the branding reply is changed; nothing in the app or data changes.
//  - Browser time zone is Melbourne. Refuses to run near the nightly demo rebuild (2:05am).
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'help', 'img')
const cfg = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'))
const DOMAIN = 'demo.entrayn.app'
const ENTRAYN_GREEN = '#085041'

// Playwright and sharp: use a local install if there is one, else the machine-wide one.
function load(name) {
  try { return createRequire(import.meta.url)(name) } catch {
    return createRequire(join(execSync('npm root -g').toString().trim(), 'x.js'))(name)
  }
}
const { chromium } = load('playwright')
const sharp = load('sharp')

// Not near the nightly rebuild (02:05 Melbourne).
const mel = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date())
const mins = Number(mel.find(p => p.type === 'hour').value) * 60 + Number(mel.find(p => p.type === 'minute').value)
if (mins >= 110 && mins <= 155) { console.error('The demo is rebuilt at 2:05am Melbourne time. Try again after 2:35am.'); process.exit(1) }

const wanted = process.argv.slice(2)
const shots = cfg.shots.filter(s => !wanted.length || wanted.includes(s.id))
if (wanted.length && shots.length !== wanted.length) { console.error('Unknown shot id in: ' + wanted.join(', ')); process.exit(1) }
for (const s of shots) {
  if (s.as === 'ruby') { console.error(`${s.id}: Ruby (rehab) is never used.`); process.exit(1) }
  if (!cfg.sizes[s.size]) { console.error(`${s.id}: unknown size ${s.size}`); process.exit(1) }
}

async function askPassword() {
  if (process.env.ENTRAYN_DEMO_PASSWORD) return process.env.ENTRAYN_DEMO_PASSWORD
  if (!process.stdin.isTTY) { console.error('No password given.'); process.exit(1) }
  process.stdout.write('Demo password (hidden): ')
  process.stdin.setRawMode(true); process.stdin.resume()
  let pw = ''
  return new Promise(res => process.stdin.on('data', d => {
    for (const ch of d.toString()) {
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); return res(pw) }
      if (ch === '\u0003') process.exit(1)
      pw = ch === '\u007f' ? pw.slice(0, -1) : pw + ch
    }
  }))
}
const password = await askPassword()
const emailFor = who => `${who === 'coach' ? 'coach' : who}@${DOMAIN}`

const browser = await chromium.launch({ args: ['--lang=en-AU'], env: { ...process.env, LANG: 'en_AU.UTF-8', LANGUAGE: 'en_AU' } }) // Australian date formats
const sessions = new Map() // login kept in memory only, per account and size
const results = [], problems = []
mkdirSync(out, { recursive: true })

async function newContext(size, state, tall) {
  const v = cfg.sizes[size]
  return browser.newContext({
    viewport: { width: v.width, height: tall || v.height }, deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile,
    timezoneId: 'Australia/Melbourne', locale: 'en-AU', storageState: state,
  })
}

// Block saves. Signing in is the one allowed POST.
function guard(page, allowWrites, blocked) {
  return page.route('**/*', route => {
    const r = route.request(), m = r.method()
    if (['GET', 'HEAD', 'OPTIONS'].includes(m) || allowWrites || /\/auth\/v1\/token/.test(r.url())) return route.continue()
    blocked.push(`${m} ${r.url().replace(/\?.*/, '')}`)
    return route.abort()
  })
}

async function login(who, size) {
  const key = `${who}|${size}`
  if (sessions.has(key)) return sessions.get(key)
  const email = emailFor(who)
  if (!email.endsWith('@' + DOMAIN)) throw new Error('Only demo accounts can be used.')
  const ctx = await newContext(size)
  const page = await ctx.newPage()
  await guard(page, false, [])
  await page.goto(cfg.base + '/login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !/\/login$/.test(u.pathname), { timeout: 20000 })
  const signedIn = await page.evaluate(() => Object.keys(localStorage).some(k => k.includes('auth-token')) || document.cookie.includes('auth-token'))
  if (!signedIn) throw new Error(`Couldn't sign in as ${email}`)
  const state = await ctx.storageState()
  await ctx.close()
  sessions.set(key, state)
  return state
}

for (const s of shots) {
  try {
    const ctx = await newContext(s.size, await login(s.as, s.size), s.tall)
    const page = await ctx.newPage()
    const blocked = []
    await guard(page, !!s.writes, blocked)
    if (s.brand !== 'coach') {
      await page.route('**/api/pt-info*', async route => {
        const res = await route.fetch(); let body
        try { body = await res.json() } catch { return route.fulfill({ response: res }) }
        if (body && body.branding) body.branding = { whiteLabel: false, logoUrl: null, colour: ENTRAYN_GREEN, poweredBy: true }
        return route.fulfill({ response: res, json: body })
      })
    }
    await page.goto(cfg.base + s.path, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    for (const st of s.steps || []) {
      if (st.click) await page.locator(st.click).first().click({ timeout: 10000 })
      if (st.clickIf) { const l = page.locator(st.clickIf).first(); if (await l.isVisible().catch(() => false)) await l.click() }
      if (st.waitText) await page.getByText(st.waitText).first().waitFor({ timeout: st.timeout || 15000 })
      if (st.wait) await page.waitForTimeout(st.wait)
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    const who = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('auth-token')).map(([, v]) => { try { return JSON.parse(v).user?.email } catch { return null } })[0])
    if (who && !who.endsWith('@' + DOMAIN)) throw new Error(`signed in as a non-demo account`)
    const text = await page.evaluate(() => document.body.innerText)
    const emails = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter(e => !e.toLowerCase().endsWith('@' + DOMAIN) && e.toLowerCase() !== 'hello@entrayn.app')
    if (emails.length) throw new Error(`shows an address outside the demo: ${[...new Set(emails)].join(', ')}`)
    if (/rehab/i.test(text)) throw new Error('shows the word "rehab" (held back until legal and clinical review)')
    const v = cfg.sizes[s.size]
    let png
    if (s.card) {
      // Just one card: find the text (or CSS selector), then the nearest rounded, bordered box around it.
      const found = await page.evaluate(want => {
        let el = null
        if (want.css) el = document.querySelector(want.css)
        else {
          const t = want.text.toLowerCase()
          const all = [...document.querySelectorAll('body *')].filter(e => e.getClientRects().length)
          el = all.find(e => e.innerText && e.innerText.trim().toLowerCase() === t) || all.find(e => e.children.length === 0 && e.innerText && e.innerText.toLowerCase().includes(t))
        }
        while (el && el !== document.body) {
          const cs = getComputedStyle(el), r = el.getBoundingClientRect()
          if (parseFloat(cs.borderTopLeftRadius) >= 12 && parseFloat(cs.borderTopWidth) > 0 && r.width > 200) { el.setAttribute('data-shot-card', ''); return true }
          el = el.parentElement
        }
        return false
      }, s.card)
      if (!found) throw new Error(`couldn't find the card for ${JSON.stringify(s.card)}`)
      png = await page.locator('[data-shot-card]').first().screenshot()
    } else {
      png = await page.screenshot(s.clip ? { fullPage: true, clip: { x: 0, y: 0, width: v.width, height: s.clip.height } } : { fullPage: !!s.full })
    }
    const webp = await sharp(png).webp({ quality: 82 }).toBuffer()
    const file = join(out, s.id + '.webp')
    const hash = b => createHash('sha1').update(b).digest('hex')
    const before = existsSync(file) ? hash(readFileSync(file)) : null
    writeFileSync(file, webp)
    results.push(`${before === null ? 'new    ' : before === hash(webp) ? 'same   ' : 'changed'}  ${s.id}${blocked.length ? `  (blocked ${blocked.length} save${blocked.length > 1 ? 's' : ''}: ${[...new Set(blocked)].join(', ')})` : ''}`)
    await ctx.close()
  } catch (e) {
    problems.push(`${s.id}: ${e.message.split('\n')[0]}`)
  }
}
await browser.close()
console.log(results.join('\n'))
if (problems.length) { console.error('\nNot taken:\n- ' + problems.join('\n- ')); process.exit(1) }
console.log(`\n${results.length} shots saved to help/img.`)
