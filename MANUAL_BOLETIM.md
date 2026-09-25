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
   - [3.4 Exportações Gerenciais em PDF e Excel](#34-exportações-gerenciais-em-pdf-e-excel)
4. [Ficha Individual do Aluno & Histórico de Evolução](#4-ficha-individual-do-aluno--histórico-de-evolução)
5. [Regras de Negócio e Fórmulas de Avaliação](#5-regras-de-negócio-e-fórmulas-de-avaliação)
6. [Segurança e Regras de Acesso (Firebase Realtime Database)](#6-segurança-e-regras-de-acesso-firebase-realtime-database)
7. [Guia Passo a Passo de Emissão](#7-guia-passo-a-passo-de-emissão)

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
- **Colunas Oficiais**:
  1. **Nº**: Número de chamada do estudante na turma.
  2. **Aluno**: Nome completo do estudante (com indicativo de transferência, se houver).
  3. **RA** *(opcional)*: Registro do Aluno.
  4. **Disciplinas da Grade**:
     - `LP` (Língua Portuguesa)
     - `MAT` (Matemática)
     - `CIE` (Ciências)
     - `HIST` (História)
     - `GEO` (Geografia)
     - `ART` (Arte)
     - `EF` (Educação Física)
     - `ING` (Inglês)
     - `ER` (Ensino Religioso)
     - *(e demais disciplinas ativas da matriz curricular)*
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

### 3.4 Exportações Gerenciais em PDF e Excel
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

*Manual atualizado em conformidade com as diretrizes do Diário de Classe Digital e BNCC.*
