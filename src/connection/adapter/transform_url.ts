export function transformUrl({
  url,
  pathname,
  searchParams,
}: {
  url: URL
  pathname?: string
  searchParams?: URLSearchParams
}): URL {
  const newUrl = new URL(url)

  if (pathname) {
    newUrl.pathname = pathname
  }

  if (searchParams) {
    newUrl.search = searchParams?.toString()
  }

  return newUrl
}
