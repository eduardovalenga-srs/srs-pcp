/** Unidades de medida aceitas para matéria-prima (código -> rótulo). */
export const MATERIAL_UNITS = ["KG", "G", "M", "M2", "M3", "L", "UN", "CX", "SC"] as const;

export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

/** Rótulos de exibição em pt-BR (M2 vira "m²" na tela). */
export const MATERIAL_UNIT_LABELS: Record<MaterialUnit, string> = {
  KG: "kg",
  G: "g",
  M: "m",
  M2: "m²",
  M3: "m³",
  L: "l",
  UN: "un",
  CX: "cx",
  SC: "sc",
};

/** Opções para os seletores de unidade. */
export const MATERIAL_UNIT_OPTIONS: { value: MaterialUnit; label: string }[] = MATERIAL_UNITS.map(
  (value) => ({ value, label: MATERIAL_UNIT_LABELS[value] }),
);

/** Limite de materiais por sub-item (também validado na RPC 011). */
export const MAX_MATERIALS_PER_ITEM = 50;
