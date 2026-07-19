'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateJob } from '@/lib/data/hooks';
import { jobPaymentSchema, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/admin/field';

/**
 * "Add job" — a walk-in at the counter (item 7, Jobs). Optimised for speed of
 * entry: name, phone, device, problem, quote, how they're paying. Everything
 * else can wait until the device is on the bench.
 */

/** Form-side schema: quote arrives as pounds text, converted on submit. */
const formSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter the customer name'),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+?44|0)[\d\s-]{9,13}$/, 'Enter a valid UK phone number'),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  device: z.string().trim().min(2, 'Enter the device'),
  problem: z.string().trim().min(3, 'Describe the problem'),
  notes: z.string().max(1000).optional(),
  quotePounds: z.string().optional(),
  payment: jobPaymentSchema,
});
type FormValues = z.infer<typeof formSchema>;

export function AddJobDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createJob = useCreateJob();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { payment: 'unpaid' },
  });

  const submit = handleSubmit((values) => {
    const quoteNumber = values.quotePounds?.trim() ? Number(values.quotePounds) : null;
    createJob.mutate(
      {
        customerName: values.customerName,
        phone: values.phone,
        email: values.email?.trim() ? values.email.trim() : undefined,
        device: values.device,
        problem: values.problem,
        notes: values.notes?.trim() ? values.notes : undefined,
        quote: quoteNumber != null && !Number.isNaN(quoteNumber) ? pounds(quoteNumber) : null,
        payment: values.payment,
      },
      {
        onSuccess: () => {
          reset({ payment: 'unpaid' });
          onOpenChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add job</DialogTitle>
          <DialogDescription>
            Walk-in at the counter. It lands in “New” and prints a device label from the job panel.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="job-name" error={errors.customerName?.message}>
              <Input
                id="job-name"
                autoFocus
                placeholder="Full name"
                {...register('customerName')}
              />
            </Field>
            <Field label="Phone" htmlFor="job-phone" error={errors.phone?.message}>
              <Input id="job-phone" inputMode="tel" placeholder="07…" {...register('phone')} />
            </Field>
          </div>
          <Field label="Email (optional)" htmlFor="job-email" error={errors.email?.message}>
            <Input id="job-email" type="email" placeholder="For updates" {...register('email')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device" htmlFor="job-device" error={errors.device?.message}>
              <Input id="job-device" placeholder="e.g. iPhone 14 Pro" {...register('device')} />
            </Field>
            <Field
              label="Quote (£, blank = on diagnosis)"
              htmlFor="job-quote"
              error={errors.quotePounds?.message}
            >
              <Input
                id="job-quote"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
                {...register('quotePounds')}
              />
            </Field>
          </div>
          <Field label="Problem" htmlFor="job-problem" error={errors.problem?.message}>
            <Input id="job-problem" placeholder="What's wrong with it?" {...register('problem')} />
          </Field>
          <Field label="Notes (optional)" htmlFor="job-notes">
            <Textarea
              id="job-notes"
              placeholder="Passcode, condition on arrival, warnings given…"
              {...register('notes')}
            />
          </Field>
          <Field label="Payment" htmlFor="job-payment">
            <Select id="job-payment" {...register('payment')}>
              <option value="unpaid">Unpaid</option>
              <option value="paid-advance">Paid in advance</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createJob.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createJob.isPending}>
              {createJob.isPending ? 'Adding…' : 'Add to the bench'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
