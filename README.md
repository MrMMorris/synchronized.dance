# Event Ticket System — Setup Guide

A QR-code ticket system backed by a Google Sheet. The frontend is fully static, so it can be hosted free on GitHub Pages, Netlify, Cloudflare Pages, or any static host.

## What's in this folder

| File | What it is |
|---|---|
| `Code.gs` | The Google Apps Script that runs inside your Google Sheet (the "backend") |
| `scanner.html` | The page staff use at the door to scan QR codes |
| `tickets.html` | The page buyers see when they click their personal ticket link |
| `config.js` | Holds the Apps Script URL — the one place you need to update if it changes |
| `sheet-tab-1-purchases.csv` | Template for the Purchases tab of your sheet |
| `sheet-tab-2-tickets.csv` | Template for the Tickets tab of your sheet |
| `sheet-tab-3-scanners.csv` | Template for the Scanners tab of your sheet |

## How it works

1. You enter purchases in the **Purchases** tab and paste in payment screenshots.
2. When you mark a row as paid and run "Generate tickets", the script creates one row per individual ticket in the **Tickets** tab, and a personal ticket URL for the buyer.
3. You email that URL to the buyer — they open it to see all their QR codes on one page.
4. Event staff use their own personal URL (generated from the **Scanners** tab) to open the scanner page.
5. When staff scan a ticket, the script checks it against the sheet and marks it as scanned.

## Setup (about 20 minutes, one time)

### Step 1 — Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) to create a new sheet.
2. Rename the first tab to **Purchases**, then add two more tabs named **Tickets** and **Scanners**.
3. Open each `sheet-tab-*.csv` file from this folder and copy the header row (and any sample rows you want) into the matching tab. The headers must be in row 1, exactly as written.

**Purchases tab columns:**
- `buyer_name`, `buyer_email`, `quantity`, `ticket_type`, `amount_paid`
- `payment_confirmed` — set to TRUE when you've confirmed the payment
- `payment_proof` — paste screenshots of payment confirmations directly into this column (Insert → Image → Image in cell)
- `notes`
- `tickets_generated` — the script sets this to TRUE after generating tickets, so nothing runs twice

After the first time you run "Generate tickets", the script will auto-add two more columns: `purchase_key` and `buyer_ticket_url`.

**Tickets tab columns:** `ticket_id`, `buyer_name`, `buyer_email`, `ticket_type`, `scanned`, `scanned_at`, `scanned_by` — you don't fill anything here; the script populates it.

**Scanners tab columns:** `staff_name`, `staff_email`, `token`, `scanner_url`, `active`, `created_at` — you just fill in the name, email, and set `active` to TRUE. The script generates the token and URL.

### Step 2 — Add the Apps Script

1. In your sheet, go to **Extensions → Apps Script**.
2. Delete the placeholder code and paste the entire contents of `Code.gs`.
3. Save (disk icon).
4. Close the script editor and reload the sheet. You should now see a **Ticket System** menu appear next to "Help".

### Step 3 — Deploy the script as a Web App

1. Back in the Apps Script editor: **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `Ticket validator`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**. You'll be asked to authorize it — grant access to your Google account.
5. Copy the **Web app URL** that looks like `https://script.google.com/macros/s/XXXXX/exec`. You need this URL in two places next.

### Step 4 — Host the HTML pages

Any static host works. If you're using **Cloudflare Pages** (recommended):

1. Create a new GitHub repo and upload `scanner.html`, `tickets.html`, and `config.js`.
2. In Cloudflare Pages, connect the repo. Framework preset: **None**. Build command: leave blank. Build output directory: `/`.
3. Your URLs will be something like `https://yourproject.pages.dev/scanner.html` and `https://yourproject.pages.dev/tickets.html` — or your custom domain if you've attached one.

**Before committing**, open `config.js` and replace this line:

```js
window.WEB_APP_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

with the Web app URL you copied in Step 3.

This is now the **only place** the URL lives — both HTML files read it from `config.js` at load time. If you ever redeploy the Apps Script and get a new URL, you only need to update `config.js`, not the HTML files.

### Step 5 — Tell the script where your pages live

1. Back in the sheet, click **Ticket System → First-time setup**.
2. Paste in the URL of `scanner.html` when prompted.
3. Paste in the URL of `tickets.html` when prompted.

## Daily use

### Recording a purchase

1. Add a row to the Purchases tab with buyer name, email, quantity, and ticket type.
2. When payment arrives, paste the receipt/screenshot into the `payment_proof` cell (Insert → Image → Image in cell) and set `payment_confirmed` to TRUE.
3. Click **Ticket System → Generate tickets for confirmed purchases**.
4. The `buyer_ticket_url` column now has a link — email that to the buyer.

### Setting up scanner staff

1. Add rows to the Scanners tab with each staff member's name and email. Set `active` to TRUE.
2. Click **Ticket System → Generate scanner links**.
3. The `scanner_url` column now has each person's personal link. Send each staff member their own URL. Tell them to bookmark it / save it to their home screen.

### At the event

Staff open their personal scanner URL on their phone, grant camera permission, and start scanning. Results appear instantly:

- **VALID** (green) — ticket is good, admit the guest
- **ALREADY IN** (yellow) — ticket has been scanned before; shows when and by whom
- **INVALID** (red) — ticket not in system

### During / after

- **Ticket System → Show stats** gives you a live count of scanned vs. unscanned.
- **Ticket System → Reset a ticket** un-scans a ticket if someone got flagged in error.
- To revoke a staff member's access, just change their `active` column to FALSE.

## Gotchas worth knowing

- **Apps Script URL is public.** Anyone with the URL can hit the endpoint, but without a valid scanner token they just get "unauthorized". Treat the token like a password.
- **Ticket IDs are 16-character random strings** — not guessable.
- **Race condition protection:** the script uses a lock so two scanners can't admit the same ticket simultaneously.
- **Apps Script quota:** free accounts get about 20,000 URL-fetch calls per day. Unless your event is enormous, you'll be fine.
- **If you redeploy the script,** you may get a new URL — update `config.js` and push the change. To avoid new URLs entirely, use "Manage deployments" and click the pencil icon to update the *existing* deployment rather than creating a new one.
- **Buyers shouldn't share their ticket page link** — anyone with it can see the QR codes. For higher-security events, email the QR codes as images instead.

## Customizing

- **Ticket types:** just add different values in the `ticket_type` column of the Purchases tab (e.g. "VIP", "General", "Early Bird"). The scanner shows the type when validating.
- **Visual design:** both HTML pages use CSS variables at the top — tweak `--ink`, `--paper`, `--accent` etc. to match your event branding.
- **Email sending:** currently you email ticket URLs manually. If you want automation, add a `MailApp.sendEmail()` call inside `generateTickets()` in `Code.gs`.
