-- Importação inicial a partir da planilha de ativos/demitidos e do PDF de alocação.
-- A planilha é a fonte de matrícula/nome/datas; o PDF complementa local e inclui
-- os funcionários ativos da empresa 750, que não aparecem na planilha.
-- Execução idempotente; campos mantidos pelo usuário não são alterados.
begin;

with source_rows as (
  select *
  from jsonb_to_recordset($employee_seed$[
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "2",
    "name": "ADRIANO CARDOSO DE OLIVEIRA",
    "admission_date": "2023-04-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "7",
    "name": "JOAREZ DE OLIVEIRA",
    "admission_date": "2023-05-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "8",
    "name": "JONATA WILIAM DA SILVA PALUMBO",
    "admission_date": "2023-06-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "14",
    "name": "THALES EDUARDO ALVES AMORIM",
    "admission_date": "2023-02-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "15",
    "name": "RICARDO DA SILVA FERNANDES",
    "admission_date": "2023-07-06",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "20",
    "name": "RODRIGO DE SANTANA FORTE",
    "admission_date": "2022-10-11",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "22",
    "name": "ADRIANO BERNARDO DA SILVA",
    "admission_date": "2023-06-29",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "24",
    "name": "ERIVELTON MARTINS",
    "admission_date": "2015-10-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "25",
    "name": "DEIVID ROGER GUEDES CASTILHO",
    "admission_date": "2017-06-29",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "26",
    "name": "GABRIEL BARBOSA CALIXTO DA LUZ",
    "admission_date": "2022-08-25",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "27",
    "name": "GENILSON DA SILVA",
    "admission_date": "2020-01-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "30",
    "name": "ISRAEL ALEXANDRE DE CARVALHO NIZA",
    "admission_date": "2020-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "32",
    "name": "JHONATAN COSTA BARBOSA",
    "admission_date": "2019-01-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "37",
    "name": "JOAO MARIA BELARDO",
    "admission_date": "2020-08-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "38",
    "name": "JONATAN MAYCON LIMA RICCI DOS SANTOS",
    "admission_date": "2020-01-28",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "39",
    "name": "JOSE ALVES CALDEIRA",
    "admission_date": "2018-12-10",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "42",
    "name": "JOZENILTO CORREA",
    "admission_date": "2016-12-19",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "44",
    "name": "LAURENTINO ROSNER CARDOSO",
    "admission_date": "2017-11-06",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "46",
    "name": "LUIZ FERNANDO BATAGLIA",
    "admission_date": "2020-01-30",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "48",
    "name": "MANOEL RAMON DIAS MARINHO",
    "admission_date": "2020-09-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "50",
    "name": "VALDEIR DE SOUZA DA SILVA",
    "admission_date": "2021-02-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "54",
    "name": "RAFAEL VICENTE CLAUDINO",
    "admission_date": "2022-01-24",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "55",
    "name": "ADILSON RIBEIRO DOS SANTOS",
    "admission_date": "2021-11-22",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "56",
    "name": "MAURI TEIXEIRA  FERREIRA",
    "admission_date": "2019-09-09",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "57",
    "name": "MAURO GERONIMO DA SILVA",
    "admission_date": "2020-06-01",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "58",
    "name": "PAULO CESAR DOS SANTOS",
    "admission_date": "2017-05-19",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "60",
    "name": "PAULO HENRIQUE QUINTOPE",
    "admission_date": "2019-05-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "61",
    "name": "PEDRO HENRIQUE DA SILVA ALVES",
    "admission_date": "2019-11-04",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "62",
    "name": "PEDRO RAIMUNDO EVANGELISTA JUNIOR",
    "admission_date": "2020-08-03",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "64",
    "name": "SIDNEI BRITO DA SILVA",
    "admission_date": "2020-01-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "68",
    "name": "RODRIGO PANARARI",
    "admission_date": "2020-01-28",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "69",
    "name": "EVERALDO MARQUES",
    "admission_date": "2020-02-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "70",
    "name": "JEFFERSON LUIZ ROCHA SANTOS",
    "admission_date": "2021-05-26",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "71",
    "name": "DAVI RODRIGUES DOS SANTOS",
    "admission_date": "2021-10-11",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "72",
    "name": "JONICE APARECIDA DE LIMA",
    "admission_date": "2020-12-03",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "79",
    "name": "ALLAN JHONY DA SILVA",
    "admission_date": "2019-11-11",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "82",
    "name": "ELIVANDRO IZIDORIO",
    "admission_date": "2019-11-04",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "83",
    "name": "EDER JOSE CORTES PADILHA",
    "admission_date": "2021-11-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "86",
    "name": "JOSE CARLOS DE LIMA",
    "admission_date": "2020-08-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "89",
    "name": "MARCIO GREIGY XAVIER",
    "admission_date": "2021-09-20",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "92",
    "name": "TALES GARCIA DOS SANTOS",
    "admission_date": "2021-10-18",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "93",
    "name": "GILMAR ROSA",
    "admission_date": "2023-08-31",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "95",
    "name": "PEDRO HENRIQUE GUEDES FERREIRA",
    "admission_date": "2023-10-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "100",
    "name": "IGOR DA SILVA RAMALHO",
    "admission_date": "2021-02-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "102",
    "name": "LUIZ CARLOS ISENSEE",
    "admission_date": "2017-05-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "103",
    "name": "LUIZ FERNANDO CUNICO RAUSIS",
    "admission_date": "2022-01-27",
    "dismissal_date": null,
    "location": "GERAL/SERVIÇOS GERAIS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "105",
    "name": "MARCO AURELIO DE OLIVEIRA SILVA",
    "admission_date": "2022-02-16",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "109",
    "name": "MARCELO DE SOUZA",
    "admission_date": "2024-02-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "111",
    "name": "ALLISON DAS DORES DERNESTE",
    "admission_date": "2024-02-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "113",
    "name": "ADINELSON FERREIRA CASTRO",
    "admission_date": "2024-02-26",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "120",
    "name": "VALDEMIR BIANCHINI SALLA",
    "admission_date": "2024-03-28",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "125",
    "name": "ADRIEL TONETTE DE ALMEIDA",
    "admission_date": "2024-05-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "128",
    "name": "JAKSON LUIZ DE SOUZA PINTO",
    "admission_date": "2019-10-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "130",
    "name": "CARLOS JOSE DE SOUSA",
    "admission_date": "2021-04-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "132",
    "name": "LUCINEI DOS SANTOS CASSEMIRO",
    "admission_date": "2020-05-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "134",
    "name": "ALTAIR CESAR CARNEIRO",
    "admission_date": "2021-04-22",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "135",
    "name": "ANDRE LUIZ OLIVEIRA DA SILVA",
    "admission_date": "2017-06-26",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "140",
    "name": "ARLENE NOGUEIRA GONCALVES DOS SANTOS",
    "admission_date": "2024-06-06",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "142",
    "name": "RUAN LUCAS NUNCIO DE LARA",
    "admission_date": "2024-06-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "146",
    "name": "RANIERI ANGELIM BAIA",
    "admission_date": "2023-08-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "149",
    "name": "MANUEL ALEJANDRO FERNANDEZ BRITO",
    "admission_date": "2023-09-27",
    "dismissal_date": null,
    "location": "GERAL/MGPRESS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "153",
    "name": "THIAGO LACERDA GOMES",
    "admission_date": "2022-01-20",
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "154",
    "name": "REGIVALDO SILVA ALMEIDA",
    "admission_date": "2023-03-10",
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "156",
    "name": "LUIZ FERNANDO FERNANDES BRANDALIZE",
    "admission_date": "2024-07-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "171",
    "name": "OSNI MIRANDA",
    "admission_date": "2024-08-26",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "174",
    "name": "JUNIOR RODRIGUES",
    "admission_date": "2019-11-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "175",
    "name": "PAULO CESAR NUNES DOS ANJOS",
    "admission_date": "2020-02-20",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "189",
    "name": "CLAUDINEI PAULIKA",
    "admission_date": "2021-12-20",
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "190",
    "name": "CLAUDIR FERREIRA DOS SANTOS",
    "admission_date": "2023-02-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "192",
    "name": "JEAN SILVA DOS SANTOS",
    "admission_date": "2023-03-07",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "194",
    "name": "ROBERTO CARLOS FLORENTINO",
    "admission_date": "2024-03-01",
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "195",
    "name": "JOAO ELOIR MATEUS",
    "admission_date": "2024-07-25",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "197",
    "name": "JOSE FERREIRA DOS SANTOS",
    "admission_date": "2021-09-28",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "198",
    "name": "EVANDRO DERIO CORDEIRO",
    "admission_date": "2017-09-20",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "199",
    "name": "JOSE CARLOS LEAL",
    "admission_date": "2023-03-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "201",
    "name": "NELSON JUSTINO DOS SANTOS",
    "admission_date": "2021-05-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "208",
    "name": "JEFERSON DE LIMA",
    "admission_date": "2024-11-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "212",
    "name": "LUIS RAFAEL DIAS DE SOUZA",
    "admission_date": "2024-12-05",
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "215",
    "name": "ALEXANDRE MACHADO SOUSA",
    "admission_date": "2024-12-12",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "229",
    "name": "DOUGLAS TRAIN DOS SANTOS",
    "admission_date": "2025-02-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "237",
    "name": "DAVID HENRIQUE DO PRADO",
    "admission_date": "2025-03-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "242",
    "name": "SAMUEL DE SOUZA FRANCA",
    "admission_date": "2025-05-26",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "247",
    "name": "RONALDO CORDEIRO",
    "admission_date": "2025-06-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "248",
    "name": "LEONARDO DE SOUZA CARVALHO",
    "admission_date": "2025-07-03",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "249",
    "name": "GUILHERME DOS SANTOS DOLINSKI",
    "admission_date": "2021-07-15",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "251",
    "name": "GUILHERME PEREIRA",
    "admission_date": "2025-07-07",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "252",
    "name": "GABRIEL ALEX GUMZ",
    "admission_date": "2025-07-07",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "253",
    "name": "EZEQUIEL FERREIRA DE OLIVEIRA",
    "admission_date": "2025-07-07",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "255",
    "name": "MATEUS FERNANDES PEREIRA",
    "admission_date": "2025-07-07",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "260",
    "name": "ELIAS MACHADO",
    "admission_date": "2020-12-14",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "261",
    "name": "ALESSANDRO LUIZA",
    "admission_date": "2025-07-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "262",
    "name": "JOEL APARECIDO ZAKCHEUSKI",
    "admission_date": "2025-07-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "266",
    "name": "JANDER KEVIN SOUZA FRANCA",
    "admission_date": "2025-07-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "270",
    "name": "VALDEMIR CUNHA PEREIRA",
    "admission_date": "2025-07-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "272",
    "name": "DEIVIDY VEDOVATO DOS SANTOS",
    "admission_date": "2025-07-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "274",
    "name": "JOAO DA SILVA SANTOS",
    "admission_date": "2025-08-11",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "280",
    "name": "ANSELMO TADAESKI",
    "admission_date": "2025-09-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "284",
    "name": "CARLOS DE SOUZA",
    "admission_date": "2025-09-29",
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "286",
    "name": "ALLAN FILIPPE DE OLIVEIRA LEDOUX",
    "admission_date": "2025-10-09",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "293",
    "name": "JEFERSON FELIPE DOS SANTOS",
    "admission_date": "2025-10-16",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "298",
    "name": "JOAO MARIA FRANCA",
    "admission_date": "2025-10-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "302",
    "name": "BRUNO SALOMAO CARVALHO PACHECO",
    "admission_date": "2025-10-31",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "304",
    "name": "ANDREY MAICON DE VALERIO",
    "admission_date": "2025-10-29",
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "317",
    "name": "ELOIR PIRES",
    "admission_date": "2025-12-01",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "318",
    "name": "GABRIELA NOGUEIRA DOS SANTOS",
    "admission_date": "2025-12-11",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "321",
    "name": "DOUGLAS FERREIRA MENEZES",
    "admission_date": "2025-12-19",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "322",
    "name": "THIAGO DAMASCENO MOREIRA",
    "admission_date": "2026-01-12",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "324",
    "name": "ELCIR SALLA",
    "admission_date": "2026-01-15",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "325",
    "name": "KEVYN MARTINS MOREIRA",
    "admission_date": "2026-01-19",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "327",
    "name": "CELSO RICARDI DE ALMEIDA DOS SANTOS",
    "admission_date": "2026-01-22",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "335",
    "name": "ITAMAR FORMIGHIERI GERONIMO",
    "admission_date": "2026-02-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "336",
    "name": "GUILHERME ALVES FERREIRA",
    "admission_date": "2026-02-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "343",
    "name": "CARLOS MACIEL BORBA GONCALVES",
    "admission_date": "2026-02-10",
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "345",
    "name": "PAULO CESAR COUTINHO CORDEIRO",
    "admission_date": "2026-02-12",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "347",
    "name": "EVERTON LIMA RUHR",
    "admission_date": "2026-02-12",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "349",
    "name": "RAIRY RAEQUEL MARILDO FARIA RODRIGUES",
    "admission_date": "2026-02-12",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "352",
    "name": "IAGO GABRIEL VIEIRA PADILHA",
    "admission_date": "2026-02-19",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "357",
    "name": "RODRIGO DIAS MOREIRA",
    "admission_date": "2026-03-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "360",
    "name": "SIDNEY ROBERTO BUSATO",
    "admission_date": "2026-03-12",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "362",
    "name": "RAFAEL DONEL SANTOS",
    "admission_date": "2026-03-16",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "367",
    "name": "BRUNO LUIZ DA SILVA LOURENCO",
    "admission_date": "2026-04-09",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "369",
    "name": "WENDEL SEZINIO BORAZO",
    "admission_date": "2026-04-16",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "373",
    "name": "MAURO HENRIQUE CARNEIRO",
    "admission_date": "2026-04-30",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "376",
    "name": "RENATO DOS SANTOS COUTINHO",
    "admission_date": "2026-05-11",
    "dismissal_date": null,
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "381",
    "name": "JHONY FERREIRA CHECHAK",
    "admission_date": "2026-05-11",
    "dismissal_date": null,
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "393",
    "name": "IGOR EVANGELISTA DE SOUZA",
    "admission_date": "2026-05-14",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "396",
    "name": "EMANUEL ELOI DE OLIVEIRA",
    "admission_date": "2026-05-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "398",
    "name": "LEONARDO GABRIEL MARTINS FERREIRA",
    "admission_date": "2026-05-18",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "400",
    "name": "MARCELO OLIVEIRA MARIA",
    "admission_date": "2026-05-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "401",
    "name": "DANIEL STEFANO CARDOSO SANTOS",
    "admission_date": "2026-05-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "413",
    "name": "JOSE APARECIDO PRATES",
    "admission_date": "2026-05-28",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "414",
    "name": "PEDRO PAULO FARIAS SOUSA",
    "admission_date": "2026-06-01",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "417",
    "name": "JOSE EURICO DE PINHO",
    "admission_date": "2026-06-02",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "425",
    "name": "WENDEL CARVALHO LIRA",
    "admission_date": "2026-06-15",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "426",
    "name": "GABRIEL RODRIGUES DA FONSECA",
    "admission_date": "2026-06-25",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "427",
    "name": "MARCIA APARECIDA FERNANDES MOCO GONCALVES",
    "admission_date": "2026-06-24",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "430",
    "name": "AURICELIO SANTOS VIEIRA",
    "admission_date": "2026-06-30",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "431",
    "name": "JACKSON LUIZ VILALVA",
    "admission_date": "2026-06-30",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "434",
    "name": "RICARDO JUNIOR CASSEMIRO DA SILVA",
    "admission_date": "2026-07-06",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "436",
    "name": "ALEXSANDRO DA SILVA PRADO IZIDORIO",
    "admission_date": "2026-07-09",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "437",
    "name": "THIAGO GOMES MICHILES",
    "admission_date": "2026-07-09",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "439",
    "name": "DHIONATAN FRANCISCO DOS SANTOS PEREIRA",
    "admission_date": "2026-07-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "448",
    "name": "HITALO SOUSA FERREIRA",
    "admission_date": "2026-07-16",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "452",
    "name": "VITOR HENRIQUE DE MORAIS DA SILVA",
    "admission_date": "2026-07-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "455",
    "name": "VILSON CAMPANHARO LUCIO",
    "admission_date": "2026-07-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "457",
    "name": "LUIS FELIPE FERREIRA",
    "admission_date": "2026-07-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "458",
    "name": "JEAN MARCELO SOUZA NEVES",
    "admission_date": "2026-07-22",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "459",
    "name": "JEVERSON COUTO SILVA NETO",
    "admission_date": "2026-07-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "460",
    "name": "GESIEL DIEGO SILVA DA COSTA",
    "admission_date": "2026-07-23",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "464",
    "name": "JHORDAN LOPES DOS SANTOS",
    "admission_date": "2026-07-27",
    "dismissal_date": null,
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "467",
    "name": "GABRIEL MEYER",
    "admission_date": "2026-08-03",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "468",
    "name": "FELIX COSTA SIMOES",
    "admission_date": "2026-08-03",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "470",
    "name": "BRUNO RAFAEL DE OLIVEIRA MARIM",
    "admission_date": "2026-08-06",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "471",
    "name": "WILLIAN GONÇALVES DA COSTA",
    "admission_date": "2026-08-10",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "473",
    "name": "ELISON FERNANDES PIRES",
    "admission_date": "2026-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "474",
    "name": "RUIS HENRIQUE FERREIRA DA SILVA",
    "admission_date": "2026-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "475",
    "name": "JOSE HENRIQUE FERREIRA DOS SANTOS",
    "admission_date": "2026-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "476",
    "name": "MAURO SERGIO MATIAS FERREIRA DA SILVA",
    "admission_date": "2026-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "478",
    "name": "PAULO DANIEL DA LUZ",
    "admission_date": "2026-07-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "486",
    "name": "CHARLES ALAN LOPES DE SOUZA",
    "admission_date": "2026-08-06",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "487",
    "name": "EDEN GIOVANNI OTAVIANO DA SILVA",
    "admission_date": "2026-08-10",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "489",
    "name": "THIAGO HENRIQUE SILVA",
    "admission_date": "2026-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "490",
    "name": "WALDEMAR MEYER FILHO",
    "admission_date": "2026-08-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "492",
    "name": "MOISES RODRIGUES DA COSTA JUNIOR",
    "admission_date": "2026-08-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "493",
    "name": "GUSTAVO HENRIQUE BAPTISTA",
    "admission_date": "2026-08-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "494",
    "name": "JAMIL MIRANDA",
    "admission_date": "2026-08-17",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "495",
    "name": "REGINALDO MOREIRA DE SOUZA",
    "admission_date": "2026-08-18",
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "496",
    "name": "ITAMAR DEBATIN FERRO",
    "admission_date": "2026-08-20",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "497",
    "name": "DIEGO MARADONA RIBEIRO DE OLIVEIRA",
    "admission_date": "2026-08-24",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "498",
    "name": "MATHEUS MACÊDO DA SILVA",
    "admission_date": "2026-08-24",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "501",
    "name": "ALZAMIR RODRIGO DE OLIVEIRA",
    "admission_date": "2026-08-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "503",
    "name": "WILLIAN GRASSI TARABAY DE LIMA",
    "admission_date": "2026-08-27",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "504",
    "name": "LEDIAN JANSER BONIFACIO",
    "admission_date": "2026-08-31",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "505",
    "name": "DENER ROCHA DE SOUZA",
    "admission_date": "2026-08-31",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "506",
    "name": "ODAIR FERREIRA DA SILVA",
    "admission_date": "2026-09-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "508",
    "name": "RODEGIO RODRIGUES DE OLIVEIRA",
    "admission_date": "2026-09-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "509",
    "name": "BRUNO WILLIAN PETERS",
    "admission_date": "2026-09-14",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "510",
    "name": "CLEBER ANDREOS CAMPOS SILVA",
    "admission_date": "2026-09-14",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "511",
    "name": "PETERSON IZAC DE OLIVEIRA GALDINO DIAS",
    "admission_date": "2026-09-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "513",
    "name": "EDUARDO VALENGA SANTOS",
    "admission_date": "2026-09-21",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "514",
    "name": "JOSE LUIZ DA SILVA NUNES JUNIOR",
    "admission_date": "2026-09-24",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "515",
    "name": "ELEONILSON SAMPAIO DA CRUZ",
    "admission_date": "2026-09-24",
    "dismissal_date": null,
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "516",
    "name": "HALYFFER MATIAS BRITO",
    "admission_date": "2026-09-28",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "519",
    "name": "LUCAS JULIANO DA SILVA DE SOUZA",
    "admission_date": "2026-10-01",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "521",
    "name": "LUCAS DE SOUZA DIOLINO",
    "admission_date": "2026-10-05",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "522",
    "name": "ERIK ERNANDES DA SILVA CARVALHO",
    "admission_date": "2026-10-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "524",
    "name": "JEAN JUNIOR CARDOSO",
    "admission_date": "2026-10-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "525",
    "name": "JOCIMAR PEREIRA PRESTES",
    "admission_date": "2026-10-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "526",
    "name": "ANDERSON CLAUDIO DOS SANTOS",
    "admission_date": "2026-10-08",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "527",
    "name": "VINICIUS FERNANDES COSTA",
    "admission_date": "2026-10-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "528",
    "name": "JOAO MARCOS DA SILVA DOS SANTOS",
    "admission_date": "2026-10-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "529",
    "name": "PEDRO CARLOS PENA DE LIMA",
    "admission_date": "2026-10-13",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "530",
    "name": "WELINGTON DA SILVA JUNIOR",
    "admission_date": "2026-10-15",
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "532",
    "name": "JUAN PABLO DOS SANTOS JACINTO",
    "admission_date": "2026-10-19",
    "dismissal_date": null,
    "location": "GERAL/SRS SERVIÇOS INDUSTRIAIS"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "533",
    "name": "ADRIAN JÚNIOR GONÇALVES DOS SANTOS",
    "admission_date": "2026-10-29",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "534",
    "name": "NATAN DOS SANTOS TORRES",
    "admission_date": "2026-11-03",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "535",
    "name": "MAYCON LUIZ DA MAIA",
    "admission_date": "2026-11-10",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "536",
    "name": "DELL RUBENS MACHADO CARNEIRO",
    "admission_date": "2026-11-03",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "537",
    "name": "WILLIAM FERREIRA SCHU DE CORDOVA",
    "admission_date": "2026-11-05",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "538",
    "name": "ALEX SIEIRO ARRUDA",
    "admission_date": "2026-11-05",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "539",
    "name": "EVERTON JOHN DE OLIVEIRA",
    "admission_date": "2026-11-05",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "540",
    "name": "WERBETH DOUGLAS BEZERRA DA CONCEIÇÃO",
    "admission_date": "2026-11-10",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "541",
    "name": "RAUL DOS SANTOS CASTRO JUNIOR",
    "admission_date": "2026-11-10",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "542",
    "name": "JOSE HENRIQUE FAUSTIN ROBERTO",
    "admission_date": "2026-11-10",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "543",
    "name": "ALEXANDRE LUCAS SOARES",
    "admission_date": "2026-11-10",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "544",
    "name": "PEDRO GUILHERME LABHARDT",
    "admission_date": "2026-11-16",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "545",
    "name": "DEIVID MENDES",
    "admission_date": "2026-11-16",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "546",
    "name": "RENAN DA LUZ VIEIRA",
    "admission_date": "2026-11-16",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "547",
    "name": "LEONARDO LISBOA LOPES",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "548",
    "name": "RAYLAN MACHADO DOS SANTOS",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "549",
    "name": "RICARDO GOMES ALVES",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "550",
    "name": "GEOVANE DOS SANTOS SILVA",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "551",
    "name": "MARCUS VINICIUS FARIAS DOS SANTOS",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "552",
    "name": "RODRIGO SOUZA BRAGA",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "553",
    "name": "ANDRES EDUARDO RAMIREZ HERNANDEZ",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "554",
    "name": "RONILDO TEIXEIRA SHOTT",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "555",
    "name": "FELIPE KUSTER DA SILVA SANTOS",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "556",
    "name": "JOSE CLEISON CAMPOS",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "557",
    "name": "JOSIANO INOCENCIO DA SILVA",
    "admission_date": "2026-11-19",
    "dismissal_date": null,
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "3",
    "name": "ANDERSON JOSE DEINA",
    "admission_date": "2022-12-08",
    "dismissal_date": "2025-03-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "4",
    "name": "FABIANO DE LIMA AZEVEDO",
    "admission_date": "2023-03-30",
    "dismissal_date": "2025-02-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "5",
    "name": "GABRIEL HENRIQUE DE SOUZA SANTOS",
    "admission_date": "2023-02-13",
    "dismissal_date": "2024-08-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "6",
    "name": "JEAN MOREIRA LUBKE",
    "admission_date": "2023-02-23",
    "dismissal_date": "2025-04-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "9",
    "name": "JOSE DIOGO DOS SANTOS GONCALVES",
    "admission_date": "2023-06-01",
    "dismissal_date": "2024-03-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "10",
    "name": "LUCAS DA SILVA MACEDO",
    "admission_date": "2023-02-09",
    "dismissal_date": "2026-03-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "11",
    "name": "MATHEUS DA COSTA ALMEIDA",
    "admission_date": "2023-05-25",
    "dismissal_date": "2024-07-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "12",
    "name": "ROSILEI TERESINHA SALESBRAM",
    "admission_date": "2023-05-22",
    "dismissal_date": "2025-12-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "13",
    "name": "RUAN VINICIUS DURAU PERCIO",
    "admission_date": "2023-01-12",
    "dismissal_date": "2024-03-25",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "16",
    "name": "ADROALDO RIBAS",
    "admission_date": "2022-10-24",
    "dismissal_date": "2025-03-25",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "17",
    "name": "LUAN DA SILVA MARTINS",
    "admission_date": "2023-04-05",
    "dismissal_date": "2024-09-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "18",
    "name": "MARCELO DE LIMA PIRES",
    "admission_date": "2023-02-14",
    "dismissal_date": "2024-12-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "19",
    "name": "PAULO GUIMARAES DA SILVA",
    "admission_date": "2022-10-19",
    "dismissal_date": "2024-04-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "21",
    "name": "JOAO PEDRO PINHEIRO DA CRUZ DOS SANTOS",
    "admission_date": "2022-10-18",
    "dismissal_date": "2026-08-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "23",
    "name": "ELOAN DIAS",
    "admission_date": "2020-08-17",
    "dismissal_date": "2025-11-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "28",
    "name": "GIAN ALEXANDRE FONTANA DOS SANTOS",
    "admission_date": "2022-09-19",
    "dismissal_date": "2024-03-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "31",
    "name": "JESSE PLOVAS",
    "admission_date": "2020-09-28",
    "dismissal_date": "2025-02-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "33",
    "name": "JOAO GABRIEL LEAL DA PAZ",
    "admission_date": "2022-01-27",
    "dismissal_date": "2024-09-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "34",
    "name": "CRISTHOFER MARCEEL BARBOSA LEMES",
    "admission_date": "2019-06-05",
    "dismissal_date": "2025-12-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "35",
    "name": "EDICARLOS JESUS DE ALMEIDA",
    "admission_date": "2020-01-28",
    "dismissal_date": "2024-08-02",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "36",
    "name": "EDSON LUIZ DEINA",
    "admission_date": "2020-05-18",
    "dismissal_date": "2025-06-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "40",
    "name": "CELSO DE JESUS LIMA JUNIOR",
    "admission_date": "2020-11-09",
    "dismissal_date": "2025-04-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "41",
    "name": "CARLOS EDUARDO CAVALHEIRO",
    "admission_date": "2020-02-20",
    "dismissal_date": "2026-03-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "43",
    "name": "JUBIRATAN DE OLIVEIRA ARAUJO JUNIOR",
    "admission_date": "2021-12-09",
    "dismissal_date": "2025-08-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "45",
    "name": "LUCAS RIBEIRO DOS SANTOS",
    "admission_date": "2022-01-17",
    "dismissal_date": "2024-03-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "49",
    "name": "VINICIUS DE OLIVEIRA",
    "admission_date": "2022-02-24",
    "dismissal_date": "2026-09-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "51",
    "name": "SANCLEY CLAUSER BARBOSA DE SOUZA",
    "admission_date": "2022-01-24",
    "dismissal_date": "2025-06-02",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "52",
    "name": "ALLAN PATRICK PIRRES DOS SANTOS",
    "admission_date": "2020-09-14",
    "dismissal_date": "2025-01-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "53",
    "name": "RICARDO TEIXEIRA",
    "admission_date": "2020-06-18",
    "dismissal_date": "2026-04-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "63",
    "name": "AMAURI KURTEN",
    "admission_date": "2020-05-18",
    "dismissal_date": "2025-06-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "65",
    "name": "VALDEIR SODRE LOPES",
    "admission_date": "2020-03-12",
    "dismissal_date": "2026-04-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "66",
    "name": "VALDIR BARBOZA SALES",
    "admission_date": "2020-01-06",
    "dismissal_date": "2024-05-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "67",
    "name": "WELLINGTON PEREIRA DA SILVA",
    "admission_date": "2022-09-05",
    "dismissal_date": "2024-06-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "73",
    "name": "JOSE EMILIO SALVALAGGIO",
    "admission_date": "2021-04-27",
    "dismissal_date": "2025-02-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "74",
    "name": "LUCAS DE SOUZA DIOLINO",
    "admission_date": "2020-07-02",
    "dismissal_date": "2024-05-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "75",
    "name": "VERA LUCIA DA SILVA",
    "admission_date": "2021-08-03",
    "dismissal_date": "2025-07-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "77",
    "name": "NELSON JUSTINO DOS SANTOS",
    "admission_date": "2021-05-05",
    "dismissal_date": "2024-05-31",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "78",
    "name": "ALISSON RICARDO MONTEIRO",
    "admission_date": "2022-01-18",
    "dismissal_date": "2024-10-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "80",
    "name": "SAMUEL STRAUB FERREIRA",
    "admission_date": "2021-10-25",
    "dismissal_date": "2026-02-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "81",
    "name": "EVANDRA CRISTIANI FERNANDES",
    "admission_date": "2021-09-22",
    "dismissal_date": "2025-07-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "84",
    "name": "VINICIUS PEREIRA DIOLINO",
    "admission_date": "2023-07-31",
    "dismissal_date": "2024-06-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "85",
    "name": "DIONATAN MARCOS BEZERRA",
    "admission_date": "2021-07-12",
    "dismissal_date": "2026-03-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "87",
    "name": "MANOEL DOMINGOS DA ROCHA",
    "admission_date": "2020-01-24",
    "dismissal_date": "2024-07-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "88",
    "name": "SERGIO BARBOSA DA SILVA",
    "admission_date": "2019-09-26",
    "dismissal_date": "2024-04-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "90",
    "name": "THIAGO LUIZ DE CARVALHO",
    "admission_date": "2020-11-09",
    "dismissal_date": "2025-02-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "91",
    "name": "GABRIEL HENRIQUE DOS PASSOS SALVADOR",
    "admission_date": "2023-07-26",
    "dismissal_date": "2024-05-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "96",
    "name": "MATHEUS WINICIOS MASZALEK",
    "admission_date": "2023-10-09",
    "dismissal_date": "2024-11-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "97",
    "name": "GABRIEL KAIKI MIGUEL ROQUES",
    "admission_date": "2023-10-16",
    "dismissal_date": "2024-07-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "98",
    "name": "TAYLOR MATEUS DOS SANTOS BRASILIANO",
    "admission_date": "2024-03-04",
    "dismissal_date": "2024-09-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "99",
    "name": "FERNANDO JUNIOR DE MOURA E COSTA",
    "admission_date": "2022-03-10",
    "dismissal_date": "2025-05-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "101",
    "name": "JOSE LUIZ FERREIRA DOS SANTOS JUNIOR",
    "admission_date": "2019-06-05",
    "dismissal_date": "2026-08-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "106",
    "name": "MARIO CEZAR GALVAO OLICHESKI",
    "admission_date": "2023-09-21",
    "dismissal_date": "2025-05-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "107",
    "name": "LEONARDO CUNHA PEREIRA",
    "admission_date": "2023-10-16",
    "dismissal_date": "2026-02-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "108",
    "name": "WAGNER SANTOS ROSA",
    "admission_date": "2024-02-01",
    "dismissal_date": "2026-05-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "110",
    "name": "JONATHAN WILLIAN DA SILVA",
    "admission_date": "2024-02-05",
    "dismissal_date": "2024-05-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "112",
    "name": "ELISANGELA DIANA GONZAGA",
    "admission_date": "2024-02-19",
    "dismissal_date": "2024-05-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "114",
    "name": "PAULO CESAR NUNES DOS ANJOS",
    "admission_date": "2020-02-20",
    "dismissal_date": "2024-05-31",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "115",
    "name": "MARCIEL DA SILVA SANTANA",
    "admission_date": "2024-03-25",
    "dismissal_date": "2024-06-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "116",
    "name": "WASLEY NUNES DA SILVA",
    "admission_date": "2024-03-26",
    "dismissal_date": "2025-01-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "117",
    "name": "DYONNE ANTONIO MARCELINO DA SILVA",
    "admission_date": "2024-03-26",
    "dismissal_date": "2024-04-01",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "121",
    "name": "WILLIAN NASCIMENTO DO AMARAL",
    "admission_date": "2024-04-04",
    "dismissal_date": "2024-07-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "122",
    "name": "ALEKSANDER DO ROSARIO SOARES",
    "admission_date": "2024-04-11",
    "dismissal_date": "2024-10-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "123",
    "name": "DIEGO ANTONIO RAMIREZ FERNANDEZ",
    "admission_date": "2024-04-11",
    "dismissal_date": "2025-02-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "124",
    "name": "CLAUDIO HENRIQUE DE MATOS VIEIRA",
    "admission_date": "2024-04-11",
    "dismissal_date": "2024-12-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "126",
    "name": "GERSON FELIPE DE CARVALHO SILVA",
    "admission_date": "2020-05-05",
    "dismissal_date": "2026-08-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "127",
    "name": "GUILHERME HENRIQUE SCHUCH CORDOVA",
    "admission_date": "2021-04-08",
    "dismissal_date": "2025-04-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "129",
    "name": "DIOGO ALEX DOS SANTOS",
    "admission_date": "2017-05-02",
    "dismissal_date": "2024-10-01",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "131",
    "name": "JUNIOR RODRIGUES",
    "admission_date": "2019-11-05",
    "dismissal_date": "2024-05-31",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "133",
    "name": "ALESSANDRO LUIZA",
    "admission_date": "2019-06-26",
    "dismissal_date": "2024-09-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "136",
    "name": "VILMAR KLAINUBING",
    "admission_date": "2016-08-01",
    "dismissal_date": "2024-05-31",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "137",
    "name": "MICHEL APARECIDO PEREIRA",
    "admission_date": "2019-07-10",
    "dismissal_date": "2025-11-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "138",
    "name": "ALISON NALCO TONCZAK",
    "admission_date": "2024-03-14",
    "dismissal_date": "2026-07-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "139",
    "name": "VINICIUS NASCIMENTO FERRAZ",
    "admission_date": "2024-06-05",
    "dismissal_date": "2024-07-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "141",
    "name": "WILLIAN SOARES DE SOUZA",
    "admission_date": "2024-06-27",
    "dismissal_date": "2024-09-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "143",
    "name": "LEANDRO DE OLIVEIRA CARNEIRO",
    "admission_date": "2024-06-27",
    "dismissal_date": "2025-10-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "144",
    "name": "DARLESON MOTA CAITANO",
    "admission_date": "2024-07-01",
    "dismissal_date": "2025-05-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "145",
    "name": "CARLOS FABIANO MACHADO",
    "admission_date": "2023-06-07",
    "dismissal_date": "2026-08-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "147",
    "name": "CARLOS HENRIQUE ROQUE",
    "admission_date": "2023-07-18",
    "dismissal_date": "2024-08-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "148",
    "name": "MARCIO DE SOUZA KUCHARSKI",
    "admission_date": "2021-06-01",
    "dismissal_date": "2025-01-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "150",
    "name": "EDSON DOS SANTOS",
    "admission_date": "2022-03-18",
    "dismissal_date": "2025-02-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "151",
    "name": "JHONATAN PAUL VANDRESEN",
    "admission_date": "2022-03-25",
    "dismissal_date": "2024-08-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "152",
    "name": "WENDREL KENNY DA SILVA DE MOURA",
    "admission_date": "2022-05-06",
    "dismissal_date": "2024-08-01",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "155",
    "name": "SILVIO LUCAS DE ARAUJO SOARES",
    "admission_date": "2023-05-03",
    "dismissal_date": "2026-10-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "157",
    "name": "FABIO DE SOUZA E SILVA",
    "admission_date": "2024-07-18",
    "dismissal_date": "2026-03-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "158",
    "name": "JEFERSON GOMES DA SILVA",
    "admission_date": "2024-07-29",
    "dismissal_date": "2024-10-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "159",
    "name": "CLAUDIO FERMIN PEREZ RAMIREZ",
    "admission_date": "2024-07-30",
    "dismissal_date": "2025-01-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "160",
    "name": "ANTONIO ALVES PEREIRA NETO",
    "admission_date": "2024-08-01",
    "dismissal_date": "2024-10-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "161",
    "name": "JOAO BATISTA GOMES DE SOUZA",
    "admission_date": "2024-08-01",
    "dismissal_date": "2024-08-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "162",
    "name": "REGINALDO DE CARVALHO",
    "admission_date": "2022-05-24",
    "dismissal_date": "2026-04-02",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "163",
    "name": "GILBERTO JUNIOR SONEGO",
    "admission_date": "2024-08-06",
    "dismissal_date": "2024-09-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "164",
    "name": "THIAGO LUIZ GARRETT",
    "admission_date": "2024-08-06",
    "dismissal_date": "2024-09-19",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "165",
    "name": "GERSON HENRIQUE SANTAREN",
    "admission_date": "2024-08-08",
    "dismissal_date": "2025-07-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "166",
    "name": "RAFAEL PEREIRA DA SILVA",
    "admission_date": "2024-08-08",
    "dismissal_date": "2025-02-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "167",
    "name": "FREDDY SAMUEL RIOS FERNANDEZ",
    "admission_date": "2024-08-08",
    "dismissal_date": "2025-01-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "168",
    "name": "LUIS ALBERTO SILVA SANTOS",
    "admission_date": "2024-08-16",
    "dismissal_date": "2025-01-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "169",
    "name": "LUIZ GUSTAVO DA FONSECA",
    "admission_date": "2024-08-16",
    "dismissal_date": "2024-09-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "170",
    "name": "ELENILSON NARDES DA SILVA",
    "admission_date": "2024-08-22",
    "dismissal_date": "2025-01-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "172",
    "name": "BRUNO NILSON COSTA",
    "admission_date": "2023-04-27",
    "dismissal_date": "2025-07-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "173",
    "name": "ANTHONY JHONS CALDERA PAEZ",
    "admission_date": "2024-02-19",
    "dismissal_date": "2025-09-01",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "176",
    "name": "VILMAR KLAINUBING",
    "admission_date": "2016-08-01",
    "dismissal_date": "2025-05-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "177",
    "name": "ALISSON FERNANDO LAUFER WIESSENER",
    "admission_date": "2024-09-12",
    "dismissal_date": "2024-12-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "178",
    "name": "ALI GABRIEL GARCIA MARCANO",
    "admission_date": "2024-09-25",
    "dismissal_date": "2025-01-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "179",
    "name": "THOMAS PEDROSO GONCALVES",
    "admission_date": "2024-09-25",
    "dismissal_date": "2024-12-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "180",
    "name": "CESAR COLACO DA SILVEIRA",
    "admission_date": "2024-09-27",
    "dismissal_date": "2025-01-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "181",
    "name": "RODRIGO LINS DE OLIVEIRA",
    "admission_date": "2024-10-03",
    "dismissal_date": "2026-05-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "182",
    "name": "HERNANI TAVARES MORAIS",
    "admission_date": "2024-10-03",
    "dismissal_date": "2024-12-19",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "183",
    "name": "BRUNO RAFAEL DOS SANTOS",
    "admission_date": "2024-10-10",
    "dismissal_date": "2025-02-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "184",
    "name": "EDUARDO DAVID CAMANTA GAMES",
    "admission_date": "2024-10-14",
    "dismissal_date": "2026-03-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "185",
    "name": "CRISTIANO ANTUNES DE SOUZA",
    "admission_date": "2024-10-14",
    "dismissal_date": "2025-01-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "186",
    "name": "WELLINGTON DA SILVA NUNES",
    "admission_date": "2024-10-21",
    "dismissal_date": "2024-11-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "187",
    "name": "RAFAEL FLORES",
    "admission_date": "2024-10-24",
    "dismissal_date": "2025-04-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "188",
    "name": "LUCAS GABRIEL LUIS",
    "admission_date": "2024-10-24",
    "dismissal_date": "2025-03-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "191",
    "name": "EDSON LUIZ FERNANDES",
    "admission_date": "2022-06-28",
    "dismissal_date": "2025-01-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "193",
    "name": "EUDI DANIEL OLIVEROS GAMEZ",
    "admission_date": "2024-02-26",
    "dismissal_date": "2025-08-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "196",
    "name": "LEONARDO SKRUSINSKI DOS SANTOS",
    "admission_date": "2022-06-28",
    "dismissal_date": "2025-04-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "200",
    "name": "UILIAN ANTONIO GODOI RIBEIRO",
    "admission_date": "2018-12-19",
    "dismissal_date": "2025-01-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "202",
    "name": "KELTON LUIZ DA LUZ CARVALHO",
    "admission_date": "2024-10-31",
    "dismissal_date": "2026-08-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "203",
    "name": "ENEIAS DOS REIS MORAES",
    "admission_date": "2024-11-04",
    "dismissal_date": "2025-06-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "205",
    "name": "JIMMY JOSE VASQUEZ PINTO",
    "admission_date": "2024-11-05",
    "dismissal_date": "2025-01-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "206",
    "name": "MARCOS BRUNO BUAS DA COSTA",
    "admission_date": "2024-11-19",
    "dismissal_date": "2025-01-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "207",
    "name": "WISLEY MILLER ALVES DOS SANTOS",
    "admission_date": "2024-11-21",
    "dismissal_date": "2025-02-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "209",
    "name": "BRUNO AFFONSO DE AZEVEDO LEMES",
    "admission_date": "2024-11-25",
    "dismissal_date": "2025-02-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "210",
    "name": "RAYLSON SANTOS NASCIMENTO",
    "admission_date": "2024-11-22",
    "dismissal_date": "2025-02-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "211",
    "name": "ANDRE PAES RIBEIRO",
    "admission_date": "2024-12-05",
    "dismissal_date": "2025-04-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "213",
    "name": "RAMILANDE SANTOS DE BRITO",
    "admission_date": "2024-12-09",
    "dismissal_date": "2025-01-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "214",
    "name": "ADRIANO MORAIS GOTTARDI",
    "admission_date": "2024-12-12",
    "dismissal_date": "2025-05-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "216",
    "name": "RAYAN CARLOS DE LIMA KOTELAK",
    "admission_date": "2024-12-20",
    "dismissal_date": "2025-08-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "217",
    "name": "ALTAIR DE OLIVEIRA",
    "admission_date": "2025-01-20",
    "dismissal_date": "2025-03-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "218",
    "name": "BRUNO AUGUSTO LOPES CSIGUEL",
    "admission_date": "2025-01-20",
    "dismissal_date": "2026-04-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "219",
    "name": "VANILDO GONCALVES DOS SANTOS",
    "admission_date": "2025-01-23",
    "dismissal_date": "2025-01-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "220",
    "name": "CLEISON BRENO DOS SANTOS CHAGAS",
    "admission_date": "2025-01-30",
    "dismissal_date": "2026-03-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "221",
    "name": "JULIANO CESAR BINI DIAS",
    "admission_date": "2025-01-30",
    "dismissal_date": "2025-04-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "222",
    "name": "WILLIAN DA SILVA DONIZETH MENDES",
    "admission_date": "2025-01-30",
    "dismissal_date": "2026-03-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "223",
    "name": "CONRADO BOGUCHESKI",
    "admission_date": "2025-01-30",
    "dismissal_date": "2025-11-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "224",
    "name": "MARCIO VALENTE DE MATTOS",
    "admission_date": "2025-02-10",
    "dismissal_date": "2025-03-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "225",
    "name": "REINALDO RODRIGUES",
    "admission_date": "2025-02-10",
    "dismissal_date": "2025-05-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "226",
    "name": "JHONATAN DA SILVA MENDES",
    "admission_date": "2025-02-13",
    "dismissal_date": "2026-05-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "227",
    "name": "PAULO VICTOR MACHADO DE PAIVA ROSA",
    "admission_date": "2025-02-13",
    "dismissal_date": "2025-02-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "228",
    "name": "LUCAS MATOS DA SILVEIRA",
    "admission_date": "2025-02-13",
    "dismissal_date": "2025-05-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "230",
    "name": "MARCELO ARAUJO PATRICIO",
    "admission_date": "2025-02-17",
    "dismissal_date": "2025-03-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "231",
    "name": "RICARDO FERNANDES DE MORAES",
    "admission_date": "2025-02-17",
    "dismissal_date": "2025-05-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "232",
    "name": "MAURICIO FERREIRA",
    "admission_date": "2025-02-20",
    "dismissal_date": "2025-05-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "233",
    "name": "EVERTON NONATO ALVES",
    "admission_date": "2025-02-20",
    "dismissal_date": "2025-02-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "234",
    "name": "LUCAS EDUARDO DE OLIVEIRA",
    "admission_date": "2025-02-27",
    "dismissal_date": "2025-04-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "235",
    "name": "DAVID MUNIZ LIBERATO",
    "admission_date": "2025-03-06",
    "dismissal_date": "2025-06-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "236",
    "name": "VITOR MANOEL CORDEIRO MORAIS",
    "admission_date": "2025-03-10",
    "dismissal_date": "2025-07-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "238",
    "name": "ESDRAS VINICIUS DENIS",
    "admission_date": "2025-03-24",
    "dismissal_date": "2025-06-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "239",
    "name": "RUAN WILLIAN VAN HAANDEL PEREIRA",
    "admission_date": "2025-04-07",
    "dismissal_date": "2025-07-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "240",
    "name": "DEJALMA CAUAN DOS SANTOS BUENO",
    "admission_date": "2025-04-10",
    "dismissal_date": "2026-08-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "241",
    "name": "MATHEUS DE LIMA SILVA",
    "admission_date": "2025-04-10",
    "dismissal_date": "2026-06-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "243",
    "name": "JEAN PATRYK SOUZA FAM",
    "admission_date": "2025-05-26",
    "dismissal_date": "2025-06-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "244",
    "name": "LUCAS PADILHA SENICO",
    "admission_date": "2025-06-02",
    "dismissal_date": "2025-06-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "245",
    "name": "DIEGO LOPES DOS SANTOS",
    "admission_date": "2025-06-09",
    "dismissal_date": "2025-07-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "246",
    "name": "YAGGO ADRIANO PRADO WORMSBECKER",
    "admission_date": "2025-06-09",
    "dismissal_date": "2025-07-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "250",
    "name": "LUCAS FERRANTE DA SILVA",
    "admission_date": "2025-07-07",
    "dismissal_date": "2025-09-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "254",
    "name": "MARLON MARCOS APARECIDO RODRIGUES",
    "admission_date": "2025-07-07",
    "dismissal_date": "2026-01-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "256",
    "name": "CLEIDSON DOS SANTOS SILVA",
    "admission_date": "2025-07-07",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "257",
    "name": "DEXTER GUSTAVO AMORIM",
    "admission_date": "2025-07-14",
    "dismissal_date": "2025-10-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "258",
    "name": "FABIO HENRIQUE DONBROS RONFIN",
    "admission_date": "2025-07-14",
    "dismissal_date": "2026-01-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "259",
    "name": "LUIZ FELIPE PINHEIRO TELMA",
    "admission_date": "2025-07-14",
    "dismissal_date": "2025-07-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "264",
    "name": "ERLISON LUCAS SOUSA DA SILVA",
    "admission_date": "2025-07-17",
    "dismissal_date": "2025-10-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "265",
    "name": "FLAVIO FERREIRA DE ALMEIDA",
    "admission_date": "2025-07-17",
    "dismissal_date": "2026-07-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "267",
    "name": "ISRAEL GABARDO CHANE",
    "admission_date": "2025-07-17",
    "dismissal_date": "2026-04-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "268",
    "name": "MAYCON FLORIAN JASINSKI",
    "admission_date": "2025-07-17",
    "dismissal_date": "2025-10-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "269",
    "name": "EDSON REZENE DA ROCHA",
    "admission_date": "2025-07-17",
    "dismissal_date": "2025-08-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "271",
    "name": "ROGERIO CZARNESKI JUNIOR",
    "admission_date": "2025-07-21",
    "dismissal_date": "2025-08-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "273",
    "name": "JEAN CARLOS LEAL",
    "admission_date": "2025-08-07",
    "dismissal_date": "2025-11-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "275",
    "name": "ALESSANDRO SANTOS DA SILVA",
    "admission_date": "2025-08-11",
    "dismissal_date": "2025-09-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "276",
    "name": "EDERSON SANTOS AMARO",
    "admission_date": "2025-08-11",
    "dismissal_date": "2026-06-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "277",
    "name": "GUSTAVO PEREIRA GONCALVES",
    "admission_date": "2025-08-21",
    "dismissal_date": "2025-08-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "278",
    "name": "BRUNO MALTA DA SILVA",
    "admission_date": "2025-08-28",
    "dismissal_date": "2025-11-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "279",
    "name": "CRISTIAN COLOMBO",
    "admission_date": "2025-09-04",
    "dismissal_date": "2026-04-01",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "281",
    "name": "JOSE LUIS DOS SANTOS CHAGAS",
    "admission_date": "2025-09-25",
    "dismissal_date": "2025-11-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "282",
    "name": "PRISCILA PEREIRA DA CONCEICAO",
    "admission_date": "2025-09-24",
    "dismissal_date": "2025-09-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "283",
    "name": "FERNANDO NUNES MACEDO",
    "admission_date": "2025-09-24",
    "dismissal_date": "2026-04-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "285",
    "name": "DANIEL FERNANDES HINKEL",
    "admission_date": "2025-10-01",
    "dismissal_date": "2026-05-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "287",
    "name": "GABRIEL BUENO CAMARGO",
    "admission_date": "2025-10-09",
    "dismissal_date": "2026-01-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "288",
    "name": "DOUGLAS SANTOS SILVA",
    "admission_date": "2025-10-07",
    "dismissal_date": "2026-05-02",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "289",
    "name": "LUCAS TROJANOVSKI DAS NEVES",
    "admission_date": "2025-10-09",
    "dismissal_date": "2025-10-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "290",
    "name": "VANDO DE OLIVEIRA SOUZA PEREIRA",
    "admission_date": "2025-10-10",
    "dismissal_date": "2025-11-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "291",
    "name": "CLEDERSON CESAR MARTINS",
    "admission_date": "2025-10-13",
    "dismissal_date": "2025-11-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "292",
    "name": "LUCCAS EDUARDO OLIVEIRA SANTOS SILVA",
    "admission_date": "2025-10-13",
    "dismissal_date": "2026-04-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "294",
    "name": "GABRIEL ORNELA DOS SANTOS",
    "admission_date": "2025-10-17",
    "dismissal_date": "2025-11-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "295",
    "name": "LEONARDO JESUS DE SOUZA",
    "admission_date": "2025-10-20",
    "dismissal_date": "2026-02-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "296",
    "name": "LUCAS SOARES CARDOSO",
    "admission_date": "2025-10-20",
    "dismissal_date": "2025-12-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "297",
    "name": "RODRIGO JOSE ANTUNES",
    "admission_date": "2025-10-21",
    "dismissal_date": "2025-12-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "299",
    "name": "RICARDO FERREIRA GOMES",
    "admission_date": "2025-10-23",
    "dismissal_date": "2025-10-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "300",
    "name": "WANDRECHARLES SENA FERREIRA",
    "admission_date": "2025-10-27",
    "dismissal_date": "2025-11-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "301",
    "name": "REINALDO LOURENCO",
    "admission_date": "2025-10-27",
    "dismissal_date": "2026-10-23",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "303",
    "name": "SULIVAN DOS SANTOS",
    "admission_date": "2025-10-31",
    "dismissal_date": "2025-11-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "305",
    "name": "ALENCAR GRANELLA RODRIGUES",
    "admission_date": "2025-11-03",
    "dismissal_date": "2025-12-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "306",
    "name": "RODRIGO FERREIRA DA COSTA",
    "admission_date": "2025-11-06",
    "dismissal_date": "2026-06-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "307",
    "name": "DALMOLIN ERICK NERY RIBEIRO",
    "admission_date": "2025-11-10",
    "dismissal_date": "2025-12-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "308",
    "name": "EMANOEL MARTINS COSTA",
    "admission_date": "2025-11-10",
    "dismissal_date": "2026-02-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "309",
    "name": "JOAO VITOR GOMES",
    "admission_date": "2025-11-13",
    "dismissal_date": "2026-02-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "310",
    "name": "JHONATAN BRISIDA BRONOSKI",
    "admission_date": "2025-11-17",
    "dismissal_date": "2026-02-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "311",
    "name": "ANTONIO JOSE GUTIERREZ MEDINA",
    "admission_date": "2025-11-17",
    "dismissal_date": "2026-01-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "312",
    "name": "MARCIO APARECIDO FERREIRA DA SILVA",
    "admission_date": "2025-11-21",
    "dismissal_date": "2025-12-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "313",
    "name": "JOAO CLAITO MACEDO DE OLIVEIRA",
    "admission_date": "2025-11-21",
    "dismissal_date": "2026-03-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "314",
    "name": "WAGNER DOMINGUES DE REZENDE",
    "admission_date": "2025-11-27",
    "dismissal_date": "2026-04-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "315",
    "name": "ANTONIO LUIZ NIERI JUNIOR",
    "admission_date": "2025-11-27",
    "dismissal_date": "2025-12-02",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "316",
    "name": "REGINALDO DA SILVEIRA COLACO",
    "admission_date": "2025-11-27",
    "dismissal_date": "2026-02-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "319",
    "name": "SINVAL CARVALHO DA SILVA",
    "admission_date": "2025-12-11",
    "dismissal_date": "2026-05-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "320",
    "name": "LEANDRO LEONARDO ALVES MENDES",
    "admission_date": "2025-12-19",
    "dismissal_date": "2026-04-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "323",
    "name": "EVANDRO NYMBERG RIBEIRO",
    "admission_date": "2026-01-15",
    "dismissal_date": "2026-01-19",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "326",
    "name": "WALLACE MATEUS XAVIER",
    "admission_date": "2026-01-22",
    "dismissal_date": "2026-10-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "328",
    "name": "CHRISTOPHER RAFAEL GOMES VIEIRA",
    "admission_date": "2026-01-26",
    "dismissal_date": "2026-06-03",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "329",
    "name": "LUIZ GUILHERME DE SIQUEIRA",
    "admission_date": "2026-01-29",
    "dismissal_date": "2026-03-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "330",
    "name": "PAULO CESAR MARTINELLI",
    "admission_date": "2026-01-29",
    "dismissal_date": "2026-04-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "331",
    "name": "ANTONIO CONCEICAO RANGEL",
    "admission_date": "2026-01-28",
    "dismissal_date": "2026-03-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "332",
    "name": "ROGERIO DANILO VENZEL",
    "admission_date": "2026-02-03",
    "dismissal_date": "2026-04-02",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "333",
    "name": "EUGENIO BATISTA SILVA",
    "admission_date": "2026-02-05",
    "dismissal_date": "2026-07-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "334",
    "name": "DOUGLAS RONALDO BECKER",
    "admission_date": "2026-02-05",
    "dismissal_date": "2026-06-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "337",
    "name": "EDEVAN MOREIRA FERREIRA",
    "admission_date": "2026-02-05",
    "dismissal_date": "2026-05-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "338",
    "name": "ALESON BATISTA CARNEIRO",
    "admission_date": "2026-02-05",
    "dismissal_date": "2026-08-19",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "339",
    "name": "DANIEL SILVA DA CRUZ",
    "admission_date": "2026-02-05",
    "dismissal_date": "2026-03-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "340",
    "name": "LUIS FILIPE WILCZEK",
    "admission_date": "2026-02-09",
    "dismissal_date": "2026-02-25",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "341",
    "name": "JOSE MARCIANO GODOY FERRAZ",
    "admission_date": "2026-02-06",
    "dismissal_date": "2026-05-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "342",
    "name": "EDUARDO SANTOS DE SIQUEIRA",
    "admission_date": "2026-02-12",
    "dismissal_date": "2026-02-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "344",
    "name": "MATHEUS GABRIEL BRAGHIROLLI ROMANI",
    "admission_date": "2026-02-12",
    "dismissal_date": "2026-03-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "346",
    "name": "ROMILDO JOSE DA SILVA",
    "admission_date": "2026-02-12",
    "dismissal_date": "2026-02-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "348",
    "name": "WELLYAN BRYAN DA SILVA MARTINS",
    "admission_date": "2026-02-11",
    "dismissal_date": "2026-04-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "350",
    "name": "RONALDO ALVES DE FRANCA",
    "admission_date": "2026-02-13",
    "dismissal_date": "2026-04-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "351",
    "name": "NATHA APARECIDO DIAS CAMPOS",
    "admission_date": "2026-02-19",
    "dismissal_date": "2026-05-19",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "353",
    "name": "FELIPE DE BASTOS ARRUDA",
    "admission_date": "2026-02-23",
    "dismissal_date": "2026-05-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "354",
    "name": "CAIO FRANCISCO DA SILVA QUEIROZ",
    "admission_date": "2026-02-25",
    "dismissal_date": "2026-03-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "355",
    "name": "MAURICIO MATOS RAMOS",
    "admission_date": "2026-02-26",
    "dismissal_date": "2026-04-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "356",
    "name": "DIEGO PEREIRA DOS SANTOS",
    "admission_date": "2026-03-02",
    "dismissal_date": "2026-04-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "358",
    "name": "ITAMAR JOSE DO NASCIMENTO JUNIOR",
    "admission_date": "2026-03-02",
    "dismissal_date": "2026-05-25",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "359",
    "name": "IVAIR RIBEIRO DOS SANTOS",
    "admission_date": "2026-03-12",
    "dismissal_date": "2026-04-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "361",
    "name": "JOSE HENRIQUE PEREIRA DA COSTA",
    "admission_date": "2026-03-12",
    "dismissal_date": "2026-03-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "363",
    "name": "CRISTIANO DA SILVA DOS SANTOS",
    "admission_date": "2026-03-19",
    "dismissal_date": "2026-08-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "364",
    "name": "WELLINTON CESAR DE OLIVEIRA CORDEIRO",
    "admission_date": "2026-03-23",
    "dismissal_date": "2026-06-20",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "365",
    "name": "FERNANDO DOS SANTOS CHAGAS",
    "admission_date": "2026-03-26",
    "dismissal_date": "2026-06-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "366",
    "name": "OZIMAR LUIZ SOARES MORAES",
    "admission_date": "2026-03-30",
    "dismissal_date": "2026-08-17",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "368",
    "name": "DARLEI MATEUS PEREIRA DE LIMA",
    "admission_date": "2026-04-16",
    "dismissal_date": "2026-05-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "370",
    "name": "MARCOS COLMAN DE ARAUJO",
    "admission_date": "2026-04-16",
    "dismissal_date": "2026-05-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "371",
    "name": "RAFAEL INACIO DOS SANTOS",
    "admission_date": "2026-04-16",
    "dismissal_date": "2026-08-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "372",
    "name": "JORGE JOSE DE ARAUJO JUNIOR",
    "admission_date": "2026-04-17",
    "dismissal_date": "2026-09-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "374",
    "name": "LEANDRO APARECIDO IZIDORIO",
    "admission_date": "2026-04-30",
    "dismissal_date": "2026-07-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "375",
    "name": "ANTONIO EDSON FELICIO",
    "admission_date": "2026-05-07",
    "dismissal_date": "2026-08-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "377",
    "name": "MATHEUS FOGACA AUGUSTO",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-06-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "378",
    "name": "PEDRO MOREIRA COSTA NETO",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-05-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "379",
    "name": "ADRIANO RIBEIRO COUTINHO",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-05-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "380",
    "name": "ALBINO SKROBOT JUNIOR",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-06-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "382",
    "name": "REGINALDO PILAR DOS ANJOS",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-05-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "383",
    "name": "THOMAS EDSON ARAUJO DA SILVA",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-06-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "384",
    "name": "THIAGO ROCHINSKI",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-06-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "385",
    "name": "GILBERTO TEIXEIRA",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-05-14",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "386",
    "name": "ERIC DAVI LOURENCO DOS ANJOS",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-06-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "387",
    "name": "DANIEL ANTONIO MACHADO",
    "admission_date": "2026-05-11",
    "dismissal_date": "2026-06-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "388",
    "name": "SERGIO ROBERTO DOS SANTOS ALVES FILHO",
    "admission_date": "2026-05-14",
    "dismissal_date": "2026-06-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "389",
    "name": "ADRIANO FERREIRA",
    "admission_date": "2026-05-14",
    "dismissal_date": "2026-06-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "390",
    "name": "EVERSON MAURICIO BORBA",
    "admission_date": "2026-05-14",
    "dismissal_date": "2026-06-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "391",
    "name": "EDERSON FRANCISCO DOS SANTOS",
    "admission_date": "2026-05-14",
    "dismissal_date": "2026-05-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "392",
    "name": "MATHEUS EDUARDO RODRIGUES CONCEICAO",
    "admission_date": "2026-05-14",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "394",
    "name": "ARRIGLEIDSON CAVALCANTE DE SOUSA",
    "admission_date": "2026-05-18",
    "dismissal_date": "2026-08-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "395",
    "name": "LIOVAR BECHER SANT ANNA",
    "admission_date": "2026-05-18",
    "dismissal_date": "2026-06-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "397",
    "name": "MAIK WUILHANS NUNES DA SILVA",
    "admission_date": "2026-05-18",
    "dismissal_date": "2026-08-15",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "399",
    "name": "VANDERLEI FAILLON VEDOVATO NUNES",
    "admission_date": "2026-05-21",
    "dismissal_date": "2026-08-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "402",
    "name": "WELLINGTON PORTO DOS REIS",
    "admission_date": "2026-05-21",
    "dismissal_date": "2026-07-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "403",
    "name": "ALYSSON ROMAO DA LUZ",
    "admission_date": "2026-05-21",
    "dismissal_date": "2026-08-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "404",
    "name": "MARCOS VINICIUS OLIVEIRA GARCIA",
    "admission_date": "2026-05-21",
    "dismissal_date": "2026-08-18",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "405",
    "name": "LEONARDO CANDIDO MELO",
    "admission_date": "2026-05-21",
    "dismissal_date": "2026-10-21",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "406",
    "name": "ELIEZER MARTINS DE OLIVEIRA",
    "admission_date": "2026-05-22",
    "dismissal_date": "2026-09-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "407",
    "name": "MARCOS ROBERTO MACHADO",
    "admission_date": "2026-05-22",
    "dismissal_date": "2026-07-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "408",
    "name": "TANYLO PATRYKY PIRES DE MELO",
    "admission_date": "2026-05-25",
    "dismissal_date": "2026-10-20",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "409",
    "name": "ANDERSON DE JESUS DE PAULA",
    "admission_date": "2026-05-25",
    "dismissal_date": "2026-08-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "410",
    "name": "JEFFERSON LUIZ RIPPEL DE BASTOS",
    "admission_date": "2026-05-25",
    "dismissal_date": "2026-06-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "411",
    "name": "VINICIUS DA SILVA QUEIROZ",
    "admission_date": "2026-05-26",
    "dismissal_date": "2026-06-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "412",
    "name": "RODRIGO OLIVEIRA DE JESUS",
    "admission_date": "2026-05-26",
    "dismissal_date": "2026-06-12",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "415",
    "name": "LUIZ CLAUDIO DA SILVA",
    "admission_date": "2026-06-02",
    "dismissal_date": "2026-07-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "416",
    "name": "GABRIEL DE SOUZA GOES",
    "admission_date": "2026-06-01",
    "dismissal_date": "2026-10-01",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "418",
    "name": "PATRYCK ADRIANO DE AZEVEDO",
    "admission_date": "2026-06-02",
    "dismissal_date": "2026-07-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "419",
    "name": "LUCAS RIBEIRO ROIEKE",
    "admission_date": "2026-06-02",
    "dismissal_date": "2026-07-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "420",
    "name": "DAVI PEREIRA FIGUEIRA",
    "admission_date": "2026-06-03",
    "dismissal_date": "2026-07-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "421",
    "name": "GUSTAVO ROCHA LEMOS",
    "admission_date": "2026-06-08",
    "dismissal_date": "2026-06-19",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "422",
    "name": "DIEGO LUCIANO VIEIRA",
    "admission_date": "2026-06-08",
    "dismissal_date": "2026-09-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "423",
    "name": "THIAGO EMMANUEL DOS SANTOS",
    "admission_date": "2026-06-11",
    "dismissal_date": "2026-09-08",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "424",
    "name": "JEAN LUIZ HAUFFE",
    "admission_date": "2026-06-11",
    "dismissal_date": "2026-07-25",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "428",
    "name": "BRUNO SAMUEL RODRIGUES DA SILVA",
    "admission_date": "2026-06-25",
    "dismissal_date": "2026-07-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "429",
    "name": "RAFAEL PRUDENTE DE LIMA",
    "admission_date": "2026-06-25",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "432",
    "name": "RUAN LUCAS NUNES JOVIO",
    "admission_date": "2026-06-30",
    "dismissal_date": "2026-09-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "433",
    "name": "TIAGO BELLO DE SOUZA",
    "admission_date": "2026-07-02",
    "dismissal_date": "2026-07-30",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "435",
    "name": "LEANDRO ALVES FIGUEIREDO",
    "admission_date": "2026-07-09",
    "dismissal_date": "2026-08-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "438",
    "name": "IGOR SEBASTIAN DE JESUS",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-08-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "440",
    "name": "RODRIGO LEONCIO DOS SANTOS",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-08-06",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "441",
    "name": "MATHEUS RAFFAEL SOTO FERREIRA",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-08-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "442",
    "name": "RENAN NUNES MONTEIRO",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-07-22",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "443",
    "name": "PAULO CESAR RODRIGUES BATISTA",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-08-25",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "444",
    "name": "IGOR GABRIEL DA SILVA MACHADO",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-10-10",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "445",
    "name": "ARIEL AGUILAR GARCIA",
    "admission_date": "2026-07-13",
    "dismissal_date": "2026-08-26",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "446",
    "name": "ANDRE RODRIGO BUENO SOUZA",
    "admission_date": "2026-07-16",
    "dismissal_date": "2026-08-29",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "449",
    "name": "CAIO FELIPE DA SILVA",
    "admission_date": "2026-07-16",
    "dismissal_date": "2026-07-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "451",
    "name": "SERGIO SUBTIL DE SOUZA",
    "admission_date": "2026-07-16",
    "dismissal_date": "2026-09-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "453",
    "name": "CRISTIANO SCHAFER",
    "admission_date": "2026-07-21",
    "dismissal_date": "2026-07-23",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "454",
    "name": "ALAN VAGNER SCHRAN",
    "admission_date": "2026-07-21",
    "dismissal_date": "2026-10-09",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "456",
    "name": "CLAUDINEI FERNANDES JUNIOR",
    "admission_date": "2026-07-21",
    "dismissal_date": "2026-10-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "461",
    "name": "VAGNER MORAES REMOWICZ",
    "admission_date": "2026-07-23",
    "dismissal_date": "2026-08-31",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "462",
    "name": "WELLINGTON LUIZ PONTES",
    "admission_date": "2026-07-23",
    "dismissal_date": "2026-09-05",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "463",
    "name": "AMARILDO CORREA PORTO",
    "admission_date": "2026-07-22",
    "dismissal_date": "2026-09-04",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "465",
    "name": "WENDY VALENTIN FRANCESCHETTO",
    "admission_date": "2026-07-27",
    "dismissal_date": "2026-08-13",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "466",
    "name": "JHONATA SOUSA DA SILVA",
    "admission_date": "2026-07-27",
    "dismissal_date": "2026-07-31",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "469",
    "name": "ERIK VINICIUS DE CAMARGO",
    "admission_date": "2026-08-03",
    "dismissal_date": "2026-09-16",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "472",
    "name": "EDUARDO LUIZ SILVA",
    "admission_date": "2026-08-10",
    "dismissal_date": "2026-08-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "477",
    "name": "FELIPE DE OLIVEIRA CHANDELIER",
    "admission_date": "2026-08-13",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "479",
    "name": "TIAGO VINICIUS NUNES",
    "admission_date": "2026-07-27",
    "dismissal_date": "2026-10-24",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "480",
    "name": "GABRIEL FELIPE PEREIRA DE SOUZA",
    "admission_date": "2026-07-27",
    "dismissal_date": "2026-07-27",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "482",
    "name": "CARLOS EDUARDO CAVALHEIRO",
    "admission_date": "2026-07-28",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "483",
    "name": "FELIPE SADRAK LIMA RUHR",
    "admission_date": "2026-07-30",
    "dismissal_date": "2026-09-11",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "484",
    "name": "LUIS CLAUDIO BEZERRA RODRIGUES FILHO",
    "admission_date": "2026-07-30",
    "dismissal_date": "2026-11-16",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "488",
    "name": "ASLEI SANTOS DE JESUS",
    "admission_date": "2026-08-10",
    "dismissal_date": "2026-11-07",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "491",
    "name": "JOSE ALOISIO GORDYA",
    "admission_date": "2026-08-13",
    "dismissal_date": "2026-09-21",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "499",
    "name": "ALAN DAHLKE",
    "admission_date": "2026-08-24",
    "dismissal_date": "2026-08-24",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "500",
    "name": "JHONNY LOPES DOS SANTOS",
    "admission_date": "2026-08-24",
    "dismissal_date": "2026-08-28",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "502",
    "name": "GUSTAVO BORGES",
    "admission_date": "2026-08-27",
    "dismissal_date": "2026-10-07",
    "location": null
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "507",
    "name": "ANDRE LUIZ EVANGELISTA DE SOUZA",
    "admission_date": "2026-09-08",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "512",
    "name": "DIOGO BRUNO MENDES",
    "admission_date": "2026-09-21",
    "dismissal_date": "2026-11-04",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "517",
    "name": "BRUNO OLIVEIRA DO CARMO",
    "admission_date": "2026-09-24",
    "dismissal_date": "2026-11-07",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "518",
    "name": "ROBERTO DOS SANTOS BISPO",
    "admission_date": "2026-09-29",
    "dismissal_date": "2026-10-23",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "520",
    "name": "FLAVIO DA SILVA SOUSA",
    "admission_date": "2026-10-01",
    "dismissal_date": "2026-10-22",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "523",
    "name": "GASPAR BALDUINO DA SILVA FILHO",
    "admission_date": "2026-10-06",
    "dismissal_date": "2026-11-10",
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "752",
    "company_name": "SRS DESENVOLVIMENTO LTDA",
    "registration": "531",
    "name": "ADRIANO DE AZEVEDO",
    "admission_date": "2026-10-19",
    "dismissal_date": "2026-10-21",
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1129",
    "name": "ABADIAS SODRE DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1217",
    "name": "ADILSON BRANDAO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1161",
    "name": "ALEXSANDER CAETANO CARDOSO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1153",
    "name": "ALLAN D MARLON SOUZA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1162",
    "name": "ALTAMIR OLIVEIRA PAIXAO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1218",
    "name": "ANDRE COSTA HENRIQUE",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1132",
    "name": "ANDRE HENRIQUE DE MELO DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1204",
    "name": "ANDRE VINICIUS ATANAZIO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1037",
    "name": "ANDREWS CESAR DA ROSA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/INESCAP"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "265",
    "name": "ARILDO SANTOS DA SILVA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1178",
    "name": "ARNALDO DE LIMA PEREIRA JUNIOR",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1075",
    "name": "BENILSON LAGOIA LIMA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1216",
    "name": "BRAIAN WOLFF ALENCAR",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1100",
    "name": "BRUNO ALVES CALDEIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1195",
    "name": "CARLOS VIDAL VAZ",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1199",
    "name": "CAROLINE DO NASCIMENTO SANA FARIA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/SRS SERVIÇOS INDUSTRIAIS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1194",
    "name": "CAROLINE MIRANDA PADILHA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/RESTAURANTE COLÔNIA"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1176",
    "name": "DANIEL DOS SANTOS BUENO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/SERVIÇOS GERAIS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1214",
    "name": "DANIEL HONORIO FERREIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1059",
    "name": "DAVID MUNIZ LIBERATO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1215",
    "name": "DIEGO DE ASSIS GARCIA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1197",
    "name": "DIEGO MONTANARIN CINQUE",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MGPRESS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1230",
    "name": "EDUARDO GUSTAVO DE LIMA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "817",
    "name": "ELIEZE DE PAULA PINTO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/ADMINISTRATIVO"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1202",
    "name": "ELIZANGELA ROSA DE OLIVEIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/RESTAURANTE COLÔNIA"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1192",
    "name": "ERALDO JOSE CLAUDINO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1175",
    "name": "FABIO DA SILVA TELES",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1229",
    "name": "FILIPE ALMEIDA DE FREITAS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "201",
    "name": "FRANCIELE CAROLINE DE OLIVEIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/ADMINISTRATIVO"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1165",
    "name": "FRANCINEI VALENCA DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "205",
    "name": "GERSON LUIS RAKSA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/A1 ENGENHARIA"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1219",
    "name": "GREVANY JOSE RAMIREZ AGUILERA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/INESCAP"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1193",
    "name": "GUILHERME AUGUSTO ANASTÁCIO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/IMES"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1221",
    "name": "IGOR NUNES PERES",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1188",
    "name": "IVANILSON PAIVA DE SOUZA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1169",
    "name": "JACSON CRUZ BATISTA DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "845",
    "name": "JAIR DOS SANTOS BUENO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/SERVIÇOS GERAIS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1220",
    "name": "JANIERY DA SILVA GONCALVES",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1209",
    "name": "JEAN CARLOS BATISTA DE ANDRADE",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1212",
    "name": "JEDIELSON ALVES CABRAL",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1181",
    "name": "JEFFERSON SILVA BENICIO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1223",
    "name": "JELDSON ALVES DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1222",
    "name": "JOAO VITOR FERREIRA MENINO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1227",
    "name": "JODEMAR PEREIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1201",
    "name": "JOHN KLEITON BARBOSA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MGPRESS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1072",
    "name": "JOSE GEPERT",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1045",
    "name": "JOSE RENATO SOARES MACHADO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1174",
    "name": "JOSE ROBERTO TEIXEIRA DA SILVA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1070",
    "name": "JOSE SILVIO GONCALVES DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1200",
    "name": "JOSIEL PEREIRA DE OLIVEIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1198",
    "name": "JULIO GABRIEL DIAS DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/SRS SERVIÇOS INDUSTRIAIS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1063",
    "name": "KAIO SILVA LIMA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1142",
    "name": "KAIQUE JOSE PEREIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1080",
    "name": "KELVIN AUGUSTO DE MELO NASCIMENTO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/HERBARIUM"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1018",
    "name": "LEANDRO SANTOS COELHO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MGPRESS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1187",
    "name": "LUCAS ANDRE MACHADO PARIZE",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "898",
    "name": "LUIS CARLOS BATISTA LAMARGO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/HERBARIUM"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1164",
    "name": "LUIS CARLOS DA SILVA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "775",
    "name": "LUIS GUILHERME WROBLESKI MARQUES",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "285",
    "name": "LUIZ FELIPE PIRES",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1166",
    "name": "LUIZ FERNANDO GONCALVES DE SOUZA JUNIOR",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1179",
    "name": "MACIEL DA SILVA BRASIL",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1125",
    "name": "MARCIO ALEXANDRE MOTA DE OLIVEIRA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1211",
    "name": "MARCIO ANTONIO DE LIMA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1207",
    "name": "MARCOS VIANA CRUZ",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1213",
    "name": "MARIA DE FATIMA DE OLIVEIRA SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/RESTAURANTE COLÔNIA"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1203",
    "name": "MARINA GONÇALVES DE NOVAES AGUILAR",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/RESTAURANTE COLÔNIA"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1191",
    "name": "MATHEUS BRIDI",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1135",
    "name": "MAURO DE MARIA CARNEIRO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1163",
    "name": "OSIRES VIEIRA DA ROSA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/PERFIMEC"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1071",
    "name": "PEDRO DOS SANTOS FERREIRA FILHO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1210",
    "name": "PEDRO PADILHA DE SOUZA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1081",
    "name": "RENAN ROCHA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/HERBARIUM"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1134",
    "name": "RICARDO CARNEIRO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/BRAFER"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1094",
    "name": "ROBERTO CARLOS OLIVEIRA DA SILVA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/HERBARIUM"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1228",
    "name": "ROBINSON RIPPEL DE BASTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "216",
    "name": "RODRIGO DE JESUS CARNEIRO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/INESCAP"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1012",
    "name": "ROGERIO SILVA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/SIMOLDES"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1001",
    "name": "RONALD JOSE GONZALEZ LUGO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/BLAUBERG"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1149",
    "name": "ROSELI KNOPIK",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1226",
    "name": "SERGIO JOSE CARDOZO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "913",
    "name": "SIMON ESTEVAO RAMOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MANUTENÇÃO SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1155",
    "name": "THIAGO HENRIQUE SANTANA DA SILVA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/FABRICA SRS"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "212",
    "name": "VALDEIR OLIVEIRA DE SOUSA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/DUGALE"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1167",
    "name": "VALDINEI DOS SANTOS",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1190",
    "name": "VERCI GONCALVES BURE",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1196",
    "name": "VINICIUS FERREIRA DE SOUZA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/IMES"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1103",
    "name": "WALLACE OLIVEIRA DO ROSARIO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1171",
    "name": "WILLIAN MORAES DE SANTANA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/MAXI TRUST"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1117",
    "name": "WILLIAN ROSA DE ARRUDA",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/CASSOL"
  },
  {
    "company_code": "750",
    "company_name": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
    "registration": "1082",
    "name": "WILSON ROCHA DE CAMARGO",
    "admission_date": null,
    "dismissal_date": null,
    "location": "GERAL/HERBARIUM"
  }
]$employee_seed$::jsonb) as item(
    company_code text,
    company_name text,
    registration text,
    name text,
    admission_date date,
    dismissal_date date,
    location text
  )
)
insert into public.employees (
  company_code, company_name, registration, name,
  admission_date, dismissal_date, location
)
select
  company_code, company_name, registration, name,
  admission_date, dismissal_date, location
from source_rows
on conflict (company_code, registration) do update set
  company_name = excluded.company_name,
  name = excluded.name,
  admission_date = excluded.admission_date,
  dismissal_date = excluded.dismissal_date,
  location = coalesce(excluded.location, employees.location),
  updated_at = now();

commit;
