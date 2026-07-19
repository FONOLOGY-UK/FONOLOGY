import * as React from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui-style text input for admin & auth surfaces. */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'border-input rounded-ui bg-card text-foreground placeholder:text-muted/70 focus-visible:ring-ring flex h-10 w-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
