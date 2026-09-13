'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Accessible form primitives: every field wires label -> control -> error
 * with aria-describedby / aria-invalid, and errors are announced via
 * role="alert".
 */

export interface FieldWrapperProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldWrapperProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="label-text">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** From Field render-prop; mapped to aria-describedby (never passed to DOM as-is). */
  describedBy?: string;
}

export function Input({ className, invalid, describedBy, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'input-base',
        invalid && 'border-red-500 focus:border-red-500 focus:ring-red-500',
        className
      )}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      {...props}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** From Field render-prop; mapped to aria-describedby (never passed to DOM as-is). */
  describedBy?: string;
}

export function Textarea({ className, invalid, describedBy, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn('input-base min-h-[90px]', invalid && 'border-red-500', className)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      {...props}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  /** From Field render-prop; mapped to aria-describedby (never passed to DOM as-is). */
  describedBy?: string;
}

export function Select({ className, invalid, describedBy, children, ...props }: SelectProps) {
  return (
    <select
      className={cn('input-base pr-8', invalid && 'border-red-500', className)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      {...props}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex items-center gap-2 text-sm text-ink-700', className)}>
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded border-ink-900/20 text-brand-600 focus:ring-brand-500"
        {...props}
      />
      {label}
    </label>
  );
}
