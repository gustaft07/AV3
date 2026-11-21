import { EntidadeBase } from "./EntidadeBase";
import type { StatusEquipamento } from "../core/validation";

export interface MovimentacaoJSON {
  id: string;
  criadoEm: string;
  equipamentoId: string;
  tipo: string;
  ator: string;
  observacao?: string;
  statusDe?: StatusEquipamento; //transição estruturada (base das análises de eficiência)
  statusPara?: StatusEquipamento;
}

export class Movimentacao extends EntidadeBase {
  equipamentoId: string;
  tipo: string;
  ator: string;
  observacao?: string;
  statusDe?: StatusEquipamento;
  statusPara?: StatusEquipamento;

  constructor(dados: {
    id?: string;
    criadoEm?: string;
    equipamentoId: string;
    tipo: string;
    ator: string;
    observacao?: string;
    statusDe?: StatusEquipamento;
    statusPara?: StatusEquipamento;
  }) {
    super(dados.id, dados.criadoEm);
    this.equipamentoId = dados.equipamentoId;
    this.tipo = dados.tipo;
    this.ator = dados.ator;
    this.observacao = dados.observacao;
    this.statusDe = dados.statusDe;
    this.statusPara = dados.statusPara;
  }

  validar(): void {
    this.exigir(this.equipamentoId.trim().length > 0, "equipamentoId é obrigatório.");
    this.exigir(this.tipo.trim().length > 0, "Tipo de movimentação é obrigatório.");
  }

  paraJSON(): MovimentacaoJSON {
    return {
      id: this.id,
      criadoEm: this.criadoEm,
      equipamentoId: this.equipamentoId,
      tipo: this.tipo,
      ator: this.ator,
      observacao: this.observacao,
      statusDe: this.statusDe,
      statusPara: this.statusPara,
    };
  }

  static deJSON(j: MovimentacaoJSON): Movimentacao {
    return new Movimentacao(j);
  }
}
