# 📊 Manual Completo dos Boletins Escolares & Relatórios de Rendimento

Este documento fornece o guia operacional e técnico completo de todas as funcionalidades dos **Boletins Escolares (Bimestral, Anual Consolidado e Ficha Individual do Aluno)** do sistema Diário de Classe Digital.

---

## 📑 Sumário

1. [Visão Geral e Arquitetura Pedagógica](#1-visão-geral-e-arquitetura-pedagógica)
2. [Boletim por Bimestre (Bimestral)](#2-boletim-por-bimestre-bimestral)
   - [2.1 Visão Geral Multi-Disciplinar](#21-visão-geral-multi-disciplinar)
   - [2.2 Visão Específica por Componente Curricular](#22-visão-específica-por-componente-curricular)
   - [2.3 Opções de Customização (RA e Conteúdos/Habilidades BNCC)](#23-opções-de-customização-ra-e-conteúdos-habilidades-bncc)
   - [2.4 Exportação em PDF Oficial e Planilha Excel (.xlsx)](#24-exportação-em-pdf-oficial-e-planilha-excel-xlsx)
3. [Boletim Anual Consolidado](#3-boletim-anual-consolidado)
   - [3.1 Consolidação dos 4 Bimestres](#31-consolidação-dos-4-bimestres)
   - [3.2 Cálculo Automático de Médias Anuais](#32-cálculo-automático-de-médias-anuais)
   - [3.3 Gestão de Transferências (TR. REC / TR. EXP)](#33-gestão-de-transferências-tr-rec--tr-exp)
   - [3.4 Fluxo Oficial de Reingresso (Retorno de Aluno TR. EXP.)](#34-fluxo-oficial-de-reingresso-retorno-de-aluno-tr-exp)
   - [3.5 Frequência Escolar Normativa para Alunos TR. REC & Auditoria de Presenças](#35-frequência-escolar-normativa-para-alunos-tr-rec--auditoria-de-presenças)
   - [3.6 Como Encontrar e Consultar as Chamadas Dia a Dia no Sistema](#36-como-encontrar-e-consultar-as-chamadas-dia-a-dia-no-sistema)
   - [3.7 Exportações Gerenciais em PDF e Excel](#37-exportações-gerenciais-em-pdf-e-excel)
4. [Ficha Individual do Aluno & Histórico de Evolução](#4-ficha-individual-do-aluno--histórico-de-evolução)
5. [Regras de Negócio e Fórmulas de Avaliação](#5-regras-de-negócio-e-fórmulas-de-avaliação)
6. [Segurança e Regras de Acesso (Firebase Realtime Database)](#6-segurança-e-regras-de-acesso-firebase-realtime-database)
7. [Guia Passo a Passo de Emissão](#7-guia-passo-a-passo-de-emissão)
8. [Relatórios de Frequência e Ranking de Absenteísmo](#8-relatórios-de-frequência-e-ranking-de-absenteísmo)
   - [8.1 Frequência Bimestral (Ata de Frequência)](#81-frequência-bimestral-ata-de-frequência)
   - [8.2 Ranking de Faltas / Absenteísmo](#82-ranking-de-faltas--absenteísmo)
   - [8.3 Customizações (RA, % Ausência, Status e Transferências de Saída)](#83-customizações-ra--ausência-status-e-transferências-de-saída)
   - [8.4 Exportações Duplas (PDF e Excel)](#84-exportações-duplas-pdf-e-excel)

---

## 1. Visão Geral e Arquitetura Pedagógica

O módulo de Boletins e Relatórios de Rendimento do **Diário de Classe Digital** consolida os registros diários de frequência, notas de avaliações, recuperações e habilidades pedagógicas desenvolvidas ao longo do ano letivo.

### Objetivos Principais:
- **Transparência para as Famílias**: Emissão de documentos formais, claros e legíveis para entrega a pais e responsáveis em reuniões bimestrais.
- **Rigor Técnico e Contábil**: Fórmulas consistentes para evitar inconsistências em médias de turmas, componentes curriculares ou notas finais.
- **Adaptação a Redes de Ensino**: Suporte a escolas únicas ou redes municipais completas, com controle rígido de alunos transferidos e matrículas ativas.
- **Formato Duplo de Saída**: Cada relatório pode ser gerado tanto em **PDF formatado para impressão** quanto em **Planilhas Excel (.xlsx)** para auditoria, secretarias de educação e análise estatística.

---

## 2. Boletim por Bimestre (Bimestral)

O **Boletim por Bimestre** apresenta a radiografia detalhada do rendimento dos alunos no ciclo letivo selecionado (1º, 2º, 3º ou 4º bimestre).

### 2.1 Visão Geral Multi-Disciplinar
Quando o seletor de componente curricular estiver configurado para **"Todas as Disciplinas"**:
- **Orientação do Documento**: O relatório PDF é configurado automaticamente em formato **Paisagem (Landscape)** para garantir espaçamento ideal entre colunas.
- **Ordem Curricular Customizável (1, 2, 3...)**:
  - As disciplinas exibidas nas colunas do boletim seguem estritamente a **ordem numérica cadastrada** em **Disciplinas & Matérias** (`1º`, `2º`, `3º`...).
  - O sistema disponibiliza o atalho **"Ordem BNCC (Fund. I)"** para reordenar com 1 clique a sequência oficial da Base Nacional Comum Curricular (1º Língua Portuguesa, 2º Arte, 3º Educação Física, 4º Língua Inglesa, 5º Matemática, 6º Ciências, 7º Geografia, 8º História, 9º Ensino Religioso, 10º Computação).
- **Colunas Oficiais**:
  1. **Nº**: Número de chamada do estudante na turma.
  2. **Aluno**: Nome completo do estudante (com indicativo de transferência, se houver).
  3. **RA** *(opcional)*: Registro do Aluno.
  4. **Disciplinas da Grade (na ordem numérica cadastrada)**:
     - `LP` (Língua Portuguesa - 1º)
     - `ART` (Arte - 2º)
     - `EF` (Educação Física - 3º)
     - `ING` (Inglês - 4º)
     - `MAT` (Matemática - 5º)
     - `CIE` (Ciências - 6º)
     - `GEO` (Geografia - 7º)
     - `HIST` (História - 8º)
     - `ER` (Ensino Religioso - 9º)
     - `COMP` (Computação - 10º)
     - *(e demais disciplinas ativas da matriz curricular na posição definida)*
  5. **Média**: Média aritmética ponderada do aluno no bimestre em relação às disciplinas avaliadas.

### 2.2 Visão Específica por Componente Curricular
Quando o professor ou coordenador seleciona uma disciplina individual (ex: *Matemática*):
- **Orientação do Documento**: O relatório PDF é gerado em formato **Retrato (Portrait)**.
- **Foco Pedagógico**: Ideal para o professor especialista que deseja avaliar apenas sua matéria ou anexar ao diário de campo do componente.
- **Colunas**:
  - `Nº`, `Aluno`, `RA` *(opcional)*, `Nota ([Nome da Disciplina])`.

### 2.3 Opções de Customização (RA e Conteúdos/Habilidades BNCC)
No card de emissão na aba **Desempenho & Notas**, o operador dispõe de duas opções modulares:
1. **☑ Exibir coluna de R.A. do aluno**:
   - Insere o Registro Acadêmico/Escolar oficial ao lado do nome do estudante.
2. **☑ Incluir categorias trabalhadas após as notas**:
   - Anexa ao final do boletim a relação de planos de aula e habilidades da BNCC trabalhadas na turma durante aquele bimestre específico, justificando formalmente as competências avaliadas.

### 2.4 Exportação em PDF Oficial e Planilha Excel (.xlsx)
- **Botão PDF**: Gera o arquivo `Boletim_[Turma]_[Bimestre]Bimestre.pdf` com cabeçalho oficial contendo:
  - Brasão/Ícone institucional
  - Nome da Escola e Código da Turma
  - Turno, Ano Letivo e Nome do Professor Regente
  - Grade zebrada de alta legibilidade para impressão e assinatura.
- **Botão XLSX**: Gera planilha do Excel formatada com cabeçalho colorido, larguras de colunas pré-ajustadas e fórmulas numéricas prontas para cálculos na secretaria.

---

## 3. Boletim Anual Consolidado

O **Boletim Anual Consolidado** é o instrumento definitivo para fechamento do ano letivo, conselho de classe e emissão do histórico escolar.

### 3.1 Consolidação dos 4 Bimestres
O relatório busca de forma atômica no banco de dados todas as avaliações lançadas para a turma ao longo do ano:
- Coluna **1º Bimestre**: Média do 1º bimestre.
- Coluna **2º Bimestre**: Média do 2º bimestre.
- Coluna **3º Bimestre**: Média do 3º bimestre.
- Coluna **4º Bimestre**: Média do 4º bimestre.
- Coluna **Média Anual**: Resultado da média dos bimestres cursados pelo aluno.

### 3.2 Cálculo Automático de Médias Anuais
$$\text{Média Anual} = \frac{\sum_{b=1}^{N} \text{Média do Bimestre } b}{N}$$
*Onde $N$ representa o número de bimestres efetivamente cursados e com notas válidas registradas.*
- Estudantes com notas ausentes em um bimestre específico por motivo de matrícula tardia têm a média calculada proporcionalmente aos períodos letivos cursados.

### 3.3 Gestão de Transferências (TR. REC / TR. EXP)
O sistema mantém total integridade sobre a vida escolar do estudante:
- **Checkbox "Indicar alunos transferidos (TR. REC / EXP)"**:
  - **Transferência Expedida (`TR. EXP.`)**: Alunos que se transferiram para outra escola durante o ano letivo.
    - Se a opção estiver marcada, o nome recebe o sufixo: `(TR. EXP. em DD/MM/AAAA)`.
    - Nos bimestres posteriores à transferência, a nota é preenchida com a sigla `TR. EXP.` em vez de zero ou traço, evitando que a média da turma seja distorcida.
  - **Transferência Recebida (`TR. REC.`)**: Alunos que ingressaram por transferência no decorrer do ano.
    - Recebe o indicativo `(TR. REC. em DD/MM/AAAA)`.
    - Os bimestres anteriores à matrícula na escola são tratados de acordo com a documentação transferida anexada ao sistema.

### 3.4 Fluxo Oficial de Reingresso (Retorno de Aluno TR. EXP.)
Conforme a escrituração escolar normativa, quando um estudante que teve sua transferência expedida retorna à escola no decorrer do ano letivo:
1. **Preservação da Matrícula 1 (Histórico Arquivado):**
   - O cadastro original do estudante na turma permanece com o número antigo e status `TR. EXP. (DD/MM/AAAA)`.
   - Comprova a frequência e as notas originais do período inicial na ata da escola.
2. **Abertura da Matrícula 2 (Reingresso):**
   - O aluno é reincluído no final da chamada com novo número e status `TR. REC. (DD/MM/AAAA)`.
3. **Mecanismo de Reingresso Assistido no Sistema:**
   - **Exclusividade para `TR. EXP.`:** Os botões de cópia e reingresso só são exibidos quando o aluno possui efetivamente o status de Transferência Expedida.
   - **Trava de Segurança Anti-Duplicação por R.A.:** Se o aluno arquivado com `TR. EXP.` já possuir outra matrícula ativa de reingresso na mesma turma com o mesmo R.A. (ex: Nº 3 e Nº 23), os botões `Reingressar` e `Gravar em Memória` são **automaticamente bloqueados**, exibindo no lugar o selo `[✓ Reingressado]`. Isso impede que o aluno seja reingressado múltiplas vezes por engano.
   - **Botão "Gravar em Memória (TR. EXP.)":** Salva instantaneamente os dados cadastrais (Nome, RA, RM, Data de Nascimento e Data de Saída) na memória da sessão.
   - **Botão "Colar Dados Reingresso":** Na seção *Novo Aluno*, preenche todos os campos cadastrais, calcula e sugere automaticamente o próximo número de chamada no final da fila da turma, define status como `TR. REC.` e preenche a data de retorno.
   - **Atalho Direto "Reingressar" (1 Clique):** Na linha do aluno com `TR. EXP.` na tabela, copia os dados e abre o formulário de novo cadastro com a numeração atualizada pronta para salvar.
4. **Auditoria Ativa de Divergências Cadastrais (TR. EXP ➔ TR. REC):**
   - **Fim do Silêncio Cadastral:** O sistema nunca atua de forma oculta. Caso detecte divergências entre o cadastro de saída (TR. EXP) e o reingresso (TR. REC) — como divergência de grafia de nome, data de nascimento ou RM — um **Alerta de Auditoria** amarelo/âmbar é exibido com destaque.
   - **Painel Comparativo Lado a Lado:** Disponível tanto no menu **Alunos** quanto no menu **Notas** através do botão `🔍 Auditar / Comparar`, permitindo conferir campo a campo as informações originais versus as atuais e o status das notas aproveitadas.
5. **Aproveitamento Automático de Notas & Fechamento Anual (Zero Corrupção):**
   - **Migração Segura e Instantânea:** Ao salvar o novo cadastro de reingresso, o sistema busca todas as disciplinas cursadas pelo aluno no cadastro original e replica automaticamente as notas dos bimestres anteriores cursados na própria escola para o novo número.
   - **Integridade Absoluta:** O cadastro original arquivado (`Nº 3`) **não sofre nenhuma alteração ou mutação** (zero risco de corrupção). O sistema cria novos registros dedicados para a nova matrícula (`Nº 23`).
   - **Botão "Puxar Notas" (Para cadastros já criados):** Para alunos que foram reingressados manualmente antes da automação, a linha do aluno na tabela e o formulário exibem o botão `✨ Puxar Notas`, permitindo migrar as notas anteriores em apenas 1 clique.
   - **Média Anual Consolidada:** O **Boletim Anual** da nova matrícula fecha os 4 bimestres com a **Média Anual completa (100% calculada)**, necessitando apenas que o professor digite as notas do período intermediário caso a família tenha trazido histórico da escola externa.

### 3.5 Frequência Escolar Normativa para Alunos TR. REC & Auditoria de Presenças
Conforme a legislação educacional, um estudante transferido ou reingressado **não pode ter presenças nem faltas registradas em datas ou bimestres anteriores à sua data de entrada oficial**:
1. **Bloqueio no Lançamento da Chamada Online:**
   - Na tela de Chamada, se a data selecionada for anterior à data de entrada do aluno (`selectedDate < transferInDate`) ou se o bimestre for anterior ao ingresso, o sistema bloqueia automaticamente a marcação com o aviso `⛔ Não Matriculado nesta data` e desabilita o interruptor de presença.
   - Botões globais como *Todos Presentes (P)* e *Todos Ausentes (A)* ignoram automaticamente alunos que não estavam matriculados naquele dia.
2. **Prevenção e Purga ao Salvar:**
   - Ao salvar a chamada de uma data anterior, o sistema não grava registros para o aluno e purga eventuais registros preexistentes indevidos daquela data no banco de dados.
3. **Ferramenta de Auditoria & Limpeza de Presenças Indevidas:**
   - Na tela de Chamada Online, o sistema analisa o histórico da turma. Se encontrar presenças gravadas antes da data oficial de retorno, exibe o botão destacado `🧹 Regularizar Presenças TR. REC (X indevidas)`.
   - Com 1 clique, a secretaria ou o professor remove todos os registros indevidos, regularizando a frequência oficial em todos os boletins e atas.

### 3.6 Como Encontrar e Consultar as Chamadas Dia a Dia no Sistema
O sistema disponibiliza duas formas integradas e complementares para localizar e consultar o histórico diário de chamadas:
1. **Navegador Dia a Dia na tela de Chamada Online (`Chamada Online`):**
   - No topo da tela de chamada, há uma barra de histórico com a contagem total de aulas dadas no bimestre selecionado (ex: `36 chamadas realizadas no 1º Bimestre`).
   - Apresenta **pílulas interativas de todas as datas** em que houve chamada (ex: `[02/02 28P/2F]`, `[03/02 30P]`).
   - Clicar em qualquer data carrega imediatamente o diário daquele dia na tela para conferência ou edição rápida.
2. **Mapa de Frequência Diária / Diário de Classe Consolidado (`Menu Relatórios ➔ Aba Frequência`):**
   - Gera a matriz oficial com todos os dias do bimestre em colunas e todos os alunos nas linhas.
   - Mostra exatamente quem estava Presente (`P`), Ausente (`F`) ou Não Matriculado (`-`), além dos totais diários de presentes no rodapé.
   - Pode ser emitido diretamente da tela de chamada ou de relatórios em **PDF Paisagem** ou **Planilha Excel (.xlsx)**.

### 3.7 Exportações Gerenciais em PDF e Excel
- **PDF Consolidado**: Documento diagramado para conselhos de classe, arquivo passivo da secretaria e pastas individuais dos estudantes.
- **Planilha Excel (.xlsx)**: Permite ordenações personalizadas (por ordem de melhor média, por número de chamada ou por situação final).

---

## 4. Ficha Individual do Aluno & Histórico de Evolução

Localizada na aba **Aluno (Ficha Individual / Evolução)** da tela de Relatórios:
- **Finalidade**: Análise 360º de um único estudante específico.
- **Conteúdo Integrado**:
  1. **Dados Cadastrais**: Nome, RA, data de nascimento, nome dos responsáveis, telefone e endereço.
  2. **Quadro de Desempenho Bimestral**: Notas disciplina por disciplina em todos os bimestres.
  3. **Frequência e Assiduidade**: Total de aulas dadas, presenças, faltas justificadas, faltas injustificadas e percentual de frequência global.
  4. **Ocorrências Disciplinares e Elogios**: Histórico pedagógico registrado pelos professores e coordenação.
  5. **Leituras na Biblioteca & Cantinho**: Relação de livros retirados pelo estudante, datas e prazos de devolução.
- **Emissão**: Ideal para atendimento presencial aos responsáveis ou encaminhamento para equipe multidisciplinar (psicopedagogia / conselho tutelar).

---

## 5. Regras de Negócio e Fórmulas de Avaliação

1. **Escala de Notas**: Padrão de 0,0 a 10,0 com precisão de uma casa decimal (`toFixed(1)`).
2. **Arredondamento Padrão**: Segue a norma aritmética brasileira padrão (ABNT NBR 5891).
3. **Casos Especiais de Preenchimento**:
   - `-` (Traço): Indica avaliação ainda não lançada ou componente sem registro no bimestre.
   - `TR. EXP.`: Aluno com transferência expedida.
   - `TR. REC.`: Aluno com transferência recebida.
4. **Alunos Inativos**: Alunos marcados como transferidos continuam disponíveis no histórico do ano letivo de sua matrícula original para fins de emissão retrospectiva de boletins e auditoria da secretaria.

---

## 6. Segurança e Regras de Acesso (Firebase Realtime Database)

Toda a infraestrutura de notas e dados escolares que alimentam os boletins segue rígidos controles de segurança configurados em `database.rules.json`:

1. **Administradores**:
   - Acesso total de leitura e auditoria em todas as escolas, turmas, notas e relatórios.
2. **Professores**:
   - Leitura de notas e geração de boletins autorizada para as turmas nas quais possuem atribuição formal:
     ```json
     "diario-classe/atribuicoes/{uid}/{classId} === true"
     ```
   - Impede que professores visualizem ou emitam boletins de turmas ou escolas de outros docentes sem prévia delegação pedagógica.
3. **Integridade de Dados**:
   - As notas lançadas possuem validação de tipo numérico (`newData.isNumber()`) e valor entre 0 e 10.

---

## 7. Guia Passo a Passo de Emissão

### Para emitir o Boletim Bimestral:
1. No menu principal lateral, clique em **"Relatórios"** (`📊`).
2. Selecione a **Escola**, a **Turma**, o **Ano Letivo** e o **Bimestre** desejado no topo da tela.
3. Se desejar filtrar apenas um componente curricular, selecione-o no dropdown de **Disciplina** (ou mantenha em *"Todas as Disciplinas"*).
4. No card **"Boletim por Bimestre"**:
   - Marque se deseja incluir o **RA** dos alunos.
   - Marque se deseja anexar os **conteúdos trabalhados (BNCC)**.
5. Clique em **"PDF"** para impressão imediata ou **"XLSX"** para exportar em planilha Excel.

### Para emitir o Boletim Anual Consolidado:
1. Na mesma tela de Relatórios, localize o card destacado **"Boletim Anual Consolidado"** (borda verde).
2. Marque a opção **"Indicar alunos transferidos (TR. REC / EXP)"** para que o documento aponte claramente os históricos de movimentação.
3. Clique em **"PDF"** ou **"XLSX"**. O sistema compilará os 4 bimestres automaticamente em poucos segundos.

---

## 8. Relatórios de Frequência e Ranking de Absenteísmo

Na aba **Frequência** da tela de Relatórios (`CheckSquare`), estão disponíveis dois relatórios oficiais para auditoria da assiduidade escolar e intervenção pedagógica preventiva contra a evasão.

### 8.1 Frequência Bimestral (Ata de Frequência)
- **Finalidade**: Ata oficial de apuração da frequência dos estudantes no bimestre selecionado.
- **Colunas Oficiais**:
  1. **Nº**: Número de chamada do estudante na turma.
  2. **Aluno**: Nome completo do estudante (com indicativo de transferência, se houver).
  3. **RA** *(opcional)*: Registro Acadêmico do estudante.
  4. **Presenças**: Total de dias ou aulas com presença registrada (`P`).
  5. **Faltas**: Total de faltas registradas (`F`).
  6. **Total Aulas**: Somatório de presenças e faltas no período.
  7. **% Frequência**: Percentual apurado $(\text{Presenças} \div \text{Total}) \times 100$.
  8. **% Ausência** *(opcional)*: Percentual de faltas em relação ao total de aulas.
  9. **Situação / Status** *(opcional)*: Classificação do aluno (`Regular`, `Risco (<75%)` ou `TR. EXP.`).

### 8.2 Ranking de Faltas / Absenteísmo
- **Finalidade**: Ordenação decrescente de faltas na turma para apoiar a **busca ativa**, conselhos tutelares e coordenação pedagógica.
- **Colunas Oficiais**:
  1. **Posição**: Classificação ordinal no ranking (`1º`, `2º`, `3º`...).
  2. **Nº**: Número de chamada do estudante na turma.
  3. **Aluno**: Nome do estudante.
  4. **RA** *(opcional)*: Registro do Aluno.
  5. **Total Faltas**: Quantidade de faltas acumuladas no bimestre.
  6. **% de Ausência** *(opcional)*: Taxa percentual de absenteísmo.
  7. **Status** *(opcional)*: `CRÍTICO` (ausência $> 25\%$), `NORMAL` ou `TR. EXP.`.

### 8.3 Customizações (RA, % Ausência, Status e Transferências de Saída)
Ambos os relatórios contam com caixas de seleção independentes na interface:
- **☑ Exibir coluna de R.A.**: Inclui ou oculta o Registro Acadêmico.
- **☑ Exibir % de Ausência**: Inclui ou oculta a coluna de percentual de faltas.
- **☑ Exibir Situação / Status**: Inclui ou oculta o status escolar do estudante.
- **☐ Incluir Transferências de Saída** *(Padrão: Desmarcado)*:
  - **Desmarcado (Padrão)**: Exibe apenas os estudantes ativos (e transferências de entrada), garantindo que a lista reflita com precisão os alunos atualmente presentes na sala de aula e evitando distorções no ranking de faltas.
  - **Marcado**: Inclui os estudantes que se transferiram para outra escola durante o ano letivo, registrando formalmente a anotação `TR. EXP.` e a data de expedição para fins de auditoria de secretaria.

### 8.4 Exportações Duplas (PDF e Excel)
- **PDF**: Diagramação com cabeçalho oficial da escola e dimensionamento responsivo automático (a coluna do aluno se expande dinamicamente para preencher a página quando colunas opcionais forem desmarcadas).
- **Excel (.xlsx)**: Planilha estruturada montada dinamicamente conforme as colunas ativadas, com larguras calibradas e células prontas para cálculos.

---

*Manual atualizado em conformidade com as diretrizes do Diário de Classe Digital e BNCC.*
