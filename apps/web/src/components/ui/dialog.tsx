'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** shadcn/ui-style dialog (Radix). Admin / employee / auth surfaces. */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[2700] bg-[rgba(21,8,7,.6)] backdrop-blur-sm',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Keep focus inside an open dialog.
 *
 * Radix's own FocusScope is supposed to do this and, in this app, measurably
 * does not: with the till's float prompt open, `document.activeElement` was
 * the search box BEHIND it, and programmatically focusing that box was not
 * corrected. The practical effect was that keystrokes — including a barcode
 * scan — landed on the covered screen, which is worst on exactly this dialog,
 * where staff are counting cash blind.
 *
 * Two halves: pull focus in when the dialog opens, and pull it back if it
 * escapes afterwards.
 *
 * THE PIN-LOCK EXEMPTION IS LOAD-BEARING. The lock overlay is its own
 * role="dialog" rendered outside this portal and stacked above it. A naive
 * "always drag focus back here" would fight it for focus and leave the till
 * unrecoverable — which has happened in this project before. So focus is only
 * reclaimed when it lands somewhere that is not inside ANY modal surface;
 * anything that is itself a dialog is left strictly alone.
 */
function useKeepFocusInside(node: HTMLElement | null) {
  React.useEffect(() => {
    if (!node) return;

    const focusFirst = () => {
      if (node.contains(document.activeElement)) return;
      const target = node.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (target ?? node).focus();
    };

    focusFirst();

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || node.contains(target)) return;
      // Another modal surface (the PIN lock) legitimately owns focus.
      if (target.closest('[role="dialog"], [role="alertdialog"]')) return;
      focusFirst();
    };

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [node]);
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const [content, setContent] = React.useState<HTMLElement | null>(null);
  useKeepFocusInside(content);

  // Radix restores focus to the trigger on close by itself; that half works,
  // so it is deliberately not reimplemented here.
  const setRefs = React.useCallback(
    (node: HTMLElement | null) => {
      setContent(node);
      if (typeof ref === 'function') ref(node as never);
      else if (ref) (ref as React.MutableRefObject<unknown>).current = node;
    },
    [ref],
  );

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          'bg-paper shadow-tile fixed left-1/2 top-1/2 z-[2700] grid max-h-[90vh] w-[min(540px,94vw)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[24px] p-6 sm:p-8',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="text-muted hover:text-red focus-visible:ring-ring absolute right-4 top-4 rounded-full p-2 transition-[transform,color] duration-300 ease-out hover:rotate-90 focus-visible:outline-none focus-visible:ring-2">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-2xl font-extrabold uppercase tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted text-sm', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
