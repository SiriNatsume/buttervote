type QueryError = {
  message: string;
  code?: string;
};

type RangeQuery<T> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: QueryError | null;
    count?: number | null;
    status?: number;
  }>;
};

type FetchAllRowsResult<T> =
  | { data: T[]; error: null }
  | { data: null; error: QueryError };

const DEFAULT_PAGE_SIZE = 1000;

function isOutOfRange(result: { error: QueryError | null; status?: number }) {
  return result.error?.code === "PGRST103" || result.status === 416;
}

function safeSize(size: number, fallback: number) {
  return Number.isSafeInteger(size) && size > 0 ? Math.min(size, DEFAULT_PAGE_SIZE) : fallback;
}

export async function fetchAllRows<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<FetchAllRowsResult<T>> {
  const safePageSize = safeSize(pageSize, DEFAULT_PAGE_SIZE);
  const rows: T[] = [];
  let restarted = false;

  for (let from = 0; ;) {
    const to = from + safePageSize - 1;
    const result = await buildQuery().range(from, to);
    const { data, error } = result;

    if (error) {
      // Concurrent removals can invalidate the next offset. Restart once so
      // callers receive a fresh complete list, rather than partial old rows.
      if (from > 0 && isOutOfRange(result) && !restarted) {
        restarted = true;
        rows.length = 0;
        from = 0;
        continue;
      }
      if (from > 0 && isOutOfRange(result) && restarted) {
        return { data: rows, error: null };
      }
      return { data: null, error };
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length === 0 || (result.count != null && from + page.length >= result.count)) {
      return { data: rows, error: null };
    }
    // Advance by the returned size: the API may impose a smaller server-side
    // row cap. A short page alone does not prove that the list is complete.
    from += page.length;
  }
}

type FetchPageResult<T> =
  | { data: T[]; error: null; page: number; totalPages: number; totalCount: number }
  | { data: null; error: QueryError };

export async function fetchPageRows<T>(
  buildQuery: () => RangeQuery<T>, requestedPage: number, pageSize = 50,
): Promise<FetchPageResult<T>> {
  const size = safeSize(pageSize, 50);
  const first = await buildQuery().range(0, size - 1);
  if (first.error) return { data: null, error: first.error };
  if (!Number.isSafeInteger(first.count) || first.count! < 0) {
    return { data: null, error: { message: "无法确认列表总数，请重试。" } };
  }
  const totalPages = Math.max(1, Math.ceil(first.count! / size));
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(totalPages, requestedPage)) : 1;
  let result = first;
  let resolvedPage = 1;
  if (page > 1) {
    result = await buildQuery().range((page - 1) * size, page * size - 1);
    resolvedPage = page;
    if (isOutOfRange(result) || (!result.error && !result.data?.length)) {
      // The list shrank between requests. Return a fresh, valid first page.
      result = await buildQuery().range(0, size - 1);
      resolvedPage = 1;
    }
  }
  if (result.error) return { data: null, error: result.error };
  if (!Number.isSafeInteger(result.count) || result.count! < 0) {
    return { data: null, error: { message: "无法确认列表总数，请重试。" } };
  }
  return { data: result.data ?? [], error: null, page: resolvedPage,
    totalPages: Math.max(1, Math.ceil(result.count! / size)), totalCount: result.count! };
}

export async function fetchRowsByIds<T>(
  ids: string[], buildQuery: (batch: string[]) => RangeQuery<T>,
): Promise<FetchAllRowsResult<T>> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const result = await fetchAllRows(() => buildQuery(batch));
    if (result.error) return { data: null, error: result.error };
    rows.push(...result.data);
  }
  return { data: rows, error: null };
}
