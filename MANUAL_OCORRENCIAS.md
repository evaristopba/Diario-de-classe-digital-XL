# 📋 Manual Operacional & Técnico - Ocorrências & Eventos Pedagógicos

Este manual detalha todas as funcionalidades, fluxos operacionais, regras pedagógicas e arquitetura técnica do módulo de **Eventos & Ocorrências** do Diário de Classe Digital, incluindo o **lançamento em lote**, **sincronização de data com o servidor** e **gestão de revisões individuais**.

---

## 📑 Sumário

1. [Visão Geral do Módulo](#1-visão-geral-do-módulo)
2. [Lançamento de Ocorrências em Lote](#2-lançamento-de-ocorrências-em-lote)
   - [2.1 Por que lançar em lote?](#21-por-que-lançar-em-lote)
   - [2.2 Ferramentas de Seleção Rápida](#22-ferramentas-de-seleção-rápida)
   - [2.3 Busca e Filtro Local de Alunos](#23-busca-e-filtro-local-de-alunos)
   - [2.4 Chips de Visualização e Remoção Rápida](#24-chips-de-visualização-e-remoção-rápida)
   - [2.5 Exemplos Práticos de Aplicação](#25-exemplos-práticos-de-aplicação)
3. [Integração Estrita com a Chamada (Controle de Frequência)](#3-integração-estrita-com-a-chamada-controle-de-frequência)
   - [3.1 Bloqueio Pedagógico: Chamada como Pré-Requisito Obrigatório](#31-bloqueio-pedagógico-chamada-como-pré-requisito-obrigatório)
   - [3.2 Por que o botão "Todos" seleciona apenas alunos presentes?](#32-por-que-o-botão-todos-seleciona-apenas-alunos-presentes)
   - [3.3 Identificação Visual e Bloqueio de Alunos Ausentes](#33-identificação-visual-e-bloqueio-de-alunos-ausentes)
   - [3.4 Atalho Rápido para a Chamada](#34-atalho-rápido-para-a-chamada)
4. [Sincronização Contínua de Data e Fuso Horário](#4-sincronização-contínua-de-data-e-fuso-horário)
   - [4.1 Correção do Fuso Horário (Prevenção do Salto às 21h)](#41-correção-do-fuso-horário-prevenção-do-salto-às-21h)
   - [4.2 Sincronização via `.info/serverTimeOffset` do Firebase](#42-sincronização-via-infoservertimeoffset-do-firebase)
   - [4.3 Botão "Definir Hoje / Hoje ✓"](#43-botão-definir-hoje--hoje-)
   - [4.4 Atualização Automática ao Focar a Aba](#44-atualização-automática-ao-focar-a-aba)
5. [Filtro por Período, Revisão e Exclusão (Individual e em Lote)](#5-filtro-por-período-revisão-e-exclusão-individual-e-em-lote)
   - [5.1 Filtro Dinâmico por Período (Data Inicial e Final)](#51-filtro-dinâmico-por-período-data-inicial-e-final)
   - [5.2 Exclusão Pontual de um Aluno](#52-exclusão-pontual-de-um-aluno)
   - [5.3 Exclusão em Lote no Histórico (Correção de Lançamentos Incorretos)](#53-exclusão-em-lote-no-histórico-correção-de-lançamentos-incorretos)
   - [5.4 Modo de Edição Individual](#54-modo-de-edição-individual)
6. [Integridade Referencial e Transferências](#6-integridade-referencial-e-transferências)
   - [6.1 Bloqueio de Alunos com Transferência Expedida (TR. EXP)](#61-bloqueio-de-alunos-com-transferência-expedida-tr-exp)
   - [6.2 Identificação de Transferência Recebida (TR. REC)](#62-identificação-de-transferência-recebida-tr-rec)
7. [Integração com Relatórios e Ficha Individual](#7-integração-com-relatórios-e-ficha-individual)
8. [Segurança e Regras no Firebase Realtime Database](#8-segurança-e-regras-no-firebase-realtime-database)

---

## 1. Visão Geral do Módulo

O módulo **Eventos & Ocorrências** foi concebido para dar suporte ao registro pedagógico, comportamental e formativo do cotidiano escolar. 

Ele permite que professores e gestores registrem acontecimentos relevantes com:
- **Turma e Bimestre**: Contextualização no ciclo de avaliação.
- **Data Precisa**: Alinhada com o calendário escolar e o relógio oficial do servidor.
- **Tipo de Evento**: Categorias customizáveis (ex.: *Participação Destacada*, *Tarefa Não Realizada*, *Falta de Material*, *Elogio Pedagógico*, *Convivência Escolar*, etc.) com cores identificadoras.
- **Aluno(s) Envolvido(s)**: Suporte tanto a lançamentos individuais quanto a lançamentos coletivos em lote.
- **Descrição Detalhada**: Relato objetivo da ocorrência ou da intervenção pedagógica adotada.

---

## 2. Lançamento de Ocorrências em Lote

### 2.1 Por que lançar em lote?
Em salas de aula com 25 a 35 alunos, registrar ocorrências aluno por aluno exigia dezenas de repetições desnecessárias quando o fato envolvia um grupo significativo de estudantes.

Com o **Lançamento em Lote**, o professor preenche o tipo e a descrição uma única vez e seleciona os alunos envolvidos, gerando todos os registros individuais com um único clique.

### 2.2 Ferramentas de Seleção Rápida
No topo da área de seleção de alunos, encontram-se três botões de ação imediata:
- **`Todos`**: Marca instantaneamente todos os alunos ativos da turma (exclui automaticamente transferidos).
- **`Nenhum`**: Desmarca todos os alunos com um clique.
- **`Inverter`**: Inverte a seleção atual entre os alunos ativos.

Ao lado dos botões, um contador dinâmico exibe a contagem em tempo real (ex.: `24 de 28 selecionado(s)`).

### 2.3 Busca e Filtro Local de Alunos
- Campo de pesquisa inteligente: digite o **número de chamada** (ex.: `12`) ou parte do **nome** do aluno (ex.: `Lucas`) para filtrar a listagem na hora.
- Ao filtrar, botões contextuais aparecem:
  - **`Marcar Filtrados (X)`**: Adiciona todos os alunos visíveis na busca à seleção atual.
  - **`Desmarcar Filtrados`**: Remove apenas os alunos visíveis na busca da seleção atual.

### 2.4 Chips de Visualização e Remoção Rápida
Logo abaixo da grade de estudantes, o sistema exibe chips visuais contendo o número e nome de cada aluno selecionado.
- Cada chip conta com um botão **`×`** que permite remover qualquer aluno pontualmente da lista sem precisar procurá-lo na grade.
- Inclui também o botão **`Limpar seleção`** para reiniciar a escolha.

### 2.5 Exemplos Práticos de Aplicação

#### Caso A: Ocorrência Coletiva Positiva (A maioria concluiu a tarefa)
1. Selecione a Turma, Bimestre, Data e o Tipo (ex.: *Atividade Concluída em Sala*).
2. Clique no botão **`Todos`** (todos os 28 alunos ficam marcados).
3. Na lista ou nos chips, desmarque apenas os 3 alunos que não terminaram.
4. Digite a descrição e clique em **`Registrar em Lote para 25 Alunos`**.

#### Caso B: Ocorrência Pontual Negativa (Poucos alunos com pendência)
1. Selecione a Turma, Bimestre, Data e o Tipo (ex.: *Sem Material Didático*).
2. Clique diretamente nos cartões dos 4 alunos correspondentes.
3. Digite a descrição e clique em **`Registrar em Lote para 4 Alunos`**.

---

## 3. Integração Estrita com a Chamada (Controle de Frequência)

A integridade pedagógica e documental exige que **alunos ausentes em determinada data não recebam ocorrências de sala de aula**. O Diário de Classe Digital vincula o módulo de ocorrências diretamente à lista de presença da turma.

### 3.1 Bloqueio Pedagógico: Chamada como Pré-Requisito Obrigatório
- O sistema consulta em tempo real o nó de chamadas (`diario-classe/dados/{uid}/chamada`) para a turma, bimestre e data informados.
- **Se a chamada da data ainda não tiver sido salva**, o formulário exibe um alerta de bloqueio e desativa o botão de salvar:
  > *"⛔ Chamada Não Realizada Nesta Data: Para assegurar a integridade dos registros escolares e impedir anotações para quem não veio à aula, é obrigatório realizar a chamada desta turma antes de lançar qualquer ocorrência."*
- Essa barreira elimina por completo o risco de imputar fatos a estudantes que sequer compareceram à escola no dia.

### 3.2 Por que o botão "Todos Presentes" seleciona apenas alunos presentes?
Ao clicar no botão de ação rápida **`Todos Presentes`**:
- O sistema calcula quais alunos estavam **efetivamente presentes** (`status: 'P'`) na chamada da data.
- **Apenas os alunos presentes são marcados automaticamente**.
- Alunos com falta (`status: 'F'`) ou falta justificada (`status: 'FJ'`) permanecem desmarcados e protegidos contra apontamentos coletivos por engano.
- Um banner explicativo no topo da grade detalha a quantidade de presentes e ausentes, elucidando transparentemente a distinção entre a seleção coletiva e a inclusão pontual.

### 3.3 Lançamento Pontual Consciente para Alunos Ausentes
Existem situações pedagógicas legítimas em que uma ocorrência precisa ser registrada para um aluno que faltou (ex.: *perda de prova bimestral*, *entrega de atestado médico*, *justificativa trazida pelos responsáveis*, *ocorrência disciplinar no portão antes da aula*).

Para atender a esses casos sem comprometer a segurança da turma:
- **Proteção em Massa**: O botão coletivo *"Todos Presentes"* **nunca** marca quem faltou.
- **Seleção Pontual Manual**: Se o professor clicar diretamente sobre o cartão de um aluno ausente, o sistema exibe uma janela de confirmação consciente:
  > *"O(A) estudante [Nome] constava com [falta/falta justificada] na chamada do dia DD/MM/AAAA. Deseja incluir este aluno nesta ocorrência específica? (Ex: falta em avaliação/trabalho, entrega de atestado médico, justificativa de ausência ou comunicação aos responsáveis)"*
- **Transparência e Respaldo**: Ao confirmar a inclusão, o aluno é selecionado com badge âmbar `⚠️ Ausente (Pontual)`. Ao salvar, a ocorrência recebe os atributos `absentOnDate: true` e `studentAttendanceStatus`, exibindo no histórico o selo informativo:
  `⚠️ Ausente na data (Faltou / Falta Just.)`.
- **Independência dos Registros**: A ocorrência afeta **exclusivamente os alunos selecionados**. O restante da turma permanece 100% inalterado.

### 3.4 Atalho Rápido para a Chamada
Quando uma data sem chamada for selecionada, o sistema exibe o botão **`Ir para a Chamada Desta Turma`**, que redireciona o professor diretamente para a tela de frequência da turma para concluir a lista de presença com agilidade.

---

## 4. Sincronização Contínua de Data e Fuso Horário

### 4.1 Correção do Fuso Horário (Prevenção do Salto às 21h)
Anteriormente, sistemas web que utilizam `new Date().toISOString()` convertem o horário local para UTC (Greenwich). No Brasil (fuso UTC-3), a partir das 21h00 o horário UTC já pertence ao dia seguinte, fazendo o formulário saltar inadvertidamente para "amanhã".

A nova arquitetura utiliza componentes locais sincronizados (`getFullYear()`, `getMonth()`, `getDate()`), garantindo que **a data selecionada sempre seja a data correta do fuso local**.

### 4.2 Sincronização via `.info/serverTimeOffset` do Firebase
O sistema escuta em tempo real o nó de metadados `.info/serverTimeOffset` do Firebase Realtime Database. 
- O offset compensa eventuais descompassos do relógio do aparelho do usuário com o servidor de banco de dados.
- A função central `getTodayDateString()` garante que a data utilizada seja rigorosamente a data oficial.

### 4.3 Botão "Definir Hoje / Hoje ✓"
Ao lado do campo **Data \***, o professor conta com um botão contextual:
- **`Hoje ✓`** (Verde): Indica que a data informada é a data atual do servidor.
- **`Definir Hoje`** (Índigo): Se o professor tiver selecionado uma data retroativa ou futura e quiser retornar ao dia de hoje, basta clicar neste botão.

### 4.4 Preservação da Escolha do Professor (Sem Sobrecarga por Timers)
- Uma vez selecionada uma data pelo professor (seja ela retroativa, presente ou futura), o sistema **respeita rigorosamente a escolha** e não sobrepõe a data por meio de timers periódicos ou eventos de foco da janela.
- O campo só é redefinido automaticamente para o dia de hoje após a conclusão bem-sucedida de um cadastro (`handleSubmit`) ou ao cancelar o modo de edição.
- Para retornar imediatamente à data de hoje, basta um clique no botão **`Definir Hoje`**.

---

## 5. Filtro por Período, Revisão e Exclusão (Individual e em Lote)

Mesmo quando as ocorrências são lançadas em lote, **cada ocorrência é gravada como um registro independente no Firebase Realtime Database**. Isso oferece total flexibilidade para manutenções preventivas, revisões ou correções em massa de lançamentos incorretos.

### 5.1 Filtro Dinâmico por Período (Data Inicial e Final)
Para evitar redundâncias e dar máxima amplitude à consulta, a listagem conta com o seletor de **Período**:
- **Data Inicial e Data Final**: Permite delimitar qualquer intervalo de dias (ex.: de `15/10/2026` até `22/10/2026`).
- **Data Específica**: Se o professor preencher a mesma data nos dois campos (ou clicar no botão rápido **`Hoje`**), o sistema filtra pontualmente as ocorrências daquele dia.
- **Botão `Hoje`**: Preenche instantaneamente a data de hoje tanto no início quanto no fim do período.
- **Botão `Limpar` (`X`)**: Remove o filtro temporal para voltar a exibir o histórico completo do bimestre.
- **Filtros Combinados**: O filtro por período atua em conjunto com os filtros de **Turma**, **Bimestre** e a barra de **Busca Textual** em tempo real.

### 5.2 Exclusão Pontual de um Aluno
Se apenas um aluno foi selecionado por engano durante um lançamento coletivo:
1. Localize a ocorrência daquele aluno na listagem.
2. Clique no ícone de **Lixeira (Excluir)** presente no cartão daquele estudante.
3. O modal de confirmação solicitará a autorização.
4. Ao confirmar, **apenas o registro daquele aluno é apagado**. Todas as ocorrências dos demais colegas permanecem intactas.

### 5.3 Exclusão em Lote no Histórico (Correção de Lançamentos Incorretos)
Caso ocorra uma anomalia operacional ou um lote inteiro tenha sido registrado erroneamente (por exemplo, data errada, descrição incorreta atribuída à turma inteira ou tipo indevido):
1. **Filtre as Ocorrências**: Use o seletor de **Período** (ou botão **`Hoje`**), a **Turma** e o **Bimestre** para isolar exatamente os registros desejados.
2. **Reavaliação Contínua com os Filtros Ativos**:
   - A seleção para exclusão é estritamente vinculada aos itens visíveis.
   - Ao alterar qualquer filtro (Turma, Bimestre, Período ou Busca), o sistema **reavalia a seleção em tempo real**, descartando registros que deixaram de atender aos critérios.
   - Isso elimina qualquer risco de contagens incorretas ou exclusões acidentais de registros ocultos.
3. **Selecione os Registros**:
   - Clique em **`Marcar Visíveis (X)`** para selecionar de uma só vez todas as ocorrências exibidas no filtro atual.
   - O contador informa com precisão: `{X} de {Y} visíveis selecionada(s)`.
   - Opcionalmente, desmarque pontualmente quem não deve ser excluído ou use **`Desmarcar`**.
4. **Exclua em Lote com Confirmação Segura**:
   - Clique no botão vermelho **`Excluir {X} Selecionada(s) no Filtro Atual`**.
   - O modal de confirmação atesta a quantidade exata de registros que serão removidos de forma atômica no banco de dados.
   - O botão **`Excluir X Selecionada(s) em Lote`** será exibido em destaque avermelhado.
   - O modal de segurança confirma a quantidade exata de registros a serem eliminados.
   - Ao confirmar, o sistema realiza uma gravação atômica direta no Firebase Realtime Database removendo todos os registros de uma só vez, limpando a base sem deixar resíduos.

### 5.4 Modo de Edição Individual
1. Clique no ícone de **Lápis (Editar)** em qualquer ocorrência registrada.
2. O formulário rola suavemente para o topo e assume o **Modo de Edição Individual**:
   - O cabeçalho exibe `Editar Ocorrência` com botão `Cancelar Edição`.
   - O seletor de alunos é substituído por um menu específico mostrando o aluno atual, permitindo inclusive reatribuir para outro estudante se necessário.
   - Os campos de Turma, Bimestre, Data, Tipo e Descrição são preenchidos com os dados existentes.
   - O botão principal muda para **`Atualizar Ocorrência`**.
3. Ao salvar, apenas aquele registro é alterado no banco com marcação de `updatedAt`.

---

## 6. Integridade Referencial e Transferências

O módulo segue rigorosamente as regras do sistema escolar para alunos transferidos:

### 6.1 Bloqueio de Alunos com Transferência Expedida (TR. EXP)
- Alunos que deixaram a escola (`status: 'expedida'`) **não podem receber novas ocorrências**.
- Na grade de seleção em lote, esses alunos aparecem desabilitados, com nome tachado e a etiqueta `Expedido`, protegendo o professor contra lançamentos indevidos.
- Registros de ocorrências anteriores à transferência permanecem salvos e legíveis para efeitos de histórico escolar.

### 6.2 Identificação de Transferência Recebida (TR. REC)
- Alunos que ingressaram na turma por transferência recebida exibem a etiqueta `TR. REC`, facilitando o reconhecimento durante a seleção em sala.

---

## 7. Integração com Relatórios e Ficha Individual

Todas as ocorrências registradas (seja em lote ou individualmente) integram-se automaticamente com os relatórios gerenciais do Diário de Classe:
- **Ficha Individual do Aluno**: Seção de Ocorrências com data, tipo, bimestre e descrição completa para apresentação em conselho de classe ou reunião de responsáveis.
- **Relatório Completo da Turma**: Mapeamento do perfil pedagógico e comportamental do grupo.
- **Rotina de Backup**: Os eventos são incluídos integralmente no backup em JSON e podem ser restaurados seletivamente.

---

## 8. Segurança e Regras no Firebase Realtime Database

### Estrutura de Armazenamento
Os dados são armazenados sob o caminho:
```
diario-classe/dados/{uid}/eventos/{eventoId}
```
Campos obrigatórios de cada documento:
- `classId`: ID da turma
- `studentId`: ID do aluno
- `date`: Data no formato YYYY-MM-DD
- `description`: Texto da ocorrência
- `typeId` e `type`: Tipo e nome da ocorrência
- `bimester`: Bimestre letivo
- `teacher`: Nome do professor responsável
- `anoLetivo`: Ano de referência
- `createdAt` / `updatedAt`: Timestamps de auditoria

### Regras de Segurança (`database.rules.json`)
```json
"eventos": {
  ".indexOn": [
    "classId",
    "studentId",
    "bimester",
    "createdAt",
    "anoLetivo"
  ],
  "$eventoId": {
    ".validate": "newData.hasChildren(['classId', 'studentId', 'date', 'description'])"
  }
}
```
Como o lançamento em lote utiliza gravações atômicas respeitando a estrutura já validada das regras, **nenhuma alteração nas regras de segurança do console do Firebase foi necessária**, mantendo o sistema 100% seguro contra acessos não autorizados.
