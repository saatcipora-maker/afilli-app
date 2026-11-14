// Legacy books explicitly shared before the writer existed remain visible.
// A bulletin can never make a new private manuscript public.
export function publicBook(alias = 'b') {
  return `(${alias}.publication='published' OR (${alias}.writer_data IS NULL AND EXISTS(SELECT 1 FROM bulletins legacy_share WHERE legacy_share.book_id=${alias}.id)))`;
}
