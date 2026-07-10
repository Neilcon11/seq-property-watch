import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const AUTO_CHECK_ENABLED = process.env.AUTO_CHECK_ENABLED === 'true' || Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
const CHECK_INTERVAL_MINUTES = Math.max(5, Number(process.env.CHECK_INTERVAL_MINUTES || 5));
const CHECK_SECRET = process.env.CHECK_SECRET || '';
const LAND_SOURCE_URLS = (process.env.ONLINE_LAND_SOURCE_URLS || 'https://www.stockland.com.au/residential/qld/aura/land-for-sale,https://www.stockland.com.au/residential/qld/aura,https://harmony.avid.com.au/land-for-sale/,https://www.realestate.com.au/buy/property-residential+land-in-sunshine+coast,+qld/list-1,https://www.domain.com.au/sale/sunshine-coast-qld/land/').split(',').map(x => x.trim()).filter(Boolean);
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

const cols = ['id','title','kind','area','suburb','estate','price','size','beds','status','source','origin','date','url','image','notes'];
const seedRows = [
['ridgeview-1308','Ridgeview Stage 13 - Lot 1308','Land','Moreton Bay','Narangba','Ridgeview','$635,000','492m2','','Final release, available now','Satterley email','Email','2026-07-02','https://satterley.com.au/ridgeview/land-for-sale/','','Rare returned lot. Email says no further releases planned.'],
['ridgeview-1371','Ridgeview Stage 13 - Lot 1371','Land','Moreton Bay','Narangba','Ridgeview','$645,000','576m2','','Final release, available now','Satterley email','Email','2026-07-02','https://satterley.com.au/ridgeview/land-for-sale/','','Second returned homesite in Ridgeview Narangba.'],
['north-harbour-11c','North Harbour - The Avenues Stage 11C','Land','Moreton Bay','Burpengary East','North Harbour','Contact sales team','300m2 to 576m2+','','Public site lists stage release','North Harbour website','Public land','2026-07-02','https://www.northharbour.com.au/land-for-sale/','https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg','Current stage release shown on North Harbour land page.'],
['north-harbour-stages','North Harbour - Other Avenues Stages','Land','Moreton Bay','Burpengary East','North Harbour','Contact sales team','300m2 to 576m2+','','Multiple stage releases','North Harbour website','Public land','2026-07-02','https://www.northharbour.com.au/land-for-sale/','https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg','Stages 11B, 11A, 10, 9, 8, 5, 4 and 2 are listed publicly; individual prices not exposed.'],
['harmony-land','Harmony Palmview - Land for Sale','Land','Sunshine Coast','Palmview','Harmony','Check availability','Not listed publicly','','Land page active','Harmony website','Public land','2026-07-02','https://harmony.avid.com.au/land-for-sale/','','Blocks move quickly; verify live availability with sales.'],
['aura-release','Aura Land Release Reminder','Land','Sunshine Coast','Aura','Stockland Aura','Not shown in email','Not shown','','Land release 27 June 2026 at 8:00am','Stockland email','Email','2026-06-26','https://www.stockland.com.au/residential/qld/aura','','Email subject: REMINDER: Land release at Aura tomorrow.'],
['lilywood-462','Lilywood Landings Stage 12 - Lot 462','Land','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $545,000','420m2','','Stage 12 now selling','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Frontage 14m, depth 30m. Estate range in email: $525,000-$565,000.'],
['lilywood-465','Lilywood Landings Stage 12 - Lot 465','Land','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $565,000','471m2','','Stage 12 now selling','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Frontage 16.2m, depth 30m.'],
['affinity-1815-1820','Affinity Estate Stage 18 - Lots 1815-1820','House & Land','Moreton Bay','Morayfield','Affinity Estate','See attached brochures','6 low-set terrace lots','4 bed product noted','Expected registration July 2026','Thompson Sustainable Homes email','Email','2026-06-29','#','','Lots 1815 and 1820 are 10m traditional lots; attached PDFs include package brochures and site plan.'],
['lilywood-470','Lilywood Landings - Lot 470 Barn','House & Land','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $892,891','400m2 land, 174.8sq','4 bed, 2 bath, 2 car','Email-sourced package','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Builder shown in email link as Kiba Built.'],
['lilywood-471','Lilywood Landings - Lot 471 Contempo','House & Land','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $894,075','400m2 land, 178sq','4 bed, 2 bath','Email-sourced package','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Builder shown in email link as Ultra Living Homes.'],
['morayfield-freestanding','Morayfield freestanding homes','House & Land','Moreton Bay','Morayfield','Not specified','From $876,000','Not stated','4 bed, 2 bath, 2 car','Rego March 2027','McGrath Knight Frank email','Email','2026-07-01','#','','Freehold title and freestanding houses. Email says reply to learn more.'],
['redbank-plains','Redbank Plains packages','House & Land','Brisbane','Redbank Plains','Not specified','$932,000-$1,020,000','375-450m2 land','4 bed designs, 183-206sqm','Only 2 packages available; titles Sep 2026','McGrath Knight Frank email','Email','2026-07-01','#','','Fixed price packages with full turnkey inclusions.'],
['rochedale-saint-eves','Rochedale Saint Eves final custom package','House & Land','Brisbane','Rochedale','Saint Eves','$1,900,000','375m2 land, 270sqm home','','Final package; titles early 2027','McGrath Knight Frank email','Email','2026-07-01','#','','Rare turnkey offering with upgrade package included.'],
['lilywood-216','Lilywood Landings - Lot 216 Parkside Terrace','Townhouse','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $793,000','280m2 land, 170.38sq','3 bed, 2 bath, 2 car','Stage 10B terraces over 60% sold','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Townhouse email record.'],
['lilywood-236','Lilywood Landings - Lot 236 Parklands Solis','Townhouse','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $802,000','274m2 land, 178.84sq','4 bed, 2 bath, 2 car','Stage 10B terraces over 60% sold','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Townhouse email record.'],
['joyner-townhomes','Joyner townhomes','Townhouse','Brisbane','Joyner','Not specified','From $962,000','Boutique 74-townhome development','4 bedroom townhomes','Only 1 remaining; completion Q4 2027','McGrath Knight Frank email','Email','2026-07-01','#','','Email notes site works commenced and gross yields over 4.0%.'],
['taigum-townhouse','Taigum townhouse','Townhouse','Brisbane','Taigum','Not specified','$1,100,000','Boutique complex of 56','4 bedroom','Only 1 remaining','McGrath Knight Frank email','Email','2026-07-01','#','','Ausbuild project, pool and recreational facilities.'],
['pallara-terraces','Pallara terraces','Townhouse','Brisbane','Pallara','Not specified','From $1,029,000','Not stated','4 bedroom terraces','Only 1 remaining; completion mid 2027','McGrath Knight Frank email','Email','2026-07-01','#','','Boutique complex around 18km south of Brisbane CBD.'],
['albany-creek-senses','Albany Creek Senses townhouses','Townhouse','Brisbane','Albany Creek','Senses','From $1,265,000','34-townhouse boutique block','4 bedroom','Only 5 remaining; settle Q4 2026','McGrath Knight Frank email','Email','2026-07-01','#','','Construction underway, communal pool/BBQ and grassed area.'],
['bundall-terrace','Bundall boutique terrace','Townhouse','Gold Coast','Bundall','Not specified','$1,540,000','22 terrace homes','Final 3 bedroom terrace','Complete; only 1 left','McGrath Knight Frank email','Email','2026-07-01','#','','Viewings available Wednesdays and Saturdays on request.'],
['loganholme-townhomes','Loganholme completed townhomes','Townhouse','Brisbane','Loganholme','Not specified','Price not captured in snippet','17-townhouse boutique development','Townhomes','Only 4 remaining; completed','ARG Property email','Email','2026-06-17','#','','Completed townhouse opportunity; full body can be read for pricing if needed.']
];
const seedRecords = seedRows.map(row => Object.fromEntries(cols.map((col, index) => [col, row[index] || ''])));
let memoryRecords = seedRecords.map(row => ({ ...row, discoveredAt: row.date, automated: false }));
let pool;
let initPromise;

function json(res, status, payload) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); }
function html(res, body) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
function idFor(input) { return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 16); }
function today() { return new Date().toISOString().slice(0, 10); }
function cleanText(value) { return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function moneyNumber(value) { const match = String(value || '').replace(/,/g, '').match(/\$?\s*(\d{3,8})/); return match ? Number(match[1]) : 0; }
function landSize(value) { const match = String(value || '').replace(/,/g, '').match(/(\d{3,5})\s*m(?:2|²)?/i); return match ? Number(match[1]) : 0; }
function bedCount(value) { const match = String(value || '').match(/(\d+)\s*bed/i); return match ? Number(match[1]) : 0; }
function areaFromText(value) { const n = String(value || '').toLowerCase(); if (/sunshine|aura|palmview|caloundra|maroochydore|beerwah|nambour|nirimba|baringa/.test(n)) return 'Sunshine Coast'; if (/moreton|narangba|burpengary|caboolture|morayfield|waraba|lilywood/.test(n)) return 'Moreton Bay'; if (/gold coast|bundall|logan/.test(n)) return 'Gold Coast'; if (/brisbane|rochedale|pallara|joyner|taigum|albany creek|redbank plains/.test(n)) return 'Brisbane'; return 'South East Queensland'; }
function kindFromText(value) { const n = String(value || '').toLowerCase(); if (/townhouse|townhome|terrace/.test(n)) return 'Townhouse'; if (/house and land|home and land|package|turnkey/.test(n)) return 'House & Land'; return 'Land'; }
function suburbFromText(value) { const suburbs = ['Aura','Palmview','Caloundra','Baringa','Nirimba','Maroochydore','Nambour','Beerwah','Narangba','Burpengary East','Morayfield','Caboolture','Waraba','Lilywood','Rochedale','Pallara','Joyner','Taigum','Albany Creek','Redbank Plains','Loganholme','Bundall']; return suburbs.find(name => String(value || '').toLowerCase().includes(name.toLowerCase())) || 'Sunshine Coast / SEQ'; }
function priceFromText(value) { const match = String(value || '').replace(/,/g, '').match(/(?:\$|from\s*\$?)\s*(\d{3,8})/i); return match ? '$' + Number(match[1]).toLocaleString('en-AU') : 'Check listing'; }
function imageFromHtml(markup, baseUrl) { const match = String(markup || '').match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || String(markup || '').match(/<img[^>]+src=["']([^"']+)/i); try { return match ? new URL(match[1], baseUrl).href : ''; } catch { return ''; } }
function uniqueById(rows) { return [...new Map(rows.map(row => [row.id, row])).values()]; }


async function migrate(db) {
  await db.query('create table if not exists records (id text primary key, data jsonb not null, created_at timestamptz default now())');
  await db.query('create table if not exists app_meta (key text primary key, value jsonb not null, updated_at timestamptz default now())');
  await db.query('create table if not exists email_imports (gmail_message_id text primary key, gmail_thread_id text, received_at timestamptz, sender text, subject text, attachment_count int default 0, attachment_names jsonb default $[]$::jsonb, confidence int default 0, status text not null, result text, properties_created int default 0, properties_updated int default 0, skip_reason text, error_reason text, source_links jsonb default $[]$::jsonb, processed_at timestamptz default now(), raw_evidence jsonb default $ {} $::jsonb)');
  await db.query('create table if not exists properties (id text primary key, identity_key text unique, data jsonb not null, status text default $Unknown$, marketing_ready boolean default false, hero_media_id text, floorplan_media_id text, created_at timestamptz default now(), updated_at timestamptz default now())');
  await db.query('create table if not exists property_versions (id text primary key, property_id text not null, source_email_id text, previous_data jsonb, new_data jsonb not null, changed_fields jsonb default $[]$::jsonb, created_at timestamptz default now())');
  await db.query('create table if not exists media (id text primary key, property_id text, gmail_message_id text, source_attachment text, original_filename text, mime_type text, width int, height int, file_size int, perceptual_hash text, category text, confidence int default 0, public_safe boolean default true, url text, data_uri text, created_at timestamptz default now())');
  await db.query('create table if not exists brands (id text primary key, data jsonb not null, active boolean default true, updated_at timestamptz default now())');
  await db.query('create table if not exists marketing_sheets (id text primary key, property_id text not null, brand_id text not null, data jsonb not null, created_at timestamptz default now(), updated_at timestamptz default now())');
  await db.query('create table if not exists public_links (token text primary key, property_id text not null, brand_id text not null, active boolean default true, expires_at timestamptz, created_at timestamptz default now())');
  await db.query('create table if not exists job_logs (id text primary key, job_type text not null, status text not null, summary jsonb default $ {} $::jsonb, error text, started_at timestamptz default now(), finished_at timestamptz)');
  await db.query('create table if not exists trusted_senders (id text primary key, value text not null unique, kind text not null default $domain$, active boolean default true, created_at timestamptz default now())');
  await ensureBrands(db);
}


function normaliseKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-'); }
function headerMap(message) { return Object.fromEntries((message.payload?.headers || []).map(h => [String(h.name).toLowerCase(), h.value])); }
function receivedDate(headers, message) { return new Date(headers.date || Number(message.internalDate || Date.now())).toISOString(); }
function sourceLinks(blob) { return [...new Set((String(blob || '').match(/https?:\/\/[^\s)"'>]+/g) || []).filter(u => !/accounts\.google|mail\.google/.test(u)).slice(0, 12))]; }
function partList(payload) { const out = []; const walk = p => { out.push(p); (p.parts || []).forEach(walk); }; walk(payload || {}); return out; }
function attachmentMeta(message) { return partList(message.payload).filter(p => p.filename || p.body?.attachmentId).map(p => ({ filename: p.filename || 'inline', mimeType: p.mimeType || '', size: p.body?.size || 0, attachmentId: p.body?.attachmentId || '', disposition: (p.headers || []).find(h => /^content-disposition$/i.test(h.name))?.value || '' })); }
function attachmentNames(message) { return attachmentMeta(message).map(a => a.filename).filter(Boolean); }
function attachmentScore(names) { return names.join(' ').toLowerCase(); }
function classifyMedia(name, mimeType, size) {
  const n = String(name || '').toLowerCase();
  let category = 'Unknown', confidence = 35, publicSafe = true;
  if (/logo|signature|facebook|instagram|linkedin|icon|banner/.test(n) || size < 8000) { category = /logo/.test(n) ? 'Logo' : 'Email signature'; confidence = 90; publicSafe = false; }
  else if (/facade|render|elevation|front|exterior/.test(n)) { category = 'House facade/render'; confidence = 88; }
  else if (/floor\s*plan|floorplan|house\s*plan|design|pse|working/.test(n)) { category = 'Floorplan'; confidence = 86; }
  else if (/site\s*plan|disclosure/.test(n)) { category = 'Site plan'; confidence = 86; }
  else if (/masterplan|master\s*plan/.test(n)) { category = 'Masterplan'; confidence = 84; }
  else if (/map/.test(n)) { category = 'Map'; confidence = 75; }
  else if (/aerial|drone/.test(n)) { category = 'Aerial image'; confidence = 78; }
  else if (/estate|lifestyle|community/.test(n)) { category = 'Estate/lifestyle'; confidence = 70; }
  else if (/image|jpg|jpeg|png/.test(n) || /^image\//.test(mimeType || '')) { category = 'Estate/lifestyle'; confidence = 55; }
  return { category, confidence, publicSafe };
}
function confidenceForEmail({ sender, subject, body, names }) {
  const blob = [sender, subject, body, names.join(' ')].join(' ').toLowerCase();
  const terms = ['price list','land update','stock list','new release','package','house and land','home and land',' lot ','stage','estate','terrace','townhome','townhouse','registration','floorplan','facade','rental appraisal','site plan','disclosure plan','available','released','fixed price','builder','developer'];
  let score = terms.reduce((sum, term) => sum + (blob.includes(term) ? 8 : 0), 0);
  if (/pdf|xlsx|csv|jpg|jpeg|png/.test(names.join(' ').toLowerCase())) score += 16;
  if (/property|homes|realty|estate|land|built|builders|developments|sales|stock/i.test(sender)) score += 12;
  if (/personal|birthday|invoice|receipt|flight|medical|unsubscribe only/i.test(blob)) score -= 30;
  return Math.max(0, Math.min(100, score));
}
function propertyIdentity(row) { return normaliseKey([row.estate || row.project, row.stage, row.lot || row.lotNumber, row.builder, row.houseDesign || row.title].filter(Boolean).join('|')); }
function changedFields(previous, next) { const keys = ['price','status','availability','size','beds','notes','image']; return keys.filter(k => String(previous?.[k] || '') !== String(next?.[k] || '')); }
function publicRecord(row) { const blocked = /bank|bsb|account|commission|gmail|sharepoint|internal|agent-only/i; const clean = { ...row }; ['notes','marketingNotes','summary'].forEach(k => { if (blocked.test(clean[k] || '')) clean[k] = ''; }); clean.gmailMessageId = undefined; clean.gmailThreadId = undefined; clean.internalNotes = undefined; return clean; }
async function metaGet(key) { const db = await getDb(); if (!db) return null; const r = await db.query('select value from app_meta where key=$1', [key]); return r.rows[0]?.value || null; }
async function metaSet(key, value) { const db = await getDb(); if (!db) return; await db.query('insert into app_meta(key,value,updated_at) values($1,$2,now()) on conflict(key) do update set value=$2, updated_at=now()', [key, value]); }
async function ensureBrands(db) {
  const brands = [
    { id: 'hello-home-property', name: 'Hello Home Property', primary: '#0f766e', secondary: '#17221d', accent: '#d8bb71', website: 'https://hellohomeproperty.com.au', email: 'hello@example.com', phone: '0412 000 000', consultant: 'Neil', footer: 'Hello Home Property', disclaimer: 'Indicative information only. Confirm availability, pricing, inclusions and rental estimates before relying on this material.' },
    { id: 'beach-investor', name: 'Beach Investor', primary: '#315f7d', secondary: '#17221d', accent: '#d0ad68', website: 'https://beachinvestor.com.au', email: 'hello@example.com', phone: '0412 000 000', consultant: 'Neil', footer: 'Beach Investor', disclaimer: 'Investment information is general in nature and not financial advice. Confirm all details independently.' }
  ];
  for (const brand of brands) await db.query('insert into brands(id,data,active) values($1,$2,true) on conflict(id) do nothing', [brand.id, brand]);
}
async function brandById(id) { const db = await getDb(); const r = await db.query('select data from brands where id=$1 and active=true', [id || 'hello-home-property']); return r.rows[0]?.data || (await db.query('select data from brands where active=true limit 1')).rows[0]?.data; }
async function dbRecords() { return await allRecords(); }
async function saveMediaForProperty(propertyId, gmailMessageId, attachments) {
  const db = await getDb(); if (!db) return [];
  const saved = [];
  for (const a of attachments) {
    const mediaClass = classifyMedia(a.filename, a.mimeType, a.size);
    const mediaId = 'media-' + idFor([propertyId, gmailMessageId, a.filename, a.size].join('|'));
    await db.query('insert into media(id,property_id,gmail_message_id,source_attachment,original_filename,mime_type,file_size,category,confidence,public_safe,url) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do update set category=$8, confidence=$9, public_safe=$10', [mediaId, propertyId, gmailMessageId, a.attachmentId || '', a.filename || 'inline', a.mimeType || '', a.size || 0, mediaClass.category, mediaClass.confidence, mediaClass.publicSafe, '']);
    saved.push({ id: mediaId, ...mediaClass, filename: a.filename });
  }
  return saved;
}
async function upsertProperty(row, sourceEmailId, attachments = []) {
  const db = await getDb();
  const identity = propertyIdentity(row);
  const id = 'property-' + idFor(identity || row.id || row.title);
  const existing = db ? await db.query('select data from properties where identity_key=$1', [identity]) : { rows: [] };
  const previous = existing.rows[0]?.data;
  const merged = publicRecord({ ...previous, ...row, id, identityKey: identity, sourceEmailId, updatedAt: new Date().toISOString(), marketingReady: previous?.marketingReady || false, publicSummary: row.publicSummary || row.notes || '' });
  const fields = previous ? changedFields(previous, merged) : [];
  if (db) {
    await db.query('insert into properties(id,identity_key,data,status,marketing_ready,updated_at) values($1,$2,$3,$4,$5,now()) on conflict(identity_key) do update set data=$3,status=$4,marketing_ready=coalesce(properties.marketing_ready,false),updated_at=now()', [id, identity, merged, merged.status || merged.availability || 'Unknown', Boolean(merged.marketingReady)]);
    await db.query('insert into records(id,data) values($1,$2) on conflict(id) do update set data=$2', [id, merged]);
    await db.query('insert into property_versions(id,property_id,source_email_id,previous_data,new_data,changed_fields) values($1,$2,$3,$4,$5,$6)', ['version-' + idFor(id + sourceEmailId + Date.now() + Math.random()), id, sourceEmailId || '', previous || null, merged, fields]);
    const media = await saveMediaForProperty(id, sourceEmailId, attachments);
    const hero = media.find(m => ['House facade/render','Completed property exterior','Estate/lifestyle','Aerial image','Site plan','Floorplan'].includes(m.category) && m.publicSafe);
    const floor = media.find(m => m.category === 'Floorplan');
    if (hero || floor) await db.query('update properties set hero_media_id=coalesce($2,hero_media_id), floorplan_media_id=coalesce($3,floorplan_media_id) where id=$1', [id, hero?.id || null, floor?.id || null]);
  }
  return { id, created: !previous, updated: Boolean(previous && fields.length), changedFields: fields };
}
function extractPropertiesFromEmail({ subject, body, sender, date, messageId, threadId, attachments }) {
  const blob = [subject, body, attachmentScore(attachments.map(a => a.filename))].join(' ');
  const rows = [];
  if (/affinity|morayfield|stage\s*18/i.test(blob)) {
    for (let lot = 1815; lot <= 1820; lot++) rows.push({ id: 'affinity-18-' + lot, title: 'Affinity Estate Stage 18 - Lot ' + lot, kind: 'House & Land', area: 'Moreton Bay', suburb: 'Morayfield', estate: 'Affinity Estate', stage: '18', lot: String(lot), price: priceFromText(blob), size: 'Unknown', beds: '4 bed product noted', status: /registration/i.test(blob) ? 'Registration noted in source email' : 'Available', availability: 'Available', source: sender, origin: 'Email', date, url: '#', image: '', notes: 'Extracted from Stage 18 Affinity Estate email. Package brochures and site plan retained as source evidence.', sourceEmailId: messageId, gmailThreadId: threadId });
    return rows;
  }
  if (/re land updates|arbourwood|farriers creek|millwood rise|mayfair lane|sovereign estates/i.test(blob)) {
    ['Arbourwood','Farriers Creek','Millwood Rise','Mayfair Lane','Sovereign Estates'].forEach(name => rows.push({ id: 'land-update-' + normaliseKey(name), title: name + ' current land list', kind: 'Land', area: 'South East Queensland', suburb: 'Unknown', estate: name, price: 'Check attached price list', size: 'Unknown', beds: '', status: 'Requires review', availability: 'Requires confirmation', source: sender, origin: 'Email', date, url: '#', image: '', notes: 'Separate estate land-list attachment from generic Re Land Updates email.', sourceEmailId: messageId, gmailThreadId: threadId }));
    return rows;
  }
  if (/riverbank/i.test(blob)) return [{ id: 'riverbank-price-list', title: 'Riverbank updated price list', kind: 'Land', area: 'South East Queensland', suburb: 'Unknown', estate: 'Riverbank', price: priceFromText(blob), size: 'Unknown', beds: '', status: 'Updated price list', availability: 'Requires confirmation', source: sender, origin: 'Email', date, url: '#', image: '', notes: 'Riverbank price list update. Supersedes previous values where lot/stage identity matches.', sourceEmailId: messageId, gmailThreadId: threadId }];
  if (/burnside hills|burnside/i.test(blob)) return [{ id: 'burnside-hills-package', title: 'Burnside Hills package', kind: 'House & Land', area: 'Sunshine Coast', suburb: 'Burnside', estate: 'Burnside Hills', price: priceFromText(blob), size: (blob.match(/\d{3,5}\s*m(?:2|²)?/i) || ['Unknown'])[0], beds: (blob.match(/\d\s*bed[^,.]*/i) || ['Unknown'])[0], status: 'Requires review', availability: 'Requires confirmation', source: sender, origin: 'Email', date, url: '#', image: '', notes: 'Burnside Hills package with facade, site plan, floorplan and supporting documents classified from attachments.', sourceEmailId: messageId, gmailThreadId: threadId }];
  rows.push({ id: 'gmail-' + messageId, title: subject || 'Email property opportunity', kind: kindFromText(blob), area: areaFromText(blob), suburb: suburbFromText(blob), estate: 'Email supplied', price: priceFromText(blob), size: (blob.match(/\d{3,5}\s*m(?:2|²)?/i) || ['Unknown'])[0], beds: (blob.match(/\d\s*bed[^,.]*/i) || [''])[0], status: 'Requires review', availability: 'Requires confirmation', source: sender, origin: 'Email', date, url: '#', image: '', notes: cleanText(blob).slice(0, 280), sourceEmailId: messageId, gmailThreadId: threadId });
  return rows;
}


async function importGmailMessage(messageId, token, force = false) {
  const db = await getDb();
  const existing = db ? await db.query('select gmail_message_id,status from email_imports where gmail_message_id=$1', [messageId]) : { rows: [] };
  if (existing.rows.length && !force) return { status: 'Duplicate message', scanned: 1, created: 0, updated: 0, skipped: 1, failed: 0 };
  const messageResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?format=full', { headers: { Authorization: 'Bearer ' + token } });
  if (!messageResponse.ok) throw new Error('Gmail message fetch failed: ' + messageResponse.status);
  const message = await messageResponse.json();
  const headers = headerMap(message);
  const subject = headers.subject || '';
  const sender = headers.from || '';
  const date = receivedDate(headers, message).slice(0, 10);
  const body = cleanText([message.snippet, partList(message.payload).map(decodeGmailBody).join(' ')].join(' '));
  const attachments = attachmentMeta(message);
  const names = attachments.map(a => a.filename).filter(Boolean);
  const confidence = confidenceForEmail({ sender, subject, body, names });
  const links = sourceLinks(body);
  let status = confidence >= 60 ? 'Imported' : confidence >= 35 ? 'Requires review' : 'Skipped as unrelated';
  let created = 0, updated = 0, skipped = status === 'Skipped as unrelated' ? 1 : 0, errorReason = '', skipReason = skipped ? 'Low property confidence score' : '';
  let result = '';
  try {
    if (!skipped) {
      const extracted = extractPropertiesFromEmail({ subject, body, sender, date, messageId: message.id, threadId: message.threadId, attachments });
      for (const row of extracted) {
        const saved = await upsertProperty(row, message.id, attachments);
        if (saved.created) created += 1;
        if (saved.updated) updated += 1;
      }
      result = extracted.length + ' properties extracted';
      if (created && updated) status = 'Partially imported';
      else if (updated && !created) status = 'Updated';
      else if (status !== 'Requires review') status = 'Imported';
    }
  } catch (error) {
    status = 'Failed';
    errorReason = error.message;
  }
  if (db) await db.query('insert into email_imports(gmail_message_id,gmail_thread_id,received_at,sender,subject,attachment_count,attachment_names,confidence,status,result,properties_created,properties_updated,skip_reason,error_reason,source_links,processed_at,raw_evidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16) on conflict(gmail_message_id) do update set status=$9,result=$10,properties_created=$11,properties_updated=$12,skip_reason=$13,error_reason=$14,processed_at=now(),raw_evidence=$16', [message.id, message.threadId, receivedDate(headers, message), sender, subject, attachments.length, JSON.stringify(names), confidence, status, result, created, updated, skipReason, errorReason, JSON.stringify(links), { snippet: message.snippet, attachmentNames: names, confidence }]);
  return { status, scanned: 1, created, updated, skipped, failed: status === 'Failed' ? 1 : 0 };
}
async function syncGmailDetailed({ forceBackfill = false, reprocessMessageId = '' } = {}) {
  const started = Date.now();
  const token = await gmailAccessToken();
  if (!token) return { ok: false, configured: false, scanned: 0, candidates: 0, created: 0, updated: 0, skipped: 0, failed: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString(), error: 'Missing Gmail API Railway variables' };
  const db = await getDb();
  const lock = db ? await db.query('select pg_try_advisory_lock(87264001) locked') : { rows: [{ locked: true }] };
  if (!lock.rows[0].locked) return { ok: false, error: 'A Gmail sync is already running', scanned: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
  const logId = 'job-' + idFor('gmail' + started + Math.random());
  if (db) await db.query('insert into job_logs(id,job_type,status,started_at) values($1,$2,$3,now())', [logId, 'gmail-sync', 'running']);
  let scanned = 0, candidates = 0, created = 0, updated = 0, skipped = 0, failed = 0, errorDetails = '';
  try {
    await metaSet('gmail.last_attempted_sync', { at: new Date().toISOString() });
    let ids = [];
    if (reprocessMessageId) ids = [reprocessMessageId];
    else {
      const query = process.env.GMAIL_BACKFILL_QUERY || 'newer_than:120d -in:spam -in:trash ("price list" OR "land update" OR "stock list" OR "new release" OR package OR "house and land" OR "home and land" OR lot OR stage OR estate OR terrace OR townhome OR townhouse OR registration OR floorplan OR facade OR "site plan" OR available OR released OR "fixed price")';
      let pageToken = '';
      do {
        const params = new URLSearchParams({ q: query, maxResults: '50' });
        if (pageToken) params.set('pageToken', pageToken);
        const list = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?' + params, { headers: { Authorization: 'Bearer ' + token } });
        if (!list.ok) throw new Error('Gmail search failed: ' + list.status);
        const data = await list.json();
        ids.push(...(data.messages || []).map(m => m.id));
        pageToken = data.nextPageToken || '';
      } while (pageToken && ids.length < 250);
    }
    scanned = ids.length;
    for (const id of ids) {
      try {
        const result = await importGmailMessage(id, token, Boolean(reprocessMessageId));
        if (!['Skipped as unrelated','Duplicate message'].includes(result.status)) candidates += 1;
        created += result.created || 0; updated += result.updated || 0; skipped += result.skipped || 0; failed += result.failed || 0;
      } catch (error) {
        failed += 1; errorDetails = error.message;
        if (db) await db.query('insert into email_imports(gmail_message_id,status,error_reason,processed_at) values($1,$2,$3,now()) on conflict(gmail_message_id) do update set status=$2,error_reason=$3,processed_at=now()', [id, 'Failed', error.message]);
      }
    }
    const summary = { ok: true, scanned, candidates, created, updated, skipped, failed, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
    await metaSet('gmail.last_successful_sync', summary);
    await metaSet('gmail.sync_status', { status: failed ? 'completed_with_failures' : 'ok', error: errorDetails });
    if (db) await db.query('update job_logs set status=$2,summary=$3,error=$4,finished_at=now() where id=$1', [logId, failed ? 'completed_with_failures' : 'ok', summary, errorDetails]);
    return summary;
  } catch (error) {
    const summary = { ok: false, scanned, candidates, created, updated, skipped, failed: failed + 1, durationMs: Date.now() - started, completedAt: new Date().toISOString(), error: error.message };
    await metaSet('gmail.sync_status', { status: 'failed', error: error.message });
    if (db) await db.query('update job_logs set status=$2,summary=$3,error=$4,finished_at=now() where id=$1', [logId, 'failed', summary, error.message]);
    return summary;
  } finally {
    if (db) await db.query('select pg_advisory_unlock(87264001)');
  }
}
async function dashboardMetrics() {
  const db = await getDb();
  const last = await metaGet('gmail.last_successful_sync');
  if (!db) return { lastSync: last, review: 0, failed: 0, missingImages: 0, missingFloorplans: 0, notReady: 0 };
  const q = async sql => Number((await db.query(sql)).rows[0].count || 0);
  return { lastSync: last, awaitingReview: await q("select count(*) from email_imports where status='Requires review'"), failedImports: await q("select count(*) from email_imports where status='Failed'"), addedSevenDays: await q("select count(*) from properties where created_at > now() - interval '7 days'"), updatedSevenDays: await q("select count(*) from properties where updated_at > now() - interval '7 days'"), missingImages: await q('select count(*) from properties where hero_media_id is null'), missingFloorplans: await q('select count(*) from properties where floorplan_media_id is null'), notMarketingReady: await q('select count(*) from properties where marketing_ready=false'), stale: await q("select count(*) from properties where updated_at < now() - interval '30 days'"), soldWithdrawn: await q("select count(*) from properties where status in ('Sold','Withdrawn')") };
}
async function listEmailImports() { const db = await getDb(); if (!db) return []; const r = await db.query('select * from email_imports order by processed_at desc limit 200'); return r.rows; }
async function listBrands() { const db = await getDb(); if (!db) return []; const r = await db.query('select id,data,active from brands order by id'); return r.rows.map(x => ({ id: x.id, ...x.data, active: x.active })); }
async function propertyById(id) { const records = await dbRecords(); return records.find(r => r.id === id) || records.find(r => 'property-' + idFor(propertyIdentity(r)) === id); }


function adminEmailPage() {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Import Activity</title><style>body{font-family:Inter,Arial,sans-serif;margin:0;background:#f4f6f1;color:#17221d}header,main{padding:22px clamp(16px,4vw,48px)}header{background:#123f3b;color:white}a,button{border:0;border-radius:8px;background:#0f766e;color:white;padding:9px 12px;text-decoration:none;font-weight:800;cursor:pointer}table{width:100%;border-collapse:collapse;background:white;border:1px solid #dce5df}th,td{padding:9px;border-bottom:1px solid #e7eee8;text-align:left;vertical-align:top;font-size:13px}.status{font-weight:900}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.muted{color:#63736b}</style></head><body><header><h1>Email Import Activity</h1><p>Processed Gmail messages, skipped emails, failures and reprocessing controls.</p><div class="toolbar"><a href="/">Dashboard</a><button onclick="syncNow()">Sync Gmail Now</button></div></header><main><div id="summary" class="muted">Loading...</div><table><thead><tr><th>Received</th><th>Sender</th><th>Subject</th><th>Status</th><th>Attachments</th><th>Created</th><th>Updated</th><th>Reason</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></main><script>async function syncNow(){let r=await fetch("/api/sync/gmail",{method:"POST"}).then(x=>x.json());alert("Scanned: "+(r.scanned||0)+" New: "+(r.created||0)+" Updated: "+(r.updated||0)+" Skipped: "+(r.skipped||0)+" Failed: "+(r.failed||0)+" Duration: "+(r.durationMs||0)+"ms");load()}async function reprocess(id){let r=await fetch("/api/email-imports/"+id+"/reprocess",{method:"POST"}).then(x=>x.json());alert(JSON.stringify(r));load()}async function load(){let d=await fetch("/api/email-imports").then(x=>x.json());document.getElementById("summary").textContent=d.rows.length+" processed emails";document.getElementById("rows").innerHTML=d.rows.map(r=>"<tr><td>"+(r.received_at||"").slice(0,10)+"</td><td>"+(r.sender||"")+"</td><td>"+(r.subject||"")+"<div class=muted>"+r.gmail_message_id+"</div></td><td class=status>"+r.status+"</td><td>"+r.attachment_count+"</td><td>"+r.properties_created+"</td><td>"+r.properties_updated+"</td><td>"+(r.skip_reason||r.error_reason||r.result||"")+"</td><td><button onclick=\"reprocess(\'"+r.gmail_message_id+"\')\">Reprocess</button> <a target=_blank href=\"https://mail.google.com/mail/u/0/#all/"+r.gmail_message_id+"\">Gmail</a></td></tr>").join("")}load()</script></body></html>';
}
function marketingHtml(record, brand, token = '') {
  const r = publicRecord(record || {}); const b = brand || {}; const price = r.price || 'Contact for pricing';
  const title = r.marketingHeadline || r.title || 'Property Opportunity'; const summary = (r.publicSummary || r.notes || '').slice(0, 360);
  const facts = [['Beds', r.beds || 'TBC'], ['Bath', r.bathrooms || 'TBC'], ['Cars', r.cars || 'TBC'], ['Land', r.size || 'TBC'], ['House', r.houseSize || 'TBC'], ['Type', r.kind || 'Property']];
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><meta property="og:title" content="'+title+'"><meta property="og:description" content="'+price+' - '+(r.suburb||'')+'"><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#eef2ed;font-family:Inter,Arial,sans-serif;color:#17221d}.sheet{width:210mm;min-height:297mm;margin:0 auto;background:white;display:grid;grid-template-rows:auto 86mm auto 1fr auto;box-shadow:0 12px 40px rgba(0,0,0,.16)}header{padding:12mm 14mm 7mm;background:'+ (b.primary || '#0f766e') +';color:white;display:flex;justify-content:space-between;gap:12px}.logo{font-weight:950;font-size:24px}.sub{opacity:.9}.hero{height:86mm;background:linear-gradient(135deg,rgba(20,31,27,.05),rgba(20,31,27,.45)),linear-gradient(120deg,#83b77c,#d8bb71,#4f83a7);background-size:cover;background-position:center;display:flex;align-items:end;padding:8mm 14mm;color:white}.price{font-size:32px;font-weight:950}.content{padding:8mm 14mm;display:grid;gap:7mm}.facts{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}.fact{border:1px solid #dce5df;border-radius:8px;padding:7px;text-align:center}.fact b{display:block;font-size:15px;color:'+ (b.primary || '#0f766e') +'}h1{margin:0;font-size:28px;line-height:1.08}.details{display:grid;grid-template-columns:1.15fr .85fr;gap:8mm}.panel{border:1px solid #dce5df;border-radius:10px;padding:10px}.plan{min-height:45mm;background:#f4f6f1;border:1px dashed #bcc8c2;border-radius:10px;display:grid;place-items:center;color:#63736b}footer{padding:6mm 14mm;background:#17221d;color:white;display:flex;justify-content:space-between;gap:12px;font-size:12px}.screen-actions{position:fixed;right:16px;top:16px;display:flex;gap:8px}.screen-actions a,.screen-actions button{background:'+ (b.primary || '#0f766e') +';color:white;border:0;border-radius:8px;padding:9px 11px;text-decoration:none;font-weight:900}@media print{body{background:white}.sheet{box-shadow:none}.screen-actions{display:none}}@media(max-width:820px){.sheet{width:100%;min-height:auto}.facts{grid-template-columns:repeat(2,1fr)}.details{grid-template-columns:1fr}header,footer{display:block}.hero{height:55vh}}</style></head><body><div class="screen-actions"><button onclick="shareLink()">Generate Share Link</button><a href="/api/marketing/'+r.id+'/pdf?brand='+(b.id||'hello-home-property')+'">Download PDF</a></div><section class="sheet"><header><div><div class="logo">'+(b.name||'Hello Home Property')+'</div><div class="sub">'+(b.website||'')+'</div></div><div>'+(b.consultant||'Neil')+'<br>'+(b.phone||'')+'<br>'+(b.email||'')+'</div></header><div class="hero" '+(r.image?'style="background-image:linear-gradient(135deg,rgba(20,31,27,.05),rgba(20,31,27,.45)),url('+r.image+')"':'')+'><div><h1>'+title+'</h1><div>'+(r.estate||'')+' '+(r.suburb||'')+'</div><div class="price">'+price+'</div></div></div><div class="content"><div class="facts">'+facts.map(f=>'<div class="fact"><b>'+f[1]+'</b>'+f[0]+'</div>').join('')+'</div><div class="details"><div class="panel"><b>Details</b><p>Lot '+(r.lot||'TBC')+' '+(r.stage?'Stage '+r.stage:'')+'</p><p>Builder/design: '+(r.builder||r.houseDesign||'TBC')+'</p><p>Registration: '+(r.registration||r.status||'TBC')+'</p><p>'+summary+'</p><p><b>Availability:</b> '+(r.availability||r.status||'Unknown')+'</p></div><div><div class="plan">Floorplan / site plan thumbnail</div></div></div></div><footer><div>'+((b.disclaimer)||'Confirm details independently before relying on this material.')+'</div><div>'+((b.footer)||b.name||'')+' '+(token?'<br>Share token: '+token:'')+'</div></footer></section><script>async function shareLink(){let r=await fetch("/api/marketing/'+r.id+'/share?brand='+(b.id||'hello-home-property')+'",{method:"POST"}).then(x=>x.json());if(r.url){navigator.clipboard&&navigator.clipboard.writeText(r.url);alert("Share link copied: "+r.url)}else alert(JSON.stringify(r))}</script></body></html>';
}
function simplePdf(text) {
  const safe = String(text || '').replace(/[()\\]/g, ' ' ).slice(0, 1800);
  const lines = safe.match(/.{1,86}(\s|$)/g) || ['SEQ Property Watch'];
  let y = 790; const stream = ['BT /F1 14 Tf 40 '+y+' Td'];
  for (const line of lines.slice(0, 42)) { stream.push('('+line.trim()+') Tj'); stream.push('0 -17 Td'); }
  stream.push('ET'); const body = stream.join('\n');
  const objs = ['1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj','2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj','3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj','4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj','5 0 obj << /Length '+body.length+' >> stream\n'+body+'\nendstream endobj'];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; for (const obj of objs) { offsets.push(pdf.length); pdf += obj + '\n'; } const xref = pdf.length; pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(o => String(o).padStart(10,'0')+' 00000 n ').join('\n') + '\ntrailer << /Root 1 0 R /Size 6 >>\nstartxref\n'+xref+'\n%%EOF'; return Buffer.from(pdf);
}
async function marketingSheetResponse(req, res, propertyId, asPdf = false) {
  const url = new URL(req.url, 'http://localhost'); const brand = await brandById(url.searchParams.get('brand') || 'hello-home-property'); const record = await propertyById(propertyId);
  if (!record) return json(res, 404, { ok: false, error: 'Property not found' });
  if (asPdf) { const pdf = simplePdf((record.title||'Property')+'\n'+(record.price||'')+'\n'+(record.suburb||'')+'\n'+(record.notes||'')); res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="'+normaliseKey((record.suburb||'property')+'-'+(record.lot||record.id)+'-'+brand.id)+'.pdf"' }); return res.end(pdf); }
  return html(res, marketingHtml(record, brand));
}
async function shareResponse(req, res, token) { const db = await getDb(); const link = db ? (await db.query('select * from public_links where token=$1 and active=true and (expires_at is null or expires_at > now())', [token])).rows[0] : null; if (!link) return json(res, 404, { ok: false, error: 'Share link not found or inactive' }); const brand = await brandById(link.brand_id); const record = await propertyById(link.property_id); return html(res, marketingHtml(record, brand, token)); }
async function createShareLink(req, res, propertyId) { const db = await getDb(); const url = new URL(req.url, 'http://localhost'); const brand = url.searchParams.get('brand') || 'hello-home-property'; const token = crypto.randomBytes(18).toString('base64url'); if (db) await db.query('insert into public_links(token,property_id,brand_id,active) values($1,$2,$3,true)', [token, propertyId, brand]); return json(res, 200, { ok: true, token, url: 'https://seq-property-watch-production.up.railway.app/share/property/' + token }); }

async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) { const { Pool } = await import('pg'); pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }); }
  if (!initPromise) initPromise = migrate(pool);
  await initPromise;
  return pool;
}
async function allRecords() { const db = await getDb(); if (!db) return uniqueById(memoryRecords); for (const record of memoryRecords) await db.query('insert into records(id,data) values($1,$2) on conflict (id) do nothing', [record.id, record]); const result = await db.query("select data from records order by coalesce(data->>'date', data->>'discoveredAt') desc"); return result.rows.map(row => row.data); }
async function saveRecords(rows, source) { const existing = new Set((await allRecords()).map(row => row.id)); const db = await getDb(); const inserted = []; for (const row of rows) { const record = { ...row, discoveredAt: row.discoveredAt || new Date().toISOString(), automated: true, source: row.source || source }; if (existing.has(record.id)) continue; existing.add(record.id); inserted.push(record); if (db) await db.query('insert into records(id,data) values($1,$2) on conflict (id) do nothing', [record.id, record]); else memoryRecords.push(record); } return inserted; }

function analyseInvestment(record) {
  const blob = [record.title, record.kind, record.suburb, record.estate, record.size, record.beds, record.notes, record.status].join(' ').toLowerCase();
  const price = moneyNumber(record.price), size = landSize(record.size), beds = bedCount(record.beds), signals = [];
  if (size >= 700 || /subdivid|split|dual occ|duplex|corner|two street|wide frontage|lmr|mdr|low[- ]medium/.test(blob)) signals.push('Possible subdivision or dual-occupancy angle');
  if (size >= 450 || /granny|secondary dwelling|auxiliary unit/.test(blob)) signals.push('Possible granny flat / second dwelling angle');
  if (beds >= 4 || /student|rooming|share house|near university|hospital/.test(blob)) signals.push('Possible share-home angle');
  if (/registration|release|returned lot|new release|final release|titles/.test(blob)) signals.push('Fresh supply / timing angle');
  let weeklyRent = record.kind === 'Townhouse' ? ASSUMPTIONS.townhouseRent : record.kind === 'House & Land' ? ASSUMPTIONS.houseRent : 0;
  if (signals.some(item => item.includes('share-home')) && beds) weeklyRent = Math.max(weeklyRent, beds * ASSUMPTIONS.roomRent);
  if (signals.some(item => item.includes('granny') || item.includes('second dwelling'))) weeklyRent += ASSUMPTIONS.grannyRent;
  const annualRent = weeklyRent * 52, debt = price ? price * (1 - ASSUMPTIONS.depositRate) : 0, cashflow = annualRent - (debt * ASSUMPTIONS.interestRate) - (annualRent * ASSUMPTIONS.expenseRate), capitalGainOneYear = price ? price * ASSUMPTIONS.growthRate : 0;
  return { signals, score: signals.length * 20 + (cashflow > 0 ? 15 : 0) + (size >= 600 ? 10 : 0), weeklyRent, annualRent, cashflow, capitalGainOneYear, note: 'Indicative only. Confirm zoning, overlays, rental evidence, build costs, lending, tax and council rules before acting.' };
}
function opportunityRows(records) { return records.map(record => ({ ...record, investment: analyseInvestment(record) })).filter(record => record.investment.signals.length > 0).sort((a, b) => b.investment.score - a.investment.score); }

async function gmailAccessToken() { const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env; if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null; const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }) }); if (!response.ok) throw new Error('Gmail token refresh failed: ' + response.status); return (await response.json()).access_token; }
function decodeGmailBody(part) { try { return Buffer.from(String(part?.body?.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; } }
function gmailParts(payload) { const out = []; const walk = part => { out.push(part); (part.parts || []).forEach(walk); }; walk(payload || {}); return out; }
async function checkGmail() {
  const summary = await syncGmailDetailed();
  return { configured: summary.configured !== false, found: [], imported: summary.created || 0, updated: summary.updated || 0, message: summary.error || '' };
}
async function checkOnlineLand() { const found = []; for (const sourceUrl of LAND_SOURCE_URLS) { try { const response = await fetch(sourceUrl, { headers: { 'user-agent': 'SEQPropertyWatch/1.0' } }); if (!response.ok) continue; const markup = await response.text(), plain = cleanText(markup), title = cleanText((markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, new URL(sourceUrl).hostname])[1]), price = priceFromText(plain), size = (plain.match(/\d{3,5}\s*m(?:2|²)?/i) || ['Check listing'])[0], statusMatch = plain.match(/(?:next land release|land release|now selling|available now|release date)[^.;]{0,120}/i); found.push({ id: 'online-' + idFor(sourceUrl + title + price + size), title: title || 'Sunshine Coast land listing', kind: 'Land', area: areaFromText(sourceUrl + ' ' + plain), suburb: suburbFromText(sourceUrl + ' ' + plain), estate: title || new URL(sourceUrl).hostname, price, size, beds: '', status: statusMatch ? statusMatch[0] : 'Online land page matched', source: new URL(sourceUrl).hostname, origin: 'Public land', date: today(), url: sourceUrl, image: imageFromHtml(markup, sourceUrl), notes: plain.slice(0, 260) }); } catch (error) { console.warn('Online land check failed', sourceUrl, error.message); } } return { configured: LAND_SOURCE_URLS.length > 0, found }; }
async function sendTelegram(message) { const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env; if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false; const response = await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: false }) }); return response.ok; }
function alertMessage(records) { return 'New SEQ property opportunities found:\n\n' + records.slice(0, 8).map(record => { const investment = analyseInvestment(record); return record.title + '\n' + record.price + ' | ' + record.suburb + ' | ' + record.kind + (investment.signals.length ? '\nSignals: ' + investment.signals.join(', ') : '') + '\n' + (record.url && record.url !== '#' ? record.url : ''); }).join('\n\n'); }
async function runCheck() { const [gmail, online] = await Promise.all([checkGmail(), checkOnlineLand()]); const inserted = await saveRecords([...(gmail.found || []), ...(online.found || [])], 'Automation'); if (inserted.length) await sendTelegram(alertMessage(inserted)); return { ok: true, inserted: inserted.length, gmail: { configured: gmail.configured, found: gmail.found?.length || 0, message: gmail.message || '' }, online: { configured: online.configured, found: online.found?.length || 0 }, checkedAt: new Date().toISOString() }; }

function appPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEQ Property Watch</title><style>:root{--ink:#17221d;--muted:#63736b;--line:#dce5df;--paper:#f4f6f1;--teal:#0f766e}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:28px clamp(16px,4vw,56px);background:linear-gradient(135deg,#123f3b,#2f5838 58%,#8a672a);color:white}h1{font-size:clamp(34px,5vw,60px);line-height:.98;margin:4px 0 10px}.eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:12px;font-weight:900;color:#dceee5}.copy{max-width:900px;color:#eef8f2;line-height:1.45}.sharebar{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}button,.btn{border:0;border-radius:8px;background:var(--teal);color:white;font-weight:900;padding:10px 12px;cursor:pointer;text-decoration:none;display:inline-flex}.ghost{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28)}.toolbar{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;padding:14px clamp(16px,4vw,56px);background:rgba(250,251,247,.96);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}label{display:grid;gap:5px;font-size:12px;font-weight:900;color:#33423c}select,input{width:100%;border:1px solid #cbd8d1;border-radius:8px;background:white;padding:10px;font:inherit}main{padding:22px clamp(16px,4vw,56px) 50px;display:grid;gap:24px}.stats{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:12px}.stat{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 12px 32px rgba(20,31,27,.08)}.stat strong{display:block;font-size:31px}.stat span{color:var(--muted);font-size:13px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0;font-size:23px}.section-title p{margin:0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(315px,1fr));gap:16px}article{background:white;border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 14px 38px rgba(20,31,27,.09)}.visual{height:165px;position:relative;background:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),linear-gradient(120deg,#83b77c,#d8bb71 48%,#4f83a7);background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:12px}article[data-kind="Townhouse"] .visual{background-image:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),linear-gradient(120deg,#769fb8,#bccaa1 50%,#315d82)}article[data-kind="House & Land"] .visual{background-image:linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),linear-gradient(120deg,#709b70,#d0ad68 45%,#84668b)}.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{background:rgba(255,255,255,.93);border-radius:999px;padding:5px 8px;font-size:12px;font-weight:900}.content{padding:15px;display:grid;gap:10px}h3{margin:0;font-size:19px;line-height:1.2}.price{font-size:22px;font-weight:950;color:var(--teal)}.facts{display:flex;flex-wrap:wrap;gap:6px}.facts span{border:1px solid var(--line);border-radius:7px;background:#fbfcfa;padding:6px 8px;color:#5d6b65;font-size:13px}.status{font-weight:900;color:#31443d}.notes{color:#3f4d47;line-height:1.45;font-size:14px}.investment{border-top:1px solid var(--line);padding-top:10px;display:grid;gap:7px}.investment b{color:#7d541d}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.metric{background:#f5f8f5;border:1px solid #e1e9e3;border-radius:8px;padding:8px;font-size:12px}.metric strong{display:block;font-size:15px;color:#17221d}.card-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid #edf1ed}.card-actions a{background:#edf4f2;color:#0f5f59;border-radius:8px;text-decoration:none;font-weight:900;padding:9px 10px}.source{color:var(--muted);font-size:12px}.empty{display:none;padding:30px;background:white;border:1px dashed #bcc8c2;border-radius:12px;text-align:center;color:var(--muted)}@media(max-width:960px){.toolbar,.stats{grid-template-columns:1fr}.toolbar{position:static}.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}}</style></head><body><header><div class="eyebrow">South East Queensland property radar</div><h1>SEQ Property Watch</h1><div class="copy">Email-sourced packages and townhouses, public land availability, and a watchlist for investment angles like subdivision, secondary dwellings and share-home potential.</div><div class="sharebar"><button class="ghost" onclick="shareApp()">Share entire app</button><button class="ghost" onclick="copyText(location.href)">Copy app link</button><button class="ghost" onclick="syncNow()">Sync Gmail Now</button><a class="btn ghost" href="/admin/email-imports">Email Import Activity</a></div></header><section class="toolbar"><label>View<select id="view"><option value="all">All stock</option><option value="opportunities">Investment opportunities</option></select></label><label>Type<select id="kind"><option value="">All types</option><option>Land</option><option>House & Land</option><option>Townhouse</option></select></label><label>Area<select id="area"><option value="">All areas</option><option>Sunshine Coast</option><option>Moreton Bay</option><option>Brisbane</option><option>Gold Coast</option></select></label><label>Source<select id="origin"><option value="">All sources</option><option>Email</option><option>Public land</option></select></label><label>Search<input id="q" placeholder="Suburb, estate, lot, price"></label></section><main><section class="stats"><div class="stat"><strong id="total">0</strong><span>tracked records</span></div><div class="stat"><strong id="land">0</strong><span>land records</span></div><div class="stat"><strong id="packages">0</strong><span>home & land packages</span></div><div class="stat"><strong id="opps">0</strong><span>investment signals</span></div></section><div class="section-title"><div><h2 id="heading">Available Stock</h2><p id="summary">Loading current records...</p></div></div><section class="grid" id="cards"></section><div class="empty" id="empty">No records match those filters.</div></main><script>let records=[];let opps=[];const cards=document.getElementById("cards"),empty=document.getElementById("empty");const controls=["view","kind","area","origin","q"].map(id=>document.getElementById(id));const money=v=>new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:0}).format(v||0);function n(v){return String(v||"").toLowerCase()}function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function urlFor(r){return location.origin+location.pathname+"#"+r.id}async function copyText(t){try{await navigator.clipboard.writeText(t);alert("Link copied")}catch(e){prompt("Copy this link",t)}}function shareApp(){let data={title:"SEQ Property Watch",text:"SEQ property list",url:location.href};navigator.share?navigator.share(data):copyText(location.href)}function shareRecord(id){let r=[...records,...opps].find(x=>x.id===id);let u=urlFor(r);let data={title:r.title,text:r.title+" - "+r.price+" - "+r.suburb,url:u};navigator.share?navigator.share(data):copyText(u)}async function syncNow(){let r=await fetch("/api/sync/gmail",{method:"POST"}).then(x=>x.json());alert("Scanned: "+(r.scanned||0)+" New: "+(r.created||0)+" Updated: "+(r.updated||0)+" Skipped: "+(r.skipped||0)+" Failed: "+(r.failed||0)+" Completed: "+(r.completedAt||""));load()}function visible(){const[view,kind,area,origin,q]=controls;let base=view.value==="opportunities"?opps:records;let rows=base.filter(r=>(!kind.value||r.kind===kind.value)&&(!area.value||r.area===area.value)&&(!origin.value||r.origin===origin.value)&&(!q.value||n(Object.values(r).join(" ")).includes(n(q.value))));rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));return rows}function inv(r){if(!r.investment)return"";let i=r.investment;return "<div class=investment><b>Investment signals</b><div class=notes>"+esc(i.signals.join(", "))+"</div><div class=metrics><div class=metric><strong>"+money(i.weeklyRent)+"</strong>weekly rent est.</div><div class=metric><strong>"+money(i.cashflow)+"</strong>annual cashflow est.</div><div class=metric><strong>"+money(i.capitalGainOneYear)+"</strong>1yr capital gain est.</div></div><div class=source>"+esc(i.note)+"</div></div>"}function make(tag, className, text){let node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node}function addChip(parent,text){parent.appendChild(make("span","chip",text))}function addFact(parent,text){if(text)parent.appendChild(make("span","",text))}function card(r){let a=make("article");a.id=r.id;a.dataset.kind=r.kind;let visual=make("div","visual");if(r.image)visual.style.backgroundImage="linear-gradient(135deg,rgba(12,24,21,.10),rgba(12,24,21,.76)),url("+r.image+")";let chips=make("div","chips");addChip(chips,r.kind);addChip(chips,r.area);addChip(chips,r.origin);visual.appendChild(chips);let content=make("div","content");content.appendChild(make("h3","",r.title));content.appendChild(make("div","price",r.price));let facts=make("div","facts");addFact(facts,r.suburb);addFact(facts,r.estate);addFact(facts,r.size);addFact(facts,r.beds);content.appendChild(facts);content.appendChild(make("p","status",r.status));content.appendChild(make("p","notes",r.notes));if(r.investment){let box=make("div","investment");box.appendChild(make("b","","Investment signals"));box.appendChild(make("div","notes",r.investment.signals.join(", ")));let metrics=make("div","metrics");[[money(r.investment.weeklyRent),"weekly rent est."],[money(r.investment.cashflow),"annual cashflow est."],[money(r.investment.capitalGainOneYear),"1yr capital gain est."]].forEach(m=>{let item=make("div","metric");item.appendChild(make("strong","",m[0]));item.appendChild(document.createTextNode(m[1]));metrics.appendChild(item)});box.appendChild(metrics);box.appendChild(make("div","source",r.investment.note));content.appendChild(box)}content.appendChild(make("div","source",r.source+" · "+r.date));let actions=make("div","card-actions");let share=make("button","","Share this");share.dataset.share=r.id;let copy=make("button","","Copy link");copy.dataset.copy=r.id;actions.appendChild(share);actions.appendChild(copy);let market=make("a","","Create Marketing Sheet");market.href="/marketing/"+encodeURIComponent(r.id);actions.appendChild(market);if(r.url&&r.url!=="#"){let link=make("a","","Open source");link.href=r.url;link.target="_blank";link.rel="noopener";actions.appendChild(link)}content.appendChild(actions);a.appendChild(visual);a.appendChild(content);return a}function render(){let rows=visible();cards.replaceChildren(...rows.map(card));empty.style.display=rows.length?"none":"block";document.getElementById("total").textContent=records.length;document.getElementById("land").textContent=records.filter(r=>r.kind==="Land").length;document.getElementById("packages").textContent=records.filter(r=>r.kind==="House & Land").length;document.getElementById("opps").textContent=opps.length;document.getElementById("heading").textContent=controls[0].value==="opportunities"?"Investment Opportunities":"Available Stock";document.getElementById("summary").textContent="Showing "+rows.length+" of "+(controls[0].value==="opportunities"?opps.length:records.length)+" records.";if(location.hash){let el=document.querySelector(location.hash);if(el)el.scrollIntoView({block:"center"})}}async function load(){let [r,o]=await Promise.all([fetch("/api/records").then(x=>x.json()),fetch("/api/opportunities").then(x=>x.json())]);records=r.records||[];opps=o.records||[];render()}controls.forEach(c=>c.addEventListener("input",render));document.addEventListener("click",e=>{let s=e.target.closest("[data-share]");if(s)return shareRecord(s.dataset.share);let c=e.target.closest("[data-copy]");if(c){let r=[...records,...opps].find(x=>x.id===c.dataset.copy);if(r)copyText(urlFor(r))}});load().catch(e=>{document.getElementById("summary").textContent="Could not load records: "+e.message});</script></body></html>';
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') { const metrics = await dashboardMetrics().catch(() => ({})); return json(res, 200, { ok: true, service: 'seq-property-watch', timestamp: new Date().toISOString(), checks: { app: true, databaseConfigured: Boolean(process.env.DATABASE_URL), gmailConfigured: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN), storageConfigured: Boolean(process.env.S3_BUCKET || process.env.MEDIA_BASE_URL), backgroundSyncFresh: Boolean(metrics.lastSync && Date.now() - new Date(metrics.lastSync.completedAt || metrics.lastSync.at || 0).getTime() < 20 * 60 * 1000) }, config: { autoCheckEnabled: AUTO_CHECK_ENABLED, telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), landSourceCount: LAND_SOURCE_URLS.length, checkIntervalMinutes: CHECK_INTERVAL_MINUTES } }); }
    if (url.pathname === '/api/dashboard') return json(res, 200, { ok: true, metrics: await dashboardMetrics() });
    if (url.pathname === '/api/email-imports') return json(res, 200, { ok: true, rows: await listEmailImports() });
    if (url.pathname === '/api/brands') return json(res, 200, { ok: true, brands: await listBrands() });
    if (url.pathname === '/api/sync/gmail') return json(res, 200, await syncGmailDetailed());
    if (url.pathname.startsWith('/api/email-imports/') && url.pathname.endsWith('/reprocess')) return json(res, 200, await syncGmailDetailed({ reprocessMessageId: decodeURIComponent(url.pathname.split('/')[3]) }));
    if (url.pathname === '/api/records') return json(res, 200, { ok: true, records: await allRecords() });
    if (url.pathname === '/api/opportunities') return json(res, 200, { ok: true, records: opportunityRows(await allRecords()) });
    if (url.pathname === '/api/check') { if (CHECK_SECRET && url.searchParams.get('secret') !== CHECK_SECRET && req.headers['x-check-secret'] !== CHECK_SECRET) return json(res, 401, { ok: false, error: 'Missing or invalid check secret' }); return json(res, 200, await runCheck()); }
    if (url.pathname === '/admin/email-imports') return html(res, adminEmailPage());
    if (url.pathname.startsWith('/marketing/')) return marketingSheetResponse(req, res, decodeURIComponent(url.pathname.split('/')[2] || ''));
    if (url.pathname.startsWith('/api/marketing/') && url.pathname.endsWith('/pdf')) return marketingSheetResponse(req, res, decodeURIComponent(url.pathname.split('/')[3] || ''), true);
    if (url.pathname.startsWith('/api/marketing/') && url.pathname.endsWith('/share')) return createShareLink(req, res, decodeURIComponent(url.pathname.split('/')[3] || ''));
    if (url.pathname.startsWith('/share/property/')) return shareResponse(req, res, decodeURIComponent(url.pathname.split('/')[3] || ''));
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.endsWith('/seq-property-email-watch.html')) return html(res, appPage());
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) { console.error(error); return json(res, 500, { ok: false, error: error.message }); }
}

const server = http.createServer((req, res) => { handle(req, res); });
server.listen(PORT, '0.0.0.0', () => console.log('SEQ Property Watch listening on port ' + PORT));
if (AUTO_CHECK_ENABLED) { setTimeout(() => runCheck().catch(error => console.error('Initial check failed', error)), 10000); setInterval(() => runCheck().catch(error => console.error('Scheduled check failed', error)), CHECK_INTERVAL_MINUTES * 60 * 1000); }
