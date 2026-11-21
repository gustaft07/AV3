# Decisões arquiteturais

> Texto-base para a defesa. Reescreva com suas palavras e ajuste ao que você de fato decidiu.

## 1. Monólito em camadas, com o domínio da AV1 no centro
Um único servidor HTTP por módulos. **Controller** traduz HTTP; **Service** orquestra regras e transações usando as entidades e validações da AV1; **Repository** é o único ponto que fala com o Prisma e converte entre linhas e entidades de domínio. A regra não depende do transporte. *Trade-off:* escala como unidade única. *Rejeitado:* microsserviços (custo sem necessidade atual).

## 2. Reaproveitar a AV1
Preserva o comportamento já validado. Mudanças no código original foram mínimas (`docs/AV1-para-AV2.md`).

## 3. Fastify, Prisma e MySQL
Fastify: desempenho e validação por JSON Schema (que também gera o Swagger). Prisma: schema declarativo, cliente tipado, migrations e `$transaction`. MySQL 8 (InnoDB, ACID); `CHECK` fica em `prisma/constraints.sql` (exige 8.0.16+). A comparação de texto do MySQL ignora maiúsculas/minúsculas, o que vale também para chaves únicas (login, códigos).

## 4. Política de exclusão (regra do professor)
- **Soft delete** (`ativo`) em usuário, organização e lote, com **cadeia**: inativar a organização inativa seus lotes na mesma transação.
- **Equipamento herda a inatividade do lote**, sem coluna própria. Alternativas descartadas: (a) `ativo` em equipamento: duplica estado e exigiria `updateMany` em milhares de linhas a cada inativação; (b) apagar equipamentos ao inativar: destruiria a trilha de auditoria. O professor disse que equipamento não faz sentido ter soft delete, e a herança respeita isso.
- **Delete físico** direto para equipamento e contrato. Para as entidades com soft delete, o "delete padrão" fica em `/definitivo`, restrito a admin, em cascata no banco (`onDelete: Cascade`), porque é destrutivo e irreversível.
- Consultas padrão só mostram ativos (`?situacao=` amplia). Registro inativo não aceita alterações.

## 5. Status do lote derivado
O lote não tem rota de mudança de status. Após cada troca de status, cadastro ou exclusão de equipamento, o serviço verifica se **todos** os equipamentos têm o mesmo status e só então atualiza o lote. Para evitar corrida entre requisições concorrentes (duas trocas que, somadas, deixariam todos iguais), a operação trava a linha do lote (`SELECT ... FOR UPDATE`) e roda em **READ COMMITTED**, de modo que a segunda transação enxerga a primeira já confirmada. A mesma trava serializa a atribuição de `posicao`.

## 6. Código de barras = id; posição automática
O código é o `id` (UUID gerado no domínio, conhecido antes do INSERT). A coluna `codigoBarrasInterno` é mantida porque o enunciado pede unicidade nela, e um `CHECK (codigoBarrasInterno = id)` garante a igualdade. *Trade-off:* redundância controlada. A `posicao` é sequencial por lote, única por lote e **não reaproveitada** após exclusões (estabilidade de etiquetas).

## 7. Contrato obrigatório para lotes
"Contrato ativo" = contrato existente: como contrato só tem exclusão física, não existe contrato inativo. A organização sem contrato continua ativa, mas `POST /lotes` é recusado (422).

## 8. Controle de acesso
Matriz única em `src/shared/permissoes.ts`, aplicada por hook em cada rota, inclusive nas listagens. Admin está em todos os grupos (acesso a todas as rotas) mas é o único a gerir usuários. Operadores não acessam recursos administrativos.

## 9. Autenticação JWT com o hash da AV1
Token stateless de 1h com `sub`, `login` e `papel`. A senha usa `verificarSenha` (sal + SHA-256 iterado 100 mil vezes). *Ponto de atenção:* é síncrona (~200 ms por login) e não é um KDF dedicado; evolução: `scrypt` assíncrono. A cada requisição o hook `authenticate` consulta o usuário (1 busca por chave primária): conta inativada ou excluída perde o acesso imediatamente, e mudanças de papel valem na hora.

## 10. Transações e concorrência
`$transaction` em criação de lote com equipamentos, cadastro de equipamentos, alteração de estado físico e de status, e remoção de equipamento. **Lock otimista** (`versao`) nas atualizações: zero linhas afetadas → 409.

## 11. Integridade no banco
`UNIQUE` (códigos, CNPJ, login, número do contrato, `loteId+posicao`), FKs com cascade, `CHECK` (CNPJ com 14 dígitos, login, prazo, histórico de estado, código de barras = id, posição ≥ 1).

## 12. Docker e multiplataforma
Docker é opcional (só sobe o MySQL). Sem dependências nativas (`crypto` do Node, `tsx`), tratamento de `SIGINT`/`SIGTERM` e scripts que funcionam em Windows e Linux.

## 13. Evolução
Hash assíncrono, cache curto da consulta de usuário, refresh token, rate limiting, testes de integração com banco efêmero.

---

# AV3 — decisões arquiteturais adicionais

> Detalhamento e justificativas completas em `docs/RELATORIO-TECNICO-AV3.md`.

## 14. Análises como serviços independentes, coordenados por um orquestrador
Cada análise (eficiência, rentabilidade, vida útil) é uma classe sem conhecimento de HTTP ou filas, com **cálculo puro** separado do acesso ao banco (testável sem MySQL). Um orquestrador cuida do ciclo iniciar → calcular → persistir → concluir/falhar e é chamado pela API, pelos jobs agendados e pelo worker de relatórios. *Trade-off:* uma camada a mais; ganho: reuso e testes.

## 15. `simple-statistics` + Holt próprio
Biblioteca leve, tipada, sem dependências e com o que o enunciado cita (média, mediana, desvio, regressão linear, R²). O `mathjs` seria um custo desnecessário (álgebra, unidades, parser). A suavização exponencial de Holt não existe na biblioteca e tem ~10 linhas, então é implementação própria.

## 16. Histórico imutável por execução
Resultados nunca são atualizados: cada rodada cria um cabeçalho (`AnaliseExecucao`) e linhas filhas. Isso dá consulta histórica e permite a comparação **previsão x realizado** (`AvaliacaoPrevisao`), que alimenta a escolha do método recomendado por tipo.

## 17. Movimentação com transição estruturada
A AV2 guardava `"de → para"` em texto livre. Foram acrescentadas `statusDe`/`statusPara` (opcionais) para que o tempo de permanência e a triagem possam ser calculados com precisão. Registros antigos podem ser preenchidos por `prisma/backfill-av3.sql`.

## 18. API pública isolada em um contexto próprio
`/api/v1/public` tem autenticação (API Key), rate limit, tratamento de erro e Swagger **encapsulados** (plugins do Fastify): nada vaza para as rotas internas, e a versão pública evolui independentemente. As rotas da AV2 foram movidas para `/internal` e `/admin`.

## 19. Chaves de API: aleatórias, com hash e escopos
256 bits aleatórios, guardadas apenas como SHA-256 (não precisa de KDF lento por ter alta entropia), prefixo em claro para localização, comparação em tempo constante, escopos por chave, revogação imediata e rotação. A chave vale para **uma organização**: o parceiro só enxerga os próprios dados.

## 20. Processamento assíncrono com BullMQ
Relatórios pesados vão para a fila; a API devolve `202` + `tarefaId`. A tabela `TarefaRelatorio` é a fonte da verdade (o job leva só o id). Retry com backoff exponencial, fila morta e webhook assinado. Agendamento por **jobs recorrentes do mesmo worker** (e não `node-cron`): o agendamento fica no Redis, então várias instâncias do worker não duplicam execuções.

## 21. Rate limit por chave, contadores no Redis
Janela de 1 minuto por chave (não por IP), contadores compartilhados entre instâncias da API. Se o Redis cair, a requisição passa (*fail-open*): decisão de disponibilidade que deve ser revista conforme o contrato.

## 22. Evolução
Agregações em SQL (hoje parte do cálculo ocorre em memória), relatórios em armazenamento de objetos com URL assinada, cache das chaves, fila própria de webhooks, cotas por plano e réplicas de leitura (detalhes no relatório técnico, seção 5).
