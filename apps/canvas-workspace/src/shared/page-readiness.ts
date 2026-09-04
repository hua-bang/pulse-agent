export const PAGE_READINESS_HINT =
  'This is a point-in-time read of the live DOM — a "success" does not guarantee the data ' +
  'finished loading. If the specific content you need (table rows, numbers, list items) looks ' +
  'empty or missing, the page is likely still loading: call page_wait_for with a selector/' +
  'predicate for that content, then read again before answering.';
