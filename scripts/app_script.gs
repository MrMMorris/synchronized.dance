/**
 * ============================================================================
 * EVENT TICKET SYSTEM — Google Apps Script
 * ============================================================================
 *
 * Attached to a Google Sheet with tabs:
 *   Purchases, Tickets, Scanners, Ambassadors, Ambassador Signups, Summary
 *   + one tab per event named exactly after the event ID (e.g. 27_06_2026-beach_party)
 *
 * Deploy as a Web App:
 *   Deploy → New deployment → Type: Web app
 *   Execute as: Me / Who has access: Anyone
 *   Copy the /exec URL into config.js on the site.
 *
 * Adding a new event:
 *   1. Create the Google Form, link it to this spreadsheet.
 *   2. Google creates a "Form Responses X" tab — rename it to the event ID
 *      (e.g. 27_06_2026-beach_party). Tab name = event ID.
 *   3. Add an entry to EVENTS below using that same event ID as the key.
 *   4. Deploy a new script version.
 * ============================================================================
 */

// Shared config — does not change per event
const CONFIG = {
  PURCHASES_TAB:               'Purchases',
  TICKETS_TAB:                 'Tickets',
  SCANNERS_TAB:                'Scanners',
  AMBASSADORS_TAB:             'Ambassadors',
  AMBASSADOR_FORM_RESPONSES_TAB: 'Ambassador Signups',
  SUMMARY_TAB:                 'Summary',
  ORGANIZER_EMAIL:     'nexa.events.marketing@gmail.com,marcus.r.morris@gmail.com', // comma-separated; gets a notification on every new order
  TICKETS_PAGE_URL:    'https://synchronized.dance/tickets.html',
  SCANNER_PAGE_URL:    'https://synchronized.dance/scanner.html',
  AMBASSADOR_PAGE_URL: 'https://synchronized.dance/ambassador.html',
};

// Per-event config — key is the event ID, which must also be the form responses tab name
const EVENTS = {
  '27_06_2026-beach_party': {
    EVENT_NAME:    'Beach Party',
    EVENT_DATE:    'June 27',
    EVENT_TIME:    '4PM – 12AM',
    EVENT_VENUE:   'Northern Cove, Penang',
    EVENT_ADDRESS: '515 Jalan C M Hashim, Tanjung Tokong, George Town',
    COMMISSION_PER_TICKET: 5,
  },
  '18_07_2026-Bon_Odori_After_Party': {
    EVENT_NAME:    'Bon Odori After-Party',
    EVENT_DATE:    'July 18',
    EVENT_TIME:    '8PM – 11:30PM',
    EVENT_VENUE:   'The Palm House, Penang',
    EVENT_ADDRESS: 'The Palm House, George Town, Penang',
    COMMISSION_PER_TICKET: 5,
  },
};

// ============================================================================
// MENU
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ticket System')
    .addItem('Generate tickets for confirmed purchases', 'generateTickets')
    .addItem('Generate scanner links', 'generateScannerLinks')
    .addSeparator()
    .addItem('Reset a ticket (un-scan)', 'resetTicketPrompt')
    .addItem('Show stats', 'showStats')
    .addItem('Resend ticket email…', 'resendTicketEmailPrompt')
    .addSeparator()
    .addItem('Refresh ambassador stats', 'refreshAmbassadorStats')
    .addItem('Refresh event stats', 'refreshEventStats')
    .addSeparator()
    .addItem('First-time setup', 'setupScriptProperties')
    .addToUi();
}

function setupScriptProperties() {
  SpreadsheetApp.getUi().alert('No setup needed — all config is in the EVENTS and CONFIG objects at the top of the script.');
}

// ============================================================================
// WEB APP ENDPOINTS
// ============================================================================

function doGet(e) {
  const params = e.parameter;
  const action = params.action;

  try {
    let result;
    switch (action) {
      case 'validate':      result = validateTicket(params.ticket_id, params.token); break;
      case 'confirm_cash':  result = confirmCashScan(params.ticket_id, params.token); break;
      case 'check_scanner': result = checkScanner(params.token); break;
      case 'get_tickets':   result = getTicketsForBuyer(params.key); break;
      case 'get_ambassador':result = getAmbassadorStats(params.key); break;
      default:              result = { ok: false, error: 'Unknown action' };
    }
    return jsonResponse(result, params.callback);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, params.callback);
  }
}

/**
 * On-site purchase form submits here (POST, JSON body). To stay a CORS "simple
 * request" the page sends the body as text/plain — do NOT require a JSON
 * content-type. Mirrors the Google Form path via recordPurchase().
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'No data received' });
    }

    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch (err) { return jsonResponse({ ok: false, error: 'Malformed request' }); }

    // Honeypot: bots fill hidden fields. Look successful, but record nothing.
    if (body.company || body._gotcha) return jsonResponse({ ok: true });

    // Door staff record a cash walk-in sale from the scanner page.
    if (body.type === 'walkin') {
      return jsonResponse(recordWalkin({
        token:      body.token,
        eventId:    body.event_id,
        ticketType: body.ticket_type,
        quantity:   body.quantity,
      }));
    }

    // On-site ambassador signup form posts here too (not event-specific).
    if (body.type === 'ambassador_signup') {
      // A payout QR image (if supplied) is stashed in Drive; its URL becomes the
      // payment_details, matching the legacy form's "payment qr" convention.
      let paymentDetails = String(body.payment_details || '');
      if (body.screenshot && body.screenshot.data) {
        try { paymentDetails = savePaymentProof(body.screenshot, 'ambassador', body.name); }
        catch (err) { Logger.log('Failed to save ambassador payout QR: ' + err); }
      }
      return jsonResponse(recordAmbassador({
        name:           body.name,
        email:          body.email,
        phone:          body.phone,
        business:       body.business,
        paymentDetails: paymentDetails,
      }));
    }

    if (!EVENTS[body.event_id]) return jsonResponse({ ok: false, error: 'Unknown event' });

    // Stash the payment screenshot (QR orders) in Drive; store its URL as proof.
    // If saving fails (e.g. Drive scope not authorized), surface the error in the
    // sheet cell rather than leaving payment_proof mysteriously blank.
    let proofUrl = '';
    if (body.screenshot && body.screenshot.data) {
      try { proofUrl = savePaymentProof(body.screenshot, body.event_id, body.buyer_name); }
      catch (err) {
        Logger.log('Failed to save payment proof: ' + err);
        proofUrl = 'ERROR saving proof — ' + err;
      }
    }

    const result = recordPurchase({
      eventId:       body.event_id,
      buyerName:     body.buyer_name,
      buyerEmail:    body.buyer_email,
      buyerPhone:    body.buyer_phone,
      ticketType:    body.ticket_type,
      quantity:      body.quantity,
      paymentType:   body.payment_method,
      paymentProof:  proofUrl,
      affiliateCode: body.affiliate_code,
      source:        'Website form',
    });
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(`${callback}(${json})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// VALIDATION LOGIC (called by scanner page)
// ============================================================================

function validateTicket(ticketId, token) {
  return admitTicket(ticketId, token, false);
}

// Called when door staff swipe to confirm cash was collected for a cash order.
function confirmCashScan(ticketId, token) {
  return admitTicket(ticketId, token, true);
}

/**
 * Shared admit logic for both the initial scan and the cash-confirm swipe.
 *
 * Cash orders are NOT marked scanned on the first scan — we return status
 * 'cash_due' and leave the ticket unused until door staff confirm payment via
 * the swipe (which hits confirm_cash → confirmCash = true). This means a guest
 * who can't pay hasn't burned their ticket, and ambassador/attendance counts
 * only include cash that was actually collected.
 *
 * Non-cash orders are admitted immediately on the first scan, as before.
 */
function admitTicket(ticketId, token, confirmCash) {
  if (!ticketId) return { ok: false, status: 'invalid', reason: 'No ticket ID provided' };
  if (!token) return { ok: false, status: 'unauthorized', reason: 'Missing scanner token' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const scanner = lookupScanner(token);
    if (!scanner) return { ok: false, status: 'unauthorized', reason: 'Invalid scanner token' };
    if (!scanner.active) return { ok: false, status: 'unauthorized', reason: 'Scanner token disabled' };

    const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.TICKETS_TAB);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol        = headers.indexOf('ticket_id');
    const scannedCol   = headers.indexOf('scanned');
    const scannedAtCol = headers.indexOf('scanned_at');
    const scannedByCol = headers.indexOf('scanned_by');
    const nameCol      = headers.indexOf('buyer_name');
    const typeCol      = headers.indexOf('ticket_type');
    const purchaseIdCol= headers.indexOf('purchase_id');
    const paymentTypeCol = headers.indexOf('payment_method');

    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() === String(ticketId).trim()) { foundRow = i; break; }
    }
    if (foundRow === -1) return { ok: true, status: 'invalid', reason: 'Ticket not found' };

    let ticketIndex = 0, ticketTotal = 0;
    if (purchaseIdCol !== -1) {
      const purchaseId = String(data[foundRow][purchaseIdCol]).trim();
      if (purchaseId) {
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][purchaseIdCol]).trim() === purchaseId) {
            ticketTotal++;
            if (i === foundRow) ticketIndex = ticketTotal;
          }
        }
      }
    }

    const paymentMethod = paymentTypeCol !== -1 ? data[foundRow][paymentTypeCol] : null;
    const isCash = String(paymentMethod).toLowerCase().trim() === 'cash';

    const alreadyScanned = data[foundRow][scannedCol] === true || String(data[foundRow][scannedCol]).toUpperCase() === 'TRUE';
    if (alreadyScanned) {
      return {
        ok: true, status: 'already_scanned',
        buyer_name: data[foundRow][nameCol],
        ticket_type: shortTicketType(data[foundRow][typeCol]),
        payment_method: paymentMethod,
        ticket_index: ticketIndex, ticket_total: ticketTotal,
        scanned_at: data[foundRow][scannedAtCol],
        scanned_by: data[foundRow][scannedByCol],
      };
    }

    // Cash order, first scan: hold for the cash-confirm swipe — do not admit yet.
    if (isCash && !confirmCash) {
      return {
        ok: true, status: 'cash_due',
        buyer_name: data[foundRow][nameCol],
        ticket_type: shortTicketType(data[foundRow][typeCol]),
        payment_method: paymentMethod,
        ticket_index: ticketIndex, ticket_total: ticketTotal,
      };
    }

    const rowNum = foundRow + 1;
    const now = new Date();
    sheet.getRange(rowNum, scannedCol + 1).setValue(true);
    const scannedAtCell = sheet.getRange(rowNum, scannedAtCol + 1);
    scannedAtCell.setValue(now);
    scannedAtCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(rowNum, scannedByCol + 1).setValue(scanner.name);

    return {
      ok: true, status: 'valid',
      buyer_name: data[foundRow][nameCol],
      ticket_type: shortTicketType(data[foundRow][typeCol]),
      payment_method: paymentMethod,
      ticket_index: ticketIndex, ticket_total: ticketTotal,
      scanned_by: scanner.name,
    };
  } finally {
    lock.releaseLock();
  }
}

function checkScanner(token) {
  if (!token) return { ok: false, reason: 'No token' };
  const scanner = lookupScanner(token);
  if (!scanner) return { ok: false, reason: 'Invalid token' };
  if (!scanner.active) return { ok: false, reason: 'Token disabled' };
  return { ok: true, name: scanner.name };
}

function lookupScanner(token) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SCANNERS_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const nameCol   = headers.indexOf('staff_name');
  const tokenCol  = headers.indexOf('token');
  const activeCol = headers.indexOf('active');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][tokenCol]).trim() === String(token).trim()) {
      return {
        name: data[i][nameCol],
        active: data[i][activeCol] === true || String(data[i][activeCol]).toUpperCase() === 'TRUE',
      };
    }
  }
  return null;
}

// ============================================================================
// TICKET VIEWER (called by tickets.html)
// ============================================================================

function getTicketsForBuyer(key) {
  if (!key) return { ok: false, error: 'No key' };

  const purchasesSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.PURCHASES_TAB);
  const purchasesData = purchasesSheet.getDataRange().getValues();
  const pHeaders = purchasesData[0];
  const pKeyCol      = pHeaders.indexOf('purchase_key');
  const pNameCol     = pHeaders.indexOf('buyer_name');
  const pPurchaseIdCol = pHeaders.indexOf('purchase_id');
  const pEventIdCol  = pHeaders.indexOf('event_id');

  if (pKeyCol === -1) return { ok: false, error: 'purchase_key column missing' };
  if (pPurchaseIdCol === -1) return { ok: false, error: 'purchase_id column missing' };

  let buyerName = null, purchaseId = null, eventId = null;
  for (let i = 1; i < purchasesData.length; i++) {
    if (String(purchasesData[i][pKeyCol]).trim() === String(key).trim()) {
      buyerName  = purchasesData[i][pNameCol];
      purchaseId = String(purchasesData[i][pPurchaseIdCol]).trim();
      eventId    = pEventIdCol !== -1 ? String(purchasesData[i][pEventIdCol]).trim() : null;
      break;
    }
  }
  if (!purchaseId) return { ok: false, error: 'Invalid link' };

  const ticketsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.TICKETS_TAB);
  const ticketsData = ticketsSheet.getDataRange().getValues();
  const tHeaders = ticketsData[0];
  const tIdCol         = tHeaders.indexOf('ticket_id');
  const tPurchaseIdCol = tHeaders.indexOf('purchase_id');
  const tTypeCol       = tHeaders.indexOf('ticket_type');
  const tScannedCol    = tHeaders.indexOf('scanned');
  const tPaymentTypeCol= tHeaders.indexOf('payment_method');

  const tickets = [];
  for (let i = 1; i < ticketsData.length; i++) {
    if (String(ticketsData[i][tPurchaseIdCol]).trim() === purchaseId) {
      tickets.push({
        ticket_id:      ticketsData[i][tIdCol],
        ticket_type:    shortTicketType(ticketsData[i][tTypeCol]),
        payment_method: tPaymentTypeCol !== -1 ? ticketsData[i][tPaymentTypeCol] : null,
        scanned:        ticketsData[i][tScannedCol] === true || String(ticketsData[i][tScannedCol]).toUpperCase() === 'TRUE',
      });
    }
  }

  const ec = eventId ? EVENTS[eventId] : null;
  return {
    ok: true,
    buyer_name: buyerName,
    tickets: tickets,
    event: {
      id:    eventId || '',
      name:  ec ? ec.EVENT_NAME  : '',
      date:  ec ? ec.EVENT_DATE  : '',
      time:  ec ? ec.EVENT_TIME  : '',
      venue: ec ? ec.EVENT_VENUE : '',
    },
  };
}

// ============================================================================
// MENU ACTIONS
// ============================================================================

function generateTickets() {
  const ui = SpreadsheetApp.getUi();
  const purchasesSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.PURCHASES_TAB);

  ensureColumn(purchasesSheet, 'event_id');
  ensureColumn(purchasesSheet, 'purchase_id');
  ensureColumn(purchasesSheet, 'purchase_key');
  ensureColumn(purchasesSheet, 'buyer_ticket_url');

  const pData    = purchasesSheet.getDataRange().getValues();
  const pHeaders = pData[0];
  const paidCol = pHeaders.indexOf('payment_confirmed');
  const genCol  = pHeaders.indexOf('tickets_generated');
  const nameCol = pHeaders.indexOf('buyer_name');

  let generated = 0, purchases = 0;
  for (let i = 1; i < pData.length; i++) {
    const paid             = pData[i][paidCol] === true || String(pData[i][paidCol]).toUpperCase() === 'TRUE';
    const alreadyGenerated = pData[i][genCol]  === true || String(pData[i][genCol]).toUpperCase()  === 'TRUE';
    if (!paid || alreadyGenerated || !pData[i][nameCol]) continue;

    // Reuse the single-row generator so there is one source of truth for how a
    // purchase becomes tickets (column mapping, IDs, ticket URL, etc.).
    const res = generateTicketsForRow(i + 1);
    if (res && res.ok) { generated += res.generated; purchases++; }
  }

  ui.alert(`Done. Generated ${generated} ticket${generated === 1 ? '' : 's'} across ${purchases} purchase${purchases === 1 ? '' : 's'}.`);
}

function generateScannerLinks() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SCANNERS_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const cols = {
    name:    headers.indexOf('staff_name'),
    token:   headers.indexOf('token'),
    url:     headers.indexOf('scanner_url'),
    created: headers.indexOf('created_at'),
  };

  let created = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][cols.name] || data[i][cols.token]) continue;
    const token = randomKey(32);
    const rowNum = i + 1;
    sheet.getRange(rowNum, cols.token   + 1).setValue(token);
    sheet.getRange(rowNum, cols.url     + 1).setValue(`${CONFIG.SCANNER_PAGE_URL}?k=${token}`);
    sheet.getRange(rowNum, cols.created + 1).setValue(new Date());
    created++;
  }
  ui.alert(`Done. Created ${created} scanner link${created === 1 ? '' : 's'}.`);
}

function resetTicketPrompt() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Reset a ticket', 'Enter the ticket_id to un-scan:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const ticketId = resp.getResponseText().trim();
  if (!ticketId) return;

  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.TICKETS_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol        = headers.indexOf('ticket_id');
  const scannedCol   = headers.indexOf('scanned');
  const scannedAtCol = headers.indexOf('scanned_at');
  const scannedByCol = headers.indexOf('scanned_by');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === ticketId) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, scannedCol   + 1).setValue(false);
      sheet.getRange(rowNum, scannedAtCol + 1).setValue('');
      sheet.getRange(rowNum, scannedByCol + 1).setValue('');
      ui.alert('Ticket reset.');
      return;
    }
  }
  ui.alert('Ticket not found.');
}

function showStats() {
  const ticketsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.TICKETS_TAB);
  const data = ticketsSheet.getDataRange().getValues();
  if (data.length < 2) { SpreadsheetApp.getUi().alert('No tickets generated yet.'); return; }
  const headers   = data[0];
  const scannedCol= headers.indexOf('scanned');
  const typeCol   = headers.indexOf('ticket_type');
  const eventCol  = headers.indexOf('event_id');

  let total = 0, scanned = 0;
  const byType = {}, byEvent = {};
  for (let i = 1; i < data.length; i++) {
    total++;
    const type    = data[i][typeCol]  || 'Unknown';
    const eventId = eventCol !== -1 ? (data[i][eventCol] || 'Unknown') : 'Unknown';
    const isScanned = data[i][scannedCol] === true || String(data[i][scannedCol]).toUpperCase() === 'TRUE';
    if (!byType[type])    byType[type]    = { total: 0, scanned: 0 };
    if (!byEvent[eventId])byEvent[eventId]= { total: 0, scanned: 0 };
    byType[type].total++;    byEvent[eventId].total++;
    if (isScanned) { scanned++; byType[type].scanned++; byEvent[eventId].scanned++; }
  }

  let msg = `Total: ${total}  Scanned: ${scanned}  Remaining: ${total - scanned}\n\nBy event:\n`;
  for (const e in byEvent) msg += `  ${e}: ${byEvent[e].scanned}/${byEvent[e].total}\n`;
  msg += '\nBy type:\n';
  for (const t in byType)  msg += `  ${t}: ${byType[t].scanned}/${byType[t].total}\n`;
  SpreadsheetApp.getUi().alert(msg);
}

// ============================================================================
// FORM SUBMIT HANDLER
// ============================================================================

/**
 * Triggered on form submit. The tab name is the event ID — look it up in EVENTS.
 * If the tab isn't in EVENTS, it's not a ticket form (could be ambassador signup).
 */
function onFormSubmitHandler(e) {
  if (!e || !e.values) return;

  const triggerSheet = e.range ? e.range.getSheet() : null;
  if (!triggerSheet) return;

  const eventId     = triggerSheet.getName();
  const eventConfig = EVENTS[eventId];
  if (!eventConfig) return; // not a known ticket form tab

  const v = e.values;
  const respHeaders = triggerSheet.getRange(1, 1, 1, triggerSheet.getLastColumn()).getValues()[0];
  const findCol = makeFindCol(respHeaders);

  const nameIdx          = findCol('name');
  const emailIdx         = findCol('email');
  const typeIdx          = findCol('ticket type');
  const qtyIdx           = findCol('quantity');
  const screenshotIdx    = findCol('screenshot') !== -1 ? findCol('screenshot') : findCol('proof');
  const paymentMethodIdx = findCol('payment method');
  const referralIdx      = findCol('referral') !== -1 ? findCol('referral') : findCol('ambassador');

  recordPurchase({
    eventId:       eventId,
    buyerName:     nameIdx  !== -1 ? v[nameIdx]  : '',
    buyerEmail:    emailIdx !== -1 ? v[emailIdx] : '',
    buyerPhone:    '',
    ticketType:    typeIdx  !== -1 ? v[typeIdx]  : 'General',
    quantity:      qtyIdx   !== -1 ? v[qtyIdx]   : 1,
    paymentType:   paymentMethodIdx !== -1 ? v[paymentMethodIdx] : '',
    paymentProof:  screenshotIdx !== -1 ? v[screenshotIdx] : '',
    affiliateCode: referralIdx !== -1 ? v[referralIdx] : '',
    source:        'Google Form',
  });
}

/**
 * Core purchase intake — shared by the Google Form trigger (onFormSubmitHandler)
 * and the on-site form POST (doPost). Writes one Purchases row, then for cash
 * orders generates tickets + emails immediately; for QR orders sends an order
 * confirmation. Returns { ok, payment_method, ticket_url } or { ok:false, error }.
 *
 * fields: { eventId, buyerName, buyerEmail, buyerPhone, ticketType, quantity,
 *           paymentType, paymentProof, affiliateCode, source }
 */
function recordPurchase(fields) {
  const eventConfig = EVENTS[fields.eventId];
  if (!eventConfig) return { ok: false, error: 'Unknown event' };

  const ss = SpreadsheetApp.getActive();
  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  if (!purchasesSheet) return { ok: false, error: 'Purchases tab missing' };

  const buyerName  = String(fields.buyerName  || '').trim();
  const buyerEmail = String(fields.buyerEmail || '').trim();
  const buyerPhone = String(fields.buyerPhone || '').trim();
  const ticketType = String(fields.ticketType || 'General').trim();
  const quantity   = parseInt(fields.quantity, 10) || 1;
  const rawPaymentType = String(fields.paymentType || '').toLowerCase().trim();
  const paymentType = rawPaymentType.startsWith('cash') ? 'cash' : rawPaymentType.startsWith('qr') ? 'qr' : rawPaymentType;
  const paymentProof = String(fields.paymentProof || '');
  const affiliateCode = String(fields.affiliateCode || '').trim();

  if (!buyerName || !buyerEmail) return { ok: false, error: 'Name and email are required' };
  if (quantity < 1) return { ok: false, error: 'Quantity must be at least 1' };

  const unitPrice = priceFor(ticketType);
  const totalCost = unitPrice * quantity;
  const isCashOrder = paymentType === 'cash';

  const purchaseHeaders = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const newRow = new Array(purchaseHeaders.length).fill('');
  const valueMap = {
    'event_id':          fields.eventId,
    'buyer_name':        buyerName,
    'buyer_email':       buyerEmail,
    'buyer_phone':       buyerPhone,
    'ticket_type':       ticketType,
    'quantity':          quantity,
    'amount_paid':       totalCost,
    'payment_method':    paymentType,
    'payment_confirmed': isCashOrder,
    'payment_proof':     paymentProof,
    'affiliate_code':    affiliateCode,
    'notes':             fields.source || 'Auto-imported from form',
    'purchase_time':     new Date(),
    'tickets_generated': false,
  };
  for (let i = 0; i < purchaseHeaders.length; i++) {
    if (valueMap.hasOwnProperty(purchaseHeaders[i])) newRow[i] = valueMap[purchaseHeaders[i]];
  }

  // Lock around append + getLastRow + cash generation. Form-submit triggers and
  // POSTs can run concurrently; without this, a second submission appending
  // between our append and getLastRow() would generate tickets for the wrong row.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let ticketUrl = '';
  try {
    purchasesSheet.appendRow(newRow);
    SpreadsheetApp.flush();
    if (isCashOrder) {
      try {
        const newRowNum = purchasesSheet.getLastRow();
        const result = generateTicketsForRow(newRowNum);
        if (result && result.ok) {
          sendTicketEmail(newRowNum);
          const urlCol = purchaseHeaders.indexOf('buyer_ticket_url');
          if (urlCol !== -1) ticketUrl = String(purchasesSheet.getRange(newRowNum, urlCol + 1).getValue());
        }
      } catch (err) {
        Logger.log('Failed to auto-generate cash tickets: ' + err);
      }
    }
  } finally {
    lock.releaseLock();
  }

  if (!isCashOrder && buyerEmail) {
    try {
      sendOrderConfirmationEmail(buyerEmail, buyerName, ticketType, quantity, unitPrice, totalCost, eventConfig);
    } catch (err) {
      Logger.log('Failed to send confirmation email: ' + err);
    }
  }

  // Notify the organizer of every new order (replaces the old Google Form
  // "new response" email that we lost moving to the on-site form).
  try {
    sendNewOrderNotification({
      eventConfig, buyerName, buyerEmail, buyerPhone, ticketType,
      quantity, unitPrice, totalCost, paymentType, affiliateCode,
      paymentProof, isCashOrder, source: fields.source || '',
    });
  } catch (err) {
    Logger.log('Failed to send organizer notification: ' + err);
  }

  return { ok: true, payment_method: paymentType, ticket_url: ticketUrl };
}

/**
 * Records a cash walk-in sale made at the door from the scanner page. Walk-ins
 * have no buyer/email and need no QR ticket — they exist purely so the door's
 * cash sales flow into the same Tickets/Purchases tables (and therefore the
 * Summary totals + revenue). Each walk-in ticket is written already-scanned and
 * paid in cash, so isCredited() counts it as confirmed revenue immediately.
 */
function recordWalkin(fields) {
  const scanner = lookupScanner(String(fields.token || '').trim());
  if (!scanner || !scanner.active) return { ok: false, error: 'Invalid scanner token' };

  const eventId = String(fields.eventId || '').trim();
  if (!EVENTS[eventId]) return { ok: false, error: 'Unknown event' };

  const quantity = parseInt(fields.quantity, 10) || 0;
  if (quantity < 1) return { ok: false, error: 'Quantity must be at least 1' };

  const ticketType = String(fields.ticketType || 'General Admission').trim();
  const unitPrice = priceFor(ticketType);
  const total = unitPrice * quantity;

  const ss = SpreadsheetApp.getActive();
  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  const ticketsSheet   = ss.getSheetByName(CONFIG.TICKETS_TAB);

  const purchaseHeaders = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const purchaseId = randomKey(12);
  const now = new Date();
  const newRow = new Array(purchaseHeaders.length).fill('');
  const valueMap = {
    'event_id':          eventId,
    'purchase_id':       purchaseId,
    'buyer_name':        'Walk-in',
    'ticket_type':       ticketType,
    'quantity':          quantity,
    'amount_paid':       total,
    'payment_method':    'cash',
    'payment_confirmed': true,
    'affiliate_code':    '',
    'notes':             'Walk-in (door) — ' + scanner.name,
    'purchase_time':     now,
    'tickets_generated': true,
  };
  for (let i = 0; i < purchaseHeaders.length; i++) {
    if (valueMap.hasOwnProperty(purchaseHeaders[i])) newRow[i] = valueMap[purchaseHeaders[i]];
  }

  const tHeaders = ticketsSheet.getRange(1, 1, 1, ticketsSheet.getLastColumn()).getValues()[0];
  function buildTicketRow(values) {
    const row = new Array(tHeaders.length).fill('');
    for (const h in values) { const idx = tHeaders.indexOf(h); if (idx !== -1) row[idx] = values[h]; }
    return row;
  }
  const ticketRows = [];
  for (let j = 0; j < quantity; j++) {
    ticketRows.push(buildTicketRow({
      ticket_id:      randomKey(16),
      purchase_id:    purchaseId,
      event_id:       eventId,
      buyer_name:     'Walk-in',
      ticket_type:    ticketType,
      payment_method: 'cash',
      affiliate_code: '',
      scanned: true, scanned_at: now, scanned_by: scanner.name,
    }));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    purchasesSheet.appendRow(newRow);
    SpreadsheetApp.flush();
    ticketsSheet.getRange(ticketsSheet.getLastRow() + 1, 1, ticketRows.length, tHeaders.length).setValues(ticketRows);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, quantity: quantity, unit_price: unitPrice, total: total };
}

/**
 * Saves a base64 payment screenshot (from the on-site form) to a Drive folder
 * and returns the file URL to store in the Purchases `payment_proof` column.
 * `screenshot` = { data: <base64 or data-url>, mimeType, name }.
 */
function savePaymentProof(screenshot, eventId, buyerName) {
  const folderName = 'Nexa Payment Proofs';
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);

  let b64 = String(screenshot.data || '');
  const marker = b64.indexOf('base64,');
  if (marker !== -1) b64 = b64.slice(marker + 7); // strip any data-url prefix
  const mime = screenshot.mimeType || 'image/jpeg';
  const bytes = Utilities.base64Decode(b64);

  const safeName = String(buyerName || 'buyer').replace(/[^\w\-]+/g, '_').slice(0, 40);
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const fileName = `${eventId}__${safeName}__${stamp}.${ext}`;

  const file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));
  return file.getUrl();
}

function priceFor(ticketType) {
  // Prefer the explicit price embedded in the ticket-type label, e.g.
  // "General Admission — RM55 (...)" → 55. This keeps amount_paid correct
  // per-event without hardcoding. Falls back to keyword matching only if the
  // label has no RMxx in it.
  const s = String(ticketType);
  const m = s.match(/RM\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  const t = s.toLowerCase();
  if (t.indexOf('food') !== -1) return 100;
  if (t.indexOf('general') !== -1) return 50;
  return 0;
}

function sendOrderConfirmationEmail(email, name, ticketType, quantity, unitPrice, totalCost, eventConfig) {
  const subject = `Order received — ${eventConfig.EVENT_NAME}`;
  const textBody =
    `Hi ${name},\n\n` +
    `We received your ticket request for ${eventConfig.EVENT_NAME}.\n\n` +
    `ORDER SUMMARY\n` +
    `${quantity} × ${ticketType} @ RM${unitPrice}\n` +
    `TOTAL: RM${totalCost}\n\n` +
    `Your tickets will be sent to this email address (${email}) once we've verified your payment.\n\n` +
    `— Nexa Events`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #0a0a0a;">
      <div style="background: #ff3d00; color: #fff7e8; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <div style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9;">★ Nexa Events ★</div>
        <h1 style="margin: 8px 0 0; font-size: 28px; letter-spacing: -1px;">ORDER RECEIVED</h1>
      </div>
      <div style="background: #fff7e8; padding: 24px; border-radius: 0 0 8px 8px; border: 2px solid #0a0a0a; border-top: 0;">
        <p style="margin: 0 0 18px; font-size: 16px;">Hi <strong>${escapeForHtml(name)}</strong>,</p>
        <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.5;">Thanks for your order. Here's a summary:</p>
        <div style="background: #fff; border: 2px solid #0a0a0a; padding: 16px 18px; margin: 0 0 18px;">
          <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; font-family: monospace;">
            <span><strong>${quantity}</strong> × ${escapeForHtml(ticketType)}</span>
            <span>RM${unitPrice} each</span>
          </div>
          <hr style="border: 0; border-top: 1px dashed #0a0a0a; margin: 8px 0;" />
          <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 18px;">
            <strong>TOTAL</strong><strong style="background: #c6ff3a; padding: 2px 10px;">RM${totalCost}</strong>
          </div>
        </div>
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
          Your tickets will be sent to <strong>${escapeForHtml(email)}</strong> once we've verified your payment.
        </p>
      </div>
    </div>`;

  GmailApp.sendEmail(email, subject, textBody, { from: 'nexa.events.marketing@gmail.com', htmlBody, name: 'Nexa Events' });
}

/**
 * Notifies the organizer that a new order came in. Sent for both cash and QR.
 * For QR orders it flags that payment still needs verifying (set
 * payment_confirmed = TRUE to release tickets) and links the proof screenshot.
 */
function sendNewOrderNotification(o) {
  const to = CONFIG.ORGANIZER_EMAIL;
  if (!to) return;

  const ec = o.eventConfig;
  const shortType = shortTicketType(o.ticketType);
  const method = o.isCashOrder ? 'CASH (pay at door)' : 'QR / bank transfer';
  const actionLine = o.isCashOrder
    ? 'Tickets were generated and emailed automatically — no action needed.'
    : 'ACTION NEEDED: verify the payment, then set payment_confirmed = TRUE on the Purchases row to release tickets.';

  const proofIsUrl = /^https?:\/\//i.test(String(o.paymentProof || ''));

  const subject = `New ${o.isCashOrder ? 'cash' : 'QR'} order — ${o.buyerName} · ${o.quantity}× ${shortType} · ${ec.EVENT_NAME}`;

  const textBody =
    `New order for ${ec.EVENT_NAME}\n\n` +
    `Name:    ${o.buyerName}\n` +
    `Email:   ${o.buyerEmail}\n` +
    (o.buyerPhone ? `Phone:   ${o.buyerPhone}\n` : '') +
    `Tickets: ${o.quantity} × ${shortType} @ RM${o.unitPrice}\n` +
    `Total:   RM${o.totalCost}\n` +
    `Payment: ${method}\n` +
    (o.affiliateCode ? `Referral: ${o.affiliateCode}\n` : '') +
    (o.paymentProof ? `Proof:   ${o.paymentProof}\n` : '') +
    (o.source ? `Source:  ${o.source}\n` : '') +
    `\n${actionLine}\n`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #0a0a0a;">
      <div style="background: ${o.isCashOrder ? '#0d9488' : '#ff3d00'}; color: #fff7e8; padding: 16px 20px; border-radius: 8px 8px 0 0;">
        <div style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9;">★ Nexa Events · New Order ★</div>
        <h1 style="margin: 6px 0 0; font-size: 22px; letter-spacing: -0.5px;">${escapeForHtml(ec.EVENT_NAME)}</h1>
      </div>
      <div style="background: #fff7e8; padding: 22px; border-radius: 0 0 8px 8px; border: 2px solid #0a0a0a; border-top: 0; font-size: 14px; line-height: 1.6;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 3px 0; color: #555;">Name</td><td style="padding: 3px 0; text-align: right;"><strong>${escapeForHtml(o.buyerName)}</strong></td></tr>
          <tr><td style="padding: 3px 0; color: #555;">Email</td><td style="padding: 3px 0; text-align: right;">${escapeForHtml(o.buyerEmail)}</td></tr>
          ${o.buyerPhone ? `<tr><td style="padding: 3px 0; color: #555;">Phone</td><td style="padding: 3px 0; text-align: right;">${escapeForHtml(o.buyerPhone)}</td></tr>` : ''}
          <tr><td style="padding: 3px 0; color: #555;">Tickets</td><td style="padding: 3px 0; text-align: right;"><strong>${o.quantity} × ${escapeForHtml(shortType)}</strong> @ RM${o.unitPrice}</td></tr>
          <tr><td style="padding: 3px 0; color: #555;">Total</td><td style="padding: 3px 0; text-align: right;"><strong>RM${o.totalCost}</strong></td></tr>
          <tr><td style="padding: 3px 0; color: #555;">Payment</td><td style="padding: 3px 0; text-align: right;">${escapeForHtml(method)}</td></tr>
          ${o.affiliateCode ? `<tr><td style="padding: 3px 0; color: #555;">Referral</td><td style="padding: 3px 0; text-align: right;">${escapeForHtml(o.affiliateCode)}</td></tr>` : ''}
        </table>
        ${o.paymentProof ? `<div style="margin: 14px 0 0; font-size: 13px;">Proof: ${proofIsUrl ? `<a href="${escapeForHtml(o.paymentProof)}">view screenshot</a>` : escapeForHtml(o.paymentProof)}</div>` : ''}
        <div style="margin: 16px 0 0; padding: 12px 14px; background: ${o.isCashOrder ? '#e6f7f4' : '#fff3cd'}; border: 2px solid #0a0a0a; font-size: 13px; line-height: 1.5;">
          ${o.isCashOrder ? '✅ ' : '⚠️ '}${escapeForHtml(actionLine)}
        </div>
      </div>
    </div>`;

  GmailApp.sendEmail(to, subject, textBody, { from: 'nexa.events.marketing@gmail.com', htmlBody, name: 'Nexa Events', replyTo: o.buyerEmail || undefined });
}

// ============================================================================
// ON-EDIT TRIGGER
// ============================================================================

function onEditHandler(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.PURCHASES_TAB) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const paymentCol = headers.indexOf('payment_confirmed');
  if (paymentCol === -1 || e.range.getColumn() !== paymentCol + 1) return;

  const confirmed = e.range.getValue() === true || String(e.range.getValue()).toUpperCase() === 'TRUE';
  if (!confirmed) return;

  const genCol = headers.indexOf('tickets_generated');
  const row = e.range.getRow();
  if (genCol !== -1) {
    const already = sheet.getRange(row, genCol + 1).getValue();
    if (already === true || String(already).toUpperCase() === 'TRUE') return;
  }

  const result = generateTicketsForRow(row);
  if (result && result.ok) sendTicketEmail(row);
}

// ============================================================================
// SINGLE-ROW TICKET GENERATION
// ============================================================================

function generateTicketsForRow(rowNum) {
  const ss = SpreadsheetApp.getActive();
  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  const ticketsSheet   = ss.getSheetByName(CONFIG.TICKETS_TAB);

  ensureColumn(purchasesSheet, 'event_id');
  ensureColumn(purchasesSheet, 'purchase_id');
  ensureColumn(purchasesSheet, 'purchase_key');
  ensureColumn(purchasesSheet, 'buyer_ticket_url');

  const headers = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const rowData = purchasesSheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  const tHeaders= ticketsSheet.getRange(1, 1, 1, ticketsSheet.getLastColumn()).getValues()[0];

  const pCols = {
    name:              headers.indexOf('buyer_name'),
    quantity:          headers.indexOf('quantity'),
    ticket_type:       headers.indexOf('ticket_type'),
    payment_method:    headers.indexOf('payment_method'),
    affiliate_code:    headers.indexOf('affiliate_code'),
    payment_confirmed: headers.indexOf('payment_confirmed'),
    tickets_generated: headers.indexOf('tickets_generated'),
    purchase_id:       headers.indexOf('purchase_id'),
    purchase_key:      headers.indexOf('purchase_key'),
    buyer_ticket_url:  headers.indexOf('buyer_ticket_url'),
    event_id:          headers.indexOf('event_id'),
  };

  const paid             = rowData[pCols.payment_confirmed] === true || String(rowData[pCols.payment_confirmed]).toUpperCase() === 'TRUE';
  const alreadyGenerated = rowData[pCols.tickets_generated] === true || String(rowData[pCols.tickets_generated]).toUpperCase() === 'TRUE';
  const name             = rowData[pCols.name];
  if (!paid || alreadyGenerated || !name) return { ok: false, reason: 'Not eligible' };

  const qty = parseInt(rowData[pCols.quantity], 10) || 0;
  if (qty <= 0) return { ok: false, reason: 'Quantity must be at least 1' };

  const eventId    = pCols.event_id !== -1 ? String(rowData[pCols.event_id]).trim() : '';
  const purchaseId = randomKey(12);
  const purchaseKey= randomKey(24);

  function buildTicketRow(values) {
    const row = new Array(tHeaders.length).fill('');
    for (const h in values) { const idx = tHeaders.indexOf(h); if (idx !== -1) row[idx] = values[h]; }
    return row;
  }

  const newRows = [];
  for (let j = 0; j < qty; j++) {
    newRows.push(buildTicketRow({
      ticket_id:      randomKey(16),
      purchase_id:    purchaseId,
      event_id:       eventId,
      buyer_name:     rowData[pCols.name],
      ticket_type:    rowData[pCols.ticket_type],
      payment_method: pCols.payment_method  !== -1 ? rowData[pCols.payment_method]  : '',
      affiliate_code: pCols.affiliate_code  !== -1 ? rowData[pCols.affiliate_code]  : '',
      scanned: false, scanned_at: '', scanned_by: '',
    }));
  }
  ticketsSheet.getRange(ticketsSheet.getLastRow() + 1, 1, newRows.length, tHeaders.length).setValues(newRows);

  purchasesSheet.getRange(rowNum, pCols.purchase_id      + 1).setValue(purchaseId);
  purchasesSheet.getRange(rowNum, pCols.purchase_key     + 1).setValue(purchaseKey);
  purchasesSheet.getRange(rowNum, pCols.buyer_ticket_url + 1).setValue(`${CONFIG.TICKETS_PAGE_URL}?event=${eventId}&k=${purchaseKey}`);
  purchasesSheet.getRange(rowNum, pCols.tickets_generated+ 1).setValue(true);
  if (pCols.event_id !== -1) purchasesSheet.getRange(rowNum, pCols.event_id + 1).setValue(eventId);

  return { ok: true, generated: qty };
}

// ============================================================================
// EMAIL SENDING
// ============================================================================

function sendTicketEmail(rowNum) {
  const ss = SpreadsheetApp.getActive();
  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  const headers = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const rowData = purchasesSheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];

  const emailCol         = headers.indexOf('buyer_email');
  const nameCol          = headers.indexOf('buyer_name');
  const urlCol           = headers.indexOf('buyer_ticket_url');
  const qtyCol           = headers.indexOf('quantity');
  const typeCol          = headers.indexOf('ticket_type');
  const paymentMethodCol = headers.indexOf('payment_method');
  const eventIdCol       = headers.indexOf('event_id');

  if (emailCol === -1) return { ok: false, reason: 'No buyer_email column' };
  const email     = String(rowData[emailCol]).trim();
  const ticketUrl = String(rowData[urlCol]).trim();
  const buyerName = rowData[nameCol] || '';
  const qty       = rowData[qtyCol] || 1;
  const ticketType= shortTicketType(rowData[typeCol] || 'General');
  const isCash    = paymentMethodCol !== -1 && String(rowData[paymentMethodCol]).toLowerCase().trim() === 'cash';
  const eventId   = eventIdCol !== -1 ? String(rowData[eventIdCol]).trim() : '';
  const ec        = eventId ? EVENTS[eventId] : null;

  if (!email)     return { ok: false, reason: 'No email on this row' };
  if (!ticketUrl) return { ok: false, reason: 'No buyer_ticket_url — generate tickets first' };

  const eventName    = ec ? ec.EVENT_NAME    : 'Nexa Events';
  const eventDate    = ec ? ec.EVENT_DATE    : '';
  const eventTime    = ec ? ec.EVENT_TIME    : '';
  const eventVenue   = ec ? ec.EVENT_VENUE   : '';
  const eventAddress = ec ? ec.EVENT_ADDRESS : '';

  const subject = `Your tickets — ${eventName}`;
  const textBody =
    `Hi ${buyerName},\n\n` +
    `Your ${qty} ticket${qty === 1 ? '' : 's'} (${ticketType}) for ${eventName} are ready.\n\n` +
    `View your tickets:\n${ticketUrl}\n\n` +
    `Save the link — you'll need to show each QR code at the door (one per guest).\n\n` +
    (isCash ? `PAYMENT: Please have cash ready to pay at the door.\n\n` : '') +
    (eventDate ? `See you ${eventDate} at ${eventVenue}, ${eventTime}.\n\n` : '') +
    `— Nexa Events`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #0a0a0a;">
      <div style="background: #ff3d00; color: #fff7e8; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <div style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9;">★ Nexa Events ★</div>
        <h1 style="margin: 8px 0 0; font-size: 32px; letter-spacing: -1px;">YOUR TICKETS ARE READY</h1>
      </div>
      <div style="background: #fff7e8; padding: 24px; border-radius: 0 0 8px 8px; border: 2px solid #0a0a0a; border-top: 0;">
        <p style="margin: 0 0 14px; font-size: 16px;">Hi <strong>${escapeForHtml(buyerName)}</strong>,</p>
        <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.5;">
          Your <strong>${qty} ticket${qty === 1 ? '' : 's'}</strong> (${escapeForHtml(ticketType)}) for ${escapeForHtml(eventName)} are confirmed.
        </p>
        ${isCash ? `<div style="background: #fff3cd; border: 2px solid #0a0a0a; padding: 14px 16px; margin: 0 0 18px; font-size: 13px; line-height: 1.5;">
          💵 <strong>Cash payment:</strong> Please have your cash ready to pay at the door.
        </div>` : ''}
        <div style="text-align: center; margin: 24px 0;">
          <a href="${ticketUrl}" style="display: inline-block; background: #0a0a0a; color: #c6ff3a; padding: 14px 24px; text-decoration: none; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 14px; border-radius: 4px;">View Your Tickets →</a>
        </div>
        <p style="margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #555;">
          Save this email. At the door, open the link and show each QR code to staff — one per guest.
        </p>
        ${eventDate ? `<hr style="border: 0; border-top: 1px dashed #0a0a0a; margin: 20px 0;" />
        <div style="font-size: 12px; line-height: 1.6; color: #333;">
          <strong>When:</strong> ${escapeForHtml(eventDate)}, ${escapeForHtml(eventTime)}<br/>
          <strong>Where:</strong> ${escapeForHtml(eventVenue)}<br/>
          ${escapeForHtml(eventAddress)}
        </div>` : ''}
      </div>
    </div>`;

  GmailApp.sendEmail(email, subject, textBody, { from: 'nexa.events.marketing@gmail.com', htmlBody, name: 'Nexa Events' });
  return { ok: true };
}

// ============================================================================
// AMBASSADOR SIGNUP HANDLER
// ============================================================================

function onAmbassadorSignupHandler(e) {
  if (!e || !e.values) return;

  const triggerSheet = e.range ? e.range.getSheet() : null;
  if (!triggerSheet || triggerSheet.getName() !== CONFIG.AMBASSADOR_FORM_RESPONSES_TAB) return;

  const v = e.values;
  const respHeaders = triggerSheet.getRange(1, 1, 1, triggerSheet.getLastColumn()).getValues()[0];

  const findCol = makeFindCol(respHeaders);

  const name     = findCol('name')     !== -1 ? String(v[findCol('name')]).trim()     : '';
  const email    = findCol('email')    !== -1 ? String(v[findCol('email')]).trim()    : '';
  const phone    = findCol('phone')    !== -1 ? String(v[findCol('phone')]).trim()    : '';
  const business = findCol('business') !== -1 ? String(v[findCol('business')]).trim() : '';

  const bankNameIdx    = findCol('bank name') !== -1 ? findCol('bank name') : findCol('name of bank');
  const accountNumIdx  = findCol('account number');
  const accountOwnerIdx= findCol('account owner');
  const qrIdx          = findCol('payment qr');

  let paymentDetails = '';
  const bankName     = bankNameIdx     !== -1 ? String(v[bankNameIdx]).trim()     : '';
  const accountNum   = accountNumIdx   !== -1 ? String(v[accountNumIdx]).trim()   : '';
  const accountOwner = accountOwnerIdx !== -1 ? String(v[accountOwnerIdx]).trim() : '';
  if (bankName || accountNum || accountOwner) {
    paymentDetails = `${bankName} | ${accountNum} | ${accountOwner}`;
  } else if (qrIdx !== -1 && v[qrIdx]) {
    paymentDetails = String(v[qrIdx]).trim();
  }

  recordAmbassador({ name, email, phone, business, paymentDetails });
}

/**
 * Shared ambassador-creation logic. Called by the Google Form trigger
 * (onAmbassadorSignupHandler) and by the on-site signup form POST (doPost).
 * Appends one Ambassadors row and sends the welcome email.
 * Returns { ok, error?, ambassador_page_url? }.
 */
function recordAmbassador(fields) {
  const name           = String(fields.name           || '').trim();
  const email          = String(fields.email          || '').trim();
  const phone          = String(fields.phone          || '').trim();
  const business       = String(fields.business       || '').trim();
  const paymentDetails = String(fields.paymentDetails || '').trim();

  if (!name || !email) return { ok: false, error: 'Name and email are required' };

  const ambassadorsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (!ambassadorsSheet) return { ok: false, error: 'Ambassadors tab missing' };

  const ambassadorKey = randomKey(24);
  const pageUrl = `${CONFIG.AMBASSADOR_PAGE_URL}?k=${ambassadorKey}`;

  const aHeaders = ambassadorsSheet.getRange(1, 1, 1, ambassadorsSheet.getLastColumn()).getValues()[0];
  const newRow = new Array(aHeaders.length).fill('');
  const valueMap = {
    'ambassador_key':      ambassadorKey,
    'name':                name,
    'email':               email,
    'phone':               phone,
    'business':            business,
    'payment_details':     paymentDetails,
    'tickets_sold':        0,
    'amount_earned':       0,
    'amount_paid':         0,
    'amount_owing':        0,
    'ambassador_page_url': pageUrl,
    'created_at':          new Date(),
  };
  for (let i = 0; i < aHeaders.length; i++) {
    if (valueMap.hasOwnProperty(aHeaders[i])) newRow[i] = valueMap[aHeaders[i]];
  }
  ambassadorsSheet.appendRow(newRow);

  try { sendAmbassadorWelcomeEmail(email, name, pageUrl); }
  catch (err) { Logger.log('Failed to send ambassador welcome email: ' + err); }

  return { ok: true, ambassador_page_url: pageUrl };
}

function sendAmbassadorWelcomeEmail(email, name, pageUrl) {
  const subject = `Your ambassador link — Nexa Events`;
  const textBody =
    `Hi ${name},\n\n` +
    `You're now a Nexa Events ambassador!\n\n` +
    `Your ambassador page:\n${pageUrl}\n\n` +
    `Open your page to find your personal referral QR code. Share it with anyone interested in tickets.\n` +
    `You earn a commission for every ticket confirmed through your link.\n\n` +
    `— Nexa Events`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #0a0a0a;">
      <div style="background: #ff3d00; color: #fff7e8; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <div style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9;">★ Nexa Events ★</div>
        <h1 style="margin: 8px 0 0; font-size: 28px; letter-spacing: -1px;">YOU'RE AN AMBASSADOR</h1>
      </div>
      <div style="background: #fff7e8; padding: 24px; border-radius: 0 0 8px 8px; border: 2px solid #0a0a0a; border-top: 0;">
        <p style="margin: 0 0 14px; font-size: 16px;">Hi <strong>${escapeForHtml(name)}</strong>,</p>
        <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.5;">
          Welcome to the Nexa Events ambassador program. You earn a commission for every confirmed ticket sold through your referral link.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${pageUrl}" style="display: inline-block; background: #0a0a0a; color: #c6ff3a; padding: 14px 24px; text-decoration: none; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 14px; border-radius: 4px;">Open Your Ambassador Page →</a>
        </div>
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #555;">
          Your page has a personal QR code — share it with anyone interested in tickets. Your earnings are tracked automatically — prepaid tickets count once payment clears, and cash tickets once collected at the door.
        </p>
      </div>
    </div>`;

  GmailApp.sendEmail(email, subject, textBody, { from: 'nexa.events.marketing@gmail.com', htmlBody, name: 'Nexa Events' });
}

// ============================================================================
// AMBASSADOR STATS
// ============================================================================

/**
 * Does a ticket count toward ambassador commission yet? The rule is "money is
 * actually in hand": prepaid (non-cash) tickets only exist after payment is
 * confirmed, so they count immediately; cash tickets count only once scanned
 * (i.e. cash collected + confirmed at the door).
 */
function isCredited(scannedVal, paymentMethod) {
  const scanned = scannedVal === true || String(scannedVal).toUpperCase() === 'TRUE';
  const isCash = String(paymentMethod).toLowerCase().trim() === 'cash';
  return scanned || !isCash;
}

function getAmbassadorStats(key) {
  if (!key) return { ok: false, error: 'No key' };

  const ss = SpreadsheetApp.getActive();
  const ambassadorsSheet = ss.getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (!ambassadorsSheet) return { ok: false, error: 'Ambassadors tab not found' };

  const aData = ambassadorsSheet.getDataRange().getValues();
  const aHeaders = aData[0];
  const aKeyCol      = aHeaders.indexOf('ambassador_key');
  const aNameCol     = aHeaders.indexOf('name');
  const aBusinessCol = aHeaders.indexOf('business');
  const aPaidCol     = aHeaders.indexOf('amount_paid');

  if (aKeyCol === -1) return { ok: false, error: 'ambassador_key column not found' };

  let ambassador = null;
  for (let i = 1; i < aData.length; i++) {
    if (String(aData[i][aKeyCol]).trim() === String(key).trim()) {
      ambassador = {
        name:        aData[i][aNameCol],
        business:    aData[i][aBusinessCol],
        amount_paid: parseFloat(aData[i][aPaidCol]) || 0,
      };
      break;
    }
  }
  if (!ambassador) return { ok: false, error: 'Invalid link' };

  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);
  const tData = ticketsSheet.getDataRange().getValues();
  const tHeaders       = tData[0];
  const tAffiliateCol  = tHeaders.indexOf('affiliate_code');
  const tScannedCol    = tHeaders.indexOf('scanned');
  const tEventIdCol    = tHeaders.indexOf('event_id');
  const tPaymentCol    = tHeaders.indexOf('payment_method');

  let ticketsSold = 0, amountEarned = 0;
  if (tAffiliateCol !== -1) {
    for (let i = 1; i < tData.length; i++) {
      const codeMatch = String(tData[i][tAffiliateCol]).trim() === String(key).trim();
      if (codeMatch && isCredited(tData[i][tScannedCol], tPaymentCol !== -1 ? tData[i][tPaymentCol] : '')) {
        ticketsSold++;
        const evId      = tEventIdCol !== -1 ? String(tData[i][tEventIdCol]).trim() : '';
        const commission= evId && EVENTS[evId] ? EVENTS[evId].COMMISSION_PER_TICKET : 0;
        amountEarned += commission;
      }
    }
  }

  const amountOwing = Math.max(0, amountEarned - ambassador.amount_paid);
  return {
    ok: true,
    name:                  ambassador.name,
    business:              ambassador.business,
    tickets_sold:          ticketsSold,
    amount_earned:         amountEarned,
    amount_paid:           ambassador.amount_paid,
    amount_owing:          amountOwing,
    commission_per_ticket: null, // varies per event now
  };
}

function refreshAmbassadorStats() {
  const ss = SpreadsheetApp.getActive();
  const ambassadorsSheet = ss.getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (!ambassadorsSheet) { SpreadsheetApp.getUi().alert('No Ambassadors tab found.'); return; }

  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);
  const tData = ticketsSheet.getDataRange().getValues();
  const tHeaders      = tData[0];
  const tAffiliateCol = tHeaders.indexOf('affiliate_code');
  const tScannedCol   = tHeaders.indexOf('scanned');
  const tEventIdCol   = tHeaders.indexOf('event_id');
  const tPaymentCol   = tHeaders.indexOf('payment_method');

  // Build map: affiliate_code → { count, earned }. earnedMap only counts
  // "credited" tickets (cash counts once collected at the door) — that drives
  // each ambassador's payout figures. Per-event ambassador totals now live in
  // the Summary event table (see refreshEventStats).
  const earnedMap = {};
  if (tAffiliateCol !== -1) {
    for (let i = 1; i < tData.length; i++) {
      const code    = String(tData[i][tAffiliateCol]).trim();
      if (!code) continue;
      if (isCredited(tData[i][tScannedCol], tPaymentCol !== -1 ? tData[i][tPaymentCol] : '')) {
        const evId      = tEventIdCol !== -1 ? String(tData[i][tEventIdCol]).trim() : '';
        const commission= evId && EVENTS[evId] ? EVENTS[evId].COMMISSION_PER_TICKET : 0;
        if (!earnedMap[code]) earnedMap[code] = { count: 0, earned: 0 };
        earnedMap[code].count++;
        earnedMap[code].earned += commission;
      }
    }
  }

  const aData = ambassadorsSheet.getDataRange().getValues();
  const aHeaders   = aData[0];
  const aKeyCol    = aHeaders.indexOf('ambassador_key');
  const aSoldCol   = aHeaders.indexOf('tickets_sold');
  const aEarnedCol = aHeaders.indexOf('amount_earned');
  const aPaidCol   = aHeaders.indexOf('amount_paid');
  const aOwingCol  = aHeaders.indexOf('amount_owing');

  for (let i = 1; i < aData.length; i++) {
    const key    = String(aData[i][aKeyCol]).trim();
    if (!key) continue;
    const sold   = earnedMap[key] ? earnedMap[key].count  : 0;
    const earned = earnedMap[key] ? earnedMap[key].earned : 0;
    const paid   = parseFloat(aData[i][aPaidCol]) || 0;
    const owing  = Math.max(0, earned - paid);

    if (aSoldCol   !== -1) ambassadorsSheet.getRange(i + 1, aSoldCol   + 1).setValue(sold);
    if (aEarnedCol !== -1) ambassadorsSheet.getRange(i + 1, aEarnedCol + 1).setValue(earned);
    if (aOwingCol  !== -1) ambassadorsSheet.getRange(i + 1, aOwingCol  + 1).setValue(owing);
  }

  SpreadsheetApp.getUi().alert('Ambassador stats updated.');
}

function refreshEventStats() {
  const ss = SpreadsheetApp.getActive();
  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);
  if (!ticketsSheet) { SpreadsheetApp.getUi().alert('No Tickets tab found.'); return; }

  const tData = ticketsSheet.getDataRange().getValues();
  const tHeaders     = tData[0];
  const tEventCol    = tHeaders.indexOf('event_id');
  const tScannedCol  = tHeaders.indexOf('scanned');
  const tPaymentCol  = tHeaders.indexOf('payment_method');
  const tAffiliateCol= tHeaders.indexOf('affiliate_code');
  const tTypeCol     = tHeaders.indexOf('ticket_type');
  const tBuyerCol    = tHeaders.indexOf('buyer_name');

  const eventMap = {};
  // affiliate_code → { eventId → credited commission } — used to allocate each
  // ambassador's amount_paid across their events (oldest first) for owing.
  const earnedByCodeEvent = {};
  for (let i = 1; i < tData.length; i++) {
    const eventId = tEventCol !== -1 ? String(tData[i][tEventCol]).trim() : '';
    if (!eventId) continue;
    if (!eventMap[eventId]) eventMap[eventId] = { total: 0, scanned: 0, confirmed: 0, revenue: 0, cashExpected: 0, walkins: 0, ambTickets: 0, ambEarned: 0, ambOwing: 0 };
    const m = eventMap[eventId];
    m.total++;
    if (tBuyerCol !== -1 && String(tData[i][tBuyerCol]).trim().toLowerCase() === 'walk-in') m.walkins++;
    if (tData[i][tScannedCol] === true || String(tData[i][tScannedCol]).toUpperCase() === 'TRUE') m.scanned++;
    // Confirmed = money actually in hand: prepaid tickets (which only exist once
    // payment is confirmed) plus cash tickets that were collected at the door.
    // Uncollected cash (cash + not scanned) is excluded.
    const credited = isCredited(tData[i][tScannedCol], tPaymentCol !== -1 ? tData[i][tPaymentCol] : '');
    if (credited) {
      m.confirmed++;
      // Revenue: price of each confirmed ticket. Free tickets (price 0) are
      // ignored so they don't count toward the money total.
      const price = tTypeCol !== -1 ? priceFor(tData[i][tTypeCol]) : 0;
      if (price > 0) {
        m.revenue += price;
        // Expected cash in hand at the end: for now we treat every confirmed
        // cash ticket (door orders + walk-ins) as physically collected cash.
        const isCash = tPaymentCol !== -1 && String(tData[i][tPaymentCol]).toLowerCase().trim() === 'cash';
        if (isCash) m.cashExpected += price;
      }
    }
    // Ambassador columns: ambassador_tickets is the gross count sold via a
    // referral (incl. uncollected cash); ambassador_earned is commission on
    // credited referral tickets only.
    const code = tAffiliateCol !== -1 ? String(tData[i][tAffiliateCol]).trim() : '';
    if (code) {
      m.ambTickets++;
      if (credited) {
        const commission = EVENTS[eventId] ? EVENTS[eventId].COMMISSION_PER_TICKET : 0;
        m.ambEarned += commission;
        if (!earnedByCodeEvent[code]) earnedByCodeEvent[code] = {};
        earnedByCodeEvent[code][eventId] = (earnedByCodeEvent[code][eventId] || 0) + commission;
      }
    }
  }

  // ambassador_owing per event: draw each ambassador's amount_paid (a single
  // running total on the Ambassadors tab) down against their events oldest-first,
  // then the leftover earned per event is what's still owed for that event.
  const paidByCode = {};
  const ambassadorsSheet = ss.getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (ambassadorsSheet) {
    const aData = ambassadorsSheet.getDataRange().getValues();
    const aKeyCol  = aData[0].indexOf('ambassador_key');
    const aPaidCol = aData[0].indexOf('amount_paid');
    if (aKeyCol !== -1 && aPaidCol !== -1) {
      for (let i = 1; i < aData.length; i++) {
        const k = String(aData[i][aKeyCol]).trim();
        if (k) paidByCode[k] = parseFloat(aData[i][aPaidCol]) || 0;
      }
    }
  }
  for (const code in earnedByCodeEvent) {
    let remainingPaid = paidByCode[code] || 0;
    const evIds = Object.keys(earnedByCodeEvent[code]).sort((a, b) => eventDateValue(a) - eventDateValue(b));
    for (const evId of evIds) {
      const earned  = earnedByCodeEvent[code][evId];
      const applied = Math.min(remainingPaid, earned);
      remainingPaid -= applied;
      if (eventMap[evId]) eventMap[evId].ambOwing += earned - applied;
    }
  }

  const sheet = ss.getSheetByName(CONFIG.SUMMARY_TAB);
  if (!sheet) { SpreadsheetApp.getUi().alert('No Summary tab found.'); return; }

  // One row per event, stats across columns. Rows are matched by event_id in
  // column A and updated in place. Events not currently in the Tickets tab are
  // left untouched, so an old event's row (and its numbers) survives even after
  // you delete that event's tickets.
  const HEADER = ['event_id', 'tickets_total', 'tickets_confirmed', 'tickets_scanned', 'walkin_tickets', 'tickets_revenue', 'cash_expected', 'ambassador_tickets', 'ambassador_earned', 'ambassador_owing'];
  const headerRow = findRowByColA(sheet, 'event_id');
  // Write/refresh the header so existing Summary sheets pick up new columns
  // (e.g. tickets_revenue) and stay aligned with the per-event row layout.
  if (headerRow === -1) sheet.appendRow(HEADER);
  else sheet.getRange(headerRow, 1, 1, HEADER.length).setValues([HEADER]);

  for (const eventId in eventMap) {
    const m = eventMap[eventId];
    const rowValues = [eventId, m.total, m.confirmed, m.scanned, m.walkins, m.revenue, m.cashExpected, m.ambTickets, m.ambEarned, m.ambOwing];
    const rowNum = findRowByColA(sheet, eventId);
    if (rowNum === -1) sheet.appendRow(rowValues);
    else sheet.getRange(rowNum, 1, 1, rowValues.length).setValues([rowValues]);
  }

  SpreadsheetApp.getUi().alert('Event stats updated.');
}

// Sortable timestamp from an event_id's "dd_mm_yyyy-..." prefix (0 if absent).
function eventDateValue(eventId) {
  const m = String(eventId).match(/^(\d{2})_(\d{2})_(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0;
}

// Returns the 1-based row whose column A equals key, or -1 if none.
function findRowByColA(sheet, key) {
  const last = sheet.getLastRow();
  if (last < 1) return -1;
  const colA = sheet.getRange(1, 1, last, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim() === String(key).trim()) return i + 1;
  }
  return -1;
}

// ============================================================================
// RESEND EMAIL
// ============================================================================

function resendTicketEmailPrompt() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Resend ticket email', 'Enter the row number on the Purchases tab (e.g. 5):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const rowNum = parseInt(resp.getResponseText().trim(), 10);
  if (!rowNum || rowNum < 2) { ui.alert('Invalid row number. Use 2 or higher.'); return; }
  const result = sendTicketEmail(rowNum);
  ui.alert(result.ok ? 'Email sent.' : 'Failed: ' + (result.reason || 'unknown error'));
}

// ============================================================================
// HELPERS
// ============================================================================

function ensureColumn(sheet, columnName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf(columnName) !== -1) return;
  sheet.getRange(1, sheet.getLastColumn() + 1).setValue(columnName);
}

/**
 * Builds a column-finder for a header row that matches by substring but is
 * order-independent: an exact header match wins, otherwise the SHORTEST header
 * containing the needle wins. This stops e.g. findCol('name') from grabbing
 * "Business name" when a plain "Name" column also exists, regardless of order.
 */
function makeFindCol(headers) {
  return function findCol(needle) {
    const n = needle.toLowerCase();
    let exact = -1, best = -1, bestLen = Infinity;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).toLowerCase().trim();
      if (h === n) { exact = i; break; }
      if (h.indexOf(n) !== -1 && h.length < bestLen) { best = i; bestLen = h.length; }
    }
    return exact !== -1 ? exact : best;
  };
}

function shortTicketType(t) {
  return String(t).split('—')[0].split(' - ')[0].trim();
}

function escapeForHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function randomKey(length) {
  // Seed from Utilities.getUuid() (Java SecureRandom under the hood) rather than
  // Math.random(), then map random bytes onto a readable, unambiguous alphabet.
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hex = '';
  while (hex.length < length * 2) hex += Utilities.getUuid().replace(/-/g, '');
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(parseInt(hex.substr(i * 2, 2), 16) % chars.length);
  }
  return out;
}
