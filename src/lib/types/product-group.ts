import type { ProductCapacityUnit } from "@/lib/validators/product-group.schema";
import type { PROCESS_FACTORIES } from "@/lib/validators/process.schema";

export type ProductFactory = (typeof PROCESS_FACTORIES)[number];

export interface ProductGroupCapacityDefinition {
  id: string;
  factory: ProductFactory;
  processId: string;
  processCode: string;
  processName: string;
  processDisplayOrder: number;
  unit: ProductCapacityUnit;
  capacity: number;
}

export interface ProductGroupDefinition {
  id: number;
  familyDescription: string;
  familyAbbreviation: string;
  groupType: string;
  capacities: ProductGroupCapacityDefinition[];
}
