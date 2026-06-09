type QueryError = {
  message: string;
};

type RangeQuery<T> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: QueryError | null;
  }>;
};

type FetchAllRowsResult<T> =
  | { data: T[]; error: null }
  | { data: null; error: QueryError };

const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<FetchAllRowsResult<T>> {
  const safePageSize =
    Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  const rows: T[] = [];

  for (let from = 0; ; from += safePageSize) {
    const to = from + safePageSize - 1;
    const { data, error } = await buildQuery().range(from, to);

    if (error) {
      return { data: null, error };
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < safePageSize) {
      return { data: rows, error: null };
    }
  }
}
