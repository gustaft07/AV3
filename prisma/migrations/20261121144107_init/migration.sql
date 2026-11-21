-- CreateTable
CREATE TABLE `Usuario` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `login` VARCHAR(191) NOT NULL,
    `hashSenha` VARCHAR(191) NOT NULL,
    `saltSenha` VARCHAR(191) NOT NULL,
    `papel` ENUM('admin', 'operador_cadastro', 'gestor_almoxarifado', 'auditor') NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `versao` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `Usuario_login_key`(`login`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Organizacao` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `codigo` VARCHAR(191) NOT NULL,
    `razaoSocial` VARCHAR(255) NOT NULL,
    `cnpj` VARCHAR(191) NOT NULL,
    `prazoArmazenamentoDias` INTEGER NOT NULL DEFAULT 90,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `versao` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `Organizacao_codigo_key`(`codigo`),
    UNIQUE INDEX `Organizacao_cnpj_key`(`cnpj`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contrato` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `numero` VARCHAR(191) NOT NULL,
    `organizacaoId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Contrato_numero_key`(`numero`),
    UNIQUE INDEX `Contrato_organizacaoId_key`(`organizacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lote` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `codigoLote` VARCHAR(191) NOT NULL,
    `notaFiscal` VARCHAR(191) NOT NULL,
    `transportadora` VARCHAR(191) NOT NULL,
    `dataEntrada` DATETIME(3) NOT NULL,
    `status` ENUM('recebido', 'triagem', 'triagem_completa', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda') NOT NULL DEFAULT 'recebido',
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `organizacaoId` VARCHAR(191) NOT NULL,
    `versao` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `Lote_codigoLote_key`(`codigoLote`),
    INDEX `Lote_organizacaoId_idx`(`organizacaoId`),
    INDEX `Lote_dataEntrada_idx`(`dataEntrada`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Equipamento` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `codigoBarrasInterno` VARCHAR(191) NOT NULL,
    `posicao` INTEGER NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `marca` VARCHAR(100) NULL,
    `modelo` VARCHAR(100) NULL,
    `estadoFisico` ENUM('novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata') NOT NULL,
    `status` ENUM('recebido', 'triagem', 'triagem_completa', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda') NOT NULL DEFAULT 'recebido',
    `loteId` VARCHAR(191) NOT NULL,
    `versao` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `Equipamento_codigoBarrasInterno_key`(`codigoBarrasInterno`),
    INDEX `Equipamento_status_idx`(`status`),
    INDEX `Equipamento_estadoFisico_idx`(`estadoFisico`),
    INDEX `Equipamento_tipo_marca_modelo_idx`(`tipo`, `marca`, `modelo`),
    UNIQUE INDEX `Equipamento_loteId_posicao_key`(`loteId`, `posicao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HistoricoEstado` (
    `id` VARCHAR(191) NOT NULL,
    `equipamentoId` VARCHAR(191) NOT NULL,
    `de` ENUM('novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata') NOT NULL,
    `para` ENUM('novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata') NOT NULL,
    `justificativa` VARCHAR(500) NULL,
    `em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `HistoricoEstado_equipamentoId_em_idx`(`equipamentoId`, `em`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Movimentacao` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `equipamentoId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `ator` VARCHAR(191) NOT NULL,
    `observacao` VARCHAR(1000) NULL,
    `statusDe` ENUM('recebido', 'triagem', 'triagem_completa', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda') NULL,
    `statusPara` ENUM('recebido', 'triagem', 'triagem_completa', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda') NULL,

    INDEX `Movimentacao_equipamentoId_criadoEm_idx`(`equipamentoId`, `criadoEm`),
    INDEX `Movimentacao_statusPara_criadoEm_idx`(`statusPara`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `nome` VARCHAR(120) NOT NULL,
    `prefixo` VARCHAR(16) NOT NULL,
    `hashChave` CHAR(64) NOT NULL,
    `organizacaoId` VARCHAR(191) NOT NULL,
    `limiteReqPorMinuto` INTEGER NOT NULL DEFAULT 60,
    `ativa` BOOLEAN NOT NULL DEFAULT true,
    `expiraEm` DATETIME(3) NULL,
    `revogadaEm` DATETIME(3) NULL,
    `ultimoUsoEm` DATETIME(3) NULL,
    `webhookUrl` VARCHAR(500) NULL,
    `webhookSegredo` VARCHAR(100) NULL,

    UNIQUE INDEX `ApiKey_prefixo_key`(`prefixo`),
    UNIQUE INDEX `ApiKey_hashChave_key`(`hashChave`),
    INDEX `ApiKey_organizacaoId_idx`(`organizacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKeyEscopo` (
    `apiKeyId` VARCHAR(191) NOT NULL,
    `escopo` ENUM('rastreabilidade_read', 'lotes_read', 'lotes_write', 'relatorios_read') NOT NULL,

    PRIMARY KEY (`apiKeyId`, `escopo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnaliseExecucao` (
    `id` VARCHAR(191) NOT NULL,
    `tipo` ENUM('eficiencia_operacional', 'rentabilidade', 'vida_util') NOT NULL,
    `origem` ENUM('agendada', 'manual', 'api') NOT NULL,
    `status` ENUM('processando', 'concluida', 'falhou') NOT NULL DEFAULT 'processando',
    `versaoModelo` VARCHAR(20) NOT NULL,
    `parametros` JSON NULL,
    `avisos` JSON NULL,
    `organizacaoId` VARCHAR(191) NULL,
    `iniciadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `concluidaEm` DATETIME(3) NULL,
    `erro` VARCHAR(1000) NULL,

    INDEX `AnaliseExecucao_tipo_iniciadaEm_idx`(`tipo`, `iniciadaEm`),
    INDEX `AnaliseExecucao_organizacaoId_idx`(`organizacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResultadoEficiencia` (
    `id` VARCHAR(191) NOT NULL,
    `execucaoId` VARCHAR(191) NOT NULL,
    `dimensao` ENUM('geral', 'operador', 'mes', 'trimestre', 'etapa') NOT NULL,
    `chave` VARCHAR(100) NOT NULL,
    `amostras` INTEGER NOT NULL,
    `mediaHoras` DOUBLE NOT NULL,
    `medianaHoras` DOUBLE NOT NULL,
    `desvioHoras` DOUBLE NOT NULL,
    `p90Horas` DOUBLE NOT NULL,
    `gargalo` BOOLEAN NOT NULL DEFAULT false,

    INDEX `ResultadoEficiencia_execucaoId_dimensao_idx`(`execucaoId`, `dimensao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResultadoRentabilidade` (
    `id` VARCHAR(191) NOT NULL,
    `execucaoId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `marca` VARCHAR(191) NOT NULL DEFAULT '',
    `modelo` VARCHAR(191) NOT NULL DEFAULT '',
    `estadoFisico` ENUM('novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata') NULL,
    `amostras` INTEGER NOT NULL,
    `valorMedio` DECIMAL(12, 2) NOT NULL,
    `desvio` DECIMAL(12, 2) NOT NULL,
    `valorTotal` DECIMAL(14, 2) NOT NULL,

    INDEX `ResultadoRentabilidade_execucaoId_tipo_idx`(`execucaoId`, `tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ValorReferenciaRecuperacao` (
    `id` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `marca` VARCHAR(191) NOT NULL DEFAULT '',
    `modelo` VARCHAR(191) NOT NULL DEFAULT '',
    `estadoFisico` ENUM('novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata') NOT NULL,
    `valor` DECIMAL(12, 2) NOT NULL,
    `atualizadoEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ValorReferenciaRecuperacao_tipo_marca_modelo_estadoFisico_key`(`tipo`, `marca`, `modelo`, `estadoFisico`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrevisaoVidaUtil` (
    `id` VARCHAR(191) NOT NULL,
    `execucaoId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `metodo` ENUM('ols', 'holt') NOT NULL,
    `limiar` DOUBLE NOT NULL,
    `amostras` INTEGER NOT NULL,
    `inclinacao` DOUBLE NOT NULL,
    `intercepto` DOUBLE NOT NULL,
    `r2` DOUBLE NOT NULL,
    `vidaRestanteDias` DOUBLE NULL,
    `inservivelPrevistoEm` DATETIME(3) NULL,
    `recomendada` BOOLEAN NOT NULL DEFAULT false,

    INDEX `PrevisaoVidaUtil_tipo_execucaoId_idx`(`tipo`, `execucaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AvaliacaoPrevisao` (
    `id` VARCHAR(191) NOT NULL,
    `previsaoId` VARCHAR(191) NOT NULL,
    `amostrasFuturas` INTEGER NOT NULL,
    `maeScore` DOUBLE NOT NULL,
    `viesScore` DOUBLE NOT NULL,
    `avaliadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AvaliacaoPrevisao_previsaoId_key`(`previsaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TarefaRelatorio` (
    `id` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `apiKeyId` VARCHAR(191) NULL,
    `organizacaoId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('eficiencia_operacional', 'rentabilidade', 'vida_util') NOT NULL,
    `formato` ENUM('csv', 'json') NOT NULL DEFAULT 'json',
    `parametros` JSON NULL,
    `status` ENUM('aguardando', 'processando', 'concluida', 'falhou') NOT NULL DEFAULT 'aguardando',
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `erro` VARCHAR(1000) NULL,
    `arquivo` VARCHAR(300) NULL,
    `concluidaEm` DATETIME(3) NULL,
    `expiraEm` DATETIME(3) NULL,

    INDEX `TarefaRelatorio_organizacaoId_criadoEm_idx`(`organizacaoId`, `criadoEm`),
    INDEX `TarefaRelatorio_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contrato` ADD CONSTRAINT `Contrato_organizacaoId_fkey` FOREIGN KEY (`organizacaoId`) REFERENCES `Organizacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lote` ADD CONSTRAINT `Lote_organizacaoId_fkey` FOREIGN KEY (`organizacaoId`) REFERENCES `Organizacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Equipamento` ADD CONSTRAINT `Equipamento_loteId_fkey` FOREIGN KEY (`loteId`) REFERENCES `Lote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HistoricoEstado` ADD CONSTRAINT `HistoricoEstado_equipamentoId_fkey` FOREIGN KEY (`equipamentoId`) REFERENCES `Equipamento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Movimentacao` ADD CONSTRAINT `Movimentacao_equipamentoId_fkey` FOREIGN KEY (`equipamentoId`) REFERENCES `Equipamento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_organizacaoId_fkey` FOREIGN KEY (`organizacaoId`) REFERENCES `Organizacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeyEscopo` ADD CONSTRAINT `ApiKeyEscopo_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `ApiKey`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResultadoEficiencia` ADD CONSTRAINT `ResultadoEficiencia_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `AnaliseExecucao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResultadoRentabilidade` ADD CONSTRAINT `ResultadoRentabilidade_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `AnaliseExecucao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrevisaoVidaUtil` ADD CONSTRAINT `PrevisaoVidaUtil_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `AnaliseExecucao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AvaliacaoPrevisao` ADD CONSTRAINT `AvaliacaoPrevisao_previsaoId_fkey` FOREIGN KEY (`previsaoId`) REFERENCES `PrevisaoVidaUtil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TarefaRelatorio` ADD CONSTRAINT `TarefaRelatorio_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `ApiKey`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Constraints que o Prisma não declara no schema.prisma (sintaxe MySQL 8.0.16+).
-- Devem ser ANEXADAS ao migration.sql gerado com `prisma migrate dev --create-only`
-- (veja o README, seção "Migrations e constraints").
-- Atenção: no MySQL 5.7 e anteriores o CHECK é aceito mas IGNORADO. Use MySQL 8.0.16 ou superior.

-- CNPJ armazenado somente com 14 dígitos (a validação dos dígitos verificadores é feita pelo domínio)
ALTER TABLE `Organizacao`
  ADD CONSTRAINT `organizacao_cnpj_formato_chk` CHECK (`cnpj` REGEXP '^[0-9]{14}$');

ALTER TABLE `Organizacao`
  ADD CONSTRAINT `organizacao_prazo_positivo_chk` CHECK (`prazoArmazenamentoDias` > 0);

-- Login no mesmo formato aceito pelo domínio (Usuario.validar)
ALTER TABLE `Usuario`
  ADD CONSTRAINT `usuario_login_formato_chk` CHECK (`login` REGEXP '^[a-zA-Z0-9._-]{3,}$');

-- Histórico de estado físico: precisa registrar uma mudança de fato
ALTER TABLE `HistoricoEstado`
  ADD CONSTRAINT `historico_estado_diferente_chk` CHECK (`de` <> `para`);

-- Rebaixar 2+ categorias exige justificativa de ao menos 5 caracteres (regra da AV1 também no banco)
ALTER TABLE `HistoricoEstado`
  ADD CONSTRAINT `historico_justificativa_chk` CHECK (
    ( (CASE `para` WHEN 'novo' THEN 0 WHEN 'seminovo' THEN 1 WHEN 'usado_bom' THEN 2
                   WHEN 'usado_regular' THEN 3 WHEN 'usado_ruim' THEN 4 WHEN 'sucata' THEN 5 END)
    - (CASE `de`   WHEN 'novo' THEN 0 WHEN 'seminovo' THEN 1 WHEN 'usado_bom' THEN 2
                   WHEN 'usado_regular' THEN 3 WHEN 'usado_ruim' THEN 4 WHEN 'sucata' THEN 5 END) ) < 2
    OR CHAR_LENGTH(TRIM(IFNULL(`justificativa`, ''))) >= 5
  );

-- Código de barras é gerado pelo sistema e corresponde sempre ao id do equipamento
ALTER TABLE `Equipamento`
  ADD CONSTRAINT `equipamento_codigo_barras_eq_id_chk` CHECK (`codigoBarrasInterno` = `id`);

-- Posição no lote é sequencial a partir de 1
ALTER TABLE `Equipamento`
  ADD CONSTRAINT `equipamento_posicao_chk` CHECK (`posicao` >= 1);

-- "desmonte" só a partir de triagem_completa: regra mantida no domínio (Equipamento.alterarStatus).
