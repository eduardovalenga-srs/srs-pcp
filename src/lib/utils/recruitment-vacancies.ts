import type { VacancyListItem } from "@/lib/types/recruitment";

export const ALL_RECRUITMENT_CUSTOMERS = "__ALL_RECRUITMENT_CUSTOMERS__";

export function getRecruitmentCustomerOptions(vacancies: readonly VacancyListItem[]): string[] {
  return [...new Set(
    vacancies
      .map((vacancy) => vacancy.customer?.trim() ?? "")
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "pt-BR"));
}

export function filterRecruitmentVacancies(
  vacancies: readonly VacancyListItem[],
  filters: { query: string; customer: string; showContracted: boolean },
): VacancyListItem[] {
  const normalized = filters.query.trim().toLocaleLowerCase("pt-BR");
  return vacancies.filter((vacancy) => {
    if (filters.showContracted ? vacancy.status !== "CONTRATADOS" : vacancy.status === "CONTRATADOS") {
      return false;
    }
    if (
      filters.customer !== ALL_RECRUITMENT_CUSTOMERS &&
      vacancy.customer?.trim() !== filters.customer
    ) {
      return false;
    }
    if (!normalized) return true;
    return [
      vacancy.title,
      vacancy.customer ?? "",
      vacancy.department,
      vacancy.location ?? "",
      vacancy.requester ?? "",
      vacancy.recruiter ?? "",
    ].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized));
  });
}
