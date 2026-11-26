import { describe, expect, it } from "vitest";

import type { VacancyListItem } from "@/lib/types/recruitment";
import {
  ALL_RECRUITMENT_CUSTOMERS,
  filterRecruitmentVacancies,
  getRecruitmentCustomerOptions,
} from "@/lib/utils/recruitment-vacancies";

function vacancy(id: string, customer: string | null, status: VacancyListItem["status"]): VacancyListItem {
  return {
    id,
    title: `Cargo ${id}`,
    customer,
    request_reason: "NOVA_VAGA",
    replacement_employee_id: null,
    allocation_client_id: null,
    allocation_location_id: null,
    allocation_area_id: null,
    allocation_position_id: null,
    approved_role_id: null,
    selected_candidate_id: null,
    department: "Produção",
    location: "Unidade A",
    employment_type: "CLT",
    quantity: 1,
    description: null,
    requirements: null,
    salary_range: null,
    requester: "Gestora",
    recruiter: null,
    priority: "NORMAL",
    status,
    opening_date: "2026-11-25",
    target_date: null,
    closed_reason: null,
    created_at: "",
    updated_at: "",
    created_by: null,
    updated_by: null,
    candidate_count: 0,
    selected_candidate_name: null,
    selected_candidate_hired_at: null,
  };
}

const vacancies = [
  vacancy("aberta", "Cliente A", "VAGAS_ABERTAS"),
  vacancy("processo", "Cliente B", "ENTREVISTA"),
  vacancy("contratada-a", "Cliente A", "CONTRATADOS"),
  vacancy("contratada-b", "Cliente B", "CONTRATADOS"),
  vacancy("sem-cliente", null, "CONTRATADOS"),
];

describe("filtros da lista de vagas", () => {
  it("lista os clientes ordenados e ignora valores vazios", () => {
    expect(getRecruitmentCustomerOptions(vacancies)).toEqual(["Cliente A", "Cliente B"]);
  });

  it("oculta contratados por padrão e filtra por cliente e texto em conjunto", () => {
    expect(filterRecruitmentVacancies(vacancies, {
      query: "unidade a",
      customer: "Cliente A",
      showContracted: false,
    }).map((item) => item.id)).toEqual(["aberta"]);
  });

  it("mostra apenas contratados quando o filtro é acionado", () => {
    expect(filterRecruitmentVacancies(vacancies, {
      query: "cargo contratada",
      customer: ALL_RECRUITMENT_CUSTOMERS,
      showContracted: true,
    }).map((item) => item.id)).toEqual(["contratada-a", "contratada-b"]);
  });

  it("respeita o cliente também na lista de contratados", () => {
    expect(filterRecruitmentVacancies(vacancies, {
      query: "",
      customer: "Cliente B",
      showContracted: true,
    }).map((item) => item.id)).toEqual(["contratada-b"]);
  });
});
