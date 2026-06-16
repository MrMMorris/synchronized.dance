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
Attendee visits tickets.html?k=<purchase_key>
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
| `index.html` | Landing page — poster, map link, Google Form link |
| `signup.html` | Email list signup (Brevo form only, same styles as index.html) |
| `tickets.html` | Buyer-facing ticket viewer — shows QR codes per ticket |
| `scanner.html` | Door staff scanner — uses camera to scan QR codes |
| `scripts/app_script.gs` | Google Apps Script (local copy only — see Deployment below) |
| `config.js` | **NOT committed to git** — holds `WEB_APP_URL` |
| `assets/poster.webp` | Current event poster (`?v=N` cache-bust param in index.html) |
| `assets/background.mp4` | Looping background video for index.html |
| `assets/background.jpg` | Fallback static background for index.html |
| `_headers` | Cloudflare Pages response headers |
| `wrangler.jsonc` | Cloudflare Pages config |

---

## config.js (not in git)

This file must exist alongside the HTML files on the hosted server. It is excluded from git to avoid committing the Apps Script URL publicly.

```javascript
window.WEB_APP_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

Both `tickets.html` and `scanner.html` load it via `<script src="config.js">` and read `window.WEB_APP_URL`.

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
- `onEditHandler` — trigger type: **From spreadsheet → On edit**

---

## Google Sheet Structure

### Tabs

| Tab | Purpose |
|---|---|
| `Purchases` | One row per form submission / purchase |
| `Tickets` | One row per individual ticket (multiple per purchase) |
| `Scanners` | One row per scanner token (for door staff auth) |
| `Form Responses 1` | Raw Google Form responses (don't modify) |

### Purchases tab — critical columns

| Column | Notes |
|---|---|
| `purchase_id` | Unique ID for the purchase |
| `purchase_key` | Secret key used in the buyer's ticket URL (`?k=`) |
| `payment_method` | `qr` or `cash` — normalized in `onFormSubmitHandler` |
| `payment_confirmed` | Set to `TRUE` by organizer to trigger ticket generation + email |
| `tickets_generated` | Set to `TRUE` by script after `generateTicketsForRow` runs |
| `buyer_ticket_url` | Full URL sent in the email |

### Tickets tab — critical columns

| Column | Notes |
|---|---|
| `ticket_id` | The string encoded in the QR code |
| `purchase_id` | Foreign key back to Purchases |
| `ticket_type` | Full form option text (e.g. "General Admission — RM55 (...)") |
| `payment_method` | Copied from Purchases at ticket generation — must exist in this tab |
| `scanned` | Set to `TRUE` when validated at the door |

**Important:** `payment_method` must be a column in the **Tickets** tab, not just Purchases. The API reads from Tickets for `validate` and `get_tickets` responses.

### Scanners tab

Each row has a token that door staff use in their URL (`scanner.html?k=<token>`). The `check_scanner` action validates this token.

---

## Apps Script: CONFIG Object

At the top of `app_script.gs`, update this object for each new event:

```javascript
const CONFIG = {
  PURCHASES_TAB: 'Purchases',
  TICKETS_TAB: 'Tickets',
  SCANNERS_TAB: 'Scanners',
  FORM_RESPONSES_TAB: 'Form Responses 1',
  EVENT_NAME: 'Beach Party',
  EVENT_DATE: 'June 27',
  EVENT_TIME: '4PM – 12AM',
  EVENT_VENUE: 'Northern Cove, Penang',
  EVENT_ADDRESS: '515 Jalan C M Hashim, Tanjung Tokong, George Town',
};
```

`EVENT_*` values are used in the ticket confirmation email. The hardcoded event details in the `event-info` section and footer of `tickets.html` must also be updated manually per event.

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

## Google Forms Notes

- Conditional logic (show/hide questions based on previous answer) is supported natively via the form editor — useful for showing a QR upload field only if QR payment is selected
- Forms cannot be version-controlled in git; changes are made directly in the form editor
- The form must include a "Payment method" field (case-insensitive — `findCol()` in the script handles it)

---

## Hosting

Deployed on **Cloudflare Pages** (see `wrangler.jsonc`). Static files only — no server-side logic. The `_headers` file sets response headers (caching, security).

`config.js` must be manually uploaded or set as an environment secret/file since it is not in git.
