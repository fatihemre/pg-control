import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type User } from './api'

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api.get<User>('/api/auth/me'),
  staleTime: 60_000,
  retry: false,
})

export type Providers = { local: boolean; oidc: { name: string } | null }

export const providersQuery = queryOptions({
  queryKey: ['auth', 'providers'],
  queryFn: () => api.get<Providers>('/api/auth/providers'),
  staleTime: Infinity,
})

export function useMe() {
  return useQuery(meQuery)
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { username: string; password: string }) => api.post<User>('/api/auth/login', body),
    onSuccess: (user) => qc.setQueryData(meQuery.queryKey, user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/api/auth/logout'),
    onSuccess: () => qc.clear(),
  })
}
