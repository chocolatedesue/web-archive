import type { Page } from '@web-archive/shared/types'
import { isNil } from '@web-archive/shared/utils'
import fetcher from '~/utils/fetcher'

function getPageDetail(id: string): Promise<Page> {
  return fetcher<Page>('/pages/detail', {
    method: 'GET',
    query: {
      id,
    },
  })
}

function deletePage(page: Page): Promise<Page> {
  return fetcher<Page>('/pages/delete_page', {
    method: 'DELETE',
    query: {
      id: page.id.toString(),
    },
  })
}

function queryPage(body: {
  folderId?: string
  pageNumber: number
  pageSize: number
  keyword: string
  tagId: number | null
}): Promise<{
  list: Page[]
  total: number
}> {
  return fetcher<{
    list: Page[]
    total: number
  }>('/pages/query', {
    method: 'POST',
    body,
  })
}

function queryDeletedPage(): Promise<Page[]> {
  return fetcher<Page[]>('/pages/query_deleted', {
    method: 'POST',
  })
}

function restorePage(id: number): Promise<boolean> {
  return fetcher<boolean>('/pages/restore_page', {
    method: 'POST',
    body: {
      id,
    },
  })
}

function updatePage(body: {
  id: number
  folderId: number
  title: string
  isShowcased: number
  pageDesc?: string
  pageUrl?: string
}): Promise<Page> {
  return fetcher<Page>('/pages/update_page', {
    method: 'PUT',
    body,
  })
}

function updatePageShowcase(body: {
  id: number
  isShowcased: number
}): Promise<Page> {
  return fetcher<Page>('/pages/update_showcase', {
    method: 'PUT',
    body,
  })
}

function clearDeletedPage(): Promise<boolean> {
  return fetcher<boolean>('/pages/clear_deleted', {
    method: 'DELETE',
  })
}

function getPageScreenshot(screenshotId: string | null) {
  return async () => {
    if (isNil(screenshotId))
      return null
    const res = await fetch(`/api/pages/screenshot?id=${screenshotId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'image/webp',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
    })
    return await res.blob()
  }
}

function getRecentSavePage(): Promise<Page[]> {
  return fetcher<Page[]>('/pages/recent_save', {
    method: 'GET',
  })
}

function queryAllPageIds(folderId: number): Promise<number[]> {
  return fetcher<number[]>('/pages/query_all_page_ids', {
    method: 'POST',
    body: {
      folderId,
    },
  })
}

export type ArchiveByUrlResult =
  | { status: 'created', pageId: number, title: string, pageDesc: string, fetcherUsed: string }
  | { status: 'duplicate', pageId: number }

function previewUrl(body: { url: string, fetcherProvider?: string }): Promise<{
  finalUrl: string
  title: string
  metaDescription: string
  textSample: string
  hasScreenshot: boolean
  fetcherUsed: string
  bytes: number
  fetchedAt: string
}> {
  return fetcher('/pages/preview_url', {
    method: 'POST',
    body,
  })
}

function archiveByUrl(body: {
  url: string
  folderId: number
  titleOverride?: string
  pageDescOverride?: string
  bindTags?: string[]
  isShowcased?: boolean
  options?: {
    fetcherProvider?: string
    generateSummary?: boolean
    generateTags?: boolean
    captureScreenshot?: boolean
  }
}): Promise<ArchiveByUrlResult> {
  return fetcher('/pages/archive_by_url', {
    method: 'POST',
    body: body as unknown as Record<string, unknown>,
  })
}

export {
  getPageDetail,
  deletePage,
  queryPage,
  updatePage,
  queryDeletedPage,
  restorePage,
  clearDeletedPage,
  updatePageShowcase,
  getPageScreenshot,
  getRecentSavePage,
  queryAllPageIds,
  previewUrl,
  archiveByUrl,
}
