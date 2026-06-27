import { useState } from 'react';

function buildPageList(totalPages, currentPage) {
  const maxButtons = 5;
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  let start = Math.max(1, currentPage - 2);
  let end = start + maxButtons - 1;
  if (end > totalPages) {
    end = totalPages;
    start = end - maxButtons + 1;
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function DataTable({
  columns,
  rows,
  rowKey,
  pageSize = 10,
  emptyMessage = 'No data.',
  onRowClick,
  rowClassName,
  className = '',
}) {
  const [page, setPage] = useState(1);

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);
  const showPagination = totalRows > pageSize;

  const goto = (next) => setPage(Math.min(Math.max(1, next), totalPages));

  return (
    <div className={`data-table${className ? ` ${className}` : ''}`}>
      <div className="data-table-wrap">
        <table className="sentry-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.align ? `text-${col.align}` : ''}${col.headerClassName ? ` ${col.headerClassName}` : ''}`.trim() || undefined}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totalRows === 0 ? (
              <tr className="data-table-empty-row">
                <td colSpan={columns.length} className="data-table-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => {
                const key = rowKey ? rowKey(row, startIndex + index) : startIndex + index;
                const extraClass = typeof rowClassName === 'function' ? rowClassName(row) : rowClassName;
                return (
                  <tr
                    key={key}
                    className={`${onRowClick ? 'data-table-row-clickable' : ''}${extraClass ? ` ${extraClass}` : ''}`.trim() || undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${col.align ? `text-${col.align}` : ''}${col.cellClassName ? ` ${col.cellClassName}` : ''}`.trim() || undefined}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <div className="data-table-pagination">
          <span className="data-table-rangeinfo">
            {startIndex + 1}
            –
            {Math.min(startIndex + pageSize, totalRows)}
            {' of '}
            {totalRows}
          </span>
          <div className="data-table-pages">
            <button
              type="button"
              className="data-table-page-btn"
              onClick={() => goto(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Prev
            </button>
            {buildPageList(totalPages, currentPage).map((num) => (
              <button
                key={num}
                type="button"
                className={`data-table-page-btn${num === currentPage ? ' active' : ''}`}
                onClick={() => goto(num)}
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              className="data-table-page-btn"
              onClick={() => goto(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
