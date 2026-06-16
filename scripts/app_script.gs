/**
 * ============================================================================
 * EVENT TICKET SYSTEM — Google Apps Script
 * ============================================================================
 *
 * Attached to a Google Sheet with three tabs:
 *   1. Purchases — who bought tickets (you fill this in)
 *   2. Tickets   — auto-generated: one row per individual ticket
 *   3. Scanners  — staff who can validate tickets (you fill in names/emails)
 *
 * Deploy as a Web App:
 *   Deploy → New deployment → Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *   Copy the /exec URL and paste it into CONFIG.WEB_APP_URL below,
 *   then paste the same URL into scanner.html and tickets.html.
 *
 * First-time setup:
 *   1. Run setupScriptProperties() once to set your base URLs.
 *   2. Reload the sheet — you'll see a "Ticket System" menu appear.
 *   3. Use that menu to generate tickets and scanner links.
 * ============================================================================
 */

const CONFIG = {
  PURCHASES_TAB: 'Purchases',
  TICKETS_TAB: 'Tickets',
  SCANNERS_TAB: 'Scanners',
  AMBASSADORS_TAB: 'Ambassadors',
  FORM_RESPONSES_TAB: 'Form Responses 1',          // default name Google Forms creates
  AMBASSADOR_FORM_RESPONSES_TAB: 'Form Responses 2', // tab created when ambassador signup form is linked
  EVENT_NAME: 'Beach Party',
  EVENT_DATE: 'June 27',
  EVENT_TIME: '4PM – 12AM',
  EVENT_VENUE: 'Northern Cove, Penang',
  EVENT_ADDRESS: '515 Jalan C M Hashim, Tanjung Tokong, George Town',
  COMMISSION_PER_TICKET: 5, // RM per confirmed (scanned) ticket — update per event
  TICKETS_PAGE_URL:    'https://synchronized.dance/tickets.html',
  SCANNER_PAGE_URL:    'https://synchronized.dance/scanner.html',
  AMBASSADOR_PAGE_URL: 'https://synchronized.dance/ambassador.html',
  SUMMARY_TAB: 'Summary',
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
    .addSeparator()
    .addItem('First-time setup', 'setupScriptProperties')
    .addToUi();
}

// ============================================================================
// SETUP
// ============================================================================

function setupScriptProperties() {
  SpreadsheetApp.getUi().alert('No setup needed — all URLs are configured in the CONFIG object at the top of the script.');
}

// ============================================================================
// WEB APP ENDPOINTS
// ============================================================================

/**
 * Handles requests from the scanner and ticket-viewer pages.
 * Uses doGet with JSONP-style callback to avoid CORS issues with Apps Script.
 */
function doGet(e) {
  const params = e.parameter;
  const action = params.action;

  try {
    let result;
    switch (action) {
      case 'validate':
        result = validateTicket(params.ticket_id, params.token);
        break;
      case 'check_scanner':
        result = checkScanner(params.token);
        break;
      case 'get_tickets':
        result = getTicketsForBuyer(params.key);
        break;
      case 'get_ambassador':
        result = getAmbassadorStats(params.key);
        break;
      default:
        result = { ok: false, error: 'Unknown action' };
    }
    return jsonResponse(result, params.callback);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, params.callback);
  }
}

function jsonResponse(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// VALIDATION LOGIC (called by scanner page)
// ============================================================================

function validateTicket(ticketId, token) {
  if (!ticketId) return { ok: false, status: 'invalid', reason: 'No ticket ID provided' };
  if (!token) return { ok: false, status: 'unauthorized', reason: 'Missing scanner token' };

  // Use a lock to prevent two scanners double-admitting the same ticket
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    // Verify the scanner token
    const scanner = lookupScanner(token);
    if (!scanner) return { ok: false, status: 'unauthorized', reason: 'Invalid scanner token' };
    if (!scanner.active) return { ok: false, status: 'unauthorized', reason: 'Scanner token disabled' };

    // Find the ticket
    const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.TICKETS_TAB);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('ticket_id');
    const scannedCol = headers.indexOf('scanned');
    const scannedAtCol = headers.indexOf('scanned_at');
    const scannedByCol = headers.indexOf('scanned_by');
    const nameCol = headers.indexOf('buyer_name');
    const typeCol = headers.indexOf('ticket_type');
    const purchaseIdCol = headers.indexOf('purchase_id');
    const paymentTypeCol = headers.indexOf('payment_method');

    // First pass: find the ticket
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() === String(ticketId).trim()) {
        foundRow = i;
        break;
      }
    }
    if (foundRow === -1) {
      return { ok: true, status: 'invalid', reason: 'Ticket not found' };
    }

    // Compute ticket_index / ticket_total by counting rows with the same purchase_id.
    // purchase_id is a stable unique identifier per purchase, so two buyers with the
    // same name are correctly kept separate.
    let ticketIndex = 0;
    let ticketTotal = 0;
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

    const alreadyScanned = data[foundRow][scannedCol] === true || String(data[foundRow][scannedCol]).toUpperCase() === 'TRUE';
    if (alreadyScanned) {
      return {
        ok: true,
        status: 'already_scanned',
        buyer_name: data[foundRow][nameCol],
        ticket_type: shortTicketType(data[foundRow][typeCol]),
        ticket_index: ticketIndex,
        ticket_total: ticketTotal,
        scanned_at: data[foundRow][scannedAtCol],
        scanned_by: data[foundRow][scannedByCol],
      };
    }

    // Mark as scanned
    const rowNum = foundRow + 1;
    const now = new Date();
    sheet.getRange(rowNum, scannedCol + 1).setValue(true);
    const scannedAtCell = sheet.getRange(rowNum, scannedAtCol + 1);
    scannedAtCell.setValue(now);
    scannedAtCell.setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(rowNum, scannedByCol + 1).setValue(scanner.name);

    return {
      ok: true,
      status: 'valid',
      buyer_name: data[foundRow][nameCol],
      ticket_type: shortTicketType(data[foundRow][typeCol]),
      payment_method: paymentTypeCol !== -1 ? data[foundRow][paymentTypeCol] : null,
      ticket_index: ticketIndex,
      ticket_total: ticketTotal,
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
  const nameCol = headers.indexOf('staff_name');
  const tokenCol = headers.indexOf('token');
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

  // `key` is the purchase_key — a unique URL token we generate per purchase
  const purchasesSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.PURCHASES_TAB);
  const purchasesData = purchasesSheet.getDataRange().getValues();
  const pHeaders = purchasesData[0];
  const pKeyCol = pHeaders.indexOf('purchase_key');
  const pNameCol = pHeaders.indexOf('buyer_name');
  const pPurchaseIdCol = pHeaders.indexOf('purchase_id');

  if (pKeyCol === -1) return { ok: false, error: 'purchase_key column missing — run "Generate tickets" first' };
  if (pPurchaseIdCol === -1) return { ok: false, error: 'purchase_id column missing — run "Generate tickets" first' };

  let buyerName = null;
  let purchaseId = null;
  for (let i = 1; i < purchasesData.length; i++) {
    if (String(purchasesData[i][pKeyCol]).trim() === String(key).trim()) {
      buyerName = purchasesData[i][pNameCol];
      purchaseId = String(purchasesData[i][pPurchaseIdCol]).trim();
      break;
    }
  }
  if (!purchaseId) return { ok: false, error: 'Invalid link' };

  // Fetch all tickets for this purchase (matched by purchase_id)
  const ticketsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.TICKETS_TAB);
  const ticketsData = ticketsSheet.getDataRange().getValues();
  const tHeaders = ticketsData[0];
  const tIdCol = tHeaders.indexOf('ticket_id');
  const tPurchaseIdCol = tHeaders.indexOf('purchase_id');
  const tTypeCol = tHeaders.indexOf('ticket_type');
  const tScannedCol = tHeaders.indexOf('scanned');
  const tPaymentTypeCol = tHeaders.indexOf('payment_method');

  const tickets = [];
  for (let i = 1; i < ticketsData.length; i++) {
    if (String(ticketsData[i][tPurchaseIdCol]).trim() === purchaseId) {
      tickets.push({
        ticket_id: ticketsData[i][tIdCol],
        ticket_type: shortTicketType(ticketsData[i][tTypeCol]),
        payment_method: tPaymentTypeCol !== -1 ? ticketsData[i][tPaymentTypeCol] : null,
        scanned: ticketsData[i][tScannedCol] === true || String(ticketsData[i][tScannedCol]).toUpperCase() === 'TRUE',
      });
    }
  }

  return { ok: true, buyer_name: buyerName, tickets: tickets };
}

// ============================================================================
// MENU ACTIONS
// ============================================================================

function generateTickets() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const ticketsBaseUrl = CONFIG.TICKETS_PAGE_URL;

  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);

  // Ensure required columns exist on Purchases
  ensureColumn(purchasesSheet, 'purchase_id');
  ensureColumn(purchasesSheet, 'purchase_key');
  ensureColumn(purchasesSheet, 'buyer_ticket_url');

  // Re-read headers after potentially adding columns
  const pData = purchasesSheet.getDataRange().getValues();
  const pHeaders = pData[0];
  const tHeaders = ticketsSheet.getRange(1, 1, 1, ticketsSheet.getLastColumn()).getValues()[0];

  const pCols = {
    name: pHeaders.indexOf('buyer_name'),
    quantity: pHeaders.indexOf('quantity'),
    ticket_type: pHeaders.indexOf('ticket_type'),
    payment_method: pHeaders.indexOf('payment_method'),
    affiliate_code: pHeaders.indexOf('affiliate_code'),
    payment_confirmed: pHeaders.indexOf('payment_confirmed'),
    tickets_generated: pHeaders.indexOf('tickets_generated'),
    purchase_id: pHeaders.indexOf('purchase_id'),
    purchase_key: pHeaders.indexOf('purchase_key'),
    buyer_ticket_url: pHeaders.indexOf('buyer_ticket_url'),
  };

  // Build new ticket rows by looking up each column on the Tickets tab by header name.
  // This way the code keeps working even if columns are reordered or extras are added.
  function buildTicketRow(values) {
    const row = new Array(tHeaders.length).fill('');
    for (const headerName in values) {
      const idx = tHeaders.indexOf(headerName);
      if (idx !== -1) row[idx] = values[headerName];
    }
    return row;
  }

  let generated = 0;
  for (let i = 1; i < pData.length; i++) {
    const paid = pData[i][pCols.payment_confirmed] === true || String(pData[i][pCols.payment_confirmed]).toUpperCase() === 'TRUE';
    const alreadyGenerated = pData[i][pCols.tickets_generated] === true || String(pData[i][pCols.tickets_generated]).toUpperCase() === 'TRUE';
    const name = pData[i][pCols.name];

    if (!paid || alreadyGenerated || !name) continue;

    const qty = parseInt(pData[i][pCols.quantity], 10) || 0;
    if (qty <= 0) continue;

    const purchaseId = randomKey(12);   // stable internal ID linking tickets to this purchase
    const purchaseKey = randomKey(24);  // public URL token

    // Create one ticket row per quantity
    const newRows = [];
    for (let j = 0; j < qty; j++) {
      newRows.push(buildTicketRow({
        ticket_id: randomKey(16),
        purchase_id: purchaseId,
        buyer_name: pData[i][pCols.name],
        ticket_type: pData[i][pCols.ticket_type],
        payment_method: pCols.payment_method !== -1 ? pData[i][pCols.payment_method] : '',
        affiliate_code: pCols.affiliate_code !== -1 ? pData[i][pCols.affiliate_code] : '',
        scanned: false,
        scanned_at: '',
        scanned_by: '',
      }));
    }
    ticketsSheet.getRange(ticketsSheet.getLastRow() + 1, 1, newRows.length, tHeaders.length).setValues(newRows);

    // Update the purchase row
    const rowNum = i + 1;
    purchasesSheet.getRange(rowNum, pCols.purchase_id + 1).setValue(purchaseId);
    purchasesSheet.getRange(rowNum, pCols.purchase_key + 1).setValue(purchaseKey);
    purchasesSheet.getRange(rowNum, pCols.buyer_ticket_url + 1).setValue(`${ticketsBaseUrl}?k=${purchaseKey}`);
    purchasesSheet.getRange(rowNum, pCols.tickets_generated + 1).setValue(true);

    generated += qty;
  }

  ui.alert(`Done. Generated ${generated} ticket${generated === 1 ? '' : 's'}.`);
}

function generateScannerLinks() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const scannerBaseUrl = CONFIG.SCANNER_PAGE_URL;

  const sheet = ss.getSheetByName(CONFIG.SCANNERS_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const cols = {
    name: headers.indexOf('staff_name'),
    email: headers.indexOf('staff_email'),
    token: headers.indexOf('token'),
    url: headers.indexOf('scanner_url'),
    active: headers.indexOf('active'),
    created: headers.indexOf('created_at'),
  };

  let created = 0;
  for (let i = 1; i < data.length; i++) {
    const name = data[i][cols.name];
    const existingToken = data[i][cols.token];
    if (!name || existingToken) continue;

    const token = randomKey(32);
    const rowNum = i + 1;
    sheet.getRange(rowNum, cols.token + 1).setValue(token);
    sheet.getRange(rowNum, cols.url + 1).setValue(`${scannerBaseUrl}?k=${token}`);
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
  const idCol = headers.indexOf('ticket_id');
  const scannedCol = headers.indexOf('scanned');
  const scannedAtCol = headers.indexOf('scanned_at');
  const scannedByCol = headers.indexOf('scanned_by');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === ticketId) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, scannedCol + 1).setValue(false);
      sheet.getRange(rowNum, scannedAtCol + 1).setValue('');
      sheet.getRange(rowNum, scannedByCol + 1).setValue('');
      ui.alert('Ticket reset.');
      return;
    }
  }
  ui.alert('Ticket not found.');
}

function showStats() {
  const ss = SpreadsheetApp.getActive();
  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);
  const data = ticketsSheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert('No tickets generated yet.');
    return;
  }
  const headers = data[0];
  const scannedCol = headers.indexOf('scanned');
  const typeCol = headers.indexOf('ticket_type');

  let total = 0, scanned = 0;
  const byType = {};
  for (let i = 1; i < data.length; i++) {
    total++;
    const type = data[i][typeCol] || 'Unknown';
    if (!byType[type]) byType[type] = { total: 0, scanned: 0 };
    byType[type].total++;
    if (data[i][scannedCol] === true || String(data[i][scannedCol]).toUpperCase() === 'TRUE') {
      scanned++;
      byType[type].scanned++;
    }
  }

  let msg = `Total tickets: ${total}\nScanned: ${scanned}\nUnscanned: ${total - scanned}\n\nBy type:\n`;
  for (const type in byType) {
    msg += `  ${type}: ${byType[type].scanned}/${byType[type].total}\n`;
  }
  SpreadsheetApp.getUi().alert(msg);
}

// ============================================================================
// FORM SUBMIT HANDLER
// ============================================================================

/**
 * Runs automatically when a new Google Form response lands in the linked
 * "Form Responses 1" tab. Copies the response into the Purchases tab.
 * Cash orders: auto-confirmed — sets payment_confirmed TRUE and sends tickets
 * immediately. QR orders: leaves payment_confirmed FALSE and sends an order
 * confirmation email; organizer must manually flip the field to send tickets.
 *
 * Install this trigger ONCE manually:
 *   Apps Script editor → Triggers (clock icon) → Add Trigger
 *     Choose function:        onFormSubmitHandler
 *     Event source:           From spreadsheet
 *     Event type:             On form submit
 *
 * Why we don't use the built-in onFormSubmit name: the simple trigger of
 * that name can't send email (no auth scope). The installable trigger we
 * set up above runs with full auth so we can write to other tabs.
 */
function onFormSubmitHandler(e) {
  if (!e || !e.values) return;

  // Guard: only run for the ticket purchase form, not the ambassador signup form
  const triggerSheet = e.range ? e.range.getSheet() : null;
  if (!triggerSheet || triggerSheet.getName() !== CONFIG.FORM_RESPONSES_TAB) return;

  const ss = SpreadsheetApp.getActive();
  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  if (!purchasesSheet) return;

  // Map Form Responses columns to our Purchases columns.
  // Google Forms always writes them in this order:
  //   [0] Timestamp
  //   [1] Email (if collected by form)
  //   [2..] Each question in the order they appear in the form
  //
  // Expected form question order (configure your form to match):
  //   1. Full name
  //   2. Email address
  //   3. Ticket type
  //   4. Quantity
  //   5. Payment screenshot (file upload)
  //
  // The timestamp is e.values[0]. Then the responses follow.
  // If you collect email via Form settings (separate from a question), it
  // lands at e.values[1] and everything shifts by one. We auto-detect.

  const v = e.values;
  // Heuristic: if there are 6 values and v[1] looks like an email but the form
  // also asked for email as a question, Forms put the auto-collected email at
  // index 1 and the question email later. Otherwise standard mapping.
  let buyerName, buyerEmail, ticketType, quantity, paymentProof;

  if (v.length >= 6) {
    // Auto-collected email + 5 questions
    buyerEmail = v[2];          // email question
    buyerName  = v[1];          // ... no wait, this depends on order
  }
  // Safer: ignore heuristics, use the form's response sheet headers to map.
  const responsesSheet = e.range ? e.range.getSheet() : ss.getSheetByName(CONFIG.FORM_RESPONSES_TAB);
  if (!responsesSheet) return;
  const respHeaders = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];

  // Find each field by header text (case-insensitive substring match)
  function findCol(needle) {
    const n = needle.toLowerCase();
    for (let i = 0; i < respHeaders.length; i++) {
      if (String(respHeaders[i]).toLowerCase().indexOf(n) !== -1) return i;
    }
    return -1;
  }

  const nameIdx          = findCol('name');
  const emailIdx         = findCol('email');
  const typeIdx          = findCol('ticket type');
  const qtyIdx           = findCol('quantity');
  const screenshotIdx    = findCol('screenshot') !== -1 ? findCol('screenshot') : findCol('proof');
  const paymentMethodIdx = findCol('payment method');
  const referralIdx      = findCol('referral');

  buyerName    = nameIdx          !== -1 ? v[nameIdx]                               : '';
  buyerEmail   = emailIdx         !== -1 ? v[emailIdx]                              : '';
  ticketType   = typeIdx          !== -1 ? v[typeIdx]                               : 'General';
  quantity     = qtyIdx           !== -1 ? parseInt(v[qtyIdx], 10) || 1             : 1;
  paymentProof = screenshotIdx    !== -1 ? v[screenshotIdx]                         : '';
  const rawPaymentType = paymentMethodIdx !== -1 ? String(v[paymentMethodIdx]).toLowerCase().trim() : '';
  const paymentType = rawPaymentType.startsWith('cash') ? 'cash' : rawPaymentType.startsWith('qr') ? 'qr' : rawPaymentType;
  const affiliateCode  = referralIdx !== -1 ? String(v[referralIdx]).trim() : '';

  // Calculate total cost from ticket type + quantity
  const unitPrice = priceFor(ticketType);
  const totalCost = unitPrice * quantity;

  // Cash orders are auto-confirmed — no payment screenshot to verify
  const isCashOrder = paymentType === 'cash';

  // Build the row to insert, respecting current Purchases column order
  const purchaseHeaders = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const newRow = new Array(purchaseHeaders.length).fill('');
  const valueMap = {
    'buyer_name': buyerName,
    'buyer_email': buyerEmail,
    'buyer_phone': '',         // not collected; left blank
    'ticket_type': ticketType,
    'quantity': quantity,
    'amount_paid': totalCost,  // calculated — verify against screenshot
    'payment_method': paymentType,
    'payment_confirmed': isCashOrder,
    'payment_proof': paymentProof,
    'affiliate_code': affiliateCode,
    'notes': 'Auto-imported from form',
    'purchase_time': new Date(),
    'tickets_generated': false,
  };
  for (let i = 0; i < purchaseHeaders.length; i++) {
    const h = purchaseHeaders[i];
    if (valueMap.hasOwnProperty(h)) newRow[i] = valueMap[h];
  }

  purchasesSheet.appendRow(newRow);

  if (isCashOrder) {
    // Generate tickets immediately and send the ticket email — no manual verification needed
    try {
      const newRowNum = purchasesSheet.getLastRow();
      const result = generateTicketsForRow(newRowNum);
      if (result && result.ok) {
        sendTicketEmail(newRowNum);
      }
    } catch (err) {
      Logger.log('Failed to auto-generate cash tickets: ' + err);
    }
  } else if (buyerEmail) {
    // QR orders: send order confirmation; organizer verifies screenshot before tickets are sent
    try {
      sendOrderConfirmationEmail(buyerEmail, buyerName, ticketType, quantity, unitPrice, totalCost);
    } catch (err) {
      Logger.log('Failed to send confirmation email: ' + err);
    }
  }
}

/**
 * Returns the unit price (in RM) for a given ticket type label.
 * Update here if you ever change prices. Falls back to 0 if unknown.
 */
function priceFor(ticketType) {
  const t = String(ticketType).toLowerCase();
  if (t.indexOf('food') !== -1) return 100;          // "Admission + Food Tasting"
  if (t.indexOf('general') !== -1) return 50;        // "General Admission"
  return 0;
}

/**
 * Confirmation email sent immediately after form submission. Confirms what
 * they ordered and reminds them tickets will be delivered to this email
 * address once payment is verified.
 */
function sendOrderConfirmationEmail(email, name, ticketType, quantity, unitPrice, totalCost) {
  const subject = `Order received — ${CONFIG.EVENT_NAME}`;
  const textBody =
    `Hi ${name},\n\n` +
    `We received your ticket request for ${CONFIG.EVENT_NAME}.\n\n` +
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
        <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.5;">
          Thanks for your order. Here's a summary:
        </p>
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
    </div>
  `;

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: textBody,
    htmlBody: htmlBody,
    name: 'Nexa Events',
  });
}

// ============================================================================
// ON-EDIT TRIGGER: auto-generate tickets + email when payment confirmed
// ============================================================================

/**
 * Runs automatically when any cell in the sheet is edited. Watches for the
 * specific case of "payment_confirmed" being flipped to TRUE on a Purchases
 * row that hasn't had tickets generated yet — and when that happens,
 * generates the tickets and emails the buyer their ticket link.
 *
 * Install this trigger ONCE manually (same as onFormSubmitHandler):
 *   Apps Script editor → Triggers → Add Trigger
 *     Choose function:        onEditHandler
 *     Event source:           From spreadsheet
 *     Event type:             On edit
 */
function onEditHandler(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.PURCHASES_TAB) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const paymentCol = headers.indexOf('payment_confirmed');
  if (paymentCol === -1) return;
  if (e.range.getColumn() !== paymentCol + 1) return;

  const newValue = e.range.getValue();
  const confirmed = newValue === true || String(newValue).toUpperCase() === 'TRUE';
  if (!confirmed) return;

  // Skip if tickets already generated for this row
  const genCol = headers.indexOf('tickets_generated');
  const row = e.range.getRow();
  if (genCol !== -1) {
    const already = sheet.getRange(row, genCol + 1).getValue();
    if (already === true || String(already).toUpperCase() === 'TRUE') return;
  }

  // Generate tickets for this row and send email
  const result = generateTicketsForRow(row);
  if (result && result.ok) {
    sendTicketEmail(row);
  }
}

// ============================================================================
// SINGLE-ROW TICKET GENERATION (extracted from generateTickets)
// ============================================================================

/**
 * Generates tickets for a specific Purchases row (1-indexed, e.g. row 2 is
 * the first data row). Returns {ok, generated, reason}. Idempotent — won't
 * generate if already done.
 */
function generateTicketsForRow(rowNum) {
  const ss = SpreadsheetApp.getActive();
  const ticketsBaseUrl = CONFIG.TICKETS_PAGE_URL;

  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);

  ensureColumn(purchasesSheet, 'purchase_id');
  ensureColumn(purchasesSheet, 'purchase_key');
  ensureColumn(purchasesSheet, 'buyer_ticket_url');

  const headers = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const rowData = purchasesSheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  const tHeaders = ticketsSheet.getRange(1, 1, 1, ticketsSheet.getLastColumn()).getValues()[0];

  const pCols = {
    name: headers.indexOf('buyer_name'),
    quantity: headers.indexOf('quantity'),
    ticket_type: headers.indexOf('ticket_type'),
    payment_method: headers.indexOf('payment_method'),
    affiliate_code: headers.indexOf('affiliate_code'),
    payment_confirmed: headers.indexOf('payment_confirmed'),
    tickets_generated: headers.indexOf('tickets_generated'),
    purchase_id: headers.indexOf('purchase_id'),
    purchase_key: headers.indexOf('purchase_key'),
    buyer_ticket_url: headers.indexOf('buyer_ticket_url'),
  };

  const paid = rowData[pCols.payment_confirmed] === true || String(rowData[pCols.payment_confirmed]).toUpperCase() === 'TRUE';
  const alreadyGenerated = rowData[pCols.tickets_generated] === true || String(rowData[pCols.tickets_generated]).toUpperCase() === 'TRUE';
  const name = rowData[pCols.name];
  if (!paid || alreadyGenerated || !name) return { ok: false, reason: 'Not eligible (not paid, already generated, or no name)' };

  const qty = parseInt(rowData[pCols.quantity], 10) || 0;
  if (qty <= 0) return { ok: false, reason: 'Quantity must be at least 1' };

  function buildTicketRow(values) {
    const row = new Array(tHeaders.length).fill('');
    for (const headerName in values) {
      const idx = tHeaders.indexOf(headerName);
      if (idx !== -1) row[idx] = values[headerName];
    }
    return row;
  }

  const purchaseId = randomKey(12);
  const purchaseKey = randomKey(24);

  const newRows = [];
  for (let j = 0; j < qty; j++) {
    newRows.push(buildTicketRow({
      ticket_id: randomKey(16),
      purchase_id: purchaseId,
      buyer_name: rowData[pCols.name],
      ticket_type: rowData[pCols.ticket_type],
      payment_method: pCols.payment_method !== -1 ? rowData[pCols.payment_method] : '',
      affiliate_code: pCols.affiliate_code !== -1 ? rowData[pCols.affiliate_code] : '',
      scanned: false,
      scanned_at: '',
      scanned_by: '',
    }));
  }
  ticketsSheet.getRange(ticketsSheet.getLastRow() + 1, 1, newRows.length, tHeaders.length).setValues(newRows);

  purchasesSheet.getRange(rowNum, pCols.purchase_id + 1).setValue(purchaseId);
  purchasesSheet.getRange(rowNum, pCols.purchase_key + 1).setValue(purchaseKey);
  purchasesSheet.getRange(rowNum, pCols.buyer_ticket_url + 1).setValue(`${ticketsBaseUrl}?k=${purchaseKey}`);
  purchasesSheet.getRange(rowNum, pCols.tickets_generated + 1).setValue(true);

  return { ok: true, generated: qty };
}

// ============================================================================
// EMAIL SENDING
// ============================================================================

/**
 * Sends the ticket link via email to the buyer on a specific Purchases row.
 * Looks up buyer_email and buyer_ticket_url on the row.
 */
function sendTicketEmail(rowNum) {
  const ss = SpreadsheetApp.getActive();
  const purchasesSheet = ss.getSheetByName(CONFIG.PURCHASES_TAB);
  const headers = purchasesSheet.getRange(1, 1, 1, purchasesSheet.getLastColumn()).getValues()[0];
  const rowData = purchasesSheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];

  const emailCol = headers.indexOf('buyer_email');
  const nameCol = headers.indexOf('buyer_name');
  const urlCol = headers.indexOf('buyer_ticket_url');
  const qtyCol = headers.indexOf('quantity');
  const typeCol = headers.indexOf('ticket_type');
  const paymentMethodCol = headers.indexOf('payment_method');

  if (emailCol === -1) return { ok: false, reason: 'No buyer_email column on Purchases tab' };
  const email = String(rowData[emailCol]).trim();
  const ticketUrl = String(rowData[urlCol]).trim();
  const buyerName = rowData[nameCol] || '';
  const qty = rowData[qtyCol] || 1;
  const ticketType = shortTicketType(rowData[typeCol] || 'General');
  const isCash = paymentMethodCol !== -1 && String(rowData[paymentMethodCol]).toLowerCase().trim() === 'cash';

  if (!email) return { ok: false, reason: 'No email on this row' };
  if (!ticketUrl) return { ok: false, reason: 'No buyer_ticket_url — generate tickets first' };

  const subject = `Your tickets — ${CONFIG.EVENT_NAME}`;
  const textBody =
    `Hi ${buyerName},\n\n` +
    `Your ${qty} ticket${qty === 1 ? '' : 's'} (${ticketType}) for ${CONFIG.EVENT_NAME} are ready.\n\n` +
    `View your tickets:\n${ticketUrl}\n\n` +
    `Save the link — you'll need to show each QR code at the door (one per guest).\n\n` +
    (isCash ? `PAYMENT: Please have cash ready to pay at the door when you present your ticket.\n\n` : '') +
    `See you ${CONFIG.EVENT_DATE} at ${CONFIG.EVENT_VENUE}, ${CONFIG.EVENT_TIME}.\n\n` +
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
          Your <strong>${qty} ticket${qty === 1 ? '' : 's'}</strong> (${escapeForHtml(ticketType)}) for ${CONFIG.EVENT_NAME} are confirmed.
        </p>
        ${isCash ? `<div style="background: #fff3cd; border: 2px solid #0a0a0a; padding: 14px 16px; margin: 0 0 18px; font-size: 13px; line-height: 1.5;">
          💵 <strong>Cash payment:</strong> Please have your cash ready to pay at the door when you present your ticket.
        </div>` : ''}
        <div style="text-align: center; margin: 24px 0;">
          <a href="${ticketUrl}" style="display: inline-block; background: #0a0a0a; color: #c6ff3a; padding: 14px 24px; text-decoration: none; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 14px; border-radius: 4px;">View Your Tickets →</a>
        </div>
        <p style="margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #555;">
          Save this email. At the door, open the link and show each QR code to staff — one per guest.
        </p>
        <hr style="border: 0; border-top: 1px dashed #0a0a0a; margin: 20px 0;" />
        <div style="font-size: 12px; line-height: 1.6; color: #333;">
          <strong>When:</strong> ${CONFIG.EVENT_DATE}, ${CONFIG.EVENT_TIME}<br/>
          <strong>Where:</strong> ${CONFIG.EVENT_VENUE}<br/>
          ${CONFIG.EVENT_ADDRESS}
        </div>
      </div>
    </div>
  `;

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: textBody,
    htmlBody: htmlBody,
    name: 'Nexa Events',
  });
  return { ok: true };
}

// ============================================================================
// AMBASSADOR SIGNUP HANDLER
// ============================================================================

/**
 * Triggered when the ambassador signup form is submitted. Creates a row in
 * the Ambassadors tab and emails the new ambassador their unique page URL.
 *
 * Install as a separate trigger (same spreadsheet, On form submit):
 *   Choose function: onAmbassadorSignupHandler
 */
function onAmbassadorSignupHandler(e) {
  if (!e || !e.values) return;

  // Guard: only run for the ambassador signup form
  const triggerSheet = e.range ? e.range.getSheet() : null;
  if (!triggerSheet || triggerSheet.getName() !== CONFIG.AMBASSADOR_FORM_RESPONSES_TAB) return;

  const ss = SpreadsheetApp.getActive();
  const ambassadorsSheet = ss.getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (!ambassadorsSheet) return;

  const v = e.values;
  const respHeaders = triggerSheet.getRange(1, 1, 1, triggerSheet.getLastColumn()).getValues()[0];

  function findCol(needle) {
    const n = needle.toLowerCase();
    for (let i = 0; i < respHeaders.length; i++) {
      if (String(respHeaders[i]).toLowerCase().indexOf(n) !== -1) return i;
    }
    return -1;
  }

  const name            = findCol('name')     !== -1 ? String(v[findCol('name')]).trim()     : '';
  const email           = findCol('email')    !== -1 ? String(v[findCol('email')]).trim()    : '';
  const phone           = findCol('phone')    !== -1 ? String(v[findCol('phone')]).trim()    : '';
  const business        = findCol('business') !== -1 ? String(v[findCol('business')]).trim() : '';
  // Collect whichever payment detail field was filled in
  const bankNameIdx    = findCol('bank name');
  const accountNumIdx  = findCol('account number');
  const accountOwnerIdx = findCol('account owner');
  const qrIdx          = findCol('payment qr');

  let paymentDetails = '';
  const bankName    = bankNameIdx    !== -1 ? String(v[bankNameIdx]).trim()    : '';
  const accountNum  = accountNumIdx  !== -1 ? String(v[accountNumIdx]).trim()  : '';
  const accountOwner = accountOwnerIdx !== -1 ? String(v[accountOwnerIdx]).trim() : '';
  if (bankName || accountNum || accountOwner) {
    paymentDetails = `${bankName} | ${accountNum} | ${accountOwner}`;
  } else if (qrIdx !== -1 && v[qrIdx]) {
    paymentDetails = String(v[qrIdx]).trim();
  }

  if (!name || !email) return;

  const ambassadorPageBase = CONFIG.AMBASSADOR_PAGE_URL;
  const ambassadorKey = randomKey(24);
  const pageUrl = ambassadorPageBase ? `${ambassadorPageBase}?k=${ambassadorKey}` : '';

  const aHeaders = ambassadorsSheet.getRange(1, 1, 1, ambassadorsSheet.getLastColumn()).getValues()[0];
  const newRow = new Array(aHeaders.length).fill('');
  const valueMap = {
    'ambassador_key':     ambassadorKey,
    'name':               name,
    'email':              email,
    'phone':              phone,
    'business':           business,
    'payment_details':    paymentDetails,
    'tickets_sold':       0,
    'amount_earned':      0,
    'amount_paid':        0,
    'amount_owing':       0,
    'ambassador_page_url': pageUrl,
    'created_at':         new Date(),
  };
  for (let i = 0; i < aHeaders.length; i++) {
    if (valueMap.hasOwnProperty(aHeaders[i])) newRow[i] = valueMap[aHeaders[i]];
  }
  ambassadorsSheet.appendRow(newRow);

  if (email && pageUrl) {
    try {
      sendAmbassadorWelcomeEmail(email, name, pageUrl);
    } catch (err) {
      Logger.log('Failed to send ambassador welcome email: ' + err);
    }
  }
}

function sendAmbassadorWelcomeEmail(email, name, pageUrl) {
  const subject = `Your ambassador link — ${CONFIG.EVENT_NAME}`;
  const textBody =
    `Hi ${name},\n\n` +
    `You're now an ambassador for ${CONFIG.EVENT_NAME}!\n\n` +
    `Your ambassador page:\n${pageUrl}\n\n` +
    `Open your page to find your personal referral QR code. Share it with anyone interested in tickets.\n` +
    `You earn RM${CONFIG.COMMISSION_PER_TICKET} for every ticket confirmed through your link.\n\n` +
    `Confirmed means: the ticket was scanned at the door (cash) or payment was verified (QR).\n\n` +
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
          Welcome to the ${CONFIG.EVENT_NAME} ambassador program. You earn
          <strong>RM${CONFIG.COMMISSION_PER_TICKET} per confirmed ticket</strong> sold through your link.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${pageUrl}" style="display: inline-block; background: #0a0a0a; color: #c6ff3a; padding: 14px 24px; text-decoration: none; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 14px; border-radius: 4px;">Open Your Ambassador Page →</a>
        </div>
        <p style="margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #555;">
          Your page has a personal QR code — share it with anyone interested in tickets. Your earnings are tracked automatically once tickets are confirmed at the door.
        </p>
        <hr style="border: 0; border-top: 1px dashed #0a0a0a; margin: 20px 0;" />
        <div style="font-size: 12px; line-height: 1.6; color: #333;">
          <strong>When:</strong> ${CONFIG.EVENT_DATE}, ${CONFIG.EVENT_TIME}<br/>
          <strong>Where:</strong> ${CONFIG.EVENT_VENUE}<br/>
          ${CONFIG.EVENT_ADDRESS}
        </div>
      </div>
    </div>
  `;

  MailApp.sendEmail({ to: email, subject: subject, body: textBody, htmlBody: htmlBody, name: 'Nexa Events' });
}

// ============================================================================
// AMBASSADOR STATS
// ============================================================================

/**
 * API action: returns live stats for an ambassador by their ambassador_key.
 * Ticket counts are computed from the Tickets tab at query time.
 */
function getAmbassadorStats(key) {
  if (!key) return { ok: false, error: 'No key' };

  const ss = SpreadsheetApp.getActive();
  const ambassadorsSheet = ss.getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (!ambassadorsSheet) return { ok: false, error: 'Ambassadors tab not found' };

  const aData = ambassadorsSheet.getDataRange().getValues();
  const aHeaders = aData[0];
  const aKeyCol     = aHeaders.indexOf('ambassador_key');
  const aNameCol    = aHeaders.indexOf('name');
  const aBusinessCol = aHeaders.indexOf('business');
  const aPaidCol    = aHeaders.indexOf('amount_paid');

  let ambassador = null;
  for (let i = 1; i < aData.length; i++) {
    if (String(aData[i][aKeyCol]).trim() === String(key).trim()) {
      ambassador = {
        name:         aData[i][aNameCol],
        business:     aData[i][aBusinessCol],
        amount_paid:  parseFloat(aData[i][aPaidCol]) || 0,
      };
      break;
    }
  }
  if (!ambassador) return { ok: false, error: 'Invalid link' };

  // Count scanned tickets referencing this ambassador key
  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);
  const tData = ticketsSheet.getDataRange().getValues();
  const tHeaders = tData[0];
  const tAffiliateCol = tHeaders.indexOf('affiliate_code');
  const tScannedCol   = tHeaders.indexOf('scanned');

  let ticketsSold = 0;
  if (tAffiliateCol !== -1) {
    for (let i = 1; i < tData.length; i++) {
      const codeMatch = String(tData[i][tAffiliateCol]).trim() === String(key).trim();
      const scanned   = tData[i][tScannedCol] === true || String(tData[i][tScannedCol]).toUpperCase() === 'TRUE';
      if (codeMatch && scanned) ticketsSold++;
    }
  }

  const amountEarned = ticketsSold * CONFIG.COMMISSION_PER_TICKET;
  const amountOwing  = Math.max(0, amountEarned - ambassador.amount_paid);

  return {
    ok: true,
    name:                 ambassador.name,
    business:             ambassador.business,
    tickets_sold:         ticketsSold,
    amount_earned:        amountEarned,
    amount_paid:          ambassador.amount_paid,
    amount_owing:         amountOwing,
    commission_per_ticket: CONFIG.COMMISSION_PER_TICKET,
  };
}

/**
 * Menu action: writes computed stats back to the Ambassadors tab so the
 * organizer can see totals in the sheet without opening each ambassador page.
 */
function refreshAmbassadorStats() {
  const ss = SpreadsheetApp.getActive();
  const ambassadorsSheet = ss.getSheetByName(CONFIG.AMBASSADORS_TAB);
  if (!ambassadorsSheet) {
    SpreadsheetApp.getUi().alert('No Ambassadors tab found.');
    return;
  }

  const ticketsSheet = ss.getSheetByName(CONFIG.TICKETS_TAB);
  const tData = ticketsSheet.getDataRange().getValues();
  const tHeaders = tData[0];
  const tAffiliateCol = tHeaders.indexOf('affiliate_code');
  const tScannedCol   = tHeaders.indexOf('scanned');

  // Build map: affiliate_code → scanned ticket count
  const countMap = {};
  if (tAffiliateCol !== -1) {
    for (let i = 1; i < tData.length; i++) {
      const code    = String(tData[i][tAffiliateCol]).trim();
      const scanned = tData[i][tScannedCol] === true || String(tData[i][tScannedCol]).toUpperCase() === 'TRUE';
      if (code && scanned) countMap[code] = (countMap[code] || 0) + 1;
    }
  }

  const aData = ambassadorsSheet.getDataRange().getValues();
  const aHeaders = aData[0];
  const aKeyCol    = aHeaders.indexOf('ambassador_key');
  const aSoldCol   = aHeaders.indexOf('tickets_sold');
  const aEarnedCol = aHeaders.indexOf('amount_earned');
  const aPaidCol   = aHeaders.indexOf('amount_paid');
  const aOwingCol  = aHeaders.indexOf('amount_owing');

  let totalEarned = 0, totalPaid = 0, totalOwing = 0;

  for (let i = 1; i < aData.length; i++) {
    const key  = String(aData[i][aKeyCol]).trim();
    if (!key) continue;
    const sold   = countMap[key] || 0;
    const earned = sold * CONFIG.COMMISSION_PER_TICKET;
    const paid   = parseFloat(aData[i][aPaidCol]) || 0;
    const owing  = Math.max(0, earned - paid);

    if (aSoldCol   !== -1) ambassadorsSheet.getRange(i + 1, aSoldCol   + 1).setValue(sold);
    if (aEarnedCol !== -1) ambassadorsSheet.getRange(i + 1, aEarnedCol + 1).setValue(earned);
    if (aOwingCol  !== -1) ambassadorsSheet.getRange(i + 1, aOwingCol  + 1).setValue(owing);

    totalEarned += earned;
    totalPaid   += paid;
    totalOwing  += owing;
  }

  // Write totals to Summary tab
  updateSummaryRow(ss, 'Ambassador payouts — earned', totalEarned);
  updateSummaryRow(ss, 'Ambassador payouts — paid',   totalPaid);
  updateSummaryRow(ss, 'Ambassador payouts — owing',  totalOwing);

  SpreadsheetApp.getUi().alert('Ambassador stats updated.');
}

/**
 * Finds a row in the Summary tab where column A matches `label` and sets
 * column B to `value`. If no matching row exists, appends a new one.
 */
function updateSummaryRow(ss, label, value) {
  const sheet = ss.getSheetByName(CONFIG.SUMMARY_TAB);
  if (!sheet) return; // Summary tab doesn't exist yet — silently skip

  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === label) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  // Label not found — append a new row
  sheet.appendRow([label, value]);
}

function shortTicketType(t) {
  return String(t).split('—')[0].split(' - ')[0].trim();
}

function escapeForHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================================
// MENU ACTION: resend ticket email
// ============================================================================

function resendTicketEmailPrompt() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Resend ticket email',
    'Enter the row number on the Purchases tab to resend (e.g. 5):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const rowNum = parseInt(resp.getResponseText().trim(), 10);
  if (!rowNum || rowNum < 2) {
    ui.alert('Invalid row number. Use 2 or higher (row 1 is headers).');
    return;
  }
  const result = sendTicketEmail(rowNum);
  if (result.ok) {
    ui.alert('Email sent.');
  } else {
    ui.alert('Failed: ' + (result.reason || 'unknown error'));
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function ensureColumn(sheet, columnName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf(columnName) !== -1) return;
  sheet.getRange(1, sheet.getLastColumn() + 1).setValue(columnName);
}

function randomKey(length) {
  // Excludes visually ambiguous characters: 0/O/o, 1/I/l. Prevents transcription errors
  // when keys get copied by hand, read aloud, or sent through systems that reformat URLs.
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
