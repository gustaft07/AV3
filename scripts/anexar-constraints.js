#!/usr/bin/env node
/**
 * Anexa um arquivo de constraints (SQL) ao migration.sql de uma migration gerada com --create-only.
 * Funciona igual em Windows, Linux e macOS (sem depender de cat/PowerShell, que divergem em codificação).
 *
 * Uso (ANTES de aplicar a migration):
 *   AV2:  npx prisma migrate dev --create-only --name init
 *         npm run db:constraints                      (sufixo "init", arquivo prisma/constraints.sql)
 *         npx prisma migrate dev
 *   AV3:  npx prisma migrate dev --create-only --name av3_analitica
 *         npm run db:constraints-av3                  (sufixo "av3_analitica", arquivo prisma/constraints-av3.sql)
 *         npx prisma migrate dev
 */
const fs = require('fs');
const path = require('path');

const sufixo = process.argv[2] || 'init';
const arquivo = process.argv[3] || 'constraints.sql';

const raiz = path.join(__dirname, '..');
const pastaMigracoes = path.join(raiz, 'prisma', 'migrations');
const arquivoConstraints = path.join(raiz, 'prisma', arquivo);

function falhar(msg) {
  console.error('ERRO: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(pastaMigracoes)) {
  falhar('prisma/migrations não existe. Rode antes: npx prisma migrate dev --create-only --name ' + sufixo);
}
if (!fs.existsSync(arquivoConstraints)) falhar('arquivo não encontrado: prisma/' + arquivo);

const pastas = fs
  .readdirSync(pastaMigracoes)
  .filter((n) => n.endsWith('_' + sufixo) && fs.statSync(path.join(pastaMigracoes, n)).isDirectory())
  .sort();

if (pastas.length === 0) {
  falhar('nenhuma migration "*_' + sufixo + '" encontrada. Rode: npx prisma migrate dev --create-only --name ' + sufixo);
}

const alvo = path.join(pastaMigracoes, pastas[pastas.length - 1], 'migration.sql');
const atual = fs.readFileSync(alvo, 'utf8');
const extra = fs.readFileSync(arquivoConstraints, 'utf8').replace(/\r\n/g, '\n');

// Marcador: nome da primeira constraint do arquivo (detecta anexo anterior)
const m = /ADD CONSTRAINT `([^`]+)`/.exec(extra);
if (m && atual.includes(m[1])) {
  console.log('As constraints já estão em ' + path.relative(raiz, alvo) + '. Nada a fazer.');
  process.exit(0);
}

fs.appendFileSync(alvo, '\n\n' + extra, 'utf8');
console.log('Constraints anexadas em ' + path.relative(raiz, alvo));
console.log('Agora aplique: npx prisma migrate dev');
