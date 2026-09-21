/**
 * Utilitário para traduzir erros técnicos do Firebase / RTDB / Auth
 * em mensagens claras, amigáveis e orientadas à solução para o usuário comum.
 */
export function formatFriendlyError(error: any, actionContext?: string): string {
  if (!error) {
    return actionContext
      ? `Não foi possível ${actionContext}. Tente novamente.`
      : 'Ocorreu um erro inesperado. Tente novamente.';
  }

  const rawMsg: string = typeof error === 'string' ? error : error.message || error.toString() || '';
  const code: string = error.code || '';
  const lowerMsg = rawMsg.toLowerCase();

  let friendlyExplanation = '';

  // 1. Erros de Permissão / Acesso Negado (Firebase Realtime Database / Firestore / Security Rules)
  if (
    lowerMsg.includes('permission_denied') ||
    lowerMsg.includes('permission denied') ||
    code === 'PERMISSION_DENIED' ||
    code === 'permission-denied'
  ) {
    friendlyExplanation =
      'Permissão negada pelo sistema. Esta ação requer privilégios de Administrador ou sua sessão precisa ser renovada. Se você é o administrador, certifique-se de que seu usuário está cadastrado como administrador no Firebase e que as Regras de Segurança foram publicadas.';
  }
  // 2. Erros de Autenticação (Firebase Auth)
  else if (code === 'auth/email-already-in-use' || lowerMsg.includes('email-already-in-use')) {
    friendlyExplanation = 'Este e-mail já está cadastrado no sistema. Se esqueceu a senha, use a opção de recuperação.';
  } else if (code === 'auth/invalid-email' || lowerMsg.includes('invalid-email')) {
    friendlyExplanation = 'O formato do e-mail informado é inválido. Por favor, verifique a digitação.';
  } else if (code === 'auth/weak-password' || lowerMsg.includes('weak-password')) {
    friendlyExplanation = 'A senha informada é muito fraca. Utilize pelo menos 6 caracteres com letras e números.';
  } else if (code === 'auth/user-not-found' || lowerMsg.includes('user-not-found')) {
    friendlyExplanation = 'Nenhuma conta encontrada com este e-mail. Verifique os dados digitados.';
  } else if (
    code === 'auth/wrong-password' ||
    lowerMsg.includes('wrong-password') ||
    code === 'auth/invalid-credential' ||
    lowerMsg.includes('invalid-credential') ||
    lowerMsg.includes('invalid login credentials')
  ) {
    friendlyExplanation = 'E-mail ou senha incorretos. Por favor, verifique suas credenciais e tente novamente.';
  } else if (code === 'auth/too-many-requests' || lowerMsg.includes('too-many-requests')) {
    friendlyExplanation = 'Muitas tentativas consecutivas. Por segurança, aguarde alguns instantes antes de tentar novamente.';
  } else if (code === 'auth/user-disabled' || lowerMsg.includes('user-disabled')) {
    friendlyExplanation = 'Esta conta de usuário foi desativada pelo administrador do sistema.';
  } else if (code === 'auth/requires-recent-login' || lowerMsg.includes('requires-recent-login')) {
    friendlyExplanation = 'Esta operação é sensível e exige que você saia e faça login novamente antes de prosseguir.';
  } else if (code === 'auth/popup-closed-by-user' || lowerMsg.includes('popup-closed-by-user')) {
    friendlyExplanation = 'A janela de autenticação foi fechada antes de concluir o processo.';
  }
  // 3. Falhas de Conexão / Rede / Offline
  else if (
    code === 'auth/network-request-failed' ||
    lowerMsg.includes('network-request-failed') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('disconnected')
  ) {
    friendlyExplanation = 'Falha na conexão com a internet. Verifique sua rede e tente novamente.';
  }
  // 4. Timeouts
  else if (lowerMsg.includes('timeout') || lowerMsg.includes('timed_out')) {
    friendlyExplanation = 'O servidor demorou para responder. Verifique sua conexão e tente novamente.';
  }
  // 5. Erros de Validação de Regras do Banco
  else if (
    lowerMsg.includes('client_prerequisite_failed') ||
    lowerMsg.includes('transaction failed') ||
    lowerMsg.includes('validation failed')
  ) {
    friendlyExplanation = 'Não foi possível validar os dados enviados. Certifique-se de que todos os campos obrigatórios foram preenchidos corretamente.';
  }
  // 6. Erros de Parâmetros / Caminho
  else if (lowerMsg.includes('path argument was an invalid path') || lowerMsg.includes('[object object]')) {
    friendlyExplanation = 'Houve uma inconsistência nos parâmetros enviados ao banco de dados.';
  }
  // 7. Genérico limpo
  else {
    const cleaned = rawMsg
      .replace(/^firebaseerror:\s*/i, '')
      .replace(/^error:\s*/i, '')
      .replace(/^uncaught\s*/i, '')
      .trim();

    friendlyExplanation = cleaned || 'Ocorreu uma falha ao processar a solicitação.';
  }

  if (actionContext) {
    return `${actionContext}: ${friendlyExplanation}`;
  }

  return friendlyExplanation;
}

