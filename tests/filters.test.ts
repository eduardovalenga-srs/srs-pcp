import { describe, expect, it } from "vitest";

import {
  activeFilterChips,
  childItemFilterChips,
  childItemQueryString,
  isSortableColumn,
  isValidProcessSort,
  normalizeDeliveryPeriod,
  orderQueryString,
  parseChildItemFilters,
  parseOrderFilters,
  parseProductionFilters,
  productionQueryString,
} from "@/lib/utils/filters";
import { PRODUCTION_PAGE_SIZE, ORDERS_PAGE_SIZE, CHILD_ITEMS_PAGE_SIZE } from "@/lib/constants/pagination";

describe("parseProductionFilters", () => {
  it("aplica os valores padrão quando a URL está vazia", () => {
    const filters = parseProductionFilters({});
    expect(filters).toEqual({
      search: "",
      orderStatus: "ALL",
      processCode: "ALL",
      processStatus: "ALL",
      delivery: "ALL",
      deliveryFrom: null,
      deliveryTo: null,
      orderCode: "",
      customer: "",
      family: "",
      parentItem: "",
      description: "",
      qtyMin: null,
      qtyMax: null,
      weightMin: null,
      weightMax: null,
      sort: "seq",
      sortDir: "asc",
      page: 1,
      pageSize: PRODUCTION_PAGE_SIZE,
    });
  });

  it("ignora valores inválidos e usa os padrões", () => {
    const filters = parseProductionFilters({
      status: "QUALQUER_COISA",
      situacao: "TALVEZ",
      entrega: "ONTEM",
      ordem: "1; drop table",
      pagina: "-5",
      porpagina: "999999",
    });
    expect(filters.orderStatus).toBe("ALL");
    expect(filters.processStatus).toBe("ALL");
    expect(filters.delivery).toBe("ALL");
    expect(filters.sort).toBe("seq");
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBeLessThanOrEqual(200);
  });

  it("lê o período de entrega e descarta datas inválidas (014)", () => {
    const filters = parseProductionFilters({
      entregade: "2026-10-01",
      entregaate: " 2026-10-15 ",
    });
    expect(filters.deliveryFrom).toBe("2026-10-01");
    expect(filters.deliveryTo).toBe("2026-10-15");

    const invalid = parseProductionFilters({
      entregade: "01/10/2026", // formato pt-BR não vale (URL usa ISO)
      entregaate: "2026-02-31", // data que não existe no calendário
    });
    expect(invalid.deliveryFrom).toBeNull();
    expect(invalid.deliveryTo).toBeNull();
  });

  it("aceita chave de ordenação de coluna de processo", () => {
    expect(isSortableColumn("delivery_date")).toBe(true);
    expect(isSortableColumn("customer")).toBe(false);
    expect(isValidProcessSort("SOLDA")).toBe(true);
    expect(isValidProcessSort("solda")).toBe(false);
    expect(isValidProcessSort("LASER'; drop")).toBe(false);
  });

  it("lê o primeiro valor quando o parâmetro se repete", () => {
    const filters = parseProductionFilters({ q: ["aberto", "fechado"] });
    expect(filters.search).toBe("aberto");
  });

  it("preserva parâmetros alheios ao montar a query (úteis para debug/links)", () => {
    const filters = parseProductionFilters({ q: "OF-10", status: "EM_PRODUCAO", pagina: "3" });
    const query = productionQueryString(filters, { page: 1 });
    const params = new URLSearchParams(query);
    expect(params.get("q")).toBe("OF-10");
    expect(params.get("status")).toBe("EM_PRODUCAO");
    expect(params.has("pagina")).toBe(false);
  });

  it("omite valores padrão para manter URLs limpas", () => {
    const filters = parseProductionFilters({});
    expect(productionQueryString(filters)).toBe("");
  });

  it("lê os filtros de coluna de texto e limita o tamanho", () => {
    const filters = parseProductionFilters({
      of: "  OF-1234  ",
      cliente: "ACME",
      familia: "portas",
      itempai: "ITEM-10",
      descricao: "palheta",
    });
    expect(filters.orderCode).toBe("OF-1234");
    expect(filters.customer).toBe("ACME");
    expect(filters.family).toBe("portas");
    expect(filters.parentItem).toBe("ITEM-10");
    expect(filters.description).toBe("palheta");

    // URL absurda é cortada (não vira payload infinito).
    expect(parseProductionFilters({ cliente: "x".repeat(200) }).customer).toHaveLength(80);
  });

  it("lê as faixas numéricas das colunas e descarta lixo", () => {
    const filters = parseProductionFilters({
      qtdmin: "5",
      qtdmax: "10",
      pesomin: "1,5",
      pesomax: "3.25",
    });
    expect(filters.qtyMin).toBe(5);
    expect(filters.qtyMax).toBe(10);
    // Aceita vírgula decimal (padrão pt-BR).
    expect(filters.weightMin).toBe(1.5);
    expect(filters.weightMax).toBe(3.25);

    const invalid = parseProductionFilters({ qtdmin: "abc", qtdmax: "-2", pesomin: "12kg" });
    expect(invalid.qtyMin).toBeNull();
    expect(invalid.qtyMax).toBeNull();
    // "12kg" é aceito pelo parser numérico do app (extrai o número).
    expect(invalid.weightMin).toBe(12);
  });

  it("serializa os filtros de coluna na query e omite os vazios", () => {
    const filters = parseProductionFilters({ cliente: "ACME", qtdmin: "5" });
    const params = new URLSearchParams(productionQueryString(filters));
    expect(params.get("cliente")).toBe("ACME");
    expect(params.get("qtdmin")).toBe("5");
    expect(params.has("familia")).toBe(false);
    expect(params.has("qtdmax")).toBe(false);

    const roundtrip = parseProductionFilters(Object.fromEntries(params));
    expect(roundtrip.customer).toBe("ACME");
    expect(roundtrip.qtyMin).toBe(5);
  });

  it("serializa o período de entrega na query e faz roundtrip (014)", () => {
    const filters = parseProductionFilters({
      entregade: "2026-10-01",
      entregaate: "2026-10-15",
    });
    const params = new URLSearchParams(productionQueryString(filters));
    expect(params.get("entregade")).toBe("2026-10-01");
    expect(params.get("entregaate")).toBe("2026-10-15");

    const roundtrip = parseProductionFilters(Object.fromEntries(params));
    expect(roundtrip.deliveryFrom).toBe("2026-10-01");
    expect(roundtrip.deliveryTo).toBe("2026-10-15");

    // Padrão continua omitido (URL limpa).
    expect(productionQueryString(parseProductionFilters({}))).toBe("");
  });
});

describe("parseOrderFilters", () => {
  it("aplica padrões e valida status", () => {
    expect(parseOrderFilters({})).toEqual({
      search: "",
      status: "ALL",
      page: 1,
      pageSize: ORDERS_PAGE_SIZE,
    });
    expect(parseOrderFilters({ status: "EM_PRODUCAO" }).status).toBe("EM_PRODUCAO");
    expect(parseOrderFilters({ status: "HACK" }).status).toBe("ALL");
  });

  it("monta query string omitindo padrões", () => {
    const filters = parseOrderFilters({ q: "cliente", status: "CANCELADO", pagina: "2" });
    const params = new URLSearchParams(orderQueryString(filters));
    expect(params.get("q")).toBe("cliente");
    expect(params.get("status")).toBe("CANCELADO");
    expect(params.get("pagina")).toBe("2");
    expect(orderQueryString(parseOrderFilters({}))).toBe("");
  });
});

describe("parseChildItemFilters", () => {
  it("aplica os valores padrões quando a URL está vazia", () => {
    expect(parseChildItemFilters({})).toEqual({
      search: "",
      orderCode: "",
      customer: "",
      parentItem: "",
      childItem: "",
      description: "",
      material: "",
      deliveryFrom: null,
      deliveryTo: null,
      processCode: "ALL",
      processStatus: "ALL",
      page: 1,
      pageSize: CHILD_ITEMS_PAGE_SIZE,
    });
  });

  it("lê os filtros de texto das colunas, aparando espaços e limitando o tamanho", () => {
    const filters = parseChildItemFilters({
      q: "  palheta  ",
      of: "107482",
      cliente: "ACME",
      itempai: "72ST18",
      filho: "72ST18-025",
      descricao: " barra ",
      material: "chapa 3mm",
    });
    expect(filters.search).toBe("palheta");
    expect(filters.orderCode).toBe("107482");
    expect(filters.customer).toBe("ACME");
    expect(filters.parentItem).toBe("72ST18");
    expect(filters.childItem).toBe("72ST18-025");
    expect(filters.description).toBe("barra");
    expect(filters.material).toBe("chapa 3mm");

    // URL absurda é cortada (não vira payload infinito).
    expect(parseChildItemFilters({ material: "x".repeat(200) }).material).toHaveLength(80);
  });

  it("lê o período de entrega e o filtro de processo/situação", () => {
    const filters = parseChildItemFilters({
      entregade: "2026-10-01",
      entregaate: "2026-10-31",
      processo: "laser",
      situacao: "concluido",
    });
    expect(filters.deliveryFrom).toBe("2026-10-01");
    expect(filters.deliveryTo).toBe("2026-10-31");
    expect(filters.processCode).toBe("LASER");
    expect(filters.processStatus).toBe("CONCLUIDO");

    // Data impossível e situação desconhecida caem no padrão.
    const invalid = parseChildItemFilters({ entregade: "2026-02-31", situacao: "QUALQUER" });
    expect(invalid.deliveryFrom).toBeNull();
    expect(invalid.processStatus).toBe("ALL");
  });

  it("descarta página inválida e limita o tamanho da página", () => {
    expect(parseChildItemFilters({ pagina: "-5" }).page).toBe(1);
    expect(parseChildItemFilters({ pagina: "abc" }).page).toBe(1);
    expect(parseChildItemFilters({ porpagina: "999999" }).pageSize).toBeLessThanOrEqual(200);
    expect(parseChildItemFilters({ porpagina: "50" }).pageSize).toBe(50);
  });

  it("monta a query string omitindo padrões e faz roundtrip", () => {
    expect(childItemQueryString(parseChildItemFilters({}))).toBe("");

    const filters = parseChildItemFilters({
      q: "palheta",
      of: "107482",
      cliente: "ACME",
      filho: "72ST18-025",
      entregade: "2026-10-01",
      situacao: "CONCLUIDO",
      pagina: "3",
    });
    const params = new URLSearchParams(childItemQueryString(filters));
    expect(params.get("q")).toBe("palheta");
    expect(params.get("of")).toBe("107482");
    expect(params.get("cliente")).toBe("ACME");
    expect(params.get("filho")).toBe("72ST18-025");
    expect(params.get("entregade")).toBe("2026-10-01");
    expect(params.get("situacao")).toBe("CONCLUIDO");
    expect(params.get("pagina")).toBe("3");
    expect(params.has("material")).toBe(false);
    expect(params.has("processo")).toBe(false);
    expect(params.has("porpagina")).toBe(false);

    const roundtrip = parseChildItemFilters(Object.fromEntries(params));
    expect(roundtrip.search).toBe("palheta");
    expect(roundtrip.orderCode).toBe("107482");
    expect(roundtrip.customer).toBe("ACME");
    expect(roundtrip.childItem).toBe("72ST18-025");
    expect(roundtrip.deliveryFrom).toBe("2026-10-01");
    expect(roundtrip.processStatus).toBe("CONCLUIDO");
    expect(roundtrip.page).toBe(3);
    expect(roundtrip.pageSize).toBe(CHILD_ITEMS_PAGE_SIZE);
  });

  it("mantém o tamanho da página escolhido no roundtrip da URL", () => {
    const filters = parseChildItemFilters({ cliente: "ACME", porpagina: "100" });
    const params = new URLSearchParams(childItemQueryString(filters));
    expect(params.get("porpagina")).toBe("100");

    const roundtrip = parseChildItemFilters(Object.fromEntries(params));
    expect(roundtrip.customer).toBe("ACME");
    expect(roundtrip.pageSize).toBe(100);
    expect(roundtrip.page).toBe(1);
  });

  it("volta à página 1 quando o filtro muda (reset aplicado como no componente)", () => {
    const filters = parseChildItemFilters({ pagina: "4", material: "barra" });
    // O Fabrica1Filters.apply monta o próximo estado com page: 1.
    const next = { ...filters, material: "chapa", page: 1 };
    const params = new URLSearchParams(childItemQueryString(next));
    expect(params.get("material")).toBe("chapa");
    expect(params.has("pagina")).toBe(false);
  });
});

describe("childItemFilterChips", () => {
  it("retorna vazio quando nenhum filtro está ativo", () => {
    expect(childItemFilterChips(parseChildItemFilters({}))).toEqual([]);
  });

  it("gera um chip por filtro ligado e sabe remover cada um sem afetar os demais", () => {
    const filters = parseChildItemFilters({ cliente: "ACME", filho: "72ST18-025", material: "chapa" });
    const chips = childItemFilterChips(filters);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Cliente: ACME",
      "Filho: 72ST18-025",
      "Matérias-primas: chapa",
    ]);

    const cliente = chips.find((chip) => chip.key === "customer");
    expect(childItemQueryString({ ...filters, ...cliente?.clear })).not.toContain("cliente=");
    expect(childItemQueryString({ ...filters, ...cliente?.clear })).toContain("filho=");
  });

  it("descreve o período de entrega e o filtro de processo", () => {
    const chips = childItemFilterChips(
      parseChildItemFilters({ entregade: "2026-10-01", entregaate: "2026-10-31", situacao: "CONCLUIDO" }),
    );
    expect(chips.map((chip) => chip.label)).toEqual([
      "Período de entrega: 01/10/2026 – 31/10/2026",
      "Concluído (qualquer processo)",
    ]);
  });
});

describe("activeFilterChips", () => {
  it("retorna vazio quando nenhum filtro está ativo", () => {
    expect(activeFilterChips(parseProductionFilters({}))).toEqual([]);
  });

  it("gera um chip por filtro ligado e sabe remover cada um sem afetar os demais", () => {
    const filters = parseProductionFilters({
      q: "porta",
      status: "EM_PRODUCAO",
      entrega: "OVERDUE",
      processo: "LASER",
      situacao: "CONCLUIDO",
    });
    const chips = activeFilterChips(filters);

    expect(chips.map((chip) => chip.key)).toEqual(["search", "orderStatus", "delivery", "process"]);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Busca: porta",
      "Situação: Em produção",
      "Entrega: Atrasados",
      "LASER: Concluído",
    ]);

    // Limpar o chip de situação não derruba os outros filtros.
    const semStatus = { ...filters, ...chips[1].clear };
    expect(semStatus.orderStatus).toBe("ALL");
    expect(semStatus.search).toBe("porta");
    expect(semStatus.delivery).toBe("OVERDUE");
    expect(semStatus.processCode).toBe("LASER");
    expect(semStatus.processStatus).toBe("CONCLUIDO");
  });

  it("descreve o filtro de processo sem situação específica", () => {
    const chips = activeFilterChips(parseProductionFilters({ processo: "SOLDA" }));
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("Processo: SOLDA");
    expect(chips[0].clear).toEqual({ processCode: "ALL", processStatus: "ALL" });
  });

  it("descreve situação aplicada a qualquer processo", () => {
    const chips = activeFilterChips(parseProductionFilters({ situacao: "CONCLUIDO" }));
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("Concluído (qualquer processo)");
  });

  it("gera chips para os filtros de coluna (texto e faixas)", () => {
    const filters = parseProductionFilters({
      cliente: "ACME",
      descricao: "palheta",
      qtdmin: "5",
      pesomin: "1,5",
      pesomax: "3",
    });
    const chips = activeFilterChips(filters);

    expect(chips.map((chip) => chip.key)).toEqual(["customer", "description", "qty", "weight"]);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Cliente: ACME",
      "Descrição: palheta",
      "Qtd.: ≥ 5",
      "Peso un.: 1,5 – 3",
    ]);

    // Remover a faixa não derruba os filtros de texto.
    const semPeso = { ...filters, ...chips[3].clear };
    expect(semPeso.weightMin).toBeNull();
    expect(semPeso.weightMax).toBeNull();
    expect(semPeso.customer).toBe("ACME");
    expect(semPeso.qtyMin).toBe(5);
  });

  it("descreve faixa fechada de quantidade", () => {
    const chips = activeFilterChips(parseProductionFilters({ qtdmin: "4", qtdmax: "10" }));
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("Qtd.: 4 – 10");
    expect(chips[0].clear).toEqual({ qtyMin: null, qtyMax: null });
  });

  it("descreve o período de entrega fechado e sabe removê-lo (014)", () => {
    const filters = parseProductionFilters({
      entregade: "2026-10-01",
      entregaate: "2026-10-15",
    });
    const chips = activeFilterChips(filters);

    expect(chips).toHaveLength(1);
    expect(chips[0].key).toBe("deliveryPeriod");
    expect(chips[0].label).toBe("Período de entrega: 01/10/2026 – 15/10/2026");
    expect(chips[0].clear).toEqual({ deliveryFrom: null, deliveryTo: null });

    // Remover o chip zera os dois lados e não deixa chip órfão.
    const limpo = { ...filters, ...chips[0].clear };
    expect(activeFilterChips(limpo)).toEqual([]);
  });

  it("descreve período com apenas um lado aberto (014)", () => {
    const soDe = activeFilterChips(parseProductionFilters({ entregade: "2026-10-01" }));
    expect(soDe[0]?.label).toBe("Período de entrega: a partir de 01/10/2026");

    const soAte = activeFilterChips(parseProductionFilters({ entregaate: "2026-10-15" }));
    expect(soAte[0]?.label).toBe("Período de entrega: até 15/10/2026");
  });
});

describe("normalizeDeliveryPeriod (rascunho do input de data)", () => {
  it("libera o commit quando os dois lados são datas válidas", () => {
    expect(normalizeDeliveryPeriod("2026-10-01", "2026-10-15")).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
      error: null,
    });
  });

  it("trata vazio (ou só espaços) como lado aberto", () => {
    expect(normalizeDeliveryPeriod("", "2026-10-15")).toEqual({
      from: null,
      to: "2026-10-15",
      error: null,
    });
    expect(normalizeDeliveryPeriod("2026-10-01", "   ")).toEqual({
      from: "2026-10-01",
      to: null,
      error: null,
    });
    expect(normalizeDeliveryPeriod("", "")).toEqual({ from: null, to: null, error: null });
  });

  it("bloqueia o commit enquanto a data está incompleta (meio da digitação)", () => {
    // O <input type="date"> devolve "" até o ano ser digitado — o commit
    // nesse estado apagaria o dia/mês já digitado.
    expect(normalizeDeliveryPeriod("", "").error).toBeNull(); // nada digitado ainda
    expect(normalizeDeliveryPeriod("2026-02-30", "").error).toBe("invalid"); // inexistente
    expect(normalizeDeliveryPeriod("01/10/2026", "").error).toBe("invalid"); // formato pt-BR
    expect(normalizeDeliveryPeriod("2026-10-01", "2026-15-40").error).toBe("invalid");
  });

  it("bloqueia período invertido (de posterior a até)", () => {
    expect(normalizeDeliveryPeriod("2026-10-15", "2026-10-01")).toEqual({
      from: null,
      to: null,
      error: "inverted",
    });
    // Mesmo dia nos dois lados é um período válido (inclusivo).
    expect(normalizeDeliveryPeriod("2026-10-01", "2026-10-01").error).toBeNull();
  });

  it("apara espaços das pontas antes de decidir", () => {
    expect(normalizeDeliveryPeriod(" 2026-10-01 ", " 2026-10-15 ")).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
      error: null,
    });
  });
});
