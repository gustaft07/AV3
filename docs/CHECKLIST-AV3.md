# Conferência do checklist — AV3 GREENCode

**Legenda de evidência**
* **Teste** — coberto por teste unitário (`npm test`, sem banco e sem Redis).
* **Código** — implementado e revisado; precisa ser exercitado com MySQL/Redis reais (roteiro na seção 12 do README).
* **Doc** — documentado.

## 1. Camada analítica (BI e estatísticas)
| Item | Atendido | Onde | Evidência |
|---|---|---|---|
| Módulo de análises separado do restante | [x] | `src/modules/analytics/` | Código |
| Node.js, TypeScript e Prisma ORM | [x] | todo o módulo (acesso a dados via Prisma) | Código |
| Cálculos com biblioteca (simple-statistics ou mathjs) | [x] | `stats/estatistica.ts` (simple-statistics); Holt próprio em `stats/holt.ts` | Teste |
| Análises em serviços independentes | [x] | `services/eficiencia`, `rentabilidade`, `vida-util` + `analytics.orchestrator.ts` | Código/Teste |
| Executar por endpoints da API | [x] | `POST /api/v1/admin/analises/:tipo/executar` e consultas em `/api/v1/internal/analises/...` | Código |
| Executar automaticamente em segundo plano | [x] | `src/jobs/schedule.ts` + `src/worker.ts` | Código |
| **Eficiência:** tempo médio do lote da entrada até a conclusão da triagem | [x] | `calcularEficiencia` (dimensões `geral`, `mes`, `trimestre`) | Teste |
| Gargalos e comparação entre operadores e períodos do ano | [x] | dimensões `etapa` (gargalo), `operador`, `mes`, `trimestre` | Teste |
| **Rentabilidade** por tipo (estado físico, marca, modelo) | [x] | `agregarRentabilidade` + `ValorReferenciaRecuperacao` | Teste |
| **Vida útil remanescente** (quando atinge o estado inservível) | [x] | `observacoesDoEquipamento`, `projetar`, `VidaUtilService` | Teste |
| Regressão simples ou suavização exponencial | [x] | OLS (`regressaoOLS`) e Holt (`suavizacaoHolt`) | Teste |
| Resultados em novas tabelas | [x] | `AnaliseExecucao`, `Resultado*`, `PrevisaoVidaUtil`, `AvaliacaoPrevisao` | Código |
| Relatórios anteriores disponíveis (histórico) | [x] | execuções imutáveis; `GET /api/v1/internal/analises/execucoes[/:id]` | Código |
| Comparar previsões com resultados futuros e refinar | [x] | `AvaliacaoService` (MAE/viés) + campo `recomendada` | Código |

## 2. API pública documentada
| Item | Atendido | Onde | Evidência |
|---|---|---|---|
| Endpoints públicos para parceiros | [x] | `src/modules/public-api`, `src/modules/reports/report.routes.ts` | Código |
| Públicos separados de internos/admin | [x] | `/api/v1/public` · `/api/v1/internal` · `/api/v1/admin` (`src/routes`) | Código |
| Autenticação por API Key | [x] | `plugins/api-key-auth.ts` (cabeçalho `X-API-Key`) | Código/Teste (chaves) |
| Módulo de chaves no serviço de autenticação | [x] | `src/modules/auth/api-keys/` | Código |
| Chave única por parceiro | [x] | 256 bits aleatórios; `prefixo` e `hashChave` únicos; chave vinculada a uma organização | Teste |
| Permissões específicas por chave | [x] | `ApiKeyEscopo` + `exigirEscopo(...)` | Código |
| Somente leitura de rastreabilidade **ou** leitura e escrita de lotes | [x] | escopos `rastreabilidade_read`, `lotes_read`, `lotes_write` | Código |
| Limites de requisições por cliente | [x] | `@fastify/rate-limit`, chave = id da API Key, limite próprio por chave, contadores no Redis | Código |
| Swagger/OpenAPI interativo | [x] | `/api/v1/public/docs` (público) e `/docs` (interno) | Código |
| Exemplos de requisição/resposta, códigos de erro e parâmetros | [x] | schemas em `public-api.routes.ts`, `report.routes.ts`, `shared/public-schemas.ts` | Código/Doc |
| Versão explícita na URL ou cabeçalho | [x] | `/api/v1/...` | Doc |

## 3. Processamento assíncrono e filas
| Item | Atendido | Onde | Evidência |
|---|---|---|---|
| Sistema de filas para tarefas demoradas | [x] | `src/infra/filas.ts` (BullMQ + Redis) | Código |
| Publicar tarefa ao receber a solicitação | [x] | `ReportService.solicitar` | Código |
| Retornar imediatamente um identificador único | [x] | `202` + `tarefaId` (UUID, = jobId) | Código |
| Processar em segundo plano | [x] | `src/worker.ts` + `report.processor.ts` | Código |
| Endpoint de status | [x] | `GET /api/v1/public/tarefas/:id` | Código |
| Obter o relatório ao terminar | [x] | `GET /api/v1/public/tarefas/:id/resultado` | Código |
| Relatório em CSV ou JSON | [x] | `formato: csv \| json` | Código |
| Acompanhamento por polling ou webhook | [x] | polling (status) **e** webhook assinado com HMAC | Teste (webhook) |

## 4. Agendamento das análises
| Item | Atendido | Onde | Evidência |
|---|---|---|---|
| Tarefas agendadas em segundo plano | [x] | `src/jobs/schedule.ts` (02:00, 02:15, 02:30, 03:00, 04:00) | Código |
| node-cron **ou** jobs recorrentes em worker | [x] | jobs recorrentes (`upsertJobScheduler`) no worker | Código/Doc |

## 5. Relatório técnico
| Item | Atendido | Onde |
|---|---|---|
| Por que a biblioteca estatística | [x] | `docs/RELATORIO-TECNICO-AV3.md`, seção 2 |
| Modelagem das tabelas analíticas | [x] | seção 3 |
| Política de retry | [x] | seção 4 |
| Evolução para centenas/milhares de parceiros | [x] | seção 5 |

## 6. Compatibilidade
| Item | Atendido | Como | Evidência |
|---|---|---|---|
| Windows 10 ou superior | [x] (por construção) | `path`, scripts sem shell, CSV com BOM, `.gitattributes`, Redis por Docker/WSL2/Memurai | Doc — **não executado em Windows aqui** |
| Ubuntu 24.04.03 ou superior | [x] (por construção) | idem; `apt install redis-server` ou Docker | Doc — **não executado em Ubuntu aqui** |
| Derivadas do Ubuntu | [x] (por construção) | mesmas dependências (nenhum módulo nativo adicional) | Doc |

## 7. Entregáveis
| Item | Atendido | Onde |
|---|---|---|
| Código-fonte completo com a camada analítica | [x] | este repositório |
| API pública documentada | [x] | Swagger em `/api/v1/public/docs` + README seção 12 + `docs/API.md` |
| Relatório técnico | [x] | `docs/RELATORIO-TECNICO-AV3.md` |

## Pontos de atenção (honestidade sobre a verificação)
1. **Executado:** testes unitários (regras da AV2 + cálculos e segurança da AV3), incluindo o webhook contra um servidor HTTP local.
2. **Não executado aqui:** compilação com as dependências reais (`npm install` não foi possível no ambiente de desenvolvimento deste material),
   migration em MySQL, BullMQ/Redis e as rotas HTTP. Rode `npm run build` e o roteiro da seção 12 do README; se algo divergir, ajuste.
3. **Mudança de contrato da AV2:** as rotas da AV2 agora têm prefixo (`/api/v1/internal`, `/api/v1/admin`).
4. **Dados antigos:** a análise de eficiência só enxerga movimentações com `statusDe/statusPara` (use o backfill ou o seed da AV3).
