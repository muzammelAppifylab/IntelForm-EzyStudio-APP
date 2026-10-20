import { test as setup } from '@playwright/test'
import { OWNER_STATE, signInOwner } from './auth'

/**
 * The `auth` project: runs after `platform` (which performs first-run setup through the UI),
 * signs the Owner in once and saves the session for every other spec. On a database where
 * setup has not happened (platform filtered out), it runs setup through the API.
 */
setup('sign in the Owner', async ({ request, baseURL }) => {
  await signInOwner(request, baseURL)
  await request.storageState({ path: OWNER_STATE })
})
