-- OPCIONAL: preenche statusDe/statusPara nas movimentações criadas ANTES da AV3 (a partir do texto da observação).
-- Formato gravado pela AV2:  alteracao_status -> "<de> → <para> | <observação opcional>" ; cadastro -> "Entrada no lote ..."
-- Seguro de repetir: só mexe em linhas que ainda estão sem statusPara.
-- Uso: npm run db:backfill-av3

UPDATE `Movimentacao`
   SET `statusPara` = 'recebido'
 WHERE `tipo` = 'cadastro' AND `statusPara` IS NULL;

UPDATE `Movimentacao`
   SET `statusDe`   = SUBSTRING_INDEX(`observacao`, ' → ', 1),
       `statusPara` = SUBSTRING_INDEX(SUBSTRING_INDEX(`observacao`, ' → ', -1), ' |', 1)
 WHERE `tipo` = 'alteracao_status' AND `statusPara` IS NULL AND `observacao` LIKE '% → %';
