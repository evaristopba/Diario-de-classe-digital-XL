# 📚 Diário de Classe Digital - Gestão Pedagógica e Escolar Completa

Sistema completo para professores, bibliotecários e administradores escolares gerenciarem **Chamadas, Notas Bimestrais, Planos de Aula (BNCC), Biblioteca Escolar (Livros e Empréstimos), Ocorrências Disciplinares, Relatórios (PDF/Excel), Grade Curricular e Rotina de Backup/Restauração**.

---

## ✨ Principais Funcionalidades

- **Controle de Chamadas (Frequência) & Relatórios de Assiduidade**:
  - Registro diário rápido com presença, falta, falta justificada, histórico de aulas e cálculo automático de percentual de frequência.
  - **Ata de Frequência Bimestral**: emissão em PDF e Excel com número de chamada (`Nº`), opções modulares de exibição (`RA`, `% Ausência` e `Status`) e exclusão automática de transferidos por padrão.
  - **Ranking de Faltas / Absenteísmo**: classificação por ordem decrescente de faltas, mantendo a posição e o número de chamada (`Nº`), com foco em busca ativa pedagógica e chave para incluir transferências de saída quando necessário.
- **Notas, Avaliações e Boletins Escolares (Bimestral e Anual Consolidado)**:
  - **Documentação Detalhada**: Consulte o guia completo em [`MANUAL_BOLETIM.md`](./MANUAL_BOLETIM.md) (inclui seção sobre Atas de Frequência e Ranking de Faltas).
  - **Boletim por Bimestre**: Emissão de notas individuais por estudante no 1º, 2º, 3º ou 4º bimestre em visão geral multi-disciplinar (formato paisagem) ou por componente específico (formato retrato).
  - **Ordem Curricular Personalizável (1, 2, 3...)**: Definição da ordem numérica exata de apresentação das matérias nos boletins do Ensino Fundamental I com atalho para a sequência padrão da BNCC (1º Língua Portuguesa a 10º Computação).
  - **Customizações Oficiais**: Opções de exibição de R.A. do aluno e anexo detalhado das habilidades e conteúdos da BNCC trabalhados no ciclo.
  - **Boletim Anual Consolidado**: Compilação automática dos 4 bimestres, cálculo da média anual e tratamento de estudantes transferidos (`TR. EXP.` / `TR. REC.`).
  - **Ficha Individual do Aluno**: Visão 360º com notas, faltas, ocorrências e leituras da biblioteca em documento único.
  - **Formatos Duplos**: Exportação com 1 clique para PDF diagramado para impressão/assinatura ou planilhas Excel (.xlsx) prontas para análise da secretaria escolar.
- **Planos de Aula & BNCC**: Criação e acompanhamento de planos de aula integrados com as 616 habilidades da Base Nacional Comum Curricular (BNCC e BNCC Computação), com sincronização atômica no Firebase que preserva as chaves existentes (IDs) e todos os planos de aula históricos.
- **Biblioteca Escolar & Cantinho da Leitura (Acervo Integrado & Descentralizado)**:
  - **Documentação Detalhada**: Consulte o guia completo em [`MANUAL_BIBLIOTECA.md`](./MANUAL_BIBLIOTECA.md).
  - **Cadastro Rápido com Leitura Visual (IA Gemini Vision)**: fotografe a capa frontal e a contracapa da obra e a IA extrai automaticamente título, autor(a), ilustrador, editora, ano, gênero, sinopse e código ISBN, com limpeza automática de dados residuais entre leituras. O ISBN é validado pelo dígito verificador, cruzado com o código de barras lido no aparelho e conferido na CBL/Google Books; qualquer dúvida aparece como aviso na tela.
  - **Busca Instantânea por ISBN**: integração com APIs do Google Books e OpenLibrary para autopreenchimento imediato de todos os dados e carregamento da capa oficial.
  - **Gestão de Acervo Multi-Escola & Distribuição**: suporte a cadastros unificados no modelo Obra Mestra vs. Exemplares Físicos Locais (`copiesBySchool`), distribuição simultânea de remessas para múltiplas escolas no momento do cadastro e detecção inteligente em tempo real de obras pré-existentes para evitar duplicações.
  - **Circulação & Empréstimos**: empréstimo direto para alunos por turma, controle automático de prazos de devolução, detecção de atrasos em tempo real, renovação rápida com 1 clique (+7 dias) e identificação visual do destino físico do exemplar no momento da devolução.
  - **Cantinho da Leitura em Sala de Aula**: extensão pedagógica na sala com segregação patrimonial atômica (sem debitar a biblioteca central durante os empréstimos aos alunos da turma), seletor de turmas agrupado por escola (`<optgroup>`), badge contextual inteligente (`🏫 Escola • 🎓 Turma` em rede completa e apenas `🎓 Turma` quando filtrado por unidade) e rastreabilidade sutil nas tabelas sem poluição visual.
  - **Remanejamento de Obras**: transferência documentada de exemplares entre bibliotecas de diferentes escolas da rede com histórico e motivo.
  - **Histórico & Auditoria**: rastreabilidade completa de leituras concluídas e movimentações físicas entre unidades.
  - **Exportações Gerenciais**: inventários e relatórios em Excel (.xlsx) e comprovantes de empréstimo formatados para impressão em PDF.
- **Ocorrências e Eventos Pedagógicos (Individual e em Lote)**:
  - **Documentação Detalhada**: Consulte o guia completo em [`MANUAL_OCORRENCIAS.md`](./MANUAL_OCORRENCIAS.md).
  - **Lançamento Ágil em Lote**: seleção rápida de múltiplos estudantes com botões de ação imediata (`Todos`, `Nenhum` e `Inverter`), busca instantânea por nome ou número com marcação de filtrados e chips visuais com remoção rápida (`×`).
  - **Aplicação Pedagógica Coletiva**: ideal tanto para ocorrências positivas (ex.: *alunos que terminaram a atividade*, selecionando todos e desmarcando as exceções) quanto negativas/específicas (ex.: *alunos sem material*).
  - **Integração Estrita com a Chamada (Controle de Frequência)**: bloqueio pedagógico de ocorrências caso a chamada da data ainda não tenha sido realizada; o botão `Todos Presentes` seleciona exclusivamente quem estava em sala, evitando apontamentos acidentais em massa, mas permitindo inclusão pontual e consciente de estudantes ausentes mediante confirmação (ex.: falta em prova, atestado ou recado da família), com carimbo visual `⚠️ Ausente na data` no histórico.
  - **Filtro por Período & Exclusão em Lote no Histórico**: filtro avançado por intervalo de datas (`De` / `Até`) com atalho `Hoje` e ferramenta para selecionar todas as ocorrências filtradas e excluí-las em massa de forma atômica no banco de dados (ideal para correção ágil de lançamentos incorretos ou anomalias).
  - **Proteção a Transferidos**: bloqueio automático de lançamentos para alunos com transferência expedida (`TR. EXP.`), preservando histórico.
- **Gestão de Escolas, Turmas, Professores & Alunos (com Transferência & Reingresso Inteligente)**:
  - Controle de acesso segregado entre Administrador, Professor e Bibliotecário, com integridade referencial estrita.
  - Cadastro de estudantes com histórico de transferências (`TR. EXP.` e `TR. REC.`).
  - **Vínculo Oficial entre Linhas (`transferidoDe`) & Busca Cross-Turma por RA**: rastreamento direto da linha anterior de onde o estudante veio, com fallback para busca pelo mesmo RA em qualquer turma da escola ou da rede municipal.
  - **Transposição Integral de Notas Multi-Docente**: ao transferir, o sistema migra todas as notas de todos os professores e componentes curriculares para a nova matrícula como "nota de origem", sem perda de notas de professores especialistas.
  - **Regra de Desempate na Consolidação de Notas (sem depender de calendário)**: ao reunir as notas de várias linhas anteriores, a nota lançada direto vence a cópia de origem; entre notas do mesmo tipo, vale a da linha mais recente. O resultado não depende da ordem de leitura, e nota direta do destino nunca é sobrescrita.
  - **Proteção de Identidade na Migração por RA**: linhas achadas só pelo RA migram notas automaticamente apenas se o nome ou a data de nascimento conferirem; RA curto ou repetido ("0", "000000") não vincula. Nos demais casos o sistema avisa e exige a conferência manual (botão `Puxar Notas`).
  - **Preservação Definitiva de Notas**: eliminação de exclusões automáticas no salvamento de notas; avaliações de alunos com `TR. EXP.` são mantidas intactas.
  - **Fluxo de Reingresso Assistido & Auditoria Cadastral**: comparação em tempo real entre o registro de saída e o de reingresso (Nome, Nascimento e RM), com painel comparativo lado a lado e alertas na tela de notas.
  - **Frequência Normativa & Localizador de Chamadas Dia a Dia**: bloqueio de presenças anteriores à data de reingresso para alunos `TR. REC.`, ferramenta de 1 clique para purga de presenças indevidas e navegador interativo com pílulas de datas de chamada no bimestre.
- **Grade de Horários Semanal (Regentes e Especialistas)**:
  - Grade de segunda a sexta, com 5 aulas por turno, sinais por turno e grupo de intervalo (A/B) e alocação de professores especialistas por disciplina, com verificação de choque de horário (não bloqueante) e respeito aos dias disponíveis de cada professor. Permite bloco dobrado de 2 aulas, ajuste de horário com observação e **subir/descer aula** com permuta (essa alteração muda a grade semanal da turma até ser desfeita).
  - **Montagem e ajustes são exclusivos do administrador**; professores consultam e imprimem. As regras do banco restringem a escrita em `turmas` a administradores, então não há regra específica para a grade.
  - A grade fica em `turmas/{id}/gradeHoraria/{dia}_{ordem}` e é gravada **horário a horário**, para que edições simultâneas não se sobrescrevam. O backup também a restaura horário a horário, sem apagar nada.
- **Apresentação Executiva & Pitch para Secretário(a) de Educação (Exclusivo Administrador)**:
  - **Módulo Estratégico de Pitch**: Apresentação interativa estruturada nos 5 pilares fundamentais da gestão pública (Economia de Papel, Gestão Centralizada Multi-Escola, Agilidade Docente em Sala, Fomento ao IDEB com Leitura e Soberania dos Dados).
  - **Assistente de Gravação de Vídeo Institucional**: Teleprompter integrado com cronômetro em tempo real, sugestões de roteiro por formato (Vídeo Completo de 3 a 4 min, Reels/Instagram de 60 a 90s, e Pílulas de Recursos de 30s), dicas técnicas e sugestões de legendas para redes sociais.
  - **Botões de Demonstração Ao Vivo**: Atalhos para saltar diretamente para os módulos em tempo real durante a gravação ou reunião.
  - **Gerador de Proposta Formal em PDF**: Exportação de proposta de modernização pedagógica em PDF com comparativo de custos e impacto municipal pronta para entrega à Secretaria.
- **Relatórios Gerenciais**: Exportação para PDF formatado para impressão e planilhas Excel (.xlsx) de notas, presenças, planos e fichas de alunos.
- **Rotina de Backup & Restauração Completa**:
  - Exportação e importação de backups em arquivo JSON. O backup de **administrador** é completo: escolas, turmas e alunos, professores, atribuições, disciplinas, BNCC, categorias, tipos de ocorrência, configurações, permissões (administradores e bibliotecários), biblioteca inteira (livros, acervo por escola, empréstimos, reservas, movimentações e Cantinho da Leitura) e os dados pedagógicos de todos os professores. O backup de quem não é administrador é **parcial**, e o próprio arquivo registra o que não pôde ser lido (`escopo` e `leiturasIncompletas`).
  - Restauração granular seletiva, módulo a módulo, **sempre registro a registro e sem apagar nada**: o que existe no banco e não está no backup permanece. Não serve como reversão destrutiva (registros criados depois do backup continuam no banco).
    - **Mesclar** (padrão): cria o que falta e só atualiza um registro existente quando o do backup é comprovadamente mais recente (`updatedAt`, senão `createdAt`). Registros que diferem mas não têm data nos dois lados são mantidos como estão no banco (escolas, disciplinas, notas e chamadas, por exemplo, não têm `updatedAt`). Para aplicá-los, use a Substituição.
    - **Substituição**: nos módulos marcados, grava a versão do backup por cima dos registros de mesmo ID, mesmo que o banco tenha versão mais recente. A prévia informa quantos registros mais recentes seriam sobrescritos.
    - As **permissões** (administradores e bibliotecários) só são restauradas se a opção for marcada explicitamente, pois concedem acesso. Os dados pedagógicos voltam ao professor que os gerou.
  - Antes de qualquer gravação, o sistema mostra uma **prévia** (novos, atualizados e mantidos por módulo) e exige um **backup de segurança do estado atual**. Em Chrome/Edge o arquivo é gravado pelo seletor de arquivos e a falha é detectada. Nos demais navegadores o download pode ser bloqueado sem aviso, então o sistema pede a confirmação de que o arquivo existe antes de liberar a restauração.
  - Fora do escopo do backup: as contas de login (Firebase Authentication). Os dados são amarrados ao `uid` de cada usuário, então, ao recuperar em um projeto novo, as contas precisam existir com os mesmos `uid`.
  - Verificação de integridade e metadados com contadores em tempo real.
- **Disponibilidade Offline e Pacote Autônomo**: Suporte a arquivo único HTML (`app-unico.html`) para uso direto no navegador sem necessidade de servidor Node.js.

---

## 🚀 Como Subir para o GitHub e Fazer Deploy na Vercel

### Opção 1: Projeto Completo (React + Vite + Tailwind) - Recomendado

#### Passo 1: Criar o Repositório no GitHub
1. Acesse [github.com](https://github.com) e crie um novo repositório (ex: `diario-de-classe`).
2. No seu computador, descompacte o arquivo `diario-de-classe-projeto.zip`.
3. Abra o terminal na pasta do projeto e execute:
```bash
git init
git add .
git commit -m "feat: publicacao do diario de classe digital"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

#### Passo 2: Publicar na Vercel (1 Clique)
1. Acesse [vercel.com](https://vercel.com) e faça login com sua conta do GitHub.
2. Clique em **"Add New..."** > **"Project"**.
3. Selecione o repositório `diario-de-classe` que acabou de subir.
4. A Vercel detectará automaticamente o framework como **Vite**. O arquivo `vercel.json` já define tudo (não altere):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build:web` (somente o front-end; o servidor Express é usado só em desenvolvimento / AI Studio)
   - **Output Directory**: `dist`
   - As funções da pasta `api/` (leitura de capas por IA e busca por ISBN) são publicadas automaticamente como *Vercel Functions* com limite de 60 s.
5. **Antes de clicar em Deploy**, abra **Environment Variables** e crie:
   - `GEMINI_API_KEY` = sua chave do [Google AI Studio](https://aistudio.google.com/apikey) *(obrigatória para a leitura de capa/contracapa por IA)*
   - `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` *(opcional; variáveis `VITE_*` são lidas no build)*
6. Clique em **Deploy**. Em menos de 1 minuto seu Diário de Classe estará online em HTTPS com domínio gratuito (`.vercel.app`)!
7. Confira a instalação abrindo `https://SEU-PROJETO.vercel.app/api/health` — deve responder `{"status":"ok","hasGeminiKey":true,...}`. Se `hasGeminiKey` vier `false`, a variável não foi definida (ou o deploy foi feito antes dela): crie a variável e use **Redeploy**.

---

### Opção 2: Versão em Arquivo Único (`app-unico.html`)

Você também pode utilizar o arquivo **`app-unico.html`** (localizado em `public/app-unico.html` ou baixado diretamente pelo painel):
- Todo o HTML, CSS (Tailwind) e JavaScript (React + Lucide + Firebase) estão compilados em **um único arquivo autossuficiente**.
- Pode ser aberto diretamente no navegador (dando duplo clique no arquivo), hospedado no **GitHub Pages**, ou servido em qualquer CDN / hospedagem estática básica sem precisar de servidor Node.js.
- ⚠️ Nessa versão **não há servidor**: a leitura de capa/contracapa por IA não funciona (a busca por ISBN usa o fallback direto no navegador). Para ter a IA, use a Opção 1 (Vercel).

---

## ⚙️ Configuração do Firebase Realtime Database

Para que o sistema salve os dados corretamente:
1. Acesse o [Firebase Console](https://console.firebase.google.com/).
2. Vá em **Authentication** > **Sign-in method** e habilite **E-mail/Senha**.
3. Vá em **Realtime Database** > aba **Regras** (Rules).
4. Copie o conteúdo do arquivo `database.rules.json` (ou visualize diretamente pelo botão no painel de administração do sistema) e clique em **Publicar**.

As regras de segurança (`database.rules.json` - 245 linhas) protegem todas as coleções segundo o princípio do menor privilégio (RBAC e vinculação estrita de turmas):
- `escolas`, `turmas`, `disciplinas`, `professores`, `admins`, `bibliotecarios`
- `chamada`, `notas`, `planos-aula`, `ocorrencias`
- `biblioteca`:
  - `livros` e `acervos`: patrimônio blindado para admins, bibliotecários e professores com delegação (`canManageLibrary`).
  - `emprestimos`: professores só operam empréstimos para alunos de turmas atribuídas a eles.
  - `cantinhos`: alocação e movimentação em sala restrita a turmas atribuídas.
  - `reservas` e `movimentacoes`: histórico e transferências documentadas.
- Validação contábil (Ledger): auditoria de exemplares em tempo real contra reservas fantasmas ou concorrência.

---

## 🔑 Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GEMINI_API_KEY` | Sim (para IA) | Chave do Google AI Studio. Sem ela, a leitura por fotos e a complementação por IA ficam desativadas. |
| `GEMINI_SCAN_MODELS` | Não | Modelos da leitura de fotos, do preferido ao último recurso, separados por vírgula. Padrão: `gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite`. |
| `GEMINI_TEXT_MODELS` | Não | Modelos usados só para complementar dados por texto (rota de ISBN). |
| `GOOGLE_BOOKS_API_KEY` | Não | Evita limite de requisições na consulta por ISBN em hospedagem compartilhada. |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | Não | Ativa o selo Turnstile no login (lida no build). |

Em desenvolvimento local, copie `.env.example` para `.env` e preencha.

---

## 🩺 Solução de Problemas — Leitura por IA

- **"O serviço de leitura por IA não foi encontrado neste servidor"**: o deploy não incluiu a pasta `api/` (confira se ela está no repositório) — abra `/api/health` para testar.
- **"A chave GEMINI_API_KEY não está configurada"**: crie a variável na Vercel e faça **Redeploy** (variáveis só valem para deploys novos).
- **Mensagem de ISBN descartado / campos incertos**: a foto está borrada, com reflexo ou cortada. Refaça a foto da contracapa de frente, com boa luz, com o código de barras inteiro no quadro.
- **"Fotos grandes demais" (HTTP 413)**: a Vercel limita cada requisição a ~4,5 MB. O sistema já comprime as fotos; se ocorrer, use fotos de resolução menor.
- **"Alta demanda" / limite de uso**: aguarde alguns segundos; o sistema já tenta automaticamente outros modelos da lista `GEMINI_SCAN_MODELS`.

---

## 🛠️ Comandos Disponíveis

- `npm run dev`: Inicia o servidor de desenvolvimento local na porta 3000.
- `npm run build`: Compila o front-end e o servidor Express (`dist/server.cjs`) para hospedagem Node.
- `npm run build:web`: Compila apenas o front-end para `dist/` (é o que a Vercel executa).
- `npm run build:singlefile`: Gera o executável único `public/app-unico.html`.
- `npm run pack`: Gera os pacotes de distribuição ZIP (`public/diario-de-classe-projeto.zip`) e o HTML único atualizado.
- `npm run lint`: Valida tipagens e sintaxe TypeScript.
