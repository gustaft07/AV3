# Relatório técnico — greencode AV3

> Texto-base para a defesa. Descreve o que foi construído, **por que** cada decisão foi tomada, os trade-offs e as limitações
> conhecidas. Reescreva com suas palavras e ajuste ao que você de fato decidiu.

## 1. Visão geral

O greencode passou de um sistema transacional (AV2) para uma plataforma analítica e integrável. A AV3 acrescenta, sem alterar o
modelo de domínio da AV1/AV2, quatro blocos que se conectam:

```
                 ┌──────────────────────────── Fastify (processo da API) ────────────────────────────┐
 Front-end ─JWT─▶│ /api/v1/internal   /api/v1/admin                                                  │
                 │                                                                                   │
 Parceiro ─X-API-Key─▶ /api/v1/public ──▶ [API Key → rate limit → escopo] ──┬─▶ lotes / rastreabilidade│
                 │                                                          └─▶ POST /relatorios ─┐   │
                 └───────────────────────────────────────────────────────────────────────────────┼───┘
                                                                                                   ▼
                      MySQL  ◀── resultados / tarefas ──  Worker (processo separado)  ◀── Redis (BullMQ)
                        ▲                                   • fila "relatorios" (retry + DLQ)       ▲
                        └── AnaliseExecucao + resultados    • fila "analises" + jobs recorrentes ───┘
                                                            • arquivos CSV/JSON em STORAGE_DIR
```

* **Camada analítica** (`src/modules/analytics`): três serviços independentes + orquestrador + avaliação de previsões.
* **API pública** (`src/routes/public.ts`, `src/modules/public-api`, `src/modules/auth/api-keys`): contexto Fastify isolado.
* **Filas** (`src/infra/filas.ts`, `src/modules/reports`): relatórios pesados em segundo plano.
* **Agendamento** (`src/jobs`): jobs recorrentes no mesmo worker.

O código novo respeita a arquitetura Controller → Service → Repository da AV2 e reaproveita suas peças: `LoteService` (a API
pública cria lotes pelo mesmo caminho, herdando contrato obrigatório, janela de 90 dias, código de barras = id e posição
sequencial), a matriz `PERMISSOES`, o `AppError`/`ErroValidacao` e a paginação padrão.

## 2. Biblioteca estatística escolhida

**Escolha: `simple-statistics`**, mais uma implementação própria da suavização exponencial de Holt.

**Por que `simple-statistics`**
* **Cobre exatamente o necessário**: média, mediana, desvio padrão, quantis (p90), regressão linear (`linearRegression`) e `rSquared`
  — são as operações citadas no enunciado e usadas nas três análises.
* **Pequena, tipada e sem dependências**: pouca superfície de ataque e de manutenção, e funciona igual em Windows e Linux (sem
  binários nativos).
* **Funções puras e determinísticas**, o que permite testar os cálculos sem banco (os testes da AV3 rodam sem MySQL e sem Redis).

**Por que não `mathjs`**: é mais robusta (matrizes, unidades, parser de expressões), mas o problema não exige: o modelo é uma
regressão de **uma variável** (idade → nota do estado físico). Trazer `mathjs` aumentaria o tamanho e a superfície de dependências
sem benefício.

**Por que Holt é próprio**: a biblioteca não traz suavização exponencial; a versão de Holt (nível + tendência) tem cerca de dez
linhas (`stats/holt.ts`) e é transparente para explicar na defesa.

**Como os modelos de vida útil funcionam**
* O estado físico é convertido em uma **nota** (`novo = 5 … sucata = 0`). A cada transição registrada em `HistoricoEstado`, e no estado
  inicial e atual de cada equipamento, gera-se uma observação **(idade em dias, nota)**.
* **OLS**: ajusta `nota = inclinação · idade + intercepto` por tipo de equipamento; guarda também o R².
* **Holt**: agrupa as observações em faixas de 30 dias, preenche lacunas por interpolação linear, suaviza e converte nível/tendência
  de volta para uma reta equivalente. Assim os dois métodos têm **o mesmo formato** (inclinação e intercepto), o que simplifica a
  persistência e a avaliação.
* **Projeção**: idade em que a reta cruza o limiar de "inservível" (padrão 0,5, entre `usado_ruim` = 1 e `sucata` = 0) menos a idade
  média atual dos equipamentos ainda em uso. Sem tendência de queda, ou com horizonte acima de 100 anos, **não há previsão** (o campo
  fica nulo em vez de inventar um número).
* **Refinamento**: o método com menor erro histórico por tipo é marcado como `recomendada` na rodada seguinte (seção 3).

**Limitações assumidas**: a nota é ordinal tratada como linear; a idade é contada desde o cadastro (`criadoEm`), não desde a fabricação;
o modelo é por tipo (marca e modelo não entram na vida útil); equipamentos que ainda não falharam são "censurados" de forma simples
(entra a observação do estado atual). Para muitos tipos com poucos dados, o sistema **recusa projetar** (`minAmostras`, padrão 10) e
registra o aviso na execução.

## 3. Modelagem das tabelas de resultados analíticos

Princípio: **cada rodada é imutável**. Nada é atualizado; cada execução cria um cabeçalho e linhas filhas. Isso entrega, de graça, o
histórico para consulta e a base para comparar previsão com realizado.

| Tabela | Papel | Decisões de modelagem |
|---|---|---|
| `AnaliseExecucao` | Cabeçalho da rodada | `tipo`, `origem` (agendada/manual/api), `status`, `versaoModelo`, `parametros` e `avisos` (JSON), `organizacaoId` **opcional** (nulo = visão global; preenchido = recorte de um parceiro), início/fim e erro |
| `ResultadoEficiencia` | Métricas de tempo | Modelo **dimensional**: `dimensao` (geral, mes, trimestre, operador, etapa) + `chave` + estatísticas (amostras, média, mediana, desvio, p90) + `gargalo`. Uma tabela cobre todos os recortes e novos recortes não exigem migration |
| `ResultadoRentabilidade` | Valor médio de recuperação | Linhas por (tipo, marca, modelo, estado) e uma linha **consolidada** por (tipo, marca, modelo) com `estadoFisico` nulo; `Decimal` para dinheiro; guarda média, desvio e total |
| `ValorReferenciaRecuperacao` | Preço de referência (entrada do cálculo) | Único por (tipo, marca, modelo, estado); `marca`/`modelo` vazios = "qualquer". A busca cai do mais específico para o mais genérico |
| `PrevisaoVidaUtil` | Previsão por tipo e método | Guarda a **reta** (inclinação, intercepto), R², limiar, amostras, vida restante, data prevista e a marca `recomendada`. Guardar os parâmetros permite reavaliar a previsão no futuro |
| `AvaliacaoPrevisao` | Previsão x realizado (1:1) | `amostrasFuturas`, `maeScore` (erro médio absoluto) e `viesScore` (previsto − real) calculados sobre as transições **posteriores** à previsão |
| `ApiKey` / `ApiKeyEscopo` | Credenciais de parceiros | Hash SHA-256 (nunca a chave), `prefixo` único, `organizacaoId`, limite por minuto, expiração, revogação, último uso, webhook; escopos em tabela de junção (consultáveis e extensíveis) |
| `TarefaRelatorio` | Tarefas assíncronas | O `id` é o `jobId` do BullMQ; guarda tipo, formato, parâmetros, status, tentativas, erro, caminho do arquivo e validade |

Também foram acrescentados `Equipamento.marca/modelo` e `Movimentacao.statusDe/statusPara` (todos opcionais, para não quebrar a AV2) e os
índices que sustentam as consultas (`[tipo, marca, modelo]`, `[statusPara, criadoEm]`, `[tipo, iniciadaEm]`...). `CHECK`s adicionais estão em
`prisma/constraints-av3.sql`.

**Trade-offs**
* Tabelas **tipadas por categoria** em vez de um JSON único: permitem SQL direto sobre os resultados (ranking de operadores,
  tendência por tipo) ao custo de uma tabela por análise.
* `AnaliseExecucao.organizacaoId` e `TarefaRelatorio.organizacaoId` são colunas simples (sem FK): o histórico sobrevive à exclusão
  definitiva da organização. O isolamento entre parceiros é aplicado na camada de serviço (toda consulta filtra pela organização da chave).
* Resultados crescem com o tempo (uma rodada por dia por análise): ver política de retenção/partição na seção 5.

## 4. Política de retry das tarefas com falha

Definida em `src/infra/filas.ts`:

| Fila | Tentativas | Espera entre tentativas | Após esgotar |
|---|---|---|---|
| `relatorios` | **5** | **backoff exponencial** a partir de 5 s: 5 s, 10 s, 20 s, 40 s | A tarefa vira `falhou` (com o erro), o job fica retido por 7 dias e uma cópia vai para a fila morta `relatorios-dlq`; o webhook `relatorio.falhou` é enviado |
| `analises` | 3 | exponencial a partir de 60 s (1 min, 2 min) | Job retido; a execução fica `falhou` com o erro |

**Justificativas**
* **Backoff exponencial** absorve falhas transitórias (banco ocupado, Redis oscilando) sem martelar o recurso que está sofrendo.
* **Erros não recuperáveis não são repetidos** (`UnrecoverableError`): tarefa inexistente ou job desconhecido.
* **Idempotência**: tarefa já concluída é reaproveitada; o orquestrador ignora execuções já `concluida` e limpa resultados parciais antes de gravar,
  então uma repetição não duplica linhas. Cada tentativa de relatório cria **sua própria** execução, de modo que as tentativas que falharam
  ficam registradas no histórico (auditoria).
* **Fila morta**: nenhuma falha desaparece em silêncio; fica disponível para inspeção e reprocessamento manual.
* **Retenção**: jobs concluídos por 24 h (máx. 1000) e falhos por 7 dias, para não crescer o Redis indefinidamente.
* **Limite de tarefas pendentes por organização** (padrão 5): um parceiro não consegue inundar a fila.
* O **webhook** é de melhor esforço (1 tentativa, 5 s) e **não** reprocessa a tarefa; o polling segue disponível. Fila própria com retry para webhooks
  está na lista de evolução.

## 5. Evolução para centenas ou milhares de parceiros

O desenho atual já separa API e worker (processos distintos) e usa Redis para o estado compartilhado, o que permite escalar horizontalmente.
Os pontos que mudam com a escala:

1. **API sem estado, atrás de um balanceador**: várias réplicas. Contadores do rate limit já estão no Redis, então o limite vale entre réplicas.
   TLS, WAF e um limite "grosso" por IP/chave no **API gateway** (NGINX/Kong/Cloud) protegem a aplicação.
2. **Workers escaláveis por fila**: aumentar réplicas e `WORKER_CONCURRENCY`; separar filas por prioridade/plano; usar o limitador do BullMQ ou
   filas por grupo/tenant para **justiça** entre parceiros (um grande não pode monopolizar o worker).
3. **Redis gerenciado e resiliente** (Sentinel/Cluster), com dimensionamento da retenção de jobs. Hoje, se o Redis cair o rate limit libera as
   requisições (*fail-open*); com contrato crítico, trocar para *fail-closed* ou usar um limite local de contingência.
4. **Banco**: réplicas de **leitura** para a API pública e para as análises; análises que hoje carregam linhas em memória passam a **agregar em SQL**
   (`GROUP BY`) ou em lotes/streaming, e a ser **incrementais** (só o delta desde a última rodada); particionar por mês `Movimentacao` e as tabelas de
   resultados, com política de retenção e arquivamento do histórico.
5. **Relatórios em armazenamento de objetos (S3/MinIO)** com **URL assinada** e expiração, em vez de disco local. Hoje API e worker precisam
   enxergar a mesma pasta (`STORAGE_DIR`; no Docker, um volume compartilhado), o que limita a distribuição entre máquinas.
6. **Cache das chaves**: a validação consulta o banco a cada requisição; com milhares de parceiros, cache no Redis (TTL curto, invalidado na revogação) e
   registro de "último uso" em lote.
7. **Cotas e planos**: limites por plano (requisições/min **e** cota diária/mensal, tarefas simultâneas, tamanho de relatório), cobrança por uso e painel de consumo.
8. **Webhooks robustos**: fila própria com retry e DLQ, assinatura com *timestamp* (anti-replay) e proteção **SSRF** (bloquear destinos em redes privadas, resolver DNS antes de enviar).
9. **Idempotência e paginação**: cabeçalho `Idempotency-Key` em `POST`s, paginação por cursor em volumes grandes.
10. **Observabilidade**: métricas (profundidade das filas, latência, taxa de erro por parceiro), logs correlacionados por `requestId`, alertas de DLQ e tracing.
11. **Versionamento e depreciação**: manter `/v1` com cabeçalhos `Deprecation`/`Sunset` ao lançar `/v2`, comunicando prazos aos parceiros.
12. **Isolamento de carga analítica**: se os cálculos pesados atrapalharem a operação transacional, mover para um banco/réplica analítica ou um *data mart* alimentado por CDC.

## 6. Segurança da API pública

* **Chave de 256 bits aleatórios** (`gc_live_<8 hex>_<64 hex>`), guardada só como SHA-256. Por ter alta entropia, não precisa de KDF lento
  (diferente de senhas). O prefixo em claro permite localizar a chave sem varrer a tabela; a comparação usa `timingSafeEqual`.
* **Menor privilégio**: escopos por chave (`rastreabilidade_read`, `lotes_read`, `lotes_write`, `relatorios_read`) conforme o contrato; a chave
  pertence a uma organização e só enxerga os dados dela (consultas sempre filtradas; o acesso a recurso de outra organização responde 404).
* **Revogação e rotação** imediatas; expiração opcional; o valor completo aparece uma única vez, na criação.
* **Rate limit por chave** com contadores compartilhados e cabeçalhos `X-RateLimit-*`/`Retry-After`.
* **Erros padronizados** sem vazar detalhes internos (o login do operador, por exemplo, não é exposto na rastreabilidade).
* **Documento de contrato**: Swagger/OpenAPI com exemplos, códigos de erro e descrição dos parâmetros; versão explícita na URL.

## 7. Outras decisões

* **Agendamento por jobs recorrentes do BullMQ** (e não `node-cron`): o cronograma fica no Redis e é registrado de forma idempotente; com várias
  instâncias do worker, cada execução acontece uma única vez. O checklist permite as duas opções.
* **Rotas separadas por prefixo**, cada contexto com o próprio Swagger: `/api/v1/public` (parceiros) evolui sem afetar `/internal` e `/admin`.
* **API e worker são processos distintos**: um relatório pesado não degrada a latência da API.
* **Dados de demonstração** (`seed-av3.ts`): 12 meses de lotes com sazonalidade e operadores de velocidades diferentes, para as análises terem o que mostrar.

## 8. Limitações conhecidas e trabalho futuro

* O código foi validado por **testes unitários** das regras e cálculos (sem banco/Redis); a execução ponta a ponta contra MySQL e Redis reais ainda precisa ser feita
  pelo desenvolvedor (roteiro na seção 12 do README).
* Parte do cálculo analítico carrega linhas em memória (adequado ao volume acadêmico; ver seção 5, item 4).
* Registros de movimentação anteriores à AV3 não têm a transição estruturada: use `prisma/backfill-av3.sql` para preencher a partir do texto.
* O webhook não reenvia após falha; o armazenamento dos relatórios é em disco local.
* A vida útil usa só o estado físico como "saúde"; incorporar falhas por causa, marca/modelo e idade de fabricação melhoraria o modelo.

## 9. Compatibilidade (Windows 10+, Ubuntu 24.04.03+ e derivadas)

* Dependências **sem módulos nativos** (além do que o Prisma já exige); Node ≥ 20.
* Caminhos de arquivo com `path.resolve`/`path.join`; caminho salvo no banco normalizado com `/`; proteção contra *path traversal* no download.
* Scripts npm sem sintaxe de shell; script de constraints em Node puro; `.gitattributes` fixando LF.
* CSV em UTF-8 com BOM e `;` (Excel pt-BR no Windows); encerramento gracioso para `SIGINT`/`SIGTERM` (no Windows, só `SIGINT` é entregue de forma confiável).
* MySQL e Redis via Docker (idêntico nos dois sistemas) ou instalados localmente (instruções na seção 12.7 do README).

## 10. Como validar

1. `npm test` — testes unitários (domínio da AV2 + AV3).
2. Seguir o README, seções 12.2 e 12.3 (migration, seed, API e worker).
3. Fluxo da seção 12.5: gerar chave, listar lotes, pedir relatório, acompanhar a tarefa, baixar o CSV.
4. `POST /api/v1/admin/analises/vida_util/executar` e depois `GET /api/v1/internal/analises/vida_util/ultima`.
