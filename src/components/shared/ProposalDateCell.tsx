import { formatDate } from "@/lib/utils/dates";

/** DP: data prevista de expedição (fim da janela EXP) ou efetiva, se expedida. */
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
