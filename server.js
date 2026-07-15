import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://seq-property-watch-production.up.railway.app').replace(/\/$/, '');
const AUTO_CHECK_ENABLED = process.env.AUTO_CHECK_ENABLED === 'true' || Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
const CHECK_INTERVAL_MINUTES = Math.max(5, Number(process.env.CHECK_INTERVAL_MINUTES || 5));
const CHECK_SECRET = process.env.CHECK_SECRET || '';
const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || PUBLIC_BASE_URL + '/auth/gmail/callback';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_QUERY = process.env.GMAIL_QUERY || 'newer_than:120d -in:spam -in:trash ("price list" OR "land update" OR "stock list" OR "new release" OR package OR "house and land" OR "home and land" OR lot OR stage OR estate OR terrace OR townhome OR townhouse OR registration OR floorplan OR facade OR "site plan" OR available OR released OR "fixed price")';
const LAND_SOURCE_URLS = (process.env.ONLINE_LAND_SOURCE_URLS || 'https://www.stockland.com.au/residential/qld/aura/land-for-sale,https://www.stockland.com.au/residential/qld/aura,https://harmony.avid.com.au/land-for-sale/,https://www.realestate.com.au/buy/property-residential+land-in-sunshine+coast,+qld/list-1,https://www.domain.com.au/sale/sunshine-coast-qld/land/')
  .split(',').map(x => x.trim()).filter(Boolean);
const REVIEW_STATUSES = ['Draft', 'Requires Review', 'Reviewed', 'Approved for Sheets', 'Synced to Sheets', 'Rejected', 'Superseded'];
const PUBLIC_COPY_BLOCKLIST = /bank|bsb|account|commission|gmail id|gmail_message|thread|internal|private|agent-only|import error/i;
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
['north-harbour-11c','North Harbour - The Avenues Stage 11C','Land','Moreton Bay','Burpengary East','North Harbour','Contact sales team','300m2 to 576m2+','','Public site lists stage release','North Harbour website','Public land','2026-07-02','https://www.northharbour.com.au/land-for-sale/','https://www.northharbour.com.au/wp-content/uploads/2018/07/Stage_23_Slider-1.jpg','Current stage release shown on North Harbour land page.'],
['aura-release','Aura Land Release Reminder','Land','Sunshine Coast','Aura','Stockland Aura','Not shown in email','Not shown','','Land release 27 June 2026 at 8:00am','Stockland email','Email','2026-06-26','https://www.stockland.com.au/residential/qld/aura','','Email subject: REMINDER: Land release at Aura tomorrow.'],
['lilywood-462','Lilywood Landings Stage 12 - Lot 462','Land','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $545,000','420m2','','Stage 12 now selling','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Frontage 14m, depth 30m. Estate range in email: $525,000-$565,000.'],
['lilywood-470','Lilywood Landings - Lot 470 Barn','House & Land','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $892,891','400m2 land, 174.8sq','4 bed, 2 bath, 2 car','Email-sourced package','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Builder shown in email link as Kiba Built.'],
['lilywood-216','Lilywood Landings - Lot 216 Parkside Terrace','Townhouse','Moreton Bay','Lilywood / Waraba','Lilywood Landings','From $793,000','280m2 land, 170.38sq','3 bed, 2 bath, 2 car','Stage 10B terraces over 60% sold','OpenLot email','Email','2026-06-27','https://www.openlot.com.au/lilywood-landings-estate-lilywood?layout=lcp','','Townhouse email record.']
];
const seedRecords = seedRows.map(row => normalizeRecord(Object.fromEntries(cols.map((col, index) => [col, row[index] || '']))));
let memoryRecords = seedRecords;
let pool;
let initPromise;

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}
function html(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function sendBuffer(res, status, buffer, type, filename = '') {
  const headers = { 'content-type': type, 'cache-control': 'no-store' };
  if (filename) headers['content-disposition'] = 'attachment; filename="' + filename.replace(/"/g, '') + '"';
  res.writeHead(status, headers);
  res.end(buffer);
}
function idFor(input) { return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 16); }
function today() { return new Date().toISOString().slice(0, 10); }
function escHtml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function cleanText(value) { return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function normaliseKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-'); }
function moneyNumber(value) { const match = String(value || '').replace(/,/g, '').match(/\$?\s*(\d{3,8})/); return match ? Number(match[1]) : 0; }
function landSize(value) { const match = String(value || '').replace(/,/g, '').match(/(\d{3,5})\s*m(?:2|²)?/i); return match ? Number(match[1]) : 0; }
function bedCount(value) { const match = String(value || '').match(/(\d+)\s*bed/i); return match ? Number(match[1]) : 0; }
function areaFromText(value) { const n = String(value || '').toLowerCase(); if (/sunshine|aura|palmview|caloundra|maroochydore|beerwah|nambour|nirimba|baringa/.test(n)) return 'Sunshine Coast'; if (/moreton|narangba|burpengary|caboolture|morayfield|waraba|lilywood/.test(n)) return 'Moreton Bay'; if (/gold coast|bundall|logan/.test(n)) return 'Gold Coast'; if (/brisbane|rochedale|pallara|joyner|taigum|albany creek|redbank plains/.test(n)) return 'Brisbane'; return 'South East Queensland'; }
function kindFromText(value) { const n = String(value || '').toLowerCase(); if (/townhouse|townhome|terrace/.test(n)) return 'Townhouse'; if (/house and land|home and land|package|turnkey/.test(n)) return 'House & Land'; return 'Land'; }
function suburbFromText(value) { const suburbs = ['Aura','Palmview','Caloundra','Baringa','Nirimba','Maroochydore','Nambour','Beerwah','Narangba','Burpengary East','Morayfield','Caboolture','Waraba','Lilywood','Rochedale','Pallara','Joyner','Taigum','Albany Creek','Redbank Plains','Loganholme','Bundall']; return suburbs.find(name => String(value || '').toLowerCase().includes(name.toLowerCase())) || 'Sunshine Coast / SEQ'; }
function priceFromText(value) { const match = String(value || '').replace(/,/g, '').match(/(?:\$|from\s*\$?)\s*(\d{3,8})/i); return match ? '$' + Number(match[1]).toLocaleString('en-AU') : 'Check listing'; }
function imageFromHtml(markup, baseUrl) { const match = String(markup || '').match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || String(markup || '').match(/<img[^>]+src=["']([^"']+)/i); try { return match ? new URL(match[1], baseUrl).href : ''; } catch { return ''; } }
function gmailMessageUrl(messageId) { return messageId ? 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(messageId) : ''; }
function base64UrlToBase64(value) { const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/'); return text + '='.repeat((4 - text.length % 4) % 4); }

function normalizeStatus(value, fallback = 'Draft') {
  return REVIEW_STATUSES.includes(value) ? value : fallback;
}
function normalizeRecord(row = {}) {
  const kind = row.kind || row.propertyType || row.property_type || kindFromText([row.title, row.notes, row.beds].join(' '));
  const bedrooms = row.bedrooms || row.bed || (String(row.beds || '').match(/(\d+)/)?.[1] || '');
  const bathrooms = row.bathrooms || (String(row.beds || '').match(/(\d+)\s*bath/i)?.[1] || '');
  const garage = row.garage || row.garages || (String(row.beds || '').match(/(\d+)\s*car/i)?.[1] || '');
  const reviewStatus = normalizeStatus(row.reviewStatus || row.status, row.origin === 'Email' ? 'Draft' : 'Reviewed');
  const id = row.id || 'property-' + idFor([row.estate, row.stage, row.lot || row.lotNumber, row.title, row.price].join('|'));
  return {
    ...row,
    id,
    title: row.title || [kind, row.estate || row.project, row.suburb].filter(Boolean).join(' - ') || 'Property record',
    kind,
    propertyType: kind,
    area: row.area || row.region || areaFromText([row.title, row.suburb, row.notes].join(' ')),
    region: row.region || row.area || areaFromText([row.title, row.suburb, row.notes].join(' ')),
    suburb: row.suburb || row.location || suburbFromText([row.title, row.notes].join(' ')),
    location: row.location || row.suburb || '',
    estate: row.estate || row.project || '',
    project: row.project || row.estate || '',
    stage: row.stage || '',
    lot: row.lot || row.lotNumber || row.lot_number || '',
    lotNumber: row.lotNumber || row.lot || row.lot_number || '',
    price: row.price || row.packagePrice || row.landPrice || '',
    packagePrice: row.packagePrice || (kind === 'House & Land' ? row.price : ''),
    landPrice: row.landPrice || (kind === 'Land' ? row.price : ''),
    landSize: row.landSize || row.size || '',
    houseSize: row.houseSize || '',
    bedrooms,
    bathrooms,
    garage,
    storeys: row.storeys || '',
    builder: row.builder || row.developer || '',
    developer: row.developer || row.builder || '',
    houseDesign: row.houseDesign || row.design || '',
    registration: row.registration || row.registrationDate || '',
    deposit: row.deposit || '',
    inclusions: Array.isArray(row.inclusions) ? row.inclusions : splitBullets(row.inclusions || row.keyInclusions || ''),
    description: row.description || row.publicSummary || row.notes || '',
    notes: row.notes || '',
    internalNotes: row.internalNotes || '',
    source: row.source || '',
    origin: row.origin || 'Manual',
    sourceEmail: row.sourceEmail || row.emailUrl || '',
    emailUrl: row.emailUrl || row.sourceEmail || '',
    sourceAttachment: row.sourceAttachment || '',
    sourceEmailId: row.sourceEmailId || '',
    gmailThreadId: row.gmailThreadId || '',
    url: row.url || '',
    image: row.image || '',
    floorplanImage: row.floorplanImage || '',
    sitePlanImage: row.sitePlanImage || '',
    images: normalizeImages(row.images, row.image, row.floorplanImage, row.sitePlanImage),
    reviewStatus,
    status: reviewStatus,
    sheetSync: row.sheetSync || null,
    confidence: row.confidence || {},
    fieldReview: row.fieldReview || inferFieldReview(row),
    discoveredAt: row.discoveredAt || row.date || new Date().toISOString(),
    date: row.date || today(),
    updatedAt: row.updatedAt || new Date().toISOString()
  };
}
function splitBullets(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split(/\n|;|•/).map(x => x.trim()).filter(Boolean);
}
function normalizeImages(images, image, floorplanImage, sitePlanImage) {
  const out = [];
  const add = (url, category, label) => { if (url && !out.some(i => i.url === url)) out.push({ id: 'img-' + idFor(url + category), url, fullUrl: url, category, label, hidden: false, main: category === 'Main image' }); };
  (Array.isArray(images) ? images : []).forEach((img, index) => {
    if (!img || img.hidden) return;
    const url = img.fullUrl || img.url || img.dataUri;
    if (url) out.push({ id: img.id || 'img-' + idFor(url + index), url, fullUrl: url, category: img.category || 'Image', label: img.label || img.filename || img.category || 'Image', hidden: Boolean(img.hidden), main: Boolean(img.main) });
  });
  add(image, 'Main image', 'Main Image');
  add(floorplanImage, 'Floorplan', 'Floorplan');
  add(sitePlanImage, 'Site plan', 'Site Plan');
  if (out.length && !out.some(i => i.main)) out[0].main = true;
  return out;
}
function inferFieldReview(row) {
  const fields = ['price','suburb','landSize','houseSize','bedrooms','bathrooms','garage','builder','houseDesign','registration','lot'];
  const review = {};
  for (const field of fields) review[field] = row[field] || row[field === 'landSize' ? 'size' : field] ? 'confident' : 'missing';
  return review;
}
function publicRecord(row) {
  const clean = normalizeRecord(row);
  if (PUBLIC_COPY_BLOCKLIST.test(clean.notes)) clean.notes = '';
  if (PUBLIC_COPY_BLOCKLIST.test(clean.description)) clean.description = '';
  clean.gmailMessageId = undefined;
  clean.gmailThreadId = undefined;
  clean.sourceEmailId = undefined;
  return clean;
}
function propertyIdentity(row) {
  return normaliseKey([row.estate || row.project, row.stage, row.lot || row.lotNumber, row.builder, row.houseDesign || row.title].filter(Boolean).join('|'));
}
function changedFields(previous, next) {
  const keys = ['price','reviewStatus','suburb','estate','stage','lot','landSize','houseSize','bedrooms','bathrooms','garage','builder','houseDesign','registration','description','image'];
  return keys.filter(k => String(previous?.[k] || '') !== String(next?.[k] || ''));
}

async function migrate(db) {
  await db.query('create table if not exists records (id text primary key, data jsonb not null, created_at timestamptz default now())');
  await db.query("create table if not exists app_meta (key text primary key, value jsonb not null, updated_at timestamptz default now())");
  await db.query("create table if not exists email_imports (gmail_message_id text primary key, gmail_thread_id text, received_at timestamptz, sender text, subject text, attachment_count int default 0, attachment_names jsonb default '[]'::jsonb, confidence int default 0, status text not null, result text, properties_created int default 0, properties_updated int default 0, skip_reason text, error_reason text, source_links jsonb default '[]'::jsonb, processed_at timestamptz default now(), raw_evidence jsonb default '{}'::jsonb)");
  await db.query("create table if not exists properties (id text primary key, identity_key text unique, data jsonb not null, status text default 'Draft', marketing_ready boolean default false, hero_media_id text, floorplan_media_id text, created_at timestamptz default now(), updated_at timestamptz default now())");
  await db.query("create table if not exists property_versions (id text primary key, property_id text not null, source_email_id text, previous_data jsonb, new_data jsonb not null, changed_fields jsonb default '[]'::jsonb, created_at timestamptz default now())");
  await db.query("create table if not exists media (id text primary key, property_id text, gmail_message_id text, source_attachment text, original_filename text, mime_type text, width int, height int, file_size int, perceptual_hash text, category text, confidence int default 0, public_safe boolean default true, url text, data_uri text, created_at timestamptz default now())");
  await db.query("create table if not exists copy_templates (id text primary key, name text not null, body text not null, active boolean default true, updated_at timestamptz default now())");
  await ensureTemplates(db);
}
async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  }
  if (!initPromise) initPromise = migrate(pool);
  await initPromise;
  return pool;
}
async function metaGet(key) { const db = await getDb(); if (!db) return null; const r = await db.query('select value from app_meta where key=$1', [key]); return r.rows[0]?.value || null; }
async function metaSet(key, value) { const db = await getDb(); if (!db) return; await db.query('insert into app_meta(key,value,updated_at) values($1,$2,now()) on conflict(key) do update set value=$2, updated_at=now()', [key, value]); }

const defaultTemplates = [
  ['client-shortlist', 'Client Shortlist', '{{project}}, {{suburb}} - {{price}}\n{{bedrooms}} bed | {{bathrooms}} bath | {{garage}} garage\n{{land_size}}m2 land | {{house_size}}m2 house\n{{short_description}}'],
  ['land-only', 'Land Only', 'Land available in {{estate}}, {{suburb}}\nLot: {{lot_number}}\nLand size: {{land_size}}m2\nFrontage: {{frontage}}m\nPrice: {{land_price}}\nRegistration: {{registration}}'],
  ['house-land', 'House & Land Package', 'House & Land Package - {{project}}, {{suburb}}\nPackage price: {{package_price}}\nHouse design: {{house_design}}\nBuilder: {{builder}}\n{{bedrooms}} bedrooms\n{{bathrooms}} bathrooms\n{{garage}} garage\nHouse size: {{house_size}}m2\nLand size: {{land_size}}m2\nKey inclusions:\n{{inclusions}}\n{{disclaimer}}'],
  ['terrace-townhome', 'Terrace or Townhome', '{{property_type}} - {{project}}, {{suburb}}\nPrice: {{price}}\n{{bedrooms}} bedrooms\n{{bathrooms}} bathrooms\n{{garage}} garage\nHouse size: {{house_size}}m2\nLand size: {{land_size}}m2\nCompletion: {{registration}}']
];
async function ensureTemplates(db) {
  for (const [id, name, body] of defaultTemplates) await db.query('insert into copy_templates(id,name,body,active) values($1,$2,$3,true) on conflict(id) do nothing', [id, name, body]);
}
async function listTemplates() {
  const db = await getDb();
  if (!db) return defaultTemplates.map(([id, name, body]) => ({ id, name, body, active: true }));
  const r = await db.query('select id,name,body,active from copy_templates where active=true order by name');
  return r.rows;
}
async function saveTemplate(id, payload) {
  const db = await getDb();
  const template = { id: id || 'template-' + idFor(payload.name + Date.now()), name: payload.name || 'Custom Template', body: payload.body || '' };
  if (!db) return template;
  await db.query('insert into copy_templates(id,name,body,active,updated_at) values($1,$2,$3,true,now()) on conflict(id) do update set name=$2, body=$3, active=true, updated_at=now()', [template.id, template.name, template.body]);
  return template;
}

async function allRecords() {
  const db = await getDb();
  if (!db) return memoryRecords.map(normalizeRecord);
  for (const record of seedRecords) await db.query('insert into records(id,data) values($1,$2) on conflict(id) do nothing', [record.id, record]);
  const result = await db.query("select data from records order by coalesce(data->>'updatedAt', data->>'date', data->>'discoveredAt') desc");
  return result.rows.map(row => normalizeRecord(row.data));
}
async function propertyById(id) {
  return (await allRecords()).find(r => r.id === id);
}
async function saveRecord(record, sourceEmailId = '') {
  const db = await getDb();
  const normalized = normalizeRecord({ ...record, updatedAt: new Date().toISOString() });
  const identity = propertyIdentity(normalized) || normalized.id;
  if (!db) {
    const existing = memoryRecords.findIndex(r => r.id === normalized.id);
    if (existing >= 0) memoryRecords[existing] = normalized; else memoryRecords.push(normalized);
    return normalized;
  }
  const existing = await db.query('select data from properties where identity_key=$1 or id=$2 limit 1', [identity, normalized.id]);
  const previous = existing.rows[0]?.data;
  const id = previous?.id || normalized.id || 'property-' + idFor(identity);
  const merged = normalizeRecord({ ...previous, ...normalized, id, identityKey: identity });
  await db.query('insert into properties(id,identity_key,data,status,updated_at) values($1,$2,$3,$4,now()) on conflict(identity_key) do update set data=$3,status=$4,updated_at=now()', [id, identity, merged, merged.reviewStatus]);
  await db.query('insert into records(id,data) values($1,$2) on conflict(id) do update set data=$2', [id, merged]);
  await db.query('insert into property_versions(id,property_id,source_email_id,previous_data,new_data,changed_fields) values($1,$2,$3,$4,$5,$6)', ['version-' + idFor(id + Date.now() + Math.random()), id, sourceEmailId || merged.sourceEmailId || '', previous || null, merged, changedFields(previous, merged)]);
  return merged;
}
async function saveRecords(rows, source) {
  const saved = [];
  for (const row of rows) saved.push(await saveRecord({ ...row, source: row.source || source }));
  return saved;
}

function headerMap(message) { return Object.fromEntries((message.payload?.headers || []).map(h => [String(h.name).toLowerCase(), h.value])); }
function receivedDate(headers, message) { return new Date(headers.date || Number(message.internalDate || Date.now())).toISOString(); }
function partList(payload) { const out = []; const walk = p => { out.push(p); (p.parts || []).forEach(walk); }; walk(payload || {}); return out; }
function decodeGmailBody(part) { try { return Buffer.from(base64UrlToBase64(part?.body?.data || ''), 'base64').toString('utf8'); } catch { return ''; } }
function attachmentMeta(message) { return partList(message.payload).filter(p => p.filename || p.body?.attachmentId).map(p => ({ filename: p.filename || 'inline', mimeType: p.mimeType || '', size: p.body?.size || 0, attachmentId: p.body?.attachmentId || '', disposition: (p.headers || []).find(h => /^content-disposition$/i.test(h.name))?.value || '' })); }
function sourceLinks(blob) { return [...new Set((String(blob || '').match(/https?:\/\/[^\s)"'>]+/g) || []).filter(u => !/accounts\.google|mail\.google/.test(u)).slice(0, 12))]; }
function classifyMedia(name, mimeType, size) {
  const n = String(name || '').toLowerCase();
  let category = 'Unknown', confidence = 35, publicSafe = true;
  if (/logo|signature|facebook|instagram|linkedin|icon|banner/.test(n) || Number(size || 0) < 8000) { category = /logo/.test(n) ? 'Logo' : 'Email signature'; confidence = 90; publicSafe = false; }
  else if (/facade|render|elevation|front|exterior/.test(n)) { category = 'House facade/render'; confidence = 88; }
  else if (/floor\s*plan|floorplan|house\s*plan|design|pse|working/.test(n)) { category = 'Floorplan'; confidence = 86; }
  else if (/site\s*plan|disclosure/.test(n)) { category = 'Site plan'; confidence = 86; }
  else if (/masterplan|master\s*plan/.test(n)) { category = 'Masterplan'; confidence = 84; }
  else if (/aerial|drone/.test(n)) { category = 'Aerial image'; confidence = 78; }
  else if (/estate|lifestyle|community|image|jpg|jpeg|png/.test(n) || /^image\//.test(mimeType || '')) { category = 'Estate/lifestyle'; confidence = 55; }
  return { category, confidence, publicSafe };
}
async function enrichGmailAttachments(messageId, token, attachments) {
  const maxBytes = Number(process.env.MAX_EMAIL_IMAGE_BYTES || 1500000);
  const enriched = [];
  for (const attachment of attachments) {
    const mediaClass = classifyMedia(attachment.filename, attachment.mimeType, attachment.size);
    const isImage = /^image\//i.test(attachment.mimeType || '') || /\.(jpe?g|png|webp)$/i.test(attachment.filename || '');
    const canInline = attachment.attachmentId && mediaClass.publicSafe && isImage && Number(attachment.size || 0) > 0 && Number(attachment.size || 0) <= maxBytes;
    let dataUri = '';
    if (canInline) {
      try {
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '/attachments/' + attachment.attachmentId, { headers: { Authorization: 'Bearer ' + token } });
        if (response.ok) {
          const payload = await response.json();
          dataUri = 'data:' + (attachment.mimeType || 'image/jpeg') + ';base64,' + base64UrlToBase64(payload.data || '');
        }
      } catch (error) {
        console.warn('Gmail attachment image fetch failed', attachment.filename, error.message);
      }
    }
    enriched.push({ ...attachment, ...mediaClass, dataUri, url: dataUri });
  }
  return enriched;
}
async function gmailAccessToken() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  if (!response.ok) throw new Error('Gmail token refresh failed: ' + response.status);
  return (await response.json()).access_token;
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
function extractPropertiesFromEmail({ subject, body, sender, date, messageId, threadId, attachments }) {
  const blob = [subject, body, attachments.map(a => a.filename).join(' ')].join(' ');
  const sourceEmail = gmailMessageUrl(messageId);
  const base = { source: sender, origin: 'Email', date, sourceEmail, emailUrl: sourceEmail, sourceEmailId: messageId, gmailThreadId: threadId, reviewStatus: 'Draft', status: 'Draft' };
  const rows = [];
  if (/affinity|morayfield|stage\s*18/i.test(blob)) {
    for (let lot = 1815; lot <= 1820; lot++) rows.push({ ...base, title: 'Affinity Estate Stage 18 - Lot ' + lot, kind: 'House & Land', area: 'Moreton Bay', suburb: 'Morayfield', estate: 'Affinity Estate', project: 'Affinity Estate', stage: '18', lot: String(lot), lotNumber: String(lot), price: priceFromText(blob), bedrooms: '4', status: 'Draft', description: 'Extracted from Stage 18 Affinity Estate email. Review package brochure and site plan before approval.' });
    return rows;
  }
  if (/re land updates|arbourwood|farriers creek|millwood rise|mayfair lane|sovereign estates/i.test(blob)) {
    ['Arbourwood','Farriers Creek','Millwood Rise','Mayfair Lane','Sovereign Estates'].forEach(name => rows.push({ ...base, title: name + ' current land list', kind: 'Land', area: 'South East Queensland', estate: name, project: name, price: 'Check attached price list', status: 'Requires Review', reviewStatus: 'Requires Review', description: 'Separate estate land-list attachment from generic Re Land Updates email.' }));
    return rows;
  }
  rows.push({ ...base, title: subject || 'Email property opportunity', kind: kindFromText(blob), area: areaFromText(blob), suburb: suburbFromText(blob), estate: 'Email supplied', price: priceFromText(blob), landSize: (blob.match(/\d{3,5}\s*m(?:2|²)?/i) || [''])[0], bedrooms: (blob.match(/(\d)\s*bed/i) || [,''])[1], status: 'Draft', description: cleanText(blob).slice(0, 400) });
  return rows;
}
async function saveMediaForProperty(propertyId, gmailMessageId, attachments) {
  const db = await getDb();
  const saved = [];
  for (const a of attachments) {
    const mediaId = 'media-' + idFor([propertyId, gmailMessageId, a.filename, a.size].join('|'));
    const url = a.dataUri || a.url || '';
    const item = { id: mediaId, url, fullUrl: url, dataUri: a.dataUri || '', filename: a.filename || 'inline', label: a.filename || a.category || 'Image', category: a.category || classifyMedia(a.filename, a.mimeType, a.size).category, mimeType: a.mimeType || '', hidden: false, main: false };
    saved.push(item);
    if (db) await db.query('insert into media(id,property_id,gmail_message_id,source_attachment,original_filename,mime_type,file_size,category,confidence,public_safe,url,data_uri) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(id) do update set category=$8, confidence=$9, public_safe=$10, url=$11, data_uri=$12', [mediaId, propertyId, gmailMessageId, a.attachmentId || '', a.filename || 'inline', a.mimeType || '', a.size || 0, item.category, a.confidence || 0, a.publicSafe !== false, url, a.dataUri || '']);
  }
  return saved;
}
async function importGmailMessage(messageId, token, force = false) {
  const db = await getDb();
  const existing = db ? await db.query('select gmail_message_id from email_imports where gmail_message_id=$1', [messageId]) : { rows: [] };
  if (existing.rows.length && !force) return { status: 'Duplicate message', scanned: 1, created: 0, updated: 0, skipped: 1, failed: 0 };
  const messageResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?format=full', { headers: { Authorization: 'Bearer ' + token } });
  if (!messageResponse.ok) throw new Error('Gmail message fetch failed: ' + messageResponse.status);
  const message = await messageResponse.json();
  const headers = headerMap(message);
  const subject = headers.subject || '';
  const sender = headers.from || '';
  const date = receivedDate(headers, message).slice(0, 10);
  const body = cleanText([message.snippet, partList(message.payload).map(decodeGmailBody).join(' ')].join(' '));
  const attachments = await enrichGmailAttachments(message.id, token, attachmentMeta(message));
  const names = attachments.map(a => a.filename).filter(Boolean);
  const confidence = confidenceForEmail({ sender, subject, body, names });
  const links = sourceLinks(body);
  let status = confidence >= 60 ? 'Imported' : confidence >= 35 ? 'Requires review' : 'Skipped as unrelated';
  let created = 0, updated = 0, skipped = status === 'Skipped as unrelated' ? 1 : 0, errorReason = '', skipReason = skipped ? 'Low property confidence score' : '';
  try {
    if (!skipped) {
      const extracted = extractPropertiesFromEmail({ subject, body, sender, date, messageId: message.id, threadId: message.threadId, attachments });
      for (const row of extracted) {
        const saved = await saveRecord(row, message.id);
        const media = await saveMediaForProperty(saved.id, message.id, attachments);
        const useful = media.filter(m => m.url && !/Email signature|Logo/.test(m.category));
        if (useful.length) {
          const images = normalizeImages([...(saved.images || []), ...useful], saved.image, saved.floorplanImage, saved.sitePlanImage);
          const main = images.find(i => i.main) || images[0];
          await saveRecord({ ...saved, images, image: saved.image || main?.url || '', floorplanImage: saved.floorplanImage || images.find(i => i.category === 'Floorplan')?.url || '' }, message.id);
        }
        if (!existing.rows.length) created += 1; else updated += 1;
      }
    }
  } catch (error) {
    status = 'Failed';
    errorReason = error.message;
  }
  if (db) await db.query('insert into email_imports(gmail_message_id,gmail_thread_id,received_at,sender,subject,attachment_count,attachment_names,confidence,status,result,properties_created,properties_updated,skip_reason,error_reason,source_links,processed_at,raw_evidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16) on conflict(gmail_message_id) do update set status=$9,result=$10,properties_created=$11,properties_updated=$12,skip_reason=$13,error_reason=$14,processed_at=now(),raw_evidence=$16', [message.id, message.threadId, receivedDate(headers, message), sender, subject, attachments.length, JSON.stringify(names), confidence, status, (created + updated) + ' draft review records extracted', created, updated, skipReason, errorReason, JSON.stringify(links), { snippet: message.snippet, attachmentNames: names, confidence, imageAttachments: attachments.filter(a => a.dataUri).map(a => a.filename) }]);
  return { status, scanned: 1, created, updated, skipped, failed: status === 'Failed' ? 1 : 0 };
}
async function syncGmailDetailed({ forceBackfill = false, reprocessMessageId = '' } = {}) {
  const started = Date.now();
  const token = await gmailAccessToken();
  if (!token) return { ok: false, configured: false, scanned: 0, candidates: 0, created: 0, updated: 0, skipped: 0, failed: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString(), error: 'Missing Gmail API Railway variables' };
  const db = await getDb();
  const lock = db ? await db.query('select pg_try_advisory_lock(87264001) locked') : { rows: [{ locked: true }] };
  if (!lock.rows[0].locked) return { ok: false, error: 'A Gmail sync is already running', scanned: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
  let scanned = 0, candidates = 0, created = 0, updated = 0, skipped = 0, failed = 0, errorDetails = '';
  try {
    await metaSet('gmail.last_attempted_sync', { at: new Date().toISOString() });
    let ids = [];
    if (reprocessMessageId) ids = [reprocessMessageId];
    else {
      let pageToken = '';
      do {
        const params = new URLSearchParams({ q: process.env.GMAIL_BACKFILL_QUERY || GMAIL_QUERY, maxResults: '50' });
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
        const result = await importGmailMessage(id, token, Boolean(reprocessMessageId) || forceBackfill);
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
    return summary;
  } catch (error) {
    const summary = { ok: false, scanned, candidates, created, updated, skipped, failed: failed + 1, durationMs: Date.now() - started, completedAt: new Date().toISOString(), error: error.message };
    await metaSet('gmail.sync_status', { status: 'failed', error: error.message });
    return summary;
  } finally {
    if (db) await db.query('select pg_advisory_unlock(87264001)');
  }
}

function validationFor(record) {
  const r = normalizeRecord(record);
  const missing = [];
  const hasLocation = Boolean(r.suburb || r.location || r.area || r.region);
  const hasPrice = Boolean(r.price || r.packagePrice || r.landPrice);
  if (r.kind === 'Land') {
    if (!hasLocation) missing.push('Suburb or location');
    if (!hasPrice) missing.push('Price');
    if (!r.landSize && !r.lot && !r.lotNumber) missing.push('Land size or lot identifier');
    if (!r.reviewStatus && !r.status) missing.push('Property status');
  } else if (r.kind === 'House & Land') {
    if (!hasLocation) missing.push('Location');
    if (!hasPrice) missing.push('Package price');
    if (!r.bedrooms) missing.push('Bedrooms');
    if (!r.houseSize && !r.landSize) missing.push('House or land size');
    if (!r.reviewStatus && !r.status) missing.push('Property status');
  } else {
    if (!hasLocation) missing.push('Location');
    if (!hasPrice) missing.push('Price');
    if (!r.bedrooms) missing.push('Bedrooms');
    if (!r.kind) missing.push('Property type');
    if (!r.reviewStatus && !r.status) missing.push('Property status');
  }
  return { ok: missing.length === 0, missing };
}
function sheetTabFor(record) {
  if (record.kind === 'Land') return 'Land';
  if (record.kind === 'Townhouse') return 'Terraces and Townhomes';
  return 'House & Land Packages';
}
function spreadsheetRow(record) {
  const r = normalizeRecord(record);
  if (r.kind === 'Land') return ['Available', r.region, r.suburb, r.estate, r.stage, r.lot, r.price, r.landSize, r.registration, r.source, r.url || r.emailUrl];
  if (r.kind === 'Townhouse') return ['Available', r.region, r.suburb, r.estate, r.stage, r.lot, r.price, r.builder, r.houseDesign, r.bedrooms, r.bathrooms, r.garage, r.houseSize, r.landSize, r.registration, r.url || r.emailUrl];
  return ['Available', r.region, r.suburb, r.estate, r.stage, r.lot, r.price || r.packagePrice, r.builder, r.houseDesign, r.bedrooms, r.bathrooms, r.garage, r.houseSize, r.landSize, r.registration, r.url || r.emailUrl];
}
async function syncToSheets(record) {
  const tab = sheetTabFor(record);
  const row = spreadsheetRow(record);
  if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL) return { ok: false, configured: false, tab, row: null, message: 'GOOGLE_SHEETS_WEBHOOK_URL is not configured. Record remains approved and can be synced later.' };
  const response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.GOOGLE_SHEETS_WEBHOOK_SECRET ? { 'x-sync-secret': process.env.GOOGLE_SHEETS_WEBHOOK_SECRET } : {}) },
    body: JSON.stringify({ tab, row, property: publicRecord(record), syncedAt: new Date().toISOString() })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, configured: true, tab, row: null, message: payload.error || 'Google Sheets sync failed with HTTP ' + response.status };
  return { ok: true, configured: true, tab: payload.tab || tab, row: payload.row || payload.rowNumber || null, url: payload.url || process.env.GOOGLE_SHEETS_URL || '', syncedAt: new Date().toISOString() };
}

function analyseInvestment(record) {
  const blob = [record.title, record.kind, record.suburb, record.estate, record.landSize, record.bedrooms, record.notes, record.description].join(' ').toLowerCase();
  const price = moneyNumber(record.price), size = landSize(record.landSize), beds = Number(record.bedrooms || bedCount(record.beds)), signals = [];
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
function opportunityRows(records) {
  return records.map(record => ({ ...record, investment: analyseInvestment(record) })).filter(record => record.investment.signals.length > 0).sort((a, b) => b.investment.score - a.investment.score);
}

async function checkOnlineLand() {
  const found = [];
  for (const sourceUrl of LAND_SOURCE_URLS) {
    try {
      const response = await fetch(sourceUrl, { headers: { 'user-agent': 'SEQPropertyWatch/1.0' } });
      if (!response.ok) continue;
      const markup = await response.text(), plain = cleanText(markup);
      const title = cleanText((markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, new URL(sourceUrl).hostname])[1]);
      const price = priceFromText(plain), size = (plain.match(/\d{3,5}\s*m(?:2|²)?/i) || ['Check listing'])[0];
      const statusMatch = plain.match(/(?:next land release|land release|now selling|available now|release date)[^.;]{0,120}/i);
      found.push(normalizeRecord({ id: 'online-' + idFor(sourceUrl + title + price + size), title: title || 'Sunshine Coast land listing', kind: 'Land', area: areaFromText(sourceUrl + ' ' + plain), suburb: suburbFromText(sourceUrl + ' ' + plain), estate: title || new URL(sourceUrl).hostname, price, landSize: size, reviewStatus: 'Requires Review', source: new URL(sourceUrl).hostname, origin: 'Public land', date: today(), url: sourceUrl, image: imageFromHtml(markup, sourceUrl), description: plain.slice(0, 320), status: statusMatch ? statusMatch[0] : 'Requires Review' }));
    } catch (error) {
      console.warn('Online land check failed', sourceUrl, error.message);
    }
  }
  return { configured: LAND_SOURCE_URLS.length > 0, found };
}
async function sendTelegram(message) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  const response = await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: false }) });
  return response.ok;
}
function alertMessage(records) {
  return 'New SEQ property draft review records found:\n\n' + records.slice(0, 8).map(record => record.title + '\n' + record.price + ' | ' + record.suburb + ' | ' + record.kind + '\nReview: ' + PUBLIC_BASE_URL + '/review/' + encodeURIComponent(record.id)).join('\n\n');
}
async function runCheck() {
  const [gmail, online] = await Promise.all([syncGmailDetailed(), checkOnlineLand()]);
  const inserted = await saveRecords([...(online.found || [])], 'Automation');
  if (inserted.length) await sendTelegram(alertMessage(inserted));
  return { ok: true, inserted: inserted.length, gmail: { configured: gmail.configured !== false, imported: gmail.created || 0, updated: gmail.updated || 0, message: gmail.error || '' }, online: { configured: online.configured, found: online.found?.length || 0 }, checkedAt: new Date().toISOString() };
}

function renderTemplate(template, record) {
  const r = normalizeRecord(record);
  const map = {
    project: r.project || r.estate,
    estate: r.estate || r.project,
    suburb: r.suburb,
    price: r.price,
    package_price: r.packagePrice || r.price,
    land_price: r.landPrice || r.price,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    garage: r.garage,
    land_size: stripUnit(r.landSize),
    house_size: stripUnit(r.houseSize),
    short_description: r.description,
    lot_number: r.lotNumber || r.lot,
    lot: r.lot || r.lotNumber,
    frontage: r.frontage || '',
    registration: r.registration,
    house_design: r.houseDesign,
    builder: r.builder,
    property_type: r.kind,
    inclusions: r.inclusions.map(x => '- ' + x).join('\n'),
    disclaimer: 'Subject to availability and final builder and land confirmation.',
    property_link: PUBLIC_BASE_URL + '/review/' + encodeURIComponent(r.id)
  };
  return String(template || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => map[key] ?? '');
}
function stripUnit(value) { return String(value || '').replace(/\s*m(?:2|²|sqm|sq)?$/i, '').trim(); }
function copyAllDetails(record) {
  const r = normalizeRecord(record);
  const heading = (r.kind || 'Property') + ' - ' + [r.estate || r.project, r.suburb || r.region].filter(Boolean).join(', ');
  return [
    heading,
    'Price: ' + valueOrTbc(r.price || r.packagePrice || r.landPrice),
    'Bedrooms: ' + valueOrTbc(r.bedrooms),
    'Bathrooms: ' + valueOrTbc(r.bathrooms),
    'Garage: ' + valueOrTbc(r.garage),
    'Land Size: ' + valueOrTbc(r.landSize),
    'House Size: ' + valueOrTbc(r.houseSize),
    'Builder: ' + valueOrTbc(r.builder || r.developer),
    'Registration: ' + valueOrTbc(r.registration),
    r.inclusions.length ? 'Key inclusions:\n' + r.inclusions.map(x => '- ' + x).join('\n') : '',
    r.description || '',
    'Subject to availability and final builder and land confirmation.'
  ].filter(Boolean).join('\n');
}
function copyShortSummary(record) {
  const r = normalizeRecord(record);
  return [
    [r.estate || r.project || r.suburb, r.region || r.area].filter(Boolean).join(', ') + ' - ' + valueOrTbc(r.price || r.packagePrice || r.landPrice),
    [r.bedrooms && r.bedrooms + ' bed', r.bathrooms && r.bathrooms + ' bath', r.garage && r.garage + ' garage'].filter(Boolean).join(' | '),
    [r.landSize && r.landSize + ' land', r.houseSize && r.houseSize + ' house'].filter(Boolean).join(' | '),
    (r.description || 'Property record, subject to availability and final confirmation.').slice(0, 180)
  ].filter(Boolean).join('\n');
}
function valueOrTbc(value) { return value ? String(value) : 'TBC'; }
function copyPriceFacts(record) {
  const r = normalizeRecord(record);
  return [r.price || r.packagePrice || r.landPrice, r.bedrooms && r.bedrooms + ' bedrooms', r.bathrooms && r.bathrooms + ' bathrooms', r.garage && r.garage + ' garage', r.landSize && r.landSize + ' land', r.houseSize && r.houseSize + ' house'].filter(Boolean).join('\n');
}
function copyLocation(record) {
  const r = normalizeRecord(record);
  return ['Project: ' + valueOrTbc(r.project), 'Estate: ' + valueOrTbc(r.estate), 'Suburb: ' + valueOrTbc(r.suburb), 'Region: ' + valueOrTbc(r.region || r.area), 'Stage: ' + valueOrTbc(r.stage), 'Lot: ' + valueOrTbc(r.lot || r.lotNumber), 'Registration: ' + valueOrTbc(r.registration)].join('\n');
}
function copyPayload(record) {
  const r = normalizeRecord(record);
  return {
    all: copyAllDetails(r),
    short: copyShortSummary(r),
    emailText: copyAllDetails(r),
    emailHtml: '<h2>' + escHtml(r.title) + '</h2><p><b>' + escHtml(r.price || r.packagePrice || r.landPrice || 'Price TBC') + '</b></p><ul><li>' + escHtml([r.bedrooms && r.bedrooms + ' bed', r.bathrooms && r.bathrooms + ' bath', r.garage && r.garage + ' garage'].filter(Boolean).join(' | ')) + '</li><li>' + escHtml([r.landSize && r.landSize + ' land', r.houseSize && r.houseSize + ' house'].filter(Boolean).join(' | ')) + '</li></ul><p>' + escHtml(r.description || '') + '</p><p>Subject to availability and final builder and land confirmation.</p>',
    spreadsheet: spreadsheetRow(r).join('\t'),
    description: r.description || '',
    priceFacts: copyPriceFacts(r),
    location: copyLocation(r),
    inclusions: r.inclusions.map(x => '- ' + x).join('\n')
  };
}

function crc32(buffer) {
  let c = ~0;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  return (~c) >>> 0;
}
function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}
function createZip(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, '/'));
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ''), 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const dt = dosDateTime();
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(dt.time, 10); local.writeUInt16LE(dt.date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    chunks.push(local, compressed);
    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(dt.time, 12); header.writeUInt16LE(dt.date, 14); header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42); name.copy(header, 46);
    central.push(header);
    offset += local.length + compressed.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
function imageBufferFromUrl(url) {
  const match = String(url || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}
function imageExtension(mime, fallback = 'jpg') {
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  if (/pdf/i.test(mime)) return 'pdf';
  return fallback;
}
function fileBase(record) {
  const r = normalizeRecord(record);
  return normaliseKey([r.estate || r.project || 'property', r.lot || r.lotNumber || r.suburb || r.id].filter(Boolean).join('-')) || 'property';
}
async function propertyZip(record, selectedIds = []) {
  const r = normalizeRecord(record);
  const allowed = selectedIds.length ? r.images.filter(i => selectedIds.includes(i.id)) : r.images.filter(i => !i.hidden);
  const files = [
    { name: 'property-summary.txt', data: copyAllDetails(r) },
    { name: 'property-summary.html', data: copyPayload(r).emailHtml }
  ];
  for (const [index, img] of allowed.entries()) {
    const data = imageBufferFromUrl(img.fullUrl || img.url || img.dataUri);
    if (!data) continue;
    const ext = imageExtension(data.mime);
    files.push({ name: fileBase(r) + '-' + normaliseKey(img.category || img.label || 'image-' + index) + '.' + ext, data: data.buffer });
  }
  return createZip(files);
}

function gmailConfigured() { return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN); }
function gmailAuthStatus() {
  return { configured: gmailConfigured(), clientIdConfigured: Boolean(process.env.GMAIL_CLIENT_ID), clientSecretConfigured: Boolean(process.env.GMAIL_CLIENT_SECRET), refreshTokenConfigured: Boolean(process.env.GMAIL_REFRESH_TOKEN), redirectUri: GMAIL_REDIRECT_URI, scope: GMAIL_SCOPE };
}
function adminGmailPage(details = {}) {
  const status = gmailAuthStatus();
  const rows = [['Google Client ID', status.clientIdConfigured], ['Google Client Secret', status.clientSecretConfigured], ['Gmail Refresh Token', status.refreshTokenConfigured]].map(([label, ok]) => '<div class="row"><span>' + label + '</span><b class="' + (ok ? 'ok' : 'missing') + '">' + (ok ? 'Present' : 'Missing') + '</b></div>').join('');
  const tokenPanel = details.refreshToken ? '<section class="panel important"><h2>Copy this into Railway</h2><p>Add a Railway variable named <b>GMAIL_REFRESH_TOKEN</b>.</p><textarea readonly onclick="this.select()">' + escHtml(details.refreshToken) + '</textarea></section>' : '';
  const errorPanel = details.error ? '<section class="panel error"><h2>Google did not complete the connection</h2><p>' + escHtml(details.error) + '</p></section>' : '';
  const connectButton = status.clientIdConfigured && status.clientSecretConfigured ? '<a class="btn" href="/auth/gmail/start">Connect Gmail</a>' : '<button class="btn disabled" disabled>Add Google Client ID and Secret first</button>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gmail Authentication</title><style>' + baseCss() + '.panel{background:white;border:1px solid var(--line);border-radius:8px;padding:18px}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)}.ok{color:#0f766e}.missing{color:#a45c16}textarea{width:100%;min-height:120px}</style></head><body><header><h1>Gmail Authentication</h1><p>Connect Gmail using read-only OAuth. Tokens stay in Railway Variables.</p></header><main>' + errorPanel + tokenPanel + '<section class="panel"><h2>Current Status</h2>' + rows + '<p>Redirect URI: <code>' + escHtml(status.redirectUri) + '</code></p><div class="actions">' + connectButton + '<a class="btn ghost" href="/">Dashboard</a></div></section></main></body></html>';
}
function gmailAuthStart(res) {
  if (!process.env.GMAIL_CLIENT_ID) return html(res, adminGmailPage({ error: 'GMAIL_CLIENT_ID is missing in Railway Variables.' }));
  const state = crypto.randomBytes(18).toString('base64url');
  const params = new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID, redirect_uri: GMAIL_REDIRECT_URI, response_type: 'code', scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  res.writeHead(302, { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), 'cache-control': 'no-store' });
  res.end();
}
async function gmailAuthCallback(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('error')) return html(res, adminGmailPage({ error: url.searchParams.get('error_description') || url.searchParams.get('error') }));
  const code = url.searchParams.get('code');
  if (!code) return html(res, adminGmailPage({ error: 'Google callback did not include an authorization code.' }));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, code, redirect_uri: GMAIL_REDIRECT_URI, grant_type: 'authorization_code' }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return html(res, adminGmailPage({ error: payload.error_description || payload.error || 'Google token exchange failed.' }));
  if (!payload.refresh_token) return html(res, adminGmailPage({ error: 'Google returned no refresh token. Reconnect with consent prompt or remove the old app permission and retry.' }));
  return html(res, adminGmailPage({ refreshToken: payload.refresh_token }));
}

function baseCss() {
  return ':root{--ink:#162431;--muted:#667681;--line:#d7e0e5;--paper:#f4f7f8;--blue:#083B66;--gold:#F2C94C;--green:#0f766e}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:26px clamp(16px,4vw,48px);background:#112A3A;color:white}h1{margin:0 0 8px;font-size:clamp(30px,5vw,52px)}main{padding:20px clamp(16px,4vw,48px);display:grid;gap:18px}.btn,button{border:0;border-radius:8px;background:var(--blue);color:white;font-weight:850;padding:9px 11px;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.ghost{background:#eaf1f5;color:#083B66}.danger{background:#8f2d2d}.okbtn{background:#0f766e}.warn{background:#9b6a00}.actions{display:flex;gap:8px;flex-wrap:wrap}.muted{color:var(--muted)}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font:inherit;background:white}label{display:grid;gap:5px;font-size:12px;font-weight:850;color:#354752}table{width:100%;border-collapse:collapse;background:white;border:1px solid var(--line)}th,td{padding:9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13px}.pill{display:inline-flex;border-radius:999px;padding:4px 8px;font-weight:850;background:#eaf1f5;color:#083B66;font-size:12px}.grid{display:grid;gap:14px}.panel{background:white;border:1px solid var(--line);border-radius:8px;padding:14px}';
}
function appPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEQ Property Watch</title><style>' + baseCss() + '.toolbar{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}.card{background:white;border:1px solid var(--line);border-radius:8px;overflow:hidden}.visual{height:150px;background:#dfe9ee center/cover}.content{padding:13px;display:grid;gap:8px}.price{font-size:21px;font-weight:950;color:var(--blue)}.copy-menu{display:none;border-top:1px solid var(--line);padding-top:8px;gap:6px;flex-wrap:wrap}.card.open .copy-menu{display:flex}@media(max-width:850px){.toolbar{grid-template-columns:1fr}.cards{grid-template-columns:1fr}}</style></head><body><header><h1>SEQ Property Watch</h1><p>Email extraction -> Review and Copy -> Google Sheets.</p><div class="actions"><a class="btn" href="/review">Property Review Queue</a><button onclick="syncNow()">Sync Gmail Now</button><a class="btn ghost" href="/admin/email-imports">Email Imports</a><a class="btn ghost" href="/admin/gmail">Gmail Auth</a></div></header><main><section class="toolbar"><label>View<select id="status"><option value="">All statuses</option>' + REVIEW_STATUSES.map(s => '<option>' + s + '</option>').join('') + '</select></label><label>Type<select id="kind"><option value="">All types</option><option>Land</option><option>House & Land</option><option>Townhouse</option></select></label><label>Area<select id="area"><option value="">All areas</option><option>Sunshine Coast</option><option>Moreton Bay</option><option>Brisbane</option><option>Gold Coast</option></select></label><label>Source<select id="origin"><option value="">All sources</option><option>Email</option><option>Public land</option></select></label><label>Search<input id="q" placeholder="Suburb, estate, lot, price"></label></section><section class="cards" id="cards"></section></main>' + clientScript('dashboard') + '</body></html>';
}
function reviewQueuePage() {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Property Review Queue</title><style>' + baseCss() + '.queue-actions{display:flex;gap:6px;flex-wrap:wrap}.quick{min-width:110px}</style></head><body><header><h1>Property Review Queue</h1><p>Draft and review records stay here until approved for Google Sheets.</p><div class="actions"><a class="btn ghost" href="/">Dashboard</a><button onclick="bulkApprove()">Bulk approve</button><button onclick="bulkSync()">Bulk sync</button></div></header><main><section class="panel"><div class="actions"><label>Status<select id="status"><option value="">All statuses</option>' + REVIEW_STATUSES.map(s => '<option>' + s + '</option>').join('') + '</select></label><label>Search<input id="q" placeholder="Project, suburb, lot"></label></div></section><table><thead><tr><th><input type="checkbox" id="all"></th><th>Status</th><th>Property</th><th>Price</th><th>Missing</th><th>Quick Edit</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></main>' + clientScript('queue') + '</body></html>';
}
function reviewPage(id) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review Property</title><style>' + baseCss() + '.layout{grid-template-columns:minmax(320px,1.15fr) minmax(300px,.85fr);display:grid;gap:16px}.formgrid{display:grid;grid-template-columns:repeat(2,minmax(160px,1fr));gap:10px}.full{grid-column:1/-1}.copybar{position:sticky;top:0;z-index:2;background:white;border:1px solid var(--line);border-radius:8px;padding:10px}.imagegrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.imagecard{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:white}.imagecard img{width:100%;height:120px;object-fit:cover}.imagecard .pad{padding:8px;display:grid;gap:6px}.missing{color:#9b4b00}.confident{color:#0f766e}.confirm{color:#8f2d2d}.custom-panel{display:none}.custom-panel.open{display:block}@media(max-width:950px){.layout{grid-template-columns:1fr}.formgrid{grid-template-columns:1fr}}</style></head><body><header><h1>Property Review</h1><p>Edit the record, copy what you need, then approve it for Sheets when ready.</p><div class="actions"><a class="btn ghost" href="/review">Review Queue</a><a class="btn ghost" href="/">Dashboard</a></div></header><main><section class="copybar"><div class="actions"><button onclick="copyKind(\'all\')">Copy All Details</button><button onclick="copyKind(\'short\')">Copy Short Summary</button><button onclick="copyEmail()">Copy Email Version</button><button onclick="copyKind(\'spreadsheet\')">Copy Spreadsheet Row</button><button onclick="copyKind(\'description\')">Copy Description</button><button onclick="copyKind(\'priceFacts\')">Copy Price and Facts</button><button onclick="copyKind(\'location\')">Copy Location</button><button onclick="copyKind(\'inclusions\')">Copy Inclusions</button><button onclick="toggleCustom()">Custom Copy</button></div><div id="copyMsg" class="muted"></div><div id="customPanel" class="panel custom-panel"></div></section><section class="layout"><form id="form" class="panel"><h2 id="title">Loading...</h2><div id="fieldState"></div><div class="formgrid" id="fields"></div><div class="actions"><button type="button" onclick="saveDraft()">Save Draft</button><button type="button" class="okbtn" onclick="approveSync()">Approve and Sync</button><button type="button" class="okbtn" onclick="setStatus(\'Approved for Sheets\')">Approve Without Sync</button><button type="button" class="warn" onclick="setStatus(\'Requires Review\')">Send to Requires Review</button><button type="button" class="danger" onclick="setStatus(\'Rejected\')">Reject Record</button></div><div id="syncResult" class="muted"></div></form><aside class="grid"><section class="panel"><h2>Source</h2><div id="source"></div></section><section class="panel"><h2>Images and Documents</h2><div class="actions"><button onclick="downloadSelected()">Download Selected Images</button><button onclick="downloadAll()">Download All Images</button><button onclick="copySelectedLinks()">Copy Selected Image Links</button><button onclick="downloadPack()">Download Property Pack</button></div><div id="images" class="imagegrid"></div></section><section class="panel"><h2>Copy Templates</h2><div id="templates"></div></section></aside></section></main><script>window.PROPERTY_ID=' + JSON.stringify(id) + ';</script>' + clientScript('review') + '</body></html>';
}

function clientScript(mode) {
  return `<script>
const FIELDS = [
 ['kind','Property type'],['project','Project'],['estate','Estate'],['suburb','Suburb'],['location','Location'],['region','Region'],['stage','Stage'],['lot','Lot number'],['price','Price'],['landSize','Land size'],['houseSize','House size'],['bedrooms','Bedrooms'],['bathrooms','Bathrooms'],['garage','Garage spaces'],['storeys','Storeys'],['builder','Builder'],['developer','Developer'],['houseDesign','House design'],['registration','Registration date'],['deposit','Deposit'],['inclusions','Key inclusions'],['description','Property description'],['internalNotes','Internal notes']
];
let records=[], record=null, templates=[], copyData=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
async function api(url, opts={}){const r=await fetch(url,{headers:{'content-type':'application/json'},...opts});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
async function copyText(text, html){try{if(html&&navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);}else await navigator.clipboard.writeText(text);msg('Copied');}catch(e){prompt('Copy this',text);msg('Clipboard fallback used')}}
function msg(t){let n=$('copyMsg');if(n)n.textContent=t;else alert(t)}
async function syncNow(){let r=await api('/api/sync/gmail?force=1',{method:'POST'});alert('Scanned: '+(r.scanned||0)+' New draft records: '+(r.created||0)+' Updated: '+(r.updated||0));location.reload()}
function validate(r){let m=[];let hasLoc=!!(r.suburb||r.location||r.region||r.area), hasPrice=!!(r.price||r.packagePrice||r.landPrice); if(r.kind==='Land'){if(!hasLoc)m.push('Suburb/location'); if(!hasPrice)m.push('Price'); if(!r.landSize&&!r.lot)m.push('Land size or lot');} else if(r.kind==='House & Land'){if(!hasLoc)m.push('Location'); if(!hasPrice)m.push('Package price'); if(!r.bedrooms)m.push('Bedrooms'); if(!r.houseSize&&!r.landSize)m.push('House or land size');} else {if(!hasLoc)m.push('Location'); if(!hasPrice)m.push('Price'); if(!r.bedrooms)m.push('Bedrooms'); if(!r.kind)m.push('Property type');} return m}
function cardMenu(r){return '<div class="copy-menu"><button data-copy="short" data-id="'+r.id+'">Copy Short Summary</button><button data-copy="all" data-id="'+r.id+'">Copy All Details</button><button data-copy="spreadsheet" data-id="'+r.id+'">Copy Spreadsheet Row</button><button data-copy="mainImage" data-id="'+r.id+'">Copy Main Image</button><a class="btn ghost" href="/review/'+encodeURIComponent(r.id)+'">Open Review</a><button data-approve="'+r.id+'">Approve for Sheets</button></div>'}
async function loadDashboard(){records=(await api('/api/records')).records||[];renderDashboard()}
function renderDashboard(){let s=$('status').value,k=$('kind').value,a=$('area').value,o=$('origin').value,q=($('q').value||'').toLowerCase();let rows=records.filter(r=>(!s||r.reviewStatus===s)&&(!k||r.kind===k)&&(!a||r.area===a||r.region===a)&&(!o||r.origin===o)&&(!q||Object.values(r).join(' ').toLowerCase().includes(q)));$('cards').innerHTML=rows.map(r=>'<article class="card"><div class="visual" style="'+(r.image?'background-image:url('+r.image+')':'')+'"></div><div class="content"><span class="pill">'+esc(r.reviewStatus||'Draft')+'</span><h3>'+esc(r.title)+'</h3><div class="price">'+esc(r.price||r.packagePrice||r.landPrice||'Price TBC')+'</div><div>'+esc([r.suburb,r.estate,r.stage&&'Stage '+r.stage,r.lot&&'Lot '+r.lot].filter(Boolean).join(' | '))+'</div><div class="actions"><button data-menu>Copy menu</button><a class="btn ghost" href="/review/'+encodeURIComponent(r.id)+'">Review</a></div>'+cardMenu(r)+'</div></article>').join('')}
async function loadQueue(){records=(await api('/api/records')).records||[];renderQueue()}
function renderQueue(){let s=$('status').value,q=($('q').value||'').toLowerCase();let rows=records.filter(r=>(!s||r.reviewStatus===s)&&(!q||Object.values(r).join(' ').toLowerCase().includes(q)));$('rows').innerHTML=rows.map(r=>{let m=validate(r);return '<tr><td><input type="checkbox" class="sel" value="'+r.id+'"></td><td><span class="pill">'+esc(r.reviewStatus)+'</span></td><td><b>'+esc(r.title)+'</b><br>'+esc([r.kind,r.suburb,r.estate,r.lot&&'Lot '+r.lot].filter(Boolean).join(' | '))+'</td><td>'+esc(r.price||'')+'</td><td>'+(m.length?'<span class="missing">'+esc(m.join(', '))+'</span>':'OK')+'</td><td><input class="quick" data-field="price" data-id="'+r.id+'" value="'+esc(r.price||'')+'"></td><td class="queue-actions"><a class="btn ghost" href="/review/'+encodeURIComponent(r.id)+'">Open</a><button data-copy="short" data-id="'+r.id+'">Copy summary</button><button data-approve="'+r.id+'" '+(m.length?'disabled':'')+'>Approve</button><button data-reject="'+r.id+'">Reject</button></td></tr>'}).join('')}
async function loadReview(){record=(await api('/api/properties/'+encodeURIComponent(PROPERTY_ID))).record;templates=(await api('/api/templates')).templates||[];copyData=(await api('/api/properties/'+encodeURIComponent(PROPERTY_ID)+'/copy')).copy;$('title').textContent=record.title;$('fields').innerHTML=FIELDS.map(([k,l])=>'<label class="'+(k==='description'||k==='internalNotes'||k==='inclusions'?'full':'')+'">'+l+(k==='description'||k==='internalNotes'||k==='inclusions'?'<textarea name="'+k+'" rows="4">'+esc(Array.isArray(record[k])?record[k].join('\\n'):record[k]||'')+'</textarea>':'<input name="'+k+'" value="'+esc(record[k]||'')+'">')+'</label>').join('')+'<label>Status<select name="reviewStatus">${REVIEW_STATUSES.map(s=>'<option>'+s+'</option>').join('')}</select></label>';document.querySelector('[name=reviewStatus]').value=record.reviewStatus||'Draft';renderFieldState();renderSource();renderImages();renderTemplates();renderCustom()}
function formRecord(){let data={...record};new FormData($('form')).forEach((v,k)=>{data[k]=k==='inclusions'?String(v).split(/\\n|;/).map(x=>x.trim()).filter(Boolean):v});return data}
function renderFieldState(){let miss=validate(record);let uncertain=Object.entries(record.fieldReview||{}).filter(([k,v])=>v==='confirm').map(([k])=>k);$('fieldState').innerHTML='<p><b>Confident information:</b> '+Object.entries(record.fieldReview||{}).filter(([k,v])=>v==='confident').map(([k])=>k).join(', ')+'</p><p class="missing"><b>Missing:</b> '+(miss.join(', ')||'None')+'</p><p class="confirm"><b>Requires confirmation:</b> '+(uncertain.join(', ')||'None')+'</p>'}
function renderSource(){ $('source').innerHTML=[record.sourceEmail?'<p><a class="btn ghost" target="_blank" href="'+esc(record.sourceEmail)+'">Open source email</a></p>':'',record.sourceAttachment?'<p>Attachment: '+esc(record.sourceAttachment)+'</p>':'',record.url?'<p><a target="_blank" href="'+esc(record.url)+'">Open source listing</a></p>':''].join('') }
function renderImages(){let imgs=(record.images||[]).filter(i=>!i.hidden);$('images').innerHTML=imgs.map(i=>'<div class="imagecard"><img src="'+esc(i.url||i.fullUrl)+'"><div class="pad"><label><input type="checkbox" class="imgsel" value="'+i.id+'"> Select</label><b>'+esc(i.label||i.category)+'</b><span class="pill">'+esc(i.category||'Image')+(i.main?' - Main':'')+'</span><button data-copy-image="'+i.id+'">Copy Image</button><button data-download-image="'+i.id+'">Download Image</button><button data-copy-link="'+i.id+'">Copy Image Link</button><button data-main-image="'+i.id+'">Mark as Main Image</button><button data-hide-image="'+i.id+'">Hide Image</button><a class="btn ghost" target="_blank" href="'+esc(i.fullUrl||i.url)+'">Open Full Size</a></div></div>').join('')||'<p class="muted">No stored useful images yet.</p>'}
function renderTemplates(){$('templates').innerHTML=templates.map(t=>'<details><summary>'+esc(t.name)+'</summary><textarea data-template="'+t.id+'" rows="7">'+esc(t.body)+'</textarea><div class="actions"><button data-copy-template="'+t.id+'">Copy Rendered</button><button data-save-template="'+t.id+'">Save Template</button></div></details>').join('')}
function renderCustom(){let saved=JSON.parse(localStorage.getItem('seqCustomCopy')||'null')||['price','location','lot','bedrooms','bathrooms','garage','houseSize','landSize','registration','builder','houseDesign','inclusions','description','disclaimer','propertyLink'];let opts=['price','location','lot','bedrooms','bathrooms','garage','houseSize','landSize','registration','builder','houseDesign','inclusions','description','disclaimer','propertyLink'];$('customPanel').innerHTML='<h3>Custom Copy</h3><div class="formgrid">'+opts.map(o=>'<label><input type="checkbox" data-custom="'+o+'" '+(saved.includes(o)?'checked':'')+'> '+o+'</label>').join('')+'</div><div class="actions"><button onclick="copyCustom(\\'text\\')">Copy as plain text</button><button onclick="copyCustom(\\'email\\')">Copy as formatted email</button><button onclick="copyCustom(\\'spreadsheet\\')">Copy as spreadsheet row</button></div>'}
function selectedCustom(){let s=[...document.querySelectorAll('[data-custom]:checked')].map(x=>x.dataset.custom);localStorage.setItem('seqCustomCopy',JSON.stringify(s));return s}
function customText(){let r=formRecord(), s=selectedCustom(), lines=[]; if(s.includes('price'))lines.push(r.price); if(s.includes('location'))lines.push([r.project,r.estate,r.suburb,r.region].filter(Boolean).join(', ')); if(s.includes('lot'))lines.push('Lot: '+(r.lot||'')); if(s.includes('bedrooms'))lines.push(r.bedrooms+' bedrooms'); if(s.includes('bathrooms'))lines.push(r.bathrooms+' bathrooms'); if(s.includes('garage'))lines.push(r.garage+' garage'); if(s.includes('houseSize'))lines.push(r.houseSize+' house'); if(s.includes('landSize'))lines.push(r.landSize+' land'); if(s.includes('registration'))lines.push('Registration: '+r.registration); if(s.includes('builder'))lines.push('Builder: '+r.builder); if(s.includes('houseDesign'))lines.push('Design: '+r.houseDesign); if(s.includes('inclusions'))lines.push((Array.isArray(r.inclusions)?r.inclusions:String(r.inclusions||'').split('\\n')).map(x=>'- '+x).join('\\n')); if(s.includes('description'))lines.push(r.description); if(s.includes('disclaimer'))lines.push('Subject to availability and final confirmation.'); if(s.includes('propertyLink'))lines.push(location.href); return lines.filter(Boolean).join('\\n')}
async function saveDraft(){record=(await api('/api/properties/'+encodeURIComponent(record.id),{method:'PUT',body:JSON.stringify(formRecord())})).record;msg('Draft saved')}
async function setStatus(status){let next=formRecord();next.reviewStatus=status;record=(await api('/api/properties/'+encodeURIComponent(record.id),{method:'PUT',body:JSON.stringify(next)})).record;document.querySelector('[name=reviewStatus]').value=status;msg('Status set to '+status)}
async function approveSync(){let next=formRecord();let r=await api('/api/properties/'+encodeURIComponent(record.id)+'/approve-sync',{method:'POST',body:JSON.stringify(next)});record=r.record;$('syncResult').innerHTML=r.sync.ok?'Synced to: '+r.sync.tab+' Row '+(r.sync.row||'confirmed')+' '+new Date(r.sync.syncedAt).toLocaleString()+(r.sync.url?' <a target="_blank" href="'+r.sync.url+'">View in Google Sheets</a>':''):'Approved but not synced: '+r.sync.message;msg('Approval processed')}
async function copyKind(kind,targetId=''){let id=targetId||(record&&record.id);if(!id)return;if(!copyData||targetId){copyData=(await api('/api/properties/'+encodeURIComponent(id)+'/copy')).copy} await copyText(copyData[kind]||'')}
async function copyEmail(){await copyText(copyData.emailText,copyData.emailHtml)}
function toggleCustom(){ $('customPanel').classList.toggle('open') }
async function copyCustom(mode){let text=mode==='spreadsheet'?copyData.spreadsheet:customText();let html='<div>'+esc(text).replace(/\\n/g,'<br>')+'</div>';await copyText(text,mode==='email'?html:null)}
async function imageById(id){return (record.images||[]).find(i=>i.id===id)}
async function copyImage(id){let img=await imageById(id);try{let res=await fetch(img.fullUrl||img.url);let blob=await res.blob();await navigator.clipboard.write([new ClipboardItem({[blob.type]:blob})]);msg('Image copied')}catch(e){alert('Your browser cannot copy this image directly. Use Download Image instead.')}}
function downloadUrl(url,name){let a=document.createElement('a');a.href=url;a.download=name||'image';a.click()}
async function downloadImage(id){let img=await imageById(id);downloadUrl(img.fullUrl||img.url,img.label||'property-image')}
async function mutateImages(action,id){record=(await api('/api/properties/'+encodeURIComponent(record.id)+'/images',{method:'POST',body:JSON.stringify({action,id})})).record;renderImages()}
function selectedImages(){return [...document.querySelectorAll('.imgsel:checked')].map(x=>x.value)}
function downloadSelected(){location.href='/api/properties/'+encodeURIComponent(record.id)+'/pack.zip?images='+encodeURIComponent(selectedImages().join(','))}
function downloadAll(){location.href='/api/properties/'+encodeURIComponent(record.id)+'/pack.zip'}
function downloadPack(){location.href='/api/properties/'+encodeURIComponent(record.id)+'/pack.zip?images='+encodeURIComponent(selectedImages().join(','))}
async function copySelectedLinks(){let ids=selectedImages();let links=(record.images||[]).filter(i=>ids.includes(i.id)).map(i=>i.fullUrl||i.url).join('\\n');await copyText(links)}
async function bulkApprove(){let ids=[...document.querySelectorAll('.sel:checked')].map(x=>x.value);for(let id of ids)await api('/api/properties/'+id+'/status',{method:'POST',body:JSON.stringify({status:'Approved for Sheets'})});loadQueue()}
async function bulkSync(){let ids=[...document.querySelectorAll('.sel:checked')].map(x=>x.value);for(let id of ids)await api('/api/properties/'+id+'/sync-sheets',{method:'POST'});loadQueue()}
document.addEventListener('click',async e=>{let t=e.target;if(t.matches('[data-menu]'))t.closest('.card').classList.toggle('open'); if(t.dataset.copy)copyKind(t.dataset.copy,t.dataset.id||''); if(t.dataset.approve){await api('/api/properties/'+t.dataset.approve+'/status',{method:'POST',body:JSON.stringify({status:'Approved for Sheets'})}); if(typeof loadQueue==='function')loadQueue(); else loadDashboard()} if(t.dataset.reject){await api('/api/properties/'+t.dataset.reject+'/status',{method:'POST',body:JSON.stringify({status:'Rejected'})});loadQueue()} if(t.dataset.copyImage)copyImage(t.dataset.copyImage); if(t.dataset.downloadImage)downloadImage(t.dataset.downloadImage); if(t.dataset.copyLink){let i=await imageById(t.dataset.copyLink);copyText(i.fullUrl||i.url)} if(t.dataset.mainImage)mutateImages('main',t.dataset.mainImage); if(t.dataset.hideImage)mutateImages('hide',t.dataset.hideImage); if(t.dataset.copyTemplate){let template=templates.find(x=>x.id===t.dataset.copyTemplate);let r=await api('/api/templates/render',{method:'POST',body:JSON.stringify({template:template.body,record:formRecord()})});copyText(r.text)} if(t.dataset.saveTemplate){let ta=document.querySelector('[data-template="'+t.dataset.saveTemplate+'"]');await api('/api/templates/'+t.dataset.saveTemplate,{method:'PUT',body:JSON.stringify({name:templates.find(x=>x.id===t.dataset.saveTemplate).name,body:ta.value})});msg('Template saved')}})
document.addEventListener('input',e=>{if(e.target.classList.contains('quick')){let r=records.find(x=>x.id===e.target.dataset.id);if(r){r[e.target.dataset.field]=e.target.value;api('/api/properties/'+r.id,{method:'PUT',body:JSON.stringify(r)}).catch(console.error)}}});
if('${mode}'==='dashboard'){loadDashboard();['status','kind','area','origin','q'].forEach(id=>$(id).addEventListener('input',renderDashboard))}
if('${mode}'==='queue'){loadQueue();['status','q'].forEach(id=>$(id).addEventListener('input',renderQueue));$('all').addEventListener('change',e=>document.querySelectorAll('.sel').forEach(x=>x.checked=e.target.checked))}
if('${mode}'==='review')loadReview();
</script>`;
}

function adminEmailPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Import Activity</title><style>${baseCss()}</style></head><body><header><h1>Email Import Activity</h1><p>Processed Gmail messages and draft review extraction activity.</p><div class="actions"><a class="btn ghost" href="/">Dashboard</a><button onclick="syncNow()">Sync Gmail Now</button></div></header><main><table><thead><tr><th>Received</th><th>Sender</th><th>Subject</th><th>Status</th><th>Created</th><th>Updated</th><th>Reason</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></main><script>
async function syncNow(){let r=await fetch("/api/sync/gmail?force=1",{method:"POST"}).then(x=>x.json());alert("Scanned: "+(r.scanned||0)+" Created: "+(r.created||0)+" Updated: "+(r.updated||0));load()}
async function reprocess(id){let r=await fetch("/api/email-imports/"+encodeURIComponent(id)+"/reprocess",{method:"POST"}).then(x=>x.json());alert(JSON.stringify(r));load()}
function cell(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
async function load(){let d=await fetch("/api/email-imports").then(x=>x.json());rows.innerHTML=d.rows.map(r=>"<tr><td>"+cell((r.received_at||"").slice(0,10))+"</td><td>"+cell(r.sender)+"</td><td>"+cell(r.subject)+"</td><td>"+cell(r.status)+"</td><td>"+cell(r.properties_created)+"</td><td>"+cell(r.properties_updated)+"</td><td>"+cell(r.skip_reason||r.error_reason||r.result)+"</td><td><button data-reprocess='"+cell(r.gmail_message_id)+"'>Reprocess</button> <a class='btn' target='_blank' href='https://mail.google.com/mail/u/0/#all/"+encodeURIComponent(r.gmail_message_id)+"'>Gmail</a></td></tr>").join("")}
document.addEventListener("click",e=>{if(e.target.dataset.reprocess)reprocess(e.target.dataset.reprocess)})
load()
</script></body></html>`;
}
async function listEmailImports() {
  const db = await getDb();
  if (!db) return [];
  const r = await db.query('select * from email_imports order by processed_at desc limit 200');
  return r.rows;
}
async function dashboardMetrics() {
  const records = await allRecords();
  const last = await metaGet('gmail.last_successful_sync');
  return { lastSync: last, total: records.length, draft: records.filter(r => r.reviewStatus === 'Draft').length, requiresReview: records.filter(r => r.reviewStatus === 'Requires Review').length, approved: records.filter(r => r.reviewStatus === 'Approved for Sheets').length, synced: records.filter(r => r.reviewStatus === 'Synced to Sheets').length };
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'seq-property-watch', timestamp: new Date().toISOString(), checks: { app: true, databaseConfigured: Boolean(process.env.DATABASE_URL), gmailConfigured: gmailConfigured(), sheetsConfigured: Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL) }, metrics: await dashboardMetrics() });
    if (url.pathname === '/api/dashboard') return json(res, 200, { ok: true, metrics: await dashboardMetrics() });
    if (url.pathname === '/api/gmail/auth-status') return json(res, 200, { ok: true, gmail: gmailAuthStatus() });
    if (url.pathname === '/admin/gmail') return html(res, adminGmailPage());
    if (url.pathname === '/auth/gmail/start') return gmailAuthStart(res);
    if (url.pathname === '/auth/gmail/callback') return gmailAuthCallback(req, res);
    if (url.pathname === '/admin/email-imports') return html(res, adminEmailPage());
    if (url.pathname === '/api/email-imports') return json(res, 200, { ok: true, rows: await listEmailImports() });
    if (url.pathname === '/api/sync/gmail') return json(res, 200, await syncGmailDetailed({ forceBackfill: url.searchParams.get('force') === '1' }));
    if (url.pathname.startsWith('/api/email-imports/') && url.pathname.endsWith('/reprocess')) return json(res, 200, await syncGmailDetailed({ reprocessMessageId: decodeURIComponent(url.pathname.split('/')[3]) }));
    if (url.pathname === '/api/records') return json(res, 200, { ok: true, records: await allRecords() });
    if (url.pathname === '/api/opportunities') return json(res, 200, { ok: true, records: opportunityRows(await allRecords()) });
    if (url.pathname === '/api/templates') return json(res, 200, { ok: true, templates: await listTemplates() });
    if (url.pathname === '/api/templates/render') { const payload = await bodyJson(req); return json(res, 200, { ok: true, text: renderTemplate(payload.template, payload.record) }); }
    if (url.pathname.startsWith('/api/templates/') && req.method === 'PUT') return json(res, 200, { ok: true, template: await saveTemplate(decodeURIComponent(url.pathname.split('/')[3]), await bodyJson(req)) });
    if (url.pathname === '/api/check') { if (CHECK_SECRET && url.searchParams.get('secret') !== CHECK_SECRET && req.headers['x-check-secret'] !== CHECK_SECRET) return json(res, 401, { ok: false, error: 'Missing or invalid check secret' }); return json(res, 200, await runCheck()); }
    const propMatch = url.pathname.match(/^\/api\/properties\/([^/]+)(?:\/([^/]+))?$/);
    if (propMatch) {
      const id = decodeURIComponent(propMatch[1]), action = propMatch[2] || '';
      const record = await propertyById(id);
      if (!record && req.method !== 'PUT') return json(res, 404, { ok: false, error: 'Property not found' });
      if (!action && req.method === 'GET') return json(res, 200, { ok: true, record, validation: validationFor(record) });
      if (!action && req.method === 'PUT') return json(res, 200, { ok: true, record: await saveRecord({ ...(record || {}), ...(await bodyJson(req)), id }) });
      if (action === 'copy') return json(res, 200, { ok: true, copy: copyPayload(record) });
      if (action === 'status') { const payload = await bodyJson(req); const saved = await saveRecord({ ...record, reviewStatus: normalizeStatus(payload.status, record.reviewStatus), status: normalizeStatus(payload.status, record.reviewStatus) }); return json(res, 200, { ok: true, record: saved, validation: validationFor(saved) }); }
      if (action === 'approve-sync') { const payload = await bodyJson(req); const draft = await saveRecord({ ...record, ...payload, reviewStatus: 'Approved for Sheets', status: 'Approved for Sheets' }); const validation = validationFor(draft); if (!validation.ok) return json(res, 422, { ok: false, error: 'Required fields missing', validation }); const sync = await syncToSheets(draft); const final = sync.ok ? await saveRecord({ ...draft, reviewStatus: 'Synced to Sheets', status: 'Synced to Sheets', sheetSync: sync }) : draft; return json(res, 200, { ok: true, record: final, validation, sync }); }
      if (action === 'sync-sheets') { const validation = validationFor(record); if (!validation.ok) return json(res, 422, { ok: false, error: 'Required fields missing', validation }); const sync = await syncToSheets(record); const final = sync.ok ? await saveRecord({ ...record, reviewStatus: 'Synced to Sheets', status: 'Synced to Sheets', sheetSync: sync }) : record; return json(res, 200, { ok: true, record: final, sync }); }
      if (action === 'images') { const payload = await bodyJson(req); let images = [...(record.images || [])]; if (payload.action === 'main') images = images.map(i => ({ ...i, main: i.id === payload.id })); if (payload.action === 'hide') images = images.map(i => i.id === payload.id ? { ...i, hidden: true } : i); const main = images.find(i => i.main && !i.hidden); return json(res, 200, { ok: true, record: await saveRecord({ ...record, images, image: main?.url || record.image }) }); }
      if (action === 'pack.zip') { const images = (url.searchParams.get('images') || '').split(',').filter(Boolean); return sendBuffer(res, 200, await propertyZip(record, images), 'application/zip', fileBase(record) + '-property-pack.zip'); }
    }
    if (url.pathname === '/review') return html(res, reviewQueuePage());
    if (url.pathname.startsWith('/review/')) return html(res, reviewPage(decodeURIComponent(url.pathname.split('/')[2] || '')));
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.endsWith('/seq-property-email-watch.html')) return html(res, appPage());
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: error.message });
  }
}

const server = http.createServer((req, res) => { handle(req, res); });
server.listen(PORT, '0.0.0.0', () => console.log('SEQ Property Watch listening on port ' + PORT));
if (AUTO_CHECK_ENABLED) {
  setTimeout(() => runCheck().catch(error => console.error('Initial check failed', error)), 10000);
  setInterval(() => runCheck().catch(error => console.error('Scheduled check failed', error)), CHECK_INTERVAL_MINUTES * 60 * 1000);
}
