/**
 * Colunas do painel "Peso concluído por processo" (dashboard e exportação).
 *
 * A tela mostra o catálogo ativo de processos mais qualquer processo que
 * apareça apenas nos dados (histórico/inativo). A exportação .xlsx usa a
 * MESMA lista para as colunas não divergirem da tela.
 */
export interface WeightProcessColumn {
  code: string;
  name: string;
  displayOrder: number;
}

export function weightProcessColumns(
  catalog: readonly WeightProcessColumn[],
  dataProcesses: readonly WeightProcessColumn[],
): WeightProcessColumn[] {
  const columns = catalog.map((process) => ({
    code: process.code,
    name: process.name,
    displayOrder: process.displayOrder,
  }));

  for (const process of dataProcesses) {
    if (!columns.some((column) => column.code === process.code)) {
      columns.push({
        code: process.code,
        name: process.name,
        displayOrder: process.displayOrder,
      });
    }
  }

  columns.sort((a, b) => a.displayOrder - b.displayOrder);
  return columns;
}
