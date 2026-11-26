/** Chave de comparação da matrícula normalizada entre folha e cadastro. */
export function employeeImportKey(companyCode: string, registration: string): string {
  return `${companyCode}:${registration.replace(/^0+(?=\d)/, "")}`;
}
