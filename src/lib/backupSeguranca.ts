/**
 * Orquestra o backup de SEGURANÇA que precede toda restauração.
 *
 * Regra de ouro: a gravação no banco só é liberada depois que o backup de segurança estiver
 * comprovadamente salvo ou o usuário confirmar que o arquivo existe.
 *
 *  - Com o seletor de arquivos (Chrome/Edge: showSaveFilePicker) o arquivo é gravado de verdade e
 *    qualquer cancelamento ou falha de gravação é detectado -> estado 'salvo'.
 *  - Sem o seletor, só resta o download comum. O navegador pode bloqueá-lo SEM lançar erro, e isso
 *    não é detectável. Por isso o resultado é 'aguardando_confirmacao': a interface precisa pedir que
 *    a pessoa confirme que o arquivo está na pasta de Downloads.
 *
 * O seletor só funciona dentro do clique do usuário; por isso é a PRIMEIRA coisa assíncrona aqui,
 * antes de qualquer leitura do banco.
 */

export interface BackupGeradoSeguranca {
  jsonBlob: Blob;
  filename: string;
  backupPkg: { metadata: { leiturasIncompletas?: string[] } };
}

export interface DependenciasSeguranca {
  /** window.showSaveFilePicker, quando existir. */
  seletor?: (opcoes: any) => Promise<any>;
  sugestaoNome: string;
  verificarAdmin: () => Promise<boolean>;
  /** Chamado quando começa a gerar o backup (para a tela mostrar o progresso). */
  aoIniciarGeracao?: () => void;
  gerarBackup: () => Promise<BackupGeradoSeguranca>;
  /** Download comum; deve lançar erro se não conseguir iniciá-lo. */
  baixar: (blob: Blob, nomeArquivo: string) => void;
  mensagemErro: (err: any, padrao: string) => string;
}

export type ResultadoSeguranca =
  | { estado: 'salvo'; descricao: string; aviso: string }
  | { estado: 'aguardando_confirmacao'; descricao: string; nomeArquivo: string; tamanhoKB: number; aviso: string }
  | { estado: 'cancelado'; motivo: string }
  | { estado: 'sem_permissao' };

export async function prepararBackupDeSeguranca(dep: DependenciasSeguranca): Promise<ResultadoSeguranca> {
  // 1) Seletor de arquivos: PRIMEIRA operação assíncrona (precisa do clique do usuário)
  let handle: any = null;
  if (dep.seletor) {
    try {
      handle = await dep.seletor({
        suggestedName: dep.sugestaoNome,
        types: [{ description: 'Backup JSON', accept: { 'application/json': ['.json'] } }]
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { estado: 'cancelado', motivo: 'Você cancelou a escolha do local do backup de segurança.' };
      }
      // Seletor indisponível neste contexto (ex.: exige gesto do usuário, iframe): usa o download comum
      handle = null;
    }
  }

  // 2) Permissão
  if (!(await dep.verificarAdmin())) return { estado: 'sem_permissao' };

  // 3) Gera o backup do estado ATUAL
  dep.aoIniciarGeracao?.();
  let gerado: BackupGeradoSeguranca;
  try {
    gerado = await dep.gerarBackup();
    if (!gerado.jsonBlob || gerado.jsonBlob.size === 0) throw new Error('O backup de segurança foi gerado vazio.');
  } catch (err: any) {
    return {
      estado: 'cancelado',
      motivo: `Não foi possível gerar o backup de segurança do estado atual. ${dep.mensagemErro(err, 'Tente novamente.')}`
    };
  }

  const incompletas = gerado.backupPkg.metadata.leiturasIncompletas || [];
  const aviso =
    incompletas.length > 0 ? `\n\n⚠️ O backup de segurança ficou INCOMPLETO (não constam: ${incompletas.join('; ')}).` : '';
  const tamanhoKB = Math.max(1, Math.round(gerado.jsonBlob.size / 1024));

  // 4a) Gravado pelo seletor: verificado
  if (handle) {
    try {
      const gravavel = await handle.createWritable();
      await gravavel.write(gerado.jsonBlob);
      await gravavel.close();
    } catch (err: any) {
      return {
        estado: 'cancelado',
        motivo: `Não foi possível gravar o backup de segurança no local escolhido. ${dep.mensagemErro(err, 'Tente novamente.')}`
      };
    }
    return { estado: 'salvo', descricao: `${handle.name || dep.sugestaoNome} (${tamanhoKB} KB)`, aviso };
  }

  // 4b) Download comum: NÃO verificável -> exige confirmação humana
  const nomeArquivo = `ANTES-DA-RESTAURACAO-${gerado.filename}`;
  try {
    dep.baixar(gerado.jsonBlob, nomeArquivo);
  } catch (err: any) {
    return {
      estado: 'cancelado',
      motivo: `Não foi possível iniciar o download do backup de segurança. ${dep.mensagemErro(err, 'Tente novamente.')}`
    };
  }
  return {
    estado: 'aguardando_confirmacao',
    descricao: `${nomeArquivo} (${tamanhoKB} KB)`,
    nomeArquivo,
    tamanhoKB,
    aviso
  };
}
