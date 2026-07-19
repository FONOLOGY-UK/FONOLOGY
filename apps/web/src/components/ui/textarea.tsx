import * as React from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui-style textarea for admin & auth surfaces. */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'border-input rounded-ui bg-card text-foreground placeholder:text-muted/70 focus-visible:ring-ring flex min-h-[84px] w-full border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
