import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const PREFIXO_CHAVE = 'gc_live_';
const TAM_ID = 8; // hex
const TAM_SEGREDO = 64; // hex (32 bytes = 256 bits de entropia)
const TAM_TOTAL = PREFIXO_CHAVE.length + TAM_ID + 1 + TAM_SEGREDO;

export const hashChave = (chave: string) => createHash('sha256').update(chave).digest('hex');

/** Formato: gc_live_<8 hex>_<64 hex>. O prefixo (16 chars) é guardado em claro para localizar a chave. */
export function gerarChave() {
  const prefixo = `${PREFIXO_CHAVE}${randomBytes(TAM_ID / 2).toString('hex')}`;
  const chave = `${prefixo}_${randomBytes(TAM_SEGREDO / 2).toString('hex')}`;
  return { chave, prefixo, hash: hashChave(chave) };
}

export function extrairPrefixo(chave: string): string | null {
  const ini = PREFIXO_CHAVE.length + TAM_ID;
  if (chave.length !== TAM_TOTAL || !chave.startsWith(PREFIXO_CHAVE) || chave[ini] !== '_') return null;
  return chave.slice(0, ini);
}

/** Comparação em tempo constante para não vazar informação por temporização. */
export function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export const gerarSegredoWebhook = () => `whsec_${randomBytes(24).toString('hex')}`;
