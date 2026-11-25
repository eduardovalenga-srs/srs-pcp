import { formatDate } from "@/lib/utils/dates";

/** DP: próximo dia útil após a cadeia ou data efetiva, se expedida. */
export function ProposalDateCell({ value }: { value: string | null }) {
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      title={
        value ? `Data de expedição: ${formatDate(value)}.` : "Sem data de expedição no sequenciamento."
      }
    >
      {formatDate(value)}
    </span>
  );
}
