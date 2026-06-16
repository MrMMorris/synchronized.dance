# synchronized.dance — System Reference

This is an event ticketing system for dance parties. It is deliberately minimal: no backend server, no database — just Google Forms, Google Sheets, Google Apps Script, and static HTML pages hosted on Cloudflare Pages.

---

## Architecture Overview

**Cash orders** (no upfront payment — pay at door):
```
Attendee fills Google Form (chooses Cash)
        ↓
onFormSubmitHandler: writes row to Purchases with payment_confirmed = TRUE
        ↓
Immediately generates tickets + sends ticket email
        ↓
Attendee visits tickets.html?event=<event_id>&k=<purchase_key>
        ↓
Door staff scans QR → cash modal → swipe to confirm + mark scanned
```

**QR orders** (prepay via bank transfer):
```
Attendee fills Google Form (chooses QR, uploads screenshot)
        ↓
Google Sheet (Purchases tab) — row written with payment_confirmed = FALSE
        ↓
Organizer verifies screenshot, manually sets payment_confirmed = TRUE
        ↓
Apps Script onEdit trigger fires → generates tickets → sends ticket email
        ↓
Attendee visits tickets.html?k=<purchase_key>
        ↓
Door staff scans QR with scanner.html?k=<scanner_token>
        ↓
Apps Script validates + marks ticket as scanned
```

---

## File Structure

| File | Role |
|---|---|
| `index.html` | Landing page — lists active event buttons + email signup form |
| `signup.html` | Email list signup (standalone page, same Brevo form as index.html) |
| `tickets.html` | Buyer-facing ticket viewer — loads per-event theme, shows QR codes |
| `scanner.html` | Door staff scanner — validates tickets across all active events |
| `ambassador.html` | Ambassador dashboard — per-event referral QRs + live earnings stats |
| `ambassador-signup.html` | Pitch page the organizer shows to potential ambassadors |
| `events.json` | Registry of all events — read by index.html and ambassador.html at runtime |
| `events/<event_id>/` | Per-event folder (see Event Folder Structure below) |
| `scripts/app_script.gs` | Google Apps Script (local copy only — see Deployment below) |
| `config.js` | Committed to git — holds `WEB_APP_URL` and `AMBASSADOR_SIGNUP_FORM_URL` |
| `_redirects` | Cloudflare Pages redirect rules (e.g. `/join` → ambassador signup form) |
| `assets/` | Shared assets: NEXA logo, background video/image, Google Maps icon |
| `_headers` | Cloudflare Pages response headers |
| `wrangler.jsonc` | Cloudflare Pages config |

### Event Folder Structure

Each event lives in `events/<event_id>/` where `event_id` follows the convention:
`<dd_mm_yyyy>-<event_name>-<genre_genre_genre>`

Example: `events/27_06_2026-beach_party-afrohouse_amapiano_deep_house/`

| File | Role |
|---|---|
| `poster.webp` | Event poster image (provided by organizer) |
| `theme.css` | CSS variable overrides + body background for this event's palette |
| `index.html` | Event landing page — poster, map link, ticket purchase button |

Cloudflare Pages serves `events/<event_id>/index.html` at the URL `/events/<event_id>/`.

`tickets.html` loads the theme via `<link rel="stylesheet" href="/events/<event_id>/theme.css">` — injected early (before API call) from the `?event=` URL param, and also after the API returns the event object.

---

## New Event Setup Procedure

When the user says "set up a new event" and points to an event folder (or creates one), follow these steps in order. This is the authoritative checklist for Claude to use in future sessions.

### Step 1 — Parse the folder name
Folder: `events/<dd_mm_yyyy>-<event_name>-<genre_genre_genre>/`
Extract: date, event name (spaces from underscores), genres list.

### Step 2 — Analyze the poster
Read `events/<event_id>/poster.webp` visually. Identify dominant colors. Generate `events/<event_id>/theme.css` with matching CSS vars and body background. See **CSS Theming Guide** below for the exact variables to set.

### Step 3 — Ask the user for these details
- Google Maps URL for the venue
- Ticket form URL (the `viewform` URL of the new Google Form for this event)
- Ticket form prefill entry ID (see "Getting the Referral Code pre-fill entry ID" in Ambassador Program section)
- Event time (e.g. `4PM – 12AM`)
- Venue name (display name)
- Venue address (full address for emails)
- Artists/headliners (for the event-info section on tickets)
- Confirm genres match the folder name

### Step 4 — Create `events/<event_id>/index.html`
Event landing page. Use the same structure as `events/27_06_2026-beach_party-afrohouse_amapiano_deep_house/index.html` as a template. Update: title, meta description, date, event name, venue info, form URL, maps URL.

### Step 5 — Update `events.json`
Add a new entry to the array. Required fields:
```json
{
  "id": "<event_id>",
  "date_iso": "YYYY-MM-DD",
  "date_display": "Month DD",
  "name": "Event Name",
  "genres": ["Genre1", "Genre2"],
  "time": "Xpm – Yam",
  "venue": "Venue Name",
  "address": "Full address",
  "maps_url": "https://maps.app.goo.gl/...",
  "ticket_form_url": "https://docs.google.com/forms/d/.../viewform",
  "ticket_form_prefill_entry": "entry.XXXXXXXXXX",
  "accent_color": "#rrggbb"
}
```
Pick `accent_color` from the poster's dominant warm hue.

### Step 6 — Update `scripts/app_script.gs` CONFIG
Change these fields to match the new event:
- `EVENT_ID`: new event folder name
- `EVENT_NAME`, `EVENT_DATE`, `EVENT_TIME`, `EVENT_VENUE`, `EVENT_ADDRESS`
- `FORM_RESPONSES_TAB`: name of the new form's response tab in the spreadsheet (usually "Form Responses 3" etc.)
- `COMMISSION_PER_TICKET`: confirm with user

### Step 7 — Output the manual checklist
Print this for the user:
```
Manual steps remaining:
[ ] Copy updated app_script.gs to Google Apps Script editor → Deploy new version
[ ] Create new Google Form for this event (ticket types, prices, payment method, referral code field)
[ ] Link the new form to the spreadsheet (Form editor → Responses → Link to spreadsheet)
[ ] Add event_id column to Purchases tab (if not already there)
[ ] Add event_id column to Tickets tab (if not already there)
[ ] Update FORM_RESPONSES_TAB in CONFIG to match the new form responses tab name
[ ] Install onFormSubmitHandler trigger for the new responses tab
[ ] Get the referral code prefill entry ID and confirm it matches events.json
[ ] Copy poster.webp into events/<event_id>/ if not already there
```

---

## config.js

This file is committed to git. It holds URLs that the HTML pages read at load time.

```javascript
window.WEB_APP_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
window.AMBASSADOR_SIGNUP_FORM_URL = 'https://synchronized.dance/join';
```

`tickets.html`, `scanner.html`, `ambassador.html`, and `ambassador-signup.html` all load `config.js` via `<script src="config.js">`.

Per-event ticket form URLs and prefill entry IDs now live in `events.json`, not `config.js`. `ambassador.html` fetches `events.json` at runtime to build per-event referral QRs.

---

## Google Apps Script Deployment

**The file `scripts/app_script.gs` is a local copy only.** Changes here do NOT automatically update the live system.

To deploy changes:
1. Open the Google Apps Script project in the browser editor
2. Paste the updated contents of `app_script.gs`
3. Click **Deploy → Manage deployments → New version** (do NOT edit the existing deployment — create a new version under the same deployment ID)
4. The `/exec` URL stays the same across versions

Triggers that must be manually set up in the Apps Script editor:
- `onFormSubmitHandler` — trigger type: **From spreadsheet → On form submit**
- `onAmbassadorSignupHandler` — trigger type: **From spreadsheet → On form submit**
- `onEditHandler` — trigger type: **From spreadsheet → On edit**

**Re-authorization after script changes:** If you add new Google service calls (e.g. switching from `MailApp` to `GmailApp`), the script needs new OAuth scopes. After deploying, open the Apps Script editor, select any function in the dropdown, and click **Run** — this triggers the authorization prompt. Click **Review permissions → Allow**.

---

## Google Sheet Structure

### Tabs

| Tab | Purpose |
|---|---|
| `Purchases` | One row per form submission / purchase |
| `Tickets` | One row per individual ticket (multiple per purchase) |
| `Scanners` | One row per scanner token (for door staff auth) |
| `Ambassadors` | One row per ambassador — keys, stats, payment details |
| `Summary` | Organizer-facing totals — updated by "Refresh ambassador stats" |
| `Form Responses 1` | Raw ticket purchase form responses (don't modify) |
| `Form Responses 2` | Raw ambassador signup form responses (don't modify) |

### Purchases tab — critical columns

| Column | Notes |
|---|---|
| `event_id` | Matches the event folder name — written from `CONFIG.EVENT_ID` |
| `purchase_id` | Unique ID for the purchase |
| `purchase_key` | Secret key used in the buyer's ticket URL (`?event=...&k=`) |
| `payment_method` | `qr` or `cash` — normalized in `onFormSubmitHandler` |
| `payment_confirmed` | Set to `TRUE` by organizer to trigger ticket generation + email |
| `tickets_generated` | Set to `TRUE` by script after `generateTicketsForRow` runs |
| `buyer_ticket_url` | Full URL sent in the email — includes `?event=<EVENT_ID>&k=<key>` |

### Tickets tab — critical columns

| Column | Notes |
|---|---|
| `event_id` | Copied from Purchases at ticket generation — matches event folder name |
| `ticket_id` | The string encoded in the QR code |
| `purchase_id` | Foreign key back to Purchases |
| `ticket_type` | Full form option text (e.g. "General Admission — RM55 (...)") |
| `payment_method` | Copied from Purchases at ticket generation — must exist in this tab |
| `affiliate_code` | Copied from Purchases at ticket generation — must exist for ambassador tracking |
| `scanned` | Set to `TRUE` when validated at the door |

**Important:** `payment_method` and `affiliate_code` must be columns in the **Tickets** tab, not just Purchases. The API reads from Tickets for validation responses, and ambassador stats only count tickets where `affiliate_code` matches AND `scanned = TRUE`.

### Scanners tab

Each row has a token that door staff use in their URL (`scanner.html?k=<token>`). The `check_scanner` action validates this token.

### Ambassadors tab — critical columns

| Column | Notes |
|---|---|
| `ambassador_key` | Secret token — used as both the URL key (`ambassador.html?k=`) and the affiliate code stored in Purchases/Tickets |
| `name` | From signup form |
| `email` | From signup form |
| `phone` | From signup form |
| `business` | From signup form |
| `payment_details` | Bank details or QR file link — from signup form |
| `tickets_sold` | Updated by "Refresh ambassador stats" menu action |
| `amount_earned` | `tickets_sold × COMMISSION_PER_TICKET` — updated by menu action |
| `amount_paid` | Organizer fills in manually after payout |
| `amount_owing` | `amount_earned - amount_paid` — updated by menu action |
| `ambassador_page_url` | Full URL to `ambassador.html?k=TOKEN` — generated on signup |
| `created_at` | Signup timestamp |

**Also add to Purchases tab:** `affiliate_code` — populated from the "Referral Code" field in the ticket purchase form (or empty if no referral).

**Also add to Tickets tab:** `affiliate_code` — copied from Purchases at ticket generation time, same as `payment_method`.

### Purchases tab — affiliate tracking

`affiliate_code` stores the `ambassador_key` of the referring ambassador. It comes from the "Referral Code" field in the Google Form, which ambassadors' QR codes pre-fill automatically.

---

## Apps Script: CONFIG Object

At the top of `app_script.gs`, update this object for each new event:

```javascript
const CONFIG = {
  PURCHASES_TAB: 'Purchases',
  TICKETS_TAB: 'Tickets',
  SCANNERS_TAB: 'Scanners',
  AMBASSADORS_TAB: 'Ambassadors',
  SUMMARY_TAB: 'Summary',
  FORM_RESPONSES_TAB: 'Form Responses 1',           // ticket purchase form responses tab
  AMBASSADOR_FORM_RESPONSES_TAB: 'Form Responses 2', // ambassador signup form responses tab
  EVENT_ID:    '27_06_2026-beach_party-afrohouse_amapiano_deep_house', // matches events/ folder name
  EVENT_NAME:  'Beach Party',
  EVENT_DATE:  'June 27',
  EVENT_TIME:  '4PM – 12AM',
  EVENT_VENUE: 'Northern Cove, Penang',
  EVENT_ADDRESS: '515 Jalan C M Hashim, Tanjung Tokong, George Town',
  COMMISSION_PER_TICKET: 5, // RM per confirmed (scanned) ticket sold via ambassador
  TICKETS_PAGE_URL:    'https://synchronized.dance/tickets.html',
  SCANNER_PAGE_URL:    'https://synchronized.dance/scanner.html',
  AMBASSADOR_PAGE_URL: 'https://synchronized.dance/ambassador.html',
};
```

`EVENT_*` values are used in ticket emails and the `get_tickets` API response. The `tickets.html` event-info section and footer are now populated from `resp.event` (returned by the API), so they update automatically when CONFIG is updated.

`EVENT_ID` must match the event folder name exactly — it's included in `buyer_ticket_url` (`?event=<EVENT_ID>&k=<key>`) and written to the `event_id` column in both Purchases and Tickets tabs.

---

## API Endpoints

The Apps Script is deployed as a web app and responds to GET requests with JSON.

### `?action=check_scanner&k=<token>`
Validates a scanner token. Returns `{ok: true, name: "..."}` or `{ok: false}`.

### `?action=get_tickets&k=<purchase_key>`
Returns all tickets for a purchase:
```json
{
  "ok": true,
  "buyer_name": "Jane",
  "tickets": [
    {
      "ticket_id": "ABC123",
      "ticket_type": "General Admission",
      "payment_method": "cash",
      "scanned": false
    }
  ]
}
```

### `?action=validate&id=<ticket_id>&k=<scanner_token>`
Validates a scanned ticket. Uses a script lock to prevent double-admit. Returns:
```json
{
  "ok": true,
  "status": "valid",
  "buyer_name": "Jane",
  "ticket_type": "General Admission",
  "payment_method": "cash",
  "pos": "1 of 2"
}
```
Possible `status` values: `valid`, `used`, `invalid`

### `?action=get_ambassador&key=<ambassador_key>`
Returns live stats for an ambassador. Ticket counts are computed from the Tickets tab at query time.
```json
{
  "ok": true,
  "name": "Jane",
  "business": "Zouk KL",
  "tickets_sold": 5,
  "amount_earned": 25,
  "amount_paid": 0,
  "amount_owing": 25,
  "commission_per_ticket": 5
}
```

**Debugging tip:** The `/exec` URL redirects, so DevTools Network tab shows "no content." To see the raw JSON, copy the full request URL and paste it directly into a browser tab.

---

## Payment Flow (Cash vs QR)

Google Form has a "Payment method" multiple-choice field with options like "QR" and "Cash (pay at the door)".

`onFormSubmitHandler` normalizes the value:
```javascript
rawPaymentType.startsWith('cash') ? 'cash' : rawPaymentType.startsWith('qr') ? 'qr' : rawPaymentType
```
So any cash-flavored option stores as `cash`, any QR-flavored option stores as `qr`.

This value flows: **Purchases tab → Tickets tab → API responses → frontend**.

### Cash orders — auto-confirmed on form submit

Cash orders skip the manual verification step. In `onFormSubmitHandler`:
- `payment_confirmed` is written as `true` immediately
- `generateTicketsForRow` and `sendTicketEmail` are called right away
- No order confirmation email is sent — the ticket email is the only email

The organizer does **not** need to touch the sheet for cash orders. The buyer receives their QR tickets immediately with a note to pay cash at the door.

### QR orders — organizer confirms manually

- `payment_confirmed` is written as `false`
- Organizer verifies the payment screenshot, then sets `payment_confirmed = TRUE` in the sheet
- `onEditHandler` fires, generates tickets, and sends the ticket email
- An order confirmation email is sent at form submit time to acknowledge receipt

### tickets.html (buyer view)
- Cash tickets show a yellow `💵 Pay Cash at Door` banner below the QR
- The status pill reads "Cash Due" (styled differently) instead of "Live"

### scanner.html (door staff)
- Cash tickets trigger a special modal with a swipe-to-confirm gesture
- Swiping calls the same `validate` endpoint, marking the ticket as scanned
- Non-cash tickets show the result in a normal modal requiring an OK tap

---

## Ticket Type Display

The full Google Form option text (e.g. `"General Admission — RM55 (Includes one free drink)"`) is stored in the sheet as-is. The function `shortTicketType()` in Apps Script strips everything from the em dash or ` - ` onward:

```javascript
function shortTicketType(t) {
  return String(t).split('—')[0].split(' - ')[0].trim();
}
```

This shortened label is what the API returns in `ticket_type` and what shows on the scanner modal, the ticket page status pills, and in the email subject.

---

## CSS Theming Guide

When a new event poster is provided, update the color palette in both `scanner.html` and `tickets.html` to match the poster's vibe. Both files share an identical CSS variable system.

### Variables to update (`:root` block, near top of `<style>`)

```css
:root {
  --night: #080c1a;      /* darkest background — usually keep very dark */
  --ember: #0d1630;      /* secondary background layer */
  --amber: #ff7035;      /* primary warm accent — buttons, dots, highlights */
  --amber-deep: #c84a00; /* darker shade of amber — hover states */
  --gold: #ffc547;       /* secondary highlight — taglines, labels */
  --gold-soft: #ffad3b;  /* softer gold — secondary text accents */
  --flame: #ff4c00;      /* intense accent — error states, particle dots */
  --teal: #0d9488;       /* success/valid color — "scanned" badges, progress */
  --teal-deep: #065f46;  /* darker teal — gradient end in valid badges */
  --red: #ce1126;        /* invalid/rejected — "used" ticket badges */
  --cream: #f4e8d4;      /* body text, light headings */
}
```

**What each variable drives:**
- `--amber` / `--gold`: tagline text, dot separators, QR code frames, event name accents
- `--teal`: "valid" scan modal, "Live" status pill, scanning indicator glow
- `--red`: "invalid"/"used" scan modal (keep red for error clarity)
- `--night` / `--ember`: page background base colors
- `--cream`: all body text — keep light for readability on dark bg

### Body background gradients to update

In `body { background: ... }`, the raw RGBA values reference the poster's dominant colors. Change these to match the new palette:

```css
body {
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(255, 120, 50, 0.4) 0%, transparent 55%),
    /* ↑ warm glow at top — use the poster's dominant warm hue */
    radial-gradient(ellipse 100% 70% at 50% 35%, rgba(200, 70, 0, 0.2) 0%, transparent 60%),
    /* ↑ mid-page warmth — slightly darker variant of above */
    radial-gradient(ellipse 60% 40% at 80% 80%, rgba(13, 148, 136, 0.18) 0%, transparent 60%),
    /* ↑ cool accent bottom-right — use the poster's secondary cool hue */
    linear-gradient(180deg, var(--ember) 0%, var(--night) 60%, var(--ember) 100%);
    /* ↑ base layer — driven by --ember and --night vars */
}
```

### Particle dots (`tickets.html` only — `body::after`)

These are tiny dot accents scattered across the top half. Update the colors inline:
```css
body::after {
  background-image:
    radial-gradient(circle 2px at 15% 20%, var(--gold), transparent),
    radial-gradient(circle 1px at 80% 30%, var(--teal), transparent),
    /* ... etc — driven by vars, no raw values to change */
}
```
These update automatically when you change `--gold`, `--teal`, `--amber`, `--flame`.

### Noise overlay (`body::before`)

The SVG noise texture in `body::before` stays the same regardless of theme — it's a subtle grain effect. The `feColorMatrix` inside it has hardcoded warm-tint values (`1 0.7 0.3`) which can be adjusted if the new theme is very cool/blue, but usually leave it.

### index.html

`index.html` does not use the CSS variable system — it uses raw `background.jpg`/`background.mp4`. For a new event:
- Replace `assets/poster.webp` with the new poster
- Bump the cache-bust version: `src="assets/poster.webp?v=2"`
- Replace `assets/background.mp4` / `assets/background.jpg` if there's new atmosphere footage
- Update the Google Form link (`href` on the ticket button)
- Update the Google Maps link (`href` on the map icon)

---

## Ambassador Program

Ambassadors are people or businesses who refer ticket buyers and earn a commission per confirmed (scanned) ticket.

### Flow

1. Organizer opens `ambassador-signup.html` and shows it to a potential ambassador — they scan the QR to open the signup form.
2. Ambassador fills the signup form → `onAmbassadorSignupHandler` fires → creates row in Ambassadors tab → sends welcome email with their unique `ambassador.html?k=TOKEN` URL.
3. Ambassador opens their page, finds their referral QR, and shares it. The QR encodes the ticket purchase form URL with their key pre-filled in the "Referral Code" field.
4. Buyers scan the ambassador's QR → land on the ticket purchase form with the Referral Code already filled in. They complete the purchase normally.
5. `onFormSubmitHandler` reads the Referral Code and stores it as `affiliate_code` in the Purchases row. `generateTicketsForRow` copies it to each Ticket row.
6. At the door, when a ticket is scanned (and cash is paid for cash orders), it becomes "confirmed." The ambassador's stats update automatically — `get_ambassador` counts scanned Tickets with matching `affiliate_code`.
7. After the event, organizer runs **Ticket System → Refresh ambassador stats** to update the Ambassadors tab, then pays out based on `amount_owing` using the `payment_details` on file.

### Triggers required

Two form-submit triggers must be installed in the Apps Script editor:
- `onFormSubmitHandler` — fired by ticket purchase form
- `onAmbassadorSignupHandler` — fired by ambassador signup form

Both are "From spreadsheet → On form submit" triggers. Each function checks `e.range.getSheet().getName()` against `CONFIG.FORM_RESPONSES_TAB` / `CONFIG.AMBASSADOR_FORM_RESPONSES_TAB` to guard against cross-firing.

### No script properties required

All page URLs (`TICKETS_PAGE_URL`, `SCANNER_PAGE_URL`, `AMBASSADOR_PAGE_URL`) live directly in the `CONFIG` object at the top of `app_script.gs`. The **First-time setup** menu item now just shows a confirmation — no manual property setting is needed.

### Getting the Referral Code pre-fill entry ID

After adding the "Referral Code" field to the ticket purchase form:
1. Form → ⋮ menu → **Get pre-filled link**
2. Type any value in Referral Code → **Get link** → copy URL
3. Extract the `entry.XXXXXXXXXX` part
4. Add to `config.js`: `window.TICKET_FORM_PREFILL_ENTRY = 'entry.XXXXXXXXXX'`

The ambassador QR encodes: `TICKET_FORM_BASE_URL + '?' + TICKET_FORM_PREFILL_ENTRY + '=' + ambassadorKey`

---

## Email Sending

All emails (ticket confirmation, order confirmation, ambassador welcome) are sent via `GmailApp.sendEmail()` with:
```javascript
from: 'nexa.events.marketing@gmail.com',
name: 'Nexa Events',
```

**Setup required for the `from:` alias to work:**
1. In your personal Gmail: Settings → See all settings → **Accounts and Import** → **Send mail as** → add `nexa.events.marketing@gmail.com` and verify it
2. After deploying a script version that uses `GmailApp`, run any function manually in the Apps Script editor to trigger re-authorization (GmailApp requires the `gmail.send` OAuth scope)

If emails send but arrive from the wrong address, the alias isn't verified or the script hasn't been re-authorized.

---

## Google Forms Notes

- Conditional logic (show/hide questions based on previous answer) is supported natively via the form editor — useful for showing a QR upload field only if QR payment is selected
- Forms cannot be version-controlled in git; changes are made directly in the form editor
- The form must include a "Payment method" field (case-insensitive — `findCol()` in the script handles it)
- The referral/affiliate code field is matched by searching for "referral" or "ambassador" as a substring — the question can be named e.g. "Referral Code (ignore)" or "Ambassador code (Ignore)"
- Ambassador signup bank detail fields are matched by: "bank name" or "name of bank", "account number", "account owner" — order of words in the question title doesn't matter

---

## Hosting

Deployed on **Cloudflare Pages** (see `wrangler.jsonc`). Static files only — no server-side logic. The `_headers` file sets response headers (caching, security).

`config.js` is committed to git and deployed automatically with the rest of the site.

### Redirects (`_redirects`)

Cloudflare Pages processes `_redirects` at the repo root. Current rules:

| From | To | Notes |
|---|---|---|
| `/join` | Google ambassador signup form | QR codes and `ambassador-signup.html` point here — update this line if the form URL ever changes, then push |

Set `window.AMBASSADOR_SIGNUP_FORM_URL = 'https://synchronized.dance/join'` in `config.js` so the QR on `ambassador-signup.html` encodes the short URL, not the raw Google Form link.
