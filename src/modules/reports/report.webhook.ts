import { createHmac } from 'node:crypto';

export interface EventoWebhook {
  evento: 'relatorio.concluido' | 'relatorio.falhou';
  tarefaId: string;
  status: string;
  resultadoUrl?: string;
  erro?: string;
}

/**
 * Notifica o parceiro (alternativa ao polling). Corpo JSON assinado com HMAC-SHA256 no cabeçalho
 * X-GreenCode-Signature (sha256=<hex>). Falha de entrega NÃO falha a tarefa: o parceiro ainda pode consultar o status.
 */
export async function enviarWebhook(url: string, segredo: string | null, evento: EventoWebhook): Promise<boolean> {
  const corpo = JSON.stringify(evento);
  const assinatura = createHmac('sha256', segredo ?? '').update(corpo).digest('hex');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-greencode-event': evento.evento,
        'x-greencode-signature': `sha256=${assinatura}`,
      },
      body: corpo,
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
