import { Search, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import type { PublicHome } from '@shared/api-front'
import { cn } from '@/components/ui/cn'
import { Input } from '@/components/ui/input'
import { PublicSite } from '@/pages/public/home/PublicSite'
import { FormsGrid, PageIntro } from '@/pages/public/home/sections'
import { SHELL } from '@/pages/public/home/site'
import { SiteFrame } from '@/pages/public/home/SiteFrame'

/** /forms: every listed open form, searchable. */
export default function AllFormsPage() {
  return <PublicSite>{(home) => <AllForms home={home} />}</PublicSite>
}

function AllForms({ home }: { home: PublicHome }) {
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query).trim().toLowerCase()
  const shown = q ? home.forms.filter((f) => `${f.title} ${f.description}`.toLowerCase().includes(q)) : home.forms
  return (
    <SiteFrame home={home} current="forms">
      <title>{`Forms · ${home.appName}`}</title>
      <PageIntro eyebrow={home.appName} title="All forms">
        <p className="text-answer text-muted-foreground">
          {home.forms.length === 0 ? 'Nothing is open right now. Check back soon.' : `${home.forms.length} open ${home.forms.length === 1 ? 'form' : 'forms'}. Pick one to get started.`}
        </p>
      </PageIntro>
      <section aria-label="Forms" className={cn(SHELL, 'grid gap-8')}>
        {home.forms.length > 3 && (
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search forms"
              placeholder="Search forms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-(--control-lg) pr-12 pl-11"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="focus-ring press absolute top-1/2 right-2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-[color,scale] duration-(--duration-fast) ease-out hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        )}
        <FormsGrid forms={shown} empty={q ? `No forms match “${query.trim()}”. Try another word.` : undefined} />
      </section>
    </SiteFrame>
  )
}
