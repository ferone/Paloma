import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminStatus, GeneralSettings, SecretsResponse, SecretTestResult, SecretView } from '@shared/settings'
import { api } from '../../api/client'
import { getAdminToken, setAdminToken } from '../../api/admin'

export const settingsKeys = {
  secrets: ['settings', 'secrets'] as const,
  general: ['settings', 'general'] as const,
  admin: ['settings', 'admin'] as const,
}

/** Everything whose "configured" state depends on a key. */
const KEY_DEPENDENTS = [['status'], ['macro', 'ai', 'status'], ['marketdata', 'databento'], ['ai', 'assistant']]

export function useSecrets() {
  return useQuery({ queryKey: settingsKeys.secrets, queryFn: async () => (await api.get<SecretsResponse>('/settings/secrets')).data })
}

export function useAdminStatus() {
  return useQuery({ queryKey: settingsKeys.admin, queryFn: async () => (await api.get<AdminStatus>('/admin/status')).data })
}

export function useGeneralSettings() {
  return useQuery({ queryKey: settingsKeys.general, queryFn: async () => (await api.get<GeneralSettings>('/settings/general')).data })
}

function useAfterKeyChange() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: settingsKeys.secrets })
    void qc.invalidateQueries({ queryKey: settingsKeys.admin })
    for (const k of KEY_DEPENDENTS) void qc.invalidateQueries({ queryKey: k })
  }
}

export function useSaveSecret() {
  const done = useAfterKeyChange()
  return useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) => (await api.put<SecretView>(`/settings/secrets/${name}`, { value })).data,
    onSuccess: done,
  })
}

export function useRevertSecret() {
  const done = useAfterKeyChange()
  return useMutation({
    mutationFn: async (name: string) => (await api.delete<SecretView>(`/settings/secrets/${name}`)).data,
    onSuccess: done,
  })
}

export function useTestSecret() {
  return useMutation({
    mutationFn: async ({ name, value }: { name: string; value?: string }) =>
      (await api.post<SecretTestResult>(`/settings/secrets/${name}/test`, value ? { value } : {}, { timeout: 30_000 })).data,
  })
}

export function useSaveGeneral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<GeneralSettings>) => (await api.put<GeneralSettings>('/settings/general', patch)).data,
    onSuccess: (data) => qc.setQueryData(settingsKeys.general, data),
  })
}

export function useLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (getAdminToken()) await api.post('/admin/lock')
      setAdminToken(null)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: settingsKeys.admin }),
  })
}
