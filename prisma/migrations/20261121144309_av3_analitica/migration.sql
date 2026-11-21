-- This is an empty migration.

-- Constraints da AV3 (MySQL 8.0.16+). Anexe ao migration.sql da migration "av3_analitica":
--   npx prisma migrate dev --create-only --name av3_analitica
--   npm run db:constraints-av3
--   npx prisma migrate dev
ALTER TABLE `ApiKey`
  ADD CONSTRAINT `apikey_limite_positivo_chk` CHECK (`limiteReqPorMinuto` > 0);

ALTER TABLE `ValorReferenciaRecuperacao`
  ADD CONSTRAINT `valor_referencia_nao_negativo_chk` CHECK (`valor` >= 0);

ALTER TABLE `TarefaRelatorio`
  ADD CONSTRAINT `tarefa_tentativas_chk` CHECK (`tentativas` >= 0);
