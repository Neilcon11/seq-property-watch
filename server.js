import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES || 30);
const AUTO_CHECK_ENABLED = process.env.AUTO_CHECK_ENABLED === 'true';
const CHECK_SECRET = process.env.CHECK_SECRET || '';
const LAND_SOURCE_URLS = (process.env.ONLINE_LAND_SOURCE_URLS || "https://www.stockland.com.au/residential/qld/aura/land-for-sale,https://www.stockland.com.au/residential/qld/aura,https://harmony.avid.com.au/land-for-sale/,https://www.realestate.com.au/buy/property-residential+land-in-sunshine+coast,+qld/list-1,https://www.domain.com.au/sale/sunshine-coast-qld/land/").split(',').map(s => s.trim()).filter(Boolean);
const GMAIL_QUERY = process.env.GMAIL_QUERY || 'newer_than:2d (land OR "home and land" OR townhouse OR "house and land" OR "land release") ("Sunshine Coast" OR Brisbane OR "Moreton Bay" OR Queensland OR SEQ)';
const ASSUMPTIONS = {
  interestRate: Number(process.env.INTEREST_RATE || 0.065),
  depositRate: Number(process.env.DEPOSIT_RATE || 0.20),
  expenseRate: Number(process.env.EXPENSE_RATE || 0.25),
  growthRate: Number(process.env.CAPITAL_GROWTH_RATE || 0.05),
  townhouseRent: Number(process.env.WEEKLY_RENT_TOWNHOUSE || 650),
  houseRent: Number(process.env.WEEKLY_RENT_HOUSE || 760),
  roomRent: Number(process.env.WEEKLY_RENT_ROOM || 220),
  grannyRent: Number(process.env.WEEKLY_RENT_GRANNY_FLAT || 400)
};

const seedRecords = [
  {
    "id": "ridgeview-1308",
    "title": "Ridgeview Stage 13 - Lot 1308",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Narangba",
    "estate": "Ridgeview",
    "price": "$635,000",
    "size": "492m2",
    "beds": "",
    "status": "Final release, available now",
    "source": "Satterley email",
    "origin": "Email",
    "date": "2026-07-02",
    "url": "https://satterley.com.au/ridgeview/land-for-sale/",
    "image": "",
    "notes": "Rare returned lot. Email says no further releases planned."
  },
  {
    "id": "ridgeview-1371",
    "title": "Ridgeview Stage 13 - Lot 1371",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Narangba",
    "estate": "Ridgeview",
    "price": "$645,000",
    "size": "576m2",
    "beds": "",
    "status": "Final release, available now",
    "source": "Satterley email",
    "origin": "Email",
    "date": "2026-07-02",
    "url": "https://satterley.com.au/ridgeview/land-for-sale/",
    "image": "",
    "notes": "Second returned homesite in Ridgeview Narangba."
  },
  {
    "id": "north-harbour-11c",
    "title": "North Harbour - The Avenues Stage 11C",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Burpengary East",
    "estate": "North Harbour",
    "price": "Contact sales team",
    "size": "Land types from 300m2 to 576m2+",
    "beds": "",
    "status": "Public site lists stage release",
    "source": "North Harbour website",
    "origin": "Public land",
    "date": "2026-07-02",
    "url": "https://www.northharbour.com.au/land-for-sale/",
    "image": "https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg",
    "notes": "Current stage release shown on North Harbour land page."
  },
  {
    "id": "north-harbour-stages",
    "title": "North Harbour - Other Avenues Stages",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Burpengary East",
    "estate": "North Harbour",
    "price": "Contact sales team",
    "size": "Land types from 300m2 to 576m2+",
    "beds": "",
    "status": "Public site lists multiple stage releases",
    "source": "North Harbour website",
    "origin": "Public land",
    "date": "2026-07-02",
    "url": "https://www.northharbour.com.au/land-for-sale/",
    "image": "https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg",
    "notes": "Stages 11B, 11A, 10, 9, 8, 5, 4 and 2 are listed publicly; individual prices not exposed."
  },
  {
    "id": "harmony-land",
    "title": "Harmony Palmview - Land for Sale",
    "kind": "Land",
    "area": "Sunshine Coast",
    "suburb": "Palmview",
    "estate": "Harmony",
    "price": "Check availability",
    "size": "Not listed publicly",
    "beds": "",
    "status": "Land page active / blocks move quickly",
    "source": "Harmony website",
    "origin": "Public land",
    "date": "2026-07-02",
    "url": "https://harmony.avid.com.au/land-for-sale/",
    "image": "",
    "notes": "Harmony says blocks are difficult to find and do not last long; verify live availability with sales."
  },
  {
    "id": "lilywood-462",
    "title": "Lilywood Landings Stage 12 - Lot 462",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $545,000",
    "size": "420m2",
    "beds": "",
    "status": "Stage 12 now selling",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Frontage 14m, depth 30m. Estate land range in email: $525,000-$565,000."
  },
  {
    "id": "lilywood-465",
    "title": "Lilywood Landings Stage 12 - Lot 465",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $565,000",
    "size": "471m2",
    "beds": "",
    "status": "Stage 12 now selling",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Frontage 16.2m, depth 30m."
  },
  {
    "id": "aura-release",
    "title": "Aura Land Release Reminder",
    "kind": "Land",
    "area": "Sunshine Coast",
    "suburb": "Aura",
    "estate": "Stockland Aura",
    "price": "Not shown in email",
    "size": "Not shown",
    "beds": "",
    "status": "Land release 27 June 2026 at 8:00am",
    "source": "Stockland email",
    "origin": "Email",
    "date": "2026-06-26",
    "url": "https://www.stockland.com.au/residential/qld/aura",
    "image": "",
    "notes": "Email subject: REMINDER: Land release at Aura tomorrow."
  },
  {
    "id": "affinity-1815-1820",
    "title": "Affinity Estate Stage 18 - Lots 1815-1820",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Morayfield",
    "estate": "Affinity Estate",
    "price": "See attached brochures",
    "size": "6 low-set terrace lots",
    "beds": "4 bed product noted",
    "status": "Expected registration July 2026",
    "source": "Thompson Sustainable Homes email",
    "origin": "Email",
    "date": "2026-06-29",
    "url": "#",
    "image": "",
    "notes": "Lots 1815 and 1820 are 10m traditional lots; attached PDFs include package brochures and site plan."
  },
  {
    "id": "lilywood-470",
    "title": "Lilywood Landings - Lot 470 Barn",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $892,891",
    "size": "400m2 land, 174.8sq",
    "beds": "4 bed, 2 bath, 2 car",
    "status": "Email-sourced package",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Builder shown in email link as Kiba Built."
  },
  {
    "id": "lilywood-471",
    "title": "Lilywood Landings - Lot 471 Contempo",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $894,075",
    "size": "400m2 land, 178sq",
    "beds": "4 bed, 2 bath",
    "status": "Email-sourced package",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Builder shown in email link as Ultra Living Homes. Email lists 0 car."
  },
  {
    "id": "morayfield-freestanding",
    "title": "Morayfield freestanding homes",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Morayfield",
    "estate": "Not specified",
    "price": "From $876,000",
    "size": "Not stated",
    "beds": "4 bed, 2 bath, 2 car",
    "status": "Rego March 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Freehold title and freestanding houses. Email says reply to learn more."
  },
  {
    "id": "redbank-plains",
    "title": "Redbank Plains packages",
    "kind": "House & Land",
    "area": "Brisbane",
    "suburb": "Redbank Plains",
    "estate": "Not specified",
    "price": "$932,000-$1,020,000",
    "size": "375-450m2 land",
    "beds": "4 bed designs, 183-206sqm",
    "status": "Only 2 packages available; titles Sep 2026",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Fixed price packages with full turnkey inclusions."
  },
  {
    "id": "rochedale-saint-eves",
    "title": "Rochedale Saint Eves final custom package",
    "kind": "House & Land",
    "area": "Brisbane",
    "suburb": "Rochedale",
    "estate": "Saint Eves",
    "price": "$1,900,000",
    "size": "375m2 land, 270sqm home",
    "beds": "Not stated",
    "status": "Final package; titles early 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Rare turnkey offering with upgrade package included."
  },
  {
    "id": "lilywood-216",
    "title": "Lilywood Landings - Lot 216 Parkside Terrace",
    "kind": "Townhouse",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $793,000",
    "size": "280m2 land, 170.38sq",
    "beds": "3 bed, 2 bath, 2 car",
    "status": "Stage 10B terraces over 60% sold",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Townhouse email record."
  },
  {
    "id": "lilywood-236",
    "title": "Lilywood Landings - Lot 236 Parklands Solis",
    "kind": "Townhouse",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $802,000",
    "size": "274m2 land, 178.84sq",
    "beds": "4 bed, 2 bath, 2 car",
    "status": "Stage 10B terraces over 60% sold",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Townhouse email record."
  },
  {
    "id": "joyner-townhomes",
    "title": "Joyner townhomes",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Joyner",
    "estate": "Not specified",
    "price": "From $962,000",
    "size": "Boutique 74-townhome development",
    "beds": "4 bedroom townhomes",
    "status": "Only 1 remaining; completion Q4 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Email notes site works commenced and gross yields over 4.0%."
  },
  {
    "id": "taigum-townhouse",
    "title": "Taigum townhouse",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Taigum",
    "estate": "Not specified",
    "price": "$1,100,000",
    "size": "Boutique complex of 56",
    "beds": "4 bedroom",
    "status": "Only 1 remaining",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Ausbuild project, pool and recreational facilities."
  },
  {
    "id": "pallara-terraces",
    "title": "Pallara terraces",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Pallara",
    "estate": "Not specified",
    "price": "From $1,029,000",
    "size": "Not stated",
    "beds": "4 bedroom terraces",
    "status": "Only 1 remaining; completion mid 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Boutique complex around 18km south of Brisbane CBD."
  },
  {
    "id": "albany-creek-senses",
    "title": "Albany Creek Senses townhouses",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Albany Creek",
    "estate": "Senses",
    "price": "From $1,265,000",
    "size": "34-townhouse boutique block",
    "beds": "4 bedroom",
    "status": "Only 5 remaining; settle Q4 2026",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Construction underway, communal pool/BBQ and grassed area."
  },
  {
    "id": "bundall-terrace",
    "title": "Bundall boutique terrace",
    "kind": "Townhouse",
    "area": "Gold Coast",
    "suburb": "Bundall",
    "estate": "Not specified",
    "price": "$1,540,000",
    "size": "22 terrace homes",
    "beds": "Final 3 bedroom terrace",
    "status": "Complete; only 1 left",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Viewings available Wednesdays and Saturdays on request."
  },
  {
    "id": "loganholme-townhomes",
    "title": "Loganholme completed townhomes",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Loganholme",
    "estate": "Not specified",
    "price": "Price not captured in snippet",
    "size": "17-townhouse boutique development",
    "beds": "Townhomes",
    "status": "Only 4 remaining; completed",
    "source": "ARG Property email",
    "origin": "Email",
    "date": "2026-06-17",
    "url": "#",
    "image": "",
    "notes": "Email identified as completed townhouse opportunity; full body can be read for pricing if needed."
  }
];
let memoryRecords = seedRecords.map(r => ({ ...r, discoveredAt: r.discoveredAt || r.date || new Date().toISOString(), automated: false }));
let pool;
let initPromise;

function idFor(input) { return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 16); }
function today() { return new Date().toISOString().slice(0, 10); }
function text(v) { return String(v || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/s+/g, ' ').trim(); }
function moneyNumber(v) { const m = String(v || '').replace(/,/g, '').match(/$?s*(d{3,8})/); return m ? Number(m[1]) : 0; }
function landSize(v) { const m = String(v || '').replace(/,/g, '').match(/(d{3,5})s*m/i); return m ? Number(m[1]) : 0; }
function bedCount(v) { const m = String(v || '').match(/(d+)s*bed/i); return m ? Number(m[1]) : 0; }
function areaFromText(s) { const n = s.toLowerCase(); if (n.includes('sunshine') || n.includes('aura') || n.includes('palmview') || n.includes('caloundra') || n.includes('maroochydore')) return 'Sunshine Coast'; if (n.includes('brisbane')) return 'Brisbane'; if (n.includes('moreton') || n.includes('burpengary') || n.includes('narangba') || n.includes('caboolture') || n.includes('morayfield') || n.includes('waraba') || n.includes('lilywood')) return 'Moreton Bay'; if (n.includes('gold coast') || n.includes('logan')) return 'Gold Coast'; return 'South East Queensland'; }
function kindFromText(s) { const n = s.toLowerCase(); if (n.includes('townhouse') || n.includes('townhome')) return 'Townhouse'; if (n.includes('house and land') || n.includes('home and land') || n.includes('package')) return 'House & Land'; return 'Land'; }
function suburbFromText(s) { const suburbs = ['Aura','Palmview','Caloundra','Baringa','Nirimba','Maroochydore','Nambour','Beerwah','Narangba','Burpengary East','Morayfield','Caboolture','Waraba','Lilywood','Brisbane','Loganholme']; return suburbs.find(x => s.toLowerCase().includes(x.toLowerCase())) || 'Sunshine Coast / SEQ'; }
function priceFromText(s) { const m = s.replace(/,/g, '').match(/(?:$|froms*$)s*(d{3,8})/i); return m ? '$' + Number(m[1]).toLocaleString('en-AU') : 'Check listing'; }
function imageFromHtml(html, base) { const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<img[^>]+src=["']([^"']+)/i); try { return m ? new URL(m[1], base).href : ''; } catch { return ''; } }
function uniqueById(rows) { return [...new Map(rows.map(r => [r.id, r])).values()]; }

async function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  }
  if (!initPromise) initPromise = pool.query('create table if not exists records (id text primary key, data jsonb not null, created_at timestamptz default now())');
  await initPromise;
  return pool;
}
async function allRecords() {
  const p = await db();
  if (!p) return uniqueById(memoryRecords);
  for (const r of memoryRecords) await p.query('insert into records(id,data) values($1,$2) on conflict (id) do nothing', [r.id, r]);
  const { rows } = await p.query('select data from records order by coalesce(data->>'date', data->>'discoveredAt') desc');
  return rows.map(r => r.data);
}
async function saveRecords(rows, source) {
  const p = await db();
  const existing = new Set((await allRecords()).map(r => r.id));
  const inserted = [];
  for (const row of rows) {
    const record = { ...row, discoveredAt: row.discoveredAt || new Date().toISOString(), automated: true, source: row.source || source };
    if (existing.has(record.id)) continue;
    existing.add(record.id);
    inserted.push(record);
    if (p) await p.query('insert into records(id,data) values($1,$2) on conflict (id) do nothing', [record.id, record]);
    else memoryRecords.push(record);
  }
  return inserted;
}

function analyseInvestment(record) {
  const blob = [record.title, record.kind, record.suburb, record.estate, record.size, record.notes, record.status].join(' ').toLowerCase();
  const price = moneyNumber(record.price);
  const size = landSize(record.size);
  const beds = bedCount(record.beds);
  const signals = [];
  if (size >= 700 || /subdivid|split|dual occ|duplex|corner|two street|wide frontage|lmr|mdr|low[- ]medium/.test(blob)) signals.push('possible subdivision or dual-occupancy angle');
  if (size >= 450 || /granny|secondary dwelling|auxiliary unit/.test(blob)) signals.push('possible granny flat / secondary dwelling angle');
  if (beds >= 4 || /student|rooming|share house|near university|hospital/.test(blob)) signals.push('possible share-home angle');
  if (/registration|release|returned lot|new release|final release/.test(blob)) signals.push('fresh supply / timing angle');
  let weeklyRent = 0;
  if (record.kind === 'Townhouse') weeklyRent = ASSUMPTIONS.townhouseRent;
  else if (record.kind === 'House & Land') weeklyRent = ASSUMPTIONS.houseRent;
  if (signals.some(s => s.includes('share-home')) && beds) weeklyRent = Math.max(weeklyRent, beds * ASSUMPTIONS.roomRent);
  if (signals.some(s => s.includes('granny'))) weeklyRent += ASSUMPTIONS.grannyRent;
  const annualRent = weeklyRent * 52;
  const debt = price ? price * (1 - ASSUMPTIONS.depositRate) : 0;
  const interest = debt * ASSUMPTIONS.interestRate;
  const expenses = annualRent * ASSUMPTIONS.expenseRate;
  const cashflow = annualRent - interest - expenses;
  const capitalGainOneYear = price ? price * ASSUMPTIONS.growthRate : 0;
  const score = signals.length * 20 + (cashflow > 0 ? 15 : 0) + (size >= 600 ? 10 : 0);
  return { signals, score, weeklyRent, annualRent, cashflow, capitalGainOneYear, assumptions: ASSUMPTIONS, note: 'Indicative only. Confirm zoning, overlays, lending, build costs, insurance and rental evidence before acting.' };
}
function opportunities(records) { return records.map(r => ({ ...r, investment: analyseInvestment(r) })).filter(r => r.investment.signals.length || r.investment.score >= 20).sort((a,b) => b.investment.score - a.investment.score); }

async function gmailAccessToken() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
  const body = new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!res.ok) throw new Error('Gmail token refresh failed: ' + res.status);
  return (await res.json()).access_token;
}
function decodeBody(part) { try { return Buffer.from((part?.body?.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; } }
function parts(payload) { const out = []; const walk = p => { out.push(p); (p.parts || []).forEach(walk); }; walk(payload || {}); return out; }
async function checkGmail() {
  const token = await gmailAccessToken();
  if (!token) return { configured: false, found: [], message: 'Missing Gmail API Railway variables' };
  const search = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?' + new URLSearchParams({ q: GMAIL_QUERY, maxResults: '20' }), { headers: { Authorization: 'Bearer ' + token } });
  if (!search.ok) throw new Error('Gmail search failed: ' + search.status);
  const ids = (await search.json()).messages || [];
  const found = [];
  for (const item of ids) {
    const msgRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + item.id + '?format=full', { headers: { Authorization: 'Bearer ' + token } });
    if (!msgRes.ok) continue;
    const msg = await msgRes.json();
    const headers = Object.fromEntries((msg.payload.headers || []).map(h => [h.name.toLowerCase(), h.value]));
    const body = parts(msg.payload).map(decodeBody).join(' ');
    const blob = text([headers.subject, msg.snippet, body].join(' '));
    if (!/(land|lot|townhouse|townhome|home and land|house and land|release|package)/i.test(blob)) continue;
    const title = headers.subject || 'Email property opportunity';
    found.push({ id: 'gmail-' + item.id, title, kind: kindFromText(blob), area: areaFromText(blob), suburb: suburbFromText(blob), estate: 'Email supplied', price: priceFromText(blob), size: (blob.match(/d{3,5}s*m2?/i) || ['Check email'])[0], beds: (blob.match(/ds*bed[^,.]*/i) || [''])[0], status: 'New email match', source: 'Gmail automation', origin: 'Email', date: today(), url: '#', image: '', notes: blob.slice(0, 260) });
  }
  return { configured: true, found };
}
async function checkOnlineSources() {
  const found = [];
  for (const sourceUrl of LAND_SOURCE_URLS) {
    try {
      const res = await fetch(sourceUrl, { headers: { 'user-agent': 'SEQPropertyWatch/1.0' } });
      if (!res.ok) continue;
      const html = await res.text();
      const clean = text(html);
      const image = imageFromHtml(html, sourceUrl);
      const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([sS]*?)</a>/gi)].slice(0, 80);
      const candidates = links.map(m => ({ href: m[1], label: text(m[2]) })).filter(x => /(land|lot|release|aura|palmview|sunshine|caloundra|house)/i.test(x.label + ' ' + x.href)).slice(0, 10);
      if (!candidates.length && /(sunshine coast|aura|palmview|land for sale|land release)/i.test(clean)) candidates.push({ href: sourceUrl, label: text((html.match(/<title[^>]*>([sS]*?)</title>/i) || [,'Sunshine Coast land listing'])[1]) });
      for (const c of candidates) {
        const href = new URL(c.href, sourceUrl).href;
        const blob = c.label + ' ' + clean.slice(0, 1000);
        if (!/(sunshine|aura|palmview|caloundra|land|lot|release)/i.test(blob)) continue;
        found.push({ id: 'web-' + idFor(href + c.label), title: c.label || 'Sunshine Coast land listing', kind: 'Land', area: areaFromText(blob), suburb: suburbFromText(blob), estate: c.label || new URL(sourceUrl).hostname, price: priceFromText(blob), size: (blob.match(/d{3,5}s*m2?/i) || ['Check listing'])[0], beds: '', status: 'Online land source match', source: new URL(sourceUrl).hostname, origin: 'Public land', date: today(), url: href, image, notes: 'Detected from configured Sunshine Coast land source. Verify details on the source page.' });
      }
    } catch (e) { console.warn('source check failed', sourceUrl, e.message); }
  }
  return uniqueById(found);
}
async function sendTelegram(message) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return { sent: false, reason: 'Missing Telegram variables' };
  const res = await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: false }) });
  return { sent: res.ok, status: res.status, body: await res.text() };
}
function alertText(record) {
  const inv = analyseInvestment(record);
  return ['New SEQ property opportunity', record.title, record.price + ' | ' + record.suburb + ' | ' + record.kind, record.url && record.url !== '#' ? record.url : '', inv.signals.length ? 'Investment angle: ' + inv.signals.join('; ') : '', inv.weeklyRent ? 'Indicative rent: $' + Math.round(inv.weeklyRent) + '/wk' : '', Number.isFinite(inv.cashflow) && inv.cashflow ? 'Indicative cashflow: $' + Math.round(inv.cashflow).toLocaleString('en-AU') + '/yr' : '', inv.capitalGainOneYear ? 'Indicative 1yr capital gain @ ' + Math.round(ASSUMPTIONS.growthRate*1000)/10 + '%: $' + Math.round(inv.capitalGainOneYear).toLocaleString('en-AU') : ''].filter(Boolean).join('
');
}
async function runCheck() {
  const gmail = await checkGmail();
  const online = await checkOnlineSources();
  const newRows = await saveRecords([...(gmail.found || []), ...online], 'Automation');
  const alerts = [];
  for (const r of newRows) alerts.push(await sendTelegram(alertText(r)));
  return { checkedAt: new Date().toISOString(), gmail: { configured: gmail.configured, found: gmail.found?.length || 0, message: gmail.message }, online: { sources: LAND_SOURCE_URLS.length, found: online.length }, inserted: newRows.length, telegram: alerts };
}

function json(res, status, payload) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(payload)); }
function htmlEscape(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function page() { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEQ Property Watch</title><style>:root{--ink:#13201b;--muted:#66756f;--line:#dbe4dd;--green:#0f766e;--gold:#9a6a12;--bg:#f4f7f1}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--ink)}header{padding:30px clamp(16px,4vw,56px);background:linear-gradient(135deg,#123f3b,#315632 56%,#8b6625);color:#fff}h1{font-size:clamp(32px,5vw,58px);margin:4px 0 10px;line-height:1}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:900;color:#dbefe5}.copy{max-width:920px;color:#edf7ef;line-height:1.45}.sharebar{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}button,.btn{border:0;border-radius:8px;background:var(--green);color:#fff;font-weight:900;padding:10px 12px;cursor:pointer;text-decoration:none}.ghost{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.32)}.toolbar{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:10px;padding:14px clamp(16px,4vw,56px);background:rgba(248,250,245,.96);border-bottom:1px solid var(--line)}label{display:grid;gap:5px;font-size:12px;font-weight:900;color:#34433d}select,input{width:100%;border:1px solid #cbd6d0;border-radius:8px;background:#fff;padding:10px;font:inherit}.wrap{padding:24px clamp(16px,4vw,56px) 50px}.stats{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin-bottom:24px}.stat{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px}.stat strong{display:block;font-size:30px}.section-head{display:flex;justify-content:space-between;gap:12px;align-items:end;margin:28px 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}.card{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;display:grid}.visual{min-height:132px;background:#dfe8df center/cover;position:relative}.chips{position:absolute;left:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap}.chip{background:rgba(10,31,28,.8);color:#fff;border-radius:999px;padding:5px 8px;font-size:11px;font-weight:900}.content{padding:14px;display:grid;gap:9px}h2,h3{margin:0}.price{font-weight:900;color:#0f5f58}.facts{display:flex;gap:7px;flex-wrap:wrap;color:var(--muted);font-size:13px}.status{font-weight:800;margin:0}.notes{margin:0;color:#4f6059;line-height:1.4}.source{font-size:12px;color:var(--muted)}.card-actions{display:flex;gap:8px;flex-wrap:wrap}.card-actions a{color:var(--green);font-weight:900}.opportunity{border-left:4px solid var(--gold)}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric{background:#f6f4eb;border:1px solid #e6dcc2;border-radius:8px;padding:8px;font-size:12px}.metric strong{display:block;font-size:16px}.config{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px;color:#394941}.pill{display:inline-flex;margin:3px 4px 3px 0;padding:5px 8px;border-radius:999px;background:#e9efe9;color:#34433d;font-size:12px;font-weight:800}@media(max-width:760px){.toolbar{position:static;grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.metrics{grid-template-columns:1fr}.section-head{display:block}}</style></head><body><header><div class="eyebrow">Automated SEQ property radar</div><h1>SEQ Property Watch</h1><p class="copy">Email-sourced packages and townhouses, public Sunshine Coast land checks, investment opportunity scoring, and Telegram alert readiness. Investment numbers are indicative only and need independent verification.</p><div class="sharebar"><button onclick="shareApp()">Share entire app</button><button class="ghost" onclick="copyText(location.href)">Copy app link</button><button class="ghost" onclick="runManualCheck()">Run check now</button></div></header><section class="toolbar"><label>Type<select id="kind"><option value="">All types</option><option>Land</option><option>House & Land</option><option>Townhouse</option></select></label><label>Area<select id="area"><option value="">All areas</option><option>Sunshine Coast</option><option>Moreton Bay</option><option>Brisbane</option><option>Gold Coast</option><option>South East Queensland</option></select></label><label>Source<select id="origin"><option value="">All sources</option><option>Email</option><option>Public land</option></select></label><label>Sort<select id="sort"><option value="date">Newest first</option><option value="price">Lowest visible price</option><option value="investment">Investment score</option></select></label><label>Search<input id="q" placeholder="Suburb, estate, lot, price"></label></section><main class="wrap"><div class="stats"><div class="stat"><strong id="total">0</strong>tracked records</div><div class="stat"><strong id="newAuto">0</strong>automated finds</div><div class="stat"><strong id="investCount">0</strong>investment flags</div><div class="stat"><strong id="land">0</strong>land records</div></div><section class="config" id="config">Checking automation status...</section><section><div class="section-head"><div><h2>Investment Opportunities</h2><p id="investmentSummary">Scored for subdivision, granny flat, dual occupancy and share-home angles.</p></div></div><div id="opportunities" class="grid"></div></section><section><div class="section-head"><div><h2>Available Stock</h2><p id="summary">Loading records...</p></div></div><div id="cards" class="grid"></div></section></main><script>let records=[],opps=[],config={};const $=s=>document.querySelector(s);const controls=['#kind','#area','#origin','#sort','#q'].map($);function n(v){return String(v||'').toLowerCase()}function dollars(r){let m=String(r.price||'').match(/[\d,]+/);return m?Number(m[0].replace(/,/g,'')):999999999}function fmt(v){return v?('$'+Math.round(v).toLocaleString('en-AU')):'n/a'}function urlFor(r){return location.origin+location.pathname+'#'+r.id}async function copyText(t){try{await navigator.clipboard.writeText(t);alert('Link copied')}catch(e){prompt('Copy this link',t)}}function shareApp(){let data={title:'SEQ Property Watch',text:'SEQ property list',url:location.href};navigator.share?navigator.share(data):copyText(location.href)}function shareRecord(id){let r=records.find(x=>x.id===id);if(!r)return;let u=urlFor(r);let data={title:r.title,text:r.title+' - '+r.price+' - '+r.suburb,url:u};navigator.share?navigator.share(data):copyText(u)}async function runManualCheck(){let secret=prompt('Manual check secret, if configured')||'';let r=await fetch('/api/check?secret='+encodeURIComponent(secret),{method:'POST'});alert(await r.text());await load()}function visual(r){return r.image?'style="background-image:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),url('+r.image+')"':''}function card(r,withInvestment=false){let inv=r.investment||{};return '<article class="card '+(withInvestment?'opportunity':'')+'" id="'+r.id+'"><div class="visual" '+visual(r)+'><div class="chips"><span class="chip">'+r.kind+'</span><span class="chip">'+r.area+'</span><span class="chip">'+r.origin+'</span></div></div><div class="content"><h3>'+r.title+'</h3><div class="price">'+r.price+'</div><div class="facts"><span>'+r.suburb+'</span><span>'+r.estate+'</span><span>'+r.size+'</span>'+(r.beds?'<span>'+r.beds+'</span>':'')+'</div><p class="status">'+r.status+'</p><p class="notes">'+r.notes+'</p>'+(withInvestment?'<div class="metrics"><div class="metric"><strong>'+Math.round(inv.score||0)+'</strong>score</div><div class="metric"><strong>'+fmt(inv.weeklyRent)+'</strong>weekly rent</div><div class="metric"><strong>'+fmt(inv.cashflow)+'</strong>annual cashflow</div></div><p class="notes">'+(inv.signals||[]).join('; ')+'</p>':'')+'<div class="source">'+r.source+' · '+r.date+'</div><div class="card-actions"><button data-share="'+r.id+'">Share this</button><button data-copy="'+r.id+'">Copy link</button>'+(r.url&&r.url!=='#'?'<a href="'+r.url+'" target="_blank" rel="noopener">Open source</a>':'')+'</div></div></article>'}function visible(){const[kind,area,origin,sort,q]=controls;let rows=records.filter(r=>(!kind.value||r.kind===kind.value)&&(!area.value||r.area===area.value)&&(!origin.value||r.origin===origin.value)&&(!q.value||n(Object.values(r).join(' ')).includes(n(q.value))));if(sort.value==='price')rows.sort((a,b)=>dollars(a)-dollars(b));else if(sort.value==='investment')rows.sort((a,b)=>((opps.find(x=>x.id===b.id)||{}).investment?.score||0)-((opps.find(x=>x.id===a.id)||{}).investment?.score||0));else rows.sort((a,b)=>String(b.date||b.discoveredAt).localeCompare(String(a.date||a.discoveredAt)));return rows}function render(){let rows=visible();$('#cards').innerHTML=rows.map(r=>card(r,false)).join('');$('#opportunities').innerHTML=opps.slice(0,12).map(r=>card(r,true)).join('');$('#total').textContent=records.length;$('#newAuto').textContent=records.filter(r=>r.automated).length;$('#investCount').textContent=opps.length;$('#land').textContent=records.filter(r=>r.kind==='Land').length;$('#summary').textContent='Showing '+rows.length+' of '+records.length+' records.';$('#investmentSummary').textContent=opps.length+' records currently have an investment angle. Estimates are indicative only.';$('#config').innerHTML='<strong>Automation:</strong> '+(config.autoCheckEnabled?'scheduled checks on':'scheduled checks off')+' <span class="pill">Gmail '+(config.gmailConfigured?'ready':'needs credentials')+'</span><span class="pill">Telegram '+(config.telegramConfigured?'ready':'needs token/chat')+'</span><span class="pill">Database '+(config.databaseConfigured?'connected':'not connected')+'</span><span class="pill">Sources '+(config.landSourceCount||0)+'</span>';if(location.hash){let el=document.querySelector(location.hash);if(el)el.scrollIntoView({block:'center'})}}async function load(){let [r,o,h]=await Promise.all([fetch('/api/records').then(x=>x.json()),fetch('/api/opportunities').then(x=>x.json()),fetch('/api/health').then(x=>x.json())]);records=r.records;opps=o.opportunities;config=h.config;render()}document.addEventListener('click',e=>{let s=e.target.closest('[data-share]');if(s)return shareRecord(s.dataset.share);let c=e.target.closest('[data-copy]');if(c){let r=records.find(x=>x.id===c.dataset.copy);if(r)copyText(urlFor(r))}});controls.forEach(c=>c.addEventListener('input',render));load();</script></body></html>`; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'seq-property-watch', records: (await allRecords()).length, timestamp: new Date().toISOString(), config: { autoCheckEnabled: AUTO_CHECK_ENABLED, gmailConfigured: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN), telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), databaseConfigured: Boolean(process.env.DATABASE_URL), landSourceCount: LAND_SOURCE_URLS.length, checkIntervalMinutes: CHECK_INTERVAL_MINUTES } });
    if (url.pathname === '/api/records') return json(res, 200, { records: await allRecords() });
    if (url.pathname === '/api/opportunities') return json(res, 200, { opportunities: opportunities(await allRecords()) });
    if (url.pathname === '/api/check' && (req.method === 'POST' || req.method === 'GET')) { if (CHECK_SECRET && url.searchParams.get('secret') !== CHECK_SECRET) return json(res, 401, { ok: false, error: 'Bad or missing CHECK_SECRET' }); return json(res, 200, { ok: true, result: await runCheck() }); }
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (e) { console.error(e); return json(res, 500, { ok: false, error: e.message }); }
});

if (AUTO_CHECK_ENABLED) setInterval(() => runCheck().then(r => console.log('scheduled check', JSON.stringify(r))).catch(e => console.error('scheduled check failed', e)), Math.max(5, CHECK_INTERVAL_MINUTES) * 60 * 1000);
server.listen(PORT, '0.0.0.0', () => console.log('SEQ Property Watch listening on port ' + PORT));
import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const records = [
  {
    "id": "ridgeview-1308",
    "title": "Ridgeview Stage 13 - Lot 1308",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Narangba",
    "estate": "Ridgeview",
    "price": "$635,000",
    "size": "492m2",
    "beds": "",
    "status": "Final release, available now",
    "source": "Satterley email",
    "origin": "Email",
    "date": "2026-07-02",
    "url": "https://satterley.com.au/ridgeview/land-for-sale/",
    "image": "",
    "notes": "Rare returned lot. Email says no further releases planned."
  },
  {
    "id": "ridgeview-1371",
    "title": "Ridgeview Stage 13 - Lot 1371",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Narangba",
    "estate": "Ridgeview",
    "price": "$645,000",
    "size": "576m2",
    "beds": "",
    "status": "Final release, available now",
    "source": "Satterley email",
    "origin": "Email",
    "date": "2026-07-02",
    "url": "https://satterley.com.au/ridgeview/land-for-sale/",
    "image": "",
    "notes": "Second returned homesite in Ridgeview Narangba."
  },
  {
    "id": "north-harbour-11c",
    "title": "North Harbour - The Avenues Stage 11C",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Burpengary East",
    "estate": "North Harbour",
    "price": "Contact sales team",
    "size": "Land types from 300m2 to 576m2+",
    "beds": "",
    "status": "Public site lists stage release",
    "source": "North Harbour website",
    "origin": "Public land",
    "date": "2026-07-02",
    "url": "https://www.northharbour.com.au/land-for-sale/",
    "image": "https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg",
    "notes": "Current stage release shown on North Harbour land page."
  },
  {
    "id": "north-harbour-stages",
    "title": "North Harbour - Other Avenues Stages",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Burpengary East",
    "estate": "North Harbour",
    "price": "Contact sales team",
    "size": "Land types from 300m2 to 576m2+",
    "beds": "",
    "status": "Public site lists multiple stage releases",
    "source": "North Harbour website",
    "origin": "Public land",
    "date": "2026-07-02",
    "url": "https://www.northharbour.com.au/land-for-sale/",
    "image": "https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg",
    "notes": "Stages 11B, 11A, 10, 9, 8, 5, 4 and 2 are listed publicly; individual prices not exposed."
  },
  {
    "id": "harmony-land",
    "title": "Harmony Palmview - Land for Sale",
    "kind": "Land",
    "area": "Sunshine Coast",
    "suburb": "Palmview",
    "estate": "Harmony",
    "price": "Check availability",
    "size": "Not listed publicly",
    "beds": "",
    "status": "Land page active / blocks move quickly",
    "source": "Harmony website",
    "origin": "Public land",
    "date": "2026-07-02",
    "url": "https://harmony.avid.com.au/land-for-sale/",
    "image": "",
    "notes": "Harmony says blocks are difficult to find and do not last long; verify live availability with sales."
  },
  {
    "id": "lilywood-462",
    "title": "Lilywood Landings Stage 12 - Lot 462",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $545,000",
    "size": "420m2",
    "beds": "",
    "status": "Stage 12 now selling",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Frontage 14m, depth 30m. Estate land range in email: $525,000-$565,000."
  },
  {
    "id": "lilywood-465",
    "title": "Lilywood Landings Stage 12 - Lot 465",
    "kind": "Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $565,000",
    "size": "471m2",
    "beds": "",
    "status": "Stage 12 now selling",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Frontage 16.2m, depth 30m."
  },
  {
    "id": "aura-release",
    "title": "Aura Land Release Reminder",
    "kind": "Land",
    "area": "Sunshine Coast",
    "suburb": "Aura",
    "estate": "Stockland Aura",
    "price": "Not shown in email",
    "size": "Not shown",
    "beds": "",
    "status": "Land release 27 June 2026 at 8:00am",
    "source": "Stockland email",
    "origin": "Email",
    "date": "2026-06-26",
    "url": "https://www.stockland.com.au/residential/qld/aura",
    "image": "",
    "notes": "Email subject: REMINDER: Land release at Aura tomorrow."
  },
  {
    "id": "affinity-1815-1820",
    "title": "Affinity Estate Stage 18 - Lots 1815-1820",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Morayfield",
    "estate": "Affinity Estate",
    "price": "See attached brochures",
    "size": "6 low-set terrace lots",
    "beds": "4 bed product noted",
    "status": "Expected registration July 2026",
    "source": "Thompson Sustainable Homes email",
    "origin": "Email",
    "date": "2026-06-29",
    "url": "#",
    "image": "",
    "notes": "Lots 1815 and 1820 are 10m traditional lots; attached PDFs include package brochures and site plan."
  },
  {
    "id": "lilywood-470",
    "title": "Lilywood Landings - Lot 470 Barn",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $892,891",
    "size": "400m2 land, 174.8sq",
    "beds": "4 bed, 2 bath, 2 car",
    "status": "Email-sourced package",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Builder shown in email link as Kiba Built."
  },
  {
    "id": "lilywood-471",
    "title": "Lilywood Landings - Lot 471 Contempo",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $894,075",
    "size": "400m2 land, 178sq",
    "beds": "4 bed, 2 bath",
    "status": "Email-sourced package",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Builder shown in email link as Ultra Living Homes. Email lists 0 car."
  },
  {
    "id": "morayfield-freestanding",
    "title": "Morayfield freestanding homes",
    "kind": "House & Land",
    "area": "Moreton Bay",
    "suburb": "Morayfield",
    "estate": "Not specified",
    "price": "From $876,000",
    "size": "Not stated",
    "beds": "4 bed, 2 bath, 2 car",
    "status": "Rego March 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Freehold title and freestanding houses. Email says reply to learn more."
  },
  {
    "id": "redbank-plains",
    "title": "Redbank Plains packages",
    "kind": "House & Land",
    "area": "Brisbane",
    "suburb": "Redbank Plains",
    "estate": "Not specified",
    "price": "$932,000-$1,020,000",
    "size": "375-450m2 land",
    "beds": "4 bed designs, 183-206sqm",
    "status": "Only 2 packages available; titles Sep 2026",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Fixed price packages with full turnkey inclusions."
  },
  {
    "id": "rochedale-saint-eves",
    "title": "Rochedale Saint Eves final custom package",
    "kind": "House & Land",
    "area": "Brisbane",
    "suburb": "Rochedale",
    "estate": "Saint Eves",
    "price": "$1,900,000",
    "size": "375m2 land, 270sqm home",
    "beds": "Not stated",
    "status": "Final package; titles early 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Rare turnkey offering with upgrade package included."
  },
  {
    "id": "lilywood-216",
    "title": "Lilywood Landings - Lot 216 Parkside Terrace",
    "kind": "Townhouse",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $793,000",
    "size": "280m2 land, 170.38sq",
    "beds": "3 bed, 2 bath, 2 car",
    "status": "Stage 10B terraces over 60% sold",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Townhouse email record."
  },
  {
    "id": "lilywood-236",
    "title": "Lilywood Landings - Lot 236 Parklands Solis",
    "kind": "Townhouse",
    "area": "Moreton Bay",
    "suburb": "Lilywood / Waraba",
    "estate": "Lilywood Landings",
    "price": "From $802,000",
    "size": "274m2 land, 178.84sq",
    "beds": "4 bed, 2 bath, 2 car",
    "status": "Stage 10B terraces over 60% sold",
    "source": "OpenLot email",
    "origin": "Email",
    "date": "2026-06-27",
    "url": "https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp",
    "image": "",
    "notes": "Townhouse email record."
  },
  {
    "id": "joyner-townhomes",
    "title": "Joyner townhomes",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Joyner",
    "estate": "Not specified",
    "price": "From $962,000",
    "size": "Boutique 74-townhome development",
    "beds": "4 bedroom townhomes",
    "status": "Only 1 remaining; completion Q4 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Email notes site works commenced and gross yields over 4.0%."
  },
  {
    "id": "taigum-townhouse",
    "title": "Taigum townhouse",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Taigum",
    "estate": "Not specified",
    "price": "$1,100,000",
    "size": "Boutique complex of 56",
    "beds": "4 bedroom",
    "status": "Only 1 remaining",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Ausbuild project, pool and recreational facilities."
  },
  {
    "id": "pallara-terraces",
    "title": "Pallara terraces",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Pallara",
    "estate": "Not specified",
    "price": "From $1,029,000",
    "size": "Not stated",
    "beds": "4 bedroom terraces",
    "status": "Only 1 remaining; completion mid 2027",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Boutique complex around 18km south of Brisbane CBD."
  },
  {
    "id": "albany-creek-senses",
    "title": "Albany Creek Senses townhouses",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Albany Creek",
    "estate": "Senses",
    "price": "From $1,265,000",
    "size": "34-townhouse boutique block",
    "beds": "4 bedroom",
    "status": "Only 5 remaining; settle Q4 2026",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Construction underway, communal pool/BBQ and grassed area."
  },
  {
    "id": "bundall-terrace",
    "title": "Bundall boutique terrace",
    "kind": "Townhouse",
    "area": "Gold Coast",
    "suburb": "Bundall",
    "estate": "Not specified",
    "price": "$1,540,000",
    "size": "22 terrace homes",
    "beds": "Final 3 bedroom terrace",
    "status": "Complete; only 1 left",
    "source": "McGrath Knight Frank email",
    "origin": "Email",
    "date": "2026-07-01",
    "url": "#",
    "image": "",
    "notes": "Viewings available Wednesdays and Saturdays on request."
  },
  {
    "id": "loganholme-townhomes",
    "title": "Loganholme completed townhomes",
    "kind": "Townhouse",
    "area": "Brisbane",
    "suburb": "Loganholme",
    "estate": "Not specified",
    "price": "Price not captured in snippet",
    "size": "17-townhouse boutique development",
    "beds": "Townhomes",
    "status": "Only 4 remaining; completed",
    "source": "ARG Property email",
    "origin": "Email",
    "date": "2026-06-17",
    "url": "#",
    "image": "",
    "notes": "Email identified as completed townhouse opportunity; full body can be read for pricing if needed."
  }
];

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEQ Property Watch</title><style>:root{--ink:#151f1b;--muted:#64736c;--line:#dbe2dc;--teal:#0f766e}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f2f5ef;color:var(--ink)}header{padding:30px clamp(16px,4vw,56px);background:linear-gradient(135deg,#103f3b,#315632 58%,#8b6625);color:#fff}.top{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end}h1{font-size:clamp(34px,5vw,60px);margin:4px 0 10px;line-height:.96}.eyebrow{text-transform:uppercase;letter-spacing:.09em;font-weight:900;color:#d8eadf;font-size:12px}.copy{max-width:860px;color:#ecf6ef;line-height:1.45}.sharebar{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}button,.btn{border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:900;padding:10px 12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.ghost{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28)}.toolbar{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:10px;padding:14px clamp(16px,4vw,56px);background:rgba(249,250,246,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}label{display:grid;gap:5px;font-size:12px;font-weight:900;color:#34433d}select,input{width:100%;border:1px solid #cbd6d0;border-radius:8px;background:#fff;padding:10px;font:inherit}main{padding:22px clamp(16px,4vw,56px) 50px;display:grid;gap:22px}.stats{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:12px}.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 12px 32px rgba(20,31,27,.08)}.stat strong{display:block;font-size:31px}.stat span{color:var(--muted);font-size:13px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0;font-size:23px}.section-title p{margin:0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(315px,1fr));gap:16px}article{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 14px 38px rgba(20,31,27,.09)}.visual{height:165px;position:relative;background:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),linear-gradient(120deg,#83b77c,#d8bb71 48%,#4f83a7);background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:12px}article[data-kind='Townhouse'] .visual{background-image:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),linear-gradient(120deg,#769fb8,#bccaa1 50%,#315d82)}article[data-kind='House & Land'] .visual{background-image:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),linear-gradient(120deg,#709b70,#d0ad68 45%,#84668b)}.chips{position:relative;display:flex;gap:6px;flex-wrap:wrap}.chip{background:rgba(255,255,255,.93);border-radius:999px;padding:5px 8px;font-size:12px;font-weight:900}.content{padding:15px;display:grid;gap:10px}h3{margin:0;font-size:19px;line-height:1.2}.price{font-size:22px;font-weight:950;color:var(--teal)}.facts{display:flex;flex-wrap:wrap;gap:6px}.facts span{border:1px solid var(--line);border-radius:7px;background:#fbfcfa;padding:6px 8px;color:#5d6b65;font-size:13px}.status{font-weight:900;color:#31443d}.notes{color:#3f4d47;line-height:1.45;font-size:14px}.card-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid #edf1ed}.card-actions button,.card-actions a{font-size:13px;padding:9px 10px}.card-actions a{background:#edf4f2;color:#0f5f59;border-radius:9px;text-decoration:none;font-weight:900}.source{color:var(--muted);font-size:12px}.empty{display:none;padding:30px;background:white;border:1px dashed #bcc8c2;border-radius:12px;text-align:center;color:var(--muted)}@media(max-width:960px){.top,.toolbar,.stats{grid-template-columns:1fr}.toolbar{position:static}.grid{grid-template-columns:1fr}header{padding-top:22px}}</style></head><body><header><div class="top"><div><div class="eyebrow">South East Queensland property radar</div><h1>SEQ Property Watch</h1><div class="copy">Email-sourced packages and townhouses, plus vacant land availability in the target area. Public online packages are excluded unless they arrived in your inbox or you personally supplied them.</div><div class="sharebar"><button class="ghost" onclick="shareApp()">Share entire app</button><button class="ghost" onclick="copyText(location.href)">Copy app link</button></div></div></div></header><section class="toolbar"><label>Type<select id="kind"><option value="">All types</option><option>Land</option><option>House & Land</option><option>Townhouse</option></select></label><label>Area<select id="area"><option value="">All areas</option><option>Moreton Bay</option><option>Brisbane</option><option>Gold Coast</option><option>Sunshine Coast</option></select></label><label>Source<select id="origin"><option value="">All sources</option><option>Email</option><option>Public land</option></select></label><label>Sort<select id="sort"><option value="newest">Newest first</option><option value="price">Lowest visible price</option><option value="area">Area</option></select></label><label>Search<input id="q" placeholder="Suburb, estate, lot, price"></label></section><main><section class="stats"><div class="stat"><strong id="total">0</strong><span>tracked records</span></div><div class="stat"><strong id="land">0</strong><span>land records</span></div><div class="stat"><strong id="packages">0</strong><span>home & land packages</span></div><div class="stat"><strong id="townhouses">0</strong><span>townhouse records</span></div></section><div class="section-title"><div><h2>Available Stock</h2><p id="summary">Showing everything in scope.</p></div></div><section class="grid" id="cards"></section><div class="empty" id="empty">No records match those filters.</div></main><script>const records=__RECORDS__;const cards=document.getElementById('cards'),empty=document.getElementById('empty'),controls=['kind','area','origin','sort','q'].map(id=>document.getElementById(id));function n(v){return String(v||'').toLowerCase()}function dollars(r){let m=String(r.price||'').match(/[\d,]+/);return m?Number(m[0].replace(/,/g,'')):999999999}function urlFor(r){return location.origin+location.pathname+'#'+r.id}async function copyText(t){try{await navigator.clipboard.writeText(t);alert('Link copied')}catch(e){prompt('Copy this link',t)}}function shareApp(){let data={title:'SEQ Property Watch',text:'SEQ property list',url:location.href};navigator.share?navigator.share(data):copyText(location.href)}function shareRecord(id){let r=records.find(x=>x.id===id);let u=urlFor(r);let data={title:r.title,text:r.title+' - '+r.price+' - '+r.suburb,url:u};navigator.share?navigator.share(data):copyText(u)}function visible(){const[kind,area,origin,sort,q]=controls;let rows=records.filter(r=>(!kind.value||r.kind===kind.value)&&(!area.value||r.area===area.value)&&(!origin.value||r.origin===origin.value)&&(!q.value||n(Object.values(r).join(' ')).includes(n(q.value))));if(sort.value==='price')rows.sort((a,b)=>dollars(a)-dollars(b));else if(sort.value==='area')rows.sort((a,b)=>(a.area+a.suburb).localeCompare(b.area+b.suburb));else rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));return rows}function card(r){let img=r.image?'style="background-image:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),url('+r.image+')"':'';return '<article id="'+r.id+'" data-kind="'+r.kind+'"><div class="visual" '+img+'><div class="chips"><span class="chip">'+r.kind+'</span><span class="chip">'+r.area+'</span><span class="chip">'+r.origin+'</span></div></div><div class="content"><h3>'+r.title+'</h3><div class="price">'+r.price+'</div><div class="facts"><span>'+r.suburb+'</span><span>'+r.estate+'</span><span>'+r.size+'</span>'+(r.beds?'<span>'+r.beds+'</span>':'')+'</div><p class="status">'+r.status+'</p><p class="notes">'+r.notes+'</p><div class="source">'+r.source+' · '+r.date+'</div><div class="card-actions"><button data-share="'+r.id+'">Share this</button><button data-copy="'+r.id+'">Copy link</button>'+(r.url&&r.url!=='#'?'<a href="'+r.url+'" target="_blank" rel="noopener">Open source</a>':'')+'</div></div></article>'}function render(){let rows=visible();cards.innerHTML=rows.map(card).join('');empty.style.display=rows.length?'none':'block';document.getElementById('total').textContent=records.length;document.getElementById('land').textContent=records.filter(r=>r.kind==='Land').length;document.getElementById('packages').textContent=records.filter(r=>r.kind==='House & Land').length;document.getElementById('townhouses').textContent=records.filter(r=>r.kind==='Townhouse').length;document.getElementById('summary').textContent='Showing '+rows.length+' of '+records.length+' records.';if(location.hash){let el=document.querySelector(location.hash);if(el)el.scrollIntoView({block:'center'})}}controls.forEach(c=>c.addEventListener('input',render));document.addEventListener('click',e=>{let s=e.target.closest('[data-share]');if(s)return shareRecord(s.dataset.share);let c=e.target.closest('[data-copy]');if(c){let r=records.find(x=>x.id===c.dataset.copy);if(r)copyText(urlFor(r))}});render();</script></body></html>`.replace('__RECORDS__', JSON.stringify(records));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'seq-property-watch', records: records.length, timestamp: new Date().toISOString() });
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page());
  }
  return json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SEQ Property Watch listening on port ${PORT}`);
});
