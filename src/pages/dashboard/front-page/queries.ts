import type { FrontPageView, PickableFormsResponse } from '@shared/api-front'
import { api } from '@/lib/api'

export const frontPageQuery = { queryKey: ['front-page'], queryFn: () => api<FrontPageView>('/api/front-page') }

/** Live forms the editor can feature. */
export const pickableFormsQuery = { queryKey: ['front-page', 'forms'], queryFn: () => api<PickableFormsResponse>('/api/front-page/forms') }
