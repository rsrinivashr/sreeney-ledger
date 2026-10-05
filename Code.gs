/**
 * Sreeney Ledger — Email reader
 * Runs inside YOUR Google account. Reads only bank / CRED emails,
 * picks out bills, payments, card swipes and insurance premiums,
 * and sends them to your ledger, which updates itself.
 *
 * Setup: paste your sync code below, then run  setup  once.
 */
const SYNC_CODE = 'oGdxwAXEs2cDPD8KWEfSkkEKnLx1';   // your sync code (already filled in)
const PROJECT   = 'sreeney-ledger';

const SENDERS = 'from:amazonpay.in OR from:wise.com OR from:idfcfirstbank.com OR from:tatacapital.com OR from:poonawallafincorp.com OR from:cred.club OR from:hdfcbank.bank.in OR from:hdfcbank.net OR from:indusind.com OR from:sbicard.com OR from:bobcard.in OR from:icicibank.com OR from:axisbank.com OR from:axis.bank.in OR from:icici.bank.in OR from:hdfclife.com OR from:licindia.com OR from:licindia.in OR from:axismaxlife.com OR from:maxlifeinsurance.com OR from:icicipru.com OR from:icicilombard.com OR from:starhealth.in OR from:sbilife.co.in OR from:tataaia.com OR from:bajajallianz.co.in OR from:nivabupa.com OR from:careinsurance.com';
function canonIns(f) {
  f = String(f || '').toLowerCase();
  const L = [['LIC', /licindia|@lic\./], ['HDFC Life', /hdfclife/], ['Axis Max Life', /maxlife|axismaxlife/], ['ICICI Pru', /icicipru/], ['ICICI Lombard', /icicilombard/],
             ['Star Health', /starhealth/], ['SBI Life', /sbilife/], ['Tata AIA', /tataaia/], ['Bajaj', /bajaj/], ['Niva Bupa', /niva|bupa/], ['Care Health', /careinsurance|carehealth/]];
  for (const [n, rx] of L) if (rx.test(f)) return n;
  return 'Insurance';
}
function canon(b) {
  b = String(b || '');
  const L = [['ICICI', /icici/i], ['HDFC', /hdfc/i], ['Axis', /axis/i], ['IndusInd', /indus/i], ['SBI', /sbi/i], ['BOBCARD', /bob|uni/i], ['AMEX', /amex|american/i], ['IDFC', /idfc/i], ['Tata Capital', /tata/i], ['Poonawalla', /poonaw/i], ['CRED', /cred/i]];
  for (const [n, rx] of L) if (rx.test(b)) return n;
  return b.trim().split(' ').slice(-2).join(' ');
}
const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

function setup() {
  if (SYNC_CODE.indexOf('PASTE') === 0) throw new Error('Paste your sync code from the app first (line 9).');
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncEmails').timeBased().everyHours(1).create();
  syncEmails(true);
  Logger.log('Done. Email reader will now run every hour.');
}

function syncEmails(firstRun) {
  const props = PropertiesService.getUserProperties();
  const query = '(' + SENDERS + ') newer_than:' + (firstRun === true ? '35d' : '3d');
  let threads = GmailApp.search(query, 0, 200);
  if (firstRun === true) threads = threads.concat(GmailApp.search('(from:licindia.com OR from:hdfclife.com OR from:axismaxlife.com OR from:maxlifeinsurance.com) premium newer_than:400d', 0, 100));
  let sent = 0;
  threads.forEach(th => th.getMessages().forEach(m => {
    const id = m.getId();
    if (props.getProperty('m_' + id)) return;
    const s = parse(m);
    if (s) { s.id = id; s.subj = m.getSubject().slice(0, 120); s.at = m.getDate().getTime(); save(id, s); sent++; props.setProperty('m_' + id, '1'); }
  }));
  Logger.log('Suggestions sent: ' + sent);
}

function clean(m) {
  const html = /amazonpay/i.test(m.getFrom());
  let t = (html ? m.getBody() : m.getPlainBody()) || m.getBody() || '';
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/\[[^\]]*\]\([^)]*\)/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
       .replace(/&amp;/g, '&').replace(/[|*]/g, ' ').replace(/\s+/g, ' ');
  return t;
}
const num = s => parseFloat(String(s).replace(/,/g, ''));
const p2 = n => ('0' + n).slice(-2);
function ymd(y, mo, d) { y = +y; if (y < 100) y += 2000; return y + '-' + p2(mo) + '-' + p2(d); }
function monName(s) { return MON[String(s).slice(0, 3).toLowerCase()]; }

function parse(m) {
  const from = m.getFrom().toLowerCase(), subj = m.getSubject(), t = clean(m);
  let r;
  // Wise: money received from someone (income)
  if (from.indexOf('wise.com') > -1 && /got paid by/i.test(subj)) {
    r = /has sent you\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})/.exec(t);
    const payer = (/got paid by\s*(.+)$/i.exec(subj) || [])[1];
    if (r && payer) return {kind: 'income', via: 'Wise', payer: payer.trim(), amt: num(r[1]), cur: r[2],
                            date: Utilities.formatDate(m.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd')};
  }
  // Amazon Pay: electricity / water bill paid (matched by USC / subscriber number)
  if (from.indexOf('amazonpay') > -1 && /bill payment for Rs\.?\s*[\d,.]+\s*is successful/i.test(subj)) {
    const a = /bill payment for Rs\.?\s*([\d,]+(?:\.\d+)?)/i.exec(subj), id = /Subscriber Id\s*:?\s*(\d{6,})/i.exec(t), ty = /(Electricity|Water|Gas)/i.exec(subj);
    if (a) return {kind: 'util', paid: true, util: ty ? ty[1] : 'Bill', ref: id ? id[1] : '', amt: num(a[1]),
                   date: Utilities.formatDate(m.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd')};
  }
  // Amazon Pay: electricity / water bill due reminder
  if (from.indexOf('amazonpay') > -1 && /(electricity|water|gas) bill payment (?:is|was) due/i.test(t)) {
    const ty = /(electricity|water|gas) bill payment/i.exec(t), d = /bill payment (?:is|was) due (?:on\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})|today)/i.exec(t),
          a = /Due for\s+Amount\s+.*?₹\s*([\d,]+(?:\.\d+)?)/i.exec(t), id = /USC No\.?\s*:?\s*(\d{6,})/i.exec(t);
    if (a && d) return {kind: 'util', paid: false, util: ty[1], ref: id ? id[1] : '', amt: num(a[1]),
                        due: d[1] ? ymd(d[3], monName(d[2]), d[1]) : Utilities.formatDate(m.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd')};
  }
  // HDFC account auto-debit (ACH / NACH) for loan EMIs
  r = /Rs\.?\s*(?:INR\s*)?([\d,]+(?:\.\d+)?)\s*is deducted from your account ending\s*X*(\d{4})\s*and added to\s*(?:N?ACH)\s*D-\s*(.+?)-\d+\s*account on\s*(\d{2})-([A-Za-z]{3})-(\d{4})/i.exec(t);
  if (r) return {kind: 'debit', ach: true, loan: true, bank: 'HDFC', acct: r[2], amt: num(r[1]), to: r[3].trim(), date: ymd(r[6], monName(r[5]), r[4])};
  // CRED: payment successful
  if (from.indexOf('cred.club') > -1 && /payment was successful/i.test(subj + t)) {
    r = /([A-Za-z][A-Za-z ]{1,25}?)\s*[•·.]{2,}\s*(\d{4}).*?amount paid\s*₹\s*([\d,]+(?:\.\d+)?).*?payment date\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/i.exec(t);
    if (r) return {kind: 'paid', bank: canon(r[1]), last4: r[2], amt: num(r[3]), date: ymd(r[6], monName(r[4]), r[5]), via: 'CRED'};
  }
  // CRED: bill due reminder
  if (from.indexOf('cred.club') > -1 && /bill is due/i.test(subj)) {
    r = /([A-Za-z][A-Za-z ]{1,25}?)\s*[•·.]{2,}\s*(\d{4}).*?₹\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/i.exec(t);
    if (r) return {kind: 'bill', bank: canon(r[1]), last4: r[2], amt: num(r[3]), due: ymd(r[6], monName(r[4]), r[5])};
  }
  // CRED: new bill generated
  if (from.indexOf('cred.club') > -1 && /new bill/i.test(subj)) {
    r = /([A-Za-z][A-Za-z ]{1,25}?)\s*[•·.]{2,}\s*(\d{4}).*?total amount due\s*₹\s*([\d,]+(?:\.\d+)?).*?due date\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/i.exec(t);
    if (r) return {kind: 'bill', bank: canon(r[1]), last4: r[2], amt: num(r[3]), due: ymd(r[6], monName(r[4]), r[5])};
  }
  // ICICI card statement
  if (from.indexOf('icici') > -1 && /statement/i.test(subj)) {
    r = /due by\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4}).*?Card\s*XX(\d{4}).*?Total Amount Due:?\s*₹\s*([\d,]+(?:\.\d+)?)\s*(CR)?/i.exec(t);
    if (r) return {kind: 'bill', bank: 'ICICI', last4: r[4], amt: r[6] ? 0 : num(r[5]), due: ymd(r[3], monName(r[1]), r[2])};
  }
  // Axis card statement (shows last 2 digits only)
  if (from.indexOf('axis') > -1 && /credit card ending/i.test(subj)) {
    const l2 = (/ending\s*XX(\d{2})/i.exec(subj) || [])[1];
    r = /Payment Due Date[^0-9]*([\d,]+(?:\.\d+)?)\s*(Cr|Dr)?\s*[\d,]+(?:\.\d+)?\s*(?:Cr|Dr)?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
    if (r && l2) return {kind: 'bill', bank: 'Axis', last4: l2, amt: /cr/i.test(r[2] || '') ? 0 : num(r[1]), due: ymd(r[5], r[4], r[3])};
  }
  // HDFC quarterly loan summary (no loan number is kept)
  if (from.indexOf('hdfcbank') > -1 && /Loan Summary/i.test(subj)) {
    const a = /as of\s*(\d{2})[-\/]([A-Za-z]{3}|\d{2})[-\/](\d{2,4})/i.exec(subj + ' ' + t);
    const rate = /Interest Rate \(p\.a\)\s*([\d.]+)\s*%/i.exec(t), emi = /Current EMI Amount \(Rs\)\s*([\d,]+)/i.exec(t),
          left = /Balance Tenure[^0-9]*?(\d+)/i.exec(t), end = /Installment end date\s*(\d{2})-(\d{2})-(\d{4})/i.exec(t),
          typ = /details of your\s*'([^']+)'/i.exec(t), sanc = /Sanctioned Amount \(Rs\)\s*([\d,]+)/i.exec(t);
    if (emi && left && a) {
      const mo = /\d/.test(a[2]) ? +a[2] : monName(a[2]);
      return {kind: 'loan', bank: 'HDFC', emi: num(emi[1]), left: +left[1], roi: rate ? +rate[1] : 0, type: typ ? typ[1] : 'Loan',
              sanctioned: sanc ? num(sanc[1]) : 0, asOf: ymd(a[3], mo, a[1]), end: end ? ymd(end[3], end[2], end[1]) : '', date: ymd(a[3], mo, a[1])};
    }
  }
  // HDFC card spend
  r = /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*has been debited from your HDFC Bank Credit Card ending\s*(\d{4})\s*towards\s*(.+?)\s+on\s+(\d{1,2})\s+([A-Za-z]{3}),?\s*(\d{4})/i.exec(t);
  if (r) return {kind: 'spend', bank: 'HDFC', last4: r[2], amt: num(r[1]), merchant: r[3].trim(), date: ymd(r[6], monName(r[5]), r[4])};
  // HDFC RuPay credit card UPI spend
  r = /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*has been debited from your RuPay Credit Card \(ending\s*(\d{4})\)\s*Paid to\s*(\S+)\s*Date:\s*(\d{2})-(\d{2})-(\d{2,4})/i.exec(t);
  if (r) return {kind: 'spend', bank: 'HDFC', last4: r[2], amt: num(r[1]), merchant: r[3].split('@')[0].slice(0, 30), date: ymd(r[6], r[5], r[4])};
  // HDFC bank account debit (UPI / auto-debit) — used to tick loans and bills paid from the account
  r = /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*(?:is|has been)\s*debited from (?:your )?(?:a\/c|account)\s*(?:\*\*|XX|ending\s*)?(\d{4})\s*towards\s*(.+?)\s+on\s+(\d{2})-(\d{2})-(\d{2,4})/i.exec(t);
  if (r && from.indexOf('hdfcbank') > -1) return {kind: 'debit', bank: 'HDFC', acct: r[2], amt: num(r[1]), to: r[3].replace(/VPA\s*/i, '').trim().slice(0, 60), date: ymd(r[6], r[5], r[4])};
  // Insurance: premium received (HDFC Life)
  r = /received the premium of INR\s*([\d,]+(?:\.\d+)?)\s*towards your policy.*?on\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  if (r) { const pl = /Plan:\s*(HDFC Life [A-Za-z0-9 +]+?)(?:\s+UIN|\s+Debit|\s{2}|$)/i.exec(t);
    return {kind: 'ins', insurer: 'HDFC Life', plan: pl ? pl[1].trim() : '', amt: num(r[1]), paid: true, date: ymd(r[4], r[3], r[2])}; }
  // Insurance: LIC renewal premium receipt
  r = /LIC.*?received an amount of Rs\.?\s*([\d,]+(?:\.\d+)?).*?dated\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  if (r && from.indexOf('licindia') > -1) return {kind: 'ins', insurer: 'LIC', plan: '', amt: num(r[1]), paid: true, date: ymd(r[4], r[3], r[2])};
  // Insurance: premium due reminder (HDFC Life style)
  r = /premium of INR\s*([\d,]+(?:\.\d+)?)\s*for your policy is due on\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  if (r) { const fq = /Premium Frequency\s*(?:\S+\s+){0,40}?(Monthly|Quarterly|Half[- ]?Yearly|Annual|Yearly)/i.exec(t);
    const pl = /(HDFC Life [A-Za-z0-9 +]+?)\s+\d{3}N\d/i.exec(t);
    return {kind: 'ins', insurer: canonIns(from), plan: pl ? pl[1].trim() : '', amt: num(r[1]), paid: false, due: ymd(r[4], r[3], r[2]), freq: fq ? fq[1] : ''}; }
  // Insurance: generic premium paid / receipt / due (other insurers)
  if (/premium/i.test(subj + ' ' + t.slice(0, 600)) && /(life|insur|lic|lombard|health|assurance)/i.test(from)) {
    r = /premium[^.]{0,80}?(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)/i.exec(t) || /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)[^.]{0,60}?premium/i.exec(t);
    const d = /(\d{2})[-\/](\d{2})[-\/](\d{4})/.exec(t);
    if (r && d && !/offer|plan for you|retirement gap|fraud|tips/i.test(subj)) {
      const isPaid = /received|receipt|successful|paid|thank you for (?:your )?payment/i.test(subj + ' ' + t.slice(0, 400));
      const o = {kind: 'ins', insurer: canonIns(from), plan: '', amt: num(r[1]), paid: isPaid};
      if (isPaid) o.date = ymd(d[3], d[2], d[1]); else o.due = ymd(d[3], d[2], d[1]);
      return o;
    }
  }
  // IndusInd card payment confirmation (no card digits in the email)
  r = /Payment of INR\s*([\d,]+(?:\.\d+)?)\s*towards your IndusInd Bank Credit Card.*?credited to your Credit Card account on\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  if (r) return {kind: 'paid', bank: 'IndusInd', last4: '', amt: num(r[1]), date: ymd(r[4], r[3], r[2]), via: 'IndusInd'};
  // Generic loan EMI paid / received
  r = /(?:EMI|instal+ment)[^.]{0,80}?(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)[^.]{0,80}?(?:received|paid|debited|successful|realised|realized)/i.exec(t) ||
      /(?:received|paid|debited|successful)[^.]{0,80}?(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)[^.]{0,60}?(?:EMI|instal+ment|loan)/i.exec(t);
  if (r && !/credit card/i.test(subj) && !/offer|pre-?approved|eligible/i.test(subj + ' ' + t.slice(0, 300))) {
    const d = /(\d{2})[-\/](\d{2})[-\/](\d{2,4})/.exec(t);
    return {kind: 'debit', bank: canon(from), amt: num(r[1]), to: 'Loan EMI', date: d ? ymd(d[3], d[2], d[1]) : Utilities.formatDate(m.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd'), loan: true};
  }
  // IndusInd card spend
  r = /IndusInd Bank Credit Card ending\s*(\d{4})\s*for INR\s*([\d,]+(?:\.\d+)?)\s*on\s*(\d{2})-(\d{2})-(\d{4}).*?\bat\s+(.+?)\s+is Approved/i.exec(t);
  if (r) return {kind: 'spend', bank: 'IndusInd', last4: r[1], amt: num(r[2]), merchant: r[6].trim(), date: ymd(r[5], r[4], r[3])};
  // IndusInd statement
  r = /card number\s*X{4}\s*X{4}\s*X{4}\s*(\d{4}).*?Total Due:?\s*₹\s*([\d,]+(?:\.\d+)?).*?Due Date:?\s*(\d{2})-([A-Za-z]{3})-(\d{2,4})/i.exec(t);
  if (r && from.indexOf('indusind') > -1) return {kind: 'bill', bank: 'IndusInd', last4: r[1], amt: num(r[2]), due: ymd(r[5], monName(r[4]), r[3])};
  // SBI card spend
  r = /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*spent on your SBI Credit Card ending\s*(\d{4})\s*at\s*(.+?)\s+on\s+(\d{2})\/(\d{2})\/(\d{2,4})/i.exec(t);
  if (r) return {kind: 'spend', bank: 'SBI', last4: r[2], amt: num(r[1]), merchant: r[3].trim(), date: ymd(r[6], r[5], r[4])};
  // BOBCARD (UNI) bill generated
  if (from.indexOf('bobcard') > -1 && /generated/i.test(subj)) {
    r = /Billed Amount\s*₹\s*([\d,]+(?:\.\d+)?)\s*Due Date\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i.exec(t);
    if (r) return {kind: 'bill', bank: 'BOBCARD', last4: '', amt: num(r[1]), due: ymd(r[4], monName(r[3]), r[2])};
  }
  return null;
}

function save(id, s) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/users/' +
              SYNC_CODE + '/ledger/mail_' + id;
  const res = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT},
    payload: JSON.stringify({fields: {json: {stringValue: JSON.stringify(s)}, at: {integerValue: String(Date.now())}}})
  });
  if (res.getResponseCode() >= 300) throw new Error('Could not save to Firebase: ' + res.getContentText().slice(0, 300));
}

/** Optional: test the reader on your recent emails without saving anything. */
function testOnly() {
  GmailApp.search('(' + SENDERS + ') newer_than:20d', 0, 30).forEach(th => th.getMessages().forEach(m => {
    const s = parse(m); if (s) Logger.log(JSON.stringify(s));
  }));
}
