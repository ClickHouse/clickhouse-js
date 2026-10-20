import type { DataFormat } from "../data_formatter";
import type { SqlRewriter } from "./rewriter";

/** String-based rewriting, used unless a SQL lexer is configured. */
export const LegacySqlRewriter: SqlRewriter = {
  withFormat: formatQuery,
  stripTrailingSemi(query: string): string {
    return removeTrailingSemi(query.trim());
  },
};

function formatQuery(query: string, format: DataFormat): string {
  query = query.trim();
  query = removeTrailingSemi(query);
  return query + " \nFORMAT " + format;
}

function removeTrailingSemi(query: string) {
  let lastNonSemiIdx = query.length;
  for (let i = lastNonSemiIdx; i > 0; i--) {
    if (query[i - 1] !== ";") {
      lastNonSemiIdx = i;
      break;
    }
  }
  if (lastNonSemiIdx !== query.length) {
    return query.slice(0, lastNonSemiIdx);
  }
  return query;
}
