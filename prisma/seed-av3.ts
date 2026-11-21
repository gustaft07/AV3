/**
 * Dados de demonstração para as análises da AV3. Acrescenta ~12 meses de lotes (AV3-001...) à organização
 * ECO001 criada por `npm run seed` e imprime uma API Key de demonstração (mostrada UMA vez).
 * Uso:  npm run seed   (antes)   e depois   npm run seed:av3
 * É idempotente: apaga e recria apenas os lotes com código "AV3-...".
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, type EstadoFisico } from '@prisma/client';
import { ApiKeyRepository } from '../src/modules/auth/api-keys/api-key.repository';
import { ApiKeyService } from '../src/modules/auth/api-keys/api-key.service';

const prisma = new PrismaClient();
const DIA = 86_400_000;
const HORA = 3_600_000;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const entre = (a: number, b: number) => a + rnd() * (b - a);
const sorteia = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const ESTADOS: EstadoFisico[] = ['novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata'];
const CATALOGO: Record<string, Array<[string, string]>> = {
  notebook: [['Dell', 'Latitude 5420'], ['Lenovo', 'ThinkPad T14']],
  monitor: [['LG', '24MK430'], ['Samsung', 'S24F350']],
  smartphone: [['Samsung', 'Galaxy A32'], ['Motorola', 'Moto G9']],
  impressora: [['HP', 'LaserJet M404'], ['Epson', 'L3150']],
};
const BASE: Record<string, number> = { notebook: 400, monitor: 120, smartphone: 180, impressora: 90 };
const FATOR: Record<EstadoFisico, number> = { novo: 1, seminovo: 0.8, usado_bom: 0.6, usado_regular: 0.4, usado_ruim: 0.2, sucata: 0.05 };
const OPERADORES: Array<[string, number]> = [['op.ana', 1], ['op.bruno', 1.7], ['op.carla', 0.8]]; // fator de lentidão

async function main() {
  const org = await prisma.organizacao.findUnique({ where: { codigo: 'ECO001' }, include: { contrato: true } });
  if (!org?.contrato) throw new Error('Rode antes `npm run seed` (cria a organização ECO001 com contrato).');
  await prisma.lote.deleteMany({ where: { codigoLote: { startsWith: 'AV3-' } } }); // cascata: equipamentos, histórico, movimentações

  for (const [tipo, modelos] of Object.entries(CATALOGO)) {
    for (const e of ESTADOS) {
      await prisma.valorReferenciaRecuperacao.upsert({
        where: { tipo_marca_modelo_estadoFisico: { tipo, marca: '', modelo: '', estadoFisico: e } },
        update: {}, create: { tipo, estadoFisico: e, valor: Math.round(BASE[tipo] * FATOR[e]) },
      });
      const [marca, modelo] = modelos[0];
      await prisma.valorReferenciaRecuperacao.upsert({
        where: { tipo_marca_modelo_estadoFisico: { tipo, marca: marca.toLowerCase(), modelo: modelo.toLowerCase(), estadoFisico: e } },
        update: {}, create: { tipo, marca: marca.toLowerCase(), modelo: modelo.toLowerCase(), estadoFisico: e, valor: Math.round(BASE[tipo] * FATOR[e] * 1.25) },
      });
    }
  }

  const agora = Date.now();
  for (let i = 0; i < 48; i++) {
    const entrada = new Date(agora - (47 - i) * 7 * DIA);
    const sazonal = [10, 11, 0].includes(entrada.getUTCMonth()) ? 1.4 : 1; // fim/início de ano mais lento
    const lote = await prisma.lote.create({
      data: {
        codigoLote: `AV3-${String(i + 1).padStart(3, '0')}`, notaFiscal: `NF-${1000 + i}`,
        transportadora: sorteia(['Transportes Verde', 'LogReversa SA']), dataEntrada: entrada, organizacaoId: org.id,
      },
    });

    const equipamentos: any[] = []; const hist: any[] = []; const movs: any[] = [];
    const qtd = 5 + Math.floor(rnd() * 5);
    for (let p = 1; p <= qtd; p++) {
      const id = randomUUID();
      const tipo = sorteia(Object.keys(CATALOGO));
      const [marca, modelo] = sorteia(CATALOGO[tipo]);
      let idx = Math.floor(rnd() * 3); // estado inicial: novo..usado_bom
      const inicial = ESTADOS[idx];
      let t = entrada.getTime();
      // degradação ao longo do tempo (mais rápida para impressora/smartphone)
      const ritmo = tipo === 'impressora' || tipo === 'smartphone' ? 70 : 110;
      while (idx < 5) {
        t += entre(0.6, 1.4) * ritmo * DIA;
        if (t > agora) break;
        hist.push({ equipamentoId: id, de: ESTADOS[idx], para: ESTADOS[idx + 1], em: new Date(t), justificativa: 'Desgaste observado' });
        idx++;
      }
      // fluxo de status: recebido -> triagem -> triagem_completa
      const [op, lento] = sorteia(OPERADORES);
      const tTri = entrada.getTime() + entre(2, 40) * HORA * sazonal;
      const tFim = tTri + entre(1.5, 18) * HORA * lento * sazonal;
      movs.push({ equipamentoId: id, tipo: 'cadastro', ator: 'op.cadastro', statusDe: null, statusPara: 'recebido', criadoEm: entrada });
      let status = 'recebido';
      if (tTri < agora) { movs.push({ equipamentoId: id, tipo: 'alteracao_status', ator: op, statusDe: 'recebido', statusPara: 'triagem', criadoEm: new Date(tTri) }); status = 'triagem'; }
      if (tFim < agora) { movs.push({ equipamentoId: id, tipo: 'alteracao_status', ator: op, statusDe: 'triagem', statusPara: 'triagem_completa', criadoEm: new Date(tFim) }); status = 'triagem_completa'; }
      equipamentos.push({ id, codigoBarrasInterno: id, posicao: p, tipo, marca, modelo, estadoFisico: ESTADOS[idx], status, loteId: lote.id, criadoEm: entrada });
    }
    await prisma.equipamento.createMany({ data: equipamentos });
    await prisma.historicoEstado.createMany({ data: hist });
    await prisma.movimentacao.createMany({ data: movs });
    const todos = equipamentos.every((e) => e.status === 'triagem_completa');
    if (todos) await prisma.lote.update({ where: { id: lote.id }, data: { status: 'triagem_completa' } });
  }
  // API Key de demonstração (escopos completos) para testar a API pública
  await prisma.apiKey.deleteMany({ where: { nome: 'Parceiro Demo (seed AV3)' } });
  const chave = await new ApiKeyService(new ApiKeyRepository(prisma)).criar({
    nome: 'Parceiro Demo (seed AV3)', organizacaoId: org.id, limiteReqPorMinuto: 60,
    escopos: ['rastreabilidade_read', 'lotes_read', 'lotes_write', 'relatorios_read'],
  });
  console.log('Seed AV3 concluído: 48 lotes em ECO001 + tabela de valores de referência.');
  console.log(`API Key de demonstração (guarde, não será exibida de novo):\n  ${chave.chave}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
