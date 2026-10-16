# Imperatriz — Sistema de Gestão Corporativa

Aplicação web para controle de produção industrial (serralheria): substitui a planilha
de Excel por um sistema com pedidos, itens, processos configuráveis, importação de
planilha com prévia e histórico completo de alterações.

O sistema se chama **Imperatriz** (menu superior e aba do navegador, com o brasão
`/logo_imperatriz.png` ao lado do nome).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Linguagem | TypeScript (strict) |
| Estilos | Tailwind CSS v4 + componentes shadcn/ui |
| Banco / Auth | Supabase (PostgreSQL + RLS + Auth) |
| Formulários | react-hook-form + zod |
| Planilha | xlsx (SheetJS) |
| PDF (OF A1) | pdfjs-dist (extração de texto por coordenadas) |
| Testes | Vitest + PGlite (Postgres em WASM) |
| Deploy | Vercel |

## Como rodar localmente

```bash
# 1. dependências
npm install

# 2. variáveis de ambiente
cp .env.example .env.local
# preencha NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# (Supabase > Project Settings > API)

# 3. banco de dados (Supabase CLI ou SQL Editor)
#    rode as migrations em ordem:
#    supabase/migrations/001_initial_schema.sql
#    supabase/migrations/002_rls.sql
#    supabase/migrations/003_indexes.sql
#    supabase/migrations/004_seed_processes.sql
#    supabase/migrations/005_import_tables.sql
#    supabase/migrations/006_functions.sql
#    supabase/migrations/007_column_filters.sql
#    supabase/migrations/008_process_planning.sql
#    supabase/migrations/009_process_reorder.sql
#    supabase/migrations/010_process_backfill.sql
#    supabase/migrations/011_order_item_materials.sql
#    supabase/migrations/012_profiles_active.sql
#    supabase/migrations/013_order_item_op.sql
#    supabase/migrations/014_delivery_period.sql
#    supabase/migrations/015_import_kg_total_metaleira.sql
#    supabase/migrations/016_of_structure_import.sql
#    supabase/migrations/017_weight_total.sql
#    supabase/migrations/018_qty_total.sql
#    supabase/migrations/019_overdue_totals.sql
#    supabase/migrations/020_expedition_stats.sql
#    supabase/migrations/021_mp_process.sql
#    supabase/migrations/022_order_process_defaults.sql
#    supabase/migrations/023_weight_total_derived.sql
#    supabase/migrations/024_totals_and_performance.sql
#    supabase/migrations/025_production_rows_by_order.sql
#    supabase/migrations/026_profile_write_grants.sql
#    supabase/migrations/027_apply_of_import_process_defaults.sql
#    supabase/migrations/028_import_process_material_rules.sql
#    supabase/migrations/029_process_status_simplification.sql
#    supabase/migrations/030_ch_prefix_marks_laser.sql
#    supabase/migrations/031_process_completed_at.sql
#    supabase/migrations/032_import_process_final_chain.sql
#    supabase/migrations/033_get_child_item_groups.sql
#    supabase/migrations/034_import_material_prefix_serra.sql
#    supabase/migrations/035_card_family_totals.sql
#    supabase/migrations/036_order_item_seq.sql
#    supabase/migrations/037_family_totals_by_card.sql
#
#    via CLI:  supabase db push   (após `supabase link`)

# 4. (opcional) dados de demonstração
psql "$SUPABASE_DB_URL" -f supabase/seed_demo.sql

# 4b. (opcional) limpar TODO o movimento para reimportar/testar
#     (apaga pedidos, itens, materiais, produção e histórico de importação;
#      preserva usuários e catálogo de processos — ver "Limpar a base")
psql "$SUPABASE_DB_URL" -f supabase/clear_data.sql

# 5. desenvolvimento
npm run dev
# http://localhost:3000
```

### Primeiro acesso

1. Crie o usuário em **Authentication > Users > Add user** (ou pela UI do Supabase).
2. Entre na aplicação: o perfil nasce como **Operador**.
3. O primeiro usuário da instância vira **Administrador** pelo banner exibido no painel
   (função `claim_first_admin`, segura para múltiplas pessoas: só o primeiro conquista).
4. A partir daí os demais usuários são criados pelo ADMIN em **Configurações > Novo
   usuário** (com senha temporária — ver "Gestão de usuários").

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | testes (Vitest + PGlite) |
| `npm run validate` | typecheck + lint + testes |

## Estrutura

```
src/
  app/
    (auth)/login            tela de autenticação (com "Esqueci minha senha")
    (auth)/redefinir-senha/ destino do link de recuperação de senha
    (dashboard)/            casca autenticada (menu superior)
      gestao-entregas/        tabela por OF × processo (consolidada, 025; rota /gestao-entregas; /producao redireciona)
      fabrica-1/            lista de itens filhos com matérias-primas (rota /fabrica-1)
      fabrica-2/            réplica da gestão com código próprio (rota /fabrica-2; ADMIN/GESTOR)
      pedidos/              CRUD de pedidos
        [id]/               detalhes da OF (itens pai + filhos aninhados, processos e MP)
        [id]/editar/        formulário de edição
      dashboard/            KPIs, janelas de entrega, carga por processo
      importacao/           assistente de importação (Excel ou PDF da A1)
      processos/            catálogo de processos (fluxo fabril)
      configuracoes/        usuários e permissões
    api/importacao/         análise / prévia / execução + modelo .xlsx (aceita .pdf)
  components/               ui (shadcn) + producao/fabrica1/fabrica2/pedidos/dashboard/…
  lib/
    actions/                Server Actions (única porta de escrita)
    services/               regras de negócio (server-only)
    repositories/           acesso a dados (Supabase)
    validators/             schemas zod
    import/                 parser/estrutura/diferenças/plano da importação (layout OF)
                            excel-parser (SheetJS) + of-pdf/pdf-text (PDF da A1)
    utils/                  datas, formatação, filtros, regras de produção
    supabase/               clientes: server (anon + RLS), client (browser), admin (service role)
supabase/
  migrations/               001..037 (ordem obrigatória)
  seed_demo.sql             OF 001..OF 008 (opcional)
  clear_data.sql            limpa todo o movimento para reimportar/testar (manual)
tests/                      testes de migrations, RLS, RPC, importação, regras, usuários
```

## Regras de negócio centrais

- **Processos são dados**: a tabela `processes` define as colunas da tela de gestão de
  entregas
  (LASER, DB_CH, SERRA, DB_TB, PUNC, FICEP, KIT, PRE_MTG, SOLDA, ACAB, QUALITY, EXP).
  Adicionar um processo é um `INSERT` — nenhuma mudança de estrutura.
  **Invariante**: todo item possui linha em `production_processes` para todo processo
  ativo (a ausência de linha nunca é intencional — "não se aplica" é o status
  `NAO_APLICAVEL`), senão a célula fica "—" sem data. O **backfill** (RPC
  `backfill_process`, migração 010/022) roda na própria migração e ao criar/reativar
  processo em `/processos`, sempre cobrindo o catálogo inteiro; a importação nova
  garante o catálogo pela própria RPC `apply_of_import` (nível pai e filho).
- **Seleção de processos no pedido** (migração 022): no formulário os processos nascem
  **desmarcados** e quem marca é o usuário — só o **MP** vem marcado (é pré-requisito
  para iniciar a produção). Ao salvar, o plano grava **uma linha por processo ativo**:
  o marcado mantém o status que já roda (ou nasce `NAO_INICIADO`, e um `NAO_APLICAVEL`
  re-marcado volta para `NAO_INICIADO`) e o desmarcado vira `NAO_APLICAVEL` — criado
  inclusive quando a linha ainda não existia. Na edição, marcado = linha existente e
  não `NAO_APLICAVEL`. Ao reabrir, o que foi desmarcado continua desmarcado.
  Processo **novo no catálogo** entra como `NAO_APLICAVEL` nos itens existentes (MP
  é a exceção: nasce `NAO_INICIADO`). Cada item precisa de ao menos um processo
  aplicável, senão o status derivado dele seria `CONCLUIDO`.
- **Ordem da cadeia**: `display_order` — no cadastro o processo entra ao final
  (máximo + 1, automático) e em `/processos` a lista reordena por arrastar-e-soltar
  (RPC `reorder_processes`, migração 009, tudo em uma transação). A ordem define as
  colunas da gestão de OF e as janelas de execução previstas. O **código**
  (LASER, SOLDA…) nunca muda: é a chave dos filtros e do histórico.
- **Coluna MP (matéria-prima)**: a cadeia da Fábrica 1 (LASER, DB CH, SERRA, DB TB,
  PUNC, METALEIRA, FICEP) não abre coluna na gestão de OF — a primeira coluna de
  processos é a **MP** (migração 021), controlada como as demais (célula clicável,
  quantidades, observações e histórico), mas com **apenas duas situações: não iniciado
  ou concluído**. Os demais processos seguem com coluna própria. Como é o **pré-requisito
  para iniciar a produção**, o MP vem sempre marcado no formulário do pedido (caixa
  desabilitada), o `saveOrder` o força como selecionado e o "Nec." da folha do processo
  fica travado (migração 022). **Data efetiva de recebimento** (031): com o MP
  concluído, a célula/linha mostra a data em que a MP foi efetivamente recebida
  (`production_processes.completed_at`, formatada no fuso do negócio) **em cima da
  data prevista**, sem os rótulos no visível (o `title`/hover traz os nomes com ano) —
  em todas as listas (gestão de OF, Fábrica 2 e Fábrica 1, desktop e mobile);
  sem recebimento sinalizado, só a prevista. Na Fábrica 1 a janela vem do **item pai**
  (entrega + status do pai), já que a coluna MP é herdada dele — na linha agrupada
  (033) os **pais do grupo** agregam: pior situação, menor entrega e a data efetiva
  mais recente entre os concluídos. No detalhe da OF a
  linha do processo mantém `recebida dd/MM` ao lado da janela prevista.
- **Datas previstas**: cada processo tem `location` (ex.: Fábrica 1) e `duration_days`
  (dias úteis — seg a sex, 1 a 365). As janelas de execução são contadas de TRÁS para
  FRENTE da **entrega efetiva do item — a do pedido quando o item não tem própria**
  (`lib/utils/process-schedule.ts`; mesma regra da Fábrica 1, do detalhe da OF e da
  migração 022 na gestão de OF), somente em dias úteis:
  a **expedição acontece no dia útil anterior à entrega** (entrega no fim de semana →
  expedição na sexta anterior) e cada etapa anterior termina no dia útil anterior ao
  início da seguinte — nunca agenda fim de semana (feriados ainda não são considerados).
  Processos **desmarcados no pedido** (`NAO_APLICAVEL`) ficam de fora do cálculo: não
  ocupam dias na contagem regressiva (senão empurravam as janelas dos demais para datas
  antigas, como se o trabalho fosse acontecer) e **não ganham data prevista** na célula.
  Nada é gravado: as janelas são calculadas na leitura, então valem igual para pedido
  manual e para OF importada (a importação grava entrega em todo registro; o formulário
  grava no item a data do pedido quando ele vem em branco).
  Aparece como **dd/MM na célula** da gestão de OF, janela completa no tooltip e
  data completa na folha de detalhes. Datas já vencidas aparecem em **vermelho**: a
  **entrega** apenas quando a expedição ainda não concluiu (a mesma regra de atraso) e
  as datas de **processo** (MP e células), exceto o processo já concluído.
- **Edição manual da entrega**: a data de entrega de um item pode ser alterada na
  própria coluna **Ent.** da gestão de OF (popover com data + Salvar) e na
  folha do processo (campo **Entrega**, com prévia recalculando ao digitar) — sempre
  por perfil com `orders.edit` (ADMIN/GESTOR). As janelas previstas são **derivadas
  da data em toda leitura**, então gravar a nova data recalcula as previsões de
  todos os processos e a regra de atraso sem nenhuma gravação extra (a ação chama
  `updateItemDeliveryDateAction` e o refresh da página refaz a conta). Vazio limpa
  a entrega: a linha fica "sem data de entrega — não há como calcular as datas".
- **Situações**: `NAO_INICIADO`, `CONCLUIDO`, `NAO_APLICAVEL` (migração 029 —
  `EM_ANDAMENTO` e `BLOQUEADO` foram removidos e os dados gravados viraram
  `NAO_INICIADO`).
  Nada avança de etapa por conta própria, **exceto a cascata da linha do
  tempo** (regra 62 revisada, vale na edição unitária e na em lote): concluir
  um processo conclui automaticamente os **predecessores não iniciados** do
  mesmo item, e devolvê-lo a `NAO_INICIADO` **reinicia a linha**: os concluídos
  antes e depois dele voltam a `NAO_INICIADO` — `NAO_APLICAVEL` nunca é tocado,
  quantidades/observações são preservadas e cada ajuste gera seu
  `production_event` com nota de automação
  (`predecessorsToComplete`/`concludedProcessesToReset` em
  `lib/utils/production.ts`). O **MP** aceita apenas
  `NAO_INICIADO` e `CONCLUIDO`: a folha de edição lista só essas duas opções e o
  serviço rejeita as demais (`allowedProcessStatuses`, `lib/utils/production.ts`).
- **Ordem de Produção (OP)** (`order_items.op`, migração 013): código da OP por
  sub-item (1–50 caracteres, `null` = em espera) — preenchido no formulário do pedido,
  exibido no detalhe `/pedidos/[id]` e na coluna **OP** da gestão de OF. O campo
  **Situação** do pedido saiu do formulário: tanto o status do item quanto o da OF são
  **derivados no servidor** e gravados em uma única transação (`apply_import`):
  1. todos os processos aplicáveis concluídos → `CONCLUIDO` (o progresso vence);
  2. OP em branco → `PLANEJADO` ("Em espera"), **mesmo** com processo ativo;
  3. OP preenchida → `EM_PRODUCAO`.
  A OF acompanha os itens (todos concluídos → Concluído; algum em produção → Em
  produção; senão Em espera) e `CANCELADO` nunca é sobrescrito pela derivação. Na
  gestão, o recálculo passa pela RPC `refresh_order_statuses` (SECURITY DEFINER com
  checagem de papel) porque a RLS de `orders`/`order_items` é só ADMIN/GESTOR, enquanto
  o OPERADOR tem `production.update_status`. **Sem backfill**: as OFs existentes ficam
  com a OP em branco até o código ser preenchido. A numeração/gestão das OPs (módulo
  completo, estados finais e eventos dedicados) fica para a fase 2 — a planilha de
  importação também não tem coluna de OP (item importado nasce sem OP).
- **Atraso**: `delivery_date < hoje` **e** processo `EXP <> CONCLUIDO`
  ("hoje" calculado no fuso do negócio, `America/Sao_Paulo`).
- **Importação (layout novo — estrutura OF)**: o arquivo da fábrica **substitui** a
  planilha antiga de 22 colunas. Ele traz a árvore completa — **OF → itens pai
  (`ps_idPos`) → itens filhos (`cp_comp`) → matéria-prima por item** — reconhecida
  **pelo nome técnico da coluna** (`of_idOF`, `ps_Descr`, `cp_compdescr`, …), sem
  etapa de mapeamento manual; colunas extras (obra, área, desenhos) entram na lista
  de ignoradas e o `os_NMCliente` do arquivo é descartado: **cliente e data de entrega
  são digitados no formulário da importação** e valem para todos os registros (OF,
  pais e filhos). O arquivo **não traz processos**: o catálogo completo é criado para
  pai e filho exatamente como no pedido manual — só o **MP** nasce marcado
  (`NAO_INICIADO`, obrigatório) e os demais nascem desmarcados (`NAO_APLICAVEL`,
  migração 027). O prefixo do material decide mais no nascer da linha: **TB** nas duas
  primeiras letras marca **SERRA** e **DB TB**; **CH** marca **DB CH** e **LASER**
  (migração 030, corrigindo o CH da 028); **L** ou **F** na primeira letra marca só
  **SERRA** (migração 034, pai e filho como as demais regras — sem backfill: re-importação
  não altera status já gravado). A **cadeia final** também nasce
  marcada, por tipo de item (migração 032): no **pai**, `PRE_MTG`, `SOLDA`,
  `ACAB`, `QUALITY` e `EXP` (o kit montado acontece nele); no **filho**, o
  `KIT` (encerra a cadeia da Fábrica 1) — os dois entram assim na previsão de
  datas, enquanto `LASER`/`PUNC`/`METALEIRA`/`FICEP` seguem manuais.
  `parent_order_item_id` liga filho ao pai
  (migração 016; toda linha com `ps_Tipo` = X é descartada — o material direto vem
  de linha sem filhos e sem X).
  Nunca grava sem prévia e confirmação; cada OF já existente exige uma decisão —
  **Atualizar / Manter / Ignorar** (RPC transacional `apply_of_import`: atualizar
  preserva status e OP, troca os materiais e remove do banco o que sumiu do arquivo;
  OF com erro fica inteira de fora, alertas não bloqueiam e qualquer falha faz
  rollback completo). A RPC antiga `apply_import` continua no formulário de pedidos
  (formato item único). A gestão de OF mostra **uma linha por OF** (consolidada,
  migração 025) — os itens pai e filho aparecem em `/pedidos/[id]` (cards aninhados com
  processos e MP) e na Fábrica 2, que segue **por item**.
  Pesos são **derivados**: `total_weight_kg` = quantidade × peso unitário, gravado por
  trigger (migração 023); `pos_PesoTotal`/`cp_comppesototal` da planilha só serve para
  **avisar na prévia** quando divergir da fórmula (migração 015);
  `METALEIRA` segue como processo próprio do catálogo (ordem 55, entre `PUNC` e
  `FICEP`). Cada lote fica em `import_batches` com os erros linha a linha em
  `import_batch_errors` (o histórico abaixo do assistente atualiza sozinho quando uma
  importação é concluída); fixture real em `tests/fixtures/of-107482-novo-layout.xlsx`
  (7 pais, 62 filhos, 62 materiais).
- **Importação via PDF (OF da A1 Engenharia)**: além do Excel, o assistente aceita o
  **PDF da Ordem de Fabricação** e extrai a seção **COMPOSIÇÃO DOS CONJUNTOS** para
  montar a **mesma árvore** (`OF → pai → filho → MP`), reaproveitando prévia, plano,
  decisões e lote sem mudança (`pdfjs-dist`, texto por coordenadas). O parser
  (`lib/import/of-pdf.ts`) lê o **código da OF** e a **descrição** das linhas de
  cabeçalho antes da seção (o texto do pdf.js traz o acento correto via ToUnicode); na
  seção, cada **conjunto** é um pai (código, descrição, `N PÇS` e o **Peso Unitário** na
  mesma linha), e **filho** (peça `… CJ`) e **matéria-prima** vêm em linhas separadas,
  pareados pelo **peso coincidente** no bloco (tolerância 0,01; com fallback de ordem e
  aviso se sobrar material órfão — vai para o pai). **Cliente e data de entrega também
  vêm só do formulário** (não do PDF). A quantidade da MP vira o **peso em KG** e a
  medida dimensional (`0,335M`/`0,053M2`) e as dimensões (`Dim. 230x230`) vão para as
  observações; a **soma dos pesos dos filhos** é conferida contra o Peso Unitário do
  cabeçalho (aviso quando diverge). PDF ilegível, sem a seção ou com outra seção geram
  erro amigável (entrada do usuário). Fixture real reduzida em
  `tests/fixtures/of-2615-aa-4.pdf` (77 pais, 154 filhos, 154 materiais).
- **Matérias-primas** (`order_item_materials`, migração 011): insumo do **sub-item**
  (descrição, quantidade, unidade e observação) — sem processos próprios e fora da grade
  de produção. Sempre gravadas em lote pela RPC `replace_item_materials` (troca a lista
  do item em uma transação, máx. 50), por ADMIN/GESTOR, no formulário do pedido ou na
  tela de detalhes.
- **Fábrica 1** (`/fabrica-1`): lista de **itens filhos agrupados por código dentro da
  mesma OF** (033) com suas **matérias-primas e quantidades somadas** — visão de
  insumos/compras: o mesmo componente repetido entre os pais da OF vira **UMA linha**
  (Σ de quantidade, peso total Σ, entrega = menor dos membros; peso unitário só quando
  todos os membros coincidem, senão "—"). O filho exibe **×N** (itens agrupados) e o
  item pai **+N** (outros pais do grupo, com a lista no hover). Colunas, nesta ordem:
  **Seq.** (036 — prioridade do planejamento: o MENOR seq dos membros; editar aplica o
  número a TODO o grupo, `orders.edit`), OF (link para `/pedidos/[id]`), **item pai** (badge + descrição + "+N"), filho
  (badge + descrição + "×N"), **matérias-primas** mescladas por descrição + unidade com
  Σ de quantidade ("descrição — qtd UN"; **grupo sem material aparece sinalizado** —
  "Nenhum material cadastrado"), quantidade (Σ), **peso unitário**, **peso total**
  (Σ qtd × peso unit. — coluna derivada `total_weight_kg`, migração 023; sem peso em
  nenhum membro não mostra total), entrega (menor dos membros) e **processos**
  (`fabrica1ItemProcesses`: **MP primeiro**, depois os aplicáveis em ordem fabril **até
  o KIT — o que vem depois dele fica oculto** (pré-montagem, solda, acabamento, qualidade
  e expedição); cada processo exibe símbolo + código + **situação agregada do grupo** —
  `CONCLUIDO` só quando todos os membros aplicáveis concluíram, `—` (não aplicável) só
  quando nenhum se aplica, e no meio `NAO_INICIADO` com Σconcluído/Σplanejado dos
  aplicáveis; nunca só cor). A **MP herdada agrega os pais do grupo** (pior situação,
  menor entrega, data efetiva mais recente entre os concluídos). Acima da
  lista, três **cards de resumo** (037 — mesmos chips da Fábrica 2, mas aqui
  **informativos**, sem clique/filtro, pois esta tela não tem atalho OVERDUE/EXP):
  **Eventos** com Registros = nº de linhas agrupadas, Qtd. total e Peso total do
  **conjunto filtrado inteiro** (RPC `get_child_items_totals` — migração 024,
  redefinida pela **035**) e os KPIs globais **Atrasados** e **Expedição**
  (objetos `delivery`/`expedition` da RPC `get_production_stats`, migrações 019/020 —
  contam **itens raiz**, onde a regra de atraso e a EXPEDIÇÃO valem; os filhos da
  cadeia não têm expedição própria). Abaixo dos três números de CADA card, a lista
  **Famílias** (035/037): cada família (coluna TP) com Σ de quantidade e
  peso — `GC — 120 un · 1.500 kg` — em ordem de qtd. desc, **mesma janela dos
  números daquele card** (Eventos = conjunto filtrado inteiro, itens **filhos**;
  Atrasados/Expedição = os KPIs globais); família vazia
  exibe "—" e sem nenhuma família o bloco mostra só "—".
  A página vem da RPC **`get_child_item_groups`** (migração 033): aplica os **mesmos 11
  filtros** da `get_child_items_totals` (clonados da 024), agrupa por **(OF, código do
  filho)** — descrição quando o código vem vazio —, devolve os ids dos membros e pagina
  por menor entrega → chave. Grupos **nunca atravessam OFs**; os membros de uma página
  são buscados em seguida e montados no servidor (`lib/utils/child-item-groups.ts`).
  Clicar numa célula de grupo com N membros abre a folha em modo lote: **só a situação
  é aplicada a todos os itens do grupo** (ação `updateProcessBatchAction` com escopo
  `orderItemIds` — uma situação por item, evento e cascata 62 por item, `NAO_APLICAVEL`
  intocado; quantidades, observações, entrega e histórico ficam por item na Fábrica 2 e
  no detalhe da OF). Grupo de 1 membro edita exatamente como antes.
  Filtros na URL: busca (descrição/código do filho), OF/OS e material (com
  `order_item_materials!inner` — o filtro escolhe quais LINHAS são membros e a célula
  mostra só os materiais correspondentes).
  Ordenação fixa **seq do grupo (menor dos membros, sem número por último) → menor
  entrega → chave** (determinística para a paginação);
  no rodapé, **"Por página"** (50 padrão; opções 25/50/100/200) — trocar o tamanho ou o
  filtro preserva o restante da URL e volta para a página 1. Menu visível para **todos os
  perfis** (`menu.fabrica1`), página protegida por
  `orders.view`; leitura 100% server-rendered (sem componentes client por linha).
- **Fábrica 2** (`/fabrica-2`): **réplica da gestão de OF com código próprio** —
  página em `app/(dashboard)/fabrica-2/` e cópia dos componentes em
  `components/fabrica2/` (`Fabrica2*`), de propósito: alterações futuras na gestão não
  podem vazar para cá (nem o contrário). Continua lendo pelos mesmos services/filtros/
  actions compartilhados (`parseProductionFilters`, actions de produção/pedidos/processos
  — que revalidam `/fabrica-2` junto de `/gestao-entregas`), então dados e regras de
  negócio seguem iguais; só a camada de tela é duplicada. A primeira coluna é a
  **Seq.** (036): o número da prioridade do item, editável inline (Enter/blur grava,
  Esc cancela, `orders.edit`) e ordenável pelo cabeçalho — é também o **default da
  tela** (seq sem número por último, entrega como desempate). **Desde a consolidação da
  gestão por OF (025) as duas telas divergem de propósito na granularidade da leitura**:
  gestão usa a RPC nova `get_production_rows_by_order` (uma linha por pedido) e a
  Fábrica 2 mantém `get_production_rows` (via `getProductionPage`, uma linha por item pai) — as duas RPCs
  coexistem Diferenças
  em relação ao original: **cabeçalho sem botões** (sem "Novo pedido" nem "Importar Excel")
  e acesso restrito a **ADMIN/GESTOR** (`menu.fabrica2` no item de menu, `fabrica2.view`
  no guard da página — VISUALIZADOR e OPERADOR caem em "Acesso negado" mesmo por URL).
  Os três cards trazem a lista **Famílias** (035/037) junto dos três números —
  mesma quebra da Fábrica 1, mas sobre os itens **raiz**: Eventos cobre o
  conjunto filtrado inteiro e Atrasados/Expedição os KPIs globais; os chips
  clicáveis continuam aplicando os mesmos filtros.
- **Gestão como hub**: o código da OF/OS na tabela de entregas (desktop e mobile) abre a
  tela de detalhes `/pedidos/[id]` — sub-itens, processos e materiais num só lugar; a
  criação termina lá e o menu superior não expõe "Pedidos" (a lista `/pedidos` segue como
  apoio para editar/excluir). O **cliente é obrigatório** no cadastro manual (validação
  zod no client e no servidor — `orderSchema`; já era obrigatório na importação). Pedido
  antigo salvo sem cliente exige preencher o cliente ao reabrir o formulário para edição.
  O **código é normalizado** para o padrão da importação — `<TIPO> <número>` com espaço
  (ex.: digitando `107482`, `of-1234` ou `OF1234` sai `OF 107482`/`OF 1234`; o prefixo
  digitado vence o tipo do select). É a mesma regra do `buildOrderCode` da importação,
  agora centralizada em `lib/utils/order-code.ts` (`normalizeOrderCode`) — o formulário
  mostra "Será salvo como: OF 1234" antes de salvar. Assim o código manual casa com a
  chave de dedupe da reimportação.
- **Gestão de OF = uma linha por OF** (025): a tela consolidada mostra um registro
  por pedido — colunas **Seq.** (036 — a prioridade do planejamento no nível OF: MENOR seq
  entre os itens raiz; editar aplica o número a TODOS os itens da OF, pais e filhos,
  capacidade `orders.edit`), **OF/OS** (link para `/pedidos/[id]`), **Cliente**, **Qtd. total**
  (soma das quantidades dos itens raiz), **Peso total** (soma do `total_weight_kg`) e
  **Entrega** (= data do PEDIDO, `orders.delivery_date`), seguidas de **TODAS as etapas
  do catálogo** em colunas próprias (a cadeia da Fábrica 1 — LASER…FICEP — que antes
  ficava oculta aqui, agora aparece agregada). Cada célula de processo traz a **pior
  situação** entre os itens aplicáveis (NAO_INICIADO > CONCLUIDO) + o contador
  "feito/aplicável" (ex.: 3/5); a fonte por código espelha a
  gravação: **a cadeia F1 lê os ITENS FILHOS e os demais (MP, KIT, PRÉ-MTG…EXPEDIÇÃO)
  os ITENS RAIZ**. Processo 100% não aplicável vira "—" (não editável). **Clicar numa
  célula abre a edição EM LOTE** (`ProcessBatchEditor`, capacidade
  `production.update_status`): a nova situação vale para todos os itens aplicáveis da
  OF — cada item gera seu evento no histórico e re-deriva o status do item/OF; quantidades
  e observações por item não mudam aqui (continuam na Fábrica 2 e no detalhe do pedido).
  A **Entrega** é editável inline (`updateOrderDeliveryDateAction`, capacidade
  `orders.edit`) e as janelas previstas de todos os processos são recalculadas a partir
  dela no refresh — itens com data própria (override) mantêm a deles. **Atraso por OF**:
  entrega do pedido vencida e algum item raiz ainda sem EXPEDIÇÃO concluída. Tudo vem da
  RPC nova `get_production_rows_by_order` (migração 025 — mesmos filtros, paginação e
  permissões da antiga); a Fábrica 2 continua na `get_production_rows`, por item.
- **Sequência de fabricação** (`order_items.seq`, migração 036): número inteiro ≥ 1 (check
  no banco; `null` = sem número) que define a prioridade da fabricação. As três telas de
  produção ganham a coluna **Seq.** com edição INLINE (input numérico — Enter ou sair da
  célula grava, Esc cancela; capacidade `orders.edit`, ADMIN/GESTOR) e o **seq vira o
  default de ordenação** da Fábrica 2 e da Gestão: numeração ascendente com as linhas sem
  número por último, entrega como desempate (sem número em lugar nenhum = ordem de
  sempre). Semântica por tela: **F2** = seq do próprio item; **F1** = menor seq do grupo
  (gravado em todos os membros); **Gestão** = menor seq da OF (gravado em TODOS os itens,
  pais e filhos — pode ser refinado item a item nas Fábricas). A importação não toca na
  coluna: a re-importação preserva o número e itens novos nascem sem seq. Redefinidas
  pela 036: `get_child_item_groups`, `get_production_rows` e `get_production_rows_by_order`.
- **Quebra por família em todos os cards** (migração 037): sob os três números de
  cada card de resumo (Fábrica 1, Fábrica 2 e Gestão) aparece a lista **Famílias** —
  cada família (coluna TP) com Σ de quantidade e Σ de peso, em ordem de qtd. desc
  (mesmo formato da 035; família vazia vira "—"). Duas fontes novas:
  `get_production_stats` ganhou `overdueFamilies` e `expeditionFamilies` (quebra dos
  MESMOS conjuntos dos números de atraso/expedição — KPIs globais de **item raiz**,
  lidos pelas três telas; o repositório normaliza para array e, sem a migration
  aplicada, as listas nascem vazias e os cards exibem "—") e
  `get_production_rows_by_order` ganhou `family_totals` (quebra dos itens raiz das
  OFs filtradas, na mesma janela do `qty_total` — subconsulta não correlacionada da
  035; DROP + recriação com os mesmos 18 params e grants refeitos). Chaves aditivas:
  o dashboard continua lendo só as chaves antigas, sem mudança.
- **Filtros da gestão de OF**: busca, situação, processos, colunas (contém/faixas —
  as faixas de quantidade e peso valem sobre os **totais da OF**), janelas de entrega
  (Atrasado, Hoje, Próx. 7/30 dias) e **período De → Até pela data de entrega do PEDIDO**
  (migração 014 — inclusivo nos dois limites, lados opcionais, combina em E com as
  janelas; pedido sem data fica de fora quando o período está ativo). A busca genérica
  casa o código do pedido, o cliente e a **descrição/item pai/família de qualquer item
  da OF** (a OF aparece se bater). Tudo mora na query
  string (link compartilhável, validado no client) e vira chip em "filtros ativos", com
  um filtro por chip e "Limpar filtros" para zerar tudo.
- **Resumo com três números**: os cards **OFs**, **Atrasados** e
  **Expedição** ocupam duas colunas cada e reúnem contagem, **Qtd. total**
  e **Peso total** (soma do **peso total** — qtd × peso unit.,
  coluna derivada `total_weight_kg`, migrações 023 e 024):
  - **OFs** — nº de pedidos da lista filtrada inteira, em qualquer página (janelas da
    RPC `get_production_rows_by_order`, migração 025), com a soma das quantidades e
    dos pesos das OFs;
  - **Atrasados** — entrega vencida + expedição pendente (objeto `delivery` da
    RPC `get_production_stats`, migração 019);
  - **Expedição** — itens cuja etapa EXPEDIÇÃO está **concluída** (objeto
    `expedition` da mesma RPC, migração 020).
  Cada card exibe ainda a lista **Famílias** (037) — mesma quebra das fábricas,
  sempre **sob os três números do próprio card**: no **OFs** são os itens **raiz**
  das OFs filtradas (`family_totals` da RPC `get_production_rows_by_order`, na
  mesma janela do `qty_total` do card) e em Atrasados/Expedição as listas
  `overdueFamilies`/`expeditionFamilies` da RPC de stats (conjuntos globais).
  Atenção às unidades: o card **OFs conta PEDIDOS** (a lista é por OF) e Atrasados /
  Expedição são KPIs globais que contam **ITENS** (escopo dos antigos chips de entrega,
  que saíram junto com "Em produção" e "Concluídos"); os dois são clicáveis e aplicam
  o filtro correspondente na lista. Itens sem peso ou sem quantidade entram
  como 0.
- **Histórico**: toda mutação de produção gera linha em `production_events`;
  o histórico é somente inserção (nunca é apagado).

## Gestão de usuários

- **Perfis** (4, inalterados): `ADMIN`, `GESTOR`, `OPERADOR`, `VISUALIZADOR` — o que cada
  um vê/edita está em `lib/auth/permissions.ts`; `users.manage` (criar, ativar/desativar,
  trocar perfil, gerar link) é exclusivo de `ADMIN`. **Menus por perfil** (capacidades
  `menu.*`): ADMIN vê tudo; GESTOR vê tudo **menos Configurações**; VISUALIZADOR vê
  **Gestão de OF e Fábrica 1**; OPERADOR vê **apenas a Fábrica 1** (`menu.gestao`
  fica com ADMIN/GESTOR/VISUALIZADOR — o OPERADOR não vê o menu **nem entra por URL** na
  gestão, que segue guardada por `production.view`; a atualização de status dele acontece
  pela folha do processo em `/pedidos/[id]`, alcançável pelo link da OF na Fábrica 1).
  **Fábrica 2** (`/fabrica-2`) fica com **ADMIN e GESTOR apenas** — item de menu
  (`menu.fabrica2`) e página (`fabrica2.view`) negados aos demais. Dashboard, Processos e
  Configurações negam acesso direto por URL aos demais perfis; a **Importação não é mais
  item de menu** — o acesso ao assistente `/importacao` é pelo botão "Importar Excel" do
  cabeçalho da gestão de OF (guardado por `import.access`). O menu do usuário (nome
  na barra) reúne perfil, alterar senha, configurações (só ADMIN) e sair.
- **Criação com senha temporária** (Configurações > Novo usuário): a conta nasce
  confirmada no Auth com senha temporária de 12 caracteres (sem ambíguos, gerada por
  CSPRNG), exibida **uma única vez** com botão de copiar — o ADMIN entrega fora do app.
  O `must_change_password` (migração 012) obriga a troca na primeira entrada (banner
  fixo no painel, some após a troca). Nenhum e-mail é enviado nesse fluxo (funciona sem SMTP).
- **Ativação/desativação**: só existe desativar, **nunca excluir** (o histórico referencia
  o usuário e `production_events.user_id` é `ON DELETE RESTRICT`). `active = false` derruba
  o login **e** as sessões abertas (`getSessionUser` passa a devolver `null` na hora).
- **Proteções de servidor** (serviço + gatilho da migração 012): ninguém altera o próprio
  perfil/status; o último administrador **ativo** não é rebaixado nem desativado; colunas
  `role`/`active`/`email` só mudam por ADMIN (ou papel `super`/`bypassrls`), bloqueando a
  auto-promoção via API.
- **Redefinição de senha**:
  - autoatendimento no login ("Esqueci minha senha" → e-mail do Supabase, depende do
    **SMTP configurado** em Authentication > SMTP Settings);
  - fallback sem SMTP: o ADMIN gera um **link copiável** na tabela de usuários
    (`auth.admin.generateLink`) e entrega por canal seguro; o destino é
    `/redefinir-senha` nos dois casos;
  - qualquer perfil troca a própria senha pelo menu do topo (ícone de chave).

## Segurança

- **RLS sempre ativa** — a aplicação lê e escreve dados operacionais apenas com o cliente
  anon + RLS. A `SUPABASE_SERVICE_ROLE_KEY` é usada **só** em `lib/supabase/admin.ts`
  (server-only) para o Auth admin de gestão de usuários: criar conta, listar último acesso
  e gerar link de recuperação — sempre atrás de `requireCapability("users.manage")`, e
  nunca importada por componente React.
- Toda escrita passa por **Server Actions → serviço → repositório**, com verificação de
  capacidade (`ADMIN`, `GESTOR`, `OPERADOR`, `VISUALIZADOR`) antes de tocar no banco.
- Upload com validação de extensão/MIME/tamanho (20 MB), parsing apenas no servidor,
  sem execução de macros/fórmulas.

## Limpar a base para reimportar/testar

Para zerar o movimento (reimportar planilhas do zero ou testar o fluxo completo de
pedidos manuais — quantidades, pesos etc.) existe o script manual
`supabase/clear_data.sql`:

```bash
psql "$SUPABASE_DB_URL" -f supabase/clear_data.sql
# ou: colar o conteúdo no SQL Editor do Supabase
```

- **Apaga** (irreversível): pedidos (`orders`) e, em cascata, itens filhos,
  matérias-primas, processos de produção e eventos; além do histórico de importação
  (`import_batches` → `import_errors`).
- **Preserva**: usuários (`profiles`), catálogo de processos (`processes`), RLS e RPCs.
- É **manual por design** (fora de `migrations/`, como o `seed_demo.sql`) — rode no
  banco de desenvolvimento para testar; em produção só quando for de fato zerar o
  movimento. Em ambos os casos, aponte `SUPABASE_DB_URL`/projeto para o banco alvo.
- Depois da limpeza, refaça as importações e crie pedidos novos pela UI (ou rode
  `supabase/seed_demo.sql` para o demo de volta). Testado em `tests/clear_data.test.ts`.

## Deploy (Vercel)

1. Push do repositório para o GitHub.
2. Import do projeto em [vercel.com](https://vercel.com) (framework: Next.js).
3. Variáveis de ambiente no Vercel:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Redirecionamentos de auth: em **Supabase > Authentication > URL Configuration**, informe
   a URL do site (ex.: `https://seu-app.vercel.app`).
5. Deploy — migrations são aplicadas no Supabase, não na Vercel.
