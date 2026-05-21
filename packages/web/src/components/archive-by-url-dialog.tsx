import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@web-archive/shared/components/dialog'
import { Button } from '@web-archive/shared/components/button'
import { Input } from '@web-archive/shared/components/input'
import { Textarea } from '@web-archive/shared/components/textarea'
import { Switch } from '@web-archive/shared/components/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@web-archive/shared/components/select'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@web-archive/shared/components/form'
import { useForm } from 'react-hook-form'
import type { ControllerRenderProps } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRequest } from 'ahooks'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, Search } from 'lucide-react'
import type React from 'react'
import type { Folder } from '@web-archive/shared/types'
import { getAllFolder } from '~/data/folder'
import type { ArchiveByUrlResult } from '~/data/page'
import { archiveByUrl, previewUrl } from '~/data/page'

interface ArchiveByUrlDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a page is successfully created so parent can refresh */
  onSuccess?: () => void
}

function ArchiveByUrlDialog({ open, onOpenChange, onSuccess }: ArchiveByUrlDialogProps) {
  const { t } = useTranslation()

  // ── folders ──────────────────────────────────────────────────────
  const { data: folders, run: loadFolders } = useRequest(getAllFolder, { manual: true })

  useEffect(() => {
    if (open)
      loadFolders()
  }, [open])

  // ── form ──────────────────────────────────────────────────────────
  const formSchema = z.object({
    url: z.string().url({ message: t('url-invalid') }),
    folderId: z.string().min(1, { message: t('folder-required') }),
    titleOverride: z.string().optional(),
    pageDescOverride: z.string().optional(),
    isShowcased: z.boolean().optional(),
  })

  type FormValues = z.infer<typeof formSchema>

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: '',
      folderId: '0',
      titleOverride: '',
      pageDescOverride: '',
      isShowcased: false,
    },
  })

  // reset when dialog closes
  useEffect(() => {
    if (!open)
      form.reset()
  }, [open])

  // ── preview ───────────────────────────────────────────────────────
  const [previewed, setPreviewed] = useState(false)

  const { run: runPreview, loading: previewing } = useRequest(previewUrl, {
    manual: true,
    onSuccess: (data: Awaited<ReturnType<typeof previewUrl>>) => {
      form.setValue('titleOverride', data.title ?? '')
      form.setValue('pageDescOverride', data.metaDescription ?? '')
      setPreviewed(true)
      toast.success(t('url-preview-success'))
    },
    onError: () => {
      toast.error(t('url-preview-failed'))
    },
  })

  function handlePreview() {
    const url = form.getValues('url')
    if (!url) {
      form.trigger('url')
      return
    }
    runPreview({ url })
  }

  // ── submit ────────────────────────────────────────────────────────
  const { run: runArchive, loading: archiving } = useRequest(archiveByUrl, {
    manual: true,
    onSuccess: (data: ArchiveByUrlResult) => {
      if (data.status === 'duplicate') {
        toast.success(t('url-archive-duplicate', { pageId: data.pageId }))
      }
      else {
        toast.success(t('url-archive-success'))
      }
      onSuccess?.()
      onOpenChange(false)
    },
    onError: () => {
      toast.error(t('url-archive-failed'))
    },
  })

  function onSubmit(values: FormValues) {
    runArchive({
      url: values.url,
      folderId: Number(values.folderId),
      titleOverride: values.titleOverride || undefined,
      pageDescOverride: values.pageDescOverride || undefined,
      isShowcased: values.isShowcased,
    })
  }

  const busy = previewing || archiving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {t('archive-by-url-title')}
        </DialogTitle>
        <DialogDescription>{t('archive-by-url-desc')}</DialogDescription>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* URL row */}
            <FormField
              control={form.control}
              name="url"
              render={({ field }: { field: ControllerRenderProps<FormValues, 'url'> }) => (
                <FormItem>
                  <FormLabel>{t('url')}</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="https://example.com/article"
                        autoFocus
                        {...field}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          field.onChange(e)
                          setPreviewed(false)
                        }}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={handlePreview}
                      title={t('url-preview-button')}
                    >
                      {previewing
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Title override — shown once previewed */}
            <FormField
              control={form.control}
              name="titleOverride"
              render={({ field }: { field: ControllerRenderProps<FormValues, 'titleOverride'> }) => (
                <FormItem>
                  <FormLabel>{t('title')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('url-title-placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description override */}
            <FormField
              control={form.control}
              name="pageDescOverride"
              render={({ field }: { field: ControllerRenderProps<FormValues, 'pageDescOverride'> }) => (
                <FormItem>
                  <FormLabel>{t('description')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('url-desc-placeholder')}
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Folder */}
            <FormField
              control={form.control}
              name="folderId"
              render={({ field }: { field: ControllerRenderProps<FormValues, 'folderId'> }) => (
                <FormItem>
                  <FormLabel>{t('folder')}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('select-a-folder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {folders?.map((folder: Folder) => (
                          <SelectItem key={folder.id} value={String(folder.id)}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Showcased */}
            <FormField
              control={form.control}
              name="isShowcased"
              render={({ field }: { field: ControllerRenderProps<FormValues, 'isShowcased'> }) => (
                <FormItem className="flex items-center gap-3">
                  <FormLabel className="mt-0">{t('showcased')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {archiving
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : null}
                {t('url-archive-submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default ArchiveByUrlDialog
