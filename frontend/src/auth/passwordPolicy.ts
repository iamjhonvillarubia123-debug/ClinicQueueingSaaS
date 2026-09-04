export const passwordChecks = [
  { label: 'At least 8 characters', valid: (value: string) => value.length >= 8 },
  { label: 'Uppercase letter', valid: (value: string) => /[A-Z]/.test(value) },
  { label: 'Lowercase letter', valid: (value: string) => /[a-z]/.test(value) },
  { label: 'Number', valid: (value: string) => /\d/.test(value) },
  { label: 'Special character', valid: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

export function meetsPasswordPolicy(value: string) {
  return passwordChecks.every((check) => check.valid(value));
}
