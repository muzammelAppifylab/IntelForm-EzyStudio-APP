import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me, SetupStatus } from '@shared/api'
import type { PublicAppInfo } from '@shared/api-front'
import { can, type Permission } from '@shared/roles'
import { useNavigate } from 'react-router'
import { api, ApiRequestError } from './api'

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api<Me>('/api/me')
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) return null
      throw err
    }
  },
  staleTime: 60_000,
})

export const appInfoQuery = queryOptions({
  queryKey: ['app-info'],
  queryFn: () => api<PublicAppInfo>('/api/public/app'),
  staleTime: 5 * 60_000,
})

export const setupStatusQuery = queryOptions({
  queryKey: ['setup-status'],
  queryFn: () => api<SetupStatus>('/api/setup'),
})

/** The signed-in member. Only call inside the dashboard, where RequireUser guarantees one. */
export function useMe(): Me {
  const { data } = useQuery(meQuery)
  if (!data) throw new Error('useMe called outside a signed-in route')
  return data
}

/** Hides controls the member's role can't use. The API enforces the same rules with 403s. */
export function useCan(permission: Permission): boolean {
  return can(useMe().role, permission)
}

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Mark signed out first so RequireUser unmounts the dashboard (which assumes a member),
      // then drop the rest of the cache once we're on the login page.
      queryClient.setQueryData(meQuery.queryKey, null)
      navigate('/login', { replace: true })
      setTimeout(() => queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }))
    },
  })
}
