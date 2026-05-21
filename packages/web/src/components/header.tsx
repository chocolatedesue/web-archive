import { Button } from '@web-archive/shared/components/button'
import { Input } from '@web-archive/shared/components/input'
import { Link2, Search } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import type React from 'react'
import { useOutletContext } from 'react-router-dom'
import ViewToggle from './view-toggle'
import ArchiveByUrlDialog from './archive-by-url-dialog'

interface SearchBarProps {
  className?: string
  keyword: string
  setKeyword: (keyword: string) => void
  handleSearch: () => void
}

function SearchBar({ className, keyword, setKeyword, handleSearch }: SearchBarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const match = location.pathname.startsWith('/folder')

  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)

  // handleSearch is also available via outlet context for refreshing after archive
  const outletCtx = useOutletContext<{ handleSearch: () => void } | null>()

  function handleArchiveSuccess() {
    // trigger a search/reload so the newly archived page appears
    handleSearch()
    if (outletCtx?.handleSearch)
      outletCtx.handleSearch()
  }

  return (
    <>
      <ArchiveByUrlDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        onSuccess={handleArchiveSuccess}
      />

      <div className={`${className ?? ''} flex items-center m-2 ${match ? 'justify-between' : 'justify-end'}`}>
        {match && <ViewToggle />}
        <div className="flex items-center space-x-2">
          {/* Archive by URL button */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setArchiveDialogOpen(true)}
            title={t('archive-by-url-title')}
          >
            <Link2 className="h-4 w-4" />
          </Button>

          {/* Search */}
          <div className="flex items-center border rounded-md px-3" cmdk-input-wrapper="">
            <Search className="h-4 w-4 shrink-0 opacity-50" />
            <Input
              className="border-none outline-none focus-visible:ring-offset-0 focus-visible:ring-ring w-52"
              placeholder={t('search-placeholder')}
              value={keyword}
              showRing={false}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
              onKeyUp={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  handleSearch()
                }
              }}
            >
            </Input>
          </div>
          <Button onClick={handleSearch}>{t('search')}</Button>
        </div>
      </div>
    </>
  )
}

export default SearchBar
