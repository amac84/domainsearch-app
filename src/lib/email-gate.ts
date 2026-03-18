const EMAIL_COOKIE_NAME = "email_gate_access";
const ALLOWED_EMAILS_ENV_KEY = "EMAIL_GATE_ALLOWED";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getAllowedEmails(): Set<string> {
  const raw = process.env[ALLOWED_EMAILS_ENV_KEY] ?? "";
  const emails = raw
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
  return new Set(emails);
}

export function isEmailGateEnabled(): boolean {
  return getAllowedEmails().size > 0;
}

export function getEmailGateCookieName(): string {
  return EMAIL_COOKIE_NAME;
}

export function isValidEmailFormat(value: string): boolean {
  const email = normalizeEmail(value);
  // Simple format check only; allowlist enforces real access control.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isEmailAllowed(value: string): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  const allowedEmails = getAllowedEmails();
  return allowedEmails.has(email);
}

export function normalizeGateEmail(value: string): string {
  return normalizeEmail(value);
}
