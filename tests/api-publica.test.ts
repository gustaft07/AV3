import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  PREFIXO_CHAVE, extrairPrefixo, gerarChave, gerarSegredoWebhook, hashChave, hashesIguais,
} from '../src/modules/auth/api-keys/api-key.crypto';
import { enviarWebhook } from '../src/modules/reports/report.webhook';

test('API Key: formato gc_live_<8 hex>_<64 hex>, prefixo extraível e hash SHA-256', () => {
  const { chave, prefixo, hash } = gerarChave();
  assert.match(chave, /^gc_live_[0-9a-f]{8}_[0-9a-f]{64}$/);
  assert.equal(prefixo.length, 16);
  assert.ok(prefixo.startsWith(PREFIXO_CHAVE));
  assert.equal(extrairPrefixo(chave), prefixo);
  assert.equal(hash, hashChave(chave));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(gerarChave().chave, chave); // chaves únicas
});

test('API Key: chaves malformadas são rejeitadas antes de qualquer consulta ao banco', () => {
  assert.equal(extrairPrefixo(''), null);
  assert.equal(extrairPrefixo('gc_live_abc'), null);
  assert.equal(extrairPrefixo('xx_live_12345678_' + 'a'.repeat(64)), null);
  assert.equal(extrairPrefixo('gc_live_12345678-' + 'a'.repeat(64)), null);
});

test('API Key: comparação de hashes em tempo constante', () => {
  const a = hashChave('x'); const b = hashChave('y');
  assert.equal(hashesIguais(a, a), true);
  assert.equal(hashesIguais(a, b), false);
  assert.equal(hashesIguais(a, 'abcd'), false); // tamanhos diferentes
  assert.match(gerarSegredoWebhook(), /^whsec_[0-9a-f]{48}$/);
});

test('webhook: corpo JSON assinado com HMAC-SHA256 (X-GreenCode-Signature) e entrega confirmada', async () => {
  let corpoRecebido = ''; let assinatura = ''; let evento = '';
  const servidor = http.createServer((req, res) => {
    assinatura = String(req.headers['x-greencode-signature']);
    evento = String(req.headers['x-greencode-event']);
    req.on('data', (c) => (corpoRecebido += c));
    req.on('end', () => res.writeHead(204).end());
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address() as AddressInfo;
  try {
    const ok = await enviarWebhook(`http://127.0.0.1:${port}/hook`, 'segredo-do-parceiro', {
      evento: 'relatorio.concluido', tarefaId: 't-1', status: 'concluida', resultadoUrl: '/api/v1/public/tarefas/t-1/resultado',
    });
    assert.equal(ok, true);
    assert.equal(evento, 'relatorio.concluido');
    const esperado = createHmac('sha256', 'segredo-do-parceiro').update(corpoRecebido).digest('hex');
    assert.equal(assinatura, `sha256=${esperado}`);
    assert.equal(JSON.parse(corpoRecebido).tarefaId, 't-1');
  } finally {
    servidor.close();
  }
});

test('webhook: destino fora do ar devolve false (a tarefa não falha; o parceiro ainda pode consultar por polling)', async () => {
  const ok = await enviarWebhook('http://127.0.0.1:1/inexistente', 'x', { evento: 'relatorio.falhou', tarefaId: 't', status: 'falhou' });
  assert.equal(ok, false);
});
