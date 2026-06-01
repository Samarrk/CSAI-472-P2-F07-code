// Saudi national ID: 10 digits, starts with 1 (citizen) or 2 (resident).
// IDs starting with any other digit don't exist in the national registry.
export function validateSaudiId(id: string): boolean {
  return /^[12]\d{9}$/.test(id.trim());
}

// Saudi mobile: +9665X or 05X prefix, total 9 digits after country code
export function validateSaudiPhone(phone: string): boolean {
  const cleaned = phone.replace(/\s+/g, '');
  return /^(\+9665|05)\d{8}$/.test(cleaned);
}

export function validatePassword(password: string): boolean {
  return password.length >= 6;
}

// Strips any non-numeric characters the user might paste in and enforces the 10-digit cap.
export function sanitizeId(id: string): string {
  return id.replace(/\D/g, '').slice(0, 10);
}
