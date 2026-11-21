import { Papel } from '../domain/Papel';

/**
 * Matriz de permissões em um único lugar (regras do professor para a AV2):
 *  - rotas e LISTAGENS bloqueadas por papel: cada papel só enxerga o que gerencia (o auditor consulta tudo);
 *  - ADMIN tem acesso a TODAS as rotas, mas seu foco é a gestão de usuários;
 *  - operadores NÃO acessam recursos administrativos (ex.: listagem de usuários).
 */
export const PERMISSOES = {
  // Usuários (recurso administrativo)
  lerUsuarios: [Papel.ADMIN, Papel.AUDITOR],
  gerirUsuarios: [Papel.ADMIN],

  // Organizações e contratos de coleta
  lerCadastro: [Papel.ADMIN, Papel.OPERADOR_CADASTRO, Papel.AUDITOR],
  gerirCadastro: [Papel.ADMIN, Papel.OPERADOR_CADASTRO],

  // Lotes, equipamentos e movimentações
  lerAlmoxarifado: [Papel.ADMIN, Papel.GESTOR_ALMOXARIFADO, Papel.AUDITOR],
  gerirAlmoxarifado: [Papel.ADMIN, Papel.GESTOR_ALMOXARIFADO],

  // Relatórios (papel do auditor)
  relatorios: [Papel.ADMIN, Papel.AUDITOR],

  // Exclusão física (destrutiva e em cascata) de organização, lote e usuário
  exclusaoDefinitiva: [Papel.ADMIN],

  // AV3 — camada analítica: consulta de resultados / disparo de análises / tabela de valores de referência
  lerAnalises: [Papel.ADMIN, Papel.GESTOR_ALMOXARIFADO, Papel.AUDITOR],
  gerirAnalises: [Papel.ADMIN, Papel.GESTOR_ALMOXARIFADO],
  gerirValoresReferencia: [Papel.ADMIN],

  // AV3 — chaves de API de parceiros externos (credenciais: só o administrador)
  gerirApiKeys: [Papel.ADMIN],
} as const;
