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

export type RoleValue = "ADMIN" | "GESTOR" | "OPERADOR_F1" | "OPERADOR_F2" | "VISUALIZADOR";
/** 101: tipo de conta no modelo de acesso personalizado. */
export type AccessAccountTypeValue = "INTERNAL" | "EXTERNAL";
export type OrderTypeValue = "OF" | "OS";
export type OrderStatusValue = "PLANEJADO" | "EM_PRODUCAO" | "CONCLUIDO" | "CANCELADO";
export type ProcessStatusValue =
  | "NAO_INICIADO"
  | "CONCLUIDO"
  | "NAO_APLICAVEL";
/** 078: espelho do recebimento de MP agregado por OF no sequenciamento. */
export type MpReceiptStateValue = "NONE" | "PARCIAL" | "TOTAL";
export type ImportBatchStatusValue = "PENDENTE" | "PROCESSANDO" | "CONCLUIDO" | "COM_ERROS" | "FALHOU";
export type EmployeeStatusValue = "ATIVO" | "INATIVO";
export type EmployeeBillingModelValue = "HORA" | "KG";
export type RecruitmentVacancyStatusValue =
  | "VAGAS_ABERTAS"
  | "TRIAGEM"
  | "ENTREVISTA"
  | "AGENDAMENTO_ASO"
  | "INTEGRACAO"
  | "CONTRATADOS";
export type RecruitmentRequestReasonValue = "NOVA_VAGA" | "SUBSTITUICAO" | "REFORCO";
export type RecruitmentCandidateStageValue =
  | "TRIAGEM"
  | "ENTREVISTA"
  | "AGENDAMENTO_ASO"
  | "INTEGRACAO"
  | "CONTRATADO"
  | "REPROVADO";

export type RecruitmentVacancyRow = {
  id: string;
  title: string;
  customer: string | null;
  request_reason: RecruitmentRequestReasonValue;
  replacement_employee_id: string | null;
  allocation_client_id: string | null;
  allocation_location_id: string | null;
  allocation_area_id: string | null;
  allocation_position_id: string | null;
  approved_role_id: string | null;
  selected_candidate_id: string | null;
  department: string;
  location: string | null;
  employment_type: string;
  quantity: number;
  description: string | null;
  requirements: string | null;
  salary_range: string | null;
  requester: string | null;
  recruiter: string | null;
  priority: "BAIXA" | "NORMAL" | "ALTA";
  status: RecruitmentVacancyStatusValue;
  opening_date: string;
  target_date: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type RecruitmentCandidateRow = {
  id: string;
  vacancy_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: RecruitmentCandidateStageValue;
  triage_scheduled_at: string | null;
  interview_scheduled_at: string | null;
  interviewer_name: string | null;
  aso_scheduled_at: string | null;
  integration_scheduled_at: string | null;
  hired_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type EmployeeRow = {
  id: string;
  company_code: string;
  company_name: string;
  registration: string;
  name: string;
  billing_model: EmployeeBillingModelValue;
  admission_date: string | null;
  dismissal_date: string | null;
  registered_client: string | null;
  location: string | null;
  status: EmployeeStatusValue;
  shift: string | null;
  area: string | null;
  client: string | null;
  responsible_1: string | null;
  responsible_2: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  allocation_position_id: string | null;
  last_allocation_position_id: string | null;
};

export type EmployeeAllocationNodeType =
  | "COMPANY"
  | "CLIENT"
  | "LOCATION"
  | "AREA"
  | "SHIFT"
  | "POSITION";

export type EmployeeAllocationNodeRow = {
  id: string;
  company_code: string;
  company_name: string;
  parent_id: string | null;
  node_type: EmployeeAllocationNodeType;
  name: string;
  location_leader: string | null;
  location_supervisor: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type RecruitmentApprovedRoleRow = {
  id: string;
  client_id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: RoleValue;
  active: boolean;
  must_change_password: boolean;
  /** 101: usuário interno ou vinculado a cliente. */
  account_type: AccessAccountTypeValue;
  /** 101: perfil-modelo de permissões. */
  access_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

/** 101: perfil-modelo reutilizável de permissões. */
export type AccessProfileRow = {
  id: string;
  name: string;
  role_key: string | null;
  account_type: AccessAccountTypeValue;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type AccessProfilePermissionRow = {
  access_profile_id: string;
  permission_key: string;
  created_at: string;
};

export type UserPermissionOverrideRow = {
  profile_id: string;
  permission_key: string;
  allowed: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileClientAccessRow = {
  profile_id: string;
  client_node_id: string;
  created_at: string;
};

export type ProfileCompanyAccessRow = {
  profile_id: string;
  company_code: string;
  created_at: string;
};

export type AccessAuditLogRow = {
  id: string;
  actor_profile_id: string | null;
  target_profile_id: string | null;
  action: string;
  details: Json;
  created_at: string;
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
  /** 070: família (grupo de produto) escolhida na importação — separada de order_items.family. */
  product_group_id: number | null;
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
  /** 036: sequência de fabricação (prioridade do planejamento) — null = sem número. */
  seq: number | null;
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

export type ProductGroupRow = {
  id: number;
  family_description: string;
  family_abbreviation: string;
  created_at: string;
  updated_at: string;
};

export type ProductGroupProcessCapacityRow = {
  id: string;
  product_group_id: number;
  factory: "Fábrica 1" | "Fábrica 2";
  process_id: string;
  unit: "KG" | "M2" | "UNIDADES";
  capacity: number | string;
  created_at: string;
  updated_at: string;
};

export type ProductGroupItemRow = {
  id: string;
  product_group_id: number;
  description: string;
  created_at: string;
  updated_at: string;
};

export type ProductGroupItemProcessCapacityRow = {
  id: string;
  product_group_item_id: string;
  factory: "Fábrica 1" | "Fábrica 2";
  process_id: string;
  unit: "KG" | "M2" | "UNIDADES";
  capacity: number | string;
  created_at: string;
  updated_at: string;
};

/** 070: posição e observação de uma OF na fila de um processo. */
export type OrderProcessScheduleRow = {
  id: string;
  order_id: string;
  process_id: string;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** 070: data de início (âncora) persistida por processo. */
export type ProcessScheduleSettingsRow = {
  process_id: string;
  anchor_date: string;
  created_at: string;
  updated_at: string;
};

/** Linha retornada pela RPC get_process_scheduling (070/077/078/087). */
export type ProcessSchedulingRowRecord = {
  order_id: string;
  order_code: string;
  order_type: string;
  customer_name: string | null;
  delivery_date: string | null;
  order_status: OrderStatusValue;
  product_group_id: number | null;
  family_description: string | null;
  family_abbreviation: string | null;
  group_type: string | null;
  quantity: number | string;
  weight_kg: number | string | null;
  capacity_kg: number | string | null;
  position: number | string | null;
  notes: string | null;
  /** 078: situação do processo selecionado na OF (null = sem processo). */
  process_status: ProcessStatusValue | null;
  /** 078: situação do recebimento de MP da OF (null = sem MP aplicável). */
  mp_state: MpReceiptStateValue | null;
};

/** Fila por processo retornada pela RPC get_all_process_scheduling (095). */
export type AllProcessSchedulingQueueRecord = {
  process_id: string;
  process_code: string;
  anchor_date: string | null;
  rows: Json;
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
  /** 041: nº de ITENS RAIZ atrasados do conjunto FILTRADO (cards "Atrasados"). */
  overdue_count: number | string;
  /** Soma da quantidade dos itens atrasados do conjunto filtrado. */
  overdue_qty: number | string;
  /** Soma do peso dos itens atrasados do conjunto filtrado. */
  overdue_weight: number | string;
  /** 041: nº de ITENS RAIZ com EXPEDIÇÃO concluída do conjunto FILTRADO (card "Expedição"). */
  expedition_count: number | string;
  /** Soma da quantidade dos itens expedidos do conjunto filtrado. */
  expedition_qty: number | string;
  /** Soma do peso dos itens expedidos do conjunto filtrado. */
  expedition_weight: number | string;
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
  /** 036: sequência de fabricação do item (null = sem número). */
  seq: number | string | null;
  processes: Record<
    string,
    {
      /** 039: null na célula KIT agregada dos filhos (somente leitura). */
      id: string | null;
      status: ProcessStatusValue;
      quantityPlanned: number | string | null;
      quantityCompleted: number | string | null;
      notes: string | null;
      /** 031: data efetiva da conclusão (exibida no MP). */
      completedAt: string | null;
      /** 039: true quando a célula é um agregado das linhas dos filhos. */
      aggregated?: boolean;
    }
  >;
  /** 035: totais por família do conjunto filtrado inteiro (mesma janela dos totais). */
  family_totals: { family: string | null; qty: number | string; weight: number | string }[] | null;
};

/** Linha retornada pela RPC get_production_rows_by_order (025) — uma por OF. */
export type ProductionOrderRowRecord = {
  total_count: number | string;
  /** Soma do peso TOTAL das OFs filtradas — antes da paginação. */
  weight_total: number | string;
  /** Soma das quantidades das OFs filtradas — antes da paginação. */
  qty_total: number | string;
  /** 041: nº de ITENS RAIZ atrasados dentro das OFs FILTRADAS (card "Atrasados" conta itens, não OFs). */
  overdue_count: number | string;
  /** Soma da quantidade dos itens atrasados das OFs filtradas. */
  overdue_qty: number | string;
  /** Soma do peso dos itens atrasados das OFs filtradas. */
  overdue_weight: number | string;
  /** 041: nº de ITENS RAIZ com EXPEDIÇÃO concluída dentro das OFs FILTRADAS. */
  expedition_count: number | string;
  /** Soma da quantidade dos itens expedidos das OFs filtradas. */
  expedition_qty: number | string;
  /** Soma do peso dos itens expedidos das OFs filtradas. */
  expedition_weight: number | string;
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
  /** 036: menor seq entre os itens raiz da OF (null = nenhuma linha numerada). */
  seq: number | string | null;
  /** 037: quebra por família dos itens raiz das OFs filtradas (card "OFs"). */
  family_totals: { family: string | null; qty: number | string; weight: number | string }[] | null;
  /** Célula agregada por processo (sem id/notes: é lote, não item). */
  processes: Record<
    string,
    {
      status: ProcessStatusValue;
      done: number | string;
      applicable: number | string;
      quantityPlanned: number | string | null;
      quantityCompleted: number | string | null;
      /** 031: maior completed_at concluído da OF (só célula CONCLUIDO). */
      completedAt: string | null;
    }
  >;
};

export type RomaneioStatusValue = "ABERTO" | "CONFERIDO" | "CONFIRMADO" | "CANCELADO";

export type RomaneioRow = {
  id: string;
  number: number;
  order_id: string;
  status: RomaneioStatusValue;
  shipment_date: string | null;
  carrier: string | null;
  vehicle: string | null;
  notes: string | null;
  conference_accepted_at: string | null;
  conference_accepted_by: string | null;
  conference_notes: string | null;
  emitted_at: string | null;
  emitted_by: string | null;
  nf_number: string | null;
  return_nf_number: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type RomaneioItemRow = {
  id: string;
  romaneio_id: string;
  order_item_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
};

export type RomaneioMaterialRow = {
  id: string;
  romaneio_id: string;
  description: string;
  unit: string;
  quantity_planned: number;
  quantity_received: number | null;
  quantity_used: number | null;
  created_at: string;
  updated_at: string;
};

/** Linha retornada pela RPC get_romaneios_page (043) — agregados no banco. */
export type RomaneioPageRow = {
  total_count: number;
  id: string;
  number: number | string;
  order_id: string;
  order_code: string | null;
  customer_name: string | null;
  order_delivery_date: string | null;
  status: string;
  shipment_date: string | null;
  carrier: string | null;
  item_count: number | string;
  quantity_total: number | string;
  weight_total: number | string | null;
  nf_number: string | null;
  return_nf_number: string | null;
  pending_return: boolean;
  conference_accepted_at: string | null;
  emitted_at: string | null;
  created_at: string;
};

/** Linha retornada pela RPC get_romaneio_summary (047) — 1 linha sempre. */
export type RomaneioSummaryRow = {
  total_count: number;
  open_count: number;
  conferred_count: number;
  confirmed_count: number;
};

/** Linha retornada pela RPC get_romaneio_candidates (043/045). */
export type RomaneioCandidateRow = {
  total_count: number;
  order_id: string;
  code: string;
  type: string;
  customer_name: string | null;
  delivery_date: string | null;
  status: string;
  root_quantity: number | string;
  root_weight_kg: number | string | null;
  shipped_quantity: number | string;
  /** Já existe um romaneio em ABERTO para esta OF. */
  has_open: boolean;
  /** Id do romaneio em ABERTO, quando houver. */
  open_romaneio_id: string | null;
};

/** Linha retornada pela RPC get_romaneio_customers (044/045) — seletor em cascata. */
export type RomaneioCustomerRow = {
  customer_name: string | null;
  of_count: number | string;
  /** OFs disponíveis do cliente (JSON array de RomaneioCandidateRow sem total_count). */
  ofs: {
    order_id: string;
    code: string;
    type: string;
    delivery_date: string | null;
    status: string;
    root_quantity: number | string;
    root_weight_kg: number | string | null;
    shipped_quantity: number | string;
    has_open: boolean;
    open_romaneio_id: string | null;
  }[];
};

/** Linha de `mp_receipts` (056/059) — cabeçalho de uma NOTA DE ENTRADA. */
export type MpReceiptRow = {
  id: string;
  number: number | string;
  order_id: string;
  /** Nº digitado da nota de entrada (059). */
  entry_number: string;
  /** Data da nota de entrada (059 — era `receipt_date` até a 059). */
  entry_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

/** Linha de `mp_receipt_materials` (059) — peso recebido de um MATERIAL na nota. */
export type MpReceiptMaterialRow = {
  id: string;
  mp_receipt_id: string;
  /** Chave normalizada do material (descrição + unidade). */
  material_key: string;
  material_description: string;
  material_unit: string;
  quantity_kg: number | string;
  created_at: string;
};

/** Linha de `mp_receipt_free_items` (060) — material recebido FORA da OF na nota. */
export type MpReceiptFreeItemRow = {
  id: string;
  mp_receipt_id: string;
  /** Chave normalizada do material (descrição + unidade). */
  material_key: string;
  description: string;
  /** Unidade de medida (lista de `MATERIAL_UNITS`). */
  unit: string;
  quantity: number | string;
  created_at: string;
};

/** Material da OF na tela de recebimento (059) — uma linha por material. */
export type MpOrderMaterialRow = {
  material_key: string;
  description: string;
  unit: string;
  /** Peso total que a OF precisa (soma dos itens que consomem o material). */
  need_kg: number | string;
  /** Σ dos kg recebidos em todas as notas de entrada. */
  received_kg: number | string;
  /** O que ainda falta (need_kg − received_kg). */
  balance_kg: number | string;
};

/** Linha retornada pela RPC get_mp_receipt_customers (056/059) — seletor em cascata. */
export type MpReceiptCustomerRow = {
  customer_name: string | null;
  of_count: number | string;
  /** OFs com pendência de MP (JSON array). */
  ofs: {
    order_id: string;
    code: string;
    type: string;
    delivery_date: string | null;
    status: string;
    /** Materiais ainda com saldo (059 — era `pending_items`). */
    pending_materials: number | string;
    /** Kg pendentes (null = nenhuma linha tem peso cadastrado). */
    pending_kg: number | string | null;
  }[];
};

export type Database = {
  public: {
    Tables: {
      employee_allocation_nodes: {
        Row: EmployeeAllocationNodeRow;
        Insert: {
          id?: string;
          company_code: string;
          company_name: string;
          parent_id?: string | null;
          node_type: EmployeeAllocationNodeType;
          name: string;
          location_leader?: string | null;
          location_supervisor?: string | null;
          active?: boolean;
          sort_order?: number;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<{
          company_code: string;
          company_name: string;
          parent_id: string | null;
          node_type: EmployeeAllocationNodeType;
          name: string;
          location_leader: string | null;
          location_supervisor: string | null;
          active: boolean;
          sort_order: number;
          updated_by: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "employee_allocation_nodes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_allocation_nodes_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_allocation_nodes_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: EmployeeRow;
        Insert: {
          id?: string;
          company_code: string;
          company_name: string;
          registration: string;
          name: string;
          billing_model?: EmployeeBillingModelValue;
          admission_date?: string | null;
          dismissal_date?: string | null;
          registered_client?: string | null;
          location?: string | null;
          allocation_position_id?: string | null;
          last_allocation_position_id?: string | null;
          shift?: string | null;
          area?: string | null;
          client?: string | null;
          responsible_1?: string | null;
          responsible_2?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<{
          company_code: string;
          company_name: string;
          registration: string;
          name: string;
          billing_model?: EmployeeBillingModelValue;
          admission_date: string | null;
          dismissal_date: string | null;
          registered_client: string | null;
          location: string | null;
          allocation_position_id: string | null;
          last_allocation_position_id: string | null;
          shift: string | null;
          area: string | null;
          client: string | null;
          responsible_1: string | null;
          responsible_2: string | null;
          updated_by: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "employees_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_allocation_position_fkey";
            columns: ["allocation_position_id"];
            isOneToOne: true;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_last_allocation_position_fkey";
            columns: ["last_allocation_position_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
        ];
      };
      recruitment_vacancies: {
        Row: RecruitmentVacancyRow;
        Insert: {
          id?: string;
          title: string;
          customer?: string | null;
          request_reason?: RecruitmentRequestReasonValue;
          replacement_employee_id?: string | null;
          allocation_client_id?: string | null;
          allocation_location_id?: string | null;
          allocation_area_id?: string | null;
          allocation_position_id?: string | null;
          approved_role_id?: string | null;
          selected_candidate_id?: string | null;
          department: string;
          location?: string | null;
          employment_type?: string;
          quantity?: number;
          description?: string | null;
          requirements?: string | null;
          salary_range?: string | null;
          requester?: string | null;
          recruiter?: string | null;
          priority?: RecruitmentVacancyRow["priority"];
          status?: RecruitmentVacancyStatusValue;
          opening_date?: string;
          target_date?: string | null;
          closed_reason?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["recruitment_vacancies"]["Insert"], "id">>;
        Relationships: [
          {
            foreignKeyName: "recruitment_vacancies_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_replacement_employee_id_fkey";
            columns: ["replacement_employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_allocation_client_id_fkey";
            columns: ["allocation_client_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_allocation_location_id_fkey";
            columns: ["allocation_location_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_allocation_area_id_fkey";
            columns: ["allocation_area_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_allocation_position_id_fkey";
            columns: ["allocation_position_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_approved_role_id_fkey";
            columns: ["approved_role_id"];
            isOneToOne: false;
            referencedRelation: "recruitment_approved_roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_vacancies_selected_candidate_id_fkey";
            columns: ["selected_candidate_id"];
            isOneToOne: false;
            referencedRelation: "recruitment_candidates";
            referencedColumns: ["id"];
          },
        ];
      };
      recruitment_approved_roles: {
        Row: RecruitmentApprovedRoleRow;
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          active?: boolean;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<{
          client_id: string;
          name: string;
          active: boolean;
          updated_by: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "recruitment_approved_roles_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "employee_allocation_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_approved_roles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_approved_roles_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recruitment_candidates: {
        Row: RecruitmentCandidateRow;
        Insert: {
          id?: string;
          vacancy_id: string;
          name: string;
          email?: string | null;
          phone?: string | null;
          source?: string | null;
          stage?: RecruitmentCandidateStageValue;
          notes?: string | null;
          triage_scheduled_at?: string | null;
          interview_scheduled_at?: string | null;
          interviewer_name?: string | null;
          aso_scheduled_at?: string | null;
          integration_scheduled_at?: string | null;
          hired_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["recruitment_candidates"]["Insert"], "id">>;
        Relationships: [
          {
            foreignKeyName: "recruitment_candidates_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "recruitment_vacancies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_candidates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_candidates_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          name?: string | null;
          email?: string | null;
          role?: RoleValue;
          active?: boolean;
          must_change_password?: boolean;
          account_type?: AccessAccountTypeValue;
          access_profile_id?: string | null;
        };
        Update: {
          name?: string | null;
          email?: string | null;
          role?: RoleValue;
          active?: boolean;
          must_change_password?: boolean;
          account_type?: AccessAccountTypeValue;
          access_profile_id?: string | null;
        };
        Relationships: [];
      };
      access_profiles: {
        Row: AccessProfileRow;
        Insert: {
          id?: string;
          name: string;
          role_key?: string | null;
          account_type?: AccessAccountTypeValue;
          is_system?: boolean;
        };
        Update: Partial<{
          name: string;
          role_key: string | null;
          account_type: AccessAccountTypeValue;
          is_system: boolean;
        }>;
        Relationships: [];
      };
      access_profile_permissions: {
        Row: AccessProfilePermissionRow;
        Insert: {
          access_profile_id: string;
          permission_key: string;
        };
        Update: Partial<{ permission_key: string }>;
        Relationships: [];
      };
      user_permission_overrides: {
        Row: UserPermissionOverrideRow;
        Insert: {
          profile_id: string;
          permission_key: string;
          allowed: boolean;
        };
        Update: Partial<{ allowed: boolean }>;
        Relationships: [];
      };
      profile_client_access: {
        Row: ProfileClientAccessRow;
        Insert: {
          profile_id: string;
          client_node_id: string;
        };
        Update: Partial<{ client_node_id: string }>;
        Relationships: [];
      };
      profile_company_access: {
        Row: ProfileCompanyAccessRow;
        Insert: {
          profile_id: string;
          company_code: string;
        };
        Update: Partial<{ company_code: string }>;
        Relationships: [];
      };
      access_audit_log: {
        Row: AccessAuditLogRow;
        Insert: {
          id?: string;
          actor_profile_id?: string | null;
          target_profile_id?: string | null;
          action: string;
          details?: Json;
        };
        Update: Partial<{
          actor_profile_id: string | null;
          target_profile_id: string | null;
          action: string;
          details: Json;
        }>;
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
          product_group_id?: number | null;
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
          product_group_id: number | null;
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
          seq?: number | null;
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
          seq: number | null;
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
      product_groups: {
        Row: ProductGroupRow;
        Insert: {
          id?: number;
          family_description: string;
          family_abbreviation: string;
        };
        Update: Partial<{
          family_description: string;
          family_abbreviation: string;
        }>;
        Relationships: [];
      };
      product_group_process_capacities: {
        Row: ProductGroupProcessCapacityRow;
        Insert: {
          id?: string;
          product_group_id: number;
          factory: "Fábrica 1" | "Fábrica 2";
          process_id: string;
          unit: "KG" | "M2" | "UNIDADES";
          capacity: number;
        };
        Update: Partial<{
          factory: "Fábrica 1" | "Fábrica 2";
          process_id: string;
          unit: "KG" | "M2" | "UNIDADES";
          capacity: number;
        }>;
        Relationships: [
          {
            foreignKeyName: "product_group_process_capacities_product_group_id_fkey";
            columns: ["product_group_id"];
            isOneToOne: false;
            referencedRelation: "product_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_group_process_capacities_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "processes";
            referencedColumns: ["id"];
          },
        ];
      };
      product_group_items: {
        Row: ProductGroupItemRow;
        Insert: {
          id?: string;
          product_group_id: number;
          description: string;
        };
        Update: Partial<{
          description: string;
        }>;
        Relationships: [
          {
            foreignKeyName: "product_group_items_product_group_id_fkey";
            columns: ["product_group_id"];
            isOneToOne: false;
            referencedRelation: "product_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      product_group_item_process_capacities: {
        Row: ProductGroupItemProcessCapacityRow;
        Insert: {
          id?: string;
          product_group_item_id: string;
          factory: "Fábrica 1" | "Fábrica 2";
          process_id: string;
          unit: "KG" | "M2" | "UNIDADES";
          capacity: number;
        };
        Update: Partial<{
          factory: "Fábrica 1" | "Fábrica 2";
          process_id: string;
          unit: "KG" | "M2" | "UNIDADES";
          capacity: number;
        }>;
        Relationships: [
          {
            foreignKeyName: "product_group_item_process_capacities_product_group_item_id_fkey";
            columns: ["product_group_item_id"];
            isOneToOne: false;
            referencedRelation: "product_group_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_group_item_process_capacities_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "processes";
            referencedColumns: ["id"];
          },
        ];
      };
      order_process_schedules: {
        Row: OrderProcessScheduleRow;
        Insert: {
          id?: string;
          order_id: string;
          process_id: string;
          position: number;
          notes?: string | null;
        };
        Update: Partial<{
          position: number;
          notes: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "order_process_schedules_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_process_schedules_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "processes";
            referencedColumns: ["id"];
          },
        ];
      };
      process_schedule_settings: {
        Row: ProcessScheduleSettingsRow;
        Insert: {
          process_id: string;
          anchor_date: string;
        };
        Update: Partial<{
          anchor_date: string;
        }>;
        Relationships: [
          {
            foreignKeyName: "process_schedule_settings_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: true;
            referencedRelation: "processes";
            referencedColumns: ["id"];
          },
        ];
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
      romaneios: {
        Row: RomaneioRow;
        Insert: {
          id?: string;
          order_id: string;
          status?: RomaneioStatusValue;
          shipment_date?: string | null;
          carrier?: string | null;
          vehicle?: string | null;
          notes?: string | null;
          conference_accepted_at?: string | null;
          conference_accepted_by?: string | null;
          conference_notes?: string | null;
          emitted_at?: string | null;
          emitted_by?: string | null;
          nf_number?: string | null;
          return_nf_number?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: Partial<{
          status: RomaneioStatusValue;
          shipment_date: string | null;
          carrier: string | null;
          vehicle: string | null;
          notes: string | null;
          conference_accepted_at: string | null;
          conference_accepted_by: string | null;
          conference_notes: string | null;
          emitted_at: string | null;
          emitted_by: string | null;
          nf_number: string | null;
          return_nf_number: string | null;
          updated_by: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "fk_romaneios_created_user";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "romaneios_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      romaneio_items: {
        Row: RomaneioItemRow;
        Insert: {
          id?: string;
          romaneio_id: string;
          order_item_id: string;
          quantity: number;
        };
        Update: Partial<{ quantity: number }>;
        Relationships: [
          {
            foreignKeyName: "romaneio_items_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "romaneio_items_romaneio_id_fkey";
            columns: ["romaneio_id"];
            isOneToOne: false;
            referencedRelation: "romaneios";
            referencedColumns: ["id"];
          },
        ];
      };
      romaneio_materials: {
        Row: RomaneioMaterialRow;
        Insert: {
          id?: string;
          romaneio_id: string;
          description: string;
          unit?: string;
          quantity_planned?: number;
          quantity_received?: number | null;
          quantity_used?: number | null;
        };
        Update: Partial<{
          description: string;
          unit: string;
          quantity_planned: number;
          quantity_received: number | null;
          quantity_used: number | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "romaneio_materials_romaneio_id_fkey";
            columns: ["romaneio_id"];
            isOneToOne: false;
            referencedRelation: "romaneios";
            referencedColumns: ["id"];
          },
        ];
      };
      mp_receipts: {
        Row: MpReceiptRow;
        Insert: {
          id?: string;
          order_id: string;
          /** Nº da nota de entrada (059). */
          entry_number?: string;
          /** Data da nota de entrada (059). */
          entry_date?: string;
          notes?: string | null;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "mp_receipts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      mp_receipt_free_items: {
        Row: MpReceiptFreeItemRow;
        Insert: {
          id?: string;
          mp_receipt_id: string;
          material_key: string;
          description: string;
          unit: string;
          quantity: number;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "mp_receipt_free_items_mp_receipt_id_fkey";
            columns: ["mp_receipt_id"];
            isOneToOne: false;
            referencedRelation: "mp_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      mp_receipt_materials: {
        Row: MpReceiptMaterialRow;
        Insert: {
          id?: string;
          mp_receipt_id: string;
          material_key: string;
          material_description: string;
          material_unit: string;
          quantity_kg: number;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "mp_receipt_materials_mp_receipt_id_fkey";
            columns: ["mp_receipt_id"];
            isOneToOne: false;
            referencedRelation: "mp_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_profile_is_internal: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_profile_access_context: {
        Args: Record<string, never>;
        Returns: Json;
      };
      current_profile_has_permission: {
        Args: { p_key: string };
        Returns: boolean;
      };
      current_profile_can_access_node: {
        Args: { p_node_id: string };
        Returns: boolean;
      };
      current_system_has_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_profile_recruitment_clients: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; active: boolean }[];
      };
      get_confirmed_quantity_by_item_ids: {
        Args: { p_item_ids: string[] };
        Returns: { order_item_id: string; quantity: number }[];
      };
      assign_employee_allocation: {
        Args: { p_employee_id: string; p_position_id: string | null };
        Returns: undefined;
      };
      delete_employee_allocation_subtree: {
        Args: { p_node_id: string };
        Returns: undefined;
      };
      import_employees: {
        Args: { p_rows: Json };
        Returns: number;
      };
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
      get_completed_weight_stats: {
        Args: {
          p_granularity?: string;
          p_anchor?: string | null;
          p_timezone?: string;
          p_process_code?: string | null;
          p_product_group_id?: number | null;
          p_without_product_group?: boolean;
        };
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
      get_child_item_groups: {
        // página de GRUPOS por código de filho + nº de grupos (033)
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
          p_offset?: number;
          p_limit?: number;
          // 038: seq por igualdade + faixas sobre os AGREGADOS do grupo.
          p_seq?: number | null;
          p_qty_min?: number | null;
          p_qty_max?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          p_weight_unit_min?: number | null;
          p_weight_unit_max?: number | null;
          // 043: ordenação por coluna (whitelist do parser).
          p_sort?: string | null;
          p_sort_dir?: string | null;
        };
        Returns: Json;
      };
      get_child_item_groups_page: {
        // Página, totais e recortes de atraso da Fábrica 1 calculados no banco (062).
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
          p_offset?: number | null;
          p_limit?: number | null;
          p_seq?: number | null;
          p_qty_min?: number | null;
          p_qty_max?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          p_weight_unit_min?: number | null;
          p_weight_unit_max?: number | null;
          p_sort?: string | null;
          p_sort_dir?: string | null;
          p_kit_overdue?: boolean | null;
          p_process_overdue?: boolean | null;
          p_process_code?: string | null;
          p_today?: string | null;
        };
        Returns: Json;
      };
      get_child_items_kit_overdue_totals: {
        // Resumo KIT para todo o conjunto filtrado, sem carregar a página (063).
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
          p_seq?: number | null;
          p_qty_min?: number | null;
          p_qty_max?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          p_weight_unit_min?: number | null;
          p_weight_unit_max?: number | null;
          p_today?: string | null;
        };
        Returns: Json;
      };
      reorder_processes: {
        Args: { p_ids: string[] };
        Returns: undefined;
      };
      save_product_group: {
        Args: {
          p_group_id: number | null;
          p_family_description: string;
          p_family_abbreviation: string;
          p_capacities: Json;
        };
        Returns: { id: number; group_type: string }[];
      };
      save_product_group_with_items: {
        Args: {
          p_group_id: number | null;
          p_family_description: string;
          p_family_abbreviation: string;
          p_items: Json;
        };
        Returns: { id: number; group_type: string }[];
      };
      delete_product_group: {
        // remove o grupo; capacidades/itens saem por cascade (073)
        Args: { p_group_id: number };
        Returns: undefined;
      };
      get_process_scheduling: {
        // OFs aplicáveis ao processo (concluídas com peso zero), ou todas quando null (087)
        Args: {
          p_process_id: string | null;
          p_family_group_id?: number | null;
        };
        Returns: ProcessSchedulingRowRecord[];
      };
      get_all_process_scheduling: {
        // 093: filas de TODOS os processos ativos de uma vez (índice de datas)
        Args: Record<string, never>;
        Returns: AllProcessSchedulingQueueRecord[];
      };
      save_process_schedule: {
        // grava a sequência global, opcionalmente com processo/data (077)
        Args: {
          p_process_id: string | null;
          p_anchor_date: string | null;
          p_rows: Json;
        };
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
      save_romaneio: {
        // cria/atualiza romaneio em ABERTO (cabeçalho+itens+materiais numa transação — 042/045/046)
        Args: {
          p_romaneio_id: string | null;
          p_order_id: string;
          p_shipment_date: string | null;
          p_carrier: string | null;
          p_vehicle: string | null;
          p_notes: string | null;
          p_items: Json;
          p_materials: Json;
        };
        Returns: { id: string; number: number };
      };
      save_romaneio_conference: {
        // ficha como formulário: marcação por item + materiais + observação; p_sign conclui (ABERTO → CONFERIDO) — 048
        Args: {
          p_romaneio_id: string;
          p_notes: string | null;
          p_checked_item_ids: string[];
          p_materials: Json;
          p_sign: boolean;
        };
        Returns: undefined;
      };
      confirm_romaneio: {
        // valida os gates e move CONFERIDO → CONFIRMADO (baixa na pendência da OF) — 045
        Args: { p_romaneio_id: string };
        Returns: undefined;
      };
      delete_romaneio: {
        // exclusão DEFINITIVA — só romaneios em ABERTO (045/046)
        Args: { p_romaneio_id: string };
        Returns: undefined;
      };
      cancel_romaneio: {
        // cancela CONFERIDO/CONFIRMADO (reverte a baixa derivada) — 042/045
        Args: { p_romaneio_id: string };
        Returns: undefined;
      };
      refresh_order_statuses: {
        // grava o status derivado do item e re-deriva o status da OF (013)
        Args: { p_item_id: string; p_item_status: string };
        Returns: undefined;
      };
      refresh_order_statuses_bulk: {
        // 092: grava o status derivado de VÁRIOS itens e re-deriva cada OF
        // afetada uma única vez (lote de processos)
        Args: { p_items: Json };
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
      get_romaneios_page: {
        // listagem de romaneios com ordenação por coluna (043) e
        // filtros de TODAS as colunas (047)
        Args: {
          p_search?: string | null;
          p_status?: string | null;
          p_order_code?: string | null;
          p_customer?: string | null;
          p_shipment_from?: string | null;
          p_shipment_to?: string | null;
          p_number_from?: number | null;
          p_number_to?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          p_nf_number?: string | null;
          p_return_nf?: string | null;
          p_sort?: string | null;
          p_sort_dir?: string | null;
          p_offset?: number | null;
          p_limit?: number | null;
        };
        Returns: RomaneioPageRow[];
      };
      get_romaneio_summary: {
        // contagens dos cartões de resumo com os mesmos filtros da
        // listagem (047) — 1 linha sempre
        Args: {
          p_search?: string | null;
          p_status?: string | null;
          p_order_code?: string | null;
          p_customer?: string | null;
          p_shipment_from?: string | null;
          p_shipment_to?: string | null;
          p_number_from?: number | null;
          p_number_to?: number | null;
          p_weight_min?: number | null;
          p_weight_max?: number | null;
          p_nf_number?: string | null;
          p_return_nf?: string | null;
        };
        Returns: RomaneioSummaryRow[];
      };
      get_romaneio_candidates: {
        // seletor de OFs candidatas com ordenação (043)
        Args: {
          p_search?: string | null;
          p_sort?: string | null;
          p_sort_dir?: string | null;
          p_offset?: number | null;
          p_limit?: number | null;
        };
        Returns: RomaneioCandidateRow[];
      };
      get_romaneio_customers: {
        // seletor em cascata de /romaneio/novo (044)
        Args: Record<string, never>;
        Returns: RomaneioCustomerRow[];
      };
      get_mp_receipt_customers: {
        // seletor em cascata de /recebimento-mp — OFs com pendência de MP (056/059)
        Args: Record<string, never>;
        Returns: MpReceiptCustomerRow[];
      };
      mp_order_materials: {
        // materiais da OF (grão MATÉRIA-PRIMA) — peso total, recebido e saldo (059)
        Args: { p_order_id: string };
        Returns: MpOrderMaterialRow[];
      };
      save_mp_receipt: {
        // cria a NOTA DE ENTRADA (nº + data + kg por material da OF + itens
        // fora da OF + espelho — 059/060)
        Args: {
          p_order_id: string;
          p_entry_number: string;
          p_entry_date: string | null;
          p_notes: string | null;
          p_materials: Json;
          /** Itens livres (fora da OF) — só registro (060). */
          p_free_items?: Json;
        };
        Returns: {
          id: string;
          number: number;
          entryNumber: string;
          entryDate: string;
          freeItems: number;
        };
      };
      update_mp_receipt: {
        // atualiza o cabeçalho e as linhas da nota de entrada em uma transação (076)
        Args: {
          p_receipt_id: string;
          p_entry_number: string;
          p_entry_date: string | null;
          p_notes: string | null;
          p_materials: Json;
          p_free_items?: Json;
        };
        Returns: {
          id: string;
          orderId: string;
          entryNumber: string;
          entryDate: string;
          freeItems: number;
        };
      };
      delete_mp_receipt: {
        // exclusão para correção — recalcula o espelho dos itens afetados (056/059)
        Args: { p_receipt_id: string };
        Returns: { id: string; orderId: string };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
