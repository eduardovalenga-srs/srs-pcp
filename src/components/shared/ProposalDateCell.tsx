import { formatDate } from "@/lib/utils/dates";

/**
 * Célula da DATA DE PROPOSTA (DP) — coluna ao lado da entrega.
 *
 * Quando a matéria-prima (MP) do item/OF ainda não foi entregue, mostra
 * HOJE + a soma das durações dos processos aplicáveis (sem o próprio MP)
 * em dias úteis: a data até a qual podemos nos comprometer se a MP chegar
 * hoje. MP concluída (ou sem MP aplicável) => "—" — não há cenário a
 * propor ao cliente.
 */
export function ProposalDateCell({ value }: { value: string | null }) {
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      title={
        value
          ? `Se a matéria-prima chegar hoje, entrega prevista em ${formatDate(value)} (dias úteis).`
          : "MP já entregue (ou sem MP aplicável) — sem data de proposta."
      }
    >
      {formatDate(value)}
    </span>
  );
}
