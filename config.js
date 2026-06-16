// ============================================================================
// CONFIG — the one place to set your Apps Script Web App URL.
// ============================================================================
// Paste your deployed Apps Script /exec URL here. Both scanner.html and
// tickets.html read this value at load time, so you only update it here
// when you change the Apps Script deployment.
//
// To get this URL: Apps Script editor → Deploy → Manage deployments →
// copy the Web App URL (it should end in /exec, not /dev).
// ============================================================================

window.WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyGjcOc-GEDjtzzZoWuQPhteJfSRTDImAyCCYfz5vNxUkygm4IGAW-bIBRuwS2etqh0Zg/exec';

// Ambassador program — fill these in after setting up the forms
window.TICKET_FORM_BASE_URL       = 'https://docs.google.com/forms/d/1il7Xf6GXyt2RfDfWaCnIcvjNxx2Zh9-B7klLnv8Iw5g/viewform';
window.TICKET_FORM_PREFILL_ENTRY  = 'entry.799019575'; // Form → ⋮ → Get pre-filled link → fill Referral Code → Get link → copy entry.XXXXXXXXXX
window.AMBASSADOR_SIGNUP_FORM_URL = 'https://synchronized.dance/join';
