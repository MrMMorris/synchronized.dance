# Google Form Setup Guide — Ticket Purchases

> ℹ️ **Optional / legacy.** Purchases now run through the on-site form `buy.html`,
> which POSTs straight to the Apps Script (`doPost`) — no Google account or login
> required for buyers, and QR screenshots upload directly. You only need this
> Google Form guide if you specifically want to keep running a Google Form
> alongside it. Both paths share the same `recordPurchase` backend.

This guide walks you through setting up a public Google Form so buyers can self-serve, while you only need to verify their payment screenshot.

## Overview of the new flow

1. Buyer fills out the form (name, email, ticket type, quantity, payment screenshot)
2. **Buyer immediately gets a confirmation email** with their order summary and a reminder that tickets will arrive at that address once payment is verified
3. A new row auto-appears in your **Purchases** tab with `amount_paid` pre-calculated and `payment_confirmed = FALSE`
4. You open the payment screenshot link, verify the amount matches `amount_paid`
5. You tick `payment_confirmed = TRUE` on that row
6. Script auto-generates the tickets AND emails the buyer their ticket link
7. Done — no manual copy/paste of URLs

## About the total cost

The buyer sees pricing in the form itself — the ticket type options show the unit price (e.g. "General Admission — RM50"). They calculate their own total before paying.

When the form is submitted, the script auto-calculates `amount_paid` and writes it into the new Purchases row, so you have a target to verify against the screenshot at a glance. The buyer also receives the calculated total in their confirmation email.

Pricing logic lives in the `priceFor()` function in `app_script.gs`. It now reads the price straight out of the ticket-type label (e.g. `General Admission — RM55` → 55), so as long as each option includes `RMxx` you don't need to touch the code when prices change. It only falls back to hardcoded keyword values (general = RM50, food = RM100) if a label has no `RMxx` in it.

## Step 1 — Add a `buyer_email` column to Purchases

If you don't already have one, add the column header `buyer_email` somewhere on your Purchases tab. The script needs this to know where to send tickets.

You can keep `buyer_phone` too — the script just reads `buyer_email` for sending. Phone stays for day-of contact.

## Step 2 — Create the Google Form

Go to [forms.new](https://forms.new) to create a new form. Title it something like "Labour Day Beach Party — Tickets".

In **Settings** (gear icon) → **Responses**:
- ✅ **Collect email addresses** — turn this OFF. We'll collect email via a question instead, so the buyer sees it as a normal field.
- ✅ Allow response editing — turn OFF (don't want them editing after payment).
- ✅ Limit to 1 response — turn OFF (people might buy multiple times for different groups).

In **Settings** → **Defaults**:
- Make question required by default — ON.

Now add these questions **in this exact order** (the script matches by header text, but order keeps the form clean):

### Question 1: Full name
- Type: **Short answer**
- Required: yes

### Question 2: Email address
- Type: **Short answer**
- Required: yes
- Click the three dots → Response validation → Text → Email address

### Question 3: Ticket type
- Type: **Multiple choice** (or Dropdown)
- Required: yes
- Options:
  - `General Admission — RM50`
  - `Admission + Food Tasting — RM100`

### Question 4: Quantity
- Type: **Dropdown**
- Required: yes
- Options: `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`

### Question 5: Payment screenshot
- Type: **File upload**
- Required: yes
- (You'll be prompted to enable file uploads — accept it)
- Allow only specific file types: image files
- Maximum 1 file
- Max file size: 10 MB is plenty

Above question 5, you might want to add a section header or description telling them what bank/account to send to and the QR code, so they can pay before uploading the screenshot.

## Step 3 — Link the form to your sheet

In the form editor, click the **Responses** tab → click the green Sheets icon → **Select existing spreadsheet** → pick your ticket system spreadsheet.

This creates a new tab in your sheet (e.g. **Form Responses 1**). **Rename this tab to the event ID** (e.g. `27_06_2026-beach_party`). The current multi-event script matches the tab name against the `EVENTS` map in `app_script.gs` — that lookup is how a submission is tied to an event, so the tab name must equal the event ID exactly. (The older single-event version looked for the literal name "Form Responses 1"; that's no longer the case.)

Submit a test response to make sure the new tab works.

## Step 4 — Install the two Apps Script triggers

Go to Apps Script editor (Extensions → Apps Script in your sheet).

In the left sidebar, click the **clock icon (Triggers)**.

**Trigger 1 — handle new form submissions:**
- Click **+ Add Trigger** (bottom right)
- Function: `onFormSubmitHandler`
- Event source: **From spreadsheet**
- Event type: **On form submit**
- Click Save (you'll be asked to authorize — grant access)

**Trigger 2 — auto-generate + email on confirmation:**
- Click **+ Add Trigger** again
- Function: `onEditHandler`
- Event source: **From spreadsheet**
- Event type: **On edit**
- Click Save

That's it. Both triggers are now live.

## Step 5 — Test the full flow

1. Open your Google Form (use the "Preview" eye icon or copy the live link)
2. Submit a test response — use your own email so you can verify the delivery
3. Check the Purchases tab. A new row should appear with your test data and `payment_confirmed = FALSE`
4. The `payment_proof` cell should have a link to the uploaded screenshot
5. Click `payment_confirmed` to TRUE
6. Within a few seconds, you should see `tickets_generated = TRUE` and a `buyer_ticket_url` filled in
7. Check your email — you should have a "Your tickets — Labour Day Beach Party" message with the ticket link

If anything stalls, check Apps Script editor → **Executions** (clock-with-list icon in left sidebar) — that shows every trigger run and any errors.

## Daily use after setup

- Buyers buy tickets via the form URL (share it on social media, posters, etc.)
- You glance at Purchases periodically, click the screenshot link to verify payment
- Tick `payment_confirmed = TRUE` → ticket email goes out automatically
- If something needs a fix (wrong amount, weird screenshot, etc.) you can leave it unconfirmed and message them yourself

## Sharing the form

Click **Send** in the form editor → copy the link. Pick a short version with the copy icon. You can also generate a QR code for the form link if you want to put it on the poster.

## Common issues

**Form submissions don't appear in Purchases:** Check that the trigger is installed (Triggers panel in Apps Script). Also check Executions — there may be an error.

**Payment screenshot link doesn't open:** By default, form uploads land in your Google Drive and are only accessible to you. That's fine for verifying — you just need to be logged into the right Google account. If you want buyers or scanner staff to also see the file, you'd need to change file permissions, but for verification purposes, you-only is perfect.

**Buyer didn't receive the email:** Check the spam folder. Apps Script email comes from your Gmail account, but new senders can sometimes get filtered. Tell buyers to whitelist your address.

**Apps Script email quota:** Free Gmail accounts can send ~100 emails/day via Apps Script. Way more than enough for an event, but worth knowing if you're doing thousands.

**Form question text doesn't match what the script looks for:** The script looks for headers containing the words "name", "email", "ticket type", "quantity", and "screenshot" or "payment" (case-insensitive). If you rename questions, keep one of these keywords in each.
