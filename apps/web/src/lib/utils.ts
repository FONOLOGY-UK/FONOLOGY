import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, resolving conflicts (last wins). Standard
 * shadcn/ui helper — used across admin, employee and auth surfaces.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
