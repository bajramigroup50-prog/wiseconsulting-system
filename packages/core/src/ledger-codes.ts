/** Codes in the built-in chart have 2–10 digits; user-created accounts 3–8 digits (legacy saveAcc/saveOpen). */
export const ACCOUNT_CODE_RE = /^\d{2,10}$/;
export const NEW_ACCOUNT_CODE_RE = /^\d{3,8}$/;
