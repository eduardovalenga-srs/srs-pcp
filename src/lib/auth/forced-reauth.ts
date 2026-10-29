/**
 * Controle do "re-login forçado": o usuário pediu que a tela de login
 * apareça a cada abertura do sistema. Para não derrubar a sessão logo após
 * um login bem-sucedido (que redireciona para o painel), o `LoginForm` marca o
 * fluxo e o `ForceReauth` consome a marcação.
 */

let skipNext = false;

/** Marca que o próximo fluxo de login deve seguir normalmente. */
export function requestSkipForcedReauth(): void {
  skipNext = true;
}

/** Consome a marcação — true quando o fluxo atual já nasceu do login. */
export function consumeSkipForcedReauth(): boolean {
  const skip = skipNext;
  skipNext = false;
  return skip;
}
