/**
 * Tipos do banco Supabase (schema público).
 * Fonte: supabase/migrations/*.sql — mantenha em sincronia.
 *
 * Observações de tipagem:
 * - os Row types são `type` (e não `interface`) para serem compatíveis com
 *   `Record<string, unknown>` exigido pelo supabase-js;
 * - `Relationships` declara as chaves estrangeiras usadas nos `select`
 *   com embutimento (ex.: order_items dentro de orders).
 */

export type RoleValue = "ADMIN" | "GESTOR" | "OPERADOR" | "VISUALIZADOR";
export type OrderTypeValue = "OF" | "OS";
export type OrderStatusValue = "PLANEJADO" | "EM_PRODUCAO" | "CONCLUIDO" | "CANCELADO";
export type ProcessStatusValue =
  | "NAO_INICIADO"
  | "CONCLUIDO"
  | "NAO_APLICAVEL";
export type ImportBatchStatusValue = "PENDENTE" | "PROCESSANDO" | "CONCLUIDO" | "COM_ERROS" | "FALHOU";

export type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: RoleValue;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
};

export type OrderRow = {
  id: string;
  code: string;
  type: OrderTypeValue;
  customer_name: string | null;
  description: string | null;
  order_date: string | null;
  delivery_date: string | null;
  status: OrderStatusValue;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  /** Vínculo filho -> pai (016) — null = item de nível raiz. */
  parent_order_item_id: string | null;
  family: string | null;
  parent_item: string | null;
  description: string;
  quantity: number;
  unit_weight_kg: number | null;
  total_weight_kg: number | null;
  delivery_date: string | null;
  status: OrderStatusValue;
  /** Código da Ordem de Produção vinculada (013) — null = em espera. */
  op: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type OrderItemMaterialRow = {
  id: string;
  order_item_id: string;
  description: string;
  quantity: number;
  unit: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProcessRow = {
  id: string;
  code: string;
  name: string;
  display_order: number;
  active: boolean;
  location: string | null;
  duration_days: number;
  created_at: string;
  updated_at: string;
};

export type ProductionProcessRow = {
  id: string;
  order_item_id: string;
  process_id: string;
  status: ProcessStatusValue;
  quantity_planned: number | null;
  quantity_completed: number | null;
  started_at: string | null;
  completed_at: string | null;
  operator_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionEventRow = {
  id: string;
  production_process_id: string;
  user_id: string;
  event_type: string;
  old_status: ProcessStatusValue | null;
  new_status: ProcessStatusValue | null;
  old_quantity: number | null;
  new_quantity: number | null;
  notes: string | null;
  created_at: string;
};

export type ImportBatchRow = {
  id: string;
  file_name: string;
  file_size: number | null;
  status: ImportBatchStatusValue;
  total_rows: number | null;
  valid_rows: number | null;
  error_rows: number | null;
  warning_rows: number | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ImportErrorRow = {
  id: string;
  import_batch_id: string;
  row_number: number;
  column_name: string | null;
  error_type: string;
  message: string;
  raw_value: string | null;
  created_at: string;
};

/** Definição usada por createClient/createBrowserClient do @supabase/ssr. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Linha retornada pela RPC get_production_rows. */
export type ProductionRowRecord = {
  total_count: number | string;
  /** Soma do peso unitário de TODAS as linhas filtradas (017) — antes da paginação. */
  weight_total: number | string;
  /** Soma da quantidade de TODAS as linhas filtradas (018) — antes da paginação. */
  qty_total: number | string;
  order_item_id: string;
  order_id: string;
  order_code: string;
  order_type: string;
  customer_name: string;
  order_status: OrderStatusValue;
  family: string;
  parent_item: string;
  description: string;
  quantity: number | string;
  unit_weight_kg: number | string | null;
  delivery_date: string | null;
  item_status: OrderStatusValue;
  /** Código da Ordem de Produção (013) — null = em espera. */
  op: string | null;
  overdue: boolean;
  processes: Record<
    string,
    {
      id: string;
      status: ProcessStatusValue;
      quantityPlanned: number | string | null;
      quantityCompleted: number | string | null;
      notes: string | null;
    }
  >;
};

/** Linha retornada pela RPC get_production_rows_by_order (025) — uma por OF. */
export type ProductionOrderRowRecord = {
  total_count: number | string;
  /** Soma do peso TOTAL das OFs filtradas — antes da paginação. */
  weight_total: number | string;
  /** Soma das quantidades das OFs filtradas — antes da paginação. */
  qty_total: number | string;
  order_id: string;
  order_code: string;
  order_type: string;
  customer_name: string;
  order_status: OrderStatusValue;
  delivery_date: string | null;
  /** Soma das quantidades dos itens raiz da OF. */
  quantity: number | string;
  /** Soma do peso total (qtd × peso unit.) dos itens raiz da OF. */
  weight_kg: number | string | null;
  overdue: boolean;
  /** Célula agregada por processo (sem id/notes: é lote, não item). */
  processes: Record<
    string,
    {
      status: ProcessStatusValue;
      done: number | string;
      applicable: number | string;
      quantityPlanned: number | string | null;
      quantityCompleted: number | string | null;
    }
  >;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          name?: string | null;
          email?: string | null;
          role?: RoleValue;
          active?: boolean;
          must_change_password?: boolean;
        };
        Update: {
          name?: string | null;
          email?: string | null;
          role?: RoleValue;
          active?: boolean;
          must_change_password?: boolean;
        };
        Relationships: [];
      };
      orders: {
        Row: OrderRow;
        Insert: {
          id?: string;
          code: string;
          type: OrderTypeValue;
          customer_name?: string | null;
          description?: string | null;
          order_date?: string | null;
          delivery_date?: string | null;
          status?: OrderStatusValue;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<{
          code: string;
          type: OrderTypeValue;
          customer_name: string | null;
          description: string | null;
          order_date: string | null;
          delivery_date: string | null;
          status: OrderStatusValue;
          updated_by: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: OrderItemRow;
        Insert: {
          id?: string;
          order_id: string;
          parent_order_item_id?: string | null;
          family?: string | null;
          parent_item?: string | null;
          description: string;
          quantity: number;
          unit_weight_kg?: number | null;
          total_weight_kg?: number | null;
          delivery_date?: string | null;
          status?: OrderStatusValue;
          op?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<{
          order_id: string;
          parent_order_item_id: string | null;
          family: string | null;
          parent_item: string | null;
          description: string;
          quantity: number;
          unit_weight_kg: number | null;
          total_weight_kg: number | null;
          delivery_date: string | null;
          status: OrderStatusValue;
          op: string | null;
          updated_by: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_parent_order_item_id_fkey";
            columns: ["parent_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_materials: {
        Row: OrderItemMaterialRow;
        Insert: {
          id?: string;
          order_item_id: string;
          description: string;
          quantity: number;
          unit?: string;
          notes?: string | null;
        };
        Update: Partial<{
          order_item_id: string;
          description: string;
          quantity: number;
          unit: string;
          notes: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "order_item_materials_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      processes: {
        Row: ProcessRow;
        Insert: {
          id?: string;
          code: string;
          name: string;
          display_order?: number;
          active?: boolean;
          location?: string | null;
          duration_days?: number;
        };
        Update: Partial<{
          code: string;
          name: string;
          display_order: number;
          active: boolean;
          location: string | null;
          duration_days: number;
        }>;
        Relationships: [];
      };
      production_processes: {
        Row: ProductionProcessRow;
        Insert: {
          id?: string;
          order_item_id: string;
          process_id: string;
          status?: ProcessStatusValue;
          quantity_planned?: number | null;
          quantity_completed?: number | null;
          started_at?: string | null;
          completed_at?: string | null;
          operator_id?: string | null;
          notes?: string | null;
        };
        Update: Partial<{
          status: ProcessStatusValue;
          quantity_planned: number | null;
          quantity_completed: number | null;
          started_at: string | null;
          completed_at: string | null;
          operator_id: string | null;
          notes: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "production_processes_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_processes_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "processes";
            referencedColumns: ["id"];
          },
        ];
      };
      production_events: {
        Row: ProductionEventRow;
        Insert: {
          id?: string;
          production_process_id: string;
          user_id: string;
          event_type: string;
          old_status?: ProcessStatusValue | null;
          new_status?: ProcessStatusValue | null;
          old_quantity?: number | null;
          new_quantity?: number | null;
          notes?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "production_events_production_process_id_fkey";
            columns: ["production_process_id"];
            isOneToOne: false;
            referencedRelation: "production_processes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      import_batches: {
        Row: ImportBatchRow;
        Insert: {
          id?: string;
          file_name: string;
          file_size?: number | null;
          status?: ImportBatchStatusValue;
          total_rows?: number | null;
          valid_rows?: number | null;
          error_rows?: number | null;
          warning_rows?: number | null;
          created_by?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<{
          status: ImportBatchStatusValue;
          total_rows: number | null;
          valid_rows: number | null;
          error_rows: number | null;
          warning_rows: number | null;
          completed_at: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "import_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      import_errors: {
        Row: ImportErrorRow;
        Insert: {
          id?: string;
          import_batch_id: string;
          row_number: number;
          column_name?: string | null;
          error_type: string;
          message: string;
          raw_value?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "import_errors_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_first_admin: {
        Args: Record<string, never>;
        Returns: { claimed: boolean; message: string };
      };
      get_production_rows: {
        Args: {
          p_search?: string | null;
          p_order_status?: string | null;
          p_process_code?: string | null;
          p_process_status?: string | null;
          p_delivery_filter?: string | null;
          p_today?: string | null;
          p_sort?: string | null;
          p_sort_dir?: string | null;
          p_offset?: number | null;
          p_limit?: number | null;
          // filtros por coluna (007)
          p_order_code?: string | null;
          p_customer?: string | null;
          p_family?: string | null;
          p_parent_item?: string | null;
          p_description?: string | null;
          p_qty_min?: number | null;
          p_qty_max?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          // período de entrega (014): YYYY-MM-DD, lados opcionais
          p_delivery_from?: string | null;
          p_delivery_to?: string | null;
        };
        Returns: ProductionRowRecord[];
      };
      get_production_rows_by_order: {
        // 025: gestão de entregas consolidada — UMA linha por OF.
        // Sem colunas TP/Item pai/Descrição/OP; a busca genérica ($1)
        // ainda varre família/item pai/descrição dos itens da OF.
        Args: {
          p_search?: string | null;
          p_order_status?: string | null;
          p_process_code?: string | null;
          p_process_status?: string | null;
          p_delivery_filter?: string | null;
          p_today?: string | null;
          p_sort?: string | null;
          p_sort_dir?: string | null;
          p_offset?: number | null;
          p_limit?: number | null;
          p_order_code?: string | null;
          p_customer?: string | null;
          p_qty_min?: number | null;
          p_qty_max?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          p_delivery_from?: string | null;
          p_delivery_to?: string | null;
        };
        Returns: ProductionOrderRowRecord[];
      };
      get_production_stats: {
        Args: { p_today?: string | null };
        Returns: Json;
      };
      get_dashboard_orders: {
        // top clientes + envelhecimento agregados no banco (024)
        Args: Record<string, never>;
        Returns: Json;
      };
      get_child_items_totals: {
        // contagem + qtd/peso total da Fábrica 1 em 1 consulta (024)
        Args: {
          p_search?: string | null;
          p_order_code?: string | null;
          p_customer?: string | null;
          p_child_item?: string | null;
          p_description?: string | null;
          p_material?: string | null;
          p_parent_ids?: string[] | null;
          p_delivery_from?: string | null;
          p_delivery_to?: string | null;
          p_process_id?: string | null;
          p_process_status?: string | null;
        };
        Returns: Json;
      };
      reorder_processes: {
        Args: { p_ids: string[] };
        Returns: undefined;
      };
      backfill_process: {
        // null = todos os processos ativos (invariante item × processo)
        Args: { p_process_id?: string | null };
        Returns: number;
      };
      replace_item_materials: {
        // troca a lista de materiais de um sub-item em uma transação (011)
        Args: { p_item_id: string; p_materials: Json };
        Returns: number;
      };
      refresh_order_statuses: {
        // grava o status derivado do item e re-deriva o status da OF (013)
        Args: { p_item_id: string; p_item_status: string };
        Returns: undefined;
      };
      apply_import: {
        Args: { p_plan: Json };
        Returns: { created: number; updated: number; skipped: number; ordersCreated: number };
      };
      apply_of_import: {
        // plano do layout novo: OF -> pais -> filhos -> materiais (016)
        Args: { p_plan: Json };
        Returns: {
          ordersCreated: number;
          ordersUpdated: number;
          ordersSkipped: number;
          parentsCreated: number;
          parentsUpdated: number;
          childrenCreated: number;
          childrenUpdated: number;
          itemsRemoved: number;
        };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
