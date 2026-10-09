'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { Id, JobStatus } from '../types';
import { toast } from '@/lib/stores/toast.store';

/** Repair-stage texts (0105): the per-shop wording, and each job's text history. */

const keys = {
  templates: (defaults: boolean) => ['sms-templates', defaults ? 'default' : 'shop'] as const,
  jobSms: (jobId: Id) => ['jobs', 'sms', jobId] as const,
};

/** `defaults` reads the shared defaults whatever the shop switcher says (owner only). */
export function useSmsTemplates(defaults = false) {
  return useQuery({
    queryKey: keys.templates(defaults),
    queryFn: () => dataAdapter.getSmsTemplates(defaults),
  });
}

export function useSaveSmsTemplate(defaults = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: JobStatus; enabled: boolean; body: string }) =>
      dataAdapter.saveSmsTemplate(
        input.status,
        { enabled: input.enabled, body: input.body },
        defaults,
      ),
    onSuccess: (screen) => {
      queryClient.setQueryData(keys.templates(defaults), screen);
      // A shop's stages marked Default read the defaults, so its screen is stale too.
      if (defaults) queryClient.invalidateQueries({ queryKey: keys.templates(false) });
      toast('Text saved');
    },
    onError: (error) => toast(error.message || 'Could not save the text — try again.'),
  });
}

export function useResetSmsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: JobStatus) => dataAdapter.resetSmsTemplate(status),
    onSuccess: (screen) => {
      queryClient.setQueryData(keys.templates(false), screen);
      toast('Back to the default text');
    },
    onError: (error) => toast(error.message || 'Could not reset the text — try again.'),
  });
}

export function useJobSms(jobId: Id) {
  return useQuery({ queryKey: keys.jobSms(jobId), queryFn: () => dataAdapter.listJobSms(jobId) });
}

export function useResendJobSms(jobId: Id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dataAdapter.resendJobSms(jobId),
    onSuccess: (history) => {
      queryClient.setQueryData(keys.jobSms(jobId), history);
      const latest = history[0];
      toast(
        latest?.state === 'sent'
          ? 'Text sent'
          : `Not sent: ${latest?.reason ?? 'see the job’s texts'}`,
      );
    },
    onError: (error) => toast(error.message || 'Could not resend the text — try again.'),
  });
}

export function useSetJobSmsUpdates(jobId: Id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (smsUpdates: boolean) => dataAdapter.setJobSmsUpdates(jobId, smsUpdates),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast(job.smsUpdates ? 'The customer will be texted' : 'No more texts for this job');
    },
    onError: (error) => toast(error.message || 'Could not change that — try again.'),
  });
}
