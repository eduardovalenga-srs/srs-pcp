import { describe, expect, it } from "vitest";

import { saveEmployeeSchema } from "@/lib/validators/employee.schema";

const employeeInput = {
  companyCode: "752",
  companyName: "SRS DESENVOLVIMENTO LTDA",
  registration: "123",
  name: "Ana Funcionária",
};

describe("modelo de cobrança do funcionário", () => {
  it("usa HORA como padrão e aceita KG", () => {
    expect(saveEmployeeSchema.parse(employeeInput).billingModel).toBe("HORA");
    expect(saveEmployeeSchema.parse({ ...employeeInput, billingModel: "KG" }).billingModel).toBe("KG");
  });

  it("rejeita modelos fora de HORA e KG", () => {
    expect(
      saveEmployeeSchema.safeParse({ ...employeeInput, billingModel: "DIARIA" }).success,
    ).toBe(false);
  });
});
