# 📖 Manual Completo da Biblioteca Escolar & Cantinho da Leitura

Este documento fornece o guia operacional e técnico completo de todas as funcionalidades da **Biblioteca Escolar & Cantinho da Leitura** do sistema Diário de Classe Digital.

---

## 📑 Sumário

1. [Visão Geral e Arquitetura](#1-visão-geral-e-arquitetura)
2. [Cadastro Inteligente de Livros (3 Modos)](#2-cadastro-inteligente-de-livros-3-modos)
   - [Leitura Visual com IA (Gemini Vision OCR)](#21-leitura-visual-com-ia-gemini-vision-ocr)
   - [Busca Instantânea por Código ISBN](#22-busca-instantânea-por-código-isbn)
   - [Cadastro Manual Detalhado](#23-cadastro-manual-detalhado)
3. [Gestão de Acervo Multi-Escola & Exemplares](#3-gestão-de-acervo-multi-escola--exemplares)
4. [Circulação de Obras & Empréstimos](#4-circulação-de-obras--empréstimos)
   - [Realização de Empréstimo](#41-realização-de-empréstimo)
   - [Prazos, Atrasos e Renovação Rápida](#42-prazos-atrasos-e-renovação-rápida)
   - [Devolução](#43-devolução)
5. [Cantinho da Leitura (Biblioteca em Sala de Aula)](#5-cantinho-da-leitura-biblioteca-em-sala-de-aula)
   - [Conceito Pedagógico](#51-conceito-pedagógico)
   - [Disponibilização / Alocação para a Sala](#52-disponibilização--alocação-para-a-sala)
   - [Empréstimo Rápido com Aluno da Turma](#53-empréstimo-rápido-com-aluno-da-turma)
   - [Recebimento do Aluno](#54-recebimento-do-aluno)
   - [Retorno ao Acervo Central](#55-retorno-ao-acervo-central)
6. [Remanejamento entre Escolas](#6-remanejamento-entre-escolas)
7. [Histórico de Movimentações e Leituras](#7-histórico-de-movimentações-e-leituras)
8. [Relatórios e Exportações (Excel e PDF)](#8-relatórios-e-exportações-excel-e-pdf)
9. [Regras de Permissão e Segurança (Firebase)](#9-regras-de-permissão-e-segurança-firebase)

---

## 1. Visão Geral e Arquitetura

O módulo de **Biblioteca Escolar** atende tanto à gestão central da biblioteca da escola quanto à rotina pedagógica descentralizada do professor em sala de aula (**Cantinho da Leitura**).

### Atores e Níveis de Acesso:
- **Administrador**: Acesso total a todas as escolas, turmas, acervos, remanejamentos e configurações.
- **Professor / Bibliotecário**:
  - Consulta o acervo geral e da sua unidade escolar.
  - Realiza e renova empréstimos de alunos das suas turmas.
  - Aloca livros para o Cantinho da Leitura de suas turmas e gerencia os empréstimos em sala.
  - Cadastra novos títulos no acervo (quando habilitado).

---

## 2. Cadastro Inteligente de Livros (3 Modos)

Para facilitar o cadastramento de centenas de títulos sem digitação manual exaustiva, o sistema dispõe de três métodos integrados:

### 2.1 Leitura Visual com IA (Gemini Vision OCR)
1. Clique em **"Cadastrar Livro"** no topo da tela da Biblioteca.
2. No painel **"Preenchimento Automático Inteligente"**, envie ou fotografe:
   - **Foto da Capa Frontal**: Título, autor, ilustrador e editora.
   - **Foto da Contracapa / Ficha Catalográfica** *(opcional, mas recomendada)*: Código de barras, ISBN, sinopse e ano de publicação.
3. Clique no botão **"Identificar Livro com IA"**.
4. O modelo analisa as duas imagens simultaneamente e extrai:
   - Título oficial da obra
   - Nome do autor e ilustrador
   - Código ISBN normalizado (10 ou 13 dígitos)
   - Editora e coleção
   - Gênero literário sugerido (ex: Literatura Infantil, Ficção, Fábula)
   - Sinopse completa
   - Miniatura da capa para exibição visual
5. **Validação e avisos**: o ISBN lido é conferido pelo dígito verificador e cruzado com o código de barras (quando o navegador consegue lê-lo) e com a base da CBL/Google Books. Se algo não bater — ISBN descartado, campos com dúvida ou fotos de livros diferentes — aparece uma caixa amarela de **avisos** abaixo da mensagem de sucesso. Revise esses campos antes de salvar.
   - **Dicas de foto**: capa e contracapa de frente (sem inclinar), boa luz, sem reflexo do flash, com o código de barras inteiro no quadro.
6. **Limpeza Inteligente de Resíduos**: Ao carregar uma nova imagem ou iniciar uma nova leitura, todos os campos anteriores são limpos automaticamente para evitar sobreposição ou dados incorretos de livros anteriores. Há também o botão **"Limpar Dados da Leitura"**.

### 2.2 Busca Instantânea por Código ISBN
1. Digite ou leia com leitor de código de barras o código **ISBN** (ex: `9788532274758`).
2. Clique em **"Buscar ISBN"**.
3. O sistema consulta as APIs oficiais do **Google Books** e **OpenLibrary**:
   - Preenche imediatamente o título, autor, editora, data de publicação, descrição/sinopse e categoria.
   - Baixa a imagem oficial da capa em alta resolução.

### 2.3 Cadastro Manual Detalhado & Modos de Distribuição
Campos disponíveis para controle patrimonial:
- **Título da Obra** *(obrigatório)*
- **Autor(a)** *(obrigatório)*
- **Código de Tombamento / ISBN**: Identificador único do exemplar físico.
- **Alternador de Modo de Distribuição (quando a rede possui mais de 1 escola)**:
  - **🏢 Entrada em Unidade Única**: Modo padrão e direto para o operador escolar cadastrar livros que chegaram para a sua própria escola.
  - **🌐 Distribuir em Múltiplas Escolas**: Permite alocar e partilhar uma remessa de livros em várias escolas simultaneamente em um único cadastro mestre, definindo a quantidade e a estante de cada unidade.
- **Detecção em Tempo Real de Obras Existentes (Anti-Redundância)**:
  - Enquanto o usuário digita o título ou o código/ISBN, o sistema consulta a base em tempo real.
  - Se a obra já existir na rede, exibe um painel explicativo informando o número de exemplares existentes e suas respectivas escolas, disponibilizando o botão **"Usar Dados Desta Obra"** para autopreenchimento imediato de sinopse, capa, editora e gênero.
  - Ao salvar, os novos exemplares são integrados ao cadastro existente na unidade escolhida, prevenindo duplicações desnecessárias no catálogo unificado.
- **Total de Exemplares**: Quantidade física total de livros recebidos.
- **Gênero / Categoria**: Literatura Infantil, Contos, Poesia, Infantojuvenil, Didático, etc.
- **Editora e Ano de Publicação**.
- **Localização / Estante**: Ex: *Estante 02, Prateleira B*.
- **Sinopse / Resumo Pedagógico**.

---

## 3. Gestão de Acervo Multi-Escola & Exemplares

O sistema opera no modelo **Obra Mestra vs. Exemplares Físicos Locais**:
- **Filtro de Unidade Escolar**: No topo da biblioteca, o usuário pode escolher ver o acervo de uma escola específica ou a rede integrada.
- **Estrutura de Obras e Cópias (`copiesBySchool`)**:
  - Cada título bibliográfico possui um registro mestre compartilhado na rede escolar.
  - O mapa `copiesBySchool` armazena para cada escola: `schoolName`, `totalCopies`, `availableCopies`, `location` (estante) e `code` patrimonial local.
  - Isso garante que a rede tenha estatísticas globais centralizadas sem poluir o banco com múltiplos registros redundantes da mesma obra literária.
- **Controle de Disponibilidade em Tempo Real**:
  - `totalCopies`: Quantidade patrimonial física total (soma de todas as escolas ou total da unidade filtrada).
  - `availableCopies`: Quantidade livre na estante no momento para novos empréstimos.
  - Quando um exemplar é emprestado a um aluno ou alocado em um Cantinho da Leitura, a quantidade disponível no acervo local é decrementada automaticamente.
  - Quando o livro é devolvido, a quantidade disponível é restabelecida imediatamente.
- **Segurança de Acesso e Trava por Unidade Escolar**:
  - **Administradores da Rede**: Podem visualizar, cadastrar, editar exemplares e remanejar livros entre qualquer escola da rede.
  - **Professores / Bibliotecários por Unidade**: As escolas sob sua responsabilidade são detectadas automaticamente através das turmas atribuídas ao seu perfil docente.
  - **Proteção dos Dados Físicos**: Ao abrir a edição de um título que possui exemplares em outras escolas da rede, os campos de exemplares e estante das demais unidades ficam em **Modo Somente Leitura** com o selo de cadeado 🔒 (*"Outra Unidade (Somente Leitura)"*).
  - O operador só pode alterar exemplares físicos, localização ou transferir livros da unidade onde possui atribuição ativa, garantindo a integridade patrimonial de cada unidade escolar.
- **Remessas Coletivas no Cadastro**: No próprio momento do cadastramento da obra, o operador da rede pode distribuir exemplares entre as diferentes escolas cadastradas sem precisar repetir o processo escola por escola.

---

## 4. Circulação de Obras & Empréstimos

### 4.1 Realização de Empréstimo
1. Clique em **"Novo Empréstimo"** ou no botão **"Emprestar"** diretamente no card do livro desejado.
2. Selecione a **Turma** e, em seguida, o **Aluno(a)** da lista de chamada.
3. Defina a **Data de Devolução Prevista** (sugestão automática de 7 dias, configurável).
4. Adicione observações caso necessário (ex: estado de conservação do exemplar).
5. Ao confirmar:
   - Um exemplar do livro é reservado (`availableCopies - 1`).
   - O empréstimo ganha o status **Ativo**.

### 4.2 Prazos, Atrasos e Renovação Rápida
- **Cálculo de Atraso em Tempo Real**: Se a data prevista for ultrapassada sem devolução, o empréstimo passa automaticamente para o status **Atrasado** com destaque visual em vermelho.
- **Renovação com 1 Clique**: No painel de empréstimos, o botão **"Renovar (+7 dias)"** estende o prazo do empréstimo instantaneamente sem necessidade de cadastrar nova ficha.

### 4.3 Devolução com Identificação do Destino Físico
- Ao receber o livro físico, clique em **"Devolver"**.
- **Indicação do Destino Físico do Exemplar**:
  - Para evitar extravios ou dúvidas entre bibliotecários e professores, o sistema detecta a origem do empréstimo e exibe com destaque no modal de confirmação:
    - 🏫 **Cantinho da Sala**: *"Guardar na estante do Cantinho da Leitura da turma [Turma]. O exemplar ficará disponível para os alunos desta sala."*
    - 📚 **Biblioteca Central**: *"Guardar no Acervo Central da Biblioteca ([Escola]). O exemplar é reposto no estoque geral da unidade."*
- **Etiquetas Visuais nos Cards de Empréstimo**:
  - Cada card na lista de empréstimos indica visualmente sua procedência (`🏫 Cantinho da Sala` ou `📚 Biblioteca Central`), além da turma, aluno e prazo.
- É possível registrar o estado de conservação e anotações na devolução.
- O exemplar retorna à estante correta e o registro é arquivado no Histórico de Circulação com a localização devidamente indicada.

---

## 5. Cantinho da Leitura (Biblioteca em Sala de Aula)

### 5.1 Conceito Pedagógico & Segregação de Custódia
O **Cantinho da Leitura** é a extensão física da biblioteca escolar dentro da sala de aula. Ele permite que uma turma tenha um lote rotativo de livros sempre à mão para incentivar a leitura livre, contação de histórias e empréstimos ágeis gerenciados pelo próprio professor regente.

**Princípio de Segregação Patrimonial (Sem Duplicidade de Estoque)**:
- A alocação transfere a **custódia física** temporária dos exemplares da biblioteca central para a sala de aula.
- Durante a permanência dos livros na sala, os empréstimos aos alunos da turma são geridos **exclusivamente no âmbito da sala de aula**, sem debitar nem gerar movimentações indevidas no acervo central da escola.
- A disponibilidade na sala decorre da verdade material: $\text{Exemplares Livres na Sala} = \text{Total Alocado para a Turma} - \text{Empréstimos Ativos com Alunos da Turma}$.
- Essa modelagem atômica previne erros de concorrência e divergências entre o estoque do sistema e o estoque físico real.

### 5.2 Disponibilização / Alocação para a Sala
1. Na aba **"Acervo"**, clique no botão **"Cantinho"** de qualquer obra que possua exemplares disponíveis (ou use o botão **"Disponibilizar Obras no Cantinho"** na aba Cantinho).
2. Selecione a **Turma / Sala de Aula** de destino.
3. Escolha a **Quantidade de Exemplares** que serão levados para a sala (respeitando o limite de exemplares livres no acervo central).
4. Insira observações do projeto pedagógico se desejar.
5. **Efeito no Sistema**:
   - Os exemplares saem da disponibilidade da biblioteca geral (`availableCopies` diminui).
   - Entram no inventário da sala de aula com quantidade total e quantidade livre na estante da sala.
   - É gerado um registro formal de movimentação no histórico da escola.

### 5.3 Empréstimo Rápido com Aluno da Turma
1. Na aba **"Cantinho da Leitura"**, localize o card do livro na turma.
2. Clique em **"Emprestar"**.
3. Selecione o aluno da turma e o prazo (padrão de 7 dias).
4. O livro passa a constar como "Com Aluno" na contagem da sala de aula e na aba **Empréstimos Ativos**.

### 5.4 Recebimento do Aluno
- Quando o estudante termina a leitura e traz o livro de volta para a sala, o professor acessa a aba **"Empréstimos Ativos"** do Cantinho e clica em **"Receber na Sala"**.
- O livro volta a ficar livre na estante da turma.

### 5.5 Retorno ao Acervo Central
- Ao término do bimestre ou do projeto de leitura, o professor ou bibliotecário clica no botão **"Acervo"** no card do livro na sala de aula.
- Informa quantos exemplares físicos estão sendo devolvidos à biblioteca geral.
- O saldo do acervo central é recomposto e a alocação na sala é liquidada.

---

## 6. Remanejamento entre Escolas

Para redes municipais com múltiplas escolas cadastradas:
1. No card do livro no Acervo, clique no botão **"Remanejar"** (disponível para administradores e gestores quando há mais de 1 escola).
2. Escolha a **Escola de Destino** e a quantidade de exemplares a transferir.
3. O sistema valida o estoque da escola de origem, transfere o saldo para a escola receptora e grava o registro auditável com:
   - Data e hora da transferência
   - Nome e UID do responsável
   - Justificativa / Motivo do remanejamento

---

## 7. Histórico de Movimentações e Leituras

Na aba **"Histórico"**, a gestão escolar dispõe de duas visões completas:
1. **Histórico de Circulação / Empréstimos**:
   - Relação de todos os empréstimos concluídos ou em andamento.
   - Aluno, turma, data de empréstimo, data de devolução e tempo de retenção.
2. **Histórico de Remanejamentos & Alocações**:
   - Registro de todas as transferências entre escolas e movimentações para cantinhos de leitura.
   - Auditoria com responsável, quantidade e motivo.

---

## 8. Relatórios e Exportações (Excel e PDF)

Todas as telas possuem exportadores automáticos:
- **Exportar Acervo (.xlsx)**: Planilha Excel com código de tombamento, título, autor, gênero, editora, total e disponíveis por escola.
- **Exportar Empréstimos (.xlsx)**: Planilha de circulação com status (em dia, atrasado, devolvido), datas e dados dos alunos.
- **Exportar Cantinho da Leitura (.xlsx)**: Relação de livros alocados em cada turma e situação de uso.
- **Comprovantes / Fichas em PDF**: Geração de comprovante de empréstimo e relatórios para impressão formal.

---

## 9. Regras de Permissão e Segurança (Firebase)

No arquivo `database.rules.json`, a estrutura da biblioteca está protegida contra acessos indevidos:

```json
{
  "rules": {
    "diario-classe": {
      "biblioteca": {
        "livros": {
          ".read": "auth != null",
          ".write": "auth != null"
        },
        "emprestimos": {
          ".read": "auth != null",
          ".write": "auth != null"
        },
        "movimentacoes": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      },
      "cantinhos": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

> **Aviso Importante**: Ao implantar em produção, certifique-se de que o bloco `cantinhos` esteja publicado na aba **Regras (Rules)** do Firebase Realtime Database.
