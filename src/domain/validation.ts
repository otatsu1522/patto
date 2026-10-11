import { LIMITS } from '@/config/limits';
import { t, type StringKey } from '@/i18n';

/** 検証結果: エラーなしは null、あれば表示用メッセージ */
export type ValidationError = string | null;

export const validateRequired = (v: string): ValidationError =>
  v.trim().length === 0 ? t('validation.required') : null;

export const validateMaxLength = (v: string, max: number): ValidationError =>
  v.length > max ? t('validation.tooLong', { max }) : null;

export const validateTitle = (v: string, max: number): ValidationError =>
  validateRequired(v) ?? validateMaxLength(v, max);

export const normalizeEmail = (v: string): string => v.trim().toLowerCase();

export function validateEmail(v: string): ValidationError {
  const e = normalizeEmail(v);
  if (e.length === 0) return t('validation.required');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? null : t('validation.emailInvalid');
}

export function validatePassword(v: string): ValidationError {
  if (v.length === 0) return t('validation.required');
  if (v.length < LIMITS.passwordMin || v.length > LIMITS.passwordMax) {
    return t('validation.passwordLength', { min: LIMITS.passwordMin, max: LIMITS.passwordMax });
  }
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return t('validation.passwordComplexity');
  return null;
}

export const validatePasswordMatch = (a: string, b: string): ValidationError =>
  a === b ? null : t('validation.passwordMismatch');

export const firstError = (...errors: ValidationError[]): ValidationError =>
  errors.find((e) => e !== null) ?? null;

export type { StringKey };
