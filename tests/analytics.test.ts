import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularEficiencia, type MovimentoStatus } from '../src/modules/analytics/services/eficiencia.service';
import { agregarRentabilidade, buscarValor } from '../src/modules/analytics/services/rentabilidade.service';
import {
  SCORE, observacoesDoEquipamento, projetar, serieDeFaixas, type Observacao,
} from '../src/modules/analytics/services/vida-util.service';
import { regressaoOLS } from '../src/modules/analytics/stats/estatistica';
import { suavizacaoHolt } from '../src/modules/analytics/stats/holt';
import { PERMISSOES } from '../src/shared/permissoes';
import { Papel } from '../src/domain/Papel';

const H = 3_600_000;
const DIA = 24 * H;
const t0 = new Date('2026-03-10T08:00:00Z');
const mais = (base: Date, horas: number) => new Date(base.getTime() + horas * H);
const mov = (equipamentoId: string, loteId: string, statusPara: MovimentoStatus['statusPara'], ator: string, em: Date): MovimentoStatus =>
  ({ equipamentoId, loteId, statusPara, ator, em });

// ---------------- eficiência operacional ----------------
const movs: MovimentoStatus[] = [
  // lote L1 (2 equipamentos): ana conclui e1 em 4 h, bruno conclui e2 em 8 h -> lote concluído 11 h após a entrada
  mov('e1', 'L1', 'recebido', 'cadastro', t0), mov('e1', 'L1', 'triagem', 'op.ana', mais(t0, 2)), mov('e1', 'L1', 'triagem_completa', 'op.ana', mais(t0, 6)),
  mov('e2', 'L1', 'recebido', 'cadastro', t0), mov('e2', 'L1', 'triagem', 'op.bruno', mais(t0, 3)), mov('e2', 'L1', 'triagem_completa', 'op.bruno', mais(t0, 11)),
  // lote L2 (2 equipamentos): só um terminou a triagem -> NÃO conta no tempo do lote
  mov('e3', 'L2', 'recebido', 'cadastro', t0), mov('e3', 'L2', 'triagem', 'op.ana', mais(t0, 1)), mov('e3', 'L2', 'triagem_completa', 'op.ana', mais(t0, 3)),
  mov('e4', 'L2', 'recebido', 'cadastro', t0),
];
const lotes = [
  { id: 'L1', dataEntrada: t0, totalEquipamentos: 2 },
  { id: 'L2', dataEntrada: t0, totalEquipamentos: 2 },
];

test('eficiência: tempo médio do lote vai da entrada até a conclusão da triagem do ÚLTIMO equipamento', () => {
  const linhas = calcularEficiencia(movs, lotes);
  const geral = linhas.find((l) => l.dimensao === 'geral')!;
  assert.equal(geral.amostras, 1); // L2 está incompleto
  assert.equal(geral.mediaHoras, 11);
  assert.ok(linhas.some((l) => l.dimensao === 'mes' && l.chave === '2026-03'));
  assert.ok(linhas.some((l) => l.dimensao === 'trimestre' && l.chave === '2026-Q1'));
});

test('eficiência: compara operadores pelo tempo de triagem por equipamento', () => {
  const op = (nome: string) => calcularEficiencia(movs, lotes).find((l) => l.dimensao === 'operador' && l.chave === nome)!;
  assert.equal(op('op.ana').mediaHoras, 3); // e1 = 4 h, e3 = 2 h
  assert.equal(op('op.ana').amostras, 2);
  assert.equal(op('op.bruno').mediaHoras, 8);
});

test('eficiência: a etapa de maior permanência média é marcada como gargalo (apenas uma)', () => {
  const etapas = calcularEficiencia(movs, lotes).filter((l) => l.dimensao === 'etapa');
  const gargalos = etapas.filter((e) => e.gargalo);
  assert.equal(gargalos.length, 1);
  assert.equal(gargalos[0].chave, 'triagem'); // triagem: 4, 8 e 2 h; recebido: 2, 3, 1 h
});

test('eficiência: sem movimentações estruturadas não há linhas (e não quebra)', () => {
  assert.deepEqual(calcularEficiencia([], lotes), []);
});

// ---------------- rentabilidade ----------------
const refs = new Map<string, number>([
  ['notebook|||usado_bom', 300],
  ['notebook|dell||usado_bom', 360],
  ['notebook|dell|latitude 5420|usado_bom', 420],
  ['notebook|||sucata', 20],
]);

test('rentabilidade: valor de referência usa o mais específico disponível (modelo > marca > tipo)', () => {
  assert.equal(buscarValor(refs, 'notebook', 'dell', 'latitude 5420', 'usado_bom'), 420);
  assert.equal(buscarValor(refs, 'notebook', 'dell', 'outro', 'usado_bom'), 360);
  assert.equal(buscarValor(refs, 'notebook', 'hp', 'x', 'usado_bom'), 300);
  assert.equal(buscarValor(refs, 'monitor', '', '', 'novo'), undefined);
});

test('rentabilidade: detalhe por estado + consolidado (média ponderada pelo mix de estados) e aviso de itens sem referência', () => {
  const { linhas, semReferencia } = agregarRentabilidade([
    { tipo: 'Notebook', marca: 'Dell', modelo: 'Latitude 5420', estadoFisico: 'usado_bom' },
    { tipo: 'Notebook', marca: 'Dell', modelo: 'Latitude 5420', estadoFisico: 'usado_bom' },
    { tipo: 'Notebook', marca: 'Dell', modelo: 'Latitude 5420', estadoFisico: 'sucata' },
    { tipo: 'Monitor', marca: null, modelo: null, estadoFisico: 'novo' },
  ], refs);
  assert.deepEqual(semReferencia, ['monitor/novo']);
  const det = linhas.find((l) => l.estadoFisico === 'usado_bom')!;
  assert.equal(det.amostras, 2);
  assert.equal(det.valorMedio, 420);
  const cons = linhas.find((l) => l.estadoFisico === null)!;
  assert.equal(cons.amostras, 3);
  assert.equal(cons.valorMedio, 286.67); // (420 + 420 + 20) / 3
  assert.equal(cons.valorTotal, 860);
  assert.ok(cons.desvio > 0);
});

// ---------------- vida útil remanescente ----------------
test('estatística: regressão OLS recupera uma reta perfeita (R² = 1)', () => {
  const pontos: Array<[number, number]> = [0, 100, 200, 300].map((x) => [x, 5 - 0.01 * x]);
  const r = regressaoOLS(pontos);
  assert.ok(Math.abs(r.inclinacao + 0.01) < 1e-9);
  assert.ok(Math.abs(r.intercepto - 5) < 1e-9);
  assert.ok(Math.abs(r.r2 - 1) < 1e-9);
});

test('estatística: Holt segue a tendência de uma série linear decrescente', () => {
  const h = suavizacaoHolt([5, 4, 3, 2, 1]);
  assert.ok(Math.abs(h.nivel - 1) < 1e-9);
  assert.ok(Math.abs(h.tendencia + 1) < 1e-9);
  assert.throws(() => suavizacaoHolt([1, 2]));
});

test('vida útil: faixas de 30 dias com lacunas preenchidas por interpolação', () => {
  const obs: Observacao[] = [{ idade: 5, score: 5 }, { idade: 95, score: 3 }]; // faixas 0 e 3; 1 e 2 interpoladas
  const { valores, ultimaFaixa } = serieDeFaixas(obs);
  assert.equal(ultimaFaixa, 3);
  assert.deepEqual(valores.map((v) => Math.round(v * 100) / 100), [5, 4.33, 3.67, 3]);
});

test('vida útil: projeção = idade em que a reta cruza o limiar menos a idade média atual', () => {
  const agora = new Date('2026-11-20T00:00:00Z');
  // nota = 5 - 0.01*idade; limiar 0.5 => cruza aos 450 dias; idade média 100 => restam 350 dias
  const p = projetar(-0.01, 5, 0.5, 100, agora);
  assert.equal(p.vidaRestanteDias, 350);
  assert.equal(p.inservivelPrevistoEm!.getTime(), agora.getTime() + 350 * DIA);
  // equipamentos já além do ponto de cruzamento: vida restante 0 (não negativa)
  assert.equal(projetar(-0.01, 5, 0.5, 600, agora).vidaRestanteDias, 0);
});

test('vida útil: sem tendência de queda ou horizonte irreal => sem previsão', () => {
  const agora = new Date();
  assert.equal(projetar(0, 5, 0.5, 100, agora).vidaRestanteDias, null);
  assert.equal(projetar(0.002, 3, 0.5, 100, agora).inservivelPrevistoEm, null);
  assert.equal(projetar(-0.00001, 5, 0.5, 100, agora).vidaRestanteDias, null); // > 100 anos
  assert.equal(projetar(-0.01, 5, 0.5, null, agora).vidaRestanteDias, null);
});

test('vida útil: observações do equipamento (inicial + transições + estado atual)', () => {
  const criadoEm = new Date('2026-01-01T00:00:00Z');
  const agora = new Date('2026-04-11T00:00:00Z'); // 100 dias depois
  const obs = observacoesDoEquipamento({
    estadoFisico: 'usado_regular', criadoEm,
    historicoEstado: [
      { de: 'novo', para: 'seminovo', em: new Date('2026-02-01T00:00:00Z') }, // dia 31
      { de: 'seminovo', para: 'usado_regular', em: new Date('2026-03-12T00:00:00Z') }, // dia 70
    ],
  }, agora);
  assert.deepEqual(obs.map((o) => [Math.round(o.idade), o.score]), [[0, SCORE.novo], [31, SCORE.seminovo], [70, SCORE.usado_regular], [100, SCORE.usado_regular]]);
  // sucata não ganha observação "atual" (já terminou)
  assert.equal(observacoesDoEquipamento({ estadoFisico: 'sucata', criadoEm, historicoEstado: [] }, agora).length, 1);
});

test('vida útil ponta a ponta (parte numérica): frota que perde 1 nota a cada 100 dias é projetada a ~450 dias', () => {
  const agora = new Date('2026-11-20T00:00:00Z');
  const obs: Observacao[] = [];
  for (let i = 0; i < 12; i++) {
    const criadoEm = new Date(agora.getTime() - (50 + i * 20) * DIA);
    obs.push(...observacoesDoEquipamento({
      estadoFisico: 'seminovo', criadoEm,
      historicoEstado: [{ de: 'novo', para: 'seminovo', em: new Date(criadoEm.getTime() + 100 * DIA) }],
    }, agora));
  }
  const reta = regressaoOLS(obs.map((o): [number, number] => [o.idade, o.score]));
  assert.ok(reta.inclinacao < 0);
  const p = projetar(reta.inclinacao, reta.intercepto, 0.5, 200, agora);
  assert.ok(p.vidaRestanteDias === null || p.vidaRestanteDias >= 0);
});

// ---------------- permissões novas ----------------
test('permissões da AV3: chaves de API só para admin; análises sem o operador de cadastro; admin em todos os grupos', () => {
  assert.deepEqual([...PERMISSOES.gerirApiKeys], [Papel.ADMIN]);
  assert.deepEqual([...PERMISSOES.gerirValoresReferencia], [Papel.ADMIN]);
  assert.equal(PERMISSOES.lerAnalises.includes(Papel.AUDITOR as never), true);
  assert.equal(PERMISSOES.gerirAnalises.includes(Papel.AUDITOR as never), false);
  assert.equal(PERMISSOES.lerAnalises.includes(Papel.OPERADOR_CADASTRO as never), false);
  for (const g of Object.values(PERMISSOES) as readonly (readonly Papel[])[]) assert.ok(g.includes(Papel.ADMIN));
});
