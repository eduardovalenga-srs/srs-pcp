import { describe, expect, it } from "vitest";

import {
  activeFilterChips,
  childItemFilterChips,
  childItemQueryString,
  hasRomaneioFilters,
  isSortableColumn,
  isValidProcessSort,
  normalizeDeliveryPeriod,
  orderQueryString,
  parseChildItemFilters,
  parseOrderFilters,
  parseProductionFilters,
  parseRomaneioFilters,
  productionQueryString,
  romaneioFilterChips,
  romaneioQueryString,
} from "@/lib/utils/filters";
import {
  CHILD_ITEMS_PAGE_SIZE,
  ORDERS_PAGE_SIZE,
  PRODUCTION_PAGE_SIZE,
  ROMANEIO_PAGE_SIZE,
} from "@/lib/constants/pagination";

describe("parseProductionFilters", () => {
  it("aplica os valores padrão quando a URL está vazia", () => {
    const filters = parseProductionFilters({});
    expect(filters).toEqual({
      search: "",
      orderStatus: "ALL",
      processCode: "ALL",
      processStatus: "ALL",
      processOverdue: false,
      delivery: "ALL",
      deliveryFrom: null,
      deliveryTo: null,
      orderCode: "",
      customer: "",
      family: "",
      parentItem: "",
      description: "",
      op: "",
      qtyMin: null,
      qtyMax: null,
      weightMin: null,
      weightMax: null,
      seq: null,
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
    // 999999 é cortado no teto de paginação (MAX_PAGE_SIZE).
    expect(filters.pageSize).toBe(1000);
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
    // 043: a Fábrica 2/Gestão passaram a ordenar pela coluna do cliente —
    // a chave `customer` está na whitelist da produção agora.
    expect(isSortableColumn("customer")).toBe(true);
    expect(isValidProcessSort("SOLDA")).toBe(true);
    expect(isValidProcessSort("solda")).toBe(false);
    expect(isValidProcessSort("LASER'; drop")).toBe(false);
  });

  it("lê o primeiro valor quando o parâmetro se repete", () => {
    const filters = parseProductionFilters({ q: ["aberto", "fechado"] });
    expect(filters.search).toBe("aberto");
  });

  it("lê a opção \"Atrasados\" dos filtros de processo (051)", () => {
    const porColuna = parseProductionFilters({ processo: "SOLDA", procsatrasado: "1" });
    expect(porColuna.processOverdue).toBe(true);
    expect(porColuna.processCode).toBe("SOLDA");
    // Um valor por filtro: a flag substitui a situação escolhida.
    expect(porColuna.processStatus).toBe("ALL");

    const porGrupo = parseProductionFilters({ procsatrasado: "1" });
    expect(porGrupo.processOverdue).toBe(true);
    expect(porGrupo.processCode).toBe("ALL");

    // Valor diferente de "1" e status vencido junto não ligam a flag sozinhos.
    expect(parseProductionFilters({ procsatrasado: "sim" }).processOverdue).toBe(false);
    expect(parseProductionFilters({ processo: "SOLDA", situacao: "CONCLUIDO", procsatrasado: "1" })).toMatchObject({
      processOverdue: true,
      processStatus: "ALL",
      processCode: "SOLDA",
    });
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

  it("lê a sequência por igualdade (inteiro >= 1) e a coluna OP (038)", () => {
    expect(parseProductionFilters({ seq: "7" }).seq).toBe(7);
    // Zero, negativos, fracionários e lixo são descartados (null).
    expect(parseProductionFilters({ seq: "0" }).seq).toBeNull();
    expect(parseProductionFilters({ seq: "-3" }).seq).toBeNull();
    expect(parseProductionFilters({ seq: "3.5" }).seq).toBeNull();
    expect(parseProductionFilters({ seq: "abc" }).seq).toBeNull();

    expect(parseProductionFilters({ op: " OP-777 " }).op).toBe("OP-777");

    const params = new URLSearchParams(
      productionQueryString(parseProductionFilters({ seq: "7", op: "OP-777" })),
    );
    expect(params.get("seq")).toBe("7");
    expect(params.get("op")).toBe("OP-777");
    const roundtrip = parseProductionFilters(Object.fromEntries(params));
    expect(roundtrip.seq).toBe(7);
    expect(roundtrip.op).toBe("OP-777");
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

  it("serializa a opção 'Atrasados' do filtro de processo e faz roundtrip (051)", () => {
    const filters = parseProductionFilters({ processo: "SOLDA", procsatrasado: "1" });
    const params = new URLSearchParams(productionQueryString(filters));
    expect(params.get("processo")).toBe("SOLDA");
    expect(params.get("procsatrasado")).toBe("1");
    // Um valor por filtro: a situação nunca sai junto da flag.
    expect(params.has("situacao")).toBe(false);

    const roundtrip = parseProductionFilters(Object.fromEntries(params));
    expect(roundtrip).toMatchObject({
      processCode: "SOLDA",
      processOverdue: true,
      processStatus: "ALL",
    });

    // Desligada, a chave some da URL (endereço volta a ficar limpo).
    expect(productionQueryString({ ...filters, processOverdue: false })).not.toContain("procsatrasado");
  });
});

describe("parseOrderFilters", () => {
  it("aplica padrões e valida status", () => {
    expect(parseOrderFilters({})).toEqual({
      search: "",
      status: "ALL",
      code: "",
      customer: "",
      deliveryFrom: null,
      deliveryTo: null,
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

  it("lê os filtros por coluna (OF/OS, Cliente e período de entrega — 038)", () => {
    const filters = parseOrderFilters({
      of: " 107482 ",
      cliente: "ACME",
      entregade: "2026-10-01",
      entregaate: "2026-10-15",
    });
    expect(filters.code).toBe("107482");
    expect(filters.customer).toBe("ACME");
    expect(filters.deliveryFrom).toBe("2026-10-01");
    expect(filters.deliveryTo).toBe("2026-10-15");

    // Data impossível e lixo caem no padrão (lado aberto).
    const invalid = parseOrderFilters({ entregade: "2026-02-31", cliente: "x".repeat(200) });
    expect(invalid.deliveryFrom).toBeNull();
    expect(invalid.customer).toHaveLength(80);

    // Roundtrip pela query string (mesmos nomes das telas de produção).
    const params = new URLSearchParams(orderQueryString(filters));
    expect(params.get("of")).toBe("107482");
    expect(params.get("cliente")).toBe("ACME");
    expect(params.get("entregade")).toBe("2026-10-01");
    expect(params.get("entregaate")).toBe("2026-10-15");
    const roundtrip = parseOrderFilters(Object.fromEntries(params));
    expect(roundtrip).toEqual(filters);
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
      processOverdue: false,
      overdue: false,
      seq: null,
      qtyMin: null,
      qtyMax: null,
      weightMin: null,
      weightMax: null,
      weightUnitMin: null,
      weightUnitMax: null,
      sort: "seq",
      sortDir: "asc",
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

  it("liga o filtro do card Atrasados pela URL (atrasados=1)", () => {
    const filters = parseChildItemFilters({ atrasados: "1" });
    expect(filters.overdue).toBe(true);
    // Só "1" liga: qualquer outro valor mantém o recorte desligado.
    expect(parseChildItemFilters({ atrasados: "0" }).overdue).toBe(false);
    expect(parseChildItemFilters({}).overdue).toBe(false);

    const params = new URLSearchParams(childItemQueryString(filters));
    expect(params.get("atrasados")).toBe("1");
    expect(parseChildItemFilters(Object.fromEntries(params)).overdue).toBe(true);
    // Padrão omitido: o link dos outros cards não carrega `atrasados`.
    expect(childItemQueryString(parseChildItemFilters({}))).not.toContain("atrasados");
  });

  it("lê a opção \"Atrasados\" dos filtros de processo (052)", () => {
    const porColuna = parseChildItemFilters({ processo: "LASER", procsatrasado: "1" });
    expect(porColuna.processOverdue).toBe(true);
    expect(porColuna.processCode).toBe("LASER");
    // Um valor por filtro: a flag substitui a situação escolhida.
    expect(porColuna.processStatus).toBe("ALL");

    const porGrupo = parseChildItemFilters({ procsatrasado: "1" });
    expect(porGrupo.processOverdue).toBe(true);
    expect(porGrupo.processCode).toBe("ALL");

    // Valor diferente de "1" e status vencido junto não ligam a flag sozinhos.
    expect(parseChildItemFilters({ procsatrasado: "sim" }).processOverdue).toBe(false);
    expect(
      parseChildItemFilters({ processo: "LASER", situacao: "CONCLUIDO", procsatrasado: "1" }),
    ).toMatchObject({
      processOverdue: true,
      processStatus: "ALL",
      processCode: "LASER",
    });

    // A chave é DIFERENTE do recorte do card (atrasados=1 = KIT vencido).
    expect(parseChildItemFilters({ atrasados: "1" }).processOverdue).toBe(false);
  });

  it("descarta página inválida e limita o tamanho da página", () => {
    expect(parseChildItemFilters({ pagina: "-5" }).page).toBe(1);
    expect(parseChildItemFilters({ pagina: "abc" }).page).toBe(1);
    // 999999 é cortado no teto de paginação (MAX_PAGE_SIZE).
    expect(parseChildItemFilters({ porpagina: "999999" }).pageSize).toBe(1000);
    expect(parseChildItemFilters({ porpagina: "50" }).pageSize).toBe(50);
  });

  it("lê o seq por igualdade e as faixas dos agregados do grupo (038)", () => {
    const filters = parseChildItemFilters({
      seq: "3",
      qtdmin: "10",
      qtdmax: "50",
      pesomin: "2,5",
      pesomax: "100",
      pesounmin: "1",
      pesounmax: "3.5",
    });
    expect(filters.seq).toBe(3);
    expect(filters.qtyMin).toBe(10);
    expect(filters.qtyMax).toBe(50);
    expect(filters.weightMin).toBe(2.5);
    expect(filters.weightMax).toBe(100);
    expect(filters.weightUnitMin).toBe(1);
    expect(filters.weightUnitMax).toBe(3.5);

    // Seq inválido e lixo numérico caem no padrão.
    const invalid = parseChildItemFilters({ seq: "0", qtdmin: "-1", pesounmax: "3kg" });
    expect(invalid.seq).toBeNull();
    expect(invalid.qtyMin).toBeNull();
    // "3kg" é aceito pelo parser numérico do app (extrai o número).
    expect(invalid.weightUnitMax).toBe(3);

    const params = new URLSearchParams(childItemQueryString(filters));
    expect(params.get("seq")).toBe("3");
    expect(params.get("qtdmin")).toBe("10");
    expect(params.get("pesounmin")).toBe("1");
    const roundtrip = parseChildItemFilters(Object.fromEntries(params));
    expect(roundtrip).toEqual(filters);
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

  it("serializa a opção 'Atrasados' do filtro de processo e faz roundtrip (052)", () => {
    const filters = parseChildItemFilters({ processo: "LASER", procsatrasado: "1" });
    const params = new URLSearchParams(childItemQueryString(filters));
    expect(params.get("processo")).toBe("LASER");
    expect(params.get("procsatrasado")).toBe("1");
    // Um valor por filtro: a situação nunca sai junto da flag.
    expect(params.has("situacao")).toBe(false);

    const roundtrip = parseChildItemFilters(Object.fromEntries(params));
    expect(roundtrip).toMatchObject({
      processCode: "LASER",
      processOverdue: true,
      processStatus: "ALL",
    });

    // Desligada, a chave some da URL (endereço volta a ficar limpo).
    expect(childItemQueryString({ ...filters, processOverdue: false })).not.toContain(
      "procsatrasado",
    );
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

  it("descreve o filtro do card Atrasados e sabe removê-lo", () => {
    const filters = parseChildItemFilters({ cliente: "ACME", atrasados: "1" });
    const chips = childItemFilterChips(filters);
    expect(chips.map((chip) => chip.label)).toEqual(["Cliente: ACME", "Atrasados (KIT vencido)"]);

    const overdueChip = chips.find((chip) => chip.key === "overdue");
    const semAtrasados = { ...filters, ...overdueChip?.clear };
    expect(semAtrasados.overdue).toBe(false);
    // Remover o recorte não derruba os demais filtros.
    expect(semAtrasados.customer).toBe("ACME");
  });

  it("descreve a opção 'Atrasados' do filtro de processo por coluna e por grupo (052)", () => {
    const porColuna = childItemFilterChips(
      parseChildItemFilters({ processo: "LASER", procsatrasado: "1" }),
    );
    expect(porColuna).toHaveLength(1);
    expect(porColuna[0].key).toBe("process");
    expect(porColuna[0].label).toBe("LASER: Atrasados");
    // Remover o chip desliga a flag E o par de processo.
    expect(porColuna[0].clear).toEqual({
      processCode: "ALL",
      processStatus: "ALL",
      processOverdue: false,
    });

    const porGrupo = childItemFilterChips(parseChildItemFilters({ procsatrasado: "1" }));
    expect(porGrupo).toHaveLength(1);
    expect(porGrupo[0].label).toBe("Atrasados (qualquer processo)");

    // Um chip só por filtro de processo: a flag não divide espaço com o de
    // situação — e o chip do card (KIT vencido) é OUTRO filtro, ao lado.
    const comSituacao = childItemFilterChips(
      parseChildItemFilters({ processo: "LASER", situacao: "CONCLUIDO", procsatrasado: "1" }),
    );
    expect(comSituacao.map((chip) => chip.key)).toEqual(["process"]);

    const comCard = childItemFilterChips(parseChildItemFilters({ procsatrasado: "1", atrasados: "1" }));
    expect(comCard.map((chip) => chip.key)).toEqual(["process", "overdue"]);
  });

  it("descreve o seq e as faixas dos agregados do grupo (038)", () => {
    const filters = parseChildItemFilters({
      seq: "3",
      qtdmin: "10",
      pesomin: "20",
      pesounmax: "3",
    });
    const chips = childItemFilterChips(filters);

    expect(chips.map((chip) => chip.key)).toEqual(["seq", "qty", "weight", "weightUnit"]);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Seq.: 3",
      "Qtd.: ≥ 10",
      "Peso total: ≥ 20",
      "Peso un.: ≤ 3",
    ]);

    // Remover um chip não derruba os demais.
    const semSeq = { ...filters, ...chips[0].clear };
    expect(semSeq.seq).toBeNull();
    expect(semSeq.qtyMin).toBe(10);
    expect(childItemFilterChips(semSeq).map((chip) => chip.key)).toEqual([
      "qty",
      "weight",
      "weightUnit",
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

  it("descreve a opção 'Atrasados' por coluna e por grupo (051)", () => {
    const porColuna = activeFilterChips(
      parseProductionFilters({ processo: "SOLDA", procsatrasado: "1" }),
    );
    expect(porColuna).toHaveLength(1);
    expect(porColuna[0].key).toBe("process");
    expect(porColuna[0].label).toBe("SOLDA: Atrasados");
    // Remover o chip desliga a flag E o par de processo.
    expect(porColuna[0].clear).toEqual({
      processCode: "ALL",
      processStatus: "ALL",
      processOverdue: false,
    });

    const porGrupo = activeFilterChips(parseProductionFilters({ procsatrasado: "1" }));
    expect(porGrupo).toHaveLength(1);
    expect(porGrupo[0].label).toBe("Atrasados (qualquer processo)");

    // Um chip só por filtro de processo: a flag não divide espaço com o de situação.
    expect(
      activeFilterChips(
        parseProductionFilters({ processo: "SOLDA", situacao: "CONCLUIDO", procsatrasado: "1" }),
      ),
    ).toHaveLength(1);
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

  it("descreve o seq por igualdade e a coluna OP (038)", () => {
    const filters = parseProductionFilters({ seq: "7", op: "OP-777" });
    const chips = activeFilterChips(filters);

    expect(chips.map((chip) => chip.key)).toEqual(["op", "seq"]);
    expect(chips.map((chip) => chip.label)).toEqual(["OP: OP-777", "Seq.: 7"]);

    // Remover um chip não derruba o outro.
    const semSeq = { ...filters, ...chips[1].clear };
    expect(semSeq.seq).toBeNull();
    expect(semSeq.op).toBe("OP-777");
    expect(activeFilterChips(semSeq).map((chip) => chip.label)).toEqual(["OP: OP-777"]);
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

describe("parseRomaneioFilters (047 — filtros em todas as colunas)", () => {
  it("aplica os valores padrão quando a URL está vazia", () => {
    expect(parseRomaneioFilters({})).toEqual({
      search: "",
      status: "ALL",
      orderCode: "",
      customer: "",
      shipmentFrom: null,
      shipmentTo: null,
      numberFrom: null,
      numberTo: null,
      weightFrom: null,
      weightTo: null,
      nfNumber: "",
      returnNfNumber: "",
      sort: "shipment_date",
      sortDir: "desc",
      page: 1,
      pageSize: ROMANEIO_PAGE_SIZE,
    });
  });

  it("lê os filtros de coluna novos e valida a situação", () => {
    const filters = parseRomaneioFilters({
      situacao: "conferido",
      numerode: "10",
      numeroate: "99",
      pesode: "1.5",
      pesoate: "80",
      nfsaida: " 12345 ",
      nfdev: "9876",
    });
    expect(filters.status).toBe("CONFERIDO");
    expect(filters.numberFrom).toBe(10);
    expect(filters.numberTo).toBe(99);
    expect(filters.weightFrom).toBe(1.5);
    expect(filters.weightTo).toBe(80);
    expect(filters.nfNumber).toBe("12345");
    expect(filters.returnNfNumber).toBe("9876");

    // Situação fora da whitelist e números impossíveis caem no padrão.
    const invalid = parseRomaneioFilters({ situacao: "HACK", numerode: "-5", pesoate: "abc" });
    expect(invalid.status).toBe("ALL");
    expect(invalid.numberFrom).toBeNull();
    expect(invalid.weightTo).toBeNull();
  });

  it("monta a query string com as chaves novas e faz o roundtrip", () => {
    const filters = parseRomaneioFilters({
      situacao: "ABERTO",
      numerode: "10",
      numeroate: "99",
      pesode: "1.5",
      pesoate: "80",
      nfsaida: "12345",
      nfdev: "9876",
    });
    const params = new URLSearchParams(romaneioQueryString(filters));
    expect(params.get("situacao")).toBe("ABERTO");
    expect(params.get("numerode")).toBe("10");
    expect(params.get("numeroate")).toBe("99");
    expect(params.get("pesode")).toBe("1.5");
    expect(params.get("pesoate")).toBe("80");
    expect(params.get("nfsaida")).toBe("12345");
    expect(params.get("nfdev")).toBe("9876");
    // 049: as chaves de processo NÃO viajam mais — saíram da listagem.
    expect(params.get("processo")).toBeNull();
    expect(params.get("procsituacao")).toBeNull();
    expect(parseRomaneioFilters(Object.fromEntries(params))).toEqual(filters);

    // Padrões continuam omitidos.
    expect(romaneioQueryString(parseRomaneioFilters({}))).toBe("");
  });

  it("ordena pela coluna Situação (whitelist com a chave status)", () => {
    const filters = parseRomaneioFilters({ ordem: "status", direcao: "asc" });
    expect(filters.sort).toBe("status");
    expect(filters.sortDir).toBe("asc");
    // Chave que não é coluna cai no default (data de saída).
    expect(parseRomaneioFilters({ ordem: "123abc" }).sort).toBe("shipment_date");
  });

  it("códigos de processo na URL não ordenam mais (049 saiu da listagem)", () => {
    // As colunas de processo passaram a viver no detalhe — um link
    // antigo com `ordem=<código>` cai no default (saída desc).
    expect(parseRomaneioFilters({ ordem: "SOLDA" }).sort).toBe("shipment_date");
    expect(parseRomaneioFilters({ ordem: "solda" }).sort).toBe("shipment_date");
    expect(parseRomaneioFilters({ ordem: "MP" }).sort).toBe("shipment_date");
    expect(parseRomaneioFilters({ ordem: "KIT" }).sort).toBe("shipment_date");
  });

  it("chaves de processo na URL são ignoradas (não há mais filtro na lista)", () => {
    const filters = parseRomaneioFilters({ processo: "solda", procsituacao: "nao_iniciado" });
    expect(filters).toEqual(parseRomaneioFilters({}));
    // `situacao` continua sendo a situação DO ROMANEIO.
    expect(parseRomaneioFilters({ situacao: "ABERTO" }).status).toBe("ABERTO");
    expect(parseRomaneioFilters({ processo: "SOLDA" })).toEqual(parseRomaneioFilters({}));
    expect(parseRomaneioFilters({ procsituacao: "CONCLUIDO" })).toEqual(parseRomaneioFilters({}));
  });
});

describe("romaneioFilterChips + hasRomaneioFilters (047)", () => {
  it("gera um chip por filtro ligado, com a remoção individual", () => {
    const chips = romaneioFilterChips(
      parseRomaneioFilters({
        q: "107482",
        situacao: "ABERTO",
        numerode: "10",
        numeroate: "99",
        pesode: "1.5",
        nfsaida: "12345",
        nfdev: "9876",
      }),
    );
    expect(chips.map((chip) => chip.key)).toEqual([
      "search",
      "status",
      "number",
      "weight",
      "nfNumber",
      "returnNfNumber",
    ]);
    expect(chips[1]?.label).toBe("Situação: Aberto");
    expect(chips[1]?.clear).toEqual({ status: "ALL" });
    expect(chips[2]?.label).toBe("Nº: #10 – #99");
    expect(chips[3]?.label).toBe("Peso: ≥ 1,5");
    expect(chips[4]?.label).toBe("NF ind.: 12345");
    expect(chips[5]?.label).toBe("NF devolução: 9876");
    expect(romaneioFilterChips(parseRomaneioFilters({}))).toEqual([]);
  });

  it("hasRomaneioFilters cobre todos os campos (nada de filtro órfão)", () => {
    expect(hasRomaneioFilters(parseRomaneioFilters({}))).toBe(false);
    expect(hasRomaneioFilters(parseRomaneioFilters({ q: "x" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ situacao: "ABERTO" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ of: "OF-1" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ cliente: "ACME" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ saidade: "2026-10-01" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ saidaate: "2026-10-01" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ numerode: "10" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ numeroate: "99" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ pesode: "1.5" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ pesoate: "80" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ nfsaida: "12345" }))).toBe(true);
    expect(hasRomaneioFilters(parseRomaneioFilters({ nfdev: "9876" }))).toBe(true);
    // 049: as chaves de processo não são mais filtro da lista.
    expect(hasRomaneioFilters(parseRomaneioFilters({ processo: "SOLDA", procsituacao: "CONCLUIDO" }))).toBe(false);
    // Ordenação e paginação NÃO são filtro.
    expect(hasRomaneioFilters(parseRomaneioFilters({ ordem: "status", pagina: "3" }))).toBe(false);
  });
});
